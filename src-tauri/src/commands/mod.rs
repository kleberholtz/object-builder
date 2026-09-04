use crate::{
    core::{
        error::{ObjectBuilderError, Result},
        models::{ClientVersion, ProjectInfo, ThingObject, WorkspaceSnapshot},
    },
    formats::{
        dat::DatFormat,
        otfi::DatSprConfig,
        spr::{SprFormat, SprHeader},
        ObjectFormat,
    },
    project::save_manifest_atomic,
    sprites::{read_sprite, SpriteImage, SpriteSource},
    state::AppState,
};
use serde::Serialize;
use std::{path::PathBuf, sync::MutexGuard};
use tauri::State;

fn lock_workspace<'a>(
    state: &'a State<'_, AppState>,
) -> Result<MutexGuard<'a, crate::state::WorkspaceState>> {
    state
        .0
        .lock()
        .map_err(|_| ObjectBuilderError::CorruptedFile("workspace lock was poisoned".into()))
}

fn project_info(state: &crate::state::WorkspaceState) -> ProjectInfo {
    ProjectInfo {
        name: state.project_name.clone(),
        client_version: state.database.version.label(),
        dat_file: state.dat_file.clone(),
        spr_file: state.spr_file.clone(),
        object_count: state.database.objects.len(),
        sprite_count: state.sprite_count,
        dirty: state.dirty,
    }
}

#[tauri::command]
pub fn get_workspace_snapshot(state: State<'_, AppState>) -> Result<WorkspaceSnapshot> {
    let workspace = lock_workspace(&state)?;
    Ok(WorkspaceSnapshot {
        project: project_info(&workspace),
        objects: workspace.database.objects.clone(),
    })
}

#[tauri::command]
pub fn update_thing(
    state: State<'_, AppState>,
    mut object: ThingObject,
    original_kind: crate::core::models::ObjectKind,
) -> Result<()> {
    let mut workspace = lock_workspace(&state)?;
    let index = workspace
        .database
        .objects
        .iter()
        .position(|entry| entry.id == object.id && entry.kind == original_kind)
        .ok_or(ObjectBuilderError::ObjectNotFound(object.id))?;
    let before = workspace.database.objects[index].clone();
    object.raw_record = before.raw_record.clone();
    workspace
        .history
        .record_object_change(before, object.clone());
    workspace.database.objects[index] = object;
    workspace.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn undo(state: State<'_, AppState>) -> Result<()> {
    let mut workspace = lock_workspace(&state)?;
    let workspace_ref = &mut *workspace;
    let (history, database) = (&mut workspace_ref.history, &mut workspace_ref.database);
    history.undo(database)?;
    workspace_ref.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn redo(state: State<'_, AppState>) -> Result<()> {
    let mut workspace = lock_workspace(&state)?;
    let workspace_ref = &mut *workspace;
    let (history, database) = (&mut workspace_ref.history, &mut workspace_ref.database);
    history.redo(database)?;
    workspace_ref.dirty = true;
    Ok(())
}

#[tauri::command]
pub async fn save_project_manifest(
    state: State<'_, AppState>,
    path: String,
    create_backup: bool,
) -> Result<()> {
    let snapshot = {
        let workspace = lock_workspace(&state)?;
        let mut project = project_info(&workspace);
        project.dirty = false;
        WorkspaceSnapshot {
            project,
            objects: workspace.database.objects.clone(),
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        save_manifest_atomic(&snapshot, &PathBuf::from(path), create_backup)
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    let mut workspace = lock_workspace(&state)?;
    workspace.dirty = false;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInspection {
    pub client_version: String,
    pub dat_signature: u32,
    pub spr_signature: u32,
    pub item_count: u16,
    pub outfit_count: u16,
    pub effect_count: u16,
    pub missile_count: u16,
    pub sprite_count: u32,
}

fn parse_version(value: &str) -> Result<ClientVersion> {
    match value.trim() {
        "7.10" | "710" => Ok(ClientVersion::Tibia710),
        "7.60" | "760" => Ok(ClientVersion::Tibia760),
        "8.60" | "860" => Ok(ClientVersion::Tibia860),
        "10.98" | "1098" => Ok(ClientVersion::Tibia1098),
        "12.00" | "1200" => Ok(ClientVersion::Tibia1200),
        "13.10" | "1310" => Ok(ClientVersion::Tibia1310),
        other => other
            .parse::<u16>()
            .map(ClientVersion::Custom)
            .map_err(|_| ObjectBuilderError::UnsupportedVersion(other.into())),
    }
}

#[tauri::command]
pub async fn inspect_client(
    dat_path: String,
    spr_path: String,
    version: String,
) -> Result<ClientInspection> {
    tauri::async_runtime::spawn_blocking(move || {
        let version = parse_version(&version)?;
        let dat_path = PathBuf::from(dat_path);
        let config_path = dat_path.with_extension("otfi");
        let config = if config_path.exists() {
            DatSprConfig::load(&config_path, version)?
        } else {
            DatSprConfig::parse("DatSpr", version)?
        };
        let dat = DatFormat {
            version,
            features: config.features,
        }
        .load(&dat_path)?;
        let SprHeader {
            signature,
            sprite_count,
            ..
        } = SprFormat {
            version,
            extended: config.features.extended,
        }
        .inspect_path(&PathBuf::from(spr_path))?;
        let counts = dat.metadata.counts;
        Ok(ClientInspection {
            client_version: version.label(),
            dat_signature: dat.metadata.dat_signature.unwrap_or_default(),
            spr_signature: signature,
            item_count: counts.items,
            outfit_count: counts.outfits,
            effect_count: counts.effects,
            missile_count: counts.missiles,
            sprite_count,
        })
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?
}

#[tauri::command]
pub async fn load_client_directory(
    state: State<'_, AppState>,
    directory: String,
    version: String,
) -> Result<WorkspaceSnapshot> {
    let directory_path = PathBuf::from(directory);
    let project_name = directory_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("OTClient")
        .to_string();
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        let version = parse_version(&version)?;
        let config_path = directory_path.join("Tibia.otfi");
        let config = if config_path.exists() {
            DatSprConfig::load(&config_path, version)?
        } else {
            DatSprConfig::parse("DatSpr", version)?
        };
        let dat_path = directory_path.join(&config.metadata_file);
        let spr_path = directory_path.join(&config.sprites_file);
        let mut database = DatFormat {
            version,
            features: config.features,
        }
        .load(&dat_path)?;
        let header = SprFormat {
            version,
            extended: config.features.extended,
        }
        .inspect_path(&spr_path)?;
        database.original_spr = Some(spr_path.clone());
        let source = SpriteSource {
            path: spr_path,
            header: header.clone(),
            transparency: config.features.transparency,
            sprite_size: config.features.sprite_size,
        };
        Ok::<_, ObjectBuilderError>((
            database,
            source,
            header.sprite_count,
            config.metadata_file,
            config.sprites_file,
        ))
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;

    let (database, sprite_source, sprite_count, dat_file, spr_file) = loaded;
    let mut workspace = lock_workspace(&state)?;
    workspace.database = database;
    workspace.history = crate::history::EditorHistory::new(64);
    workspace.dirty = false;
    workspace.project_name = project_name;
    workspace.dat_file = dat_file;
    workspace.spr_file = spr_file;
    workspace.sprite_count = sprite_count;
    workspace.sprite_source = Some(sprite_source);
    workspace.sprite_cache = crate::sprites::SpriteCache::new(48 * 1024 * 1024);
    Ok(WorkspaceSnapshot {
        project: project_info(&workspace),
        objects: workspace
            .database
            .objects
            .iter()
            .take(100)
            .cloned()
            .collect(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPage {
    pub objects: Vec<ThingObject>,
    pub total: usize,
    pub offset: usize,
    pub has_more: bool,
}

#[tauri::command]
pub fn list_objects(
    state: State<'_, AppState>,
    query: Option<String>,
    kind: Option<String>,
    offset: usize,
    limit: usize,
) -> Result<ObjectPage> {
    let workspace = lock_workspace(&state)?;
    let query = query.unwrap_or_default().to_lowercase();
    let matching: Vec<&ThingObject> = workspace
        .database
        .objects
        .iter()
        .filter(|object| {
            let query_matches = query.is_empty()
                || object.name.to_lowercase().contains(&query)
                || object.id.to_string().contains(&query);
            let kind_matches = kind
                .as_ref()
                .map(|value| value == &format!("{:?}", object.kind))
                .unwrap_or(true);
            query_matches && kind_matches
        })
        .collect();
    let total = matching.len();
    let page_limit = limit.clamp(1, 500);
    let objects = matching
        .into_iter()
        .skip(offset)
        .take(page_limit)
        .cloned()
        .collect::<Vec<_>>();
    Ok(ObjectPage {
        has_more: offset.saturating_add(objects.len()) < total,
        objects,
        total,
        offset,
    })
}

#[tauri::command]
pub async fn get_sprite(state: State<'_, AppState>, id: u32) -> Result<SpriteImage> {
    let source = {
        let mut workspace = lock_workspace(&state)?;
        if let Some(image) = workspace.sprite_cache.get(id).cloned() {
            return Ok(image);
        }
        workspace
            .sprite_source
            .clone()
            .ok_or_else(|| ObjectBuilderError::InvalidSprite("no SPR file is loaded".into()))?
    };
    let image = tauri::async_runtime::spawn_blocking(move || read_sprite(&source, id))
        .await
        .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    let mut workspace = lock_workspace(&state)?;
    workspace.sprite_cache.insert(id, image.clone());
    Ok(image)
}
