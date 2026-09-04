use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClientVersion {
    Tibia710,
    Tibia760,
    Tibia860,
    #[default]
    Tibia1098,
    Tibia1200,
    Tibia1310,
    Custom(u16),
}

impl ClientVersion {
    pub fn from_numeric(version: u16) -> Self {
        match version {
            710 => Self::Tibia710,
            760 => Self::Tibia760,
            860 => Self::Tibia860,
            1098 => Self::Tibia1098,
            1200 => Self::Tibia1200,
            1310 => Self::Tibia1310,
            custom => Self::Custom(custom),
        }
    }

    pub fn numeric(self) -> u16 {
        match self {
            Self::Tibia710 => 710, Self::Tibia760 => 760, Self::Tibia860 => 860,
            Self::Tibia1098 => 1098, Self::Tibia1200 => 1200, Self::Tibia1310 => 1310,
            Self::Custom(version) => version,
        }
    }

    pub fn label(self) -> String {
        let numeric = self.numeric();
        format!("{}.{:02}", numeric / 100, numeric % 100)
    }

    pub fn uses_wide_sprite_ids(self) -> bool {
        match self {
            Self::Tibia1098 | Self::Tibia1200 | Self::Tibia1310 => true,
            Self::Custom(version) => version >= 960,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientFeatures {
    pub extended: bool,
    pub transparency: bool,
    pub frame_durations: bool,
    pub frame_groups: bool,
    pub sprite_size: u16,
    pub sprite_data_size: u32,
}

impl ClientFeatures {
    pub fn for_version(version: ClientVersion) -> Self {
        let numeric = version.numeric();
        Self {
            extended: version.uses_wide_sprite_ids(),
            transparency: false,
            frame_durations: numeric >= 1050,
            frame_groups: numeric >= 1050,
            sprite_size: 32,
            sprite_data_size: 4096,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObjectKind {
    Item,
    Outfit,
    Effect,
    Missile,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub id: u64,
    pub sprite_id: u32,
    pub duration: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameGroup {
    pub id: String,
    pub name: String,
    #[serde(rename = "loop")]
    pub looped: bool,
    pub frames: Vec<Frame>,
    pub sprite_ids: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dimensions {
    pub width: u8,
    pub height: u8,
    pub layers: u8,
    pub patterns: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub x: i16,
    pub y: i16,
    pub elevation: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnimationMode {
    Asynchronous,
    Synchronous,
    Random,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Animation {
    pub mode: AnimationMode,
    #[serde(rename = "loop")]
    pub looped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gameplay {
    pub ground_speed: u16,
    pub light_level: u8,
    pub light_color: u16,
    pub minimap_color: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attribute {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThingObject {
    pub id: u32,
    pub name: String,
    pub kind: ObjectKind,
    pub sprite_id: u32,
    pub modified: bool,
    pub dimensions: Dimensions,
    pub position: Position,
    pub animation: Animation,
    pub gameplay: Gameplay,
    pub flags: BTreeMap<String, bool>,
    pub attributes: Vec<Attribute>,
    pub frame_groups: Vec<FrameGroup>,
    #[serde(skip)]
    pub raw_record: Vec<u8>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ObjectCounts {
    pub items: u16,
    pub outfits: u16,
    pub effects: u16,
    pub missiles: u16,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FormatMetadata {
    pub dat_signature: Option<u32>,
    pub spr_signature: Option<u32>,
    pub counts: ObjectCounts,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ObjectDatabase {
    pub version: ClientVersion,
    pub objects: Vec<ThingObject>,
    pub metadata: FormatMetadata,
    #[serde(skip)]
    #[allow(dead_code)]
    pub original_dat: Option<Vec<u8>>,
    #[serde(skip)]
    pub original_spr: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub name: String,
    pub client_version: String,
    pub dat_file: String,
    pub spr_file: String,
    pub object_count: usize,
    pub sprite_count: u32,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSnapshot {
    pub project: ProjectInfo,
    pub objects: Vec<ThingObject>,
}
