use crate::{
    core::{
        models::{ClientFeatures, ClientVersion, ObjectDatabase},
        sprite_usage::SpriteUsageIndex,
    },
    history::EditorHistory,
    sprites::{SpriteCache, SpriteImage, SpriteSource},
};
use std::{
    collections::{HashMap, HashSet},
    num::NonZeroU64,
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc, Mutex},
};

pub struct WorkspaceState {
    pub database: ObjectDatabase,
    pub has_project: bool,
    pub history: EditorHistory,
    pub dirty: bool,
    pub project_name: String,
    pub source_directory: Option<PathBuf>,
    pub dat_file: String,
    pub spr_file: String,
    pub sprite_count: u32,
    pub sprite_source: Option<SpriteSource>,
    pub sprite_storage_sizes: Vec<u64>,
    pub sprite_overrides: HashMap<u32, SpriteImage>,
    pub removed_sprite_ids: HashSet<u32>,
    pub sprite_cache: SpriteCache,
    /// Checksums for immutable sprites in the current SPR source. A non-zero
    /// checksum costs only eight bytes per sprite and avoids decoding the SPR
    /// again when Optimize revalidates a completed analysis.
    pub source_sprite_checksums: Arc<Vec<Option<NonZeroU64>>>,
    pub sprite_usage: SpriteUsageIndex,
    pub project_path: Option<PathBuf>,
    pub client_features: ClientFeatures,
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            database: ObjectDatabase::default(),
            has_project: false,
            history: EditorHistory::new(64),
            dirty: false,
            project_name: String::new(),
            source_directory: None,
            dat_file: String::new(),
            spr_file: String::new(),
            sprite_count: 0,
            sprite_source: None,
            sprite_storage_sizes: Vec::new(),
            sprite_overrides: HashMap::new(),
            removed_sprite_ids: HashSet::new(),
            sprite_cache: SpriteCache::new(48 * 1024 * 1024),
            source_sprite_checksums: Arc::new(Vec::new()),
            sprite_usage: SpriteUsageIndex::default(),
            project_path: None,
            client_features: ClientFeatures::for_version(ClientVersion::default()),
        }
    }
}

#[derive(Default)]
pub struct AppState(
    pub Mutex<WorkspaceState>,
    pub Mutex<HashMap<String, Arc<AtomicBool>>>,
);
