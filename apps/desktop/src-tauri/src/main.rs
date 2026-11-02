#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod material_writer;
mod history;
mod native_protocol;
mod local_bridge;
mod pairing;
mod path_parts;
mod download_engine;
mod secure_storage;
mod session_cipher;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            history::initialize(&directory.join("vodown.sqlite3"))?;
            pairing::set_material_root(app.path().download_dir()?.join("Vodown"));
            #[cfg(unix)]
            local_bridge::start(&directory)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![download_engine::native_download,download_engine::native_download_status,download_engine::native_download_cancel,pairing::bridge_pending,pairing::bridge_connected,pairing::bridge_accept,pairing::bridge_reset,pairing::bridge_inventory,history::downloaded_lessons,history::open_lesson_folder,history::download_history,history::open_download_folder, secure_storage::get_session, secure_storage::set_session, secure_storage::remove_session])
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o Vodown");
}
