use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreLogEvent {
    pub timestamp_ms: u128,
    pub level: String,
    pub message: String,
    pub context: Option<String>,
    pub details: Option<String>,
}

pub fn emit_log(
    app: &AppHandle,
    level: &str,
    message: impl Into<String>,
    context: Option<String>,
    details: Option<String>,
) {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let _ = app.emit(
        "core-log",
        CoreLogEvent {
            timestamp_ms,
            level: level.into(),
            message: message.into(),
            context,
            details,
        },
    );
}
