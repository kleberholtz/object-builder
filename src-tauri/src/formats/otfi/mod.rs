use crate::core::{
    error::{ObjectBuilderError, Result},
    models::{ClientFeatures, ClientVersion},
};
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatSprConfig {
    pub features: ClientFeatures,
    pub metadata_file: String,
    pub sprites_file: String,
}

impl DatSprConfig {
    pub fn parse(source: &str, version: ClientVersion) -> Result<Self> {
        let mut config = Self {
            features: ClientFeatures::for_version(version),
            metadata_file: "Tibia.dat".into(),
            sprites_file: "Tibia.spr".into(),
        };
        for raw_line in source.lines() {
            let line = raw_line.trim();
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let key = key.trim();
            let value = value.trim().trim_matches(['\'', '"']);
            let boolean = || match value {
                "true" => Ok(true),
                "false" => Ok(false),
                _ => Err(ObjectBuilderError::CorruptedFile(format!(
                    "invalid boolean for {key}: {value}"
                ))),
            };
            match key {
                "extended" => config.features.extended = boolean()?,
                "transparency" => config.features.transparency = boolean()?,
                "frame-durations" => config.features.frame_durations = boolean()?,
                "frame-groups" => config.features.frame_groups = boolean()?,
                "sprite-size" => {
                    config.features.sprite_size = value.parse().map_err(|_| {
                        ObjectBuilderError::CorruptedFile("invalid sprite-size".into())
                    })?
                }
                "sprite-data-size" => {
                    config.features.sprite_data_size = value.parse().map_err(|_| {
                        ObjectBuilderError::CorruptedFile("invalid sprite-data-size".into())
                    })?
                }
                "metadata-file" => config.metadata_file = value.into(),
                "sprites-file" => config.sprites_file = value.into(),
                _ => {}
            }
        }
        Ok(config)
    }

    pub fn load(path: &Path, version: ClientVersion) -> Result<Self> {
        Self::parse(&fs::read_to_string(path)?, version)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_otclient_feature_overrides() {
        let parsed = DatSprConfig::parse("DatSpr\n extended: true\n transparency: true\n frame-durations: true\n sprite-size: 32", ClientVersion::Tibia860).expect("valid OTFI");
        assert!(parsed.features.extended);
        assert!(parsed.features.transparency);
        assert!(parsed.features.frame_durations);
        assert_eq!(parsed.features.sprite_size, 32);
    }
}
