use std::sync::Mutex;
use serde::{Deserialize,Serialize};
use aes_gcm::aead::{rand_core::RngCore,OsRng};

#[derive(Default)]
pub struct Bridge { pending:Option<Pending>, approved:Option<(String,String)>, inventory:Option<Inventory>, capture_request:Option<(String,String,String,String)>, capture:Option<Result<String,String>> }
static READING_DIAGNOSTIC:Mutex<Option<String>>=Mutex::new(None);
pub(crate) fn reading_diagnostic()->Option<String>{READING_DIAGNOSTIC.lock().ok()?.clone()}
static MATERIAL_ROOT:Mutex<Option<std::path::PathBuf>>=Mutex::new(None);
pub fn set_material_root(path:std::path::PathBuf){if let Ok(mut root)=MATERIAL_ROOT.lock(){*root=Some(path);}}
static BRIDGE:Mutex<Bridge>=Mutex::new(Bridge{pending:None,approved:None,inventory:None,capture_request:None,capture:None});
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Pending {nonce:String,access_token:String,#[serde(skip)] created:Option<std::time::Instant>}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Lesson {pub id:String,pub title:String,#[serde(default="default_module")]pub module:String,#[serde(default)]pub module_index:u32,#[serde(default)]pub index:u32,#[serde(default)]pub track_id:String,#[serde(default)]pub track_title:String,#[serde(default)]pub track_index:u32}
fn default_module()->String {"Aulas".into()}
pub(crate) fn lesson_directory(root:&std::path::Path,inventory:&Inventory,lesson:&Lesson)->std::path::PathBuf {
    let mut path=root.join(crate::path_parts::safe_name(&inventory.title));
    if !lesson.track_title.is_empty(){path=path.join(crate::path_parts::safe_name(&lesson.track_title));}
    path.join(crate::path_parts::safe_name(&lesson.module))
}
fn legacy_material_exists(root:&std::path::Path,inventory:&Inventory,lesson:&Lesson,name:&str)->bool {
    if lesson.track_title.is_empty() || inventory.lessons.iter().filter(|l|l.title==lesson.title&&l.module==lesson.module).count()!=1 {return false;}
    let old=root.join(crate::path_parts::safe_name(&inventory.title)).join(crate::path_parts::safe_name(&lesson.module)).join("Materiais").join(crate::path_parts::safe_name(&lesson.title)).join(crate::path_parts::safe_name(name));
    old.is_file() && old.canonicalize().ok().zip(root.canonicalize().ok()).is_some_and(|(file,root)|file.starts_with(root))
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Inventory {#[serde(default)]pub capabilities:Vec<String>,#[serde(default)]pub course_key:String,pub title:String,pub platform:String,#[serde(default)]pub track_discovery_incomplete:bool,#[serde(default)]pub failed_tracks:Vec<String>,#[serde(default)]pub total_tracks:u32,pub lessons:Vec<Lesson>}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Request {version:u32,request_id:String,#[serde(rename="type")]kind:String,nonce:Option<String>,access_token:Option<String>,pair_token:Option<String>,inventory:Option<Inventory>,capture_id:Option<String>,url:Option<String>,failed:Option<bool>,lesson_id:Option<String>,material_name:Option<String>,failure_code:Option<String>,offset:Option<u64>,data:Option<Vec<u8>>,size:Option<u64>,diagnostic:Option<String>}
fn secret()->String {let mut b=[0u8;32];OsRng.fill_bytes(&mut b);b.iter().map(|b|format!("{b:02x}")).collect()}
fn safe(s:&str,max:usize)->bool {!s.is_empty() && s.len()<=max && !s.chars().any(char::is_control)}
pub fn handle(bytes:&[u8])->Option<Vec<u8>> {
    let r:Request=serde_json::from_slice(bytes).ok()?;
    if !matches!(r.kind.as_str(),"pair"|"pair_status"|"inventory"|"capture_poll"|"capture_result"|"material_exists"|"material_begin"|"material_chunk"|"material_end"|"reading_diagnostic") {return None;}
    let mut state=BRIDGE.lock().ok()?;
    if state.pending.as_ref().is_some_and(|p|p.created.is_none_or(|t|t.elapsed().as_secs()>120)) {state.pending=None;}
    let mut code="invalid_message";let mut token=None;let mut capture_request=None;let mut exists=None;
    if r.version==1 && safe(&r.request_id,128) {
        match r.kind.as_str() {
            "pair"=> {
                if let (Some(nonce),Some(access_token))=(r.nonce,r.access_token) {
                    if safe(&nonce,128) && safe(&access_token,16384) {
                        if state.pending.is_none() {state.pending=Some(Pending{nonce,access_token,created:Some(std::time::Instant::now())});code="pair_pending";}
                        else {code="pair_busy";}
                    }
                }
            },
            "reading_diagnostic"=> {
                code="pair_required";
                if state.approved.as_ref().is_some_and(|(_,token)|Some(token)==r.pair_token.as_ref()) {
                    if let Some(value)=r.diagnostic.filter(|v|safe(v,10000)){if let Ok(mut latest)=READING_DIAGNOSTIC.lock(){*latest=Some(value);code="diagnostic_received";}}
                }
            },
            "pair_status"=> {
                code="pair_pending";
                if let Some((nonce,value))=&state.approved {if Some(nonce)==r.nonce.as_ref(){code="paired";token=Some(value.clone());}}
            },
            "capture_poll"|"capture_result"=> {
                code="pair_required";
                if state.approved.as_ref().is_some_and(|(_,token)|Some(token)==r.pair_token.as_ref()) {
                    if r.kind=="capture_poll" {code="capture_poll";capture_request=state.capture_request.clone();}
                    else if state.capture_request.as_ref().is_some_and(|(id,_,_,_)|Some(id)==r.capture_id.as_ref()) {
                        state.capture=Some(if r.failed==Some(true){Err(match r.failure_code.as_deref(){Some("course_changed")=>"O curso ativo no Chrome mudou. Volte ao curso listado no desktop e atualize as aulas.",Some("lesson_not_found")=>"A aula não está mais na lista da extensão. Atualize as aulas no desktop e no Chrome.",Some("unsupported_capture")=>"Atualize a extensão Vodown para baixar materiais e legendas.",Some("material_not_started")=>"A plataforma não iniciou o arquivo do material. Atualize a extensão e tente novamente.",Some("material_changed")=>"A lista de materiais mudou. Atualize a aula e tente novamente.",Some("material_interrupted")=>"O Chrome interrompeu o download do material.",Some("material_failed")=>"Não foi possível baixar o material. Consulte a mensagem no painel da extensão.",_=>"Não foi possível capturar esta aula na extensão."}.into())}else{r.url.filter(|u|safe(u,500000)).ok_or("Captura inválida.".into())});
                        crate::material_writer::cancel();state.capture_request=None;code="capture_received";
                    }
                }
            },
            "material_begin"|"material_chunk"|"material_end"=> {
                code="pair_required";
                if state.approved.as_ref().is_some_and(|(_,token)|Some(token)==r.pair_token.as_ref()) && state.capture_request.as_ref().is_some_and(|(id,_,kind,_)|Some(id)==r.capture_id.as_ref()&&kind=="materials") {
                    code="material_write_failed";
                    if let Some(job)=r.capture_id.as_deref(){
                        if r.kind=="material_chunk" {if let (Some(offset),Some(data))=(r.offset,r.data){if crate::material_writer::chunk(job,offset,&data).is_ok(){code="material_chunk_received";}}}
                        else if r.kind=="material_end" {if let Some(size)=r.size{if crate::material_writer::finish(job,size).is_ok(){code="material_saved";}}}
                        else if let (Some(inventory),Some(name),Ok(root))=(&state.inventory,&r.material_name,MATERIAL_ROOT.lock()) {
                            if let (Some(root),Some((_,lesson_id,_,_)))=(root.as_ref(),state.capture_request.as_ref()) {
                                if let Some(lesson)=inventory.lessons.iter().find(|l|&l.id==lesson_id){
                                    let directory=lesson_directory(root,inventory,lesson).join("Materiais").join(crate::path_parts::safe_name(&lesson.title));
                                    if safe(name,500){if legacy_material_exists(root,inventory,lesson,name){code="material_skipped";}else if let Ok(value)=crate::material_writer::begin(root,&directory,name,job){code=value;}}
                                }
                            }
                        }
                    }
                }
            },
            "material_exists"=> {
                code="pair_required";
                if state.approved.as_ref().is_some_and(|(_,token)|Some(token)==r.pair_token.as_ref()) {
                    if let (Some(inventory),Some(lesson_id),Some(name),Ok(root))=(&state.inventory,&r.lesson_id,&r.material_name,MATERIAL_ROOT.lock()) {
                        if safe(name,500) {if let (Some(root),Some(lesson))=(root.as_ref(),inventory.lessons.iter().find(|l|&l.id==lesson_id)) {
                            let path=lesson_directory(root,inventory,lesson).join("Materiais").join(crate::path_parts::safe_name(&lesson.title)).join(crate::path_parts::safe_name(name));
                            exists=Some(legacy_material_exists(root,inventory,lesson,name) || path.is_file() && path.canonicalize().ok().zip(root.canonicalize().ok()).is_some_and(|(file,root)|file.starts_with(root)));code="material_checked";
                        }}
                    }
                }
            },
            "inventory"=> {
                code="pair_required";
                if state.approved.as_ref().is_some_and(|(_,token)|Some(token)==r.pair_token.as_ref()) {
                    if let Some(inventory)=r.inventory {
                        if safe(&inventory.title,500) && ["whop","hotmart","kiwify"].contains(&inventory.platform.as_str()) && inventory.lessons.len()<=2000 && inventory.failed_tracks.len()<=100 && inventory.failed_tracks.iter().all(|t|safe(t,500)) && inventory.lessons.iter().all(|l|safe(&l.id,500)&&safe(&l.title,1000)&&safe(&l.module,500)&&(l.track_id.is_empty()||safe(&l.track_id,200))&&(l.track_title.is_empty()||safe(&l.track_title,500))) {state.inventory=Some(inventory);code="inventory_received";}
                        else {code="invalid_inventory";}
                    }
                }
            },_=>()
        }
    }
    serde_json::to_vec(&serde_json::json!({"version":1,"requestId":r.request_id,"type":r.kind,"code":code,"pairToken":token,"captureRequest":capture_request,"exists":exists})).ok()
}
pub fn request_capture(id:String,lesson:String)->Result<(),String> {request_capture_kind(id,lesson,"video".into())}
pub fn request_capture_kind(id:String,lesson:String,kind:String)->Result<(),String> {
    let mut state=BRIDGE.lock().map_err(|_|"Conexão indisponível")?;
    if state.approved.is_none() || !state.inventory.as_ref().is_some_and(|i|i.lessons.iter().any(|l|l.id==lesson)){return Err("Conecte a extensão e atualize as aulas.".into());}
    let course=state.inventory.as_ref().map(|i|i.course_key.clone()).unwrap_or_default();state.capture=None;state.capture_request=Some((id,lesson,kind,course));Ok(())
}
pub fn cancel_capture(){crate::material_writer::cancel();if let Ok(mut state)=BRIDGE.lock(){state.capture_request=None;state.capture=None;}}
pub fn take_capture()->Option<Result<String,String>> {BRIDGE.lock().ok()?.capture.take()}
#[tauri::command]
pub fn bridge_pending()->Option<Pending> {let mut state=BRIDGE.lock().ok()?;if state.pending.as_ref().is_some_and(|p|p.created.is_none_or(|t|t.elapsed().as_secs()>120)){state.pending=None;}state.pending.clone()}
#[tauri::command]
pub fn bridge_accept(nonce:String)->Result<(),String> {let mut state=BRIDGE.lock().map_err(|_|"Conexão indisponível")?;if !state.pending.as_ref().is_some_and(|p|p.nonce==nonce&&p.created.is_some_and(|t|t.elapsed().as_secs()<=120)){return Err("Solicitação expirada".into());}state.approved=Some((nonce,secret()));state.pending=None;Ok(())}
#[tauri::command]
pub fn bridge_reset() {crate::material_writer::cancel();if let Ok(mut state)=BRIDGE.lock(){*state=Bridge::default();}}
#[tauri::command]
pub fn bridge_connected()->bool {connection_state().1}
pub(crate) fn connection_state()->(bool,bool) {BRIDGE.lock().map(|state|(state.pending.is_some(),state.approved.is_some())).unwrap_or((false,false))}
#[tauri::command]
pub fn bridge_inventory()->Option<Inventory> {BRIDGE.lock().ok()?.inventory.clone()}

#[cfg(test)]
pub static TEST_LOCK:Mutex<()>=Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;
    fn request(value:serde_json::Value)->serde_json::Value {serde_json::from_slice(&handle(&serde_json::to_vec(&value).unwrap()).unwrap()).unwrap()}
    #[test]
    fn track_destinations_preserve_legacy_materials_without_mixing_tracks() {
        let root=std::env::temp_dir().join(format!("vodown-track-path-{}",std::process::id()));
        let inventory:Inventory=serde_json::from_value(serde_json::json!({"title":"Curso","platform":"hotmart","lessons":[{"id":"a","title":"Aula","module":"Módulo","trackId":"x","trackTitle":"Trilha"}]})).unwrap();
        let lesson=&inventory.lessons[0];
        assert_eq!(lesson_directory(&root,&inventory,lesson),root.join("Curso/Trilha/Módulo"));
        let legacy=root.join("Curso/Módulo/Materiais/Aula");std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("Arquivo.pdf"),b"fixture").unwrap();
        assert!(legacy_material_exists(&root,&inventory,lesson,"Arquivo.pdf"));
        assert!(!legacy_material_exists(&root,&inventory,lesson,"Ausente.pdf"));
        let _=std::fs::remove_dir_all(root);
    }
    #[test]
    fn inventory_requires_explicit_approval_and_is_revoked() {
        let _guard=TEST_LOCK.lock().unwrap();
        bridge_reset();
        let inventory=serde_json::json!({"title":"Curso autorizado","platform":"whop","lessons":[{"id":"aula-1","title":"Introdução"}]});
        let denied=request(serde_json::json!({"version":1,"requestId":"1","type":"inventory","pairToken":"forged","inventory":inventory}));
        assert_eq!(denied["code"],"pair_required");
        assert!(bridge_inventory().is_none());
        let pair=request(serde_json::json!({"version":1,"requestId":"2","type":"pair","nonce":"random-request","accessToken":"transient-token"}));
        assert_eq!(pair["code"],"pair_pending");
        assert!(bridge_accept("wrong".into()).is_err());
        bridge_accept("random-request".into()).unwrap();
        let status=request(serde_json::json!({"version":1,"requestId":"3","type":"pair_status","nonce":"random-request"}));
        assert_eq!(status["code"],"paired");
        let token=status["pairToken"].as_str().unwrap();
        assert_eq!(token.len(),64);
        let received=request(serde_json::json!({"version":1,"requestId":"4","type":"inventory","pairToken":token,"inventory":inventory}));
        assert_eq!(received["code"],"inventory_received");
        assert_eq!(bridge_inventory().unwrap().lessons[0].title,"Introdução");
        let root=std::env::temp_dir().join(format!("vodown-material-check-{}",std::process::id()));
        let folder=root.join("Curso autorizado/Aulas/Materiais/Introdução");std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("Notas.pdf"),b"fixture").unwrap();set_material_root(root.clone());
        let check=|pair_token:&str,name:&str|request(serde_json::json!({"version":1,"requestId":"file-check","type":"material_exists","pairToken":pair_token,"lessonId":"aula-1","materialName":name}));
        assert_eq!(check(token,"Notas.pdf")["exists"],true);
        assert_eq!(check(token,"Ausente.pdf")["exists"],false);
        assert_eq!(check("forged","Notas.pdf")["code"],"pair_required");
        {
            let _writer_guard=crate::material_writer::TEST_LOCK.lock().unwrap();
            request_capture_kind("material-job".into(),"aula-1".into(),"materials".into()).unwrap();
            let write=|token:&str,kind:&str,extra:serde_json::Value| {
                let mut value=serde_json::json!({"version":1,"requestId":"write","type":kind,"pairToken":token,"captureId":"material-job"});
                for (key,item) in extra.as_object().unwrap(){value[key]=item.clone();}request(value)
            };
            assert_eq!(write("forged","material_begin",serde_json::json!({"materialName":"Novo.pdf"}))["code"],"pair_required");
            assert_eq!(write(token,"material_begin",serde_json::json!({"materialName":"Novo.pdf"}))["code"],"material_ready");
            assert_eq!(write(token,"material_chunk",serde_json::json!({"offset":0,"data":[37,80,68,70]}))["code"],"material_chunk_received");
            assert_eq!(write(token,"material_end",serde_json::json!({"size":4}))["code"],"material_saved");
            assert_eq!(std::fs::read(folder.join("Novo.pdf")).unwrap(),b"%PDF");
            assert_eq!(write(token,"material_begin",serde_json::json!({"materialName":"Novo.pdf"}))["code"],"material_skipped");
        }
        let _=std::fs::remove_dir_all(root);
        request_capture("job-1".into(),"aula-1".into()).unwrap();
        assert_eq!(request(serde_json::json!({"version":1,"requestId":"poll","type":"capture_poll","pairToken":token}))["captureRequest"],serde_json::json!(["job-1","aula-1","video",""]));
        request(serde_json::json!({"version":1,"requestId":"wrong","type":"capture_result","pairToken":token,"captureId":"other-job","url":"https://stream.mux.com/fixture.m3u8"}));
        assert!(take_capture().is_none());
        assert_eq!(request(serde_json::json!({"version":1,"requestId":"result","type":"capture_result","pairToken":token,"captureId":"job-1","url":"https://stream.mux.com/fixture.m3u8"}))["code"],"capture_received");
        assert_eq!(take_capture().unwrap().unwrap(),"https://stream.mux.com/fixture.m3u8");
        assert!(take_capture().is_none());
        // A browser reload can discard the session token. A fresh request must
        // still be confirmed by the desktop and replace the old credential.
        assert_eq!(request(serde_json::json!({"version":1,"requestId":"new-pair","type":"pair","nonce":"new-request","accessToken":"transient-token"}))["code"],"pair_pending");
        assert_eq!(check(token,"Notas.pdf")["code"],"material_checked");
        bridge_accept("new-request".into()).unwrap();
        assert_eq!(request(serde_json::json!({"version":1,"requestId":"new-status","type":"pair_status","nonce":"new-request"}))["code"],"paired");
        assert_eq!(check(token,"Notas.pdf")["code"],"pair_required");
        bridge_reset();
        assert!(bridge_inventory().is_none());
        assert_eq!(request(serde_json::json!({"version":1,"requestId":"5","type":"inventory","pairToken":token,"inventory":inventory}))["code"],"pair_required");
    }
}
