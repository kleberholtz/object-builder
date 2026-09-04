use crate::{
    core::{
        error::{ObjectBuilderError, Result},
        models::{ClientVersion, FormatMetadata, ObjectDatabase},
    },
    formats::{read_u16_le, read_u32_le, ObjectFormat},
    sprites::SpriteImage,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
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

/// What the SPR writer has done so far. Sprites are the unit the user recognizes, but the
/// byte counter is what makes a long write legible: the sprite count moves in bursts of 256
/// while the file grows continuously, and the dialog derives throughput from it.
#[derive(Debug, Clone, Copy)]
pub struct SprSaveProgress {
    pub sprites_processed: u32,
    pub sprites_total: u32,
    pub bytes_written: u64,
}

pub struct SprSaveOptions<'a> {
    pub source: &'a Path,
    pub source_header: &'a SprHeader,
    pub destination: &'a Path,
    pub overrides: &'a HashMap<u32, SpriteImage>,
    pub removed_ids: &'a HashSet<u32>,
    pub extended: bool,
    pub transparency: bool,
    pub sprite_size: u16,
    pub create_backup: bool,
}

pub fn save_spr_archive<F>(options: SprSaveOptions<'_>, mut progress: F) -> Result<SprHeader>
where
    F: FnMut(SprSaveProgress),
{
    let SprSaveOptions {
        source,
        source_header,
        destination,
        overrides,
        removed_ids,
        extended,
        transparency,
        sprite_size,
        create_backup,
    } = options;
    let mut sprite_count = source_header
        .sprite_count
        .max(overrides.keys().copied().max().unwrap_or_default());
    while sprite_count > 0
        && removed_ids.contains(&sprite_count)
        && !overrides.contains_key(&sprite_count)
    {
        sprite_count -= 1;
    }
    if !extended && sprite_count > u32::from(u16::MAX) {
        return Err(ObjectBuilderError::SerializationError(format!(
            "{sprite_count} sprites require an extended SPR"
        )));
    }
    if overrides.is_empty() && removed_ids.is_empty() {
        if source != destination {
            atomic_copy(source, destination, create_backup)?;
        }
        progress(SprSaveProgress {
            sprites_processed: sprite_count,
            sprites_total: sprite_count,
            bytes_written: fs::metadata(destination)
                .map(|data| data.len())
                .unwrap_or(0),
        });
        return Ok(SprHeader {
            signature: source_header.signature,
            sprite_count,
            table_offset: if extended { 8 } else { 6 },
        });
    }

    let table_offset = if extended { 8_usize } else { 6 };
    let table_bytes = usize::try_from(sprite_count)
        .map_err(|_| ObjectBuilderError::SerializationError("sprite count overflow".into()))?
        .checked_mul(4)
        .ok_or_else(|| ObjectBuilderError::SerializationError("SPR table overflow".into()))?;
    let old_table_bytes = usize::try_from(source_header.sprite_count)
        .map_err(|_| ObjectBuilderError::SerializationError("sprite count overflow".into()))?
        .checked_mul(4)
        .ok_or_else(|| ObjectBuilderError::SerializationError("SPR table overflow".into()))?;
    let mut source_file = fs::File::open(source)?;
    source_file.seek(SeekFrom::Start(source_header.table_offset as u64))?;
    let mut old_table = vec![0_u8; old_table_bytes];
    source_file.read_exact(&mut old_table)?;
    let mut offsets = vec![0_u32; usize::try_from(sprite_count).unwrap_or_default()];
    let temporary = temporary_path(destination);
    let mut output = fs::File::create(&temporary)?;
    output.write_all(&source_header.signature.to_le_bytes())?;
    if extended {
        output.write_all(&sprite_count.to_le_bytes())?;
    } else {
        output.write_all(&(sprite_count as u16).to_le_bytes())?;
    }
    output.write_all(&vec![0_u8; table_bytes])?;
    for id in 1..=sprite_count {
        if removed_ids.contains(&id) {
            continue;
        }
        let offset = u32::try_from(output.stream_position()?).map_err(|_| {
            ObjectBuilderError::SerializationError("SPR archive exceeds 4 GiB".into())
        })?;
        if let Some(image) = overrides.get(&id) {
            if image.width != u32::from(sprite_size) || image.height != u32::from(sprite_size) {
                return Err(ObjectBuilderError::InvalidSprite(format!(
                    "sprite {id} is {}×{}, expected {sprite_size}×{sprite_size}",
                    image.width, image.height
                )));
            }
            let encoded = encode_sprite(image, transparency)?;
            output.write_all(&[255, 0, 255])?;
            output.write_all(
                &u16::try_from(encoded.len())
                    .map_err(|_| {
                        ObjectBuilderError::InvalidSprite(
                            "compressed sprite exceeds 65,535 bytes".into(),
                        )
                    })?
                    .to_le_bytes(),
            )?;
            output.write_all(&encoded)?;
            offsets[usize::try_from(id - 1).unwrap_or_default()] = offset;
        } else if id <= source_header.sprite_count {
            let table_index = usize::try_from(id - 1).unwrap_or_default() * 4;
            let source_offset = u32::from_le_bytes(
                old_table[table_index..table_index + 4]
                    .try_into()
                    .unwrap_or_default(),
            );
            if source_offset != 0 {
                source_file.seek(SeekFrom::Start(u64::from(source_offset) + 3))?;
                let mut length = [0_u8; 2];
                source_file.read_exact(&mut length)?;
                let block_length = 5_usize + usize::from(u16::from_le_bytes(length));
                source_file.seek(SeekFrom::Start(u64::from(source_offset)))?;
                let mut block = vec![0_u8; block_length];
                source_file.read_exact(&mut block)?;
                output.write_all(&block)?;
                offsets[usize::try_from(id - 1).unwrap_or_default()] = offset;
            }
        }
        if id % 256 == 0 || id == sprite_count {
            progress(SprSaveProgress {
                sprites_processed: id,
                sprites_total: sprite_count,
                bytes_written: output.stream_position()?,
            });
        }
    }
    output.seek(SeekFrom::Start(table_offset as u64))?;
    for offset in offsets {
        output.write_all(&offset.to_le_bytes())?;
    }
    output.flush()?;
    drop(output);
    replace_atomic(&temporary, destination, create_backup)?;
    Ok(SprHeader {
        signature: source_header.signature,
        sprite_count,
        table_offset,
    })
}

pub(crate) fn encoded_sprite_storage_size(image: &SpriteImage, transparency: bool) -> Result<u64> {
    Ok(5_u64.saturating_add(encode_sprite(image, transparency)?.len() as u64))
}

fn encode_sprite(image: &SpriteImage, transparency: bool) -> Result<Vec<u8>> {
    let pixels = image.rgba.len() / 4;
    let mut output = Vec::new();
    let mut cursor = 0_usize;
    while cursor < pixels {
        let transparent_start = cursor;
        while cursor < pixels
            && image.rgba[cursor * 4 + 3] == 0
            && cursor - transparent_start < usize::from(u16::MAX)
        {
            cursor += 1;
        }
        let transparent = cursor - transparent_start;
        let colored_start = cursor;
        while cursor < pixels
            && image.rgba[cursor * 4 + 3] != 0
            && cursor - colored_start < usize::from(u16::MAX)
        {
            cursor += 1;
        }
        let colored = cursor - colored_start;
        output.extend_from_slice(&(transparent as u16).to_le_bytes());
        output.extend_from_slice(&(colored as u16).to_le_bytes());
        for pixel in colored_start..cursor {
            output.extend_from_slice(&image.rgba[pixel * 4..pixel * 4 + 3]);
            if transparency {
                output.push(image.rgba[pixel * 4 + 3]);
            }
        }
        if transparent == 0 && colored == 0 {
            return Err(ObjectBuilderError::InvalidSprite(
                "SPR encoder made no progress".into(),
            ));
        }
    }
    Ok(output)
}

fn suffixed_path(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn temporary_path(path: &Path) -> PathBuf {
    suffixed_path(path, ".tmp")
}

fn replace_atomic(temporary: &Path, destination: &Path, create_backup: bool) -> Result<()> {
    if create_backup && destination.exists() {
        let mut value = destination.as_os_str().to_os_string();
        value.push(".backup");
        let backup = PathBuf::from(value);
        if backup.exists() {
            fs::remove_file(&backup)?;
        }
        if fs::hard_link(destination, &backup).is_err() {
            fs::copy(destination, backup)?;
        }
    }
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(temporary, destination)?;
    Ok(())
}

fn atomic_copy(source: &Path, destination: &Path, create_backup: bool) -> Result<()> {
    let temporary = temporary_path(destination);
    fs::copy(source, &temporary)?;
    replace_atomic(&temporary, destination, create_backup)
}

/// Fixed-size volumes of a written SPR.
///
/// A finished archive can be published in numbered pieces (`Tibia.spr.001`, `Tibia.spr.002`,
/// …) next to the complete file, for the upload limits of the channels a client is shipped
/// through. The whole archive stays on disk because that is the file the editor reads
/// sprites from, lazily, for the rest of the session — the volumes are a copy, not a move.
///
/// The pieces are plain byte ranges, so joining them back is `cat` in any order-preserving
/// tool; `join_spr_volumes` exists so that opening a directory that only has the pieces
/// works without one.
pub const SPR_VOLUME_INDEX_SUFFIX: &str = ".parts";

/// Below a mebibyte the numbering runs out long before a real archive is covered, and the
/// index itself would cost a measurable fraction of each piece.
pub const MIN_SPR_VOLUME_SIZE: u64 = 1024 * 1024;

/// The names are zero-padded to three digits so a directory listing sorts them in order.
pub const MAX_SPR_VOLUMES: u64 = 999;

#[derive(Debug, Clone)]
pub struct SprVolume {
    pub path: PathBuf,
    pub size: u64,
}

#[derive(Debug, Clone)]
pub struct SprVolumeSet {
    pub index: PathBuf,
    pub volumes: Vec<SprVolume>,
    pub part_size: u64,
    pub total_size: u64,
}

fn volume_path(archive: &Path, number: u64) -> PathBuf {
    suffixed_path(archive, &format!(".{number:03}"))
}

fn volume_index_path(archive: &Path) -> PathBuf {
    suffixed_path(archive, SPR_VOLUME_INDEX_SUFFIX)
}

/// The volume number encoded in `path`, when it is a piece of `archive`.
fn volume_number(archive: &Path, path: &Path) -> Option<u64> {
    let prefix = archive.file_name()?.to_str()?;
    let name = path.file_name()?.to_str()?;
    let suffix = name.strip_prefix(prefix)?.strip_prefix('.')?;
    if suffix.len() < 3 || !suffix.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    suffix.parse().ok()
}

/// Writes `archive` as consecutive `part_size` byte ranges plus an index file, replacing any
/// volumes left by a previous, longer split so that a later join cannot pick up stale bytes.
pub fn split_spr_volumes<F>(archive: &Path, part_size: u64, mut progress: F) -> Result<SprVolumeSet>
where
    F: FnMut(u64, u64, u64),
{
    if part_size < MIN_SPR_VOLUME_SIZE {
        return Err(ObjectBuilderError::SerializationError(format!(
            "SPR volumes must be at least {} MiB",
            MIN_SPR_VOLUME_SIZE / (1024 * 1024)
        )));
    }
    let total_size = fs::metadata(archive)?.len();
    if total_size == 0 {
        return Err(ObjectBuilderError::SerializationError(
            "the written SPR archive is empty".into(),
        ));
    }
    let count = total_size.div_ceil(part_size);
    if count > MAX_SPR_VOLUMES {
        return Err(ObjectBuilderError::SerializationError(format!(
            "{part_size} byte volumes would split this SPR into {count} files; \
             the numbering only reaches {MAX_SPR_VOLUMES}"
        )));
    }
    let mut source = BufReader::new(fs::File::open(archive)?);
    let mut volumes = Vec::with_capacity(count as usize);
    let mut written = 0_u64;
    for number in 1..=count {
        let path = volume_path(archive, number);
        let temporary = temporary_path(&path);
        let mut output = BufWriter::new(fs::File::create(&temporary)?);
        let size = io::copy(&mut (&mut source).take(part_size), &mut output)?;
        output.flush()?;
        drop(output);
        if path.exists() {
            fs::remove_file(&path)?;
        }
        fs::rename(&temporary, &path)?;
        written += size;
        progress(written, total_size, number);
        volumes.push(SprVolume { path, size });
    }
    remove_stale_volumes(archive, count)?;
    let index = volume_index_path(archive);
    let archive_name = archive
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            ObjectBuilderError::SerializationError("SPR output name is not valid UTF-8".into())
        })?;
    let mut contents = format!(
        "SprVolumes\n  file: {archive_name}\n  part-size: {part_size}\n  total-size: {total_size}\n  parts: {count}\n"
    );
    for volume in &volumes {
        let name = volume
            .path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        contents.push_str(&format!("  part: {name} {}\n", volume.size));
    }
    fs::write(&index, contents)?;
    Ok(SprVolumeSet {
        index,
        volumes,
        part_size,
        total_size,
    })
}

/// Deletes the volumes of an earlier, finer split: `Tibia.spr.004` next to a three-volume
/// archive is bytes of a file that no longer exists, and a join would append them.
fn remove_stale_volumes(archive: &Path, count: u64) -> Result<()> {
    let Some(directory) = archive.parent() else {
        return Ok(());
    };
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if volume_number(archive, &path).is_some_and(|number| number > count) {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

/// The volumes of `archive`, in order, taken from its index file when there is one and from
/// the directory listing when there is not. `None` means this archive was never split.
pub fn spr_volumes(archive: &Path) -> Result<Option<Vec<SprVolume>>> {
    let index = volume_index_path(archive);
    if index.exists() {
        return Ok(Some(read_volume_index(archive, &index)?));
    }
    let Some(directory) = archive.parent().filter(|path| path.exists()) else {
        return Ok(None);
    };
    let mut numbered = Vec::new();
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if let Some(number) = volume_number(archive, &path) {
            let size = fs::metadata(&path)?.len();
            numbered.push((number, SprVolume { path, size }));
        }
    }
    if numbered.is_empty() {
        return Ok(None);
    }
    numbered.sort_by_key(|(number, _)| *number);
    for (position, (number, volume)) in numbered.iter().enumerate() {
        if *number != position as u64 + 1 {
            return Err(ObjectBuilderError::CorruptedFile(format!(
                "SPR volume {:03} is missing before {}",
                position + 1,
                volume.path.display()
            )));
        }
    }
    Ok(Some(
        numbered.into_iter().map(|(_, volume)| volume).collect(),
    ))
}

fn read_volume_index(archive: &Path, index: &Path) -> Result<Vec<SprVolume>> {
    let contents = fs::read_to_string(index)?;
    let Some(directory) = archive.parent() else {
        return Err(ObjectBuilderError::CorruptedFile(
            "the SPR volume index has no parent directory".into(),
        ));
    };
    let mut volumes = Vec::new();
    for line in contents.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.trim() != "part" {
            continue;
        }
        let mut fields = value.split_whitespace();
        let (Some(name), Some(size)) = (fields.next(), fields.next()) else {
            return Err(ObjectBuilderError::CorruptedFile(format!(
                "malformed volume entry in {}",
                index.display()
            )));
        };
        let size = size.parse::<u64>().map_err(|_| {
            ObjectBuilderError::CorruptedFile(format!(
                "volume {name} declares a size that is not a number"
            ))
        })?;
        volumes.push(SprVolume {
            path: directory.join(name),
            size,
        });
    }
    if volumes.is_empty() {
        return Err(ObjectBuilderError::CorruptedFile(format!(
            "{} lists no volumes",
            index.display()
        )));
    }
    Ok(volumes)
}

/// Rebuilds `archive` from its volumes, refusing anything the index does not describe: a
/// truncated or missing piece is a partial download, and concatenating it would produce an
/// SPR whose offset table points past the end of the file.
pub fn join_spr_volumes<F>(archive: &Path, mut progress: F) -> Result<u64>
where
    F: FnMut(u64, u64),
{
    let volumes = spr_volumes(archive)?.ok_or_else(|| {
        ObjectBuilderError::InvalidSpr(format!(
            "neither {} nor its volumes are present",
            archive.display()
        ))
    })?;
    let mut total = 0_u64;
    for volume in &volumes {
        let actual = fs::metadata(&volume.path)
            .map_err(|error| {
                ObjectBuilderError::CorruptedFile(format!(
                    "SPR volume {} is missing: {error}",
                    volume.path.display()
                ))
            })?
            .len();
        if actual != volume.size {
            return Err(ObjectBuilderError::CorruptedFile(format!(
                "SPR volume {} holds {actual} bytes, but {} were declared",
                volume.path.display(),
                volume.size
            )));
        }
        total += actual;
    }
    let temporary = temporary_path(archive);
    let mut output = BufWriter::new(fs::File::create(&temporary)?);
    let mut written = 0_u64;
    for volume in &volumes {
        let mut input = BufReader::new(fs::File::open(&volume.path)?);
        written += io::copy(&mut input, &mut output)?;
        progress(written, total);
    }
    output.flush()?;
    drop(output);
    if archive.exists() {
        fs::remove_file(archive)?;
    }
    fs::rename(&temporary, archive)?;
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sprites::{read_sprite, SpriteSource};
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

    #[test]
    fn writes_overrides_and_extends_the_sprite_table() {
        let root = std::env::temp_dir().join(format!("object-builder-spr-{}", std::process::id()));
        let source = root.with_extension("source.spr");
        let destination = root.with_extension("saved.spr");
        let original = SpriteImage::new(2, 2, [255, 0, 0, 255].repeat(4)).expect("image");
        let encoded = encode_sprite(&original, true).expect("encode");
        let offset = 12_u32;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&123_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        bytes.extend_from_slice(&offset.to_le_bytes());
        bytes.extend_from_slice(&[255, 0, 255]);
        bytes.extend_from_slice(&(encoded.len() as u16).to_le_bytes());
        bytes.extend_from_slice(&encoded);
        fs::write(&source, bytes).expect("source SPR");
        let replacement = SpriteImage::new(2, 2, [0, 255, 0, 255].repeat(4)).expect("image");
        let mut overrides = HashMap::new();
        overrides.insert(2, replacement.clone());
        let source_header = SprHeader {
            signature: 123,
            sprite_count: 1,
            table_offset: 8,
        };
        let header = save_spr_archive(
            SprSaveOptions {
                source: &source,
                source_header: &source_header,
                destination: &destination,
                overrides: &overrides,
                removed_ids: &HashSet::from([1]),
                extended: true,
                transparency: true,
                sprite_size: 2,
                create_backup: false,
            },
            |_| {},
        )
        .expect("save SPR");
        let decoded = read_sprite(
            &SpriteSource {
                path: destination.clone(),
                header: header.clone(),
                transparency: true,
                sprite_size: 2,
            },
            2,
        )
        .expect("read override");
        assert_eq!(decoded, replacement);
        let removed = read_sprite(
            &SpriteSource {
                path: destination.clone(),
                header: SprHeader {
                    signature: header.signature,
                    sprite_count: header.sprite_count,
                    table_offset: header.table_offset,
                },
                transparency: true,
                sprite_size: 2,
            },
            1,
        )
        .expect("removed sprite resolves as an empty table slot");
        assert!(removed.rgba.iter().all(|byte| *byte == 0));
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(destination);
    }
    #[test]
    fn splits_an_archive_into_volumes_and_joins_them_back() {
        let root = std::env::temp_dir().join(format!("object-builder-vol-{}", std::process::id()));
        fs::create_dir_all(&root).expect("volume directory");
        let archive = root.join("Tibia.spr");
        let bytes = (0..(MIN_SPR_VOLUME_SIZE * 2 + 512))
            .map(|index| index as u8)
            .collect::<Vec<_>>();
        fs::write(&archive, &bytes).expect("archive");
        // A stale fourth volume from a finer split must not survive into the new set.
        fs::write(volume_path(&archive, 4), b"stale").expect("stale volume");
        let set = split_spr_volumes(&archive, MIN_SPR_VOLUME_SIZE, |_, _, _| {}).expect("split");
        assert_eq!(set.volumes.len(), 3);
        assert_eq!(set.total_size, bytes.len() as u64);
        assert_eq!(set.volumes[2].size, 512);
        assert!(!volume_path(&archive, 4).exists());
        assert!(set.index.exists());
        fs::remove_file(&archive).expect("drop the complete archive");
        let joined = join_spr_volumes(&archive, |_, _| {}).expect("join");
        assert_eq!(joined, bytes.len() as u64);
        assert_eq!(fs::read(&archive).expect("rebuilt archive"), bytes);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_to_join_a_truncated_volume() {
        let root =
            std::env::temp_dir().join(format!("object-builder-vol-bad-{}", std::process::id()));
        fs::create_dir_all(&root).expect("volume directory");
        let archive = root.join("Tibia.spr");
        fs::write(&archive, vec![7_u8; (MIN_SPR_VOLUME_SIZE + 8) as usize]).expect("archive");
        split_spr_volumes(&archive, MIN_SPR_VOLUME_SIZE, |_, _, _| {}).expect("split");
        fs::write(volume_path(&archive, 2), b"cut").expect("truncate the last volume");
        let error = join_spr_volumes(&archive, |_, _| {}).expect_err("truncated volume");
        assert!(matches!(error, ObjectBuilderError::CorruptedFile(_)));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_a_volume_size_below_the_supported_minimum() {
        let root =
            std::env::temp_dir().join(format!("object-builder-vol-min-{}", std::process::id()));
        fs::create_dir_all(&root).expect("volume directory");
        let archive = root.join("Tibia.spr");
        fs::write(&archive, b"spr").expect("archive");
        assert!(split_spr_volumes(&archive, 4096, |_, _, _| {}).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
