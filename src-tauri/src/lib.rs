mod adapters;
mod parser;

use adapters::{detect_provider, normalize_role};
use parser::image_detector::normalize_image_string;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
use tauri::{AppHandle, Emitter, State};

const MAX_SEARCH_RESULTS: usize = 1000;
const CACHE_SCHEMA_VERSION: i64 = 1;

struct AppState {
    cancel_scan: AtomicBool,
    cancel_search: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            cancel_scan: AtomicBool::new(false),
            cancel_search: AtomicBool::new(false),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogSummary {
    id: String,
    line_number: usize,
    byte_offset: u64,
    timestamp: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    status: String,
    latency_ms: Option<u64>,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    has_image: bool,
    has_tool_call: bool,
    preview: Option<String>,
    parse_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileScanResult {
    file_path: String,
    file_name: String,
    file_size: u64,
    modified: Option<String>,
    total_lines: usize,
    valid_records: usize,
    invalid_records: usize,
    duration_ms: u128,
    cancelled: bool,
    cache_hit: bool,
    summaries: Vec<LogSummary>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordDetail {
    summary: LogSummary,
    normalized: Option<NormalizedCall>,
    raw: Option<Value>,
    parse_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    line_number: usize,
    byte_offset: u64,
    context: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    results: Vec<SearchResult>,
    truncated: bool,
    cancelled: bool,
    duration_ms: u128,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    processed_bytes: u64,
    total_bytes: u64,
    line_number: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheInfo {
    path: String,
    exists: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileStatus {
    exists: bool,
    file_size: Option<u64>,
    modified: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedCall {
    id: String,
    line_number: usize,
    timestamp: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    endpoint: Option<String>,
    status: String,
    latency_ms: Option<u64>,
    usage: Option<Usage>,
    request: Option<NormalizedPayload>,
    response: Option<NormalizedResponse>,
    error: Option<NormalizedError>,
    metadata: Option<Value>,
    raw: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Usage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedPayload {
    messages: Option<Vec<NormalizedMessage>>,
    raw: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedResponse {
    text: Option<String>,
    messages: Option<Vec<NormalizedMessage>>,
    tool_calls: Option<Value>,
    raw: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedError {
    message: Option<String>,
    error_type: Option<String>,
    stack: Option<String>,
    raw: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedMessage {
    role: String,
    content: Vec<NormalizedContent>,
    raw: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum NormalizedContent {
    Text {
        text: String,
    },
    Image {
        mime: Option<String>,
        data_url: Option<String>,
        base64: Option<String>,
    },
    ToolCall {
        name: Option<String>,
        arguments: Option<Value>,
    },
    ToolResult {
        name: Option<String>,
        result: Option<Value>,
    },
    Unknown {
        raw: Value,
    },
}

#[tauri::command]
fn open_file_dialog() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("JSONL", &["jsonl", "ndjson", "log"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn scan_jsonl(
    app: AppHandle,
    state: State<AppState>,
    file_path: String,
) -> Result<FileScanResult, String> {
    state.cancel_scan.store(false, Ordering::Relaxed);
    scan_jsonl_inner(file_path, Some(&app), Some(&state.cancel_scan))
}

#[tauri::command]
fn cancel_scan(state: State<AppState>) {
    state.cancel_scan.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn clear_scan_cache() -> Result<(), String> {
    let path = cache_db_path()?;
    if path.exists() {
        fs::remove_file(path).map_err(|err| format!("Failed to clear cache: {err}"))?;
    }
    Ok(())
}

#[tauri::command]
fn get_cache_info() -> Result<CacheInfo, String> {
    let path = cache_db_path()?;
    Ok(CacheInfo {
        exists: path.exists(),
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn get_file_status(file_path: String) -> FileStatus {
    match fs::metadata(file_path) {
        Ok(metadata) => FileStatus {
            exists: true,
            file_size: Some(metadata.len()),
            modified: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs().to_string()),
        },
        Err(_) => FileStatus {
            exists: false,
            file_size: None,
            modified: None,
        },
    }
}

fn scan_jsonl_inner(
    file_path: String,
    app: Option<&AppHandle>,
    cancel_flag: Option<&AtomicBool>,
) -> Result<FileScanResult, String> {
    let started = Instant::now();
    let path = Path::new(&file_path);
    let file = File::open(path).map_err(|err| format!("Failed to open file: {err}"))?;
    let metadata = fs::metadata(path).map_err(|err| format!("Failed to read metadata: {err}"))?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown.jsonl".to_string());
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string());

    if let Ok(Some(mut cached)) = read_scan_cache(&file_path, metadata.len(), modified.as_deref()) {
        cached.duration_ms = started.elapsed().as_millis();
        cached.cache_hit = true;
        cached.cancelled = false;
        return Ok(cached);
    }

    let mut reader = BufReader::new(file);
    let mut summaries = Vec::new();
    let mut total_lines = 0usize;
    let mut valid_records = 0usize;
    let mut invalid_records = 0usize;
    let mut byte_offset = 0u64;
    let mut line = String::new();
    let mut cancelled = false;

    loop {
        if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            cancelled = true;
            break;
        }

        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|err| format!("Failed to read line: {err}"))?;
        if bytes_read == 0 {
            break;
        }

        total_lines += 1;
        let current_offset = byte_offset;
        byte_offset += bytes_read as u64;

        if total_lines == 1 || total_lines % 500 == 0 {
            if let Some(app) = app {
                let _ = app.emit(
                    "scan-progress",
                    ProgressEvent {
                        processed_bytes: byte_offset,
                        total_bytes: metadata.len(),
                        line_number: total_lines,
                    },
                );
            }
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match serde_json::from_str::<Value>(trimmed) {
            Ok(value) => {
                valid_records += 1;
                summaries.push(summary_from_value(
                    &value,
                    total_lines,
                    current_offset,
                    None,
                ));
            }
            Err(err) => {
                invalid_records += 1;
                summaries.push(LogSummary {
                    id: format!("line-{total_lines}"),
                    line_number: total_lines,
                    byte_offset: current_offset,
                    timestamp: None,
                    provider: None,
                    model: None,
                    status: "invalid_json".to_string(),
                    latency_ms: None,
                    prompt_tokens: None,
                    completion_tokens: None,
                    total_tokens: None,
                    has_image: false,
                    has_tool_call: false,
                    preview: Some(trimmed.chars().take(180).collect()),
                    parse_error: Some(err.to_string()),
                });
            }
        }
    }

    let result = FileScanResult {
        file_path,
        file_name,
        file_size: metadata.len(),
        modified,
        total_lines,
        valid_records,
        invalid_records,
        duration_ms: started.elapsed().as_millis(),
        cancelled,
        cache_hit: false,
        summaries,
    };
    if !result.cancelled {
        let _ = write_scan_cache(&result);
    }
    Ok(result)
}

fn cache_db_path() -> Result<std::path::PathBuf, String> {
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

fn open_cache() -> Result<Connection, String> {
    let conn =
        Connection::open(cache_db_path()?).map_err(|err| format!("Failed to open cache: {err}"))?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|err| format!("Failed to read cache schema version: {err}"))?;
    if version != 0 && version != CACHE_SCHEMA_VERSION {
        conn.execute("DROP TABLE IF EXISTS scan_cache", [])
            .map_err(|err| format!("Failed to reset old cache: {err}"))?;
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
    conn.pragma_update(None, "user_version", CACHE_SCHEMA_VERSION)
        .map_err(|err| format!("Failed to update cache schema version: {err}"))?;
    Ok(conn)
}

fn read_scan_cache(
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

fn write_scan_cache(result: &FileScanResult) -> Result<(), String> {
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

#[tauri::command]
fn read_record(
    file_path: String,
    byte_offset: u64,
    line_number: usize,
) -> Result<RecordDetail, String> {
    let file = File::open(&file_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut reader = BufReader::new(file);
    reader
        .seek(SeekFrom::Start(byte_offset))
        .map_err(|err| format!("Failed to seek record: {err}"))?;

    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|err| format!("Failed to read record: {err}"))?;
    let trimmed = line.trim();

    match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => {
            let summary = summary_from_value(&value, line_number, byte_offset, None);
            let normalized = normalize_call(&value, &summary);
            Ok(RecordDetail {
                summary,
                normalized: Some(normalized),
                raw: Some(value),
                parse_error: None,
            })
        }
        Err(err) => Ok(RecordDetail {
            summary: LogSummary {
                id: format!("line-{line_number}"),
                line_number,
                byte_offset,
                timestamp: None,
                provider: None,
                model: None,
                status: "invalid_json".to_string(),
                latency_ms: None,
                prompt_tokens: None,
                completion_tokens: None,
                total_tokens: None,
                has_image: false,
                has_tool_call: false,
                preview: Some(trimmed.chars().take(180).collect()),
                parse_error: Some(err.to_string()),
            },
            normalized: None,
            raw: None,
            parse_error: Some(err.to_string()),
        }),
    }
}

#[tauri::command]
fn search_jsonl(
    app: AppHandle,
    state: State<AppState>,
    file_path: String,
    query: String,
) -> Result<SearchResponse, String> {
    state.cancel_search.store(false, Ordering::Relaxed);
    search_jsonl_inner(file_path, query, Some(&app), Some(&state.cancel_search))
}

#[tauri::command]
fn cancel_search(state: State<AppState>) {
    state.cancel_search.store(true, Ordering::Relaxed);
}

fn search_jsonl_inner(
    file_path: String,
    query: String,
    app: Option<&AppHandle>,
    cancel_flag: Option<&AtomicBool>,
) -> Result<SearchResponse, String> {
    let started = Instant::now();
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(SearchResponse {
            results: Vec::new(),
            truncated: false,
            cancelled: false,
            duration_ms: 0,
        });
    }

    let file = File::open(&file_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let total_bytes = fs::metadata(&file_path)
        .map_err(|err| format!("Failed to read metadata: {err}"))?
        .len();
    let mut reader = BufReader::new(file);
    let mut results = Vec::new();
    let mut line = String::new();
    let mut byte_offset = 0u64;
    let mut line_number = 0usize;
    let mut truncated = false;
    let mut cancelled = false;

    loop {
        if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            cancelled = true;
            break;
        }

        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|err| format!("Failed to search file: {err}"))?;
        if bytes_read == 0 {
            break;
        }

        line_number += 1;
        let current_offset = byte_offset;
        byte_offset += bytes_read as u64;
        if line_number == 1 || line_number % 500 == 0 {
            if let Some(app) = app {
                let _ = app.emit(
                    "search-progress",
                    ProgressEvent {
                        processed_bytes: byte_offset,
                        total_bytes,
                        line_number,
                    },
                );
            }
        }
        let haystack = line.to_lowercase();
        if let Some(index) = haystack.find(&needle) {
            let prefix_chars = haystack[..index].chars().count();
            let start_chars = prefix_chars.saturating_sub(80);
            let end_chars = prefix_chars + needle.chars().count() + 120;
            let context = line
                .chars()
                .skip(start_chars)
                .take(end_chars.saturating_sub(start_chars))
                .collect::<String>();
            results.push(SearchResult {
                line_number,
                byte_offset: current_offset,
                context: context.trim().to_string(),
            });
            if results.len() >= MAX_SEARCH_RESULTS {
                truncated = true;
                break;
            }
        }
    }

    Ok(SearchResponse {
        results,
        truncated,
        cancelled,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn summary_from_value(
    value: &Value,
    line_number: usize,
    byte_offset: u64,
    parse_error: Option<String>,
) -> LogSummary {
    let usage = find_usage(value);
    let status = detect_status(value);
    LogSummary {
        id: value
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("line-{line_number}")),
        line_number,
        byte_offset,
        timestamp: first_string(value, &["timestamp", "time", "created_at", "createdAt"]),
        provider: first_string(value, &["provider", "vendor"]),
        model: find_model(value),
        status,
        latency_ms: first_u64(
            value,
            &["latency_ms", "latencyMs", "duration_ms", "durationMs"],
        ),
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        has_image: contains_image(value),
        has_tool_call: contains_key(
            value,
            &["tool_calls", "toolCalls", "function_call", "functionCall"],
        ),
        preview: find_preview(value),
        parse_error,
    }
}

fn normalize_call(value: &Value, summary: &LogSummary) -> NormalizedCall {
    let request_raw = value.get("request").cloned();
    let response_raw = value.get("response").cloned();
    let error_raw = value.get("error").cloned().filter(|error| !error.is_null());
    let provider = summary.provider.clone().or_else(|| detect_provider(value));
    let request_messages = request_raw
        .as_ref()
        .and_then(extract_messages)
        .or_else(|| extract_messages(value));
    let response_messages = extract_response_messages(value);
    let response_text = response_messages.as_ref().and_then(|messages| {
        messages.iter().find_map(|message| {
            message.content.iter().find_map(|content| match content {
                NormalizedContent::Text { text } => Some(text.clone()),
                _ => None,
            })
        })
    });

    NormalizedCall {
        id: summary.id.clone(),
        line_number: summary.line_number,
        timestamp: summary.timestamp.clone(),
        provider,
        model: summary.model.clone(),
        endpoint: first_string(value, &["endpoint", "url", "path"]),
        status: if summary.status == "invalid_json" {
            "unknown".to_string()
        } else {
            summary.status.clone()
        },
        latency_ms: summary.latency_ms,
        usage: Some(Usage {
            prompt_tokens: summary.prompt_tokens,
            completion_tokens: summary.completion_tokens,
            total_tokens: summary.total_tokens,
        }),
        request: Some(NormalizedPayload {
            messages: request_messages,
            raw: request_raw,
        }),
        response: Some(NormalizedResponse {
            text: response_text,
            messages: response_messages,
            tool_calls: find_first_key(
                value,
                &["tool_calls", "toolCalls", "function_call", "tool_use"],
            )
            .cloned(),
            raw: response_raw,
        }),
        error: error_raw.as_ref().map(|error| NormalizedError {
            message: error
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| error.as_str().map(str::to_string)),
            error_type: error
                .get("type")
                .or_else(|| error.get("name"))
                .and_then(Value::as_str)
                .map(str::to_string),
            stack: error
                .get("stack")
                .and_then(Value::as_str)
                .map(str::to_string),
            raw: Some(error.clone()),
        }),
        metadata: value.get("metadata").cloned(),
        raw: value.clone(),
    }
}

fn extract_messages(value: &Value) -> Option<Vec<NormalizedMessage>> {
    let messages = find_first_key(value, &["messages", "input", "contents"])?;
    match messages {
        Value::Array(items) => {
            let parsed: Vec<_> = items.iter().filter_map(normalize_message).collect();
            (!parsed.is_empty()).then_some(parsed)
        }
        _ => None,
    }
}

fn extract_response_messages(value: &Value) -> Option<Vec<NormalizedMessage>> {
    if let Some(message) = value.get("message").and_then(normalize_message) {
        return Some(vec![message]);
    }

    if let Some(response) = value.get("response") {
        if let Some(message) = response.get("message").and_then(normalize_message) {
            return Some(vec![message]);
        }
        if let Some(messages) = extract_messages(response) {
            return Some(messages);
        }
        if let Some(text) = response
            .get("text")
            .or_else(|| response.get("content"))
            .and_then(Value::as_str)
        {
            return Some(vec![NormalizedMessage {
                role: "assistant".to_string(),
                content: vec![NormalizedContent::Text {
                    text: text.to_string(),
                }],
                raw: Some(response.clone()),
            }]);
        }
    }

    if let Some(choices) = value.get("choices").and_then(Value::as_array) {
        let messages: Vec<_> = choices
            .iter()
            .filter_map(|choice| choice.get("message").and_then(normalize_message))
            .collect();
        if !messages.is_empty() {
            return Some(messages);
        }
    }

    if let Some(output) = value
        .get("output")
        .or_else(|| value.get("content"))
        .and_then(Value::as_array)
    {
        let mut messages = Vec::new();
        for item in output {
            if let Some(message) = normalize_message(item) {
                messages.push(message);
            } else if let Some(content) = item.get("content").and_then(Value::as_array) {
                let parts = content
                    .iter()
                    .flat_map(normalize_content_part)
                    .collect::<Vec<_>>();
                if !parts.is_empty() {
                    messages.push(NormalizedMessage {
                        role: item
                            .get("role")
                            .and_then(Value::as_str)
                            .map(normalize_role)
                            .unwrap_or_else(|| "assistant".to_string()),
                        content: parts,
                        raw: Some(item.clone()),
                    });
                }
            } else {
                let parts = normalize_content_part(item);
                if !parts.is_empty()
                    && !matches!(parts.as_slice(), [NormalizedContent::Unknown { .. }])
                {
                    messages.push(NormalizedMessage {
                        role: item
                            .get("role")
                            .and_then(Value::as_str)
                            .map(normalize_role)
                            .unwrap_or_else(|| "assistant".to_string()),
                        content: parts,
                        raw: Some(item.clone()),
                    });
                }
            }
        }
        if !messages.is_empty() {
            return Some(messages);
        }
    }

    if let Some(candidates) = value.get("candidates").and_then(Value::as_array) {
        let messages = candidates
            .iter()
            .filter_map(|candidate| candidate.get("content").and_then(normalize_message))
            .collect::<Vec<_>>();
        if !messages.is_empty() {
            return Some(messages);
        }
    }

    value
        .get("output_text")
        .or_else(|| value.get("response_text"))
        .or_else(|| value.get("text"))
        .and_then(Value::as_str)
        .map(|text| {
            vec![NormalizedMessage {
                role: "assistant".to_string(),
                content: vec![NormalizedContent::Text {
                    text: text.to_string(),
                }],
                raw: None,
            }]
        })
}

fn normalize_message(value: &Value) -> Option<NormalizedMessage> {
    let role = value
        .get("role")
        .and_then(Value::as_str)
        .or_else(|| value.get("author").and_then(Value::as_str))
        .map(normalize_role)
        .unwrap_or_else(|| "unknown".to_string());
    let content_value = value
        .get("content")
        .or_else(|| value.get("parts"))
        .or_else(|| value.get("message"));
    let mut content = Vec::new();

    match content_value {
        Some(Value::String(text)) => content.push(NormalizedContent::Text { text: text.clone() }),
        Some(Value::Array(items)) => {
            for item in items {
                content.extend(normalize_content_part(item));
            }
        }
        Some(other) => {
            if let Some(text) = text_preview_from_value(other) {
                content.push(NormalizedContent::Text { text });
            } else {
                content.push(NormalizedContent::Unknown { raw: other.clone() });
            }
        }
        None => {
            if let Some(tool_calls) = value.get("tool_calls").or_else(|| value.get("toolCalls")) {
                content.push(NormalizedContent::ToolCall {
                    name: None,
                    arguments: Some(tool_calls.clone()),
                });
            }
        }
    }

    if content.is_empty() {
        return None;
    }

    Some(NormalizedMessage {
        role,
        content,
        raw: Some(value.clone()),
    })
}

fn normalize_content_part(value: &Value) -> Vec<NormalizedContent> {
    if let Some(inline_data) = value.get("inline_data").or_else(|| value.get("inlineData")) {
        if let Some(data) = inline_data.get("data").and_then(Value::as_str) {
            let mime = inline_data
                .get("mime_type")
                .or_else(|| inline_data.get("mimeType"))
                .and_then(Value::as_str)
                .unwrap_or("image/png");
            return vec![NormalizedContent::Image {
                mime: Some(mime.to_string()),
                data_url: Some(format!("data:{mime};base64,{data}")),
                base64: Some(data.to_string()),
            }];
        }
    }

    if let Some(source) = value.get("source") {
        if let Some(data) = source.get("data").and_then(Value::as_str) {
            let mime = source
                .get("media_type")
                .or_else(|| source.get("mime_type"))
                .and_then(Value::as_str)
                .unwrap_or("image/png");
            return vec![NormalizedContent::Image {
                mime: Some(mime.to_string()),
                data_url: Some(format!("data:{mime};base64,{data}")),
                base64: Some(data.to_string()),
            }];
        }
    }

    if let Some(text) = value
        .get("text")
        .or_else(|| value.get("content"))
        .and_then(Value::as_str)
    {
        return vec![NormalizedContent::Text {
            text: text.to_string(),
        }];
    }

    if let Some(url) = value
        .get("image_url")
        .and_then(|image_url| image_url.get("url").or(Some(image_url)))
        .and_then(Value::as_str)
        .or_else(|| value.get("url").and_then(Value::as_str))
        .or_else(|| value.get("data").and_then(Value::as_str))
        .or_else(|| value.get("image").and_then(Value::as_str))
        .or_else(|| value.get("image_base64").and_then(Value::as_str))
    {
        if let Some((mime, data_url, base64)) = normalize_image_string(url) {
            return vec![NormalizedContent::Image {
                mime,
                data_url,
                base64,
            }];
        }
    }

    if matches!(
        value.get("type").and_then(Value::as_str),
        Some("tool_call") | Some("function_call") | Some("tool_use")
    ) {
        return vec![NormalizedContent::ToolCall {
            name: value
                .get("name")
                .or_else(|| value.get("id"))
                .and_then(Value::as_str)
                .map(str::to_string),
            arguments: value
                .get("arguments")
                .or_else(|| value.get("input"))
                .cloned(),
        }];
    }

    if matches!(
        value.get("type").and_then(Value::as_str),
        Some("tool_result") | Some("function_result") | Some("tool_result_delta")
    ) {
        return vec![NormalizedContent::ToolResult {
            name: value
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string),
            result: value
                .get("result")
                .or_else(|| value.get("content"))
                .cloned(),
        }];
    }

    vec![NormalizedContent::Unknown { raw: value.clone() }]
}

fn detect_status(value: &Value) -> String {
    if value
        .get("error")
        .is_some_and(|error| !error.is_null() && error != "")
    {
        return "error".to_string();
    }
    if let Some(status) = value.get("status").and_then(Value::as_str) {
        let lowered = status.to_lowercase();
        if lowered.contains("error") || lowered.contains("fail") {
            return "error".to_string();
        }
        if lowered.contains("success") || lowered == "ok" || lowered == "completed" {
            return "success".to_string();
        }
    }
    "success".to_string()
}

fn find_usage(value: &Value) -> Usage {
    let usage = value.get("usage").unwrap_or(value);
    Usage {
        prompt_tokens: first_u64(
            usage,
            &[
                "prompt_tokens",
                "promptTokens",
                "input_tokens",
                "inputTokens",
                "promptTokenCount",
            ],
        ),
        completion_tokens: first_u64(
            usage,
            &[
                "completion_tokens",
                "completionTokens",
                "output_tokens",
                "outputTokens",
                "candidatesTokenCount",
            ],
        ),
        total_tokens: first_u64(usage, &["total_tokens", "totalTokens", "totalTokenCount"]),
    }
}

fn find_model(value: &Value) -> Option<String> {
    first_string(value, &["model", "model_name", "modelName"]).or_else(|| {
        value
            .get("request")
            .and_then(|request| first_string(request, &["model", "model_name", "modelName"]))
    })
}

fn find_preview(value: &Value) -> Option<String> {
    let candidates = [
        "/response/message/content",
        "/response/content",
        "/response/text",
        "/request/messages/0/content",
        "/messages/0/content",
        "/output_text",
        "/text",
    ];

    for pointer in candidates {
        if let Some(preview) = value.pointer(pointer).and_then(text_preview_from_value) {
            return Some(preview);
        }
    }

    Some(
        value
            .to_string()
            .chars()
            .take(180)
            .collect::<String>()
            .replace('\n', " "),
    )
}

fn text_preview_from_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.chars().take(180).collect()),
        Value::Array(items) => items.iter().find_map(text_preview_from_value),
        Value::Object(map) => map
            .get("text")
            .or_else(|| map.get("content"))
            .and_then(text_preview_from_value),
        _ => None,
    }
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| find_first_key(value, &[*key]))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn first_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| find_first_key(value, &[*key]))
        .and_then(|found| found.as_u64().or_else(|| found.as_f64().map(|n| n as u64)))
}

fn find_first_key<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(found) = map.get(*key) {
                    return Some(found);
                }
            }
            map.values().find_map(|child| find_first_key(child, keys))
        }
        Value::Array(items) => items.iter().find_map(|child| find_first_key(child, keys)),
        _ => None,
    }
}

fn contains_key(value: &Value, keys: &[&str]) -> bool {
    find_first_key(value, keys).is_some()
}

fn contains_image(value: &Value) -> bool {
    match value {
        Value::String(text) => normalize_image_string(text).is_some(),
        Value::Array(items) => items.iter().any(contains_image),
        Value::Object(map) => map.iter().any(|(key, child)| {
            let key = key.to_lowercase();
            key.contains("image")
                || key.contains("screenshot")
                || key.contains("base64")
                    && child.as_str().and_then(normalize_image_string).is_some()
                || contains_image(child)
        }),
        _ => false,
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_file_dialog,
            scan_jsonl,
            cancel_scan,
            clear_scan_cache,
            get_cache_info,
            get_file_status,
            read_record,
            search_jsonl,
            cancel_search
        ])
        .run(tauri::generate_context!())
        .expect("error while running PromptLens");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn scan_jsonl_tracks_offsets_and_invalid_lines() {
        let mut file = NamedTempFile::new().expect("temp file");
        writeln!(
            file,
            "{}",
            json!({
                "id": "call_1",
                "timestamp": "2026-05-13T10:00:00Z",
                "provider": "openai",
                "model": "gpt-4.1",
                "request": {"messages": [{"role": "user", "content": "hello"}]},
                "response": {"message": {"role": "assistant", "content": "world"}},
                "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
                "error": null
            })
        )
        .unwrap();
        writeln!(file, "not-json").unwrap();

        let result =
            scan_jsonl_inner(file.path().to_string_lossy().to_string(), None, None).unwrap();

        assert_eq!(result.total_lines, 2);
        assert_eq!(result.valid_records, 1);
        assert_eq!(result.invalid_records, 1);
        assert_eq!(result.summaries[0].line_number, 1);
        assert_eq!(result.summaries[0].byte_offset, 0);
        assert_eq!(result.summaries[0].total_tokens, Some(3));
        assert_eq!(result.summaries[1].status, "invalid_json");
        assert!(result.summaries[1].byte_offset > 0);
    }

    #[test]
    fn read_record_normalizes_openai_chat_completion() {
        let value = json!({
            "id": "chatcmpl_1",
            "choices": [{"message": {"role": "assistant", "content": "## Done"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            "model": "gpt-4.1"
        });
        let summary = summary_from_value(&value, 1, 0, None);
        let normalized = normalize_call(&value, &summary);

        assert_eq!(normalized.provider.as_deref(), Some("openai"));
        assert_eq!(normalized.model.as_deref(), Some("gpt-4.1"));
        assert_eq!(normalized.usage.unwrap().total_tokens, Some(15));
        assert_eq!(
            normalized.response.unwrap().messages.unwrap()[0].role,
            "assistant"
        );
    }

    #[test]
    fn normalizes_anthropic_and_gemini_content() {
        let anthropic: Value =
            serde_json::from_str(include_str!("../fixtures/anthropic_messages.json")).unwrap();
        let normalized = normalize_call(&anthropic, &summary_from_value(&anthropic, 1, 0, None));
        assert_eq!(normalized.provider.as_deref(), Some("anthropic"));
        assert_eq!(
            normalized.response.unwrap().messages.unwrap()[0]
                .content
                .len(),
            1
        );

        let gemini: Value =
            serde_json::from_str(include_str!("../fixtures/gemini_candidate.json")).unwrap();
        let normalized = normalize_call(&gemini, &summary_from_value(&gemini, 1, 0, None));
        assert_eq!(normalized.provider.as_deref(), Some("gemini"));
        assert_eq!(
            normalized.response.unwrap().messages.unwrap()[0].role,
            "assistant"
        );
    }

    #[test]
    fn normalizes_provider_fixtures() {
        for (fixture, provider) in [
            (include_str!("../fixtures/openai_chat.json"), "openai"),
            (
                include_str!("../fixtures/anthropic_messages.json"),
                "anthropic",
            ),
            (include_str!("../fixtures/gemini_candidate.json"), "gemini"),
            (include_str!("../fixtures/ollama_chat.json"), "ollama"),
        ] {
            let value: Value = serde_json::from_str(fixture).unwrap();
            let normalized = normalize_call(&value, &summary_from_value(&value, 1, 0, None));
            assert_eq!(normalized.provider.as_deref(), Some(provider));
            assert!(normalized.response.unwrap().messages.is_some());
        }
    }

    #[test]
    fn detects_data_url_images() {
        let image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
        let value = json!({"request": {"messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": image}}]}]}});
        let summary = summary_from_value(&value, 1, 0, None);
        assert!(summary.has_image);
        assert!(contains_image(&value));
    }

    #[test]
    fn search_limits_results() {
        let mut file = NamedTempFile::new().expect("temp file");
        for index in 0..(MAX_SEARCH_RESULTS + 10) {
            writeln!(file, "{{\"line\": {index}, \"text\": \"needle\"}}").unwrap();
        }

        let response = search_jsonl_inner(
            file.path().to_string_lossy().to_string(),
            "needle".to_string(),
            None,
            None,
        )
        .unwrap();
        assert_eq!(response.results.len(), MAX_SEARCH_RESULTS);
        assert!(response.truncated);
    }

    #[test]
    fn scan_cache_round_trips_valid_scan() {
        let mut file = NamedTempFile::new().expect("temp file");
        let cache_file = NamedTempFile::new().expect("cache file");
        std::env::set_var("PROMPTLENS_CACHE_PATH", cache_file.path());
        writeln!(
            file,
            "{{\"id\":\"cached\",\"model\":\"gpt-4.1\",\"response\":\"ok\"}}"
        )
        .unwrap();
        let path = file.path().to_string_lossy().to_string();

        let first = scan_jsonl_inner(path.clone(), None, None).unwrap();
        assert!(!first.cache_hit);
        assert_eq!(first.valid_records, 1);

        let second = scan_jsonl_inner(path, None, None).unwrap();
        assert!(second.cache_hit);
        assert_eq!(second.valid_records, 1);
        assert_eq!(second.summaries[0].id, "cached");
        std::env::remove_var("PROMPTLENS_CACHE_PATH");
    }
}
