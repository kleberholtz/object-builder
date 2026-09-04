use crate::{
    core::{error::Result, models::WorkspaceSnapshot},
    sprites::SpriteImage,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub schema_version: u16,
    pub workspace: WorkspaceSnapshot,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub sprite_overrides: HashMap<u32, SpriteImage>,
    #[serde(default, skip_serializing_if = "HashSet::is_empty")]
    pub removed_sprite_ids: HashSet<u32>,
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".tmp");
    PathBuf::from(value)
}

/// Writes `bytes` through a temporary file and returns how many were written, which is what
/// the save dialog counts while a multi-file save runs.
pub fn save_bytes_atomic(path: &Path, bytes: &[u8], create_backup: bool) -> Result<u64> {
    let temporary = temporary_path(path);
    fs::write(&temporary, bytes)?;
    if create_backup && path.exists() {
        let mut backup = path.as_os_str().to_os_string();
        backup.push(".backup");
        let backup = PathBuf::from(backup);
        if backup.exists() {
            fs::remove_file(&backup)?;
        }
        if fs::hard_link(path, &backup).is_err() {
            fs::copy(path, backup)?;
        }
    }
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary, path)?;
    Ok(bytes.len() as u64)
}

pub fn save_manifest_atomic(
    snapshot: &WorkspaceSnapshot,
    sprite_overrides: &HashMap<u32, SpriteImage>,
    removed_sprite_ids: &HashSet<u32>,
    path: &Path,
    create_backup: bool,
) -> Result<u64> {
    let serialized = serde_json::to_vec_pretty(&ProjectManifest {
        schema_version: 1,
        workspace: snapshot.clone(),
        sprite_overrides: sprite_overrides.clone(),
        removed_sprite_ids: removed_sprite_ids.clone(),
    })?;
    let temporary = temporary_path(path);
    fs::write(&temporary, &serialized)?;
    if create_backup && path.exists() {
        let mut backup = path.as_os_str().to_os_string();
        backup.push(".backup");
        fs::copy(path, PathBuf::from(backup))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if path.exists() {
            fs::remove_file(path)?;
            fs::rename(&temporary, path)?;
        } else {
            return Err(error.into());
        }
    }
    Ok(serialized.len() as u64)
}

pub fn validate_manifest(path: &Path) -> Result<ProjectManifest> {
    let manifest: ProjectManifest = serde_json::from_slice(&fs::read(path)?)?;
    if manifest.schema_version != 1 {
        return Err(crate::core::error::ObjectBuilderError::SerializationError(
            format!(
                "unsupported project schema version {}",
                manifest.schema_version
            ),
        ));
    }
    if manifest.workspace.project.object_count != manifest.workspace.objects.len() {
        return Err(crate::core::error::ObjectBuilderError::SerializationError(
            format!(
                "manifest declares {} objects but contains {}",
                manifest.workspace.project.object_count,
                manifest.workspace.objects.len()
            ),
        ));
    }
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::{test_object, ProjectInfo};
    #[test]
    fn manifest_round_trip_preserves_objects() {
        let snapshot = WorkspaceSnapshot {
            project: ProjectInfo {
                name: "test".into(),
                client_version: "10.98".into(),
                dat_file: "a.dat".into(),
                spr_file: "a.spr".into(),
                object_count: 1,
                sprite_count: 10,
                dirty: false,
                project_file: None,
                sprite_size: 32,
                source_directory: None,
                dat_signature: Some(1),
                spr_signature: Some(2),
                client_features: Some(crate::core::models::ClientFeatures::for_version(
                    crate::core::models::ClientVersion::Tibia1098,
                )),
            },
            objects: vec![test_object()],
        };
        let path = std::env::temp_dir().join(format!(
            "object-builder-{}-project.json",
            std::process::id()
        ));
        let mut overrides = HashMap::new();
        overrides.insert(
            11,
            SpriteImage::new(1, 1, vec![10, 20, 30, 40]).expect("valid sprite"),
        );
        save_manifest_atomic(&snapshot, &overrides, &HashSet::new(), &path, false)
            .expect("manifest saves");
        let loaded: ProjectManifest = validate_manifest(&path).expect("manifest validates");
        let _ = fs::remove_file(path);
        assert_eq!(loaded.workspace.objects.len(), snapshot.objects.len());
        assert_eq!(loaded.sprite_overrides.get(&11), overrides.get(&11));
    }
}
