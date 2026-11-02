use aes_gcm::{aead::{KeyInit, OsRng}, Aes256Gcm};
use rusqlite::{Connection, OptionalExtension};
use std::sync::Mutex;
use tauri::Manager;
use crate::session_cipher::{encrypt, decrypt, FAILURE};

static STORAGE_LOCK: Mutex<()> = Mutex::new(());
const SERVICE: &str = "com.vodown.desktop.supabase";

fn validate_key(key: &str) -> Result<(), String> {
    if !key.starts_with("sb-") || key.len() > 200 || key.chars().any(char::is_control) {
        return Err("Chave de sessão inválida.".into());
    }
    Ok(())
}
fn credential(key: &str, encryption: bool) -> Result<keyring::Entry, String> {
    validate_key(key)?;
    let account = if encryption { format!("{key}:encryption-v1") } else { key.to_string() };
    keyring::Entry::new(SERVICE, &account).map_err(|_| FAILURE.to_string())
}
fn encryption_key(key: &str, create: bool) -> Result<Vec<u8>, String> {
    let entry = credential(key, true)?;
    match entry.get_secret() {
        Ok(value) if value.len() == 32 => Ok(value),
        Err(keyring::Error::NoEntry) if create => {
            let value = Aes256Gcm::generate_key(OsRng).to_vec();
            entry.set_secret(&value).map_err(|_| FAILURE.to_string())?;
            Ok(value)
        }
        _ => Err(FAILURE.into()),
    }
}
fn save(db: &Connection, key: &str, value: &str) -> Result<(), String> {
    if value.len() > 1_048_576 { return Err("Sessão maior que o limite permitido.".into()); }
    let encrypted = encrypt(&encryption_key(key, true)?, key, value)?;
    db.execute("INSERT INTO sessions(account,ciphertext) VALUES (?1,?2) ON CONFLICT(account) DO UPDATE SET ciphertext=excluded.ciphertext",
        rusqlite::params![key, encrypted]).map_err(|_| FAILURE.to_string())?;
    Ok(())
}
fn remove_credential(entry: keyring::Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(FAILURE.into()),
    }
}
// Blocking keychain/SQLite operations run off the async executor. Serialization
// prevents concurrent writes from replacing the encryption key mid-operation.
async fn access<T: Send + 'static>(app: tauri::AppHandle, operation: impl FnOnce(Connection) -> Result<T,String> + Send + 'static) -> Result<T,String> {
    let path = app.path().app_data_dir().map_err(|_| FAILURE.to_string())?.join("sessions.sqlite3");
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORAGE_LOCK.lock().map_err(|_| FAILURE.to_string())?;
        let db = Connection::open(path).map_err(|_| FAILURE.to_string())?;
        db.execute_batch("PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS sessions (account TEXT PRIMARY KEY, ciphertext BLOB NOT NULL);").map_err(|_| FAILURE.to_string())?;
        operation(db)
    }).await.map_err(|_| FAILURE.to_string())?
}
#[tauri::command]
pub async fn get_session(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    validate_key(&key)?;
    access(app, move |db| {
        let encrypted: Option<Vec<u8>> = db.query_row("SELECT ciphertext FROM sessions WHERE account=?1", [&key], |row| row.get(0)).optional().map_err(|_| FAILURE.to_string())?;
        if let Some(value) = encrypted { return decrypt(&encryption_key(&key, false)?, &key, &value).map(Some); }
        // Migrate the initial direct-keyring implementation without losing login.
        match credential(&key, false)?.get_password() {
            Ok(value) => { save(&db, &key, &value)?; remove_credential(credential(&key,false)?)?; Ok(Some(value)) }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(FAILURE.into()),
        }
    }).await
}
#[tauri::command]
pub async fn set_session(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    validate_key(&key)?;
    access(app, move |db| {save(&db, &key, &value)?; remove_credential(credential(&key,false)?) }).await
}
#[tauri::command]
pub async fn remove_session(app: tauri::AppHandle, key: String) -> Result<(), String> {
    validate_key(&key)?;
    access(app, move |db| {
        db.execute("DELETE FROM sessions WHERE account=?1", [&key]).map_err(|_| FAILURE.to_string())?;
        remove_credential(credential(&key, true)?)?;
        remove_credential(credential(&key, false)?)
    }).await
}
#[cfg(test)]
mod tests {
    use super::validate_key;
    #[test]
    fn rejects_unrelated_or_invalid_storage_keys() {
        assert!(validate_key("other-service").is_err());
        assert!(validate_key("sb-\ninvalid").is_err());
        assert!(validate_key(&format!("sb-{}", "x".repeat(200))).is_err());
    }
}
