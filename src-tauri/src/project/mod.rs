use crate::core::{error::Result, models::WorkspaceSnapshot};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn temporary_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(".tmp");
    PathBuf::from(value)
}

pub fn save_manifest_atomic(
    snapshot: &WorkspaceSnapshot,
    path: &Path,
    create_backup: bool,
) -> Result<()> {
    let serialized = serde_json::to_vec_pretty(snapshot)?;
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
    use crate::core::models::{ObjectDatabase, ProjectInfo};
    #[test]
    fn manifest_round_trip_preserves_objects() {
        let snapshot = WorkspaceSnapshot {
            project: ProjectInfo {
                name: "test".into(),
                client_version: "10.98".into(),
                dat_file: "a.dat".into(),
                spr_file: "a.spr".into(),
                object_count: 32,
                sprite_count: 10,
                dirty: false,
            },
            objects: ObjectDatabase::demo().objects,
        };
        let path = std::env::temp_dir().join(format!(
            "object-builder-{}-project.json",
            std::process::id()
        ));
        save_manifest_atomic(&snapshot, &path, false).expect("manifest saves");
        let loaded: WorkspaceSnapshot =
            serde_json::from_slice(&fs::read(&path).expect("manifest reads"))
                .expect("manifest parses");
        let _ = fs::remove_file(path);
        assert_eq!(loaded.objects.len(), snapshot.objects.len());
    }
}
