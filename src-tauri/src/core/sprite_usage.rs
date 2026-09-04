use crate::core::models::{ObjectKind, ThingObject};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectReference {
    pub id: u32,
    pub kind: ObjectKind,
    pub name: String,
}

#[derive(Debug, Clone, Default)]
pub struct SpriteUsageIndex {
    by_sprite: HashMap<u32, Vec<ObjectReference>>,
    objects_using_sprites: usize,
}

impl SpriteUsageIndex {
    pub fn build(objects: &[ThingObject]) -> Self {
        let mut by_sprite: HashMap<u32, Vec<ObjectReference>> = HashMap::new();
        let mut objects_using_sprites = 0;
        for object in objects {
            let sprite_ids = object
                .frame_groups
                .iter()
                .flat_map(|group| group.sprite_ids.iter().copied())
                .filter(|id| *id != 0)
                .collect::<HashSet<_>>();
            if !sprite_ids.is_empty() {
                objects_using_sprites += 1;
            }
            let reference = ObjectReference {
                id: object.id,
                kind: object.kind,
                name: object.name.clone(),
            };
            for sprite_id in sprite_ids {
                by_sprite
                    .entry(sprite_id)
                    .or_default()
                    .push(reference.clone());
            }
        }
        for references in by_sprite.values_mut() {
            references.sort_by_key(|reference| (format!("{:?}", reference.kind), reference.id));
        }
        Self {
            by_sprite,
            objects_using_sprites,
        }
    }

    pub fn references(&self, sprite_id: u32) -> &[ObjectReference] {
        self.by_sprite
            .get(&sprite_id)
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    pub fn usage_count(&self, sprite_id: u32) -> usize {
        self.references(sprite_id).len()
    }

    pub fn used_sprite_count(&self, sprite_count: u32, override_ids: &HashSet<u32>) -> usize {
        self.by_sprite
            .keys()
            .filter(|id| **id <= sprite_count || override_ids.contains(id))
            .count()
    }

    pub fn objects_using_sprites(&self) -> usize {
        self.objects_using_sprites
    }

    pub fn referenced_ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.by_sprite.keys().copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_each_object_once_per_sprite() {
        let mut object = crate::core::models::test_object();
        object.frame_groups[0].sprite_ids = vec![1, 1, 2];
        let index = SpriteUsageIndex::build(&[object]);
        assert_eq!(index.usage_count(1), 1);
        assert_eq!(index.usage_count(2), 1);
        assert_eq!(index.objects_using_sprites(), 1);
    }
}
