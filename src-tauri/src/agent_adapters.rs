use serde_json::Value;

use crate::{
    agent_command, agent_file_paths, agent_role, agent_text, agent_text_from_content, contains_key,
    first_string,
};

#[derive(Debug, Default)]
pub(crate) struct AgentEventAdapterFields {
    pub(crate) role: Option<String>,
    pub(crate) tool_name: Option<String>,
    pub(crate) command: Option<String>,
    pub(crate) file_paths: Vec<String>,
    pub(crate) text: Option<String>,
    pub(crate) event_type: Option<String>,
    pub(crate) status: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LogSource {
    Audit,
    Codex,
    OpenCode,
    OpenClaw,
    ClaudeCode,
    GenericAgent,
}

impl LogSource {
    pub(crate) fn from_option(value: Option<String>) -> Self {
        match value
            .as_deref()
            .unwrap_or("audit")
            .trim()
            .to_lowercase()
            .as_str()
        {
            "codex" => Self::Codex,
            "opencode" => Self::OpenCode,
            "openclaw" | "opwnclaw" => Self::OpenClaw,
            "claude_code" | "claude-code" | "claudecode" => Self::ClaudeCode,
            "generic_agent" | "generic-agent" | "agent" => Self::GenericAgent,
            _ => Self::Audit,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Audit => "audit",
            Self::Codex => "codex",
            Self::OpenCode => "opencode",
            Self::OpenClaw => "openclaw",
            Self::ClaudeCode => "claude_code",
            Self::GenericAgent => "generic_agent",
        }
    }

    pub(crate) fn forced_agent_provider(self) -> Option<&'static str> {
        match self {
            Self::Audit | Self::GenericAgent => None,
            Self::Codex => Some("codex"),
            Self::OpenCode => Some("opencode"),
            Self::OpenClaw => Some("openclaw"),
            Self::ClaudeCode => Some("claude_code"),
        }
    }
}

pub(crate) fn adapt_agent_event(value: &Value, source: LogSource) -> AgentEventAdapterFields {
    let mut fields = match source {
        LogSource::Codex => adapt_codex_event(value),
        LogSource::ClaudeCode => adapt_claude_code_event(value),
        LogSource::OpenCode => adapt_opencode_event(value),
        LogSource::OpenClaw => adapt_openclaw_event(value),
        LogSource::Audit | LogSource::GenericAgent => AgentEventAdapterFields::default(),
    };
    normalize_adapter_fields(&mut fields);
    fields
}

fn normalize_adapter_fields(fields: &mut AgentEventAdapterFields) {
    fields.file_paths.sort();
    fields.file_paths.dedup();
    fields.file_paths.truncate(16);
}

fn adapt_codex_event(value: &Value) -> AgentEventAdapterFields {
    let mut fields = AgentEventAdapterFields::default();
    let payload = agent_payload(value);
    let lowered_type = agent_record_type(payload);

    fields.role = agent_role(payload).or_else(|| agent_role(value));
    fields.text = agent_text(payload).or_else(|| agent_text(value));
    fields.status = first_string(payload, &["status", "state"]);

    if let Some(message) = payload.get("message").and_then(Value::as_str) {
        fields.text = Some(message.to_string());
    }
    if let Some(tool) = first_string(payload, &["tool_name", "toolName", "name", "tool"]) {
        fields.tool_name = Some(tool);
    }
    if let Some(arguments) = payload.get("arguments") {
        if let Some(parsed) = parse_maybe_json(arguments) {
            fields.command = agent_command(&parsed);
            fields.file_paths = agent_file_paths(&parsed);
        }
    }
    if fields.command.is_none() {
        fields.command = agent_command(payload).or_else(|| agent_command(value));
    }
    if fields.file_paths.is_empty() {
        fields.file_paths = agent_file_paths(payload);
    }

    fields.event_type = match lowered_type.as_str() {
        "message" => fields.role.as_deref().map(|role| match role {
            "user" => "user_message".to_string(),
            "assistant" => "assistant_message".to_string(),
            "system" | "developer" => "system".to_string(),
            _ => "unknown".to_string(),
        }),
        "user_message" => Some("user_message".to_string()),
        "agent_message" => Some("assistant_message".to_string()),
        "reasoning" => Some("reasoning".to_string()),
        "function_call_output" | "custom_tool_call_output" => Some("tool_result".to_string()),
        "patch_apply_end" => Some("patch".to_string()),
        "function_call" | "custom_tool_call" => {
            if fields.command.is_some() || fields.tool_name.as_deref().is_some_and(is_shell_tool) {
                Some("shell_command".to_string())
            } else if fields.tool_name.as_deref().is_some_and(is_file_tool)
                || !fields.file_paths.is_empty()
            {
                file_event_type_from_tool(fields.tool_name.as_deref())
            } else {
                Some("tool_call".to_string())
            }
        }
        "task_started" | "task_complete" | "turn_aborted" | "context_compacted" => {
            Some("checkpoint".to_string())
        }
        _ if lowered_type.contains("checkpoint") || lowered_type.contains("snapshot") => {
            Some("checkpoint".to_string())
        }
        _ if lowered_type.contains("reason") || lowered_type.contains("thinking") => {
            Some("reasoning".to_string())
        }
        _ if lowered_type.contains("patch") || contains_key(payload, &["patch", "diff"]) => {
            Some("patch".to_string())
        }
        _ => None,
    };

    if let Some(command) = fields.command.clone() {
        fields.command = Some(command);
        fields.event_type.get_or_insert("shell_command".to_string());
    }
    if !fields.file_paths.is_empty() && fields.event_type.is_none() {
        fields.event_type = file_event_type_from_tool(fields.tool_name.as_deref());
    }
    fields
}

fn adapt_claude_code_event(value: &Value) -> AgentEventAdapterFields {
    let mut fields = AgentEventAdapterFields::default();
    let lowered_type = agent_record_type(value);
    if lowered_type == "file-history-snapshot" {
        fields.event_type = Some("checkpoint".to_string());
        return fields;
    }
    if lowered_type == "queue-operation" {
        fields.event_type = Some("checkpoint".to_string());
        fields.status = first_string(value, &["operation"]);
        return fields;
    }
    if lowered_type == "system" {
        fields.event_type = Some("system".to_string());
        fields.status = first_string(value, &["subtype", "level"]);
        return fields;
    }
    fields.role = agent_role(value);
    fields.text = agent_text(value);
    if let Some(message) = value.get("message") {
        if let Some(content) = message.get("content").and_then(Value::as_array) {
            for part in content {
                let part_type = part
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_lowercase();
                if part_type == "tool_use" {
                    fields.tool_name = part.get("name").and_then(Value::as_str).map(str::to_string);
                    if let Some(input) = part.get("input") {
                        fields.command = first_string(input, &["command", "cmd"]);
                        fields.file_paths = agent_file_paths(input);
                    }
                    fields.event_type = match fields.tool_name.as_deref() {
                        Some(tool) if is_shell_tool(tool) || fields.command.is_some() => {
                            Some("shell_command".to_string())
                        }
                        Some(tool) if is_file_tool(tool) || !fields.file_paths.is_empty() => {
                            file_event_type_from_tool(Some(tool))
                        }
                        _ => Some("tool_call".to_string()),
                    };
                    break;
                }
                if part_type == "tool_result" {
                    fields.event_type = Some("tool_result".to_string());
                    fields.text = agent_text_from_content(part);
                    break;
                }
                if part_type == "thinking" {
                    fields.event_type = Some("reasoning".to_string());
                    fields.text = part
                        .get("thinking")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .or_else(|| agent_text_from_content(part));
                    break;
                }
            }
        }
    }
    fields
}

fn adapt_opencode_event(value: &Value) -> AgentEventAdapterFields {
    let mut fields = AgentEventAdapterFields::default();
    let part = value
        .get("part")
        .or_else(|| value.get("payload"))
        .unwrap_or(value);
    let lowered_type = agent_record_type(part);
    fields.role = agent_role(value).or_else(|| agent_role(part));
    fields.tool_name = first_string(part, &["tool", "tool_name", "toolName", "name"]);
    fields.command = agent_command(part);
    fields.file_paths = agent_file_paths(part);
    fields.text = agent_text(part).or_else(|| agent_text(value));
    fields.status = first_string(part, &["state", "status"]);

    fields.event_type = if lowered_type.contains("snapshot") || lowered_type.contains("checkpoint")
    {
        Some("checkpoint".to_string())
    } else if lowered_type.contains("reason") || lowered_type.contains("thinking") {
        Some("reasoning".to_string())
    } else if lowered_type.contains("tool") && lowered_type.contains("result") {
        Some("tool_result".to_string())
    } else if fields.command.is_some() || fields.tool_name.as_deref().is_some_and(is_shell_tool) {
        Some("shell_command".to_string())
    } else if !fields.file_paths.is_empty() || fields.tool_name.as_deref().is_some_and(is_file_tool)
    {
        file_event_type_from_tool(fields.tool_name.as_deref())
    } else if lowered_type.contains("tool") {
        Some("tool_call".to_string())
    } else {
        None
    };
    fields
}

fn adapt_openclaw_event(value: &Value) -> AgentEventAdapterFields {
    let mut fields = AgentEventAdapterFields::default();
    let action = value
        .get("action")
        .or_else(|| value.get("event"))
        .unwrap_or(value);
    let lowered_type = agent_record_type(action);
    fields.role = agent_role(value).or_else(|| agent_role(action));
    fields.tool_name = first_string(action, &["tool", "tool_name", "toolName", "name", "kind"]);
    fields.command = agent_command(action);
    fields.file_paths = agent_file_paths(action);
    fields.text = agent_text(action).or_else(|| agent_text(value));
    fields.status = first_string(action, &["status", "state"]);

    fields.event_type = if lowered_type.contains("checkpoint") {
        Some("checkpoint".to_string())
    } else if lowered_type.contains("patch") || contains_key(action, &["patch", "diff"]) {
        Some("patch".to_string())
    } else if lowered_type.contains("result") || lowered_type.contains("observation") {
        Some("tool_result".to_string())
    } else if fields.command.is_some() || fields.tool_name.as_deref().is_some_and(is_shell_tool) {
        Some("shell_command".to_string())
    } else if !fields.file_paths.is_empty() || fields.tool_name.as_deref().is_some_and(is_file_tool)
    {
        file_event_type_from_tool(fields.tool_name.as_deref())
    } else {
        None
    };
    fields
}

fn agent_payload(value: &Value) -> &Value {
    value
        .get("payload")
        .filter(|payload| payload.is_object())
        .unwrap_or(value)
}

fn parse_maybe_json(value: &Value) -> Option<Value> {
    match value {
        Value::String(text) => serde_json::from_str(text).ok(),
        Value::Object(_) | Value::Array(_) => Some(value.clone()),
        _ => None,
    }
}

fn agent_record_type(value: &Value) -> String {
    first_string(value, &["type", "event_type", "eventType", "event", "kind"])
        .unwrap_or_default()
        .to_lowercase()
}

pub(crate) fn file_event_type_from_tool(tool_name: Option<&str>) -> Option<String> {
    let lowered = tool_name.unwrap_or_default().to_lowercase();
    if lowered.contains("read") {
        Some("file_read".to_string())
    } else if lowered.contains("write") || lowered.contains("create") {
        Some("file_write".to_string())
    } else if lowered.contains("patch") || lowered.contains("edit") {
        Some("patch".to_string())
    } else {
        Some("file_edit".to_string())
    }
}

pub(crate) fn is_shell_tool(tool_name: &str) -> bool {
    let lowered = tool_name.to_lowercase();
    lowered.contains("bash")
        || lowered.contains("shell")
        || lowered.contains("terminal")
        || lowered.contains("exec")
        || lowered.contains("command")
}

pub(crate) fn is_file_tool(tool_name: &str) -> bool {
    let lowered = tool_name.to_lowercase();
    lowered.contains("edit")
        || lowered.contains("patch")
        || lowered.contains("write")
        || lowered.contains("read")
        || lowered.contains("file")
}
