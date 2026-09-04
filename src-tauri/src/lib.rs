mod commands;
mod core;
mod formats;
mod history;
mod project;
mod sprites;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_workspace_snapshot,
            commands::update_thing,
            commands::undo,
            commands::redo,
            commands::save_project_manifest,
            commands::inspect_client,
            commands::load_client_directory,
            commands::list_objects,
            commands::get_sprite,
        ]);
    if let Err(error) = application.run(tauri::generate_context!()) {
        eprintln!("Object Builder failed to start: {error}");
    }
}
