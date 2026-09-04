use crate::{
    core::models::ObjectDatabase,
    history::EditorHistory,
    sprites::{SpriteCache, SpriteImage, SpriteSource},
};
use std::{collections::HashMap, path::PathBuf, sync::Mutex};

pub struct WorkspaceState {
    pub database: ObjectDatabase,
    pub has_project: bool,
    pub history: EditorHistory,
    pub dirty: bool,
    pub project_name: String,
    pub dat_file: String,
    pub spr_file: String,
    pub sprite_count: u32,
    pub sprite_source: Option<SpriteSource>,
    pub sprite_overrides: HashMap<u32, SpriteImage>,
    pub sprite_cache: SpriteCache,
    pub project_path: Option<PathBuf>,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            database: ObjectDatabase::default(),
            has_project: false,
            history: EditorHistory::new(64),
            dirty: false,
            project_name: String::new(),
            dat_file: String::new(),
            spr_file: String::new(),
            sprite_count: 0,
            sprite_source: None,
            sprite_overrides: HashMap::new(),
            sprite_cache: SpriteCache::new(48 * 1024 * 1024),
            project_path: None,
        }
    }
}

#[derive(Default)]
pub struct AppState(pub Mutex<WorkspaceState>);
