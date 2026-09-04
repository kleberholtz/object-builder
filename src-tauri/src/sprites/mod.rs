use crate::core::error::{ObjectBuilderError, Result};
use crate::formats::spr::SprHeader;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpriteImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct SpriteSource {
    pub path: PathBuf,
    pub header: SprHeader,
    pub transparency: bool,
    pub sprite_size: u16,
}

pub fn read_sprite(source: &SpriteSource, id: u32) -> Result<SpriteImage> {
    if id == 0 || id > source.header.sprite_count {
        return Err(ObjectBuilderError::InvalidSprite(format!(
            "sprite ID {id} is outside 1..={}",
            source.header.sprite_count
        )));
    }
    let mut file = File::open(&source.path)?;
    let table_position = source.header.table_offset as u64 + u64::from(id - 1) * 4;
    file.seek(SeekFrom::Start(table_position))?;
    let mut offset_bytes = [0_u8; 4];
    file.read_exact(&mut offset_bytes)?;
    let data_offset = u32::from_le_bytes(offset_bytes);
    let side = u32::from(source.sprite_size);
    if data_offset == 0 {
        return SpriteImage::new(
            side,
            side,
            vec![0; usize::from(source.sprite_size) * usize::from(source.sprite_size) * 4],
        );
    }
    file.seek(SeekFrom::Start(u64::from(data_offset)))?;
    let mut color_key = [0_u8; 3];
    file.read_exact(&mut color_key)?;
    let mut length_bytes = [0_u8; 2];
    file.read_exact(&mut length_bytes)?;
    let data_length = usize::from(u16::from_le_bytes(length_bytes));
    let mut compressed = vec![0_u8; data_length];
    file.read_exact(&mut compressed)?;
    decode_sprite(&compressed, source.sprite_size, source.transparency)
}

fn decode_sprite(compressed: &[u8], sprite_size: u16, transparency: bool) -> Result<SpriteImage> {
    let pixel_count = usize::from(sprite_size) * usize::from(sprite_size);
    let mut rgba = vec![0_u8; pixel_count * 4];
    let channels = if transparency { 4 } else { 3 };
    let mut input = 0_usize;
    let mut output_pixel = 0_usize;
    while input < compressed.len() && output_pixel < pixel_count {
        let header = compressed
            .get(input..input + 4)
            .ok_or_else(|| ObjectBuilderError::CorruptedFile("truncated SPR run header".into()))?;
        input += 4;
        let transparent_pixels = usize::from(u16::from_le_bytes([header[0], header[1]]));
        let colored_pixels = usize::from(u16::from_le_bytes([header[2], header[3]]));
        output_pixel = output_pixel
            .checked_add(transparent_pixels)
            .ok_or_else(|| ObjectBuilderError::CorruptedFile("SPR pixel offset overflow".into()))?;
        if output_pixel > pixel_count || colored_pixels > pixel_count - output_pixel {
            return Err(ObjectBuilderError::CorruptedFile(
                "SPR run exceeds sprite bounds".into(),
            ));
        }
        let byte_count = colored_pixels
            .checked_mul(channels)
            .ok_or_else(|| ObjectBuilderError::CorruptedFile("SPR run size overflow".into()))?;
        let colors = compressed
            .get(input..input + byte_count)
            .ok_or_else(|| ObjectBuilderError::CorruptedFile("truncated SPR color run".into()))?;
        input += byte_count;
        for pixel in 0..colored_pixels {
            let source_index = pixel * channels;
            let target_index = (output_pixel + pixel) * 4;
            rgba[target_index..target_index + 3]
                .copy_from_slice(&colors[source_index..source_index + 3]);
            rgba[target_index + 3] = if transparency {
                colors[source_index + 3]
            } else {
                255
            };
        }
        output_pixel += colored_pixels;
    }
    SpriteImage::new(u32::from(sprite_size), u32::from(sprite_size), rgba)
}

impl SpriteImage {
    pub fn new(width: u32, height: u32, rgba: Vec<u8>) -> Result<Self> {
        let expected = usize::try_from(width)
            .unwrap_or(usize::MAX)
            .saturating_mul(usize::try_from(height).unwrap_or(usize::MAX))
            .saturating_mul(4);
        if rgba.len() != expected {
            return Err(ObjectBuilderError::InvalidSprite(format!(
                "expected {expected} RGBA bytes, got {}",
                rgba.len()
            )));
        }
        Ok(Self {
            width,
            height,
            rgba,
        })
    }

    #[allow(dead_code)]
    pub fn shifted(&self, dx: i32, dy: i32, protect_boundary: bool) -> Result<Self> {
        if protect_boundary {
            for y in 0..self.height {
                for x in 0..self.width {
                    let source = (usize::try_from(y * self.width + x).unwrap_or_default()) * 4;
                    if self.rgba.get(source + 3).copied().unwrap_or_default() == 0 {
                        continue;
                    }
                    let target_x = i64::from(x) + i64::from(dx);
                    let target_y = i64::from(y) + i64::from(dy);
                    if target_x < 0
                        || target_y < 0
                        || target_x >= i64::from(self.width)
                        || target_y >= i64::from(self.height)
                    {
                        return Err(ObjectBuilderError::InvalidSprite(
                            "shift would discard visible pixels".into(),
                        ));
                    }
                }
            }
        }
        let mut target = vec![0; self.rgba.len()];
        for y in 0..self.height {
            for x in 0..self.width {
                let target_x = i64::from(x) + i64::from(dx);
                let target_y = i64::from(y) + i64::from(dy);
                if target_x < 0
                    || target_y < 0
                    || target_x >= i64::from(self.width)
                    || target_y >= i64::from(self.height)
                {
                    continue;
                }
                let source = usize::try_from(y * self.width + x).unwrap_or_default() * 4;
                let destination = usize::try_from(target_y as u32 * self.width + target_x as u32)
                    .unwrap_or_default()
                    * 4;
                target[destination..destination + 4]
                    .copy_from_slice(&self.rgba[source..source + 4]);
            }
        }
        Self::new(self.width, self.height, target)
    }
}

#[allow(dead_code)]
pub fn slice_sheet(
    sheet: &SpriteImage,
    cell_width: u32,
    cell_height: u32,
    spacing: u32,
    margin: u32,
) -> Result<Vec<SpriteImage>> {
    if cell_width == 0 || cell_height == 0 {
        return Err(ObjectBuilderError::InvalidSprite(
            "cell dimensions must be non-zero".into(),
        ));
    }
    let mut sprites = Vec::new();
    let mut y = margin;
    while y + cell_height <= sheet.height {
        let mut x = margin;
        while x + cell_width <= sheet.width {
            let mut pixels = Vec::with_capacity(
                usize::try_from(cell_width * cell_height * 4).unwrap_or_default(),
            );
            for row in y..y + cell_height {
                let start = usize::try_from((row * sheet.width + x) * 4).unwrap_or_default();
                let end = start + usize::try_from(cell_width * 4).unwrap_or_default();
                pixels.extend_from_slice(&sheet.rgba[start..end]);
            }
            sprites.push(SpriteImage::new(cell_width, cell_height, pixels)?);
            x = x.saturating_add(cell_width).saturating_add(spacing);
        }
        y = y.saturating_add(cell_height).saturating_add(spacing);
    }
    Ok(sprites)
}

pub struct SpriteCache {
    capacity_bytes: usize,
    used_bytes: usize,
    values: HashMap<u32, SpriteImage>,
    order: VecDeque<u32>,
}
impl SpriteCache {
    pub fn new(capacity_bytes: usize) -> Self {
        Self {
            capacity_bytes,
            used_bytes: 0,
            values: HashMap::new(),
            order: VecDeque::new(),
        }
    }
    pub fn insert(&mut self, id: u32, image: SpriteImage) {
        if let Some(old) = self.values.remove(&id) {
            self.used_bytes = self.used_bytes.saturating_sub(old.rgba.len());
            self.order.retain(|entry| *entry != id);
        }
        while self.used_bytes + image.rgba.len() > self.capacity_bytes {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.values.remove(&oldest) {
                self.used_bytes = self.used_bytes.saturating_sub(removed.rgba.len());
            }
        }
        if image.rgba.len() <= self.capacity_bytes {
            self.used_bytes += image.rgba.len();
            self.order.push_back(id);
            self.values.insert(id, image);
        }
    }
    pub fn get(&mut self, id: u32) -> Option<&SpriteImage> {
        if self.values.contains_key(&id) {
            self.order.retain(|entry| *entry != id);
            self.order.push_back(id);
        }
        self.values.get(&id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    #[test]
    fn boundary_protection_rejects_pixel_loss() {
        let mut rgba = vec![0; 16];
        rgba[3] = 255;
        let sprite = SpriteImage::new(2, 2, rgba).expect("valid pixels");
        assert!(sprite.shifted(-1, 0, true).is_err());
        assert!(sprite.shifted(1, 0, true).is_ok());
    }
    #[test]
    fn slices_sheet_with_spacing_and_margin() {
        let sheet = SpriteImage::new(7, 4, vec![255; 7 * 4 * 4]).expect("valid sheet");
        let cells = slice_sheet(&sheet, 2, 2, 1, 1).expect("valid slice settings");
        assert_eq!(cells.len(), 2);
    }
    #[test]
    fn lru_cache_evicts_oldest_sprite() {
        let image = || SpriteImage::new(1, 1, vec![0; 4]).expect("valid sprite");
        let mut cache = SpriteCache::new(8);
        cache.insert(1, image());
        cache.insert(2, image());
        let _ = cache.get(1);
        cache.insert(3, image());
        assert!(cache.get(2).is_none());
        assert!(cache.get(1).is_some());
    }
    #[test]
    fn lazily_decodes_a_sprite_from_the_real_860_fixture_when_available() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../860/Tibia.spr");
        if !path.exists() {
            return;
        }
        let source = SpriteSource {
            path,
            header: SprHeader {
                signature: 0x4c22_0594,
                sprite_count: 732_782,
                table_offset: 8,
            },
            transparency: true,
            sprite_size: 32,
        };
        let image = read_sprite(&source, 453_694).expect("real sprite should decode");
        assert_eq!(image.rgba.len(), 4096);
        assert!(image.rgba.chunks_exact(4).any(|pixel| pixel[3] != 0));
    }
}
