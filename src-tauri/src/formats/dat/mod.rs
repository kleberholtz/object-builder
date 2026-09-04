use crate::{
    core::{
        error::{ObjectBuilderError, Result},
        models::{
            Animation, AnimationMode, Attribute, ClientFeatures, ClientVersion, Dimensions,
            FormatMetadata, Frame, FrameGroup, Gameplay, ObjectCounts, ObjectDatabase, ObjectKind,
            Position, ThingObject,
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
                    id: (u64::from(kind_code(kind)) << 56)
                        | (u64::from(id) << 16)
                        | (u64::from(group_index) << 8)
                        | phase as u64,
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
}

impl ObjectFormat for DatFormat {
    fn load(&self, path: &Path) -> Result<ObjectDatabase> {
        self.parse(fs::read(path)?)
    }
    fn save(&self, database: &ObjectDatabase, path: &Path) -> Result<()> {
        let original = database.original_dat.as_ref().ok_or_else(|| {
            ObjectBuilderError::SerializationError(
                "DAT serialization is unavailable without preserved source bytes".into(),
            )
        })?;
        fs::write(path, original)?;
        Ok(())
    }
}

fn kind_code(kind: ObjectKind) -> u8 {
    match kind {
        ObjectKind::Item => 0,
        ObjectKind::Outfit => 1,
        ObjectKind::Effect => 2,
        ObjectKind::Missile => 3,
        ObjectKind::Unknown => 4,
    }
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
    }
}
