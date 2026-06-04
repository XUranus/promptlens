use crate::agent::agent_event_from_value;
use crate::agent_adapters::LogSource;
use crate::cache::{cache_db_path, read_agent_session_cache, write_agent_session_cache};
use crate::export::export_records as export_records_impl;
use crate::normalize::{modified_timestamp, normalize_call, summary_from_value};
use crate::scanner::{scan_jsonl_incremental as scan_jsonl_incremental_impl, scan_jsonl_inner};
use crate::search::search_jsonl_inner;
use crate::types::*;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::Path,
    process::Command,
    sync::atomic::Ordering,
};
use tauri::{AppHandle, State};

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
    log_source: Option<String>,
) -> Result<FileScanResult, String> {
    let _source = LogSource::from_option(log_source);
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
            modified: modified_timestamp(&metadata),
        },
        Err(_) => FileStatus {
            exists: false,
            file_size: None,
            modified: None,
        },
    }
}

#[tauri::command]
fn save_text_file(default_file_name: String, contents: String) -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_file_name(default_file_name)
        .save_file()
    else {
        return Ok(None);
    };
    fs::write(&path, contents).map_err(|err| format!("Failed to save file: {err}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn export_records(request: ExportRecordsRequest) -> Result<Option<String>, String> {
    export_records_impl(request)
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
                trace_id: None,
                session_id: None,
                request_id: None,
                parent_id: None,
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
    mode: Option<String>,
) -> Result<SearchResponse, String> {
    state.cancel_search.store(false, Ordering::Relaxed);
    search_jsonl_inner(
        file_path,
        query,
        mode.as_deref().unwrap_or("substring"),
        Some(&app),
        Some(&state.cancel_search),
    )
}

#[tauri::command]
fn cancel_search(state: State<AppState>) {
    state.cancel_search.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn list_system_fonts() -> Vec<String> {
    let output = Command::new("fc-list").arg(":").arg("family").output();
    let mut fonts = output
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .unwrap_or_default()
        .lines()
        .flat_map(|line| line.split(','))
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();

    fonts.extend(
        [
            "Arial",
            "Inter",
            "Noto Sans",
            "Noto Serif",
            "Noto Sans Mono",
            "DejaVu Sans",
            "DejaVu Sans Mono",
            "JetBrains Mono",
            "Fira Code",
            "Menlo",
            "Consolas",
        ]
        .into_iter()
        .map(str::to_string),
    );
    fonts.sort_by_key(|name| name.to_lowercase());
    fonts.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    fonts
}

#[tauri::command]
pub(crate) fn read_agent_session(
    file_path: String,
    log_source: Option<String>,
) -> Result<AgentSessionResult, String> {
    let source = LogSource::from_option(log_source);
    let path = Path::new(&file_path);
    let metadata = fs::metadata(path).map_err(|err| format!("Failed to read metadata: {err}"))?;
    let modified = modified_timestamp(&metadata);
    if let Ok(Some(cached)) =
        read_agent_session_cache(&file_path, source, metadata.len(), modified.as_deref())
    {
        return Ok(cached);
    }

    let file = File::open(path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut reader = BufReader::new(file);
    let (events, subagent_calls, sessions, ..) = read_agent_events(&mut reader, source, 0, 0)?;

    let mut sessions = sessions.into_iter().collect::<Vec<_>>();
    sessions.sort();

    // Load subagent JSONL files from the session directory
    let subagent_sessions = load_subagent_sessions(path, source, &subagent_calls);

    let result = AgentSessionResult {
        file_path,
        source: source.as_str().to_string(),
        total_events: events.len(),
        sessions,
        events,
        subagent_sessions,
    };
    let _ = write_agent_session_cache(&result, metadata.len(), modified.as_deref());
    Ok(result)
}

/// Read agent events from a BufReader, linking subagent_call -> tool_result as subagent_result.
/// Returns (events, subagent_calls, sessions, final_line_number, final_byte_offset).
fn read_agent_events(
    reader: &mut BufReader<File>,
    source: LogSource,
    initial_line_number: usize,
    initial_byte_offset: u64,
) -> Result<
    (
        Vec<AgentEvent>,
        HashMap<String, AgentEvent>,
        HashSet<String>,
        usize,
        u64,
    ),
    String,
> {
    let mut line = String::new();
    let mut line_number = initial_line_number;
    let mut byte_offset = initial_byte_offset;
    let mut events = Vec::new();
    let mut sessions = HashSet::new();
    let mut subagent_calls: HashMap<String, AgentEvent> = HashMap::new();

    loop {
        line.clear();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|err| format!("Failed to read line: {err}"))?;
        if bytes == 0 {
            break;
        }
        line_number += 1;
        let trimmed = line.trim_end_matches(['\n', '\r']);
        if trimmed.trim().is_empty() {
            byte_offset += bytes as u64;
            continue;
        }
        let value = match serde_json::from_str::<Value>(trimmed) {
            Ok(value) => value,
            Err(err) => json!({
                "parse_error": err.to_string(),
                "raw": trimmed,
            }),
        };
        let mut event = agent_event_from_value(value, line_number, byte_offset, source);
        if event.event_type == "tool_result" {
            if let Some(call) = event
                .tool_use_id
                .as_ref()
                .and_then(|tool_use_id| subagent_calls.get(tool_use_id))
            {
                event.event_type = "subagent_result".to_string();
                event.tool_name = event.tool_name.or_else(|| call.tool_name.clone());
                event.subagent_type = event.subagent_type.or_else(|| call.subagent_type.clone());
                event.subagent_description = event
                    .subagent_description
                    .or_else(|| call.subagent_description.clone());
                event.subagent_prompt = event
                    .subagent_prompt
                    .or_else(|| call.subagent_prompt.clone());
            }
        }
        if event.event_type == "subagent_call" {
            if let Some(tool_use_id) = &event.tool_use_id {
                subagent_calls.insert(tool_use_id.clone(), event.clone());
            }
        }
        if let Some(session_id) = &event.session_id {
            sessions.insert(session_id.clone());
        }
        events.push(event);
        byte_offset += bytes as u64;
    }

    Ok((events, subagent_calls, sessions, line_number, byte_offset))
}

fn load_subagent_sessions(
    main_file_path: &Path,
    source: LogSource,
    subagent_calls: &HashMap<String, AgentEvent>,
) -> Vec<SubagentSession> {
    let session_dir = main_file_path
        .parent()
        .map(|p| {
            let stem = main_file_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            p.join(stem)
        })
        .filter(|d| d.is_dir());

    let Some(session_dir) = session_dir else {
        return Vec::new();
    };

    let subagents_dir = session_dir.join("subagents");
    if !subagents_dir.is_dir() {
        return Vec::new();
    }

    let mut sessions = Vec::new();
    let Ok(entries) = fs::read_dir(&subagents_dir) else {
        return sessions;
    };

    // Build a lookup from agent_id to the subagent_call event
    let mut call_by_agent_id: HashMap<&str, &AgentEvent> = HashMap::new();
    for call in subagent_calls.values() {
        if let Some(ref agent_id) = call.agent_id {
            call_by_agent_id.insert(agent_id.as_str(), call);
        }
    }

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|ext| ext == "jsonl") {
            continue;
        }

        let agent_id = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        // Read meta file if it exists
        let meta_path = path.with_extension("meta.json");
        let meta: Option<Value> = fs::read_to_string(&meta_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());

        let agent_type = meta.as_ref().and_then(|m| {
            m.get("agentType")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
        let description = meta.as_ref().and_then(|m| {
            m.get("description")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
        let tool_use_id = meta.as_ref().and_then(|m| {
            m.get("toolUseId")
                .and_then(Value::as_str)
                .map(str::to_string)
        });

        // Read the subagent JSONL
        let Ok(file) = File::open(&path) else {
            continue;
        };
        let mut reader = BufReader::new(file);
        let mut line = String::new();
        let mut sub_events = Vec::new();
        let mut line_number = 0usize;
        let mut byte_offset = 0u64;

        loop {
            line.clear();
            let bytes = match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(b) => b,
                Err(_) => break,
            };
            line_number += 1;
            let trimmed = line.trim_end_matches(['\n', '\r']);
            if trimmed.trim().is_empty() {
                byte_offset += bytes as u64;
                continue;
            }
            let value = match serde_json::from_str::<Value>(trimmed) {
                Ok(v) => v,
                Err(err) => json!({ "parse_error": err.to_string(), "raw": trimmed }),
            };
            let mut event = agent_event_from_value(value, line_number, byte_offset, source);
            event.agent_id = Some(agent_id.clone());
            sub_events.push(event);
            byte_offset += bytes as u64;
        }

        if !sub_events.is_empty() {
            sessions.push(SubagentSession {
                agent_id,
                agent_type,
                description,
                tool_use_id,
                events: sub_events,
            });
        }
    }

    sessions.sort_by(|a, b| a.agent_id.cmp(&b.agent_id));
    sessions
}

#[tauri::command]
fn scan_jsonl_incremental(
    file_path: String,
    from_offset: u64,
    from_line_number: usize,
) -> Result<IncrementalScanResult, String> {
    scan_jsonl_incremental_impl(file_path, from_offset, from_line_number)
}

#[tauri::command]
fn detect_log_source(file_path: String) -> Option<String> {
    use crate::agent::detect_source_from_value;
    let file = match File::open(&file_path) {
        Ok(f) => f,
        Err(_) => return None,
    };
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut votes: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for _ in 0..20 {
        line.clear();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            if let Some(source) = detect_source_from_value(&value) {
                *votes.entry(source.as_str().to_string()).or_insert(0) += 1;
            }
        }
    }
    votes
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(source, _)| source)
}

#[tauri::command]
fn read_agent_session_incremental(
    file_path: String,
    from_offset: u64,
    from_line_number: usize,
    log_source: Option<String>,
) -> Result<AgentSessionIncrementalResult, String> {
    let source = LogSource::from_option(log_source);
    let path = Path::new(&file_path);
    let metadata = fs::metadata(path).map_err(|err| format!("Failed to read metadata: {err}"))?;
    let modified = modified_timestamp(&metadata);

    let file = File::open(path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut reader = BufReader::new(file);
    reader
        .seek(SeekFrom::Start(from_offset))
        .map_err(|err| format!("Failed to seek offset: {err}"))?;

    let (events, subagent_calls, mut sessions, line_number, _byte_offset) =
        read_agent_events(&mut reader, source, from_line_number, from_offset)?;

    // Cache the incremental result as a full session result
    let mut sorted_sessions = sessions.drain().collect::<Vec<_>>();
    sorted_sessions.sort();
    let subagent_sessions = load_subagent_sessions(path, source, &subagent_calls);
    let full_result = AgentSessionResult {
        file_path: file_path.clone(),
        source: source.as_str().to_string(),
        total_events: events.len(),
        sessions: sorted_sessions,
        events: events.clone(),
        subagent_sessions,
    };
    let _ = write_agent_session_cache(&full_result, metadata.len(), modified.as_deref());

    let total = events.len();
    Ok(AgentSessionIncrementalResult {
        events,
        next_line_number: line_number,
        total_events: total,
    })
}

#[tauri::command]
fn get_pricing_table() -> Vec<crate::pricing::ModelPricing> {
    crate::pricing::load_pricing_table().to_vec()
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CostRequest {
    model: String,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
}

#[tauri::command]
fn calculate_costs(requests: Vec<CostRequest>) -> Vec<crate::pricing::CostEstimate> {
    let table = crate::pricing::load_pricing_table();
    requests
        .iter()
        .map(|r| {
            crate::pricing::calculate_cost(&r.model, r.prompt_tokens, r.completion_tokens, &table)
        })
        .collect()
}

#[tauri::command]
fn start_file_watch(
    file_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut watcher = state.file_watcher.lock().map_err(|e| e.to_string())?;
    // Stop existing watcher if watching a different file
    if let Some(ref w) = *watcher {
        if w.path().to_string_lossy() != file_path {
            *watcher = None;
        } else {
            return Ok(()); // Already watching this file
        }
    }
    let new_watcher =
        crate::watcher::FileWatcher::start(std::path::PathBuf::from(&file_path), app)?;
    *watcher = Some(new_watcher);
    Ok(())
}

#[tauri::command]
fn stop_file_watch(state: State<'_, AppState>) -> Result<(), String> {
    let mut watcher = state.file_watcher.lock().map_err(|e| e.to_string())?;
    *watcher = None;
    Ok(())
}

#[tauri::command]
fn compute_analytics(file_path: String) -> Result<crate::analytics::ComputedAnalytics, String> {
    use crate::cache::read_scan_cache;
    let path = Path::new(&file_path);
    let metadata = fs::metadata(path).map_err(|err| format!("Failed to read metadata: {err}"))?;
    let modified = modified_timestamp(&metadata);
    let cached = read_scan_cache(&file_path, metadata.len(), modified.as_deref())?
        .ok_or_else(|| "No cached scan results found. Please scan the file first.".to_string())?;
    Ok(crate::analytics::compute_all(&cached.summaries))
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_file_dialog,
            scan_jsonl,
            scan_jsonl_incremental,
            cancel_scan,
            clear_scan_cache,
            get_cache_info,
            get_file_status,
            save_text_file,
            export_records,
            read_record,
            read_agent_session,
            read_agent_session_incremental,
            detect_log_source,
            search_jsonl,
            cancel_search,
            list_system_fonts,
            get_pricing_table,
            calculate_costs,
            start_file_watch,
            stop_file_watch,
            compute_analytics
        ])
        .run(tauri::generate_context!())
        .expect("error while running PromptLens");
}
