use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;
use std::path::Path;
use tauri::Manager;

pub fn initialize(path: &Path) -> Result<(), rusqlite::Error> {
    let mut connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: i64 = transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    // Never downgrade a database created by a newer application.
    if version > 2 { return Err(rusqlite::Error::InvalidQuery); }
    if version == 0 {
        transaction.execute_batch("CREATE TABLE IF NOT EXISTS downloads (
           id TEXT PRIMARY KEY, title TEXT NOT NULL, platform TEXT NOT NULL,
           status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','canceled')),
           created_at TEXT NOT NULL, local_path TEXT
        ); PRAGMA user_version=1;")?;
    }
    if version < 2 {
        transaction.execute_batch("CREATE TABLE downloads_v2 (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, platform TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued','running','processing','waiting_capture','completed','failed','canceled')),
          created_at TEXT NOT NULL, local_path TEXT, account_id TEXT,
          course_title TEXT, source_id TEXT, bytes_done INTEGER NOT NULL DEFAULT 0 CHECK(bytes_done >= 0),
          bytes_total INTEGER CHECK(bytes_total IS NULL OR bytes_total >= 0),
          updated_at TEXT, error_code TEXT
        );
        INSERT INTO downloads_v2(id,title,platform,status,created_at,local_path)
          SELECT id,title,platform,status,created_at,local_path FROM downloads;
        DROP TABLE downloads;
        ALTER TABLE downloads_v2 RENAME TO downloads;
        PRAGMA user_version=2;")?;
    }
    // Captures are intentionally transient: no stale playback URLs are persisted.
    transaction.execute("UPDATE downloads SET status='waiting_capture' WHERE status IN ('queued','running','processing')", [])?;
    transaction.commit()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    id: String,
    title: String,
    platform: String,
    status: String,
    created_at: String,
    local_path: Option<String>,
    course_title: Option<String>,
}

#[tauri::command]
pub fn download_history(app: tauri::AppHandle) -> Result<Vec<DownloadRecord>, String> {
    let path = app.path().app_data_dir().map_err(|_| "Não foi possível abrir o histórico.")?.join("vodown.sqlite3");
    read(&path).map_err(|_| "Não foi possível ler o histórico local.".to_string())
}

fn read(path: &Path) -> Result<Vec<DownloadRecord>, rusqlite::Error> {
    let connection = Connection::open(path)?;
    let mut statement = connection.prepare("SELECT id, title, platform, status, created_at, local_path, course_title FROM downloads ORDER BY created_at DESC LIMIT 200")?;
    let records = statement.query_map([], |row| Ok(DownloadRecord {
        id: row.get(0)?, title: row.get(1)?, platform: row.get(2)?, status: row.get(3)?, created_at: row.get(4)?, local_path:row.get(5)?,course_title:row.get(6)?,
    }))?.collect();
    records
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn initializes_idempotently_and_reads_persisted_history() {
        let path = std::env::temp_dir().join(format!("vodown-history-{}.sqlite3", std::process::id()));
        initialize(&path).unwrap();
        initialize(&path).unwrap();
        let connection = Connection::open(&path).unwrap();
        connection.execute("INSERT OR REPLACE INTO downloads(id,title,platform,status,created_at) VALUES (?1,?2,?3,?4,?5)", ["test", "Aula teste", "whop", "completed", "2026-10-22T00:00:00Z"]).unwrap();
        let rows = read(&path).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Aula teste");
        assert!(connection.execute("INSERT INTO downloads(id,title,platform,status,created_at) VALUES ('bad','x','whop','invalid','now')", []).is_err());
        drop(connection);
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn migrates_version_one_and_recovers_interrupted_jobs() {
        let path = std::env::temp_dir().join(format!("vodown-migrate-{}.sqlite3", std::process::id()));
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE downloads(id TEXT PRIMARY KEY,title TEXT NOT NULL,platform TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,local_path TEXT);
          INSERT INTO downloads VALUES ('old','Aula','whop','completed','2026-01-01','/tmp/a.mp4');
          INSERT INTO downloads VALUES ('active','Outra','hotmart','running','2026-01-02',NULL);
          PRAGMA user_version=1;").unwrap();
        drop(connection);
        initialize(&path).unwrap(); initialize(&path).unwrap();
        let connection = Connection::open(&path).unwrap();
        let version: i64 = connection.pragma_query_value(None,"user_version",|r|r.get(0)).unwrap();
        assert_eq!(version,2);
        let old: (String,String) = connection.query_row("SELECT status,local_path FROM downloads WHERE id='old'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(old,("completed".into(),"/tmp/a.mp4".into()));
        let active: String = connection.query_row("SELECT status FROM downloads WHERE id='active'",[],|r|r.get(0)).unwrap();
        assert_eq!(active,"waiting_capture");
        connection.pragma_update(None,"user_version",3).unwrap();
        drop(connection);
        assert!(initialize(&path).is_err());
        assert_eq!(Connection::open(&path).unwrap().pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),3);
        let _ = std::fs::remove_file(path);
    }
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SavedLesson {lesson_id:String,record_id:Option<String>}
fn existing_video(root:&Path,path:&Path)->bool {
    path.is_file() && path.extension().is_some_and(|e|e.eq_ignore_ascii_case("mp4")) && path.canonicalize().ok().zip(root.canonicalize().ok()).is_some_and(|(file,root)|file.starts_with(root))
}
pub(crate) fn saved_path(app:&tauri::AppHandle,lesson_id:&str)->Result<(std::path::PathBuf,Option<String>),String> {
    let inventory=crate::pairing::bridge_inventory().ok_or("Atualize as aulas do curso.")?;
    let lesson=inventory.lessons.iter().find(|l|l.id==lesson_id).ok_or("Aula não encontrada.")?;
    let root=app.path().download_dir().map_err(|_|"Pasta indisponível")?.join("Vodown");
    let database=app.path().app_data_dir().map_err(|_|"Histórico indisponível")?.join("vodown.sqlite3");
    let db=Connection::open(database).map_err(|_|"Histórico indisponível")?;
    let mut statement=db.prepare("SELECT local_path,id FROM downloads WHERE source_id=?1 AND course_title=?2 AND platform=?3 AND status='completed' AND local_path IS NOT NULL ORDER BY created_at DESC").map_err(|_|"Histórico indisponível")?;
    let rows=statement.query_map(rusqlite::params![lesson_id,inventory.title,inventory.platform],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|_|"Histórico indisponível")?;
    for row in rows.flatten(){let file=std::path::PathBuf::from(row.0);if existing_video(&root,&file){return Ok((file,Some(row.1)));}}
    // Hotmart lesson URLs identify the source even if the displayed course title changed.
    if inventory.platform=="hotmart" && lesson_id.starts_with("https://hotmart.com/") && inventory.lessons.iter().filter(|l|l.id==lesson_id).count()==1 {
        let mut legacy=db.prepare("SELECT local_path,id FROM downloads WHERE source_id=?1 AND platform='hotmart' AND status='completed' AND local_path IS NOT NULL ORDER BY created_at DESC").map_err(|_|"Histórico indisponível")?;
        let rows=legacy.query_map([lesson_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|_|"Histórico indisponível")?;
        for row in rows.flatten(){let file=std::path::PathBuf::from(row.0);if existing_video(&root,&file){return Ok((file,Some(row.1)));}}
    }
    // Also recognize files downloaded before source identifiers were recorded.
    let name=format!("{}.mp4",crate::download_engine::safe_name(&lesson.title));
    let file=crate::pairing::lesson_directory(&root,&inventory,lesson).join(&name);
    if inventory.lessons.iter().filter(|l|l.title==lesson.title&&l.module==lesson.module&&l.track_id==lesson.track_id).count()==1 && existing_video(&root,&file){return Ok((file,None));}
    // Files from earlier versions had no track directory; use them only when unambiguous.
    let legacy=root.join(crate::download_engine::safe_name(&inventory.title)).join(crate::download_engine::safe_name(&lesson.module)).join(name);
    if inventory.lessons.iter().filter(|l|l.title==lesson.title&&l.module==lesson.module).count()==1 && existing_video(&root,&legacy){return Ok((legacy,None));}
    Err("O arquivo desta aula não foi encontrado. Baixe novamente.".into())
}
#[tauri::command]
pub fn downloaded_lessons(app:tauri::AppHandle)->Result<Vec<SavedLesson>,String> {
    let inventory=crate::pairing::bridge_inventory().ok_or("Atualize as aulas do curso.")?;
    Ok(inventory.lessons.iter().filter_map(|lesson|saved_path(&app,&lesson.id).ok().map(|(_,record_id)|SavedLesson{lesson_id:lesson.id.clone(),record_id})).collect())
}
#[tauri::command]
pub fn open_lesson_folder(app:tauri::AppHandle,lesson_id:String)->Result<(),String> {
    use tauri_plugin_opener::OpenerExt;
    let (path,_)=saved_path(&app,&lesson_id)?;
    app.opener().reveal_item_in_dir(path).map_err(|_|"Não foi possível abrir a pasta da aula.".into())
}

#[cfg(test)]
mod saved_file_tests {
    use super::*;
    #[test]
    fn only_existing_videos_inside_the_destination_are_downloaded() {
        let root=std::env::temp_dir().join(format!("vodown-saved-{}",std::process::id()));
        std::fs::create_dir_all(root.join("Curso/Módulo")).unwrap();
        let video=root.join("Curso/Módulo/Aula.mp4");std::fs::write(&video,b"fixture").unwrap();
        assert!(existing_video(&root,&video));
        assert!(!existing_video(&root,&root.join("Curso/Módulo")));
        assert!(!existing_video(&root.join("different"),&video));
        std::fs::remove_file(&video).unwrap();assert!(!existing_video(&root,&video));
        let _=std::fs::remove_dir_all(root);
    }
}

#[tauri::command]
pub fn open_download_folder(app:tauri::AppHandle,id:String)->Result<(),String> {
    use tauri_plugin_opener::OpenerExt;
    let db=Connection::open(app.path().app_data_dir().map_err(|_|"Histórico indisponível")?.join("vodown.sqlite3")).map_err(|_|"Histórico indisponível")?;
    let file:String=db.query_row("SELECT local_path FROM downloads WHERE id=?1 AND status='completed'",[id],|r|r.get(0)).map_err(|_|"Arquivo não encontrado")?;
    let path=std::path::PathBuf::from(file);
    let root=app.path().download_dir().map_err(|_|"Pasta indisponível")?.join("Vodown");
    if !existing_video(&root,&path){return Err("O arquivo não está mais na pasta de download.".into());}
    app.opener().reveal_item_in_dir(path).map_err(|_|"Não foi possível abrir a pasta.".into())
}
