use crate::{
    core::{
        dimensions::{frame_group_dimensions, object_dimensions, ObjectDimensions},
        error::{ObjectBuilderError, Result},
        logging::emit_log,
        memory::process_memory_bytes,
        models::{
            ClientFeatures, ClientVersion, FormatMetadata, ObjectDatabase, ObjectKind, ProjectInfo,
            ThingObject, WorkspaceSnapshot,
        },
        optimization_progress::{
            OptimizationProgress, OptimizationProgressTracker, OptimizationStage,
        },
        sprite_usage::{ObjectReference, SpriteUsageIndex},
    },
    formats::{
        dat::DatFormat,
        otfi::DatSprConfig,
        spr::{
            encoded_sprite_storage_size, join_spr_volumes, save_spr_archive, split_spr_volumes,
            spr_volumes, SprFormat, SprHeader, SprSaveOptions, MIN_SPR_VOLUME_SIZE,
        },
        ObjectFormat,
    },
    project::{save_bytes_atomic, save_manifest_atomic, validate_manifest},
    sprites::{
        compose_sheet, frame_layer_slots, load_png, read_sprite, render_object_frame,
        render_object_layer, render_object_preview, render_outfit_preview_with_all_addons,
        render_outfit_preview_with_base, save_png, slice_sheet, split_object_image,
        sprite_storage_sizes, visit_sprites, OutfitPreviewColors, SpriteImage, SpriteSource,
    },
    state::{AppState, WorkspaceState},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    num::NonZeroU64,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, MutexGuard,
    },
    thread,
    time::Instant,
};
use tauri::{ipc::Channel, AppHandle, State};

fn lock_workspace<'a>(state: &'a State<'_, AppState>) -> Result<MutexGuard<'a, WorkspaceState>> {
    state
        .0
        .lock()
        .map_err(|_| ObjectBuilderError::CorruptedFile("workspace lock was poisoned".into()))
}

struct OptimizationRegistration<'a> {
    analyses: &'a Mutex<HashMap<String, Arc<AtomicBool>>>,
    analysis_id: String,
}

impl Drop for OptimizationRegistration<'_> {
    fn drop(&mut self) {
        if let Ok(mut analyses) = self.analyses.lock() {
            analyses.remove(&self.analysis_id);
        }
    }
}

fn register_optimization(
    state: &AppState,
    analysis_id: String,
) -> Result<(Arc<AtomicBool>, OptimizationRegistration<'_>)> {
    let flag = Arc::new(AtomicBool::new(false));
    let mut analyses = state.1.lock().map_err(|_| {
        ObjectBuilderError::CorruptedFile("optimization registry lock was poisoned".into())
    })?;
    if !analyses.is_empty() {
        return Err(ObjectBuilderError::OperationInProgress(
            "sprite analysis".into(),
        ));
    }
    analyses.insert(analysis_id.clone(), flag.clone());
    drop(analyses);
    Ok((
        flag,
        OptimizationRegistration {
            analyses: &state.1,
            analysis_id,
        },
    ))
}

fn ensure_optimization_active(flag: &AtomicBool) -> Result<()> {
    if flag.load(Ordering::Relaxed) {
        Err(ObjectBuilderError::OperationCancelled(
            "sprite analysis".into(),
        ))
    } else {
        Ok(())
    }
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
        sprite_size: state
            .sprite_source
            .as_ref()
            .map(|source| source.sprite_size)
            .unwrap_or(32),
        source_directory: state
            .source_directory
            .as_ref()
            .map(|path| path.display().to_string()),
        dat_signature: state.database.metadata.dat_signature,
        spr_signature: state
            .sprite_source
            .as_ref()
            .map(|source| source.header.signature)
            .or(state.database.metadata.spr_signature),
        client_features: Some(state.client_features),
    }
}

fn rebuild_sprite_usage(workspace: &mut WorkspaceState) {
    workspace.sprite_usage = SpriteUsageIndex::build(&workspace.database.objects);
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOrderResult {
    pub changed_objects: usize,
    pub changed_frames: usize,
}

fn object_kind_rank(kind: ObjectKind) -> u8 {
    match kind {
        ObjectKind::Item => 0,
        ObjectKind::Outfit => 1,
        ObjectKind::Effect => 2,
        ObjectKind::Missile => 3,
        ObjectKind::Unknown => 4,
    }
}

fn normalize_object_order(database: &mut ObjectDatabase) -> Result<ApplyOrderResult> {
    if database
        .objects
        .iter()
        .any(|object| object.kind == ObjectKind::Unknown)
    {
        return Err(ObjectBuilderError::SerializationError(
            "unknown object types cannot be assigned a DAT order".into(),
        ));
    }

    for kind in [
        ObjectKind::Item,
        ObjectKind::Outfit,
        ObjectKind::Effect,
        ObjectKind::Missile,
    ] {
        let count = database
            .objects
            .iter()
            .filter(|object| object.kind == kind)
            .count();
        let capacity = if kind == ObjectKind::Item {
            usize::from(u16::MAX) - 99
        } else {
            usize::from(u16::MAX)
        };
        if count > capacity {
            return Err(ObjectBuilderError::SerializationError(format!(
                "{kind:?} has {count} objects, exceeding the DAT limit of {capacity}"
            )));
        }
    }

    let mut changed_objects = 0;
    let mut changed_frames = 0;
    for kind in [
        ObjectKind::Item,
        ObjectKind::Outfit,
        ObjectKind::Effect,
        ObjectKind::Missile,
    ] {
        let first_id = if kind == ObjectKind::Item { 100 } else { 1 };
        for (offset, object) in database
            .objects
            .iter_mut()
            .filter(|object| object.kind == kind)
            .enumerate()
        {
            let next_id = first_id + offset as u32;
            if object.id != next_id {
                object.id = next_id;
                object.modified = true;
                object.raw_record.clear();
                changed_objects += 1;
            }
            for (group_index, group) in object.frame_groups.iter_mut().enumerate() {
                for (frame_index, frame) in group.frames.iter_mut().enumerate() {
                    let id = (u64::from(object.id) << 32)
                        | ((group_index as u64) << 16)
                        | frame_index as u64;
                    if frame.id != id {
                        frame.id = id;
                        changed_frames += 1;
                    }
                }
            }
        }
    }
    database
        .objects
        .sort_by_key(|object| (object_kind_rank(object.kind), object.id));
    Ok(ApplyOrderResult {
        changed_objects,
        changed_frames,
    })
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
    app: AppHandle,
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
    let source_directory = directory.clone();
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
            source_directory: Some(directory.display().to_string()),
            dat_signature: None,
            spr_signature: None,
            client_features: Some(ClientFeatures::for_version(version)),
        },
        objects: Vec::new(),
    };
    let save_path = manifest.clone();
    tauri::async_runtime::spawn_blocking(move || {
        for child in ["data", "sprites", "exports", "backups"] {
            fs::create_dir_all(directory.join(child))?;
        }
        save_manifest_atomic(
            &initial,
            &HashMap::new(),
            &HashSet::new(),
            &save_path,
            false,
        )
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    let mut workspace = lock_workspace(&state)?;
    *workspace = WorkspaceState::default();
    workspace.has_project = true;
    workspace.project_name = name;
    workspace.database.version = version;
    workspace.client_features = ClientFeatures::for_version(version);
    workspace.project_path = Some(manifest);
    workspace.source_directory = Some(source_directory);
    emit_log(
        &app,
        "INFO",
        format!("Project created: {}", workspace.project_name),
        workspace
            .project_path
            .as_ref()
            .map(|path| path.display().to_string()),
        None,
    );
    Ok(snapshot(&workspace, None))
}

#[tauri::command]
pub async fn load_project_manifest(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<WorkspaceSnapshot> {
    let manifest_path = PathBuf::from(&path);
    let manifest_for_task = manifest_path.clone();
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        let manifest = validate_manifest(&manifest_for_task)
            .map_err(|error| operation_error(&manifest_for_task, "Opening project", error))?;
        let version = parse_version(&manifest.workspace.project.client_version)?;
        let source_directory = manifest
            .workspace
            .project
            .source_directory
            .as_ref()
            .map(PathBuf::from)
            .or_else(|| manifest_for_task.parent().map(Path::to_path_buf));
        let features = if let Some(features) = manifest.workspace.project.client_features {
            features
        } else if let Some(directory) = source_directory.as_ref() {
            let config_path = directory
                .join(&manifest.workspace.project.dat_file)
                .with_extension("otfi");
            if config_path.exists() {
                DatSprConfig::load(&config_path, version)?.features
            } else {
                let mut features = ClientFeatures::for_version(version);
                features.sprite_size = manifest.workspace.project.sprite_size;
                features
            }
        } else {
            ClientFeatures::for_version(version)
        };
        let sprite_source = if manifest.workspace.project.spr_file.is_empty() {
            None
        } else {
            let directory = source_directory.as_ref().ok_or_else(|| {
                ObjectBuilderError::SerializationError(
                    "the project does not declare a source directory".into(),
                )
            })?;
            let spr_path = directory.join(&manifest.workspace.project.spr_file);
            ensure_spr_archive(&spr_path, |_, _| {})?;
            let header = SprFormat {
                version,
                extended: features.extended,
            }
            .inspect_path(&spr_path)
            .map_err(|error| operation_error(&spr_path, "Reading project SPR", error))?;
            Some(SpriteSource {
                path: spr_path,
                header,
                transparency: features.transparency,
                sprite_size: features.sprite_size,
            })
        };
        let storage_sizes = sprite_source
            .as_ref()
            .map(sprite_storage_sizes)
            .transpose()?;
        Ok::<_, ObjectBuilderError>((
            manifest,
            version,
            source_directory,
            sprite_source,
            storage_sizes.unwrap_or_default(),
            features,
        ))
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    let (manifest, version, source_directory, sprite_source, storage_sizes, features) = loaded;
    let mut workspace = lock_workspace(&state)?;
    *workspace = WorkspaceState::default();
    workspace.has_project = true;
    workspace.project_name = manifest.workspace.project.name;
    workspace.dat_file = manifest.workspace.project.dat_file;
    workspace.spr_file = manifest.workspace.project.spr_file;
    workspace.sprite_count = sprite_source
        .as_ref()
        .map(|source| source.header.sprite_count)
        .unwrap_or(manifest.workspace.project.sprite_count);
    workspace.source_sprite_checksums = Arc::new(vec![
        None;
        usize::try_from(workspace.sprite_count)
            .unwrap_or_default()
    ]);
    workspace.sprite_source = sprite_source;
    workspace.sprite_storage_sizes = storage_sizes;
    workspace.client_features = features;
    workspace.sprite_overrides = manifest.sprite_overrides;
    workspace.removed_sprite_ids = manifest.removed_sprite_ids;
    workspace.database = ObjectDatabase {
        version,
        objects: manifest.workspace.objects,
        metadata: FormatMetadata {
            dat_signature: manifest.workspace.project.dat_signature,
            spr_signature: manifest.workspace.project.spr_signature,
            ..FormatMetadata::default()
        },
        ..ObjectDatabase::default()
    };
    workspace.source_directory = source_directory;
    workspace.project_path = Some(manifest_path.clone());
    rebuild_sprite_usage(&mut workspace);
    emit_log(
        &app,
        "INFO",
        format!("Project reopened: {}", workspace.project_name),
        Some(manifest_path.display().to_string()),
        None,
    );
    Ok(snapshot(&workspace, Some(100)))
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
    rebuild_sprite_usage(&mut workspace);
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
    rebuild_sprite_usage(&mut workspace);
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
        rebuild_sprite_usage(&mut workspace);
        workspace.dirty = true;
    }
    Ok(removed)
}

#[tauri::command]
pub fn reorder_things(
    app: AppHandle,
    state: State<'_, AppState>,
    identities: Vec<ObjectIdentity>,
) -> Result<()> {
    let mut workspace = lock_workspace(&state)?;
    let keys = identities
        .iter()
        .map(|identity| (identity.kind, identity.id))
        .collect::<HashSet<_>>();
    if keys.len() != identities.len() {
        return Err(ObjectBuilderError::SerializationError(
            "manual order contains duplicate objects".into(),
        ));
    }
    let ordered = identities
        .iter()
        .map(|identity| {
            workspace
                .database
                .objects
                .iter()
                .find(|object| object.id == identity.id && object.kind == identity.kind)
                .cloned()
                .ok_or(ObjectBuilderError::ObjectNotFound(identity.id))
        })
        .collect::<Result<Vec<_>>>()?;
    let mut ordered = ordered.into_iter();
    for object in &mut workspace.database.objects {
        if keys.contains(&(object.kind, object.id)) {
            *object = ordered.next().ok_or_else(|| {
                ObjectBuilderError::SerializationError("manual order ended unexpectedly".into())
            })?;
        }
    }
    workspace.dirty = true;
    emit_log(
        &app,
        "INFO",
        format!(
            "Manual object order updated for {} objects",
            identities.len()
        ),
        None,
        None,
    );
    Ok(())
}

#[tauri::command]
pub fn apply_object_order(app: AppHandle, state: State<'_, AppState>) -> Result<ApplyOrderResult> {
    let mut workspace = lock_workspace(&state)?;
    let result = normalize_object_order(&mut workspace.database)?;
    rebuild_sprite_usage(&mut workspace);
    workspace.history.clear();
    workspace.dirty = true;
    emit_log(
        &app,
        "INFO",
        format!(
            "Object order applied: {} object IDs and {} frame IDs normalized",
            result.changed_objects, result.changed_frames
        ),
        None,
        None,
    );
    Ok(result)
}

#[tauri::command]
pub fn apply_frame_order(
    app: AppHandle,
    state: State<'_, AppState>,
    identity: ObjectIdentity,
) -> Result<ThingObject> {
    let mut workspace = lock_workspace(&state)?;
    let object = workspace
        .database
        .objects
        .iter_mut()
        .find(|object| object.id == identity.id && object.kind == identity.kind)
        .ok_or(ObjectBuilderError::ObjectNotFound(identity.id))?;
    let before = object
        .frame_groups
        .iter()
        .flat_map(|group| group.frames.iter())
        .map(|frame| frame.id)
        .collect::<Vec<_>>();
    refresh_frame_ids(object);
    let changed = object
        .frame_groups
        .iter()
        .flat_map(|group| group.frames.iter())
        .zip(before)
        .filter(|(frame, old_id)| frame.id != *old_id)
        .count();
    let result = object.clone();
    workspace.history.clear();
    workspace.dirty = true;
    emit_log(
        &app,
        "INFO",
        format!(
            "Frame order applied for {:?} #{}: {} frame IDs normalized",
            identity.kind, identity.id, changed
        ),
        None,
        None,
    );
    Ok(result)
}

#[tauri::command]
pub fn undo(state: State<'_, AppState>) -> Result<()> {
    let mut workspace = lock_workspace(&state)?;
    let workspace = &mut *workspace;
    workspace.history.undo(&mut workspace.database)?;
    rebuild_sprite_usage(workspace);
    workspace.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn redo(state: State<'_, AppState>) -> Result<()> {
    let mut workspace = lock_workspace(&state)?;
    let workspace = &mut *workspace;
    workspace.history.redo(&mut workspace.database)?;
    rebuild_sprite_usage(workspace);
    workspace.dirty = true;
    Ok(())
}

#[tauri::command]
pub async fn save_project_manifest(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    create_backup: bool,
    on_progress: Channel<SaveProgress>,
) -> Result<()> {
    let reporter = SaveReporter::new(on_progress);
    reporter.send(SaveProgress::new(
        "preparing",
        "Collecting workspace changes",
        4.0,
        (0, 0, 0, 0),
        false,
    ));
    emit_log(&app, "INFO", "Saving project", Some(path.clone()), None);
    let path = PathBuf::from(path);
    let (mut value, sprite_overrides, removed_sprite_ids) = {
        let workspace = lock_workspace(&state)?;
        let mut value = snapshot(&workspace, None);
        value.project.dirty = false;
        (
            value,
            workspace.sprite_overrides.clone(),
            workspace.removed_sprite_ids.clone(),
        )
    };
    let objects = value.objects.len();
    let sprites = sprite_overrides.len();
    reporter.send(
        SaveProgress::new(
            "objects",
            "Objects prepared",
            26.0,
            (objects, objects, 0, sprites),
            false,
        )
        .file(&path),
    );
    value.project.project_file = Some(path.display().to_string());
    let save_path = path.clone();
    reporter.send(
        SaveProgress::new(
            "sprites",
            "Sprite overrides prepared",
            48.0,
            (objects, objects, sprites, sprites),
            false,
        )
        .file(&path),
    );
    reporter.send(
        SaveProgress::new(
            "writing",
            "Writing project file",
            66.0,
            (objects, objects, sprites, sprites),
            false,
        )
        .file(&path),
    );
    let result = tauri::async_runtime::spawn_blocking(move || {
        save_manifest_atomic(
            &value,
            &sprite_overrides,
            &removed_sprite_ids,
            &save_path,
            create_backup,
        )
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?;
    let written = match result {
        Ok(written) => written,
        Err(error) => {
            emit_log(
                &app,
                "ERROR",
                "Project save failed",
                Some(path.display().to_string()),
                Some(error.to_string()),
            );
            return Err(operation_error(&path, "Writing project manifest", error));
        }
    };
    reporter.send(
        SaveProgress::new(
            "validating",
            "Re-reading the saved project",
            88.0,
            (objects, objects, sprites, sprites),
            false,
        )
        .file(&path)
        .bytes(written, written),
    );
    let validation_path = path.clone();
    let validation =
        tauri::async_runtime::spawn_blocking(move || validate_manifest(&validation_path))
            .await
            .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?;
    if let Err(error) = validation {
        emit_log(
            &app,
            "ERROR",
            "Saved project validation failed",
            Some(path.display().to_string()),
            Some(error.to_string()),
        );
        return Err(operation_error(&path, "Validating saved project", error));
    }
    let mut workspace = lock_workspace(&state)?;
    workspace.dirty = false;
    workspace.project_path = Some(path.clone());
    reporter.send(
        SaveProgress::new(
            "completed",
            "Project saved and verified",
            100.0,
            (objects, objects, sprites, sprites),
            true,
        )
        .file(&path)
        .bytes(written, written),
    );
    emit_log(
        &app,
        "INFO",
        format!("Project saved: {objects} objects, {sprites} sprite overrides"),
        None,
        None,
    );
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProgress {
    pub stage: String,
    pub status: String,
    /// The file the stage is working on, when there is a single one. The dialog shows it
    /// under the status line, so a save that writes four files says which one it is on.
    pub detail: Option<String>,
    pub percent: f64,
    pub objects_processed: usize,
    pub objects_total: usize,
    pub sprites_processed: usize,
    pub sprites_total: usize,
    pub bytes_written: u64,
    pub bytes_total: u64,
    /// How many SPR volumes the split has written so far, and how many it wrote in the end.
    /// Zero for every save that was not asked to split, which is what keeps the dialog from
    /// showing a volume row for the saves that have none.
    pub volumes: u32,
    /// Milliseconds since the save started, stamped by the reporter rather than read from
    /// the UI clock: the dialog derives elapsed time and throughput from the same instant
    /// the bytes were counted, so a slow IPC hop cannot inflate the rate.
    pub elapsed_ms: u64,
    pub complete: bool,
}

impl SaveProgress {
    fn new(
        stage: &str,
        status: &str,
        percent: f64,
        counts: (usize, usize, usize, usize),
        complete: bool,
    ) -> Self {
        let (objects_processed, objects_total, sprites_processed, sprites_total) = counts;
        Self {
            stage: stage.into(),
            status: status.into(),
            detail: None,
            percent,
            objects_processed,
            objects_total,
            sprites_processed,
            sprites_total,
            bytes_written: 0,
            bytes_total: 0,
            volumes: 0,
            elapsed_ms: 0,
            complete,
        }
    }

    fn detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    fn file(self, path: &Path) -> Self {
        self.detail(path.display().to_string())
    }

    fn bytes(mut self, written: u64, total: u64) -> Self {
        self.bytes_written = written;
        self.bytes_total = total;
        self
    }

    fn volumes(mut self, volumes: u32) -> Self {
        self.volumes = volumes;
        self
    }
}

/// Stamps each update with the time since the save began.
///
/// The elapsed clock lives here, and not in the dialog, because a stage that writes a
/// gigabyte sends no message while it does: the last stamp is what tells the UI the save is
/// still moving, and it is the same instant the byte counter belongs to.
#[derive(Clone)]
struct SaveReporter {
    channel: Channel<SaveProgress>,
    started: Instant,
}

impl SaveReporter {
    fn new(channel: Channel<SaveProgress>) -> Self {
        Self {
            channel,
            started: Instant::now(),
        }
    }

    fn send(&self, mut progress: SaveProgress) {
        progress.elapsed_ms = self.started.elapsed().as_millis() as u64;
        let _ = self.channel.send(progress);
    }
}

#[tauri::command]
pub async fn save_client_files(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
    create_backup: bool,
    // `split_size`, when set, also publishes the finished SPR as volumes of at most this many
    // bytes (`Tibia.spr.001`, …) next to the complete archive. The whole file stays where it
    // is: it is what the session keeps reading sprites from for the rest of its life.
    split_size: Option<u64>,
    on_progress: Channel<SaveProgress>,
) -> Result<ProjectInfo> {
    let reporter = SaveReporter::new(on_progress);
    if let Some(size) = split_size {
        if size < MIN_SPR_VOLUME_SIZE {
            return Err(ObjectBuilderError::SerializationError(format!(
                "SPR volumes must be at least {} MiB",
                MIN_SPR_VOLUME_SIZE / (1024 * 1024)
            )));
        }
    }
    reporter.send(SaveProgress::new(
        "preparing",
        "Collecting objects and sprite overrides",
        3.0,
        (0, 0, 0, 0),
        false,
    ));
    let (
        database,
        source,
        overrides,
        removed_ids,
        features,
        current_directory,
        current_dat,
        current_spr,
    ) = {
        let workspace = lock_workspace(&state)?;
        (
            workspace.database.clone(),
            workspace.sprite_source.clone().ok_or_else(|| {
                ObjectBuilderError::SerializationError(
                    "saving DAT/SPR requires a loaded source SPR archive".into(),
                )
            })?,
            workspace.sprite_overrides.clone(),
            workspace.removed_sprite_ids.clone(),
            workspace.client_features,
            workspace.source_directory.clone(),
            workspace.dat_file.clone(),
            workspace.spr_file.clone(),
        )
    };
    let (dat_path, spr_path) = if let Some(selected) = path {
        let selected = PathBuf::from(selected);
        if selected
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("spr"))
        {
            (selected.with_extension("dat"), selected)
        } else {
            (
                selected.with_extension("dat"),
                selected.with_extension("spr"),
            )
        }
    } else {
        let directory = current_directory.ok_or_else(|| {
            ObjectBuilderError::SerializationError(
                "the current client has no source directory".into(),
            )
        })?;
        if current_dat.is_empty() || current_spr.is_empty() {
            return Err(ObjectBuilderError::SerializationError(
                "the current client does not declare DAT/SPR file names".into(),
            ));
        }
        (directory.join(current_dat), directory.join(current_spr))
    };
    let output_directory = dat_path.parent().map(Path::to_path_buf).ok_or_else(|| {
        ObjectBuilderError::SerializationError("DAT output has no parent directory".into())
    })?;
    fs::create_dir_all(&output_directory)?;
    let dat_file = dat_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            ObjectBuilderError::SerializationError("DAT output name is not valid UTF-8".into())
        })?
        .to_string();
    let spr_file = spr_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            ObjectBuilderError::SerializationError("SPR output name is not valid UTF-8".into())
        })?
        .to_string();
    let otfi_path = dat_path.with_extension("otfi");
    let object_total = database.objects.len();
    let override_total = overrides.len();
    emit_log(
        &app,
        "INFO",
        "Saving client DAT/SPR",
        Some(output_directory.display().to_string()),
        Some(format!(
            "{object_total} objects; {override_total} sprite overrides{}",
            split_size
                .map(|size| format!("; SPR volumes of {size} bytes"))
                .unwrap_or_default()
        )),
    );
    let progress = reporter.clone();
    let dat_path_task = dat_path.clone();
    let spr_path_task = spr_path.clone();
    let otfi_path_task = otfi_path.clone();
    let source_for_task = source.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let counts = (object_total, object_total, 0, override_total);
        progress.send(
            SaveProgress::new("dat", "Serializing objects", 8.0, counts, false).file(&dat_path_task),
        );
        let format = DatFormat { version: database.version, features };
        let dat_bytes = format.serialize(&database)?;
        let dat_size = dat_bytes.len() as u64;
        progress.send(
            SaveProgress::new("dat", "Re-parsing the serialized DAT", 20.0, counts, false)
                .file(&dat_path_task)
                .bytes(0, dat_size),
        );
        let validated = format.parse(dat_bytes.clone()).map_err(|error| {
            operation_error(&dat_path_task, "Validating serialized DAT", error)
        })?;
        save_bytes_atomic(&dat_path_task, &dat_bytes, create_backup).map_err(|error| {
            operation_error(&dat_path_task, "Writing DAT", error)
        })?;
        progress.send(
            SaveProgress::new("dat", "DAT written and verified", 30.0, counts, false)
                .file(&dat_path_task)
                .bytes(dat_size, dat_size),
        );
        progress.send(
            SaveProgress::new("spr", "Writing SPR archive", 32.0, counts, false)
                .file(&spr_path_task),
        );
        let channel = progress.clone();
        let spr_detail = spr_path_task.display().to_string();
        let header = save_spr_archive(
            SprSaveOptions {
                source: &source_for_task.path,
                source_header: &source_for_task.header,
                destination: &spr_path_task,
                overrides: &overrides,
                removed_ids: &removed_ids,
                extended: features.extended,
                transparency: features.transparency,
                sprite_size: features.sprite_size,
                create_backup,
            },
            move |update| {
                let ratio = if update.sprites_total == 0 {
                    1.0
                } else {
                    f64::from(update.sprites_processed) / f64::from(update.sprites_total)
                };
                channel.send(
                    SaveProgress::new(
                        "spr",
                        "Writing sprites",
                        32.0 + ratio * 46.0,
                        (
                            object_total,
                            object_total,
                            update.sprites_processed as usize,
                            update.sprites_total as usize,
                        ),
                        false,
                    )
                    .detail(spr_detail.clone())
                    // The archive is written straight through, so the bytes already on disk
                    // are the whole estimate the writer can honestly give.
                    .bytes(update.bytes_written, update.bytes_written),
                );
            },
        )
        .map_err(|error| operation_error(&spr_path_task, "Writing SPR", error))?;
        let spr_size = fs::metadata(&spr_path_task).map(|data| data.len()).unwrap_or(0);
        progress.send(
            SaveProgress::new("otfi", "Writing OTFI feature file", 80.0, counts, false)
                .file(&otfi_path_task)
                .bytes(spr_size, spr_size),
        );
        let otfi = format!(
            "DatSpr\n  extended: {}\n  transparency: {}\n  frame-durations: {}\n  frame-groups: {}\n  bounding-box: true\n  metadata-file: {}\n  sprites-file: {}\n  sprite-size: {}\n  sprite-data-size: {}\n",
            features.extended,
            features.transparency,
            features.frame_durations,
            features.frame_groups,
            dat_file,
            spr_file,
            features.sprite_size,
            features.sprite_data_size,
        );
        save_bytes_atomic(&otfi_path_task, otfi.as_bytes(), create_backup).map_err(|error| {
            operation_error(&otfi_path_task, "Writing OTFI", error)
        })?;
        let volumes = if let Some(part_size) = split_size {
            let channel = progress.clone();
            let volume_prefix = spr_path_task.display().to_string();
            let set = split_spr_volumes(&spr_path_task, part_size, move |written, total, number| {
                let ratio = if total == 0 { 1.0 } else { written as f64 / total as f64 };
                let volume = format!("{volume_prefix}.{number:03}");
                channel.send(
                    SaveProgress::new(
                        "volumes",
                        "Splitting the SPR into volumes",
                        82.0 + ratio * 12.0,
                        counts,
                        false,
                    )
                    .detail(volume)
                    .bytes(written, total)
                    .volumes(number as u32),
                );
            })
            .map_err(|error| operation_error(&spr_path_task, "Splitting the SPR into volumes", error))?;
            Some((set.volumes.len(), set.total_size, set.part_size, set.index))
        } else {
            None
        };
        progress.send(
            SaveProgress::new("indexing", "Indexing the saved sprites", 95.0, counts, false)
                .file(&spr_path_task),
        );
        let saved_source = SpriteSource {
            path: spr_path_task.clone(),
            header: header.clone(),
            transparency: features.transparency,
            sprite_size: features.sprite_size,
        };
        let storage_sizes = sprite_storage_sizes(&saved_source)?;
        Ok::<_, ObjectBuilderError>((dat_bytes, header, storage_sizes, validated, volumes, spr_size))
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?;
    let (dat_bytes, header, storage_sizes, validated, volumes, spr_size) = match result {
        Ok(value) => value,
        Err(error) => {
            emit_log(
                &app,
                "ERROR",
                "DAT/SPR save failed",
                Some(dat_path.display().to_string()),
                Some(error.to_string()),
            );
            return Err(error);
        }
    };
    let mut workspace = lock_workspace(&state)?;
    workspace.database.original_dat = Some(dat_bytes);
    workspace.database.original_spr = Some(spr_path.clone());
    workspace.database.metadata = validated.metadata;
    for object in &mut workspace.database.objects {
        if let Some(saved) = validated
            .objects
            .iter()
            .find(|saved| saved.id == object.id && saved.kind == object.kind)
        {
            object.raw_record = saved.raw_record.clone();
            object.modified = false;
        }
    }
    workspace.sprite_count = header.sprite_count;
    workspace.source_sprite_checksums = Arc::new(vec![
        None;
        usize::try_from(header.sprite_count)
            .unwrap_or_default()
    ]);
    workspace.sprite_source = Some(SpriteSource {
        path: spr_path.clone(),
        header,
        transparency: features.transparency,
        sprite_size: features.sprite_size,
    });
    workspace.sprite_storage_sizes = storage_sizes;
    workspace.sprite_overrides.clear();
    workspace.removed_sprite_ids.clear();
    workspace.sprite_cache.clear();
    workspace.source_directory = Some(output_directory);
    workspace.dat_file = dat_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Tibia.dat")
        .to_string();
    workspace.spr_file = spr_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Tibia.spr")
        .to_string();
    workspace.dirty = false;
    let summary = match &volumes {
        Some((count, _, _, _)) => format!(
            "{}, {} and {} written; SPR published in {count} volumes",
            workspace.dat_file,
            workspace.spr_file,
            otfi_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Tibia.otfi"),
        ),
        None => format!(
            "{}, {} and {} written",
            workspace.dat_file,
            workspace.spr_file,
            otfi_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Tibia.otfi"),
        ),
    };
    reporter.send(
        SaveProgress::new(
            "completed",
            "Client files saved and verified",
            100.0,
            (object_total, object_total, override_total, override_total),
            true,
        )
        .file(&spr_path)
        .bytes(spr_size, spr_size)
        .volumes(
            volumes
                .as_ref()
                .map(|(count, ..)| *count as u32)
                .unwrap_or(0),
        ),
    );
    if let Some((count, total_size, part_size, index)) = volumes {
        emit_log(
            &app,
            "INFO",
            format!(
                "SPR split into {count} volumes of up to {part_size} bytes ({total_size} bytes total)"
            ),
            Some(index.display().to_string()),
            None,
        );
    }
    emit_log(
        &app,
        "INFO",
        format!("Client saved: {summary}"),
        workspace
            .source_directory
            .as_ref()
            .map(|value| value.display().to_string()),
        None,
    );
    Ok(project_info(&workspace))
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

/// Versions that read a DAT differently from one another. Everything between two entries
/// parses byte for byte like the lower one, so probing these six covers the whole 7.40–15.25
/// range without opening the file two dozen times.
const DETECTION_PROBES: [u16; 6] = [1098, 1000, 860, 780, 760, 740];

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedFeatures {
    pub extended: bool,
    pub transparency: bool,
    pub frame_durations: bool,
    pub frame_groups: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetection {
    pub version: String,
    pub source: String,
    pub dat_signature: u32,
    pub item_count: u16,
    pub outfit_count: u16,
    pub effect_count: u16,
    pub missile_count: u16,
    pub features: DetectedFeatures,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetectRequest {
    pub directory: String,
    pub dat_file: String,
    pub otfi_file: Option<String>,
    pub use_otfi: bool,
}

/// The feature sets to try, in the order that keeps the answer usable: what an OTFI declares,
/// then what each version implies on its own, and only then the same with the sprite ID width
/// flipped — the one knob OTClient distributions turn without touching the version. A hit in the
/// first two passes loads with the version alone; a hit in the last one needs the format switches,
/// which is what `source` tells the caller.
fn detection_passes(declared: Option<ClientFeatures>) -> Vec<(ClientVersion, ClientFeatures)> {
    let versions = DETECTION_PROBES.map(ClientVersion::from_numeric);
    let mut passes = Vec::with_capacity(versions.len() * 3);
    if let Some(features) = declared {
        passes.extend(versions.iter().map(|version| (*version, features)));
    }
    passes.extend(
        versions
            .iter()
            .map(|version| (*version, ClientFeatures::for_version(*version))),
    );
    passes.extend(versions.iter().map(|version| {
        let defaults = ClientFeatures::for_version(*version);
        (
            *version,
            ClientFeatures {
                extended: !defaults.extended,
                ..defaults
            },
        )
    }));
    passes
}

#[tauri::command]
pub async fn detect_client_version(request: VersionDetectRequest) -> Result<VersionDetection> {
    tauri::async_runtime::spawn_blocking(move || detect_version(&request))
        .await
        .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?
}

fn detect_version(request: &VersionDetectRequest) -> Result<VersionDetection> {
    let directory = PathBuf::from(&request.directory);
    let dat_path = directory.join(if request.dat_file.trim().is_empty() {
        "Tibia.dat"
    } else {
        request.dat_file.trim()
    });
    let bytes = fs::read(&dat_path)
        .map_err(|error| operation_error(&dat_path, "Reading DAT", error.into()))?;
    let otfi_path = directory.join(request.otfi_file.as_deref().unwrap_or("Tibia.otfi"));
    let declared = if request.use_otfi && otfi_path.exists() {
        DatSprConfig::load(&otfi_path, ClientVersion::default())
            .ok()
            .map(|config| config.features)
    } else {
        None
    };
    for (version, features) in detection_passes(declared) {
        let Ok(database) = (DatFormat { version, features }).parse(bytes.clone()) else {
            continue;
        };
        let counts = database.metadata.counts;
        let source = if declared == Some(features) {
            "otfi"
        } else if features == ClientFeatures::for_version(version) {
            "version"
        } else {
            "features"
        };
        return Ok(VersionDetection {
            version: version.label(),
            source: source.into(),
            dat_signature: database.metadata.dat_signature.unwrap_or_default(),
            item_count: counts.items,
            outfit_count: counts.outfits,
            effect_count: counts.effects,
            missile_count: counts.missiles,
            features: DetectedFeatures {
                extended: features.extended,
                transparency: features.transparency,
                frame_durations: features.frame_durations,
                frame_groups: features.frame_groups,
            },
        });
    }
    Err(operation_error(
        &dat_path,
        "Detecting client version",
        ObjectBuilderError::InvalidDat(
            "no supported client version parses this file end to end".into(),
        ),
    ))
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

/// Rebuilds an SPR that is only present as the volumes a split save wrote.
///
/// A client shipped in pieces arrives as `Tibia.spr.001`, `Tibia.spr.002`, … with no
/// `Tibia.spr` at all; joining them at open time is what makes that directory loadable
/// without a separate step, and doing it here means every reader keeps seeing one archive.
/// A directory with no volumes is left alone so the caller reports the missing file itself.
fn ensure_spr_archive<F>(spr_path: &Path, mut progress: F) -> Result<()>
where
    F: FnMut(u64, u64),
{
    if spr_path.exists() || spr_volumes(spr_path)?.is_none() {
        return Ok(());
    }
    join_spr_volumes(spr_path, &mut progress)
        .map_err(|error| operation_error(spr_path, "Joining SPR volumes", error))?;
    Ok(())
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
    app: AppHandle,
    state: State<'_, AppState>,
    request: ClientLoadRequest,
    on_progress: Channel<LoadProgress>,
) -> Result<WorkspaceSnapshot> {
    emit_log(
        &app,
        "INFO",
        "Opening client",
        Some(request.directory.clone()),
        Some(format!(
            "Version {} · {}",
            request.version, request.client_type
        )),
    );
    let directory = PathBuf::from(&request.directory);
    let directory_for_log = directory.clone();
    let project_name = directory
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("OTClient")
        .to_string();
    let task_result = tauri::async_runtime::spawn_blocking(move || {
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
        ensure_spr_archive(&spr_path, |done, total| {
            emit_progress(
                &on_progress,
                "sprites",
                "Joining SPR volumes",
                Some(&spr_path),
                done,
                total,
            )
        })?;
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
        let storage_sizes = sprite_storage_sizes(&source)
            .map_err(|error| operation_error(&source.path, "Reading SPR storage sizes", error))?;
        Ok::<_, ObjectBuilderError>((
            database,
            source,
            storage_sizes,
            header.sprite_count,
            config.metadata_file,
            config.sprites_file,
            config.features,
        ))
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?;
    let loaded = match task_result {
        Ok(value) => value,
        Err(error) => {
            emit_log(
                &app,
                "ERROR",
                "Unable to open client",
                Some(directory_for_log.display().to_string()),
                Some(error.to_string()),
            );
            return Err(error);
        }
    };
    let (database, sprite_source, storage_sizes, sprite_count, dat_file, spr_file, features) =
        loaded;
    let mut workspace = lock_workspace(&state)?;
    *workspace = WorkspaceState::default();
    workspace.database = database;
    workspace.has_project = true;
    workspace.project_name = project_name;
    workspace.dat_file = dat_file;
    workspace.spr_file = spr_file;
    workspace.sprite_count = sprite_count;
    workspace.source_sprite_checksums = Arc::new(vec![
        None;
        usize::try_from(sprite_count)
            .unwrap_or_default()
    ]);
    workspace.sprite_source = Some(sprite_source);
    workspace.sprite_storage_sizes = storage_sizes;
    workspace.client_features = features;
    workspace.source_directory = Some(directory_for_log.clone());
    rebuild_sprite_usage(&mut workspace);
    emit_log(
        &app,
        "INFO",
        format!(
            "Client opened successfully: {} objects",
            workspace.database.objects.len()
        ),
        Some(directory_for_log.display().to_string()),
        Some(format!("{sprite_count} sprites loaded")),
    );
    Ok(snapshot(&workspace, Some(100)))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectPage {
    pub objects: Vec<ThingObject>,
    pub byte_sizes: Vec<u64>,
    pub total: usize,
    pub offset: usize,
    pub has_more: bool,
}

fn object_sprite_storage_bytes(
    object: &ThingObject,
    source_sizes: &[u64],
    override_sizes: &HashMap<u32, u64>,
) -> u64 {
    object
        .frame_groups
        .iter()
        .flat_map(|group| group.sprite_ids.iter().copied())
        .filter(|id| *id != 0)
        .collect::<HashSet<_>>()
        .into_iter()
        .map(|id| {
            let data_size = override_sizes.get(&id).copied().unwrap_or_else(|| {
                usize::try_from(id - 1)
                    .ok()
                    .and_then(|index| source_sizes.get(index))
                    .copied()
                    .unwrap_or_default()
            });
            // Each referenced sprite also owns one four-byte entry in the SPR index.
            4_u64.saturating_add(data_size)
        })
        .sum()
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
pub fn validate_workspace(app: AppHandle, state: State<'_, AppState>) -> Result<ValidationReport> {
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
    let report = ValidationReport {
        valid: issues.is_empty(),
        checked_objects: workspace.database.objects.len(),
        checked_sprites,
        issues,
    };
    if report.valid {
        emit_log(
            &app,
            "INFO",
            format!(
                "Validation completed: {} objects and {} sprite references",
                report.checked_objects, report.checked_sprites
            ),
            None,
            None,
        );
    } else {
        emit_log(
            &app,
            "WARNING",
            format!("Validation found {} issues", report.issues.len()),
            None,
            report.issues.first().cloned(),
        );
        for issue in report
            .issues
            .iter()
            .filter(|issue| issue.contains("missing sprite"))
            .take(50)
        {
            emit_log(
                &app,
                "WARNING",
                "Missing sprite reference",
                Some(issue.clone()),
                None,
            );
        }
    }
    Ok(report)
}

#[tauri::command]
pub fn list_objects(
    state: State<'_, AppState>,
    query: Option<String>,
    kind: Option<String>,
    filters: Option<ObjectFilters>,
    sort: Option<String>,
    offset: usize,
    limit: usize,
) -> Result<ObjectPage> {
    let workspace = lock_workspace(&state)?;
    let query = query.unwrap_or_default().trim().to_lowercase();
    let query_tokens = query.split_whitespace().collect::<Vec<_>>();
    let filters = filters.unwrap_or_default();
    let override_sizes = workspace
        .sprite_overrides
        .iter()
        .map(|(id, image)| {
            encoded_sprite_storage_size(image, workspace.client_features.transparency)
                .map(|size| (*id, size))
        })
        .collect::<Result<HashMap<_, _>>>()?;
    let mut matching = workspace
        .database
        .objects
        .iter()
        .filter(|object| {
            let name = object.name.to_lowercase();
            let id = object.id.to_string();
            let sprite_id = object.sprite_id.to_string();
            let object_kind = format!("{:?}", object.kind).to_lowercase();
            let query_matches = query_tokens.iter().all(|token| {
                if let Some(value) = token.strip_prefix("id:") {
                    id.contains(value.trim_start_matches('#'))
                } else if let Some(value) = token.strip_prefix("spr:") {
                    sprite_id.contains(value.trim_start_matches('#'))
                } else if let Some(value) = token.strip_prefix("type:") {
                    object_kind.contains(value)
                } else if let Some(value) = token.strip_prefix("name:") {
                    name.contains(value)
                } else {
                    let value = token.trim_start_matches('#');
                    name.contains(token)
                        || id.contains(value)
                        || sprite_id.contains(value)
                        || object_kind.contains(token)
                }
            });
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
        .map(|object| {
            (
                object,
                object_sprite_storage_bytes(
                    object,
                    &workspace.sprite_storage_sizes,
                    &override_sizes,
                ),
            )
        })
        .collect::<Vec<_>>();
    match sort.as_deref().unwrap_or("idAsc") {
        "idDesc" => matching.sort_by_key(|(entry, _)| std::cmp::Reverse(entry.id)),
        "nameAsc" => matching.sort_by(|(left, _), (right, _)| {
            left.name.cmp(&right.name).then(left.id.cmp(&right.id))
        }),
        "nameDesc" => matching.sort_by(|(left, _), (right, _)| {
            right.name.cmp(&left.name).then(right.id.cmp(&left.id))
        }),
        "spriteAsc" => matching.sort_by_key(|(entry, _)| (entry.sprite_id, entry.id)),
        "spriteDesc" => {
            matching.sort_by_key(|(entry, _)| std::cmp::Reverse((entry.sprite_id, entry.id)))
        }
        "sizeAsc" => matching.sort_by_key(|(entry, size)| (*size, entry.id)),
        "sizeDesc" => matching.sort_by_key(|(entry, size)| std::cmp::Reverse((*size, entry.id))),
        "modified" => {
            matching.sort_by_key(|(entry, _)| (std::cmp::Reverse(entry.modified), entry.id))
        }
        "manual" => {}
        _ => matching.sort_by_key(|(entry, _)| entry.id),
    }
    let total = matching.len();
    let page_entries = matching
        .into_iter()
        .skip(offset)
        .take(limit.clamp(1, 500))
        .collect::<Vec<_>>();
    let byte_sizes = page_entries.iter().map(|(_, size)| *size).collect();
    let objects = page_entries
        .into_iter()
        .map(|(object, _)| object.clone())
        .collect::<Vec<_>>();
    Ok(ObjectPage {
        has_more: offset.saturating_add(objects.len()) < total,
        objects,
        byte_sizes,
        total,
        offset,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteStatistics {
    pub total: usize,
    pub in_use: usize,
    pub unused: usize,
    pub objects_using_sprites: usize,
    pub used_multiple_times: usize,
    pub invalid_references: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteUsageRow {
    pub id: u32,
    pub object_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteManagerPage {
    pub statistics: SpriteStatistics,
    pub sprites: Vec<SpriteUsageRow>,
    pub total: usize,
    pub offset: usize,
}

fn available_sprite_ids(workspace: &WorkspaceState) -> Vec<u32> {
    let mut ids = (1..=workspace.sprite_count)
        .filter(|id| !workspace.removed_sprite_ids.contains(id))
        .collect::<Vec<_>>();
    ids.extend(
        workspace
            .sprite_overrides
            .keys()
            .filter(|id| **id > workspace.sprite_count)
            .filter(|id| !workspace.removed_sprite_ids.contains(id))
            .copied(),
    );
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn sprite_statistics(workspace: &WorkspaceState, available_ids: &[u32]) -> SpriteStatistics {
    let override_ids = workspace
        .sprite_overrides
        .keys()
        .copied()
        .collect::<HashSet<_>>();
    let in_use = workspace
        .sprite_usage
        .used_sprite_count(workspace.sprite_count, &override_ids);
    let invalid_references = workspace
        .sprite_usage
        .referenced_ids()
        .filter(|id| *id > workspace.sprite_count && !override_ids.contains(id))
        .count();
    SpriteStatistics {
        total: available_ids.len(),
        in_use,
        unused: available_ids.len().saturating_sub(in_use),
        objects_using_sprites: workspace.sprite_usage.objects_using_sprites(),
        used_multiple_times: available_ids
            .iter()
            .filter(|id| workspace.sprite_usage.usage_count(**id) > 1)
            .count(),
        invalid_references,
    }
}

#[tauri::command]
pub fn get_sprite_statistics(
    state: State<'_, AppState>,
    query: Option<String>,
    filter: Option<String>,
    object: Option<ObjectIdentity>,
    offset: usize,
    limit: usize,
) -> Result<SpriteManagerPage> {
    let workspace = lock_workspace(&state)?;
    let available_ids = available_sprite_ids(&workspace);
    let statistics = sprite_statistics(&workspace, &available_ids);
    let query = query.unwrap_or_default();
    let object_ids = object.map(|identity| {
        workspace
            .database
            .objects
            .iter()
            .find(|entry| entry.id == identity.id && entry.kind == identity.kind)
            .map(|entry| {
                entry
                    .frame_groups
                    .iter()
                    .flat_map(|group| group.sprite_ids.iter().copied())
                    .filter(|id| *id != 0)
                    .collect::<HashSet<_>>()
            })
            .unwrap_or_default()
    });
    let filter = filter.unwrap_or_else(|| "all".into());
    let matching = available_ids
        .into_iter()
        .filter(|id| query.is_empty() || id.to_string().contains(&query))
        .filter(|id| {
            object_ids
                .as_ref()
                .map(|ids| ids.contains(id))
                .unwrap_or(true)
        })
        .filter(|id| {
            let count = workspace.sprite_usage.usage_count(*id);
            match filter.as_str() {
                "used" => count > 0,
                "unused" => count == 0,
                "once" => count == 1,
                "multiple" => count > 1,
                _ => true,
            }
        })
        .collect::<Vec<_>>();
    let total = matching.len();
    let sprites = matching
        .into_iter()
        .skip(offset)
        .take(limit.clamp(1, 500))
        .map(|id| SpriteUsageRow {
            id,
            object_count: workspace.sprite_usage.usage_count(id),
        })
        .collect();
    Ok(SpriteManagerPage {
        statistics,
        sprites,
        total,
        offset,
    })
}

#[tauri::command]
pub fn get_sprite_usage(
    state: State<'_, AppState>,
    sprite_id: u32,
    offset: usize,
    limit: usize,
) -> Result<SpriteObjectPage> {
    let workspace = lock_workspace(&state)?;
    let references = workspace.sprite_usage.references(sprite_id);
    Ok(SpriteObjectPage {
        total: references.len(),
        objects: references
            .iter()
            .skip(offset)
            .take(limit.clamp(1, 500))
            .cloned()
            .collect(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpriteObjectPage {
    pub objects: Vec<ObjectReference>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectSpriteReference {
    pub id: u32,
    pub object_count: usize,
}

#[tauri::command]
pub fn get_object_sprites(
    state: State<'_, AppState>,
    identity: ObjectIdentity,
) -> Result<Vec<ObjectSpriteReference>> {
    let workspace = lock_workspace(&state)?;
    let object = workspace
        .database
        .objects
        .iter()
        .find(|entry| entry.id == identity.id && entry.kind == identity.kind)
        .ok_or(ObjectBuilderError::ObjectNotFound(identity.id))?;
    let mut ids = object
        .frame_groups
        .iter()
        .flat_map(|group| group.sprite_ids.iter().copied())
        .filter(|id| *id != 0)
        .collect::<Vec<_>>();
    ids.sort_unstable();
    ids.dedup();
    Ok(ids
        .into_iter()
        .map(|id| ObjectSpriteReference {
            id,
            object_count: workspace.sprite_usage.usage_count(id),
        })
        .collect())
}

#[tauri::command]
pub fn get_object(state: State<'_, AppState>, identity: ObjectIdentity) -> Result<ThingObject> {
    lock_workspace(&state)?
        .database
        .objects
        .iter()
        .find(|entry| entry.id == identity.id && entry.kind == identity.kind)
        .cloned()
        .ok_or(ObjectBuilderError::ObjectNotFound(identity.id))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationAnalysis {
    pub statistics: SpriteStatistics,
    pub unused_preview: Vec<u32>,
    pub unused_source_preview: Vec<u32>,
    pub unused_source_count: usize,
    pub unused_source_reclaimable_bytes: u64,
    pub unused_override_ids: Vec<u32>,
    pub unused_override_count: usize,
    pub invalid_reference_preview: Vec<u32>,
    pub invalid_reference_count: usize,
    /// Sprites that still carry pixel data but decode to a fully transparent
    /// image while objects keep pointing at them. Unused blank sprites are left
    /// out on purpose: they already belong to the unused operations.
    pub blank_sprite_ids: Vec<u32>,
    pub blank_sprite_count: usize,
    pub blank_reference_count: usize,
    pub blank_reclaimable_bytes: u64,
    /// Referenced IDs inside `1..=sprite_count` whose SPR slot holds no block at
    /// all. They are not invalid references (those point past the archive), yet
    /// they render nothing and cannot be repaired by keeping them.
    pub empty_slot_ids: Vec<u32>,
    pub empty_slot_count: usize,
    pub empty_slot_reference_count: usize,
    /// Overrides whose decoded pixels are identical to the SPR sprite they
    /// shadow. Dropping them re-exposes the original block and skips a
    /// re-encode on save.
    pub redundant_override_ids: Vec<u32>,
    pub redundant_override_count: usize,
    pub redundant_override_bytes: u64,
    pub duplicate_groups: Vec<DuplicateSpriteGroup>,
    pub duplicate_group_count: usize,
    pub duplicate_candidate_count: usize,
    pub reclaimable_bytes: usize,
    pub duplicate_reclaimable_bytes: u64,
    pub estimated_reduction_percent: f64,
}

const IPC_DUPLICATE_GROUP_LIMIT: usize = 128;
const IPC_DUPLICATE_CANDIDATE_LIMIT: usize = 128;
const IPC_ID_PREVIEW_LIMIT: usize = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateSpriteGroup {
    pub checksum: String,
    pub sprites: Vec<DuplicateSpriteCandidate>,
    pub sprite_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateSpriteCandidate {
    pub id: u32,
    pub usage_count: usize,
    pub storage_bytes: u64,
    pub origin: &'static str,
}

#[derive(Clone)]
struct OptimizationSnapshot {
    sprite_count: u32,
    sprite_source: Option<SpriteSource>,
    sprite_storage_sizes: Vec<u64>,
    sprite_overrides: HashMap<u32, SpriteImage>,
    removed_sprite_ids: HashSet<u32>,
    sprite_usage: SpriteUsageIndex,
    source_sprite_checksums: Arc<Vec<Option<NonZeroU64>>>,
}

fn optimization_snapshot(workspace: &WorkspaceState) -> OptimizationSnapshot {
    OptimizationSnapshot {
        sprite_count: workspace.sprite_count,
        sprite_source: workspace.sprite_source.clone(),
        sprite_storage_sizes: workspace.sprite_storage_sizes.clone(),
        sprite_overrides: workspace.sprite_overrides.clone(),
        removed_sprite_ids: workspace.removed_sprite_ids.clone(),
        sprite_usage: workspace.sprite_usage.clone(),
        source_sprite_checksums: workspace.source_sprite_checksums.clone(),
    }
}

struct OptimizationComputation {
    analysis: OptimizationAnalysis,
    discovered_source_checksums: Vec<(u32, u64)>,
}

fn sprite_checksum(image: &SpriteImage) -> u64 {
    let mut checksum = 0xcbf29ce484222325_u64;
    for byte in image
        .width
        .to_le_bytes()
        .into_iter()
        .chain(image.height.to_le_bytes())
        .chain(image.rgba.iter().copied())
    {
        checksum ^= u64::from(byte);
        checksum = checksum.wrapping_mul(0x100000001b3);
    }
    checksum
}

#[cfg(test)]
fn optimization_analysis(snapshot: &OptimizationSnapshot) -> Result<OptimizationAnalysis> {
    optimization_analysis_with_progress(snapshot, &OptimizationProgressTracker::silent())
        .map(|result| result.analysis)
}

/// Ids the scan has to touch, split by how they will be answered.
///
/// The split is what makes the progress bar honest: a sprite answered from the
/// checksum cache costs a map lookup while an uncached one costs a decode, and
/// the plan is registered before the first block is read so the percentage
/// never sprints through the cheap passes.
struct ScanPlan {
    available_ids: Vec<u32>,
    override_ids: Vec<u32>,
    cached_source: Vec<(u32, u64)>,
    uncached_source: Vec<u32>,
    redundant_cached: Vec<u32>,
    redundant_pending: Vec<u32>,
}

fn scan_plan(
    snapshot: &OptimizationSnapshot,
    tracker: &OptimizationProgressTracker,
) -> Result<ScanPlan> {
    let mut available_ids = Vec::new();
    for id in 1..=snapshot.sprite_count {
        if id.is_multiple_of(4096) {
            tracker.advance(OptimizationStage::Indexing, id as usize)?;
        }
        if snapshot.removed_sprite_ids.contains(&id) {
            continue;
        }
        let stored = snapshot
            .sprite_storage_sizes
            .get(usize::try_from(id - 1).unwrap_or_default())
            .copied()
            .unwrap_or_default();
        if snapshot.sprite_overrides.contains_key(&id) || stored > 0 {
            available_ids.push(id);
        }
    }
    available_ids.extend(
        snapshot
            .sprite_overrides
            .keys()
            .filter(|id| **id > snapshot.sprite_count && !snapshot.removed_sprite_ids.contains(id))
            .copied(),
    );
    available_ids.sort_unstable();
    available_ids.dedup();
    let mut override_ids = snapshot
        .sprite_overrides
        .keys()
        .filter(|id| !snapshot.removed_sprite_ids.contains(id))
        .copied()
        .collect::<Vec<_>>();
    override_ids.sort_unstable();
    let cached_checksum = |id: u32| {
        usize::try_from(id.saturating_sub(1))
            .ok()
            .and_then(|index| snapshot.source_sprite_checksums.get(index))
            .and_then(|checksum| *checksum)
            .map(NonZeroU64::get)
    };
    let mut cached_source = Vec::new();
    let mut uncached_source = Vec::new();
    let mut redundant_cached = Vec::new();
    let mut redundant_pending = Vec::new();
    if let Some(source) = snapshot.sprite_source.as_ref() {
        for id in available_ids
            .iter()
            .copied()
            .filter(|id| *id <= source.header.sprite_count)
        {
            if snapshot.sprite_overrides.contains_key(&id) {
                continue;
            }
            match cached_checksum(id) {
                Some(checksum) => cached_source.push((id, checksum)),
                None => uncached_source.push(id),
            }
        }
        // The redundancy pass only looks at referenced overrides that shadow a
        // block the archive really holds — see `redundant_overrides`.
        for id in override_ids.iter().copied() {
            let stored = usize::try_from(id.saturating_sub(1))
                .ok()
                .filter(|_| id != 0 && id <= source.header.sprite_count)
                .and_then(|index| snapshot.sprite_storage_sizes.get(index))
                .copied()
                .unwrap_or_default();
            if stored == 0 || snapshot.sprite_usage.usage_count(id) == 0 {
                continue;
            }
            match cached_checksum(id) {
                Some(_) => redundant_cached.push(id),
                None => redundant_pending.push(id),
            }
        }
        redundant_pending.sort_unstable();
    }
    tracker.advance(OptimizationStage::Indexing, snapshot.sprite_count as usize)?;
    Ok(ScanPlan {
        available_ids,
        override_ids,
        cached_source,
        uncached_source,
        redundant_cached,
        redundant_pending,
    })
}

fn optimization_analysis_with_progress(
    snapshot: &OptimizationSnapshot,
    tracker: &OptimizationProgressTracker,
) -> Result<OptimizationComputation> {
    tracker.plan(&[(OptimizationStage::Indexing, snapshot.sprite_count as usize)]);
    tracker.begin(OptimizationStage::Indexing)?;
    let plan = scan_plan(snapshot, tracker)?;
    let ScanPlan {
        available_ids,
        override_ids: override_scan_ids,
        cached_source,
        uncached_source,
        redundant_cached,
        redundant_pending,
    } = plan;
    // Every stage is registered before the first block is read, so the overall
    // percentage is a share of the whole run from its first event on.
    tracker.plan(&[
        (OptimizationStage::HashingOverrides, override_scan_ids.len()),
        (
            OptimizationStage::ComparingOverrides,
            redundant_pending.len(),
        ),
        (OptimizationStage::ReadingChecksums, cached_source.len()),
        (OptimizationStage::DecodingSprites, uncached_source.len()),
        // Corrected to the bucket count once the hashes exist.
        (
            OptimizationStage::Grouping,
            override_scan_ids.len() + cached_source.len() + uncached_source.len(),
        ),
    ]);
    tracker.seal();
    tracker.finish(OptimizationStage::Indexing)?;
    let override_ids = snapshot
        .sprite_overrides
        .keys()
        .copied()
        .collect::<HashSet<_>>();
    let in_use = available_ids
        .iter()
        .filter(|id| snapshot.sprite_usage.usage_count(**id) > 0)
        .count();
    let statistics = SpriteStatistics {
        total: available_ids.len(),
        in_use,
        unused: available_ids.len().saturating_sub(in_use),
        objects_using_sprites: snapshot.sprite_usage.objects_using_sprites(),
        used_multiple_times: available_ids
            .iter()
            .filter(|id| snapshot.sprite_usage.usage_count(**id) > 1)
            .count(),
        invalid_references: snapshot
            .sprite_usage
            .referenced_ids()
            .filter(|id| *id > snapshot.sprite_count && !override_ids.contains(id))
            .count(),
    };
    let unused = available_ids
        .iter()
        .filter(|id| snapshot.sprite_usage.usage_count(**id) == 0)
        .copied()
        .collect::<Vec<_>>();
    let unused_source_ids = unused
        .iter()
        .filter(|id| !override_ids.contains(id))
        .copied()
        .collect::<Vec<_>>();
    let unused_source_reclaimable_bytes = unused_source_ids
        .iter()
        .filter_map(|id| {
            snapshot
                .sprite_storage_sizes
                .get(usize::try_from(*id - 1).ok()?)
        })
        .copied()
        .sum::<u64>();
    let mut unused_override_ids = snapshot
        .sprite_overrides
        .keys()
        .filter(|id| snapshot.sprite_usage.usage_count(**id) == 0)
        .copied()
        .collect::<Vec<_>>();
    unused_override_ids.sort_unstable();
    let reclaimable_bytes = unused_override_ids
        .iter()
        .filter_map(|id| snapshot.sprite_overrides.get(id))
        .map(|image| image.rgba.len())
        .sum();
    let mut invalid_reference_preview = snapshot
        .sprite_usage
        .referenced_ids()
        .filter(|id| *id > snapshot.sprite_count && !override_ids.contains(id))
        .collect::<Vec<_>>();
    invalid_reference_preview.sort_unstable();
    let invalid_reference_count = invalid_reference_preview.len();
    // A referenced slot inside the archive range that holds no block decodes to
    // nothing. The offset table is only trusted when it was actually measured,
    // so a workspace without storage sizes reports no empty slot at all instead
    // of clearing every reference it owns.
    let mut empty_slot_ids = if snapshot.sprite_storage_sizes.len()
        >= usize::try_from(snapshot.sprite_count).unwrap_or(usize::MAX)
    {
        snapshot
            .sprite_usage
            .referenced_ids()
            .filter(|id| *id != 0 && *id <= snapshot.sprite_count && !override_ids.contains(id))
            .filter(|id| {
                snapshot.removed_sprite_ids.contains(id)
                    || snapshot
                        .sprite_storage_sizes
                        .get(usize::try_from(*id - 1).unwrap_or_default())
                        .copied()
                        .unwrap_or_default()
                        == 0
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    empty_slot_ids.sort_unstable();
    let empty_slot_count = empty_slot_ids.len();
    let empty_slot_reference_count = empty_slot_ids
        .iter()
        .map(|id| snapshot.sprite_usage.usage_count(*id))
        .sum::<usize>();
    // Every sprite that decodes to full transparency hashes to the same value,
    // so blankness is answered by the checksum the scan already produces and
    // stays free for source sprites resolved from the cache.
    let sprite_side = snapshot
        .sprite_source
        .as_ref()
        .map(|source| u32::from(source.sprite_size))
        .unwrap_or(32);
    let mut blank_checksums = HashSet::new();
    let blank_pixels = usize::try_from(sprite_side)
        .unwrap_or_default()
        .saturating_mul(usize::try_from(sprite_side).unwrap_or_default())
        .saturating_mul(4);
    blank_checksums.insert(sprite_checksum(&SpriteImage::new(
        sprite_side,
        sprite_side,
        vec![0; blank_pixels],
    )?));
    let mut hashes: HashMap<u64, Vec<DuplicateSpriteCandidate>> = HashMap::new();
    let mut override_checksums: HashMap<u32, u64> = HashMap::new();
    tracker.begin(OptimizationStage::HashingOverrides)?;
    for (scanned, id) in override_scan_ids.iter().copied().enumerate() {
        let Some(image) = snapshot.sprite_overrides.get(&id) else {
            continue;
        };
        let checksum = sprite_checksum(image);
        override_checksums.insert(id, checksum);
        if image.rgba.chunks_exact(4).all(|pixel| pixel[3] == 0) {
            blank_checksums.insert(checksum);
        }
        hashes
            .entry(checksum)
            .or_default()
            .push(DuplicateSpriteCandidate {
                id,
                usage_count: snapshot.sprite_usage.usage_count(id),
                storage_bytes: encoded_sprite_storage_size(
                    image,
                    snapshot
                        .sprite_source
                        .as_ref()
                        .is_some_and(|source| source.transparency),
                )?,
                origin: "Override",
            });
        if scanned.is_multiple_of(64) {
            tracker.advance(OptimizationStage::HashingOverrides, scanned + 1)?;
        }
    }
    tracker.finish(OptimizationStage::HashingOverrides)?;
    let mut discovered_source_checksums = Vec::new();
    tracker.begin(OptimizationStage::ComparingOverrides)?;
    let (redundant_override_ids, redundant_override_bytes) = redundant_overrides(
        snapshot,
        &override_checksums,
        &redundant_cached,
        &redundant_pending,
        &mut discovered_source_checksums,
        tracker,
    )?;
    tracker.finish(OptimizationStage::ComparingOverrides)?;
    let redundant_override_count = redundant_override_ids.len();
    tracker.begin(OptimizationStage::ReadingChecksums)?;
    for (scanned, (id, checksum)) in cached_source.iter().copied().enumerate() {
        hashes
            .entry(checksum)
            .or_default()
            .push(DuplicateSpriteCandidate {
                id,
                usage_count: snapshot.sprite_usage.usage_count(id),
                storage_bytes: snapshot
                    .sprite_storage_sizes
                    .get(usize::try_from(id - 1).unwrap_or_default())
                    .copied()
                    .unwrap_or_default(),
                origin: "SPR",
            });
        if scanned.is_multiple_of(1024) {
            tracker.advance(OptimizationStage::ReadingChecksums, scanned + 1)?;
        }
    }
    tracker.finish(OptimizationStage::ReadingChecksums)?;
    tracker.begin(OptimizationStage::DecodingSprites)?;
    if let Some(source) = snapshot.sprite_source.as_ref() {
        if !uncached_source.is_empty() {
            // Each worker scans a contiguous range with its own file handle. This
            // keeps disk access predictable while decoding and hashing sprites on
            // a bounded set of available CPU cores. Workers return only compact
            // metadata, not decoded RGBA buffers, so peak memory remains bounded.
            let available_workers = thread::available_parallelism()
                .map(|value| value.get())
                .unwrap_or(1)
                .min(8);
            let worker_count = available_workers
                .min(uncached_source.len().div_ceil(512))
                .max(1);
            let chunk_size = uncached_source.len().div_ceil(worker_count);
            let decoded = AtomicUsize::new(0);
            let worker_results = thread::scope(|scope| {
                let mut workers = Vec::with_capacity(worker_count);
                for ids in uncached_source.chunks(chunk_size) {
                    let decoded = &decoded;
                    workers.push(scope.spawn(
                        || -> Result<Vec<(u32, u64, DuplicateSpriteCandidate)>> {
                            let mut results = Vec::with_capacity(ids.len());
                            visit_sprites(source, ids, |id, image| {
                                let checksum = sprite_checksum(&image);
                                results.push((
                                    id,
                                    checksum,
                                    DuplicateSpriteCandidate {
                                        id,
                                        usage_count: snapshot.sprite_usage.usage_count(id),
                                        storage_bytes: snapshot
                                            .sprite_storage_sizes
                                            .get(usize::try_from(id - 1).unwrap_or_default())
                                            .copied()
                                            .unwrap_or_default(),
                                        origin: "SPR",
                                    },
                                ));
                                // Workers report the shared counter, so the
                                // dialog shows the run's real position however
                                // the chunks interleave.
                                let processed = decoded.fetch_add(1, Ordering::Relaxed) + 1;
                                if processed.is_multiple_of(64) {
                                    tracker
                                        .advance(OptimizationStage::DecodingSprites, processed)?;
                                }
                                Ok(())
                            })?;
                            Ok(results)
                        },
                    ));
                }
                workers
                    .into_iter()
                    .map(|worker| {
                        worker.join().map_err(|_| {
                            ObjectBuilderError::CorruptedFile(
                                "sprite checksum worker panicked".into(),
                            )
                        })?
                    })
                    .collect::<Result<Vec<_>>>()
            })?;
            for worker_result in worker_results {
                for (id, checksum, candidate) in worker_result {
                    discovered_source_checksums.push((id, checksum));
                    hashes.entry(checksum).or_default().push(candidate);
                }
            }
            discovered_source_checksums.sort_unstable_by_key(|(id, _)| *id);
        }
    }
    tracker.finish(OptimizationStage::DecodingSprites)?;
    // Blank sprites are pulled out of deduplication on purpose: collapsing them
    // onto a single keeper would leave objects pointing at an image that draws
    // nothing, while clearing the reference removes the sprite for good. Only
    // referenced blanks are listed — an unused one already belongs to the unused
    // operations, and counting it twice would inflate the reclaim estimate.
    let mut blank_sprite_ids = Vec::new();
    let mut blank_reclaimable_bytes = 0_u64;
    let mut blank_reference_count = 0_usize;
    for checksum in &blank_checksums {
        for candidate in hashes.get(checksum).map(Vec::as_slice).unwrap_or_default() {
            if candidate.usage_count == 0 {
                continue;
            }
            blank_sprite_ids.push(candidate.id);
            blank_reclaimable_bytes =
                blank_reclaimable_bytes.saturating_add(candidate.storage_bytes);
            blank_reference_count += candidate.usage_count;
        }
    }
    blank_sprite_ids.sort_unstable();
    let blank_sprite_count = blank_sprite_ids.len();
    let mut duplicate_groups = Vec::new();
    tracker.set_total(OptimizationStage::Grouping, hashes.len());
    tracker.begin(OptimizationStage::Grouping)?;
    for (index, (checksum, mut sprites)) in hashes.into_iter().enumerate() {
        if index.is_multiple_of(512) {
            tracker.advance(OptimizationStage::Grouping, index + 1)?;
        }
        if blank_checksums.contains(&checksum) {
            continue;
        }
        if sprites.len() > 1 {
            sprites.sort_by_key(|sprite| sprite.id);
            let sprite_count = sprites.len();
            duplicate_groups.push(DuplicateSpriteGroup {
                checksum: format!("{checksum:016x}"),
                sprites,
                sprite_count,
            });
        }
    }
    duplicate_groups.sort_by_key(|group| group.sprites[0].id);
    tracker.finish(OptimizationStage::Grouping)?;
    let duplicate_reclaimable_bytes = duplicate_groups
        .iter()
        .flat_map(|group| group.sprites.iter().skip(1))
        .map(|sprite| sprite.storage_bytes)
        .sum();
    let duplicate_group_count = duplicate_groups.len();
    let duplicate_candidate_count = duplicate_groups
        .iter()
        .map(|group| group.sprites.len())
        .sum();
    let unused_override_count = unused_override_ids.len();
    Ok(OptimizationComputation {
        analysis: OptimizationAnalysis {
            estimated_reduction_percent: if statistics.total == 0 {
                0.0
            } else {
                statistics.unused as f64 * 100.0 / statistics.total as f64
            },
            statistics,
            // Kept complete for the apply pass and truncated before IPC.
            unused_preview: unused,
            unused_source_count: unused_source_ids.len(),
            unused_source_reclaimable_bytes,
            unused_source_preview: unused_source_ids,
            unused_override_ids,
            unused_override_count,
            invalid_reference_preview,
            invalid_reference_count,
            blank_sprite_ids,
            blank_sprite_count,
            blank_reference_count,
            blank_reclaimable_bytes,
            empty_slot_ids,
            empty_slot_count,
            empty_slot_reference_count,
            redundant_override_ids,
            redundant_override_count,
            redundant_override_bytes,
            duplicate_groups,
            duplicate_group_count,
            duplicate_candidate_count,
            reclaimable_bytes,
            duplicate_reclaimable_bytes,
        },
        discovered_source_checksums,
    })
}

/// Finds overrides whose decoded pixels match the SPR sprite they shadow. Only
/// referenced overrides are reported — an unused one is already removed by the
/// unused-override operation, and listing it twice would double the estimate.
///
/// The candidates were split by `scan_plan`: `cached` is answered from the
/// checksum cache for free, and only `pending` reaches the archive. The sprites
/// decoded here are handed back so the workspace remembers them like the main
/// scan does.
fn redundant_overrides(
    snapshot: &OptimizationSnapshot,
    override_checksums: &HashMap<u32, u64>,
    cached: &[u32],
    pending: &[u32],
    discovered_source_checksums: &mut Vec<(u32, u64)>,
    tracker: &OptimizationProgressTracker,
) -> Result<(Vec<u32>, u64)> {
    let Some(source) = snapshot.sprite_source.as_ref() else {
        return Ok((Vec::new(), 0));
    };
    let mut redundant = Vec::new();
    for id in cached.iter().copied() {
        let cached_checksum = usize::try_from(id.saturating_sub(1))
            .ok()
            .and_then(|index| snapshot.source_sprite_checksums.get(index))
            .and_then(|checksum| *checksum);
        if let (Some(cached_checksum), Some(checksum)) =
            (cached_checksum, override_checksums.get(&id))
        {
            if cached_checksum.get() == *checksum {
                redundant.push(id);
            }
        }
    }
    if !pending.is_empty() {
        let mut scanned = 0_usize;
        visit_sprites(source, pending, |id, image| {
            let checksum = sprite_checksum(&image);
            discovered_source_checksums.push((id, checksum));
            if override_checksums.get(&id) == Some(&checksum) {
                redundant.push(id);
            }
            scanned += 1;
            if scanned.is_multiple_of(16) {
                tracker.advance(OptimizationStage::ComparingOverrides, scanned)?;
            }
            Ok(())
        })?;
    }
    redundant.sort_unstable();
    let bytes = redundant
        .iter()
        .filter_map(|id| snapshot.sprite_overrides.get(id))
        .map(|image| image.rgba.len() as u64)
        .sum();
    Ok((redundant, bytes))
}

fn compact_optimization_analysis_for_ipc(
    mut analysis: OptimizationAnalysis,
) -> OptimizationAnalysis {
    analysis
        .duplicate_groups
        .truncate(IPC_DUPLICATE_GROUP_LIMIT);
    for group in &mut analysis.duplicate_groups {
        group.sprites.truncate(IPC_DUPLICATE_CANDIDATE_LIMIT);
    }
    analysis.unused_override_ids.truncate(IPC_ID_PREVIEW_LIMIT);
    analysis.unused_preview.truncate(IPC_ID_PREVIEW_LIMIT);
    analysis
        .unused_source_preview
        .truncate(IPC_ID_PREVIEW_LIMIT);
    analysis
        .invalid_reference_preview
        .truncate(IPC_ID_PREVIEW_LIMIT);
    analysis.blank_sprite_ids.truncate(IPC_ID_PREVIEW_LIMIT);
    analysis.empty_slot_ids.truncate(IPC_ID_PREVIEW_LIMIT);
    analysis
        .redundant_override_ids
        .truncate(IPC_ID_PREVIEW_LIMIT);
    analysis
}

fn remember_source_checksums(state: &State<'_, AppState>, discovered: &[(u32, u64)]) -> Result<()> {
    if discovered.is_empty() {
        return Ok(());
    }
    let mut workspace = lock_workspace(state)?;
    let checksums = Arc::make_mut(&mut workspace.source_sprite_checksums);
    for &(id, checksum) in discovered {
        let Some(slot) = id
            .checked_sub(1)
            .and_then(|index| checksums.get_mut(index as usize))
        else {
            continue;
        };
        *slot = NonZeroU64::new(checksum);
    }
    Ok(())
}

#[tauri::command]
pub async fn analyze_optimization(
    app: AppHandle,
    state: State<'_, AppState>,
    analysis_id: String,
    on_progress: Channel<OptimizationProgress>,
) -> Result<OptimizationAnalysis> {
    let (cancellation, _registration) = register_optimization(state.inner(), analysis_id.clone())?;
    let snapshot = {
        let workspace = lock_workspace(&state)?;
        optimization_snapshot(&workspace)
    };
    let tracker = OptimizationProgressTracker::new(on_progress, cancellation);
    let result = tauri::async_runtime::spawn_blocking(move || {
        optimization_analysis_with_progress(&snapshot, &tracker)
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()));
    let computation = result??;
    remember_source_checksums(&state, &computation.discovered_source_checksums)?;
    let analysis = compact_optimization_analysis_for_ipc(computation.analysis);
    emit_log(
        &app,
        "INFO",
        format!(
            "Optimization analysis: {} used, {} unused sprites",
            analysis.statistics.in_use, analysis.statistics.unused
        ),
        None,
        Some(format!(
            "{} invalid references; {} unused overrides; {} duplicate groups",
            analysis.statistics.invalid_references,
            analysis.unused_override_count,
            analysis.duplicate_group_count
        )),
    );
    Ok(analysis)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationResult {
    pub removed_overrides: usize,
    pub removed_duplicates: usize,
    pub removed_unused_sprites: usize,
    pub removed_blank_sprites: usize,
    pub dropped_redundant_overrides: usize,
    pub cleared_blank_references: usize,
    pub cleared_empty_references: usize,
    pub repaired_invalid_references: usize,
    pub remapped_references: usize,
    pub reclaimed_bytes: u64,
    pub sprite_replacements: HashMap<u32, u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationRequest {
    #[serde(default)]
    pub duplicate_keepers: HashMap<String, u32>,
    #[serde(default = "default_true")]
    pub optimize_duplicates: bool,
    #[serde(default = "default_true")]
    pub remove_unused_sprites: bool,
    #[serde(default = "default_true")]
    pub remove_unused_overrides: bool,
    #[serde(default = "default_true")]
    pub remove_blank_sprites: bool,
    #[serde(default = "default_true")]
    pub drop_redundant_overrides: bool,
    #[serde(default = "default_true")]
    pub clear_empty_references: bool,
    #[serde(default = "default_true")]
    pub repair_invalid_references: bool,
}

const fn default_true() -> bool {
    true
}

/// The size an operation contributes to the staging stage, or nothing when the
/// dialog left it switched off.
const fn optional_count(enabled: bool, count: usize) -> usize {
    if enabled {
        count
    } else {
        0
    }
}

impl Default for OptimizationRequest {
    fn default() -> Self {
        Self {
            duplicate_keepers: HashMap::new(),
            optimize_duplicates: true,
            remove_unused_sprites: true,
            remove_unused_overrides: true,
            remove_blank_sprites: true,
            drop_redundant_overrides: true,
            clear_empty_references: true,
            repair_invalid_references: true,
        }
    }
}

#[tauri::command]
pub async fn optimize_project(
    app: AppHandle,
    state: State<'_, AppState>,
    request: OptimizationRequest,
    analysis_id: String,
    on_progress: Channel<OptimizationProgress>,
) -> Result<OptimizationResult> {
    let (cancellation, _registration) = register_optimization(state.inner(), analysis_id.clone())?;
    let (snapshot, object_count) = {
        let workspace = lock_workspace(&state)?;
        (
            optimization_snapshot(&workspace),
            workspace.database.objects.len(),
        )
    };
    let tracker = Arc::new(OptimizationProgressTracker::new(
        on_progress,
        cancellation.clone(),
    ));
    // Applying is registered before the scan that precedes it, so the bar is a
    // share of the whole run and not of the scan alone — it used to sit at 100%
    // for as long as the rewrite took.
    tracker.plan_tail(&[
        // Sized once the analysis says how many sprites each enabled operation
        // claims.
        (OptimizationStage::StagingRemovals, 0),
        (OptimizationStage::RewritingReferences, object_count),
        (OptimizationStage::RebuildingIndex, object_count),
    ]);
    let scan_tracker = tracker.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        optimization_analysis_with_progress(&snapshot, &scan_tracker)
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()));
    let computation = result??;
    remember_source_checksums(&state, &computation.discovered_source_checksums)?;
    let analysis = computation.analysis;
    ensure_optimization_active(&cancellation)?;
    let mut workspace = lock_workspace(&state)?;
    // Blank sprites go first: every later operation filters against the IDs this
    // pass already claimed, so no byte is reclaimed twice and no removed sprite
    // is elected keeper of a duplicate group.
    let blank_ids = request
        .remove_blank_sprites
        .then(|| {
            analysis
                .blank_sprite_ids
                .iter()
                .copied()
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    tracker.set_total(
        OptimizationStage::StagingRemovals,
        blank_ids.len()
            + optional_count(
                request.optimize_duplicates,
                analysis
                    .duplicate_candidate_count
                    .saturating_sub(analysis.duplicate_group_count),
            )
            + optional_count(
                request.remove_unused_overrides,
                analysis.unused_override_count,
            )
            + optional_count(request.remove_unused_sprites, analysis.unused_source_count)
            + optional_count(
                request.drop_redundant_overrides,
                analysis.redundant_override_count,
            ),
    );
    tracker.begin(OptimizationStage::StagingRemovals)?;
    let mut staged = 0_usize;
    let mut blank_reclaimed_bytes = 0_u64;
    for id in &blank_ids {
        let bytes = match workspace.sprite_overrides.remove(id) {
            Some(image) => image.rgba.len() as u64,
            None => usize::try_from(*id - 1)
                .ok()
                .and_then(|index| workspace.sprite_storage_sizes.get(index))
                .copied()
                .unwrap_or_default(),
        };
        blank_reclaimed_bytes = blank_reclaimed_bytes.saturating_add(bytes);
        workspace.removed_sprite_ids.insert(*id);
    }
    let removed_blank_sprites = blank_ids.len();
    staged += removed_blank_sprites;
    tracker.advance(OptimizationStage::StagingRemovals, staged)?;
    let mut replacements = HashMap::new();
    let mut keeper_ids = HashSet::new();
    let mut duplicate_reclaimed_bytes = 0_u64;
    for group in analysis
        .duplicate_groups
        .iter()
        .filter(|_| request.optimize_duplicates)
    {
        let candidates = group
            .sprites
            .iter()
            .filter(|sprite| !blank_ids.contains(&sprite.id))
            .collect::<Vec<_>>();
        let Some(default_keeper) = candidates.first().map(|sprite| sprite.id) else {
            continue;
        };
        if candidates.len() < 2 {
            continue;
        }
        let keeper = request
            .duplicate_keepers
            .get(&group.checksum)
            .copied()
            .filter(|keeper| !blank_ids.contains(keeper))
            .unwrap_or(default_keeper);
        if !group.sprites.iter().any(|sprite| sprite.id == keeper) {
            return Err(ObjectBuilderError::SerializationError(format!(
                "sprite {keeper} does not belong to duplicate group {}",
                group.checksum
            )));
        }
        keeper_ids.insert(keeper);
        for sprite in candidates {
            if sprite.id != keeper {
                replacements.insert(sprite.id, keeper);
                duplicate_reclaimed_bytes =
                    duplicate_reclaimed_bytes.saturating_add(sprite.storage_bytes);
            }
        }
    }
    staged += replacements.len();
    tracker.advance(OptimizationStage::StagingRemovals, staged)?;
    let unused_override_ids = if request.remove_unused_overrides {
        analysis
            .unused_override_ids
            .iter()
            .filter(|id| !keeper_ids.contains(id) && !replacements.contains_key(id))
            .filter(|id| !blank_ids.contains(id))
            .copied()
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let unused_reclaimed_bytes = unused_override_ids
        .iter()
        .filter_map(|id| workspace.sprite_overrides.get(id))
        .map(|image| image.rgba.len() as u64)
        .sum::<u64>();
    for id in &unused_override_ids {
        workspace.sprite_overrides.remove(id);
    }
    let removed_overrides = unused_override_ids.len();
    staged += removed_overrides;
    tracker.advance(OptimizationStage::StagingRemovals, staged)?;
    let unused_source_ids = if request.remove_unused_sprites {
        analysis
            .unused_source_preview
            .iter()
            .filter(|id| **id <= workspace.sprite_count)
            .filter(|id| !workspace.sprite_overrides.contains_key(id))
            .filter(|id| !replacements.contains_key(id))
            .filter(|id| !blank_ids.contains(id))
            .filter(|id| {
                !keeper_ids.contains(id) && !replacements.values().any(|value| value == *id)
            })
            .copied()
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let unused_source_reclaimed_bytes = unused_source_ids
        .iter()
        .filter_map(|id| {
            workspace
                .sprite_storage_sizes
                .get(usize::try_from(*id - 1).ok()?)
        })
        .copied()
        .sum::<u64>();
    for id in &unused_source_ids {
        workspace.removed_sprite_ids.insert(*id);
    }
    let removed_unused_sprites = unused_source_ids.len();
    staged += removed_unused_sprites;
    tracker.advance(OptimizationStage::StagingRemovals, staged)?;
    // The source block stays in the archive, so dropping the override only gives
    // back the decoded buffer it was holding in memory.
    let mut redundant_override_bytes = 0_u64;
    let mut dropped_redundant_overrides = 0;
    if request.drop_redundant_overrides {
        for id in &analysis.redundant_override_ids {
            if blank_ids.contains(id) || replacements.contains_key(id) {
                continue;
            }
            if let Some(image) = workspace.sprite_overrides.remove(id) {
                redundant_override_bytes =
                    redundant_override_bytes.saturating_add(image.rgba.len() as u64);
                dropped_redundant_overrides += 1;
            }
        }
    }
    tracker.finish(OptimizationStage::StagingRemovals)?;
    let reclaimed_bytes = unused_reclaimed_bytes
        .saturating_add(unused_source_reclaimed_bytes)
        .saturating_add(duplicate_reclaimed_bytes)
        .saturating_add(blank_reclaimed_bytes)
        .saturating_add(redundant_override_bytes);
    let mut remapped_references = 0;
    let invalid_ids = request
        .repair_invalid_references
        .then(|| {
            analysis
                .invalid_reference_preview
                .iter()
                .copied()
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let empty_slot_ids = request
        .clear_empty_references
        .then(|| {
            analysis
                .empty_slot_ids
                .iter()
                .copied()
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let mut repaired_invalid_references = 0;
    let mut cleared_blank_references = 0;
    let mut cleared_empty_references = 0;
    tracker.begin(OptimizationStage::RewritingReferences)?;
    for (rewritten, object) in workspace.database.objects.iter_mut().enumerate() {
        if rewritten.is_multiple_of(256) {
            tracker.advance(OptimizationStage::RewritingReferences, rewritten + 1)?;
        }
        let mut changed = false;
        for group in &mut object.frame_groups {
            for id in &mut group.sprite_ids {
                if let Some(keeper) = replacements.get(id) {
                    *id = *keeper;
                    remapped_references += 1;
                    changed = true;
                } else if blank_ids.contains(id) {
                    *id = 0;
                    cleared_blank_references += 1;
                    changed = true;
                } else if empty_slot_ids.contains(id) {
                    *id = 0;
                    cleared_empty_references += 1;
                    changed = true;
                } else if invalid_ids.contains(id) {
                    *id = 0;
                    repaired_invalid_references += 1;
                    changed = true;
                }
            }
            for frame in &mut group.frames {
                if let Some(keeper) = replacements.get(&frame.sprite_id) {
                    frame.sprite_id = *keeper;
                    changed = true;
                } else if blank_ids.contains(&frame.sprite_id)
                    || empty_slot_ids.contains(&frame.sprite_id)
                    || invalid_ids.contains(&frame.sprite_id)
                {
                    frame.sprite_id = 0;
                    changed = true;
                }
            }
        }
        if let Some(keeper) = replacements.get(&object.sprite_id) {
            object.sprite_id = *keeper;
            changed = true;
        } else if blank_ids.contains(&object.sprite_id)
            || empty_slot_ids.contains(&object.sprite_id)
            || invalid_ids.contains(&object.sprite_id)
        {
            object.sprite_id = 0;
            changed = true;
        }
        if changed {
            object.modified = true;
            object.raw_record.clear();
        }
    }
    tracker.finish(OptimizationStage::RewritingReferences)?;
    for loser in replacements.keys() {
        workspace.sprite_overrides.remove(loser);
        workspace.removed_sprite_ids.insert(*loser);
    }
    let removed_duplicates = replacements.len();
    let mut sprite_replacements = replacements.clone();
    sprite_replacements.extend(
        invalid_ids
            .iter()
            .chain(blank_ids.iter())
            .chain(empty_slot_ids.iter())
            .map(|id| (*id, 0)),
    );
    if removed_overrides > 0
        || removed_duplicates > 0
        || removed_unused_sprites > 0
        || removed_blank_sprites > 0
        || dropped_redundant_overrides > 0
        || cleared_empty_references > 0
        || repaired_invalid_references > 0
    {
        workspace.dirty = true;
        workspace.history.clear();
        workspace.sprite_cache.clear();
        tracker.begin(OptimizationStage::RebuildingIndex)?;
        rebuild_sprite_usage(&mut workspace);
    }
    // Closed even when nothing changed: the dialog reads a plan that ends, not
    // one that stops wherever the run happened to stop.
    tracker.finish(OptimizationStage::RebuildingIndex)?;
    emit_log(
        &app,
        "INFO",
        format!("Optimization completed: removed {removed_duplicates} duplicates, {removed_unused_sprites} unused sprites, {removed_blank_sprites} blank sprites and {removed_overrides} unused overrides"),
        None,
        Some(format!(
            "{reclaimed_bytes} bytes will be reclaimed on Save; {remapped_references} references were redirected, {dropped_redundant_overrides} redundant overrides dropped and {repaired_invalid_references} invalid, {cleared_empty_references} empty and {cleared_blank_references} blank references cleared."
        )),
    );
    Ok(OptimizationResult {
        removed_overrides,
        removed_blank_sprites,
        dropped_redundant_overrides,
        cleared_blank_references,
        cleared_empty_references,
        removed_duplicates,
        removed_unused_sprites,
        repaired_invalid_references,
        remapped_references,
        reclaimed_bytes,
        sprite_replacements,
    })
}

#[tauri::command]
pub fn cancel_optimization(state: State<'_, AppState>, analysis_id: String) -> Result<bool> {
    let analyses = state.1.lock().map_err(|_| {
        ObjectBuilderError::CorruptedFile("optimization registry lock was poisoned".into())
    })?;
    Ok(analyses.get(&analysis_id).is_some_and(|flag| {
        flag.store(true, Ordering::Relaxed);
        true
    }))
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryUsage {
    /// Absent while the workspace is busy — see `get_memory_usage`.
    pub cache_bytes: Option<usize>,
    pub cache_capacity_bytes: Option<usize>,
    /// Absent where the platform has no reader; the status bar then omits it.
    pub process_bytes: Option<u64>,
}

/// Reports the footprint the status bar polls a few times a minute.
///
/// The cache figures are read with `try_lock`: a save or an optimization holds
/// the workspace for minutes, and a poll that waited would queue one blocked
/// command thread every couple of seconds for the whole run. Busy means the
/// numbers are simply not refreshed — the status bar keeps the last ones.
#[tauri::command]
pub fn get_memory_usage(state: State<'_, AppState>) -> MemoryUsage {
    let workspace = state.0.try_lock().ok();
    MemoryUsage {
        cache_bytes: workspace
            .as_ref()
            .map(|workspace| workspace.sprite_cache.used_bytes()),
        cache_capacity_bytes: workspace
            .as_ref()
            .map(|workspace| workspace.sprite_cache.capacity_bytes()),
        process_bytes: process_memory_bytes(),
    }
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
pub async fn get_sprite(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u32,
) -> Result<SpriteImage> {
    let source = {
        let mut workspace = lock_workspace(&state)?;
        if workspace.removed_sprite_ids.contains(&id) {
            return Err(ObjectBuilderError::InvalidSprite(format!(
                "sprite {id} was removed by optimization"
            )));
        }
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
    let source_path = source.path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || read_sprite(&source, id))
        .await
        .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?;
    let image = match result {
        Ok(image) => image,
        Err(error) => {
            emit_log(
                &app,
                "WARNING",
                format!("Failed to load sprite {id}"),
                None,
                Some(error.to_string()),
            );
            return Err(error);
        }
    };
    let checksum = sprite_checksum(&image);
    let mut workspace = lock_workspace(&state)?;
    if workspace
        .sprite_source
        .as_ref()
        .is_some_and(|source| source.path == source_path)
    {
        // Do not clone the checksum table while an analysis holds a read-only
        // Arc snapshot. The analysis will fill any missing entry itself.
        if let Some(checksums) = Arc::get_mut(&mut workspace.source_sprite_checksums) {
            if let Some(slot) = id
                .checked_sub(1)
                .and_then(|index| checksums.get_mut(usize::try_from(index).unwrap_or_default()))
            {
                *slot = NonZeroU64::new(checksum);
            }
        }
        workspace.sprite_cache.insert(id, image.clone());
    }
    Ok(image)
}

#[tauri::command]
pub fn get_object_dimensions(
    state: State<'_, AppState>,
    identity: ObjectIdentity,
) -> Result<ObjectDimensions> {
    let workspace = lock_workspace(&state)?;
    let object = workspace
        .database
        .objects
        .iter()
        .find(|object| object.id == identity.id && object.kind == identity.kind)
        .ok_or(ObjectBuilderError::ObjectNotFound(identity.id))?;
    let sprite_size = workspace
        .sprite_source
        .as_ref()
        .map(|source| source.sprite_size)
        .unwrap_or(32);
    Ok(object_dimensions(object, sprite_size))
}

#[tauri::command]
pub async fn get_object_image(
    app: AppHandle,
    state: State<'_, AppState>,
    identity: ObjectIdentity,
    group_index: usize,
    frame_index: usize,
    pattern_index: usize,
    outfit_colors: Option<OutfitPreviewColors>,
    include_outfit_base: Option<bool>,
    all_outfit_addons: Option<bool>,
) -> Result<SpriteImage> {
    let (object, overrides, source, sprite_size) = {
        let workspace = lock_workspace(&state)?;
        let object = workspace
            .database
            .objects
            .iter()
            .find(|object| object.id == identity.id && object.kind == identity.kind)
            .cloned()
            .ok_or(ObjectBuilderError::ObjectNotFound(identity.id))?;
        let sprite_size = workspace
            .sprite_source
            .as_ref()
            .map(|source| source.sprite_size)
            .unwrap_or(32);
        let referenced = object
            .frame_groups
            .iter()
            .flat_map(|group| group.sprite_ids.iter().copied())
            .collect::<HashSet<_>>();
        let overrides = workspace
            .sprite_overrides
            .iter()
            .filter(|(id, _)| referenced.contains(id))
            .map(|(id, image)| (*id, image.clone()))
            .collect();
        (
            object,
            overrides,
            workspace.sprite_source.clone(),
            sprite_size,
        )
    };
    let object_label = format!("{:?} {}", identity.kind, identity.id);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut sprite_ids = Vec::new();
        let colors = outfit_colors.unwrap_or_default();
        let mut resolve = |id| {
            sprite_ids.push(id);
            resolved_sprite(&overrides, source.as_ref(), id)
        };
        let image = if all_outfit_addons.unwrap_or(false) && object.kind == ObjectKind::Outfit {
            render_outfit_preview_with_all_addons(
                &object,
                group_index,
                frame_index,
                pattern_index,
                sprite_size,
                colors,
                include_outfit_base.unwrap_or(false),
                &mut resolve,
            )
        } else if include_outfit_base.unwrap_or(false) && object.kind == ObjectKind::Outfit {
            render_outfit_preview_with_base(
                &object,
                group_index,
                frame_index,
                pattern_index,
                sprite_size,
                colors,
                &mut resolve,
            )
        } else {
            render_object_preview(
                &object,
                group_index,
                frame_index,
                pattern_index,
                sprite_size,
                colors,
                &mut resolve,
            )
        };
        sprite_ids.sort_unstable();
        sprite_ids.dedup();
        (image, sprite_ids)
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?;
    match result {
        (Ok(image), _) => Ok(image),
        (Err(error), sprite_ids) => {
            emit_log(
                &app,
                "WARNING",
                format!("Failed to render {object_label}"),
                None,
                Some(if sprite_ids.is_empty() {
                    error.to_string()
                } else {
                    format!(
                        "{} · sprites attempted: {}",
                        error,
                        sprite_ids
                            .iter()
                            .map(u32::to_string)
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                }),
            );
            Err(error)
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameLayer {
    pub image: SpriteImage,
    /// The sprite id behind each tile, in `split_object_image` order. The editor keeps
    /// these so an undo can pin the tiles back to the sprites they came from.
    pub slot_ids: Vec<u32>,
}

/// One layer of one frame, uncomposited — the surface the pixel editor paints on.
#[tauri::command]
pub async fn get_object_frame_layer(
    state: State<'_, AppState>,
    identity: ObjectIdentity,
    group_index: usize,
    frame_index: usize,
    pattern_index: usize,
    layer: usize,
) -> Result<FrameLayer> {
    let (object, overrides, source, sprite_size) = {
        let workspace = lock_workspace(&state)?;
        let object = workspace
            .database
            .objects
            .iter()
            .find(|object| object.id == identity.id && object.kind == identity.kind)
            .cloned()
            .ok_or(ObjectBuilderError::ObjectNotFound(identity.id))?;
        let sprite_size = workspace
            .sprite_source
            .as_ref()
            .map(|source| source.sprite_size)
            .unwrap_or(32);
        let referenced = object
            .frame_groups
            .iter()
            .flat_map(|group| group.sprite_ids.iter().copied())
            .collect::<HashSet<_>>();
        let overrides = workspace
            .sprite_overrides
            .iter()
            .filter(|(id, _)| referenced.contains(id))
            .map(|(id, image)| (*id, image.clone()))
            .collect::<HashMap<_, _>>();
        (
            object,
            overrides,
            workspace.sprite_source.clone(),
            sprite_size,
        )
    };
    tauri::async_runtime::spawn_blocking(move || {
        let slots = frame_layer_slots(
            &object,
            group_index,
            frame_index,
            pattern_index,
            layer,
            sprite_size,
        )?;
        let slot_ids = object
            .frame_groups
            .get(group_index)
            .map(|group| {
                slots
                    .iter()
                    .map(|slot| group.sprite_ids.get(*slot).copied().unwrap_or_default())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let image = render_object_layer(
            &object,
            group_index,
            frame_index,
            pattern_index,
            layer,
            sprite_size,
            |id| resolved_sprite(&overrides, source.as_ref(), id),
        )?;
        Ok(FrameLayer { image, slot_ids })
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameLayerWrite {
    /// The object as it stands after the write. `sprite_ids` differs from the one the
    /// caller holds whenever a tile that had no sprite was painted for the first time.
    pub object: ThingObject,
    /// The sprite id now behind each tile, in `split_object_image` order. Undo replays
    /// the write with the ids it captured here, so a tile that was allocated goes back
    /// to being empty instead of leaving the object pointing at a blank sprite.
    pub slot_ids: Vec<u32>,
    /// Ids allocated by this write, i.e. tiles that held no sprite before it.
    pub allocated: Vec<u32>,
    /// Ids this write changed that other frames or objects also draw. Editing is in
    /// place by design, so this is the list the caller warns about.
    pub shared: Vec<u32>,
}

/// Writes one layer of one frame back into the SPR, in place: the sprite behind each
/// tile keeps its id and takes the new bytes, so every object drawing that sprite
/// draws the edit. A tile with no sprite gets one allocated, and only if the caller
/// actually painted something into it.
///
/// `slot_ids` is the undo channel: passing the ids a previous write reported pins each
/// tile back to the sprite it used to point at before the bytes are written.
#[tauri::command]
pub fn write_object_frame_layer(
    app: AppHandle,
    state: State<'_, AppState>,
    identity: ObjectIdentity,
    group_index: usize,
    frame_index: usize,
    pattern_index: usize,
    layer: usize,
    image: SpriteImage,
    slot_ids: Option<Vec<u32>>,
) -> Result<FrameLayerWrite> {
    let mut workspace = lock_workspace(&state)?;
    let index = workspace
        .database
        .objects
        .iter()
        .position(|object| object.id == identity.id && object.kind == identity.kind)
        .ok_or(ObjectBuilderError::ObjectNotFound(identity.id))?;
    let sprite_size = workspace
        .sprite_source
        .as_ref()
        .map(|source| source.sprite_size)
        .unwrap_or(32);
    let dimensions =
        frame_group_dimensions(&workspace.database.objects[index], group_index, sprite_size);
    if image.width != dimensions.pixel_width || image.height != dimensions.pixel_height {
        return Err(ObjectBuilderError::InvalidSprite(format!(
            "a frame layer must be {}×{} pixels; received {}×{}",
            dimensions.pixel_width, dimensions.pixel_height, image.width, image.height
        )));
    }
    let slots = frame_layer_slots(
        &workspace.database.objects[index],
        group_index,
        frame_index,
        pattern_index,
        layer,
        sprite_size,
    )?;
    if let Some(pinned) = slot_ids.as_ref() {
        if pinned.len() != slots.len() {
            return Err(ObjectBuilderError::InvalidSprite(format!(
                "expected {} tile ids, received {}",
                slots.len(),
                pinned.len()
            )));
        }
    }
    let tiles = split_object_image(
        &image,
        dimensions.tile_width,
        dimensions.tile_height,
        sprite_size,
    )?;
    let mut next = workspace
        .sprite_count
        .max(
            workspace
                .sprite_overrides
                .keys()
                .copied()
                .max()
                .unwrap_or_default(),
        )
        .saturating_add(1);
    let mut assignments = Vec::with_capacity(slots.len());
    let mut allocated = Vec::new();
    for (position, (slot, tile)) in slots.iter().zip(tiles).enumerate() {
        let pinned = slot_ids.as_ref().map(|ids| ids[position]);
        let current = pinned.unwrap_or_else(|| {
            workspace.database.objects[index].frame_groups[group_index].sprite_ids[*slot]
        });
        // An empty tile has no sprite to write over. Allocating one for bytes nobody
        // painted would grow the SPR by a blank sprite on every stroke that misses.
        if current == 0 && tile.rgba.iter().skip(3).step_by(4).all(|alpha| *alpha == 0) {
            assignments.push((*slot, 0, None));
            continue;
        }
        let id = if current == 0 {
            let id = next;
            next = next.saturating_add(1);
            allocated.push(id);
            id
        } else {
            current
        };
        assignments.push((*slot, id, Some(tile)));
    }
    let mut object_changed = false;
    let mut slot_result = Vec::with_capacity(assignments.len());
    for (slot, id, _) in &assignments {
        let group = &mut workspace.database.objects[index].frame_groups[group_index];
        if group.sprite_ids[*slot] != *id {
            group.sprite_ids[*slot] = *id;
            object_changed = true;
        }
        slot_result.push(*id);
    }
    for (_, id, tile) in assignments {
        if let Some(tile) = tile {
            workspace.removed_sprite_ids.remove(&id);
            workspace.sprite_overrides.insert(id, tile);
        }
    }
    if object_changed {
        let object = &mut workspace.database.objects[index];
        object.sprite_id = object
            .frame_groups
            .first()
            .and_then(|group| group.frames.first())
            .map(|frame| frame.sprite_id)
            .unwrap_or(object.sprite_id);
    }
    workspace.database.objects[index].modified = true;
    rebuild_sprite_usage(&mut workspace);
    workspace.dirty = true;
    let object = workspace.database.objects[index].clone();
    // Editing in place is the whole point, but a sprite drawn by more than one frame
    // changes under every one of them at once, and that is worth saying out loud.
    let shared = slot_result
        .iter()
        .copied()
        .filter(|id| *id != 0)
        .filter(|id| workspace.sprite_usage.usage_count(*id) > 1)
        .collect::<Vec<_>>();
    if !allocated.is_empty() {
        emit_log(
            &app,
            "SPRITE",
            format!(
                "{} sprite(s) created for {:?} {}",
                allocated.len(),
                identity.kind,
                identity.id
            ),
            None,
            None,
        );
    }
    Ok(FrameLayerWrite {
        object,
        slot_ids: slot_result,
        allocated,
        shared,
    })
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
pub async fn export_object(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ObjectFileRequest,
) -> Result<()> {
    let export_path = request.path.clone();
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
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    emit_log(&app, "INFO", "Object exported", Some(export_path), None);
    Ok(())
}

#[tauri::command]
pub async fn import_object(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<ThingObject> {
    let import_path = path.clone();
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
    workspace.database.objects.push(object.clone());
    rebuild_sprite_usage(&mut workspace);
    workspace.dirty = true;
    emit_log(
        &app,
        "INFO",
        format!("Imported {:?} {}", object.kind, object.id),
        Some(import_path),
        None,
    );
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
pub async fn export_png(
    app: AppHandle,
    state: State<'_, AppState>,
    request: PngExportRequest,
) -> Result<()> {
    let export_path = request.path.clone();
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
        let render = |group_index, frame_index, pattern_index| {
            render_object_frame(
                &object,
                group_index,
                frame_index,
                pattern_index,
                source.as_ref().map(|value| value.sprite_size).unwrap_or(32),
                |id| resolved_sprite(&overrides, source.as_ref(), id),
            )
        };
        let image = if request.mode == "frame" {
            render(request.group_index, request.frame_index, 0)?
        } else {
            let mut images = Vec::new();
            for (group_index, group) in object.frame_groups.iter().enumerate() {
                let tiles_per_pattern = usize::from(object.dimensions.width)
                    * usize::from(object.dimensions.height)
                    * usize::from(object.dimensions.layers.max(1));
                let phase_stride = group
                    .sprite_ids
                    .len()
                    .checked_div(group.frames.len().max(1))
                    .unwrap_or(0);
                let patterns = if request.mode == "allFrames" {
                    1
                } else {
                    phase_stride
                        .checked_div(tiles_per_pattern)
                        .unwrap_or(0)
                        .max(1)
                };
                for frame_index in 0..group.frames.len() {
                    for pattern_index in 0..patterns {
                        images.push(render(group_index, frame_index, pattern_index)?);
                    }
                }
            }
            compose_sheet(&images)?
        };
        save_png(Path::new(&request.path), &image)
    })
    .await
    .map_err(|error| ObjectBuilderError::IoError(error.to_string()))??;
    emit_log(&app, "SPRITE", "PNG exported", Some(export_path), None);
    Ok(())
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

fn has_only_transparent_sheet_padding(cells: &[SpriteImage], used: usize) -> bool {
    cells.len() >= used
        && cells[used..]
            .iter()
            .all(|cell| cell.rgba.chunks_exact(4).all(|pixel| pixel[3] == 0))
}

#[tauri::command]
pub async fn import_png(
    app: AppHandle,
    state: State<'_, AppState>,
    request: PngImportRequest,
) -> Result<ThingObject> {
    let source = PathBuf::from(&request.path);
    let import_path = request.path.clone();
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
    let sprite_size = workspace
        .sprite_source
        .as_ref()
        .map(|source| source.sprite_size)
        .unwrap_or(32);
    let dimensions = object_dimensions(&workspace.database.objects[index], sprite_size);
    let targets = if request.mode == "frame" {
        let group = workspace.database.objects[index]
            .frame_groups
            .get(request.group_index)
            .ok_or_else(|| {
                ObjectBuilderError::InvalidSprite(
                    "selected frame group is outside this object".into(),
                )
            })?;
        if request.frame_index >= group.frames.len() {
            return Err(ObjectBuilderError::InvalidSprite(
                "selected frame is outside this object".into(),
            ));
        }
        if png.width != dimensions.pixel_width || png.height != dimensions.pixel_height {
            return Err(ObjectBuilderError::InvalidSprite(format!(
                "an object frame must be {}×{} pixels; received {}×{}",
                dimensions.pixel_width, dimensions.pixel_height, png.width, png.height
            )));
        }
        vec![(request.group_index, request.frame_index, 0, png)]
    } else {
        let cells = slice_sheet(&png, dimensions.pixel_width, dimensions.pixel_height, 0, 0)?;
        let object = &workspace.database.objects[index];
        let tiles_per_layer = usize::from(object.dimensions.width)
            .saturating_mul(usize::from(object.dimensions.height));
        let frame_targets = object
            .frame_groups
            .iter()
            .enumerate()
            .flat_map(|(group_index, group)| {
                (0..group.frames.len()).map(move |frame_index| (group_index, frame_index, 0))
            })
            .collect::<Vec<_>>();
        let complete_targets = object
            .frame_groups
            .iter()
            .enumerate()
            .flat_map(|(group_index, group)| {
                let phase_stride = group
                    .sprite_ids
                    .len()
                    .checked_div(group.frames.len().max(1))
                    .unwrap_or(0);
                let patterns = phase_stride
                    .checked_div(
                        tiles_per_layer
                            .saturating_mul(usize::from(object.dimensions.layers.max(1))),
                    )
                    .unwrap_or(0)
                    .max(1);
                (0..group.frames.len()).flat_map(move |frame_index| {
                    (0..patterns)
                        .map(move |pattern_index| (group_index, frame_index, pattern_index))
                })
            })
            .collect::<Vec<_>>();
        let targets = if has_only_transparent_sheet_padding(&cells, complete_targets.len()) {
            complete_targets
        } else if has_only_transparent_sheet_padding(&cells, frame_targets.len()) {
            frame_targets
        } else {
            return Err(ObjectBuilderError::InvalidSprite(format!(
                "spritesheet contains {} cells; expected {} frame cells or {} complete frame/pattern cells (only transparent grid padding is allowed)",
                cells.len(), frame_targets.len(), complete_targets.len()
            )));
        };
        targets
            .into_iter()
            .zip(cells)
            .map(|((group_index, frame_index, pattern_index), image)| {
                (group_index, frame_index, pattern_index, image)
            })
            .collect()
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
    for (group_index, frame_index, pattern_index, image) in targets {
        let tiles = split_object_image(
            &image,
            dimensions.tile_width,
            dimensions.tile_height,
            sprite_size,
        )?;
        let assigned = tiles
            .into_iter()
            .map(|image| {
                let id = next;
                next = next.saturating_add(1);
                (id, image)
            })
            .collect::<Vec<_>>();
        replacements.push((group_index, frame_index, pattern_index, assigned));
    }
    for (group_index, frame_index, pattern_index, assigned) in &replacements {
        let group = &mut workspace.database.objects[index].frame_groups[*group_index];
        let stride = group
            .sprite_ids
            .len()
            .checked_div(group.frames.len().max(1))
            .unwrap_or(1)
            .max(1);
        let tiles_per_layer =
            usize::from(dimensions.tile_width).saturating_mul(usize::from(dimensions.tile_height));
        let layers = usize::from(dimensions.layers.max(1));
        let pattern_stride = tiles_per_layer.saturating_mul(layers);
        let phase_start = *frame_index * stride;
        let pattern_start = phase_start.saturating_add(*pattern_index * pattern_stride);
        let pattern_end = pattern_start
            .saturating_add(pattern_stride)
            .min(group.sprite_ids.len());
        if pattern_start >= pattern_end {
            return Err(ObjectBuilderError::InvalidSprite(
                "spritesheet target is outside the object's sprite layout".into(),
            ));
        }
        group.sprite_ids[pattern_start..pattern_end].fill(0);
        for (tile_index, (id, _)) in assigned.iter().enumerate() {
            let sprite_index = pattern_start + tile_index;
            if let Some(sprite_id) = group.sprite_ids.get_mut(sprite_index) {
                *sprite_id = *id;
            }
        }
        if *pattern_index == 0 {
            group.frames[*frame_index].sprite_id = assigned[0].0;
        }
    }
    for (_, _, _, assigned) in replacements {
        for (id, image) in assigned {
            workspace.sprite_overrides.insert(id, image);
        }
    }
    workspace.database.objects[index].sprite_id = workspace.database.objects[index]
        .frame_groups
        .first()
        .and_then(|group| group.frames.first())
        .map(|frame| frame.sprite_id)
        .unwrap_or(0);
    workspace.database.objects[index].modified = true;
    let object = workspace.database.objects[index].clone();
    rebuild_sprite_usage(&mut workspace);
    workspace.dirty = true;
    emit_log(
        &app,
        "SPRITE",
        format!("PNG imported into {:?} {}", object.kind, object.id),
        Some(import_path),
        None,
    );
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

    #[test]
    fn version_detection_reads_the_layout_instead_of_trusting_the_field() {
        // One item whose sprite ID is 16 bits wide: every probe above 9.60 reads it as 32 and
        // runs off the end of the file, so only the 8.60 layout parses end to end.
        let mut bytes = vec![1, 2, 3, 4, 100, 0, 0, 0, 0, 0, 0, 0];
        bytes.extend([255, 1, 1, 1, 1, 1, 1, 1, 42, 0]);
        let directory =
            std::env::temp_dir().join(format!("object-builder-detect-{}", std::process::id()));
        fs::create_dir_all(&directory).expect("temporary client directory");
        fs::write(directory.join("Tibia.dat"), &bytes).expect("fixture DAT");
        let request = VersionDetectRequest {
            directory: directory.display().to_string(),
            dat_file: "Tibia.dat".into(),
            otfi_file: None,
            use_otfi: true,
        };

        let detected = detect_version(&request).expect("a supported layout parses the fixture");

        assert_eq!(detected.version, "8.60");
        assert_eq!(detected.source, "version");
        assert!(!detected.features.extended);
        assert_eq!(detected.item_count, 100);

        fs::write(directory.join("Tibia.dat"), b"not a client file at all").expect("broken DAT");
        assert!(detect_version(&request).is_err());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn applying_order_closes_object_and_frame_id_gaps() {
        let mut first = crate::core::models::test_object();
        first.id = 102;
        first.frame_groups[0].frames[0].id = 7;
        let mut second = first.clone();
        second.id = 100;
        second.name = "First in manual order".into();
        second.frame_groups[0].frames[0].id = 9;
        let mut effect = first.clone();
        effect.kind = ObjectKind::Effect;
        effect.id = 4;
        effect.frame_groups[0].frames[0].id = 11;
        let mut database = ObjectDatabase {
            objects: vec![first, effect, second],
            ..ObjectDatabase::default()
        };

        let result = normalize_object_order(&mut database).expect("order can be normalized");

        assert_eq!(result.changed_objects, 3);
        assert_eq!(result.changed_frames, 3);
        assert_eq!(database.objects[0].id, 100);
        assert_eq!(
            database.objects[0].name,
            crate::core::models::test_object().name
        );
        assert_eq!(database.objects[1].id, 101);
        assert_eq!(database.objects[2].kind, ObjectKind::Effect);
        assert_eq!(database.objects[2].id, 1);
        assert_eq!(
            database.objects[1].frame_groups[0].frames[0].id,
            101_u64 << 32
        );
    }

    #[test]
    fn optimization_only_marks_unreferenced_overrides_as_safe() {
        let mut workspace = WorkspaceState {
            sprite_count: 3,
            sprite_storage_sizes: vec![5; 3],
            database: ObjectDatabase {
                objects: vec![crate::core::models::test_object()],
                ..ObjectDatabase::default()
            },
            ..WorkspaceState::default()
        };
        workspace.sprite_overrides.insert(
            4,
            SpriteImage::new(1, 1, vec![1, 2, 3, 255]).expect("valid override"),
        );
        rebuild_sprite_usage(&mut workspace);
        let analysis = optimization_analysis(&optimization_snapshot(&workspace))
            .expect("optimization analysis");
        assert_eq!(analysis.statistics.total, 4);
        assert_eq!(analysis.statistics.in_use, 1);
        assert_eq!(analysis.unused_override_ids, vec![4]);
        assert_eq!(analysis.unused_source_count, 2);
        assert_eq!(analysis.unused_source_preview, vec![2, 3]);
        assert_eq!(analysis.reclaimable_bytes, 4);
    }

    #[test]
    fn optimization_request_enables_every_operation_by_default() {
        let request: OptimizationRequest =
            serde_json::from_value(serde_json::json!({ "duplicateKeepers": {} }))
                .expect("optimization request");

        assert!(request.optimize_duplicates);
        assert!(request.remove_unused_sprites);
        assert!(request.remove_unused_overrides);
        assert!(request.remove_blank_sprites);
        assert!(request.drop_redundant_overrides);
        assert!(request.clear_empty_references);
        assert!(request.repair_invalid_references);
    }

    #[test]
    fn optimization_lists_referenced_blank_sprites_outside_deduplication() {
        let blank = SpriteImage::new(1, 1, vec![0, 0, 0, 0]).expect("blank sprite");
        let mut object = crate::core::models::test_object();
        object.frame_groups[0].sprite_ids = vec![1, 2];
        let mut workspace = WorkspaceState {
            database: ObjectDatabase {
                objects: vec![object],
                ..ObjectDatabase::default()
            },
            ..WorkspaceState::default()
        };
        workspace.sprite_overrides.insert(1, blank.clone());
        workspace.sprite_overrides.insert(2, blank);
        rebuild_sprite_usage(&mut workspace);

        let analysis = optimization_analysis(&optimization_snapshot(&workspace))
            .expect("optimization analysis");

        assert_eq!(analysis.blank_sprite_ids, vec![1, 2]);
        assert_eq!(analysis.blank_sprite_count, 2);
        assert_eq!(analysis.blank_reference_count, 2);
        // Collapsing blank sprites onto one keeper would leave the objects
        // pointing at an image that draws nothing.
        assert!(analysis.duplicate_groups.is_empty());
    }

    #[test]
    fn optimization_skips_blank_sprites_that_nothing_references() {
        let blank = SpriteImage::new(1, 1, vec![0, 0, 0, 0]).expect("blank sprite");
        let mut workspace = WorkspaceState {
            database: ObjectDatabase {
                objects: vec![crate::core::models::test_object()],
                ..ObjectDatabase::default()
            },
            ..WorkspaceState::default()
        };
        workspace.sprite_overrides.insert(7, blank);
        rebuild_sprite_usage(&mut workspace);

        let analysis = optimization_analysis(&optimization_snapshot(&workspace))
            .expect("optimization analysis");

        // Already covered by the unused-override operation; counting it here too
        // would report the same bytes twice.
        assert!(analysis.blank_sprite_ids.is_empty());
        assert_eq!(analysis.unused_override_ids, vec![7]);
    }

    #[test]
    fn optimization_reports_referenced_slots_without_sprite_data() {
        let mut object = crate::core::models::test_object();
        object.frame_groups[0].sprite_ids = vec![1, 2];
        let mut workspace = WorkspaceState {
            sprite_count: 3,
            sprite_storage_sizes: vec![5, 0, 5],
            database: ObjectDatabase {
                objects: vec![object],
                ..ObjectDatabase::default()
            },
            ..WorkspaceState::default()
        };
        rebuild_sprite_usage(&mut workspace);

        let analysis = optimization_analysis(&optimization_snapshot(&workspace))
            .expect("optimization analysis");

        assert_eq!(analysis.empty_slot_ids, vec![2]);
        assert_eq!(analysis.empty_slot_reference_count, 1);
        // The slot is inside the archive range, so it is not an invalid
        // reference and would otherwise stay invisible.
        assert_eq!(analysis.statistics.invalid_references, 0);
    }

    #[test]
    fn optimization_detects_overrides_identical_to_the_source_sprite() {
        let image = SpriteImage::new(1, 1, vec![9, 8, 7, 255]).expect("valid sprite");
        let checksum = NonZeroU64::new(sprite_checksum(&image)).expect("non-zero checksum");
        let mut workspace = WorkspaceState {
            sprite_count: 1,
            sprite_source: Some(SpriteSource {
                path: PathBuf::from("this-file-must-not-be-opened.spr"),
                header: SprHeader {
                    signature: 0,
                    sprite_count: 1,
                    table_offset: 8,
                },
                transparency: true,
                sprite_size: 32,
            }),
            sprite_storage_sizes: vec![10],
            source_sprite_checksums: Arc::new(vec![Some(checksum)]),
            database: ObjectDatabase {
                objects: vec![crate::core::models::test_object()],
                ..ObjectDatabase::default()
            },
            ..WorkspaceState::default()
        };
        workspace.sprite_overrides.insert(1, image);
        rebuild_sprite_usage(&mut workspace);

        let analysis = optimization_analysis(&optimization_snapshot(&workspace))
            .expect("optimization analysis");

        assert_eq!(analysis.redundant_override_ids, vec![1]);
        assert_eq!(analysis.redundant_override_bytes, 4);
    }

    #[test]
    fn optimization_groups_different_sprite_ids_with_the_same_checksum() {
        let image = SpriteImage::new(1, 1, vec![10, 20, 30, 255]).expect("valid sprite");
        let mut workspace = WorkspaceState {
            database: ObjectDatabase {
                objects: vec![crate::core::models::test_object()],
                ..ObjectDatabase::default()
            },
            ..WorkspaceState::default()
        };
        workspace.sprite_overrides.insert(1, image.clone());
        workspace.sprite_overrides.insert(2, image);
        rebuild_sprite_usage(&mut workspace);

        let analysis = optimization_analysis(&optimization_snapshot(&workspace))
            .expect("optimization analysis");

        assert_eq!(analysis.duplicate_groups.len(), 1);
        assert_eq!(analysis.duplicate_groups[0].sprites.len(), 2);
        assert_eq!(analysis.duplicate_groups[0].sprites[0].id, 1);
        assert_eq!(analysis.duplicate_groups[0].sprites[1].id, 2);
    }

    #[test]
    fn optimization_reuses_cached_source_checksums_without_reopening_the_spr() {
        let checksum = NonZeroU64::new(42).expect("non-zero checksum");
        let workspace = WorkspaceState {
            sprite_count: 2,
            sprite_source: Some(SpriteSource {
                path: PathBuf::from("this-file-must-not-be-opened.spr"),
                header: SprHeader {
                    signature: 0,
                    sprite_count: 2,
                    table_offset: 8,
                },
                transparency: true,
                sprite_size: 32,
            }),
            sprite_storage_sizes: vec![10, 10],
            source_sprite_checksums: Arc::new(vec![Some(checksum), Some(checksum)]),
            ..WorkspaceState::default()
        };

        let analysis = optimization_analysis(&optimization_snapshot(&workspace))
            .expect("cached checksum analysis");

        assert_eq!(analysis.duplicate_group_count, 1);
        assert_eq!(analysis.duplicate_candidate_count, 2);
        assert_eq!(analysis.duplicate_groups[0].sprite_count, 2);
    }

    #[test]
    fn optimization_analysis_honors_cancellation_before_scanning() {
        let snapshot = optimization_snapshot(&WorkspaceState::default());
        let result = optimization_analysis_with_progress(
            &snapshot,
            &OptimizationProgressTracker::cancelled(),
        );
        assert!(matches!(
            result,
            Err(ObjectBuilderError::OperationCancelled(_))
        ));
    }

    #[test]
    fn optimization_registry_allows_only_one_operation_at_a_time() {
        let state = AppState::default();
        let (_, first) =
            register_optimization(&state, "first".into()).expect("first analysis registers");
        let second = register_optimization(&state, "second".into());
        assert!(matches!(
            second,
            Err(ObjectBuilderError::OperationInProgress(_))
        ));

        drop(first);
        assert!(register_optimization(&state, "third".into()).is_ok());
    }

    #[test]
    fn object_storage_size_counts_each_referenced_sprite_once() {
        let mut object = crate::core::models::test_object();
        object.frame_groups[0].sprite_ids = vec![1, 1, 2];
        let source_sizes = vec![20, 30];
        assert_eq!(
            object_sprite_storage_bytes(&object, &source_sizes, &HashMap::new()),
            58
        );
        assert_eq!(
            object_sprite_storage_bytes(&object, &source_sizes, &HashMap::from([(2, 10)])),
            38
        );
    }

    #[test]
    fn accepts_transparent_padding_from_its_own_spritesheet_layout() {
        let images = (0..5)
            .map(|value| SpriteImage::new(2, 2, [value, 0, 0, 255].repeat(4)).expect("test image"))
            .collect::<Vec<_>>();
        let sheet = compose_sheet(&images).expect("compose sheet");
        let cells = slice_sheet(&sheet, 2, 2, 0, 0).expect("slice sheet");
        assert_eq!(cells.len(), 6);
        assert!(has_only_transparent_sheet_padding(&cells, images.len()));
        assert_eq!(&cells[..images.len()], images);
    }
}
