use super::models::{FrameLayout, ThingObject};
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
    dimensions_from_layout(
        FrameLayout {
            width: object.dimensions.width,
            height: object.dimensions.height,
            layers: object.dimensions.layers,
            pattern_x: object.dimensions.patterns,
            pattern_y: 1,
            pattern_z: 1,
            ..FrameLayout::default()
        },
        object
            .frame_groups
            .iter()
            .map(|group| group.frames.len())
            .sum(),
        sprite_size,
    )
}

pub fn frame_group_dimensions(
    object: &ThingObject,
    group_index: usize,
    sprite_size: u16,
) -> ObjectDimensions {
    let Some(group) = object.frame_groups.get(group_index) else {
        return object_dimensions(object, sprite_size);
    };
    let layout = group.layout;
    if layout.width == 0 || layout.height == 0 || layout.layers == 0 {
        return object_dimensions(object, sprite_size);
    }
    dimensions_from_layout(layout, group.frames.len(), sprite_size)
}

fn dimensions_from_layout(
    layout: FrameLayout,
    frames: usize,
    sprite_size: u16,
) -> ObjectDimensions {
    ObjectDimensions {
        tile_width: layout.width,
        tile_height: layout.height,
        pixel_width: u32::from(layout.width).saturating_mul(u32::from(sprite_size)),
        pixel_height: u32::from(layout.height).saturating_mul(u32::from(sprite_size)),
        layers: layout.layers,
        patterns: layout
            .pattern_x
            .saturating_mul(layout.pattern_y)
            .saturating_mul(layout.pattern_z),
        frames,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculates_multi_tile_pixel_dimensions() {
        let mut object = crate::core::models::test_object();
        object.dimensions.width = 2;
        object.dimensions.height = 2;
        assert_eq!(object_dimensions(&object, 32).pixel_width, 64);
        assert_eq!(object_dimensions(&object, 32).pixel_height, 64);
        object.dimensions.width = 3;
        object.dimensions.height = 2;
        assert_eq!(object_dimensions(&object, 32).pixel_width, 96);
        assert_eq!(object_dimensions(&object, 32).pixel_height, 64);
    }

    #[test]
    fn uses_the_selected_frame_group_layout() {
        let mut object = crate::core::models::test_object();
        object.frame_groups[0].layout.width = 3;
        object.frame_groups[0].layout.height = 2;
        object.frame_groups[0].layout.layers = 2;
        let dimensions = frame_group_dimensions(&object, 0, 32);
        assert_eq!((dimensions.pixel_width, dimensions.pixel_height), (96, 64));
        assert_eq!(dimensions.layers, 2);
    }
}
