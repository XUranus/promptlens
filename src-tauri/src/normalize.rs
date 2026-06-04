use crate::adapters::{detect_provider, normalize_role};
use crate::parser::image_detector::normalize_image_string;
use crate::types::*;
use serde_json::Value;

/// Extract the modification timestamp from file metadata as seconds since Unix epoch.
/// Returns `None` if the modification time is unavailable or before the epoch.
pub(crate) fn modified_timestamp(metadata: &std::fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().to_string())
}

pub(crate) fn summary_from_value(
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
        trace_id: first_string(
            value,
            &["trace_id", "traceId", "trace", "traceID", "run_id", "runId"],
        ),
        session_id: first_string(
            value,
            &[
                "session_id",
                "sessionId",
                "conversation_id",
                "conversationId",
                "thread_id",
                "threadId",
            ],
        ),
        request_id: first_string(
            value,
            &[
                "request_id",
                "requestId",
                "call_id",
                "callId",
                "span_id",
                "spanId",
            ],
        ),
        parent_id: first_string(
            value,
            &["parent_id", "parentId", "parent_span_id", "parentSpanId"],
        ),
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

pub(crate) fn normalize_call(value: &Value, summary: &LogSummary) -> NormalizedCall {
    let message_raw = value.get("message").cloned();
    let message_role = message_raw
        .as_ref()
        .and_then(|message| message.get("role"))
        .and_then(Value::as_str)
        .map(normalize_role);
    let request_raw = value.get("request").cloned().or_else(|| {
        matches!(
            message_role.as_deref(),
            Some("user") | Some("system") | Some("developer")
        )
        .then(|| message_raw.clone())
        .flatten()
    });
    let response_raw = value.get("response").cloned().or_else(|| {
        matches!(
            message_role.as_deref(),
            Some("assistant") | Some("tool") | Some("function")
        )
        .then(|| message_raw.clone())
        .flatten()
    });
    let error_raw = value.get("error").cloned().filter(|error| !error.is_null());
    let provider = summary.provider.clone().or_else(|| detect_provider(value));
    let request_messages = request_raw
        .as_ref()
        .and_then(extract_messages)
        .or_else(|| {
            message_raw
                .as_ref()
                .filter(|_| {
                    matches!(
                        message_role.as_deref(),
                        Some("user") | Some("system") | Some("developer")
                    )
                })
                .and_then(normalize_message)
                .map(|message| vec![message])
        })
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
        trace_id: summary.trace_id.clone(),
        session_id: summary.session_id.clone(),
        request_id: summary.request_id.clone(),
        parent_id: summary.parent_id.clone(),
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
    if let Some(message) = value
        .get("message")
        .and_then(normalize_message)
        .filter(|message| matches!(message.role.as_str(), "assistant" | "tool" | "function"))
    {
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

pub(crate) fn normalize_message(value: &Value) -> Option<NormalizedMessage> {
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

pub(crate) fn normalize_content_part(value: &Value) -> Vec<NormalizedContent> {
    if let Value::String(text) = value {
        if let Some((mime, data_url, base64)) = normalize_image_string(text) {
            return vec![NormalizedContent::Image {
                mime,
                data_url,
                base64,
            }];
        }
        return vec![NormalizedContent::Text { text: text.clone() }];
    }

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

    let mut content = Vec::new();

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
            content.push(NormalizedContent::Image {
                mime,
                data_url,
                base64,
            });
        }
    }

    if let Some(text) = value
        .get("text")
        .or_else(|| value.get("content"))
        .and_then(Value::as_str)
    {
        if let Some((mime, data_url, base64)) = normalize_image_string(text) {
            content.push(NormalizedContent::Image {
                mime,
                data_url,
                base64,
            });
        } else {
            content.push(NormalizedContent::Text {
                text: text.to_string(),
            });
        }
    }

    if !content.is_empty() {
        return content;
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

pub(crate) fn find_preview(value: &Value) -> Option<String> {
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

pub(crate) fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| find_first_key(value, &[*key]))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(crate) fn first_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| find_first_key(value, &[*key]))
        .and_then(|found| found.as_u64().or_else(|| found.as_f64().map(|n| n as u64)))
}

pub(crate) fn find_first_key<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
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

pub(crate) fn contains_key(value: &Value, keys: &[&str]) -> bool {
    find_first_key(value, keys).is_some()
}

pub(crate) fn contains_image(value: &Value) -> bool {
    match value {
        Value::String(text) => normalize_image_string(text).is_some(),
        Value::Array(items) => items.iter().any(contains_image),
        Value::Object(map) => map.iter().any(|(key, child)| {
            let key = key.to_lowercase();
            ((key.contains("image") || key.contains("screenshot") || key.contains("base64"))
                && child.as_str().and_then(normalize_image_string).is_some())
                || contains_image(child)
        }),
        _ => false,
    }
}

/// Recursively check if any string value in a JSON tree contains `needle` (case-insensitive).
/// This avoids serializing the entire JSON tree to a string just to search for a substring.
pub(crate) fn value_string_contains(value: &Value, needle: &str) -> bool {
    match value {
        Value::String(s) => s.to_lowercase().contains(needle),
        Value::Array(items) => items.iter().any(|v| value_string_contains(v, needle)),
        Value::Object(map) => map.values().any(|v| value_string_contains(v, needle)),
        _ => false,
    }
}

/// Build a `LogSummary` for a line that failed JSON parsing.
pub(crate) fn invalid_line_summary(
    line_number: usize,
    byte_offset: u64,
    trimmed: &str,
    err: &serde_json::Error,
) -> LogSummary {
    LogSummary {
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
    }
}
