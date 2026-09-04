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
            commands::load_project_manifest,
            commands::update_thing,
            commands::duplicate_thing,
            commands::delete_things,
            commands::reorder_things,
            commands::apply_object_order,
            commands::apply_frame_order,
            commands::undo,
            commands::redo,
            commands::save_project_manifest,
            commands::save_client_files,
            commands::inspect_client,
            commands::detect_client_version,
            commands::load_client_directory,
            commands::list_objects,
            commands::get_object,
            commands::get_sprite_statistics,
            commands::get_sprite_usage,
            commands::get_object_sprites,
            commands::analyze_optimization,
            commands::optimize_project,
            commands::cancel_optimization,
            commands::path_exists,
            commands::get_memory_usage,
            commands::validate_workspace,
            commands::get_sprite,
            commands::get_object_dimensions,
            commands::get_object_image,
            commands::get_object_frame_layer,
            commands::write_object_frame_layer,
            commands::export_object,
            commands::import_object,
            commands::export_png,
            commands::import_png,
        ]);
    if let Err(error) = application.run(tauri::generate_context!()) {
        eprintln!("Object Builder failed to start: {error}");
    }
}
