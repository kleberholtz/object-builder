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
            commands::create_project,
            commands::update_thing,
            commands::duplicate_thing,
            commands::delete_things,
            commands::undo,
            commands::redo,
            commands::save_project_manifest,
            commands::inspect_client,
            commands::load_client_directory,
            commands::list_objects,
            commands::validate_workspace,
            commands::get_sprite,
            commands::get_object_dimensions,
            commands::get_object_image,
            commands::export_object,
            commands::import_object,
            commands::export_png,
            commands::import_png,
        ]);
    if let Err(error) = application.run(tauri::generate_context!()) {
        eprintln!("Object Builder failed to start: {error}");
    }
}
