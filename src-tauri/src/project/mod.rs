use crate::{
    core::{error::Result, models::WorkspaceSnapshot},
    sprites::SpriteImage,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
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
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".tmp");
    PathBuf::from(value)
}

pub fn save_manifest_atomic(
    snapshot: &WorkspaceSnapshot,
    sprite_overrides: &HashMap<u32, SpriteImage>,
    path: &Path,
    create_backup: bool,
) -> Result<()> {
    let serialized = serde_json::to_vec_pretty(&ProjectManifest {
        schema_version: 1,
        workspace: snapshot.clone(),
        sprite_overrides: sprite_overrides.clone(),
    })?;
    let temporary = temporary_path(path);
    fs::write(&temporary, serialized)?;
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
    Ok(())
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
        save_manifest_atomic(&snapshot, &overrides, &path, false).expect("manifest saves");
        let loaded: ProjectManifest =
            serde_json::from_slice(&fs::read(&path).expect("manifest reads"))
                .expect("manifest parses");
        let _ = fs::remove_file(path);
        assert_eq!(loaded.workspace.objects.len(), snapshot.objects.len());
        assert_eq!(loaded.sprite_overrides.get(&11), overrides.get(&11));
    }
}
