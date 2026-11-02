use std::{sync::Mutex,time::{Duration,Instant},process::{Command,Stdio}};
use serde::{Serialize,Deserialize};
use tauri::Manager;
static JOB:Mutex<Option<Job>>=Mutex::new(None);
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Job {id:String,title:String,status:String,bytes:u64,error:Option<String>,path:Option<String>,error_code:Option<String>,warning:Option<String>,#[serde(skip)]cancel:bool}
fn update(status:&str,error:Option<String>) {if let Ok(mut job)=JOB.lock(){if let Some(j)=job.as_mut(){j.status=status.into();j.error=error;}}}
fn canceled()->bool {JOB.lock().ok().and_then(|j|j.as_ref().map(|j|j.cancel)).unwrap_or(true)}
#[tauri::command]
pub fn native_download_status()->Option<Job> {JOB.lock().ok()?.clone()}
#[tauri::command]
pub fn native_download_cancel(){crate::pairing::cancel_capture();if let Ok(mut job)=JOB.lock(){if let Some(j)=job.as_mut(){j.cancel=true;}}}
fn valid_url(raw:&str)->bool {
    let Ok(url)=reqwest::Url::parse(raw) else{return false};
    let host=url.host_str().unwrap_or("");
    url.scheme()=="https" && url.username().is_empty() && url.password().is_none() && ["mux.com","hotmart.com","cloudfront.net"].iter().any(|domain|host==*domain||host.ends_with(&format!(".{domain}")))
}
pub(crate) use crate::path_parts::safe_name;
fn output_path(directory:&std::path::Path,title:&str)->std::path::PathBuf {
    let title=safe_name(title);let mut path=directory.join(format!("{title}.mp4"));let mut n=2;
    while path.exists(){path=directory.join(format!("{title} ({n}).mp4"));n+=1;}path
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct VideoCapture {url:String,#[serde(default)]subtitles:Vec<Caption>,#[serde(default)]subtitle_warning:bool,#[serde(default)]subtitle_available:u32,#[serde(default)]subtitle_message:Option<String>}
#[derive(Deserialize)]
struct Caption {language:String,format:String,text:String}
fn save_captions(video:&std::path::Path,captions:&[Caption])->Result<usize,String> {
    use std::io::Write;
    if captions.len()>1{return Err("Quantidade de legendas inválida.".into());}
    let mut count=0;
    for caption in captions {
        if !["srt","vtt"].contains(&caption.format.as_str()) || caption.text.len()>350000 || !caption.text.contains("-->"){return Err("A legenda recebida é inválida.".into());}
        let path=video.with_extension(format!("{}.{}",safe_name(&caption.language),caption.format));
        if path.is_file(){count+=1;continue;}
        let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|_|"Não foi possível salvar a legenda ao lado do vídeo.")?;
        file.write_all(caption.text.as_bytes()).map_err(|_|"Não foi possível concluir a legenda.")?;count+=1;
    }
    Ok(count)
}
#[tauri::command]
pub async fn native_download(app:tauri::AppHandle,lesson_id:String,access_token:String,materials_only:Option<bool>,subtitles_only:Option<bool>,include_subtitles:Option<bool>,expected_course:Option<String>)->Result<(),String> {
    let include_subtitles=include_subtitles.unwrap_or(true);
    let materials_only=materials_only.unwrap_or(false);let subtitles_only=subtitles_only.unwrap_or(false);
    if materials_only&&subtitles_only{return Err("Operação inválida".into());}
    let subtitle_target=if subtitles_only{Some(crate::history::saved_path(&app,&lesson_id)?.0)}else{None};
    let inventory=crate::pairing::bridge_inventory().ok_or("Conecte a extensão e busque as aulas.")?;
    if expected_course.is_some_and(|key|key!=inventory.course_key){return Err("O curso mudou no Chrome. Atualize a lista antes de continuar a fila.".into());}
    if (materials_only||subtitles_only) && !inventory.capabilities.iter().any(|feature|feature==if materials_only{"materials"}else{"subtitles"}){return Err("A extensão conectada é de uma versão anterior. Recarregue a extensão Vodown no Chrome e atualize as aulas para baixar materiais e legendas.".into());}
    let lesson=inventory.lessons.iter().find(|l|l.id==lesson_id).ok_or("Aula não encontrada.")?.clone();
    let id=format!("{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"Relógio inválido")?.as_nanos());
    {let mut state=JOB.lock().map_err(|_|"Fila indisponível")?;if state.as_ref().is_some_and(|j|["authorizing","capturing","downloading","finishing"].contains(&j.status.as_str())){return Err("Aguarde o download atual terminar.".into());}*state=Some(Job{id:id.clone(),title:lesson.title.clone(),status:"authorizing".into(),bytes:0,error:None,path:None,error_code:None,warning:None,cancel:false});}
    let directory=crate::pairing::lesson_directory(&app.path().download_dir().map_err(|_|"Pasta Downloads indisponível")?.join("Vodown"),&inventory,&lesson);
    let database=app.path().app_data_dir().map_err(|_|"Histórico indisponível")?.join("vodown.sqlite3");
    tauri::async_runtime::spawn_blocking(move || {
        let run=||->Result<(),String>{
            let client=reqwest::blocking::Client::builder().timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|"Não foi possível preparar a conexão.")?;
            let base=if cfg!(debug_assertions){"http://localhost:5080"}else{"https://api.vodown.com"};
            let response=client.post(format!("{base}/v1/me/download-authorizations")).bearer_auth(access_token).json(&serde_json::json!({"client":"desktop","lessonCount":1})).send().map_err(|_|"Não foi possível autorizar o download. Confira a API.")?;
            if response.status()==403{return Err("O download no desktop requer PRO.".into());}
            if !response.status().is_success(){return Err("Não foi possível confirmar suas permissões. Entre novamente e tente de novo.".into());}
            if response.json::<serde_json::Value>().ok().and_then(|v|v["allowed"].as_bool())!=Some(true){return Err("Download não autorizado.".into());}
            if canceled(){return Err("Cancelado.".into());}
            update("capturing",None);crate::pairing::request_capture_kind(id.clone(),lesson_id.clone(),if materials_only{"materials"}else if !include_subtitles&&!subtitles_only{"video_no_subtitles"}else{"video"}.into())?;
            let start=Instant::now();
            let url=loop {if canceled(){return Err("Cancelado.".into());}if let Some(value)=crate::pairing::take_capture(){break value?;}if start.elapsed()>Duration::from_secs(if materials_only{600}else{120}){return Err("A extensão não respondeu. Mantenha o Chrome e o curso abertos.".into());}std::thread::sleep(Duration::from_millis(200));};
            if materials_only {
                let result:serde_json::Value=serde_json::from_str(&url).map_err(|_|"Resposta de materiais inválida")?;
                if result["count"].as_u64().unwrap_or(0)==0{update("finishing",None);return Ok(());}
                if let Ok(mut job)=JOB.lock(){if let Some(j)=job.as_mut(){j.path=Some(directory.join("Materiais").join(safe_name(&lesson.title)).to_string_lossy().into_owned());}}
                update("finishing",None);return Ok(());
            }
            let captured=if url.starts_with('{'){serde_json::from_str::<VideoCapture>(&url).map_err(|_|"Captura do vídeo inválida.")?}else{VideoCapture{url,subtitles:vec![],subtitle_warning:false,subtitle_available:0,subtitle_message:None}};
            let url=captured.url;
            if !valid_url(&url){return Err("A origem do vídeo não é suportada.".into());}
            if let Some(target)=&subtitle_target {
                let count=save_captions(target,&captured.subtitles)?;
                if let Ok(mut job)=JOB.lock(){if let Some(j)=job.as_mut(){j.path=Some(target.to_string_lossy().into_owned());if count==0{j.warning=Some(captured.subtitle_message.clone().filter(|s|!s.is_empty()).unwrap_or_else(||if captured.subtitle_warning{"Não foi possível obter a legenda nesta captura."}else{"A plataforma não ofereceu legenda nesta captura."}.into()));}}}
                update("finishing",None);return Ok(());
            }
            std::fs::create_dir_all(&directory).map_err(|_|"Não foi possível criar a pasta de destino.")?;
            let mut target=output_path(&directory,&lesson.title);let partial=directory.join(format!(".{id}.partial.mp4"));
            let executable=std::env::var_os("VODOWN_FFMPEG_PATH").unwrap_or_else(||"ffmpeg".into());
            let referer=if inventory.platform=="hotmart"{"https://cf-embed.play.hotmart.com/"}else{"https://whop.com/"};
            let mut child=Command::new(executable).args(["-nostdin","-hide_banner","-loglevel","error","-protocol_whitelist","https,tls,tcp,crypto","-headers",&format!("Referer: {referer}\r\n"),"-rw_timeout","15000000","-i",&url,"-c","copy","-movflags","+faststart","-n"]).arg(&partial).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|_|"FFmpeg não está disponível nesta instalação.")?;
            update("downloading",None);
            loop {
                if canceled(){let _=child.kill();let _=child.wait();let _=std::fs::remove_file(&partial);return Err("Cancelado.".into());}
                match child.try_wait(){Ok(Some(status))=>{if !status.success(){let _=std::fs::remove_file(&partial);return Err("O vídeo não pôde ser baixado. Capture a aula novamente; DRM não é suportado.".into());}break;},Ok(None)=>(),Err(_)=>{let _=child.kill();let _=child.wait();let _=std::fs::remove_file(&partial);return Err("Falha ao acompanhar o download.".into());}}
                if let Ok(meta)=std::fs::metadata(&partial){if let Ok(mut job)=JOB.lock(){if let Some(j)=job.as_mut(){j.bytes=meta.len();}}}
                std::thread::sleep(Duration::from_millis(500));
            }
            if std::fs::metadata(&partial).map(|m|m.len()).unwrap_or(0)==0{return Err("O arquivo recebido está vazio.".into());}
            loop {match std::fs::hard_link(&partial,&target) {
                Ok(())=>{let _=std::fs::remove_file(&partial);break;},
                Err(error) if error.kind()==std::io::ErrorKind::AlreadyExists=>{target=output_path(&directory,&lesson.title);},
                Err(_)=>return Err("Não foi possível concluir o arquivo. Verifique o espaço em disco.".into()),
            }}
            if let Ok(mut job)=JOB.lock(){if let Some(j)=job.as_mut(){j.bytes=std::fs::metadata(&target).map(|m|m.len()).unwrap_or(j.bytes);j.path=Some(target.to_string_lossy().into_owned());}}
            let caption_result=save_captions(&target,&captured.subtitles);
            let warning=if !include_subtitles {None}else{match caption_result {Err(error)=>Some(error),Ok(0) if captured.subtitle_warning=>Some(captured.subtitle_message.clone().filter(|s|!s.is_empty()).unwrap_or_else(||"O vídeo foi salvo, mas não foi possível obter a legenda. Tente baixar a aula novamente.".into())),Ok(0) if captured.subtitle_available==0=>Some("A plataforma não ofereceu legenda nesta captura.".into()),_=>None}};
            if let Ok(mut job)=JOB.lock(){if let Some(j)=job.as_mut(){j.warning=warning;}}
            update("finishing",None);Ok(())
        };
        let outcome=run();
        // Commit history before exposing a terminal state to the course queue.
        if let Ok(mut state)=JOB.lock(){if let Some(job)=state.as_mut().filter(|job|job.id==id){
            match outcome {Ok(())=>job.status="completed".into(),Err(error)=>{job.status=if job.cancel{"canceled"}else{"failed"}.into();job.error=Some(error);}}
            if let Ok(db)=rusqlite::Connection::open(database) {
                let source=if materials_only{format!("materials:{lesson_id}")}else if subtitles_only{format!("subtitles:{lesson_id}")}else{lesson_id};
                if db.execute("INSERT OR REPLACE INTO downloads(id,title,platform,status,created_at,local_path,bytes_done,source_id,course_title) VALUES (?1,?2,?3,?4,datetime('now'),?5,?6,?7,?8)",rusqlite::params![job.id,job.title,inventory.platform,job.status,job.path,job.bytes,source,inventory.title]).is_err(){job.error=Some("Não foi possível atualizar o histórico local.".into());}
            }
        }}
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_lesson_names_and_avoids_overwriting_collisions() {
        assert_eq!(safe_name("Aula 1 — Introdução"),"Aula 1 — Introdução");
        assert_eq!(safe_name("../CON.txt"),"-CON.txt");
        assert_eq!(safe_name("CON.txt"),"_CON.txt");
        let root=std::env::temp_dir().join(format!("vodown-path-{}",std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("Aula 1.mp4"),b"existing").unwrap();
        assert_eq!(output_path(&root,"Aula 1"),root.join("Aula 1 (2).mp4"));
        assert_eq!(std::fs::read(root.join("Aula 1.mp4")).unwrap(),b"existing");
        let _=std::fs::remove_dir_all(root);
    }
    #[test]
    fn saves_subtitles_next_to_video_without_overwriting_existing_files() {
        let root=std::env::temp_dir().join(format!("vodown-captions-{}",std::process::id()));std::fs::create_dir_all(&root).unwrap();
        let video=root.join("Aula 1.mp4");std::fs::write(&video,b"video").unwrap();
        let captions=vec![Caption{language:"pt-BR".into(),format:"srt".into(),text:"1\n00:00:01,000 --> 00:00:02,000\nOlá\n".into()}];
        assert_eq!(save_captions(&video,&captions).unwrap(),1);
        assert!(root.join("Aula 1.pt-BR.srt").is_file());
        assert_eq!(std::fs::read(&video).unwrap(),b"video");
        std::fs::write(root.join("Aula 1.pt-BR.srt"),b"existing").unwrap();save_captions(&video,&captions).unwrap();
        assert_eq!(std::fs::read(root.join("Aula 1.pt-BR.srt")).unwrap(),b"existing");
        let _=std::fs::remove_dir_all(root);
    }
    #[test]
    fn accepts_supported_https_capture_origins_only() {
        assert!(valid_url("https://stream.mux.com/id.m3u8?token=transient"));
        assert!(valid_url("https://example.play.hotmart.com/lesson.mp4"));
        for url in ["http://stream.mux.com/x","https://127.0.0.1/x","file:///etc/passwd","https://mux.com.evil.test/x","https://secret@stream.mux.com/x"] {assert!(!valid_url(url));}
    }
}
