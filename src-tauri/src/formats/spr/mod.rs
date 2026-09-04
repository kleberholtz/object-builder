use crate::{
    core::{
        error::{ObjectBuilderError, Result},
        models::{ClientVersion, FormatMetadata, ObjectDatabase},
    },
    formats::{read_u16_le, read_u32_le, ObjectFormat},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SprHeader {
    pub signature: u32,
    pub sprite_count: u32,
    pub table_offset: usize,
}

pub struct SprFormat {
    pub version: ClientVersion,
    pub extended: bool,
}

impl SprFormat {
    #[allow(dead_code)]
    pub fn inspect(&self, bytes: &[u8]) -> Result<SprHeader> {
        let signature = read_u32_le(bytes, 0)
            .ok_or_else(|| ObjectBuilderError::InvalidSpr("missing signature".into()))?;
        let (sprite_count, table_offset) = if self.extended {
            (
                read_u32_le(bytes, 4).ok_or_else(|| {
                    ObjectBuilderError::InvalidSpr("missing 32-bit sprite count".into())
                })?,
                8,
            )
        } else {
            (
                u32::from(read_u16_le(bytes, 4).ok_or_else(|| {
                    ObjectBuilderError::InvalidSpr("missing 16-bit sprite count".into())
                })?),
                6,
            )
        };
        let table_size = usize::try_from(sprite_count)
            .unwrap_or(usize::MAX)
            .saturating_mul(4);
        if bytes.len() < table_offset + table_size {
            return Err(ObjectBuilderError::CorruptedFile(
                "SPR offset table is truncated".into(),
            ));
        }
        Ok(SprHeader {
            signature,
            sprite_count,
            table_offset,
        })
    }

    pub fn inspect_path(&self, path: &Path) -> Result<SprHeader> {
        let mut file = fs::File::open(path)?;
        let mut header_bytes = [0_u8; 8];
        file.read_exact(&mut header_bytes)?;
        let header = self.inspect_header(&header_bytes)?;
        let table_bytes = u64::from(header.sprite_count).saturating_mul(4);
        if file.metadata()?.len() < header.table_offset as u64 + table_bytes {
            return Err(ObjectBuilderError::CorruptedFile(
                "SPR offset table is truncated".into(),
            ));
        }
        Ok(header)
    }

    pub fn validate_offsets<F>(
        &self,
        path: &Path,
        header: &SprHeader,
        mut progress: F,
    ) -> Result<()>
    where
        F: FnMut(u32, u32),
    {
        let mut file = fs::File::open(path)?;
        let file_length = file.metadata()?.len();
        file.seek(SeekFrom::Start(header.table_offset as u64))?;
        let mut offset_bytes = [0_u8; 4];
        for index in 0..header.sprite_count {
            file.read_exact(&mut offset_bytes)?;
            let offset = u64::from(u32::from_le_bytes(offset_bytes));
            if offset != 0 && offset.saturating_add(5) > file_length {
                return Err(ObjectBuilderError::InvalidSpr(format!(
                    "sprite {} points outside the file (offset {offset}, file size {file_length})",
                    index + 1
                )));
            }
            let processed = index + 1;
            if processed % 4096 == 0 || processed == header.sprite_count {
                progress(processed, header.sprite_count);
            }
        }
        Ok(())
    }

    fn inspect_header(&self, bytes: &[u8]) -> Result<SprHeader> {
        let signature = read_u32_le(bytes, 0)
            .ok_or_else(|| ObjectBuilderError::InvalidSpr("missing signature".into()))?;
        let (sprite_count, table_offset) = if self.extended {
            (
                read_u32_le(bytes, 4).ok_or_else(|| {
                    ObjectBuilderError::InvalidSpr("missing 32-bit sprite count".into())
                })?,
                8,
            )
        } else {
            (
                u32::from(read_u16_le(bytes, 4).ok_or_else(|| {
                    ObjectBuilderError::InvalidSpr("missing 16-bit sprite count".into())
                })?),
                6,
            )
        };
        Ok(SprHeader {
            signature,
            sprite_count,
            table_offset,
        })
    }
}

impl ObjectFormat for SprFormat {
    fn load(&self, path: &Path) -> Result<ObjectDatabase> {
        let header = self.inspect_path(path)?;
        Ok(ObjectDatabase {
            version: self.version,
            metadata: FormatMetadata {
                spr_signature: Some(header.signature),
                ..FormatMetadata::default()
            },
            original_spr: Some(path.to_path_buf()),
            ..ObjectDatabase::default()
        })
    }
    fn save(&self, database: &ObjectDatabase, path: &Path) -> Result<()> {
        let source = database.original_spr.as_ref().ok_or_else(|| {
            ObjectBuilderError::SerializationError(
                "SPR serialization is unavailable without preserved source bytes".into(),
            )
        })?;
        if source != path {
            fs::copy(source, path)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_version_specific_sprite_count() {
        let modern = [1, 2, 3, 4, 2, 0, 0, 0, 12, 0, 0, 0, 16, 0, 0, 0];
        assert_eq!(
            SprFormat {
                version: ClientVersion::Tibia1098,
                extended: true
            }
            .inspect(&modern)
            .expect("modern header")
            .sprite_count,
            2
        );
        let classic = [1, 2, 3, 4, 1, 0, 10, 0, 0, 0];
        assert_eq!(
            SprFormat {
                version: ClientVersion::Tibia860,
                extended: false
            }
            .inspect(&classic)
            .expect("classic header")
            .table_offset,
            6
        );
    }

    #[test]
    fn inspects_real_extended_860_fixture_without_loading_it_when_available() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../860/Tibia.spr");
        if !path.exists() {
            return;
        }
        let header = SprFormat {
            version: ClientVersion::Tibia860,
            extended: true,
        }
        .inspect_path(&path)
        .expect("real 8.60 SPR header should parse");
        assert_eq!(header.signature, 0x4c22_0594);
        assert_eq!(header.sprite_count, 732_782);
        assert_eq!(header.table_offset, 8);
    }

    #[test]
    fn validates_the_real_860_offset_table_when_available() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../860/Tibia.spr");
        if !path.exists() {
            return;
        }
        let format = SprFormat {
            version: ClientVersion::Tibia860,
            extended: true,
        };
        let header = format.inspect_path(&path).expect("real SPR header");
        let mut final_count = 0;
        format
            .validate_offsets(&path, &header, |processed, _| final_count = processed)
            .expect("valid offset table");
        assert_eq!(final_count, header.sprite_count);
    }
}
