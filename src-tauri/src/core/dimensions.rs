use super::models::ThingObject;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDimensions {
    pub tile_width: u8,
    pub tile_height: u8,
    pub pixel_width: u32,
    pub pixel_height: u32,
    pub layers: u8,
    pub patterns: u8,
    pub frames: usize,
}

pub fn object_dimensions(object: &ThingObject, sprite_size: u16) -> ObjectDimensions {
    ObjectDimensions {
        tile_width: object.dimensions.width,
        tile_height: object.dimensions.height,
        pixel_width: u32::from(object.dimensions.width).saturating_mul(u32::from(sprite_size)),
        pixel_height: u32::from(object.dimensions.height).saturating_mul(u32::from(sprite_size)),
        layers: object.dimensions.layers,
        patterns: object.dimensions.patterns,
        frames: object.frame_groups.iter().map(|group| group.frames.len()).sum(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculates_multi_tile_pixel_dimensions() {
        let mut object = crate::core::models::test_object();
        object.dimensions.width = 3;
        object.dimensions.height = 2;
        assert_eq!(object_dimensions(&object, 32).pixel_width, 96);
        assert_eq!(object_dimensions(&object, 32).pixel_height, 64);
    }
}
