pub mod dat;
pub mod otfi;
pub mod spr;

use crate::core::{error::Result, models::ObjectDatabase};
use std::path::Path;

pub trait ObjectFormat {
    fn load(&self, path: &Path) -> Result<ObjectDatabase>;
    #[allow(dead_code)]
    fn save(&self, database: &ObjectDatabase, path: &Path) -> Result<()>;
}

pub(crate) fn read_u16_le(bytes: &[u8], offset: usize) -> Option<u16> {
    let source = bytes.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([source[0], source[1]]))
}

pub(crate) fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
    let source = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([
        source[0], source[1], source[2], source[3],
    ]))
}
