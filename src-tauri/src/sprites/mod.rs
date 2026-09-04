use crate::core::{
    dimensions::frame_group_dimensions,
    error::{ObjectBuilderError, Result},
    models::{ObjectKind, ThingObject},
};
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

/// Colors applied to the four canonical pixels in an outfit mask. This value is
/// deliberately accepted only by preview rendering; the underlying sprites stay
/// untouched and save/export can continue to use `render_object_frame`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutfitPreviewColors {
    pub head: [u8; 3],
    pub body: [u8; 3],
    pub legs: [u8; 3],
    pub feet: [u8; 3],
}

impl Default for OutfitPreviewColors {
    fn default() -> Self {
        Self {
            head: [239, 196, 143],
            body: [73, 112, 180],
            legs: [86, 96, 115],
            feet: [111, 72, 48],
        }
    }
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
    resolve: F,
) -> Result<SpriteImage>
where
    F: FnMut(u32) -> Result<SpriteImage>,
{
    render_object_frame_internal(
        object,
        group_index,
        frame_index,
        pattern_index,
        sprite_size,
        None,
        resolve,
    )
}

pub fn render_object_preview<F>(
    object: &ThingObject,
    group_index: usize,
    frame_index: usize,
    pattern_index: usize,
    sprite_size: u16,
    colors: OutfitPreviewColors,
    resolve: F,
) -> Result<SpriteImage>
where
    F: FnMut(u32) -> Result<SpriteImage>,
{
    render_object_frame_internal(
        object,
        group_index,
        frame_index,
        pattern_index,
        sprite_size,
        Some(colors),
        resolve,
    )
}

pub fn render_outfit_preview_with_base<F>(
    object: &ThingObject,
    group_index: usize,
    frame_index: usize,
    pattern_index: usize,
    sprite_size: u16,
    colors: OutfitPreviewColors,
    mut resolve: F,
) -> Result<SpriteImage>
where
    F: FnMut(u32) -> Result<SpriteImage>,
{
    let direction_count = object
        .frame_groups
        .get(group_index)
        .map(|group| usize::from(group.layout.pattern_x.max(1)))
        .ok_or_else(|| {
            ObjectBuilderError::InvalidSprite("frame group is outside this object".into())
        })?;
    let base_pattern_index = pattern_index % direction_count;
    let mut target = render_object_frame_internal(
        object,
        group_index,
        frame_index,
        base_pattern_index,
        sprite_size,
        Some(colors),
        &mut resolve,
    )?;
    if pattern_index != base_pattern_index {
        let addon = render_object_frame_internal(
            object,
            group_index,
            frame_index,
            pattern_index,
            sprite_size,
            Some(colors),
            &mut resolve,
        )?;
        blend_sprite(&mut target, &addon, 0, 0);
    }
    Ok(target)
}

pub fn render_outfit_preview_with_all_addons<F>(
    object: &ThingObject,
    group_index: usize,
    frame_index: usize,
    direction: usize,
    sprite_size: u16,
    colors: OutfitPreviewColors,
    include_base: bool,
    mut resolve: F,
) -> Result<SpriteImage>
where
    F: FnMut(u32) -> Result<SpriteImage>,
{
    let group = object.frame_groups.get(group_index).ok_or_else(|| {
        ObjectBuilderError::InvalidSprite("frame group is outside this object".into())
    })?;
    let direction_count = usize::from(group.layout.pattern_x.max(1));
    let addon_count = usize::from(group.layout.pattern_y.max(1));
    let direction = direction % direction_count;
    // Without the body, the composition starts on the first addon row instead of the base one.
    let first_addon = usize::from(!include_base && addon_count > 1);
    let mut target = render_object_frame_internal(
        object,
        group_index,
        frame_index,
        first_addon * direction_count + direction,
        sprite_size,
        Some(colors),
        &mut resolve,
    )?;
    for addon in (first_addon + 1)..addon_count {
        let image = render_object_frame_internal(
            object,
            group_index,
            frame_index,
            addon * direction_count + direction,
            sprite_size,
            Some(colors),
            &mut resolve,
        )?;
        blend_sprite(&mut target, &image, 0, 0);
    }
    Ok(target)
}

fn render_object_frame_internal<F>(
    object: &ThingObject,
    group_index: usize,
    frame_index: usize,
    pattern_index: usize,
    sprite_size: u16,
    outfit_colors: Option<OutfitPreviewColors>,
    mut resolve: F,
) -> Result<SpriteImage>
where
    F: FnMut(u32) -> Result<SpriteImage>,
{
    let group = object.frame_groups.get(group_index).ok_or_else(|| {
        ObjectBuilderError::InvalidSprite("frame group is outside this object".into())
    })?;
    let dimensions = frame_group_dimensions(object, group_index, sprite_size);
    if frame_index >= group.frames.len() {
        return Err(ObjectBuilderError::InvalidSprite(
            "frame is outside this object".into(),
        ));
    }
    let tiles = usize::from(dimensions.tile_width) * usize::from(dimensions.tile_height);
    let layers = usize::from(dimensions.layers.max(1));
    let phase_stride = group
        .sprite_ids
        .len()
        .checked_div(group.frames.len().max(1))
        .unwrap_or(0);
    let patterns = phase_stride
        .checked_div(tiles.saturating_mul(layers))
        .unwrap_or(0);
    if patterns == 0 || pattern_index >= patterns {
        return Err(ObjectBuilderError::InvalidSprite(
            "sprite layout is inconsistent with object dimensions".into(),
        ));
    }
    let side = u32::from(sprite_size);
    let mut target = SpriteImage::new(
        dimensions.pixel_width,
        dimensions.pixel_height,
        vec![
            0;
            usize::try_from(
                dimensions
                    .pixel_width
                    .saturating_mul(dimensions.pixel_height)
                    .saturating_mul(4)
            )
            .unwrap_or_default()
        ],
    )?;
    let base = frame_index * phase_stride + pattern_index * layers * tiles;
    let colorized_outfit =
        object.kind == ObjectKind::Outfit && layers >= 2 && outfit_colors.is_some();
    for layer in 0..layers {
        // Tibia outfits use layer zero as the base and layer one as the four-color
        // mask. Extra layers are not independent artwork in this layout.
        if colorized_outfit && layer > 1 {
            continue;
        }
        for tile_y in 0..usize::from(dimensions.tile_height) {
            for tile_x in 0..usize::from(dimensions.tile_width) {
                let sprite_index =
                    base + layer * tiles + tile_y * usize::from(dimensions.tile_width) + tile_x;
                let sprite_id = *group.sprite_ids.get(sprite_index).ok_or_else(|| {
                    ObjectBuilderError::InvalidSprite("sprite layout ends unexpectedly".into())
                })?;
                if sprite_id == 0 {
                    continue;
                }
                let sprite = resolve(sprite_id)?;
                if sprite.width != side || sprite.height != side {
                    return Err(ObjectBuilderError::InvalidSprite(format!(
                        "sprite {sprite_id} is {}×{}, expected {side}×{side}",
                        sprite.width, sprite.height
                    )));
                }
                let destination_x = (u32::from(dimensions.tile_width) - tile_x as u32 - 1) * side;
                let destination_y = (u32::from(dimensions.tile_height) - tile_y as u32 - 1) * side;
                if colorized_outfit && layer == 1 {
                    apply_outfit_mask(
                        &mut target,
                        &sprite,
                        destination_x,
                        destination_y,
                        outfit_colors.expect("colorized outfits always have preview colors"),
                    );
                } else {
                    blend_sprite(&mut target, &sprite, destination_x, destination_y);
                }
            }
        }
    }
    Ok(target)
}

fn apply_outfit_mask(
    target: &mut SpriteImage,
    mask: &SpriteImage,
    destination_x: u32,
    destination_y: u32,
    colors: OutfitPreviewColors,
) {
    for y in 0..mask.height {
        for x in 0..mask.width {
            let mask_index = usize::try_from((y * mask.width + x) * 4).unwrap_or_default();
            let alpha = u32::from(mask.rgba[mask_index + 3]);
            if alpha == 0 {
                continue;
            }
            let color = match (
                mask.rgba[mask_index],
                mask.rgba[mask_index + 1],
                mask.rgba[mask_index + 2],
            ) {
                (255, 255, 0) => colors.head,
                (255, 0, 0) => colors.body,
                (0, 255, 0) => colors.legs,
                (0, 0, 255) => colors.feet,
                _ => continue,
            };
            let target_index =
                usize::try_from(((destination_y + y) * target.width + destination_x + x) * 4)
                    .unwrap_or_default();
            let inverse = 255 - alpha;
            for (channel, tint) in color.iter().enumerate() {
                let original = u32::from(target.rgba[target_index + channel]);
                let multiplied = original * u32::from(*tint) / 255;
                target.rgba[target_index + channel] =
                    ((multiplied * alpha + original * inverse) / 255) as u8;
            }
        }
    }
}

fn blend_sprite(
    target: &mut SpriteImage,
    source: &SpriteImage,
    destination_x: u32,
    destination_y: u32,
) {
    for y in 0..source.height {
        for x in 0..source.width {
            let source_index = usize::try_from((y * source.width + x) * 4).unwrap_or_default();
            let target_index =
                usize::try_from(((destination_y + y) * target.width + destination_x + x) * 4)
                    .unwrap_or_default();
            let alpha = u32::from(source.rgba[source_index + 3]);
            if alpha == 0 {
                continue;
            }
            let inverse = 255 - alpha;
            for channel in 0..3 {
                target.rgba[target_index + channel] =
                    ((u32::from(source.rgba[source_index + channel]) * alpha
                        + u32::from(target.rgba[target_index + channel]) * inverse)
                        / 255) as u8;
            }
            target.rgba[target_index + 3] =
                (alpha + u32::from(target.rgba[target_index + 3]) * inverse / 255).min(255) as u8;
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

/// Returns the physical byte span occupied by every sprite block in the SPR.
/// The offset table is read sequentially and blocks are measured by their next
/// physical offset, so this does not decode or load sprite pixels.
pub fn sprite_storage_sizes(source: &SpriteSource) -> Result<Vec<u64>> {
    let mut file = File::open(&source.path)?;
    let file_length = file.metadata()?.len();
    file.seek(SeekFrom::Start(source.header.table_offset as u64))?;
    let count = usize::try_from(source.header.sprite_count).unwrap_or(usize::MAX);
    let mut indexed_offsets = Vec::with_capacity(count);
    let mut bytes = [0_u8; 4];
    for index in 0..count {
        file.read_exact(&mut bytes)?;
        let offset = u64::from(u32::from_le_bytes(bytes));
        if offset != 0 {
            if offset > file_length {
                return Err(ObjectBuilderError::InvalidSpr(format!(
                    "sprite {} points outside the SPR file",
                    index + 1
                )));
            }
            indexed_offsets.push((offset, index));
        }
    }
    indexed_offsets.sort_unstable_by_key(|(offset, _)| *offset);
    let mut sizes = vec![0_u64; count];
    let mut cursor = 0;
    while cursor < indexed_offsets.len() {
        let offset = indexed_offsets[cursor].0;
        let mut group_end = cursor + 1;
        while group_end < indexed_offsets.len() && indexed_offsets[group_end].0 == offset {
            group_end += 1;
        }
        let next_offset = indexed_offsets
            .get(group_end)
            .map(|(candidate, _)| *candidate)
            .unwrap_or(file_length);
        for (_, sprite_index) in &indexed_offsets[cursor..group_end] {
            sizes[*sprite_index] = next_offset.saturating_sub(offset);
        }
        cursor = group_end;
    }
    Ok(sizes)
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

/// Decodes many sprites while keeping a single SPR file handle open. This is
/// used by checksum analysis so large clients do not reopen the archive once
/// per sprite.
pub fn visit_sprites<F>(source: &SpriteSource, ids: &[u32], mut visit: F) -> Result<()>
where
    F: FnMut(u32, SpriteImage) -> Result<()>,
{
    let mut file = File::open(&source.path)?;
    file.seek(SeekFrom::Start(source.header.table_offset as u64))?;
    let table_len = usize::try_from(source.header.sprite_count)
        .unwrap_or(usize::MAX)
        .checked_mul(4)
        .ok_or_else(|| ObjectBuilderError::InvalidSpr("sprite table size overflow".into()))?;
    let mut table = vec![0_u8; table_len];
    file.read_exact(&mut table)?;
    let side = u32::from(source.sprite_size);
    let blank = || {
        SpriteImage::new(
            side,
            side,
            vec![0; usize::from(source.sprite_size) * usize::from(source.sprite_size) * 4],
        )
    };
    for &id in ids {
        if id == 0 || id > source.header.sprite_count {
            return Err(ObjectBuilderError::InvalidSprite(format!(
                "sprite ID {id} is outside 1..={}",
                source.header.sprite_count
            )));
        }
        let index = usize::try_from(id - 1).unwrap_or_default() * 4;
        let data_offset =
            u32::from_le_bytes(table[index..index + 4].try_into().unwrap_or_default());
        if data_offset == 0 {
            visit(id, blank()?)?;
            continue;
        }
        file.seek(SeekFrom::Start(u64::from(data_offset) + 3))?;
        let mut length_bytes = [0_u8; 2];
        file.read_exact(&mut length_bytes)?;
        let mut compressed = vec![0_u8; usize::from(u16::from_le_bytes(length_bytes))];
        file.read_exact(&mut compressed)?;
        visit(
            id,
            decode_sprite(&compressed, source.sprite_size, source.transparency)?,
        )?;
    }
    Ok(())
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

/// Indices into `group.sprite_ids` addressing the tiles of a single layer of one
/// frame/pattern, in the order `split_object_image` produces its tiles. Both the
/// layer renderer and the layer writer read the layout through here, so a frame
/// always reads back from the slots it was written to.
pub fn frame_layer_slots(
    object: &ThingObject,
    group_index: usize,
    frame_index: usize,
    pattern_index: usize,
    layer: usize,
    sprite_size: u16,
) -> Result<Vec<usize>> {
    let group = object.frame_groups.get(group_index).ok_or_else(|| {
        ObjectBuilderError::InvalidSprite("frame group is outside this object".into())
    })?;
    if frame_index >= group.frames.len() {
        return Err(ObjectBuilderError::InvalidSprite(
            "frame is outside this object".into(),
        ));
    }
    let dimensions = frame_group_dimensions(object, group_index, sprite_size);
    let tiles = usize::from(dimensions.tile_width) * usize::from(dimensions.tile_height);
    let layers = usize::from(dimensions.layers.max(1));
    if layer >= layers {
        return Err(ObjectBuilderError::InvalidSprite(
            "layer is outside this object".into(),
        ));
    }
    let phase_stride = group
        .sprite_ids
        .len()
        .checked_div(group.frames.len().max(1))
        .unwrap_or(0);
    let patterns = phase_stride
        .checked_div(tiles.saturating_mul(layers))
        .unwrap_or(0);
    if patterns == 0 || pattern_index >= patterns {
        return Err(ObjectBuilderError::InvalidSprite(
            "sprite layout is inconsistent with object dimensions".into(),
        ));
    }
    let base = frame_index * phase_stride + pattern_index * layers * tiles + layer * tiles;
    if base + tiles > group.sprite_ids.len() {
        return Err(ObjectBuilderError::InvalidSprite(
            "sprite layout ends unexpectedly".into(),
        ));
    }
    Ok((base..base + tiles).collect())
}

/// One layer of one frame, drawn without the outfit mask. This is what the pixel
/// editor paints on: the preview composites layers and tints the mask, and neither
/// of those can be inverted back into sprite bytes.
pub fn render_object_layer<F>(
    object: &ThingObject,
    group_index: usize,
    frame_index: usize,
    pattern_index: usize,
    layer: usize,
    sprite_size: u16,
    mut resolve: F,
) -> Result<SpriteImage>
where
    F: FnMut(u32) -> Result<SpriteImage>,
{
    let slots = frame_layer_slots(
        object,
        group_index,
        frame_index,
        pattern_index,
        layer,
        sprite_size,
    )?;
    let group = object.frame_groups.get(group_index).ok_or_else(|| {
        ObjectBuilderError::InvalidSprite("frame group is outside this object".into())
    })?;
    let dimensions = frame_group_dimensions(object, group_index, sprite_size);
    let side = u32::from(sprite_size);
    let tile_width = u32::from(dimensions.tile_width);
    let tile_height = u32::from(dimensions.tile_height);
    let mut target = SpriteImage::new(
        dimensions.pixel_width,
        dimensions.pixel_height,
        vec![
            0;
            usize::try_from(
                dimensions
                    .pixel_width
                    .saturating_mul(dimensions.pixel_height)
                    .saturating_mul(4)
            )
            .unwrap_or_default()
        ],
    )?;
    for (index, slot) in slots.iter().enumerate() {
        let sprite_id = group.sprite_ids.get(*slot).copied().unwrap_or_default();
        if sprite_id == 0 {
            continue;
        }
        let sprite = resolve(sprite_id)?;
        if sprite.width != side || sprite.height != side {
            return Err(ObjectBuilderError::InvalidSprite(format!(
                "sprite {sprite_id} is {}×{}, expected {side}×{side}",
                sprite.width, sprite.height
            )));
        }
        let tile_x = index as u32 % tile_width;
        let tile_y = index as u32 / tile_width;
        blend_sprite(
            &mut target,
            &sprite,
            (tile_width - tile_x - 1) * side,
            (tile_height - tile_y - 1) * side,
        );
    }
    Ok(target)
}

pub fn split_object_image(
    image: &SpriteImage,
    tile_width: u8,
    tile_height: u8,
    sprite_size: u16,
) -> Result<Vec<SpriteImage>> {
    let side = u32::from(sprite_size);
    let expected_width = u32::from(tile_width).saturating_mul(side);
    let expected_height = u32::from(tile_height).saturating_mul(side);
    if image.width != expected_width || image.height != expected_height {
        return Err(ObjectBuilderError::InvalidSprite(format!(
            "object frame must be {expected_width}×{expected_height} pixels; received {}×{}",
            image.width, image.height
        )));
    }
    let mut tiles = Vec::with_capacity(usize::from(tile_width) * usize::from(tile_height));
    for tile_y in 0..u32::from(tile_height) {
        for tile_x in 0..u32::from(tile_width) {
            let source_x = (u32::from(tile_width) - tile_x - 1) * side;
            let source_y = (u32::from(tile_height) - tile_y - 1) * side;
            let mut rgba = Vec::with_capacity(usize::try_from(side * side * 4).unwrap_or_default());
            for y in 0..side {
                let start = usize::try_from(((source_y + y) * image.width + source_x) * 4)
                    .unwrap_or_default();
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
    pub fn clear(&mut self) {
        self.values.clear();
        self.order.clear();
        self.used_bytes = 0;
    }
    pub fn used_bytes(&self) -> usize {
        self.used_bytes
    }
    pub fn capacity_bytes(&self) -> usize {
        self.capacity_bytes
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
    fn measures_physical_sprite_blocks_from_the_offset_table() {
        let path = std::env::temp_dir().join(format!(
            "object-builder-{}-sprite-sizes.spr",
            std::process::id()
        ));
        let mut bytes = vec![0_u8; 20];
        bytes[8..12].copy_from_slice(&20_u32.to_le_bytes());
        bytes[16..20].copy_from_slice(&27_u32.to_le_bytes());
        bytes.extend([0_u8; 7]);
        bytes.extend([0_u8; 9]);
        std::fs::write(&path, bytes).expect("fixture writes");
        let sizes = sprite_storage_sizes(&SpriteSource {
            path: path.clone(),
            header: SprHeader {
                signature: 0,
                sprite_count: 3,
                table_offset: 8,
            },
            transparency: true,
            sprite_size: 32,
        })
        .expect("sizes read");
        let _ = std::fs::remove_file(path);
        assert_eq!(sizes, vec![7, 0, 9]);
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
    #[test]
    fn renders_multi_tile_objects_at_their_real_dimensions() {
        let mut object = crate::core::models::test_object();
        object.dimensions.width = 2;
        object.frame_groups[0].layout.width = 2;
        object.frame_groups[0].sprite_ids = vec![1, 2];
        let rendered = render_object_frame(&object, 0, 0, 0, 2, |id| {
            let color = if id == 1 {
                [255, 0, 0, 255]
            } else {
                [0, 0, 255, 255]
            };
            SpriteImage::new(2, 2, color.repeat(4))
        })
        .expect("multi-tile object renders");
        assert_eq!((rendered.width, rendered.height), (4, 2));
        assert_eq!(&rendered.rgba[0..4], &[0, 0, 255, 255]);
        assert_eq!(&rendered.rgba[8..12], &[255, 0, 0, 255]);
    }
    #[test]
    fn a_rendered_layer_splits_back_into_the_tiles_it_was_drawn_from() {
        // The tile order of `split_object_image` is the reverse of the pixel order, so a
        // sign flip here would round-trip a two-tile frame mirrored and silently swap the
        // sprites of every wide object the editor touches.
        let mut object = crate::core::models::test_object();
        object.dimensions.width = 2;
        object.frame_groups[0].layout.width = 2;
        object.frame_groups[0].sprite_ids = vec![7, 9];
        let tile = |id: u32| SpriteImage::new(2, 2, [id as u8, 0, 0, 255].repeat(4));
        let rendered =
            render_object_layer(&object, 0, 0, 0, 0, 2, |id| tile(id)).expect("layer renders");
        assert_eq!((rendered.width, rendered.height), (4, 2));
        let slots = frame_layer_slots(&object, 0, 0, 0, 0, 2).expect("slots resolve");
        assert_eq!(slots, vec![0, 1]);
        let split = split_object_image(&rendered, 2, 1, 2).expect("frame splits");
        assert_eq!(split.len(), 2);
        for (index, slot) in slots.iter().enumerate() {
            let id = object.frame_groups[0].sprite_ids[*slot];
            assert_eq!(split[index].rgba, tile(id).expect("fixture tile").rgba);
        }
    }

    #[test]
    fn a_layer_renders_without_the_layer_beside_it() {
        let mut object = crate::core::models::test_object();
        object.kind = ObjectKind::Outfit;
        object.dimensions.layers = 2;
        object.frame_groups[0].layout.layers = 2;
        object.frame_groups[0].sprite_ids = vec![1, 2];
        let base = render_object_layer(&object, 0, 0, 0, 0, 2, |id| {
            assert_eq!(id, 1, "layer zero only reads its own tile");
            SpriteImage::new(2, 2, [200, 160, 120, 255].repeat(4))
        })
        .expect("base layer renders");
        assert_eq!(&base.rgba[0..4], &[200, 160, 120, 255]);
        let mask = render_object_layer(&object, 0, 0, 0, 1, 2, |id| {
            assert_eq!(id, 2, "layer one only reads its own tile");
            SpriteImage::new(2, 2, [255, 255, 0, 255].repeat(4))
        })
        .expect("mask layer renders");
        // The mask reaches the editor as the raw yellow it is stored as, not tinted.
        assert_eq!(&mask.rgba[0..4], &[255, 255, 0, 255]);
    }

    #[test]
    fn a_layer_outside_the_object_is_refused() {
        let object = crate::core::models::test_object();
        assert!(frame_layer_slots(&object, 0, 0, 0, 4, 32).is_err());
    }

    #[test]
    fn colorizes_the_four_outfit_mask_channels_without_changing_the_base_alpha() {
        let mut object = crate::core::models::test_object();
        object.kind = ObjectKind::Outfit;
        object.dimensions.layers = 2;
        object.frame_groups[0].layout.layers = 2;
        object.frame_groups[0].sprite_ids = vec![1, 2];
        let rendered = render_object_preview(
            &object,
            0,
            0,
            0,
            2,
            OutfitPreviewColors {
                head: [255, 0, 0],
                body: [0, 255, 0],
                legs: [0, 0, 255],
                feet: [255, 255, 255],
            },
            |id| {
                if id == 1 {
                    SpriteImage::new(2, 2, [200, 160, 120, 255].repeat(4))
                } else {
                    SpriteImage::new(
                        2,
                        2,
                        vec![
                            255, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
                        ],
                    )
                }
            },
        )
        .expect("outfit preview renders");
        assert_eq!(&rendered.rgba[0..4], &[200, 0, 0, 255]);
        assert_eq!(&rendered.rgba[4..8], &[0, 160, 0, 255]);
        assert_eq!(&rendered.rgba[8..12], &[0, 0, 120, 255]);
        assert_eq!(&rendered.rgba[12..16], &[200, 160, 120, 255]);
    }
    #[test]
    fn renders_the_selected_outfit_direction_pattern() {
        let mut object = crate::core::models::test_object();
        object.kind = ObjectKind::Outfit;
        object.dimensions.patterns = 4;
        object.frame_groups[0].layout.pattern_x = 4;
        object.frame_groups[0].sprite_ids = vec![1, 2, 3, 4];
        let rendered =
            render_object_preview(&object, 0, 0, 3, 1, OutfitPreviewColors::default(), |id| {
                SpriteImage::new(1, 1, vec![id as u8, 0, 0, 255])
            })
            .expect("direction preview renders");
        assert_eq!(rendered.rgba, vec![4, 0, 0, 255]);
    }
    #[test]
    fn composes_an_outfit_addon_over_its_directional_body() {
        let mut object = crate::core::models::test_object();
        object.kind = ObjectKind::Outfit;
        object.dimensions.patterns = 2;
        object.frame_groups[0].layout.pattern_y = 2;
        object.frame_groups[0].sprite_ids = vec![1, 2];
        let rendered = render_outfit_preview_with_base(
            &object,
            0,
            0,
            1,
            2,
            OutfitPreviewColors::default(),
            |id| {
                let rgba = if id == 1 {
                    vec![
                        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
                    ]
                } else {
                    vec![0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
                };
                SpriteImage::new(2, 2, rgba)
            },
        )
        .expect("outfit body and addon render together");
        assert_eq!(&rendered.rgba[0..4], &[0, 0, 255, 255]);
        assert_eq!(&rendered.rgba[4..8], &[255, 0, 0, 255]);
    }
    #[test]
    fn renders_a_real_multi_tile_860_object_when_available() {
        use crate::core::models::ClientVersion;
        use crate::formats::{dat::DatFormat, otfi::DatSprConfig, spr::SprFormat, ObjectFormat};
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../860");
        let dat_path = root.join("Tibia.dat");
        let spr_path = root.join("Tibia.spr");
        if !dat_path.exists() || !spr_path.exists() {
            return;
        }
        let config = DatSprConfig::load(&root.join("Tibia.otfi"), ClientVersion::Tibia860)
            .expect("real OTFI");
        let database = DatFormat {
            version: ClientVersion::Tibia860,
            features: config.features,
        }
        .load(&dat_path)
        .expect("real DAT");
        let object = database
            .objects
            .iter()
            .find(|object| object.dimensions.width > 1 || object.dimensions.height > 1)
            .expect("multi-tile object");
        let header = SprFormat {
            version: ClientVersion::Tibia860,
            extended: config.features.extended,
        }
        .inspect_path(&spr_path)
        .expect("real SPR");
        let source = SpriteSource {
            path: spr_path,
            header,
            transparency: config.features.transparency,
            sprite_size: config.features.sprite_size,
        };
        let rendered = render_object_frame(object, 0, 0, 0, config.features.sprite_size, |id| {
            read_sprite(&source, id)
        })
        .expect("real multi-tile render");
        assert_eq!(
            rendered.width,
            u32::from(object.dimensions.width) * u32::from(config.features.sprite_size)
        );
        assert_eq!(
            rendered.height,
            u32::from(object.dimensions.height) * u32::from(config.features.sprite_size)
        );
    }
}
