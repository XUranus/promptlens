use crate::adapters::{detect_provider, normalize_role};
use crate::agent_adapters::{
    adapt_agent_event, file_event_type_from_tool, is_file_tool, is_shell_tool, LogSource,
};
use crate::normalize::{contains_key, find_first_key, find_preview, first_string, first_u64};
use crate::types::*;
use serde_json::Value;

pub(crate) fn agent_event_from_value(
    value: Value,
    line_number: usize,
    byte_offset: u64,
    source: LogSource,
) -> AgentEvent {
    let timestamp = first_string(
        &value,
        &["timestamp", "created_at", "createdAt", "time", "ts", "date"],
    );
    let session_id = first_string(
        &value,
        &[
            "session_id",
            "sessionId",
            "conversation_id",
            "conversationId",
            "thread_id",
            "threadId",
            "chat_id",
            "chatId",
        ],
    );
    let turn_id = first_string(
        &value,
        &[
            "turn_id",
            "turnId",
            "request_id",
            "requestId",
            "message_id",
            "messageId",
            "id",
            "uuid",
        ],
    );
    let parent_id = first_string(
        &value,
        &[
            "parent_id",
            "parentId",
            "parent_uuid",
            "parentUuid",
            "parent_message_id",
            "parentMessageId",
        ],
    );
    let adapter_fields = adapt_agent_event(&value, source);
    let role = adapter_fields.role.or_else(|| agent_role(&value));
    let tool_name = adapter_fields.tool_name.or_else(|| agent_tool_name(&value));
    let tool_use_id = adapter_fields.tool_use_id.or_else(|| {
        first_string(
            &value,
            &["tool_use_id", "toolUseId", "tool_call_id", "toolCallId"],
        )
    });
    let command = adapter_fields.command.or_else(|| agent_command(&value));
    let text = adapter_fields.text.or_else(|| agent_text(&value));
    let file_paths = if adapter_fields.file_paths.is_empty() {
        agent_file_paths(&value)
    } else {
        adapter_fields.file_paths
    };
    let status = adapter_fields
        .status
        .or_else(|| first_string(&value, &["status", "state", "outcome"]));
    let duration_ms = first_u64(
        &value,
        &["duration_ms", "durationMs", "elapsed_ms", "elapsedMs"],
    );
    let provider = source
        .forced_agent_provider()
        .map(str::to_string)
        .or_else(|| agent_provider(&value));
    let model = first_string(&value, &["model", "model_name", "modelName"]).or_else(|| {
        value
            .get("message")
            .and_then(|m| first_string(m, &["model", "model_name", "modelName"]))
    });
    let usage = value
        .get("usage")
        .or_else(|| value.get("message").and_then(|m| m.get("usage")));
    let input_tokens = usage.and_then(|u| {
        first_u64(
            u,
            &[
                "input_tokens",
                "inputTokens",
                "prompt_tokens",
                "promptTokens",
            ],
        )
    });
    let output_tokens = usage.and_then(|u| {
        first_u64(
            u,
            &[
                "output_tokens",
                "outputTokens",
                "completion_tokens",
                "completionTokens",
            ],
        )
    });
    let is_sidechain = value
        .get("isSidechain")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let agent_id = first_string(&value, &["agentId", "agent_id"]);
    let tool_result_content = value.get("toolUseResult").cloned();
    let is_error = adapter_fields.is_error
        || value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    .any(|p| p.get("is_error").and_then(Value::as_bool).unwrap_or(false))
            })
            .unwrap_or(false);
    let event_type = adapter_fields.event_type.unwrap_or_else(|| {
        detect_agent_event_type(
            &value,
            role.as_deref(),
            tool_name.as_deref(),
            command.as_deref(),
            &file_paths,
        )
    });
    let preview = text
        .clone()
        .or_else(|| command.clone())
        .or_else(|| tool_name.clone())
        .or_else(|| file_paths.first().cloned())
        .or_else(|| find_preview(&value))
        .map(|preview| {
            preview
                .chars()
                .take(240)
                .collect::<String>()
                .replace('\n', " ")
        });
    let id = turn_id
        .clone()
        .unwrap_or_else(|| format!("agent-line-{line_number}-{byte_offset}"));

    AgentEvent {
        id,
        line_number,
        byte_offset,
        timestamp,
        session_id,
        turn_id,
        parent_id,
        role,
        event_type,
        provider,
        model,
        tool_name,
        tool_use_id,
        subagent_type: adapter_fields.subagent_type,
        subagent_description: adapter_fields.subagent_description,
        subagent_prompt: adapter_fields.subagent_prompt,
        command,
        file_paths,
        status,
        duration_ms,
        input_tokens,
        output_tokens,
        is_error,
        tool_result_content,
        is_sidechain,
        agent_id,
        preview,
        text,
        raw: value,
    }
}

pub(crate) fn detect_agent_event_type(
    value: &Value,
    role: Option<&str>,
    tool_name: Option<&str>,
    command: Option<&str>,
    file_paths: &[String],
) -> String {
    if value.get("parse_error").is_some()
        || value
            .get("error")
            .is_some_and(|error| !error.is_null() && error != "")
    {
        return "error".to_string();
    }

    let lowered_type = first_string(value, &["type", "event", "kind", "event_type", "eventType"])
        .unwrap_or_default()
        .to_lowercase();
    if lowered_type.contains("checkpoint") || lowered_type.contains("snapshot") {
        return "checkpoint".to_string();
    }
    if lowered_type.contains("tool_result")
        || lowered_type.contains("tool_result_delta")
        || lowered_type.contains("function_result")
        || matches!(role, Some("tool") | Some("function"))
    {
        return "tool_result".to_string();
    }
    if lowered_type.contains("tool")
        || lowered_type.contains("function_call")
        || tool_name.is_some()
        || contains_key(value, &["tool_calls", "toolCalls", "tool_use", "toolUse"])
    {
        if command.is_some() || tool_name.is_some_and(is_shell_tool) {
            return "shell_command".to_string();
        }
        if !file_paths.is_empty() || tool_name.is_some_and(is_file_tool) {
            return file_event_type_from_tool(tool_name).unwrap_or_else(|| "file_edit".to_string());
        }
        return "tool_call".to_string();
    }
    if lowered_type.contains("command") || command.is_some() {
        return "shell_command".to_string();
    }
    if lowered_type.contains("patch") {
        return "patch".to_string();
    }
    if lowered_type.contains("read") && !file_paths.is_empty() {
        return "file_read".to_string();
    }
    if lowered_type.contains("write") && !file_paths.is_empty() {
        return "file_write".to_string();
    }
    if lowered_type.contains("edit")
        || lowered_type.contains("patch")
        || lowered_type.contains("file")
    {
        return "file_edit".to_string();
    }
    if lowered_type.contains("reason") || lowered_type.contains("thinking") {
        return "reasoning".to_string();
    }
    if lowered_type.contains("plan") {
        return "plan_update".to_string();
    }
    match role {
        Some("user") => "user_message".to_string(),
        Some("assistant") => "assistant_message".to_string(),
        Some("system") | Some("developer") => "system".to_string(),
        _ => "unknown".to_string(),
    }
}

pub(crate) fn agent_role(value: &Value) -> Option<String> {
    if let Some(role) = value
        .get("message")
        .and_then(|message| message.get("role"))
        .and_then(Value::as_str)
        .or_else(|| value.get("role").and_then(Value::as_str))
        .or_else(|| value.get("speaker").and_then(Value::as_str))
        .or_else(|| value.get("author").and_then(Value::as_str))
        .or_else(|| {
            value
                .get("author")
                .and_then(|author| author.get("role"))
                .and_then(Value::as_str)
        })
        .or_else(|| value.get("type").and_then(Value::as_str))
    {
        let normalized = normalize_role(role);
        if normalized != "unknown" {
            return Some(normalized);
        }
    }
    None
}

fn agent_provider(value: &Value) -> Option<String> {
    first_string(value, &["provider", "source", "agent", "app"])
        .map(|provider| provider.to_lowercase())
        .or_else(|| {
            let raw = value.to_string().to_lowercase();
            if raw.contains("claude_code") || raw.contains("claude-code") {
                Some("claude_code".to_string())
            } else if raw.contains("opencode") {
                Some("opencode".to_string())
            } else if raw.contains("openclaw") || raw.contains("opwnclaw") {
                Some("openclaw".to_string())
            } else if raw.contains("\"codex\"") || raw.contains("exec_command") {
                Some("codex".to_string())
            } else if value.get("sessionId").is_some() && value.get("message").is_some() {
                Some("claude_code".to_string())
            } else {
                detect_provider(value)
            }
        })
}

pub(crate) fn detect_source_from_value(value: &Value) -> Option<LogSource> {
    // Check explicit provider/source/agent/app keys
    if let Some(provider) = first_string(value, &["provider", "source", "agent", "app"]) {
        let lower = provider.to_lowercase();
        if lower.contains("claude_code") || lower.contains("claude-code") {
            return Some(LogSource::ClaudeCode);
        }
        if lower.contains("opencode") {
            return Some(LogSource::OpenCode);
        }
        if lower.contains("openclaw") || lower.contains("opwnclaw") {
            return Some(LogSource::OpenClaw);
        }
        if lower.contains("codex") {
            return Some(LogSource::Codex);
        }
    }

    // Check structural signals
    let has_session_id = value.get("sessionId").is_some();
    let has_message = value.get("message").is_some();
    let has_is_sidechain = value.get("isSidechain").is_some();
    let has_type_field = value.get("type").and_then(Value::as_str);
    let has_content_array = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
        .is_some();

    // Claude Code: sessionId + message, or isSidechain, or type=user/assistant with message.content
    if has_is_sidechain || (has_session_id && has_message) {
        return Some(LogSource::ClaudeCode);
    }
    if matches!(
        has_type_field,
        Some(
            "user"
                | "assistant"
                | "system"
                | "permission-mode"
                | "last-prompt"
                | "ai-title"
                | "agent-name"
        )
    ) && has_content_array
    {
        return Some(LogSource::ClaudeCode);
    }

    // Raw string matching for other sources
    let raw = value.to_string().to_lowercase();
    if raw.contains("exec_command") || raw.contains("\"codex\"") {
        return Some(LogSource::Codex);
    }
    if raw.contains("opencode") {
        return Some(LogSource::OpenCode);
    }
    if raw.contains("openclaw") || raw.contains("opwnclaw") {
        return Some(LogSource::OpenClaw);
    }

    None
}

fn agent_tool_name(value: &Value) -> Option<String> {
    first_string(
        value,
        &[
            "tool_name",
            "toolName",
            "tool",
            "name",
            "function_name",
            "functionName",
        ],
    )
    .or_else(|| {
        value
            .get("function")
            .and_then(|function| function.get("name"))
            .and_then(Value::as_str)
            .map(str::to_string)
    })
    .or_else(|| {
        value
            .get("message")
            .and_then(|message| message.get("tool_calls"))
            .or_else(|| value.get("tool_calls"))
            .and_then(Value::as_array)
            .and_then(|calls| calls.first())
            .and_then(|call| {
                call.get("function")
                    .and_then(|function| function.get("name"))
                    .or_else(|| call.get("name"))
            })
            .and_then(Value::as_str)
            .map(str::to_string)
    })
    .or_else(|| {
        value
            .get("toolUse")
            .or_else(|| value.get("tool_use"))
            .and_then(|tool| tool.get("name"))
            .and_then(Value::as_str)
            .map(str::to_string)
    })
}

pub(crate) fn agent_command(value: &Value) -> Option<String> {
    first_string(
        value,
        &[
            "command",
            "cmd",
            "shell_command",
            "shellCommand",
            "bash",
            "script",
        ],
    )
    .or_else(|| {
        find_first_key(
            value,
            &[
                "arguments",
                "args",
                "input",
                "parameters",
                "tool_input",
                "toolInput",
            ],
        )
        .and_then(|input| first_string(input, &["cmd", "command", "shell_command", "shellCommand"]))
    })
}

pub(crate) fn agent_text(value: &Value) -> Option<String> {
    if let Some(message) = value.get("message") {
        if let Some(text) = message.get("content").and_then(agent_text_from_content) {
            return Some(text);
        }
    }
    for key in [
        "content",
        "text",
        "delta",
        "output",
        "result",
        "summary",
        "reasoning",
        "thinking",
        "assistant_response",
        "assistantResponse",
    ] {
        if let Some(text) = value.get(key).and_then(agent_text_from_content) {
            return Some(text);
        }
    }
    None
}

pub(crate) fn agent_text_from_content(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(agent_text_from_content)
                .collect::<Vec<_>>();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        Value::Object(map) => map
            .get("text")
            .or_else(|| map.get("content"))
            .or_else(|| map.get("message"))
            .or_else(|| map.get("result"))
            .and_then(agent_text_from_content),
        _ => None,
    }
}

pub(crate) fn agent_file_paths(value: &Value) -> Vec<String> {
    let mut paths = Vec::new();
    collect_agent_file_paths(value, None, &mut paths);
    paths.sort();
    paths.dedup();
    paths.truncate(16);
    paths
}

fn collect_agent_file_paths(value: &Value, key_hint: Option<&str>, paths: &mut Vec<String>) {
    if paths.len() >= 32 {
        return;
    }
    match value {
        Value::String(text) => {
            if key_hint.is_some_and(is_file_path_key) && looks_like_file_path(text) {
                paths.push(text.to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_agent_file_paths(item, key_hint, paths);
            }
        }
        Value::Object(map) => {
            for (key, child) in map {
                collect_agent_file_paths(child, Some(key), paths);
            }
        }
        _ => {}
    }
}

fn is_file_path_key(key: &str) -> bool {
    matches!(
        key,
        "path"
            | "file"
            | "files"
            | "file_path"
            | "filePath"
            | "filepath"
            | "target_file"
            | "targetFile"
            | "absolute_path"
            | "absolutePath"
    )
}

fn looks_like_file_path(value: &str) -> bool {
    if value.starts_with("http://") || value.starts_with("https://") || value.starts_with("data:") {
        return false;
    }
    value.starts_with('/')
        || value.starts_with("./")
        || value.starts_with("../")
        || value.contains('\\')
        || value
            .rsplit('/')
            .next()
            .is_some_and(|name| name.contains('.'))
}
