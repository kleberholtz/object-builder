use crate::{
    core::{
        dimensions::{object_dimensions, ObjectDimensions},
        error::{ObjectBuilderError, Result},
        models::{
            ClientFeatures, ClientVersion, ObjectKind, ProjectInfo, ThingObject, WorkspaceSnapshot,
        },
    },
    formats::{
        dat::DatFormat,
        otfi::DatSprConfig,
        spr::{SprFormat, SprHeader},
        ObjectFormat,
    },
    project::save_manifest_atomic,
    sprites::{
        compose_sheet, load_png, read_sprite, render_object_frame, save_png, slice_sheet, split_object_image, SpriteImage, SpriteSource,
    },
    state::{AppState, WorkspaceState},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::MutexGuard,
};
use tauri::{ipc::Channel, State};

fn lock_workspace<'a>(state: &'a State<'_, AppState>) -> Result<MutexGuard<'a, WorkspaceState>> {
    state
        .0
        .lock()
        .map_err(|_| ObjectBuilderError::CorruptedFile("workspace lock was poisoned".into()))
}

fn project_info(state: &WorkspaceState) -> ProjectInfo {
    ProjectInfo {
        name: state.project_name.clone(),
        client_version: state.database.version.label(),
        dat_file: state.dat_file.clone(),
        spr_file: state.spr_file.clone(),
        object_count: state.database.objects.len(),
        sprite_count: state.sprite_count,
        dirty: state.dirty,
        project_file: state
            .project_path
            .as_ref()
            .map(|path| path.display().to_string()),
        sprite_size: state.sprite_source.as_ref().map(|source| source.sprite_size).unwrap_or(32),
    }
}

fn snapshot(state: &WorkspaceState, limit: Option<usize>) -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        project: project_info(state),
        objects: state
            .database
            .objects
            .iter()
            .take(limit.unwrap_or(usize::MAX))
            .cloned()
            .collect(),
    }
}

fn parse_version(value: &str) -> Result<ClientVersion> {
    let trimmed = value.trim();
    let numeric = if let Some((major_text, minor_text)) = trimmed.split_once('.') {
        let major = major_text
            .parse::<u16>()
            .map_err(|_| ObjectBuilderError::UnsupportedVersion(value.into()))?;
        let parsed_minor = minor_text
            .parse::<u16>()
            .map_err(|_| ObjectBuilderError::UnsupportedVersion(value.into()))?;
        let minor = match minor_text.len() {
            1 => parsed_minor.saturating_mul(10),
            2 => parsed_minor,
            _ => return Err(ObjectBuilderError::UnsupportedVersion(value.into())),
        };
        major.saturating_mul(100).saturating_add(minor)
    } else {
        trimmed
            .parse::<u16>()
            .map_err(|_| ObjectBuilderError::UnsupportedVersion(value.into()))?
    };
    if !(740..=1525).contains(&numeric) {
        return Err(ObjectBuilderError::UnsupportedVersion(format!(
            "{value}; supported range is 7.40 through 15.25"
        )));
    }
    Ok(ClientVersion::from_numeric(numeric))
}

fn operation_error(path: &Path, operation: &str, error: ObjectBuilderError) -> ObjectBuilderError {
    ObjectBuilderError::Operation {
        file: path.display().to_string(),
        operation: operation.into(),
        reason: error.to_string(),
        suggestion: Some(
            "Check the selected client version, file names, and whether the files are complete."
                .into(),
        ),
    }
}

fn refresh_frame_ids(object: &mut ThingObject) {
    for (group_index, group) in object.frame_groups.iter_mut().enumerate() {
        for (frame_index, frame) in group.frames.iter_mut().enumerate() {
            frame.id =
                (u64::from(object.id) << 32) | ((group_index as u64) << 16) | frame_index as u64;
        }
    }
}

#[tauri::command]
pub fn get_workspace_snapshot(state: State<'_, AppState>) -> Result<Option<WorkspaceSnapshot>> {
    let workspace = lock_workspace(&state)?;
    Ok(workspace
        .has_project
        .then(|| snapshot(&workspace, Some(100))))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub directory: String,
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, AppState>,
    request: CreateProjectRequest,
) -> Result<WorkspaceSnapshot> {
    let version = parse_version(&request.version)?;
    let name = request.name.trim().to_string();
    if name.is_empty() {
        return Err(ObjectBuilderError::SerializationError(
            "project name cannot be empty".into(),
        ));
    }
    let directory = PathBuf::from(&request.directory);
    let manifest = directory.join("project.json");
    if manifest.exists() {
        return Err(ObjectBuilderError::SerializationError(format!(
            "{} already exists; choose another project directory",
            manifest.display()
        )));
    }
    let initial = WorkspaceSnapshot {
        project: ProjectInfo {
            name: name.clone(),
            client_version: version.label(),
            dat_file: String::new(),
            spr_file: String::new(),
            object_count: 0,
            sprite_count: 0,
            dirty: false,
            project_file: Some(manifest.display().to_string()),
            sprite_size: 32,
        },
        objects: Vec::new(),
    };
    let save_path = manifest.clone();
    tauri::async_runtime::spawn_blocking(move || {
        for child in ["data", "sprites", "exports", "backups"] {
            fs::create_dir_all(directory.join(child))?;
        }
        save_manifest_atomic(&initial, &HashMap::new(), &save_path, false)
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    let mut workspace = lock_workspace(&state)?;
    *workspace = WorkspaceState::default();
    workspace.has_project = true;
    workspace.project_name = name;
    workspace.database.version = version;
    workspace.project_path = Some(manifest);
    Ok(snapshot(&workspace, None))
}

#[tauri::command]
pub fn update_thing(
    state: State<'_, AppState>,
    mut object: ThingObject,
    original_kind: ObjectKind,
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

#[derive(Debug, Deserialize)]
pub struct ObjectIdentity {
    pub id: u32,
    pub kind: ObjectKind,
}

#[tauri::command]
pub fn duplicate_thing(
    state: State<'_, AppState>,
    identity: ObjectIdentity,
) -> Result<ThingObject> {
    let mut workspace = lock_workspace(&state)?;
    let mut object = workspace
        .database
        .objects
        .iter()
        .find(|entry| entry.id == identity.id && entry.kind == identity.kind)
        .cloned()
        .ok_or(ObjectBuilderError::ObjectNotFound(identity.id))?;
    object.id = workspace
        .database
        .objects
        .iter()
        .filter(|entry| entry.kind == object.kind)
        .map(|entry| entry.id)
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    object.name = format!("{} Copy", object.name);
    refresh_frame_ids(&mut object);
    object.modified = true;
    object.raw_record.clear();
    workspace.database.objects.push(object.clone());
    workspace.dirty = true;
    Ok(object)
}

#[tauri::command]
pub fn delete_things(state: State<'_, AppState>, identities: Vec<ObjectIdentity>) -> Result<usize> {
    let mut workspace = lock_workspace(&state)?;
    let before = workspace.database.objects.len();
    workspace.database.objects.retain(|object| {
        !identities
            .iter()
            .any(|identity| identity.id == object.id && identity.kind == object.kind)
    });
    let removed = before.saturating_sub(workspace.database.objects.len());
    if removed > 0 {
        workspace.dirty = true;
    }
    Ok(removed)
}

#[tauri::command]
pub fn undo(state: State<'_, AppState>) -> Result<()> {
    let mut workspace = lock_workspace(&state)?;
    let workspace = &mut *workspace;
    workspace.history.undo(&mut workspace.database)?;
    workspace.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn redo(state: State<'_, AppState>) -> Result<()> {
    let mut workspace = lock_workspace(&state)?;
    let workspace = &mut *workspace;
    workspace.history.redo(&mut workspace.database)?;
    workspace.dirty = true;
    Ok(())
}

#[tauri::command]
pub async fn save_project_manifest(
    state: State<'_, AppState>,
    path: String,
    create_backup: bool,
) -> Result<()> {
    let path = PathBuf::from(path);
    let (mut value, sprite_overrides) = {
        let workspace = lock_workspace(&state)?;
        let mut value = snapshot(&workspace, None);
        value.project.dirty = false;
        (value, workspace.sprite_overrides.clone())
    };
    value.project.project_file = Some(path.display().to_string());
    let save_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        save_manifest_atomic(&value, &sprite_overrides, &save_path, create_backup)
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    let mut workspace = lock_workspace(&state)?;
    workspace.dirty = false;
    workspace.project_path = Some(path);
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureOverrides {
    pub extended: Option<bool>,
    pub transparency: Option<bool>,
    pub frame_durations: Option<bool>,
    pub frame_groups: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientLoadRequest {
    pub directory: String,
    pub version: String,
    pub client_type: String,
    pub dat_file: String,
    pub spr_file: String,
    pub otfi_file: Option<String>,
    pub use_otfi: bool,
    pub validate_sprites: bool,
    pub features: FeatureOverrides,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadProgress {
    pub stage: String,
    pub status: String,
    pub file: Option<String>,
    pub processed: u64,
    pub total: u64,
    pub percent: f64,
}

fn emit_progress(
    channel: &Channel<LoadProgress>,
    stage: &str,
    status: &str,
    file: Option<&Path>,
    processed: u64,
    total: u64,
) {
    let percent = if total == 0 {
        0.0
    } else {
        processed as f64 * 100.0 / total as f64
    };
    let _ = channel.send(LoadProgress {
        stage: stage.into(),
        status: status.into(),
        file: file.map(|path| path.display().to_string()),
        processed,
        total,
        percent,
    });
}

fn apply_overrides(mut features: ClientFeatures, overrides: &FeatureOverrides) -> ClientFeatures {
    if let Some(value) = overrides.extended {
        features.extended = value;
    }
    if let Some(value) = overrides.transparency {
        features.transparency = value;
    }
    if let Some(value) = overrides.frame_durations {
        features.frame_durations = value;
    }
    if let Some(value) = overrides.frame_groups {
        features.frame_groups = value;
    }
    features
}

#[tauri::command]
pub async fn load_client_directory(
    state: State<'_, AppState>,
    request: ClientLoadRequest,
    on_progress: Channel<LoadProgress>,
) -> Result<WorkspaceSnapshot> {
    let directory = PathBuf::from(&request.directory);
    let project_name = directory
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("OTClient")
        .to_string();
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        let version = parse_version(&request.version)?;
        if !["OTClient", "CipSoft", "Custom"].contains(&request.client_type.as_str()) {
            return Err(ObjectBuilderError::SerializationError(format!(
                "unsupported client type: {}",
                request.client_type
            )));
        }
        emit_progress(
            &on_progress,
            "configuration",
            "Reading client configuration",
            None,
            0,
            1,
        );
        let config_path = directory.join(request.otfi_file.as_deref().unwrap_or("Tibia.otfi"));
        let use_config_file = request.use_otfi && request.client_type != "CipSoft";
        let mut config = if use_config_file && config_path.exists() {
            DatSprConfig::load(&config_path, version).map_err(|error| {
                operation_error(&config_path, "Reading OTFI configuration", error)
            })?
        } else {
            DatSprConfig::parse("DatSpr", version)?
        };
        if !request.dat_file.trim().is_empty() {
            config.metadata_file = request.dat_file.clone();
        }
        if !request.spr_file.trim().is_empty() {
            config.sprites_file = request.spr_file.clone();
        }
        if !use_config_file {
            config.features = apply_overrides(config.features, &request.features);
        }
        let dat_path = directory.join(&config.metadata_file);
        let spr_path = directory.join(&config.sprites_file);
        emit_progress(
            &on_progress,
            "dat",
            "Reading object metadata",
            Some(&dat_path),
            0,
            1,
        );
        let bytes = fs::read(&dat_path)
            .map_err(|error| operation_error(&dat_path, "Reading DAT", error.into()))?;
        let mut database = DatFormat {
            version,
            features: config.features,
        }
        .parse_with_progress(bytes, |done, total| {
            emit_progress(
                &on_progress,
                "objects",
                "Parsing objects",
                Some(&dat_path),
                done as u64,
                total as u64,
            )
        })
        .map_err(|error| operation_error(&dat_path, "Parsing DAT objects", error))?;
        let spr_format = SprFormat {
            version,
            extended: config.features.extended,
        };
        emit_progress(
            &on_progress,
            "sprites",
            "Reading sprite index",
            Some(&spr_path),
            0,
            1,
        );
        let header = spr_format
            .inspect_path(&spr_path)
            .map_err(|error| operation_error(&spr_path, "Reading SPR header", error))?;
        if request.validate_sprites {
            spr_format
                .validate_offsets(&spr_path, &header, |done, total| {
                    emit_progress(
                        &on_progress,
                        "sprites",
                        "Validating sprite index",
                        Some(&spr_path),
                        u64::from(done),
                        u64::from(total),
                    )
                })
                .map_err(|error| operation_error(&spr_path, "Validating SPR index", error))?;
        }
        emit_progress(
            &on_progress,
            "complete",
            &format!("{} client loaded", request.client_type),
            None,
            1,
            1,
        );
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
    *workspace = WorkspaceState::default();
    workspace.database = database;
    workspace.has_project = true;
    workspace.project_name = project_name;
    workspace.dat_file = dat_file;
    workspace.spr_file = spr_file;
    workspace.sprite_count = sprite_count;
    workspace.sprite_source = Some(sprite_source);
    Ok(snapshot(&workspace, Some(100)))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPage {
    pub objects: Vec<ThingObject>,
    pub total: usize,
    pub offset: usize,
    pub has_more: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectFilters {
    pub animated: Option<bool>,
    pub modified: Option<bool>,
    pub has_light: Option<bool>,
    pub multi_tile: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub valid: bool,
    pub checked_objects: usize,
    pub checked_sprites: usize,
    pub issues: Vec<String>,
}

#[tauri::command]
pub fn validate_workspace(state: State<'_, AppState>) -> Result<ValidationReport> {
    let workspace = lock_workspace(&state)?;
    let mut identities = HashSet::new();
    let mut issues = Vec::new();
    let mut checked_sprites = 0;
    for object in &workspace.database.objects {
        if !identities.insert((object.kind, object.id)) {
            issues.push(format!("duplicate {:?} ID {}", object.kind, object.id));
        }
        if object.dimensions.width == 0 || object.dimensions.height == 0 {
            issues.push(format!(
                "{:?} {} has zero dimensions",
                object.kind, object.id
            ));
        }
        for sprite_id in object
            .frame_groups
            .iter()
            .flat_map(|group| group.sprite_ids.iter().copied())
        {
            checked_sprites += 1;
            if sprite_id > workspace.sprite_count
                && !workspace.sprite_overrides.contains_key(&sprite_id)
            {
                issues.push(format!(
                    "{:?} {} references missing sprite {}",
                    object.kind, object.id, sprite_id
                ));
            }
        }
    }
    Ok(ValidationReport {
        valid: issues.is_empty(),
        checked_objects: workspace.database.objects.len(),
        checked_sprites,
        issues,
    })
}

#[tauri::command]
pub fn list_objects(
    state: State<'_, AppState>,
    query: Option<String>,
    kind: Option<String>,
    filters: Option<ObjectFilters>,
    offset: usize,
    limit: usize,
) -> Result<ObjectPage> {
    let workspace = lock_workspace(&state)?;
    let query = query.unwrap_or_default().to_lowercase();
    let filters = filters.unwrap_or_default();
    let matching = workspace
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
            let animated = object
                .frame_groups
                .iter()
                .any(|group| group.frames.len() > 1);
            query_matches
                && kind_matches
                && filters
                    .animated
                    .map(|value| value == animated)
                    .unwrap_or(true)
                && filters
                    .modified
                    .map(|value| value == object.modified)
                    .unwrap_or(true)
                && filters
                    .has_light
                    .map(|value| value == (object.gameplay.light_level > 0))
                    .unwrap_or(true)
                && filters
                    .multi_tile
                    .map(|value| {
                        value == (object.dimensions.width > 1 || object.dimensions.height > 1)
                    })
                    .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    let total = matching.len();
    let objects = matching
        .into_iter()
        .skip(offset)
        .take(limit.clamp(1, 500))
        .cloned()
        .collect::<Vec<_>>();
    Ok(ObjectPage {
        has_more: offset.saturating_add(objects.len()) < total,
        objects,
        total,
        offset,
    })
}

fn resolved_sprite(
    overrides: &HashMap<u32, SpriteImage>,
    source: Option<&SpriteSource>,
    id: u32,
) -> Result<SpriteImage> {
    if let Some(image) = overrides.get(&id) {
        return Ok(image.clone());
    }
    read_sprite(
        source.ok_or_else(|| ObjectBuilderError::InvalidSprite("no SPR file is loaded".into()))?,
        id,
    )
}

#[tauri::command]
pub async fn get_sprite(state: State<'_, AppState>, id: u32) -> Result<SpriteImage> {
    let source = {
        let mut workspace = lock_workspace(&state)?;
        if let Some(image) = workspace.sprite_overrides.get(&id) {
            return Ok(image.clone());
        }
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
    lock_workspace(&state)?
        .sprite_cache
        .insert(id, image.clone());
    Ok(image)
}

#[tauri::command]
pub fn get_object_dimensions(state: State<'_, AppState>, identity: ObjectIdentity) -> Result<ObjectDimensions> {
    let workspace = lock_workspace(&state)?;
    let object = workspace.database.objects.iter().find(|object| object.id == identity.id && object.kind == identity.kind).ok_or(ObjectBuilderError::ObjectNotFound(identity.id))?;
    let sprite_size = workspace.sprite_source.as_ref().map(|source| source.sprite_size).unwrap_or(32);
    Ok(object_dimensions(object, sprite_size))
}

#[tauri::command]
pub async fn get_object_image(state: State<'_, AppState>, identity: ObjectIdentity, group_index: usize, frame_index: usize, pattern_index: usize) -> Result<SpriteImage> {
    let (object, overrides, source, sprite_size) = {
        let workspace = lock_workspace(&state)?;
        let object = workspace.database.objects.iter().find(|object| object.id == identity.id && object.kind == identity.kind).cloned().ok_or(ObjectBuilderError::ObjectNotFound(identity.id))?;
        let sprite_size = workspace.sprite_source.as_ref().map(|source| source.sprite_size).unwrap_or(32);
        (object, workspace.sprite_overrides.clone(), workspace.sprite_source.clone(), sprite_size)
    };
    tauri::async_runtime::spawn_blocking(move || render_object_frame(&object, group_index, frame_index, pattern_index, sprite_size, |id| resolved_sprite(&overrides, source.as_ref(), id))).await.map_err(|error| ObjectBuilderError::IoError(error.to_string()))?
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedSprite {
    id: u32,
    image: SpriteImage,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ObjectBundle {
    format: String,
    format_version: u16,
    client_version: String,
    object: ThingObject,
    sprites: Vec<EmbeddedSprite>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectFileRequest {
    pub object_id: u32,
    pub kind: ObjectKind,
    pub path: String,
}

#[tauri::command]
pub async fn export_object(state: State<'_, AppState>, request: ObjectFileRequest) -> Result<()> {
    let (object, version, overrides, source) = {
        let workspace = lock_workspace(&state)?;
        let object = workspace
            .database
            .objects
            .iter()
            .find(|object| object.id == request.object_id && object.kind == request.kind)
            .cloned()
            .ok_or(ObjectBuilderError::ObjectNotFound(request.object_id))?;
        (
            object,
            workspace.database.version.label(),
            workspace.sprite_overrides.clone(),
            workspace.sprite_source.clone(),
        )
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<()> {
        let ids = object
            .frame_groups
            .iter()
            .flat_map(|group| group.sprite_ids.iter().copied())
            .filter(|id| *id != 0)
            .collect::<HashSet<_>>();
        let sprites = ids
            .into_iter()
            .map(|id| {
                Ok(EmbeddedSprite {
                    id,
                    image: resolved_sprite(&overrides, source.as_ref(), id)?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let bundle = ObjectBundle {
            format: "object-builder-object".into(),
            format_version: 1,
            client_version: version,
            object,
            sprites,
        };
        fs::write(request.path, serde_json::to_vec_pretty(&bundle)?)?;
        Ok(())
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?
}

#[tauri::command]
pub async fn import_object(state: State<'_, AppState>, path: String) -> Result<ThingObject> {
    let bundle = tauri::async_runtime::spawn_blocking(move || -> Result<ObjectBundle> {
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    if bundle.format != "object-builder-object" || bundle.format_version != 1 {
        return Err(ObjectBuilderError::SerializationError(
            "unsupported object bundle format".into(),
        ));
    }
    let mut workspace = lock_workspace(&state)?;
    let mut object = bundle.object;
    if workspace
        .database
        .objects
        .iter()
        .any(|entry| entry.id == object.id && entry.kind == object.kind)
    {
        object.id = workspace
            .database
            .objects
            .iter()
            .filter(|entry| entry.kind == object.kind)
            .map(|entry| entry.id)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
    }
    refresh_frame_ids(&mut object);
    let mut next = workspace
        .sprite_count
        .max(
            workspace
                .sprite_overrides
                .keys()
                .copied()
                .max()
                .unwrap_or(0),
        )
        .saturating_add(1);
    let mut remap = HashMap::new();
    for sprite in bundle.sprites {
        remap.insert(sprite.id, next);
        workspace.sprite_overrides.insert(next, sprite.image);
        next = next.saturating_add(1);
    }
    for group in &mut object.frame_groups {
        for id in &mut group.sprite_ids {
            if let Some(value) = remap.get(id) {
                *id = *value;
            }
        }
        for frame in &mut group.frames {
            if let Some(value) = remap.get(&frame.sprite_id) {
                frame.sprite_id = *value;
            }
        }
    }
    object.sprite_id = object
        .frame_groups
        .first()
        .and_then(|group| group.frames.first())
        .map(|frame| frame.sprite_id)
        .unwrap_or(0);
    object.modified = true;
    workspace.sprite_count = next.saturating_sub(1);
    workspace.database.objects.push(object.clone());
    workspace.dirty = true;
    Ok(object)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PngExportRequest {
    pub object_id: u32,
    pub kind: ObjectKind,
    pub frame_index: usize,
    pub group_index: usize,
    pub mode: String,
    pub path: String,
}

#[tauri::command]
pub async fn export_png(state: State<'_, AppState>, request: PngExportRequest) -> Result<()> {
    let (object, overrides, source) = {
        let workspace = lock_workspace(&state)?;
        let object = workspace
            .database
            .objects
            .iter()
            .find(|object| object.id == request.object_id && object.kind == request.kind)
            .cloned()
            .ok_or(ObjectBuilderError::ObjectNotFound(request.object_id))?;
        (
            object,
            workspace.sprite_overrides.clone(),
            workspace.sprite_source.clone(),
        )
    };
    tauri::async_runtime::spawn_blocking(move || {
        let render = |group_index, frame_index, pattern_index| render_object_frame(&object, group_index, frame_index, pattern_index, source.as_ref().map(|value| value.sprite_size).unwrap_or(32), |id| resolved_sprite(&overrides, source.as_ref(), id));
        let image = if request.mode == "frame" {
            render(request.group_index, request.frame_index, 0)?
        } else {
            let mut images = Vec::new();
            for (group_index, group) in object.frame_groups.iter().enumerate() {
                let tiles_per_pattern = usize::from(object.dimensions.width) * usize::from(object.dimensions.height) * usize::from(object.dimensions.layers.max(1));
                let phase_stride = group.sprite_ids.len().checked_div(group.frames.len().max(1)).unwrap_or(0);
                let patterns = if request.mode == "allFrames" { 1 } else { phase_stride.checked_div(tiles_per_pattern).unwrap_or(0).max(1) };
                for frame_index in 0..group.frames.len() { for pattern_index in 0..patterns { images.push(render(group_index, frame_index, pattern_index)?); } }
            }
            compose_sheet(&images)?
        };
        save_png(Path::new(&request.path), &image)
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PngImportRequest {
    pub object_id: u32,
    pub kind: ObjectKind,
    pub frame_index: usize,
    pub group_index: usize,
    pub mode: String,
    pub path: String,
}

#[tauri::command]
pub async fn import_png(
    state: State<'_, AppState>,
    request: PngImportRequest,
) -> Result<ThingObject> {
    let source = PathBuf::from(request.path);
    let png = tauri::async_runtime::spawn_blocking(move || load_png(&source))
        .await
        .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    let mut workspace = lock_workspace(&state)?;
    let index = workspace
        .database
        .objects
        .iter()
        .position(|object| object.id == request.object_id && object.kind == request.kind)
        .ok_or(ObjectBuilderError::ObjectNotFound(request.object_id))?;
    let sprite_size = workspace.sprite_source.as_ref().map(|source| source.sprite_size).unwrap_or(32);
    let dimensions = object_dimensions(&workspace.database.objects[index], sprite_size);
    let targets = if request.mode == "frame" {
        let group = workspace.database.objects[index].frame_groups.get(request.group_index).ok_or_else(|| ObjectBuilderError::InvalidSprite("selected frame group is outside this object".into()))?;
        if request.frame_index >= group.frames.len() { return Err(ObjectBuilderError::InvalidSprite("selected frame is outside this object".into())); }
        if png.width != dimensions.pixel_width || png.height != dimensions.pixel_height { return Err(ObjectBuilderError::InvalidSprite(format!("an object frame must be {}×{} pixels; received {}×{}", dimensions.pixel_width, dimensions.pixel_height, png.width, png.height))); }
        vec![(request.group_index, request.frame_index, png)]
    } else {
        let cells = slice_sheet(&png, dimensions.pixel_width, dimensions.pixel_height, 0, 0)?;
        let expected = workspace.database.objects[index].frame_groups.iter().map(|group| group.frames.len()).sum::<usize>();
        if cells.len() != expected { return Err(ObjectBuilderError::InvalidSprite(format!("spritesheet contains {} object frames, but {expected} were expected", cells.len()))); }
        let mut cells = cells.into_iter();
        let mut targets = Vec::with_capacity(expected);
        for (group_index, group) in workspace.database.objects[index].frame_groups.iter().enumerate() { for frame_index in 0..group.frames.len() { targets.push((group_index, frame_index, cells.next().expect("validated spritesheet cell count"))); } }
        targets
    };
    let mut next = workspace
        .sprite_count
        .max(
            workspace
                .sprite_overrides
                .keys()
                .copied()
                .max()
                .unwrap_or(0),
        )
        .saturating_add(1);
    let mut replacements = Vec::new();
    for (group_index, frame_index, image) in targets {
        let tiles = split_object_image(&image, dimensions.tile_width, dimensions.tile_height, sprite_size)?;
        let assigned = tiles.into_iter().map(|image| { let id = next; next = next.saturating_add(1); (id, image) }).collect::<Vec<_>>();
        replacements.push((group_index, frame_index, assigned));
    }
    for (group_index, frame_index, assigned) in &replacements {
        let group = &mut workspace.database.objects[index].frame_groups[*group_index];
        let stride = group.sprite_ids.len().checked_div(group.frames.len().max(1)).unwrap_or(1).max(1);
        for (tile_index, (id, _)) in assigned.iter().enumerate() {
            let sprite_index = *frame_index * stride + tile_index;
            if let Some(sprite_id) = group.sprite_ids.get_mut(sprite_index) { *sprite_id = *id; }
        }
        group.frames[*frame_index].sprite_id = assigned[0].0;
    }
    for (_, _, assigned) in replacements { for (id, image) in assigned { workspace.sprite_overrides.insert(id, image); } }
    workspace.sprite_count = next.saturating_sub(1);
    workspace.database.objects[index].sprite_id = workspace.database.objects[index]
        .frame_groups
        .first()
        .and_then(|group| group.frames.first())
        .map(|frame| frame.sprite_id)
        .unwrap_or(0);
    workspace.database.objects[index].modified = true;
    let object = workspace.database.objects[index].clone();
    workspace.dirty = true;
    Ok(object)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_full_supported_version_range() {
        assert_eq!(parse_version("7.4").expect("7.4").numeric(), 740);
        assert_eq!(parse_version("7.40").expect("7.40").numeric(), 740);
        assert_eq!(parse_version("15.25").expect("15.25").numeric(), 1525);
        assert!(parse_version("7.39").is_err());
        assert!(parse_version("15.26").is_err());
    }
}
