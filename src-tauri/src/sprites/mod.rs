use crate::core::{dimensions::object_dimensions, error::{ObjectBuilderError, Result}, models::ThingObject};
use crate::formats::spr::SprHeader;
use image::{ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpriteImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub fn load_png(path: &std::path::Path) -> Result<SpriteImage> {
    let decoded = ImageReader::open(path)
        .map_err(|error| ObjectBuilderError::InvalidSprite(format!("unable to open PNG: {error}")))?
        .with_guessed_format()
        .map_err(|error| {
            ObjectBuilderError::InvalidSprite(format!("unable to detect image format: {error}"))
        })?;
    if decoded.format() != Some(ImageFormat::Png) {
        return Err(ObjectBuilderError::InvalidSprite(
            "the selected file is not a PNG image".into(),
        ));
    }
    let image = decoded
        .decode()
        .map_err(|error| {
            ObjectBuilderError::InvalidSprite(format!("unable to decode PNG: {error}"))
        })?
        .into_rgba8();
    SpriteImage::new(image.width(), image.height(), image.into_raw())
}

pub fn save_png(path: &std::path::Path, image: &SpriteImage) -> Result<()> {
    image::save_buffer_with_format(
        path,
        &image.rgba,
        image.width,
        image.height,
        image::ColorType::Rgba8,
        ImageFormat::Png,
    )
    .map_err(|error| ObjectBuilderError::IoError(format!("unable to write PNG: {error}")))
}

pub fn compose_sheet(images: &[SpriteImage]) -> Result<SpriteImage> {
    let first = images
        .first()
        .ok_or_else(|| ObjectBuilderError::InvalidSprite("there are no frames to export".into()))?;
    if images
        .iter()
        .any(|image| image.width != first.width || image.height != first.height)
    {
        return Err(ObjectBuilderError::InvalidSprite(
            "all sprites in a sheet must have matching dimensions".into(),
        ));
    }
    let columns = (f64::from(images.len() as u32).sqrt().ceil() as u32).max(1);
    let rows = (images.len() as u32).div_ceil(columns);
    let width = first.width.saturating_mul(columns);
    let height = first.height.saturating_mul(rows);
    let mut rgba = vec![
        0;
        usize::try_from(width.saturating_mul(height).saturating_mul(4))
            .unwrap_or_default()
    ];
    for (index, image) in images.iter().enumerate() {
        let column = index as u32 % columns;
        let row = index as u32 / columns;
        for y in 0..image.height {
            let source = usize::try_from(y * image.width * 4).unwrap_or_default();
            let destination =
                usize::try_from(((row * image.height + y) * width + column * image.width) * 4)
                    .unwrap_or_default();
            let length = usize::try_from(image.width * 4).unwrap_or_default();
            rgba[destination..destination + length]
                .copy_from_slice(&image.rgba[source..source + length]);
        }
    }
    SpriteImage::new(width, height, rgba)
}

pub fn render_object_frame<F>(
    object: &ThingObject,
    group_index: usize,
    frame_index: usize,
    pattern_index: usize,
    sprite_size: u16,
    mut resolve: F,
) -> Result<SpriteImage>
where
    F: FnMut(u32) -> Result<SpriteImage>,
{
    let dimensions = object_dimensions(object, sprite_size);
    let group = object.frame_groups.get(group_index).ok_or_else(|| ObjectBuilderError::InvalidSprite("frame group is outside this object".into()))?;
    if frame_index >= group.frames.len() { return Err(ObjectBuilderError::InvalidSprite("frame is outside this object".into())); }
    let tiles = usize::from(dimensions.tile_width) * usize::from(dimensions.tile_height);
    let layers = usize::from(dimensions.layers.max(1));
    let phase_stride = group.sprite_ids.len().checked_div(group.frames.len().max(1)).unwrap_or(0);
    let patterns = phase_stride.checked_div(tiles.saturating_mul(layers)).unwrap_or(0);
    if patterns == 0 || pattern_index >= patterns { return Err(ObjectBuilderError::InvalidSprite("sprite layout is inconsistent with object dimensions".into())); }
    let side = u32::from(sprite_size);
    let mut target = SpriteImage::new(dimensions.pixel_width, dimensions.pixel_height, vec![0; usize::try_from(dimensions.pixel_width.saturating_mul(dimensions.pixel_height).saturating_mul(4)).unwrap_or_default()])?;
    let base = frame_index * phase_stride + pattern_index * layers * tiles;
    for layer in 0..layers {
        for tile_y in 0..usize::from(dimensions.tile_height) {
            for tile_x in 0..usize::from(dimensions.tile_width) {
                let sprite_index = base + layer * tiles + tile_y * usize::from(dimensions.tile_width) + tile_x;
                let sprite_id = *group.sprite_ids.get(sprite_index).ok_or_else(|| ObjectBuilderError::InvalidSprite("sprite layout ends unexpectedly".into()))?;
                if sprite_id == 0 { continue; }
                let sprite = resolve(sprite_id)?;
                if sprite.width != side || sprite.height != side { return Err(ObjectBuilderError::InvalidSprite(format!("sprite {sprite_id} is {}×{}, expected {side}×{side}", sprite.width, sprite.height))); }
                let destination_x = (u32::from(dimensions.tile_width) - tile_x as u32 - 1) * side;
                let destination_y = (u32::from(dimensions.tile_height) - tile_y as u32 - 1) * side;
                blend_sprite(&mut target, &sprite, destination_x, destination_y);
            }
        }
    }
    Ok(target)
}

fn blend_sprite(target: &mut SpriteImage, source: &SpriteImage, destination_x: u32, destination_y: u32) {
    for y in 0..source.height {
        for x in 0..source.width {
            let source_index = usize::try_from((y * source.width + x) * 4).unwrap_or_default();
            let target_index = usize::try_from(((destination_y + y) * target.width + destination_x + x) * 4).unwrap_or_default();
            let alpha = u32::from(source.rgba[source_index + 3]);
            if alpha == 0 { continue; }
            let inverse = 255 - alpha;
            for channel in 0..3 { target.rgba[target_index + channel] = ((u32::from(source.rgba[source_index + channel]) * alpha + u32::from(target.rgba[target_index + channel]) * inverse) / 255) as u8; }
            target.rgba[target_index + 3] = (alpha + u32::from(target.rgba[target_index + 3]) * inverse / 255).min(255) as u8;
        }
    }
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

pub fn split_object_image(image: &SpriteImage, tile_width: u8, tile_height: u8, sprite_size: u16) -> Result<Vec<SpriteImage>> {
    let side = u32::from(sprite_size);
    let expected_width = u32::from(tile_width).saturating_mul(side);
    let expected_height = u32::from(tile_height).saturating_mul(side);
    if image.width != expected_width || image.height != expected_height {
        return Err(ObjectBuilderError::InvalidSprite(format!("object frame must be {expected_width}×{expected_height} pixels; received {}×{}", image.width, image.height)));
    }
    let mut tiles = Vec::with_capacity(usize::from(tile_width) * usize::from(tile_height));
    for tile_y in 0..u32::from(tile_height) {
        for tile_x in 0..u32::from(tile_width) {
            let source_x = (u32::from(tile_width) - tile_x - 1) * side;
            let source_y = (u32::from(tile_height) - tile_y - 1) * side;
            let mut rgba = Vec::with_capacity(usize::try_from(side * side * 4).unwrap_or_default());
            for y in 0..side {
                let start = usize::try_from(((source_y + y) * image.width + source_x) * 4).unwrap_or_default();
                let end = start + usize::try_from(side * 4).unwrap_or_default();
                rgba.extend_from_slice(&image.rgba[start..end]);
            }
            tiles.push(SpriteImage::new(side, side, rgba)?);
        }
    }
    Ok(tiles)
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
    #[test]
    fn png_round_trip_preserves_rgba_pixels() {
        let image = SpriteImage::new(
            2,
            2,
            vec![255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255],
        )
        .expect("valid image");
        let path =
            std::env::temp_dir().join(format!("object-builder-{}-sprite.png", std::process::id()));
        save_png(&path, &image).expect("PNG writes");
        let loaded = load_png(&path).expect("PNG reads");
        let _ = std::fs::remove_file(path);
        assert_eq!(loaded, image);
    }
}
