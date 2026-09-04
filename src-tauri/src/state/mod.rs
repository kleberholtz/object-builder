use crate::{
    core::models::ObjectDatabase,
    history::EditorHistory,
    sprites::{SpriteCache, SpriteSource},
};
use std::sync::Mutex;

pub struct WorkspaceState {
    pub database: ObjectDatabase,
    pub history: EditorHistory,
    pub dirty: bool,
    pub project_name: String,
    pub dat_file: String,
    pub spr_file: String,
    pub sprite_count: u32,
    pub sprite_source: Option<SpriteSource>,
    pub sprite_cache: SpriteCache,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            database: ObjectDatabase::demo(),
            history: EditorHistory::new(64),
            dirty: false,
            project_name: "Elderan Chronicles".into(),
            dat_file: "Tibia.dat".into(),
            spr_file: "Tibia.spr".into(),
            sprite_count: 89_412,
            sprite_source: None,
            sprite_cache: SpriteCache::new(48 * 1024 * 1024),
        }
    }
}

#[derive(Default)]
pub struct AppState(pub Mutex<WorkspaceState>);
