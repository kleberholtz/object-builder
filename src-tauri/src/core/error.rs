use serde::Serialize;
use std::{fmt, io};

#[allow(dead_code)]
#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum ObjectBuilderError {
    InvalidDat(String),
    InvalidSpr(String),
    InvalidOtb(String),
    InvalidXml(String),
    UnsupportedVersion(String),
    InvalidSprite(String),
    CorruptedFile(String),
    IoError(String),
    SerializationError(String),
    ObjectNotFound(u32),
    HistoryEmpty,
    Operation {
        file: String,
        operation: String,
        reason: String,
        suggestion: Option<String>,
    },
}

impl fmt::Display for ObjectBuilderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDat(message) => write!(formatter, "Invalid DAT: {message}"),
            Self::InvalidSpr(message) => write!(formatter, "Invalid SPR: {message}"),
            Self::InvalidOtb(message) => write!(formatter, "Invalid OTB: {message}"),
            Self::InvalidXml(message) => write!(formatter, "Invalid XML: {message}"),
            Self::UnsupportedVersion(message) => {
                write!(formatter, "Unsupported version: {message}")
            }
            Self::InvalidSprite(message) => write!(formatter, "Invalid sprite: {message}"),
            Self::CorruptedFile(message) => write!(formatter, "Corrupted file: {message}"),
            Self::IoError(message) => write!(formatter, "I/O error: {message}"),
            Self::SerializationError(message) => {
                write!(formatter, "Serialization error: {message}")
            }
            Self::ObjectNotFound(id) => write!(formatter, "Object {id} was not found"),
            Self::HistoryEmpty => write!(formatter, "There are no history entries available"),
            Self::Operation {
                file,
                operation,
                reason,
                ..
            } => {
                write!(formatter, "{operation} failed for {file}: {reason}")
            }
        }
    }
}

impl std::error::Error for ObjectBuilderError {}

impl From<io::Error> for ObjectBuilderError {
    fn from(error: io::Error) -> Self {
        Self::IoError(error.to_string())
    }
}

impl From<serde_json::Error> for ObjectBuilderError {
    fn from(error: serde_json::Error) -> Self {
        Self::SerializationError(error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, ObjectBuilderError>;
