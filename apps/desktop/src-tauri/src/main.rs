#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod history;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            history::initialize(&directory.join("vodown.sqlite3"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![history::download_history])
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o Vodown");
}
