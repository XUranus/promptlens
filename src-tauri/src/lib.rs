use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::Path,
};

#[derive(Debug, Serialize, Clone)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileScanResult {
    file_path: String,
    file_name: String,
    file_size: u64,
    modified: Option<String>,
    total_lines: usize,
    valid_records: usize,
    invalid_records: usize,
    summaries: Vec<LogSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordDetail {
    summary: LogSummary,
    normalized: Option<NormalizedCall>,
    raw: Option<Value>,
    parse_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    line_number: usize,
    byte_offset: u64,
    context: String,
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Usage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedPayload {
    messages: Option<Vec<NormalizedMessage>>,
    raw: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedResponse {
    text: Option<String>,
    messages: Option<Vec<NormalizedMessage>>,
    tool_calls: Option<Value>,
    raw: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedError {
    message: Option<String>,
    error_type: Option<String>,
    stack: Option<String>,
    raw: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedMessage {
    role: String,
    content: Vec<NormalizedContent>,
    raw: Option<Value>,
}

#[derive(Debug, Serialize)]
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
fn scan_jsonl(file_path: String) -> Result<FileScanResult, String> {
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

    let mut reader = BufReader::new(file);
    let mut summaries = Vec::new();
    let mut total_lines = 0usize;
    let mut valid_records = 0usize;
    let mut invalid_records = 0usize;
    let mut byte_offset = 0u64;
    let mut line = String::new();

    loop {
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

    Ok(FileScanResult {
        file_path,
        file_name,
        file_size: metadata.len(),
        modified,
        total_lines,
        valid_records,
        invalid_records,
        summaries,
    })
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
fn search_jsonl(file_path: String, query: String) -> Result<Vec<SearchResult>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let file = File::open(&file_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut reader = BufReader::new(file);
    let mut results = Vec::new();
    let mut line = String::new();
    let mut byte_offset = 0u64;
    let mut line_number = 0usize;

    loop {
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
        }
    }

    Ok(results)
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
        provider: summary.provider.clone(),
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
            tool_calls: find_first_key(value, &["tool_calls", "toolCalls"]).cloned(),
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
        .map(normalize_role)
        .unwrap_or_else(|| "unknown".to_string());
    let content_value = value.get("content").or_else(|| value.get("parts"));
    let mut content = Vec::new();

    match content_value {
        Some(Value::String(text)) => content.push(NormalizedContent::Text { text: text.clone() }),
        Some(Value::Array(items)) => {
            for item in items {
                content.extend(normalize_content_part(item));
            }
        }
        Some(other) => content.push(NormalizedContent::Unknown { raw: other.clone() }),
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
    {
        if let Some((mime, data_url, base64)) = normalize_image_string(url) {
            return vec![NormalizedContent::Image {
                mime,
                data_url,
                base64,
            }];
        }
    }

    if value.get("type").and_then(Value::as_str) == Some("tool_call") {
        return vec![NormalizedContent::ToolCall {
            name: value
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string),
            arguments: value.get("arguments").cloned(),
        }];
    }

    if matches!(
        value.get("type").and_then(Value::as_str),
        Some("tool_result") | Some("function_result")
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

fn normalize_role(role: &str) -> String {
    match role {
        "system" | "developer" | "user" | "assistant" | "tool" | "function" => role.to_string(),
        _ => "unknown".to_string(),
    }
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
            ],
        ),
        completion_tokens: first_u64(
            usage,
            &[
                "completion_tokens",
                "completionTokens",
                "output_tokens",
                "outputTokens",
            ],
        ),
        total_tokens: first_u64(usage, &["total_tokens", "totalTokens"]),
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

fn normalize_image_string(value: &str) -> Option<(Option<String>, Option<String>, Option<String>)> {
    if value.starts_with("data:image/") && value.contains(";base64,") {
        let mime = value
            .split(';')
            .next()
            .map(|prefix| prefix.trim_start_matches("data:").to_string());
        let base64 = value
            .split_once(",")
            .map(|(_, encoded)| encoded.to_string());
        return Some((mime, Some(value.to_string()), base64));
    }

    if value.len() < 128 || value.len() > 8 * 1024 * 1024 {
        return None;
    }

    let looks_base64 = value
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || matches!(char, '+' | '/' | '=' | '\n' | '\r'));
    if !looks_base64 {
        return None;
    }

    let compact = value.replace(['\n', '\r'], "");
    let sample_len = compact.len().min(4096);
    let sample = &compact[..sample_len];
    let decoded = general_purpose::STANDARD.decode(sample).ok()?;
    let kind = infer::get(&decoded)?;
    if !kind.mime_type().starts_with("image/") {
        return None;
    }

    Some((
        Some(kind.mime_type().to_string()),
        Some(format!("data:{};base64,{}", kind.mime_type(), compact)),
        Some(compact),
    ))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_file_dialog,
            scan_jsonl,
            read_record,
            search_jsonl
        ])
        .run(tauri::generate_context!())
        .expect("error while running PromptLens");
}
