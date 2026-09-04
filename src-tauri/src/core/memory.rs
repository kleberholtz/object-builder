//! Resident memory of the running process, read from the operating system.
//!
//! The status bar reports it next to the sprite cache: the cache is only the
//! part of the footprint the editor can bound by itself, and a project whose
//! DAT and sprite overrides live outside it would otherwise look free.

/// Bytes the process currently keeps resident, or `None` where the platform
/// has no reader here — the status bar then shows only the cache.
#[cfg(target_os = "linux")]
pub fn process_memory_bytes() -> Option<u64> {
    // Field two of /proc/self/statm is the resident set, counted in pages.
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let resident: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    let page_size = u64::try_from(page_size).unwrap_or(4096);
    Some(resident * page_size)
}

#[cfg(windows)]
pub fn process_memory_bytes() -> Option<u64> {
    use windows_sys::Win32::System::{
        ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
        Threading::GetCurrentProcess,
    };
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
    counters.cb = u32::try_from(std::mem::size_of::<PROCESS_MEMORY_COUNTERS>()).ok()?;
    let size = counters.cb;
    let read = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, size) };
    (read != 0).then(|| counters.WorkingSetSize as u64)
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn process_memory_bytes() -> Option<u64> {
    None
}
