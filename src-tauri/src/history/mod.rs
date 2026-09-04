use crate::core::{
    error::{ObjectBuilderError, Result},
    models::{ObjectDatabase, ThingObject},
};
use std::collections::VecDeque;

#[derive(Clone)]
struct ObjectChange {
    before: ThingObject,
    after: ThingObject,
}

pub struct EditorHistory {
    past: VecDeque<ObjectChange>,
    future: VecDeque<ObjectChange>,
    capacity: usize,
}

impl EditorHistory {
    pub fn new(capacity: usize) -> Self {
        Self {
            past: VecDeque::new(),
            future: VecDeque::new(),
            capacity: capacity.max(1),
        }
    }

    pub fn record_object_change(&mut self, before: ThingObject, after: ThingObject) {
        if self.past.len() == self.capacity {
            self.past.pop_front();
        }
        self.past.push_back(ObjectChange { before, after });
        self.future.clear();
    }

    pub fn undo(&mut self, database: &mut ObjectDatabase) -> Result<()> {
        let change = self
            .past
            .pop_back()
            .ok_or(ObjectBuilderError::HistoryEmpty)?;
        replace_object(database, &change.after, change.before.clone())?;
        self.future.push_front(change);
        Ok(())
    }

    pub fn redo(&mut self, database: &mut ObjectDatabase) -> Result<()> {
        let change = self
            .future
            .pop_front()
            .ok_or(ObjectBuilderError::HistoryEmpty)?;
        replace_object(database, &change.before, change.after.clone())?;
        self.past.push_back(change);
        Ok(())
    }

    #[allow(dead_code)]
    pub fn availability(&self) -> (bool, bool) {
        (!self.past.is_empty(), !self.future.is_empty())
    }
}

fn replace_object(
    database: &mut ObjectDatabase,
    identity: &ThingObject,
    replacement: ThingObject,
) -> Result<()> {
    let index = database
        .objects
        .iter()
        .position(|object| object.id == identity.id && object.kind == identity.kind)
        .ok_or(ObjectBuilderError::ObjectNotFound(identity.id))?;
    database.objects[index] = replacement;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn undo_and_redo_restore_an_object_change() {
        let mut database = ObjectDatabase {
            objects: vec![crate::core::models::test_object()],
            ..ObjectDatabase::default()
        };
        let before = database.objects[0].clone();
        let mut after = before.clone();
        after.name = "Changed".into();
        let mut history = EditorHistory::new(4);
        history.record_object_change(before.clone(), after.clone());
        database.objects[0] = after;
        history.undo(&mut database).expect("undo exists");
        assert_eq!(database.objects[0].name, before.name);
        history.redo(&mut database).expect("redo exists");
        assert_eq!(database.objects[0].name, "Changed");
    }
}
