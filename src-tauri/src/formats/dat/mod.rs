use crate::{
    core::{
        error::{ObjectBuilderError, Result},
        models::{
            Animation, AnimationMode, Attribute, ClientFeatures, ClientVersion, Dimensions,
            FormatMetadata, Frame, FrameGroup, FrameLayout, Gameplay, ObjectCounts, ObjectDatabase,
            ObjectKind, Position, ThingObject,
        },
    },
    formats::ObjectFormat,
};
use std::{collections::BTreeMap, fs, path::Path};

pub struct DatFormat {
    pub version: ClientVersion,
    pub features: ClientFeatures,
}

struct Cursor<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }
    fn take(&mut self, amount: usize) -> Result<&'a [u8]> {
        let end = self
            .position
            .checked_add(amount)
            .ok_or_else(|| ObjectBuilderError::CorruptedFile("cursor overflow".into()))?;
        let value = self.bytes.get(self.position..end).ok_or_else(|| {
            ObjectBuilderError::CorruptedFile(format!(
                "unexpected end of DAT at byte {}",
                self.position
            ))
        })?;
        self.position = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn i8(&mut self) -> Result<i8> {
        Ok(self.u8()? as i8)
    }
    fn u16(&mut self) -> Result<u16> {
        let bytes = self.take(2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }
    fn u32(&mut self) -> Result<u32> {
        let bytes = self.take(4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }
    fn i32(&mut self) -> Result<i32> {
        Ok(self.u32()? as i32)
    }
    fn string(&mut self) -> Result<String> {
        let length = usize::from(self.u16()?);
        String::from_utf8(self.take(length)?.to_vec()).map_err(|error| {
            ObjectBuilderError::InvalidDat(format!("invalid market name: {error}"))
        })
    }
}

impl DatFormat {
    pub fn parse(&self, bytes: Vec<u8>) -> Result<ObjectDatabase> {
        self.parse_with_progress(bytes, |_, _| {})
    }

    pub fn parse_with_progress<F>(&self, bytes: Vec<u8>, mut progress: F) -> Result<ObjectDatabase>
    where
        F: FnMut(usize, usize),
    {
        if bytes.len() < 12 {
            return Err(ObjectBuilderError::InvalidDat(
                "header is shorter than 12 bytes".into(),
            ));
        }
        let mut cursor = Cursor::new(&bytes);
        let signature = cursor.u32()?;
        let counts = ObjectCounts {
            items: cursor.u16()?,
            outfits: cursor.u16()?,
            effects: cursor.u16()?,
            missiles: cursor.u16()?,
        };
        if counts.items < 100 {
            return Err(ObjectBuilderError::InvalidDat(
                "item count is below the protocol base ID (100)".into(),
            ));
        }

        let expected = usize::from(counts.items - 99)
            + usize::from(counts.outfits)
            + usize::from(counts.effects)
            + usize::from(counts.missiles);
        let mut objects = Vec::with_capacity(expected);
        for (kind, first_id, last_id) in [
            (ObjectKind::Item, 100_u16, counts.items),
            (ObjectKind::Outfit, 1, counts.outfits),
            (ObjectKind::Effect, 1, counts.effects),
            (ObjectKind::Missile, 1, counts.missiles),
        ] {
            for id in first_id..=last_id {
                let start = cursor.position;
                let mut object = self.parse_thing(&mut cursor, u32::from(id), kind)?;
                object.raw_record = bytes[start..cursor.position].to_vec();
                objects.push(object);
                if objects.len() % 256 == 0 || objects.len() == expected {
                    progress(objects.len(), expected);
                }
            }
        }
        if cursor.position != bytes.len() {
            return Err(ObjectBuilderError::InvalidDat(format!(
                "{} trailing bytes remain after {} objects",
                bytes.len() - cursor.position,
                objects.len()
            )));
        }
        Ok(ObjectDatabase {
            version: self.version,
            objects,
            metadata: FormatMetadata {
                dat_signature: Some(signature),
                counts,
                ..FormatMetadata::default()
            },
            original_dat: Some(bytes),
            original_spr: None,
        })
    }

    fn parse_thing(
        &self,
        cursor: &mut Cursor<'_>,
        id: u32,
        kind: ObjectKind,
    ) -> Result<ThingObject> {
        let mut flags = BTreeMap::new();
        let mut attributes = Vec::new();
        let mut position = Position {
            x: 0,
            y: 0,
            elevation: 0,
        };
        let mut gameplay = Gameplay {
            ground_speed: 0,
            light_level: 0,
            light_color: 0,
            minimap_color: 0,
        };
        let mut completed = false;
        for _ in 0..255 {
            let raw_attribute = cursor.u8()?;
            if raw_attribute == 255 {
                completed = true;
                break;
            }
            let attribute = normalize_attribute(raw_attribute, self.version.numeric());
            let name = attribute_name(attribute).ok_or_else(|| {
                ObjectBuilderError::InvalidDat(format!(
                    "unsupported attribute {attribute} in {kind:?} {id}"
                ))
            })?;
            flags.insert(name.into(), true);
            match attribute {
                0 => gameplay.ground_speed = cursor.u16()?,
                8 | 9 | 29 | 32 | 34 => {
                    attributes.push(Attribute {
                        key: name.into(),
                        value: cursor.u16()?.to_string(),
                    });
                }
                21 => {
                    gameplay.light_level = cursor.u16()?.min(u16::from(u8::MAX)) as u8;
                    gameplay.light_color = cursor.u16()?;
                }
                24 => {
                    position.x = cursor.u16()? as i16;
                    position.y = cursor.u16()? as i16;
                }
                25 => position.elevation = cursor.u16()?.min(u16::from(u8::MAX)) as u8,
                28 => gameplay.minimap_color = cursor.u16()?,
                33 => {
                    let category = cursor.u16()?;
                    let trade_as = cursor.u16()?;
                    let show_as = cursor.u16()?;
                    let market_name = cursor.string()?;
                    let profession = cursor.u16()?;
                    let level = cursor.u16()?;
                    attributes.extend([
                        Attribute {
                            key: "marketCategory".into(),
                            value: category.to_string(),
                        },
                        Attribute {
                            key: "marketTradeAs".into(),
                            value: trade_as.to_string(),
                        },
                        Attribute {
                            key: "marketShowAs".into(),
                            value: show_as.to_string(),
                        },
                        Attribute {
                            key: "marketName".into(),
                            value: market_name,
                        },
                        Attribute {
                            key: "marketProfession".into(),
                            value: profession.to_string(),
                        },
                        Attribute {
                            key: "marketLevel".into(),
                            value: level.to_string(),
                        },
                    ]);
                }
                _ => {}
            }
        }
        if !completed {
            return Err(ObjectBuilderError::InvalidDat(format!(
                "attribute terminator missing in {kind:?} {id}"
            )));
        }
        flags.insert("Moveable".into(), !flags.contains_key("Not moveable"));

        let has_groups = kind == ObjectKind::Outfit && self.features.frame_groups;
        let group_count = if has_groups { cursor.u8()? } else { 1 };
        if group_count == 0 {
            return Err(ObjectBuilderError::InvalidDat(format!(
                "{kind:?} {id} has zero frame groups"
            )));
        }
        let mut dimensions = Dimensions {
            width: 1,
            height: 1,
            layers: 1,
            patterns: 1,
        };
        let mut mode = AnimationMode::Asynchronous;
        let mut looped = false;
        let mut frame_groups = Vec::with_capacity(usize::from(group_count));

        for group_index in 0..group_count {
            let group_type = if has_groups { cursor.u8()? } else { 0 };
            let width = cursor.u8()?;
            let height = cursor.u8()?;
            if width == 0 || height == 0 || width > 32 || height > 32 {
                return Err(ObjectBuilderError::InvalidDat(format!(
                    "invalid dimensions {width}x{height} in {kind:?} {id}"
                )));
            }
            if width > 1 || height > 1 {
                let _exact_size = cursor.u8()?;
            }
            let layers = cursor.u8()?;
            let pattern_x = cursor.u8()?;
            let pattern_y = cursor.u8()?;
            let pattern_z = if self.version.numeric() < 755 {
                1
            } else {
                cursor.u8()?
            };
            let phases = cursor.u8()?;
            if layers == 0 || pattern_x == 0 || pattern_y == 0 || pattern_z == 0 || phases == 0 {
                return Err(ObjectBuilderError::InvalidDat(format!(
                    "zero-sized sprite layout in {kind:?} {id}"
                )));
            }
            if group_index == 0 {
                dimensions = Dimensions {
                    width,
                    height,
                    layers,
                    patterns: pattern_x
                        .saturating_mul(pattern_y)
                        .saturating_mul(pattern_z),
                };
            }

            let mut durations = vec![100_u32; usize::from(phases)];
            if phases > 1 && self.features.frame_durations {
                mode = if cursor.u8()? == 0 {
                    AnimationMode::Asynchronous
                } else {
                    AnimationMode::Synchronous
                };
                let loop_count = cursor.i32()?;
                let _start_phase = cursor.i8()?;
                looped = loop_count != 1;
                for duration in &mut durations {
                    let minimum = cursor.u32()?;
                    let maximum = cursor.u32()?;
                    *duration = minimum.saturating_add(maximum).saturating_div(2);
                }
            }

            let stride = usize::from(width)
                .checked_mul(usize::from(height))
                .and_then(|value| value.checked_mul(usize::from(layers)))
                .and_then(|value| value.checked_mul(usize::from(pattern_x)))
                .and_then(|value| value.checked_mul(usize::from(pattern_y)))
                .and_then(|value| value.checked_mul(usize::from(pattern_z)))
                .ok_or_else(|| ObjectBuilderError::InvalidDat("sprite layout overflow".into()))?;
            let total = stride
                .checked_mul(usize::from(phases))
                .ok_or_else(|| ObjectBuilderError::InvalidDat("sprite count overflow".into()))?;
            if total > 4096 {
                return Err(ObjectBuilderError::InvalidDat(format!(
                    "{kind:?} {id} references {total} sprites"
                )));
            }
            let mut sprite_ids = Vec::with_capacity(total);
            for _ in 0..total {
                sprite_ids.push(if self.features.extended {
                    cursor.u32()?
                } else {
                    u32::from(cursor.u16()?)
                });
            }
            let frames = (0..usize::from(phases))
                .map(|phase| Frame {
                    // DAT object IDs are 16-bit. This layout keeps the complete frame ID
                    // below JavaScript's MAX_SAFE_INTEGER while preserving group/phase identity.
                    id: (u64::from(id) << 32) | (u64::from(group_index) << 16) | phase as u64,
                    sprite_id: sprite_ids[phase * stride],
                    duration: durations[phase],
                })
                .collect();
            frame_groups.push(FrameGroup {
                id: format!("{}-{id}-{group_index}", kind_label(kind).to_lowercase()),
                name: group_name(group_type, group_index),
                looped,
                frames,
                sprite_ids,
                layout: FrameLayout {
                    group_type,
                    width,
                    height,
                    layers,
                    pattern_x,
                    pattern_y,
                    pattern_z,
                },
            });
        }
        let sprite_id = frame_groups
            .first()
            .and_then(|group| group.frames.first())
            .map(|frame| frame.sprite_id)
            .unwrap_or_default();
        Ok(ThingObject {
            id,
            name: format!("{} {id}", kind_label(kind)),
            kind,
            sprite_id,
            modified: false,
            dimensions,
            position,
            animation: Animation { mode, looped },
            gameplay,
            flags,
            attributes,
            frame_groups,
            raw_record: Vec::new(),
        })
    }

    pub fn serialize(&self, database: &ObjectDatabase) -> Result<Vec<u8>> {
        if let Some(object) = database
            .objects
            .iter()
            .find(|object| object.kind == ObjectKind::Unknown)
        {
            return Err(ObjectBuilderError::SerializationError(format!(
                "Unknown object {} cannot be represented in DAT; export JSON or OBD instead",
                object.id
            )));
        }
        let mut output = Vec::new();
        output.extend_from_slice(
            &database
                .metadata
                .dat_signature
                .unwrap_or_default()
                .to_le_bytes(),
        );
        let groups = [
            (ObjectKind::Item, 100_u32),
            (ObjectKind::Outfit, 1),
            (ObjectKind::Effect, 1),
            (ObjectKind::Missile, 1),
        ];
        let mut ordered = Vec::new();
        let mut counts = Vec::with_capacity(groups.len());
        for (kind, first_id) in groups {
            let mut objects = database
                .objects
                .iter()
                .filter(|object| object.kind == kind)
                .collect::<Vec<_>>();
            objects.sort_by_key(|object| object.id);
            for (index, object) in objects.iter().enumerate() {
                let expected = first_id.saturating_add(index as u32);
                if object.id != expected {
                    return Err(ObjectBuilderError::SerializationError(format!(
                        "{kind:?} IDs must be contiguous from {first_id}; expected {expected}, found {}",
                        object.id
                    )));
                }
            }
            let last_id = objects.last().map(|object| object.id).unwrap_or_else(|| {
                if kind == ObjectKind::Item {
                    99
                } else {
                    0
                }
            });
            counts.push(u16::try_from(last_id).map_err(|_| {
                ObjectBuilderError::SerializationError(format!(
                    "{kind:?} ID {last_id} exceeds the DAT 16-bit object-count field"
                ))
            })?);
            ordered.extend(objects);
        }
        if counts[0] < 100 {
            return Err(ObjectBuilderError::SerializationError(
                "DAT requires at least item ID 100".into(),
            ));
        }
        for count in counts {
            output.extend_from_slice(&count.to_le_bytes());
        }
        for object in ordered {
            if !object.modified && !object.raw_record.is_empty() {
                output.extend_from_slice(&object.raw_record);
            } else {
                self.serialize_thing(object, &mut output)?;
            }
        }
        Ok(output)
    }

    fn serialize_thing(&self, object: &ThingObject, output: &mut Vec<u8>) -> Result<()> {
        let mut attributes = object
            .flags
            .iter()
            .filter(|(name, enabled)| **enabled && name.as_str() != "Moveable")
            .map(|(name, _)| {
                canonical_attribute(name).ok_or_else(|| {
                    ObjectBuilderError::SerializationError(format!(
                        "cannot encode unknown DAT flag '{name}' in {:?} {}",
                        object.kind, object.id
                    ))
                })
            })
            .collect::<Result<Vec<_>>>()?;
        attributes.sort_unstable();
        attributes.dedup();
        for attribute in attributes {
            let raw =
                denormalize_attribute(attribute, self.version.numeric()).ok_or_else(|| {
                    ObjectBuilderError::SerializationError(format!(
                        "DAT version {} cannot encode attribute {} in {:?} {}",
                        self.version.label(),
                        attribute_name(attribute).unwrap_or("unknown"),
                        object.kind,
                        object.id
                    ))
                })?;
            output.push(raw);
            encode_attribute_payload(attribute, object, output)?;
        }
        output.push(255);

        let has_groups = object.kind == ObjectKind::Outfit && self.features.frame_groups;
        if !has_groups && object.frame_groups.len() != 1 {
            return Err(ObjectBuilderError::SerializationError(format!(
                "DAT version {} supports one frame group for {:?} {}",
                self.version.label(),
                object.kind,
                object.id
            )));
        }
        if has_groups {
            output.push(u8::try_from(object.frame_groups.len()).map_err(|_| {
                ObjectBuilderError::SerializationError("frame-group count exceeds 255".into())
            })?);
        }
        for (group_index, group) in object.frame_groups.iter().enumerate() {
            if has_groups {
                output.push(if group.layout.width == 0 {
                    u8::try_from(group_index).unwrap_or(u8::MAX)
                } else {
                    group.layout.group_type
                });
            }
            let layout = if group.layout.width == 0 {
                FrameLayout {
                    group_type: u8::try_from(group_index).unwrap_or(u8::MAX),
                    width: object.dimensions.width,
                    height: object.dimensions.height,
                    layers: object.dimensions.layers,
                    pattern_x: object.dimensions.patterns,
                    pattern_y: 1,
                    pattern_z: 1,
                }
            } else {
                group.layout
            };
            for (label, value) in [
                ("width", layout.width),
                ("height", layout.height),
                ("layers", layout.layers),
                ("pattern X", layout.pattern_x),
                ("pattern Y", layout.pattern_y),
                ("pattern Z", layout.pattern_z),
            ] {
                if value == 0 {
                    return Err(ObjectBuilderError::SerializationError(format!(
                        "{label} is zero in {:?} {} group {}",
                        object.kind,
                        object.id,
                        group_index + 1
                    )));
                }
            }
            output.extend([layout.width, layout.height]);
            if layout.width > 1 || layout.height > 1 {
                output.push(
                    u8::try_from(
                        u16::from(layout.width.max(layout.height))
                            .saturating_mul(self.features.sprite_size),
                    )
                    .unwrap_or(u8::MAX),
                );
            }
            output.extend([layout.layers, layout.pattern_x, layout.pattern_y]);
            if self.version.numeric() >= 755 {
                output.push(layout.pattern_z);
            } else if layout.pattern_z != 1 {
                return Err(ObjectBuilderError::SerializationError(format!(
                    "DAT version {} cannot encode pattern Z {}",
                    self.version.label(),
                    layout.pattern_z
                )));
            }
            let phases = u8::try_from(group.frames.len()).map_err(|_| {
                ObjectBuilderError::SerializationError("frame count exceeds 255".into())
            })?;
            if phases == 0 {
                return Err(ObjectBuilderError::SerializationError(
                    "frame groups cannot be empty".into(),
                ));
            }
            output.push(phases);
            if phases > 1 && self.features.frame_durations {
                output.push(match object.animation.mode {
                    AnimationMode::Asynchronous | AnimationMode::Random => 0,
                    AnimationMode::Synchronous => 1,
                });
                output.extend_from_slice(&(if group.looped { 0_i32 } else { 1 }).to_le_bytes());
                output.push((-1_i8) as u8);
                for frame in &group.frames {
                    output.extend_from_slice(&frame.duration.to_le_bytes());
                    output.extend_from_slice(&frame.duration.to_le_bytes());
                }
            }
            let expected = usize::from(layout.width)
                .checked_mul(usize::from(layout.height))
                .and_then(|value| value.checked_mul(usize::from(layout.layers)))
                .and_then(|value| value.checked_mul(usize::from(layout.pattern_x)))
                .and_then(|value| value.checked_mul(usize::from(layout.pattern_y)))
                .and_then(|value| value.checked_mul(usize::from(layout.pattern_z)))
                .and_then(|value| value.checked_mul(usize::from(phases)))
                .ok_or_else(|| {
                    ObjectBuilderError::SerializationError("sprite layout overflow".into())
                })?;
            if group.sprite_ids.len() != expected {
                return Err(ObjectBuilderError::SerializationError(format!(
                    "sprite layout in {:?} {} group {} has {} IDs; expected {expected}",
                    object.kind,
                    object.id,
                    group_index + 1,
                    group.sprite_ids.len()
                )));
            }
            for sprite_id in &group.sprite_ids {
                if self.features.extended {
                    output.extend_from_slice(&sprite_id.to_le_bytes());
                } else {
                    output.extend_from_slice(
                        &u16::try_from(*sprite_id)
                            .map_err(|_| {
                                ObjectBuilderError::SerializationError(format!(
                                    "sprite ID {sprite_id} requires an extended DAT"
                                ))
                            })?
                            .to_le_bytes(),
                    );
                }
            }
        }
        Ok(())
    }
}

impl ObjectFormat for DatFormat {
    fn load(&self, path: &Path) -> Result<ObjectDatabase> {
        self.parse(fs::read(path)?)
    }
    fn save(&self, database: &ObjectDatabase, path: &Path) -> Result<()> {
        fs::write(path, self.serialize(database)?)?;
        Ok(())
    }
}

fn canonical_attribute(name: &str) -> Option<u8> {
    (0..=254).find(|attribute| attribute_name(*attribute) == Some(name))
}

fn denormalize_attribute(attribute: u8, version: u16) -> Option<u8> {
    (0..=254).find(|raw| normalize_attribute(*raw, version) == attribute)
}

fn attribute_number(object: &ThingObject, key: &str) -> u16 {
    object
        .attributes
        .iter()
        .find(|attribute| attribute.key == key)
        .and_then(|attribute| attribute.value.parse().ok())
        .unwrap_or_default()
}

fn encode_attribute_payload(
    attribute: u8,
    object: &ThingObject,
    output: &mut Vec<u8>,
) -> Result<()> {
    match attribute {
        0 => output.extend_from_slice(&object.gameplay.ground_speed.to_le_bytes()),
        8 | 9 | 29 | 32 | 34 => output.extend_from_slice(
            &attribute_number(object, attribute_name(attribute).unwrap_or_default()).to_le_bytes(),
        ),
        21 => {
            output.extend_from_slice(&u16::from(object.gameplay.light_level).to_le_bytes());
            output.extend_from_slice(&object.gameplay.light_color.to_le_bytes());
        }
        24 => {
            output.extend_from_slice(&(object.position.x as u16).to_le_bytes());
            output.extend_from_slice(&(object.position.y as u16).to_le_bytes());
        }
        25 => output.extend_from_slice(&u16::from(object.position.elevation).to_le_bytes()),
        28 => output.extend_from_slice(&object.gameplay.minimap_color.to_le_bytes()),
        33 => {
            for key in ["marketCategory", "marketTradeAs", "marketShowAs"] {
                output.extend_from_slice(&attribute_number(object, key).to_le_bytes());
            }
            let name = object
                .attributes
                .iter()
                .find(|value| value.key == "marketName")
                .map(|value| value.value.as_bytes())
                .unwrap_or_default();
            output.extend_from_slice(
                &u16::try_from(name.len())
                    .map_err(|_| {
                        ObjectBuilderError::SerializationError("market name is too long".into())
                    })?
                    .to_le_bytes(),
            );
            output.extend_from_slice(name);
            for key in ["marketProfession", "marketLevel"] {
                output.extend_from_slice(&attribute_number(object, key).to_le_bytes());
            }
        }
        _ => {}
    }
    Ok(())
}

fn kind_label(kind: ObjectKind) -> &'static str {
    match kind {
        ObjectKind::Item => "Item",
        ObjectKind::Outfit => "Outfit",
        ObjectKind::Effect => "Effect",
        ObjectKind::Missile => "Missile",
        ObjectKind::Unknown => "Unknown",
    }
}
fn group_name(group_type: u8, index: u8) -> String {
    match group_type {
        0 => "Idle".into(),
        1 => "Moving".into(),
        _ => format!("Group {}", index + 1),
    }
}
fn attribute_name(attribute: u8) -> Option<&'static str> {
    Some(match attribute {
        0 => "Ground",
        1 => "Ground border",
        2 => "Bottom",
        3 => "Top",
        4 => "Container",
        5 => "Stackable",
        6 => "Force use",
        7 => "Multi use",
        8 => "Writable",
        9 => "Writable once",
        10 => "Fluid container",
        11 => "Splash",
        12 => "Not walkable",
        13 => "Not moveable",
        14 => "Block projectile",
        15 => "Block path",
        16 => "Pickupable",
        17 => "Hangable",
        18 => "Hook south",
        19 => "Hook east",
        20 => "Rotatable",
        21 => "Light",
        22 => "Don't hide",
        23 => "Translucent",
        24 => "Displacement",
        25 => "Elevation",
        26 => "Lying corpse",
        27 => "Animate always",
        28 => "Minimap color",
        29 => "Lens help",
        30 => "Full ground",
        31 => "Ignore look",
        32 => "Cloth",
        33 => "Market",
        34 => "Usable",
        35 => "Wrappable",
        36 => "Unwrappable",
        37 => "Top effect",
        252 => "Floor change",
        253 => "No move animation",
        254 => "Chargeable",
        _ => return None,
    })
}

fn normalize_attribute(mut attribute: u8, version: u16) -> u8 {
    if version >= 1000 {
        if attribute == 16 {
            return 253;
        }
        if attribute > 16 {
            attribute = attribute.saturating_sub(1);
        }
    } else if version >= 860 {
        // 8.60–9.86 is the canonical attribute layout.
    } else if version >= 780 {
        if attribute == 8 {
            return 254;
        }
        if attribute > 8 {
            attribute = attribute.saturating_sub(1);
        }
    } else if version >= 755 {
        if attribute == 23 {
            return 252;
        }
    } else if version >= 740 {
        attribute = match attribute {
            1..=15 => attribute.saturating_add(1),
            16 => 21,
            17 => 252,
            18 => 30,
            19 => 25,
            20 => 24,
            22 => 28,
            23 => 20,
            24 => 26,
            25 => 17,
            26 => 18,
            27 => 19,
            28 => 27,
            other => other,
        };
        if attribute == 7 {
            return 6;
        }
        if attribute == 6 {
            return 7;
        }
    }
    attribute
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_minimal_dat_without_losing_source() {
        let mut bytes = vec![1, 2, 3, 4, 100, 0, 0, 0, 0, 0, 0, 0];
        bytes.extend([255, 1, 1, 1, 1, 1, 1, 1, 42, 0]);
        let parsed = DatFormat {
            version: ClientVersion::Tibia860,
            features: ClientFeatures::for_version(ClientVersion::Tibia860),
        }
        .parse(bytes.clone())
        .expect("synthetic fixture should parse");
        assert_eq!(parsed.objects.len(), 1);
        assert_eq!(parsed.objects[0].sprite_id, 42);
        assert_eq!(parsed.original_dat.as_deref(), Some(bytes.as_slice()));
    }
    #[test]
    fn rejects_truncated_dat() {
        assert!(DatFormat {
            version: ClientVersion::Tibia860,
            features: ClientFeatures::for_version(ClientVersion::Tibia860)
        }
        .parse(vec![0; 6])
        .is_err());
    }
    #[test]
    fn serializes_modified_objects_with_versioned_attributes() {
        let version = ClientVersion::Custom(1098);
        let features = ClientFeatures {
            extended: true,
            ..ClientFeatures::for_version(version)
        };
        let mut object = crate::core::models::test_object();
        object.modified = true;
        object.flags.insert("Light".into(), true);
        object.gameplay.light_level = 7;
        object.gameplay.light_color = 215;
        let database = ObjectDatabase {
            version,
            objects: vec![object],
            metadata: FormatMetadata {
                dat_signature: Some(0x4a10),
                ..FormatMetadata::default()
            },
            ..ObjectDatabase::default()
        };
        let format = DatFormat { version, features };
        let reparsed = format
            .parse(format.serialize(&database).expect("serialize modified DAT"))
            .expect("reparse modified DAT");
        assert_eq!(reparsed.objects[0].gameplay.light_level, 7);
        assert_eq!(reparsed.objects[0].gameplay.light_color, 215);
        assert!(reparsed.objects[0]
            .flags
            .get("Light")
            .copied()
            .unwrap_or_default());
    }
    #[test]
    fn parses_real_extended_860_fixture_when_available() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../860/Tibia.dat");
        if !path.exists() {
            return;
        }
        let features = ClientFeatures {
            extended: true,
            transparency: true,
            frame_durations: true,
            frame_groups: true,
            sprite_size: 32,
            sprite_data_size: 4096,
        };
        let parsed = DatFormat {
            version: ClientVersion::Tibia860,
            features,
        }
        .load(&path)
        .expect("real 8.60 DAT should parse");
        assert_eq!(parsed.metadata.counts.items, 44_522);
        assert_eq!(parsed.objects.len(), 46_524);
        assert_eq!(parsed.objects[0].sprite_id, 453_694);
        assert!(parsed
            .objects
            .iter()
            .flat_map(|object| &object.frame_groups)
            .flat_map(|group| &group.frames)
            .all(|frame| frame.id <= 9_007_199_254_740_991));
        assert_eq!(
            DatFormat {
                version: ClientVersion::Tibia860,
                features
            }
            .serialize(&parsed)
            .expect("real DAT should serialize losslessly"),
            fs::read(path).expect("fixture bytes")
        );
    }
}
