use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;
use tauri::Manager;

pub fn initialize(path: &Path) -> Result<(), rusqlite::Error> {
    let connection = Connection::open(path)?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS downloads (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL,
           platform TEXT NOT NULL,
           status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','canceled')),
           created_at TEXT NOT NULL,
           local_path TEXT
         );
         PRAGMA user_version=1;",
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRecord {
    id: String,
    title: String,
    platform: String,
    status: String,
    created_at: String,
}

#[tauri::command]
pub fn download_history(app: tauri::AppHandle) -> Result<Vec<DownloadRecord>, String> {
    let path = app.path().app_data_dir().map_err(|_| "Não foi possível abrir o histórico.")?.join("vodown.sqlite3");
    read(&path).map_err(|_| "Não foi possível ler o histórico local.".to_string())
}

fn read(path: &Path) -> Result<Vec<DownloadRecord>, rusqlite::Error> {
    let connection = Connection::open(path)?;
    let mut statement = connection.prepare("SELECT id, title, platform, status, created_at FROM downloads ORDER BY created_at DESC LIMIT 200")?;
    let records = statement.query_map([], |row| Ok(DownloadRecord {
        id: row.get(0)?, title: row.get(1)?, platform: row.get(2)?, status: row.get(3)?, created_at: row.get(4)?,
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
        connection.execute("INSERT OR REPLACE INTO downloads VALUES (?1,?2,?3,?4,?5,NULL)", ["test", "Aula teste", "whop", "completed", "2026-10-22T00:00:00Z"]).unwrap();
        let rows = read(&path).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Aula teste");
        assert!(connection.execute("INSERT INTO downloads VALUES ('bad','x','whop','invalid','now',NULL)", []).is_err());
        drop(connection);
        let _ = std::fs::remove_file(path);
    }
}
