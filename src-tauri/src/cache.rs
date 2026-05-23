use crate::agent_adapters::LogSource;
use crate::types::*;
use rusqlite::{params, Connection};
use std::fs;

pub(crate) fn cache_db_path() -> Result<std::path::PathBuf, String> {
    if let Ok(path) = std::env::var("PROMPTLENS_CACHE_PATH") {
        return Ok(std::path::PathBuf::from(path));
    }
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| "Failed to resolve app data directory".to_string())?
        .join("PromptLens");
    fs::create_dir_all(&base).map_err(|err| format!("Failed to create cache directory: {err}"))?;
    Ok(base.join("scan-cache.sqlite"))
}

pub(crate) fn open_cache() -> Result<Connection, String> {
    let conn =
        Connection::open(cache_db_path()?).map_err(|err| format!("Failed to open cache: {err}"))?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|err| format!("Failed to read cache schema version: {err}"))?;
    if version != 0 && version != CACHE_SCHEMA_VERSION {
        conn.execute("DROP TABLE IF EXISTS scan_cache", [])
            .map_err(|err| format!("Failed to reset old cache: {err}"))?;
        conn.execute("DROP TABLE IF EXISTS agent_session_cache", [])
            .map_err(|err| format!("Failed to reset old agent session cache: {err}"))?;
        conn.execute("DROP TABLE IF EXISTS search_index", [])
            .map_err(|err| format!("Failed to reset old search index: {err}"))?;
    }
    conn.execute(
        "CREATE TABLE IF NOT EXISTS scan_cache (
            file_path TEXT PRIMARY KEY,
            file_size INTEGER NOT NULL,
            modified TEXT,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|err| format!("Failed to initialize cache: {err}"))?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_session_cache (
            file_path TEXT NOT NULL,
            source TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            modified TEXT,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (file_path, source)
        )",
        [],
    )
    .map_err(|err| format!("Failed to initialize agent session cache: {err}"))?;
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
            file_path UNINDEXED,
            line_number UNINDEXED,
            byte_offset UNINDEXED,
            content
        )",
        [],
    )
    .map_err(|err| format!("Failed to initialize search index: {err}"))?;
    conn.pragma_update(None, "user_version", CACHE_SCHEMA_VERSION)
        .map_err(|err| format!("Failed to update cache schema version: {err}"))?;
    Ok(conn)
}

pub(crate) fn read_scan_cache(
    file_path: &str,
    file_size: u64,
    modified: Option<&str>,
) -> Result<Option<FileScanResult>, String> {
    let conn = open_cache()?;
    let mut stmt = conn
        .prepare(
            "SELECT payload FROM scan_cache
             WHERE file_path = ?1 AND file_size = ?2 AND COALESCE(modified, '') = COALESCE(?3, '')",
        )
        .map_err(|err| format!("Failed to read cache: {err}"))?;
    let mut rows = stmt
        .query(params![file_path, file_size as i64, modified])
        .map_err(|err| format!("Failed to query cache: {err}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|err| format!("Failed to inspect cache: {err}"))?
    {
        let payload: String = row
            .get(0)
            .map_err(|err| format!("Failed to load cache: {err}"))?;
        let result = serde_json::from_str::<FileScanResult>(&payload)
            .map_err(|err| format!("Failed to parse cache: {err}"))?;
        return Ok(Some(result));
    }
    Ok(None)
}

pub(crate) fn write_scan_cache(result: &FileScanResult) -> Result<(), String> {
    let conn = open_cache()?;
    let payload =
        serde_json::to_string(result).map_err(|err| format!("Failed to serialize cache: {err}"))?;
    conn.execute(
        "INSERT INTO scan_cache (file_path, file_size, modified, payload, updated_at)
         VALUES (?1, ?2, ?3, ?4, strftime('%s','now'))
         ON CONFLICT(file_path) DO UPDATE SET
            file_size = excluded.file_size,
            modified = excluded.modified,
            payload = excluded.payload,
            updated_at = excluded.updated_at",
        params![
            result.file_path,
            result.file_size as i64,
            result.modified,
            payload
        ],
    )
    .map_err(|err| format!("Failed to write cache: {err}"))?;
    Ok(())
}

pub(crate) fn read_agent_session_cache(
    file_path: &str,
    source: LogSource,
    file_size: u64,
    modified: Option<&str>,
) -> Result<Option<AgentSessionResult>, String> {
    let conn = open_cache()?;
    let mut stmt = conn
        .prepare(
            "SELECT payload FROM agent_session_cache
             WHERE file_path = ?1 AND source = ?2 AND file_size = ?3 AND COALESCE(modified, '') = COALESCE(?4, '')",
        )
        .map_err(|err| format!("Failed to read agent session cache: {err}"))?;
    let mut rows = stmt
        .query(params![
            file_path,
            source.as_str(),
            file_size as i64,
            modified
        ])
        .map_err(|err| format!("Failed to query agent session cache: {err}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|err| format!("Failed to inspect agent session cache: {err}"))?
    {
        let payload: String = row
            .get(0)
            .map_err(|err| format!("Failed to load agent session cache: {err}"))?;
        let result = serde_json::from_str::<AgentSessionResult>(&payload)
            .map_err(|err| format!("Failed to parse agent session cache: {err}"))?;
        return Ok(Some(result));
    }
    Ok(None)
}

pub(crate) fn write_agent_session_cache(
    result: &AgentSessionResult,
    file_size: u64,
    modified: Option<&str>,
) -> Result<(), String> {
    let conn = open_cache()?;
    let payload = serde_json::to_string(result)
        .map_err(|err| format!("Failed to serialize agent session cache: {err}"))?;
    conn.execute(
        "INSERT INTO agent_session_cache (file_path, source, file_size, modified, payload, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s','now'))
         ON CONFLICT(file_path, source) DO UPDATE SET
            file_size = excluded.file_size,
            modified = excluded.modified,
            payload = excluded.payload,
            updated_at = excluded.updated_at",
        params![
            result.file_path,
            result.source,
            file_size as i64,
            modified,
            payload
        ],
    )
    .map_err(|err| format!("Failed to write agent session cache: {err}"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn append_scan_cache(
    file_path: &str,
    from_offset: u64,
    file_size: u64,
    modified: Option<String>,
    summaries: &[LogSummary],
    total_lines: usize,
    valid_records: usize,
    invalid_records: usize,
    duration_ms: u128,
) -> Result<(), String> {
    let payload = {
        let conn = open_cache()?;
        let mut stmt = conn
            .prepare("SELECT payload FROM scan_cache WHERE file_path = ?1")
            .map_err(|err| format!("Failed to read cache: {err}"))?;
        stmt.query_row(params![file_path], |row| row.get::<_, String>(0))
            .ok()
    };
    let Some(payload) = payload else {
        return Ok(());
    };
    let mut cached = serde_json::from_str::<FileScanResult>(&payload)
        .map_err(|err| format!("Failed to parse cache: {err}"))?;
    if cached.file_size != from_offset {
        return Ok(());
    }
    cached.file_size = file_size;
    cached.modified = modified;
    cached.total_lines = total_lines;
    cached.valid_records += valid_records;
    cached.invalid_records += invalid_records;
    cached.duration_ms = duration_ms;
    cached.cancelled = false;
    cached.cache_hit = false;
    cached.summaries.extend_from_slice(summaries);
    write_scan_cache(&cached)
}
