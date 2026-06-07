---
sidebar_position: 64
title: 自动检测
description: PromptLens 如何自动识别日志文件的来源
---

# 自动检测

PromptLens 可以自动检测哪个代理工具产生了 JSONL 日志文件。`detect_source_from_value()` 函数分析单条记录的 JSON 结构来识别来源。`detect_log_source` 命令将其应用于前 20 行并进行多数投票。

## 检测命令

`detect_log_source` Tauri 命令从文件中读取最多 20 行并对来源进行投票：

```rust
// file: src-tauri/src/commands.rs:457
fn detect_log_source(file_path: String) -> Option<String> {
    let file = match File::open(&file_path) {
        Ok(f) => f,
        Err(_) => return None,
    };
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut votes: HashMap<String, usize> = HashMap::new();

    for _ in 0..20 {
        line.clear();
        if reader.read_line(&mut line).unwrap_or(0) == 0 { break; }
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            if let Some(source) = detect_source_from_value(&value) {
                *votes.entry(source.as_str().to_string()).or_insert(0) += 1;
            }
        }
    }

    votes.into_iter().max_by_key(|(_, count)| *count).map(|(source, _)| source)
}
```

### 投票行为

```mermaid
flowchart TD
    A["Open file"] --> B["Read up to 20 lines"]
    B --> C{"For each non-empty line"}
    C --> D["Parse JSON"]
    D --> E["detect_source_from_value(value)"]
    E --> F{"Source detected?"}
    F -->|Yes| G["Increment vote counter"]
    F -->|No| H["Abstain"]
    G --> I{"More lines?"}
    H --> I
    I -->|Yes| C
    I -->|No| J["Return source with most votes"]
    J --> K{"Any votes?"}
    K -->|Yes| L["Return Some(source)"]
    K -->|No| M["Return None"]
```

- 读取最多 20 个非空行
- 每行投票给一个来源（如果不可识别则弃权）
- 得票最多的来源获胜
- 如果没有检测到来源则返回 `None`

## 检测算法

`detect_source_from_value()` 函数应用多阶段检测树：

```mermaid
flowchart TD
    START["detect_source_from_value(value)"] --> EXPLICIT{"Has explicit provider/source/agent/app?"}
    EXPLICIT -->|"Contains 'claude_code'"| R1["ClaudeCode"]
    EXPLICIT -->|"Contains 'opencode'"| R2["OpenCode"]
    EXPLICIT -->|"Contains 'openclaw'"| R3["OpenClaw"]
    EXPLICIT -->|"Contains 'codex'"| R4["Codex"]
    EXPLICIT -->|Other| STRUCT

    STRUCT["Check structural signals"] --> SID{"Has sessionId<br/>AND message?"}
    SID -->|Yes| R1
    SID -->|No| SIDE{"Has isSidechain?"}
    SIDE -->|Yes| R1
    SIDE -->|No| TYPE{"type = user/assistant/system/<br/>permission-mode/last-prompt/<br/>ai-title/agent-name<br/>AND has content array?"}
    TYPE -->|Yes| R1
    TYPE -->|No| EXEC{"Has exec_command<br/>tool name?"}
    EXEC -->|Yes| R4
    EXEC -->|No| STR{"Recursive string search"}
    STR -->|"Contains 'codex'"| R4
    STR -->|"Contains 'opencode'"| R2
    STR -->|"Contains 'openclaw'"| R3
    STR -->|None| R5["None"]
```

## 阶段 1：显式提供商字段

```rust
// file: src-tauri/src/agent.rs:328
pub(crate) fn detect_source_from_value(value: &Value) -> Option<LogSource> {
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
    // ... 阶段 2
}
```

| 字段值 | 检测到的来源 |
|-------------|----------------|
| `claude_code`、`claude-code` | Claude Code |
| `opencode` | OpenCode |
| `openclaw`、`opwnclaw` | OpenClaw |
| `codex` | Codex |

## 阶段 2：结构信号

### Claude Code 检测

```rust
// file: src-tauri/src/agent.rs:347
let has_session_id = value.get("sessionId").is_some();
let has_message = value.get("message").is_some();
let has_is_sidechain = value.get("isSidechain").is_some();
let has_type_field = value.get("type").and_then(Value::as_str);
let has_content_array = value.get("message")
    .and_then(|m| m.get("content"))
    .and_then(|c| c.as_array())
    .is_some();

if has_is_sidechain || (has_session_id && has_message) {
    return Some(LogSource::ClaudeCode);
}
if matches!(has_type_field, Some("user" | "assistant" | "system"
    | "permission-mode" | "last-prompt" | "ai-title" | "agent-name"))
    && has_content_array
{
    return Some(LogSource::ClaudeCode);
}
```

| 信号 | 描述 |
|--------|-------------|
| `sessionId` + `message` | Claude Code 核心消息结构 |
| `isSidechain` | Claude Code 特有的 sidechain 标志 |
| `type` = 已知类型 + `content` 数组 | 带内容的 Claude Code 记录类型 |

### Codex 检测

```rust
// file: src-tauri/src/agent.rs:378
let has_exec_command = value.get("tool_use")
    .and_then(|t| t.get("name"))
    .and_then(Value::as_str)
    .map(|s| s == "exec_command")
    .unwrap_or(false)
    || value.get("name")
        .and_then(Value::as_str)
        .map(|s| s == "exec_command")
        .unwrap_or(false);

if has_exec_command || value_string_contains(value, "codex") {
    return Some(LogSource::Codex);
}
```

### OpenCode 和 OpenClaw 检测

```rust
// file: src-tauri/src/agent.rs:392
if value_string_contains(value, "opencode") {
    return Some(LogSource::OpenCode);
}
if value_string_contains(value, "openclaw") || value_string_contains(value, "opwnclaw") {
    return Some(LogSource::OpenClaw);
}
```

## 字符串搜索策略

`value_string_contains()` 函数对 JSON 树中的所有字符串值执行递归的不区分大小写搜索：

```rust
// file: src-tauri/src/normalize.rs:626
pub(crate) fn value_string_contains(value: &Value, needle: &str) -> bool {
    match value {
        Value::String(s) => s.to_lowercase().contains(needle),
        Value::Array(items) => items.iter().any(|v| value_string_contains(v, needle)),
        Value::Object(map) => map.values().any(|v| value_string_contains(v, needle)),
        _ => false,
    }
}
```

这避免了仅仅为了搜索子串而将整个 JSON 树序列化为字符串。函数递归遍历所有嵌套对象和数组。

## LogSource 枚举

```rust
// file: src-tauri/src/agent_adapters.rs:24
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LogSource {
    Audit,        // 默认，未检测到代理
    Codex,        // OpenAI Codex
    OpenCode,     // OpenCode
    OpenClaw,     // OpenClaw
    ClaudeCode,   // Anthropic Claude Code
    GenericAgent, // 通用代理格式
}
```

### LogSource 转换

```rust
// file: src-tauri/src/agent_adapters.rs:35
impl LogSource {
    pub(crate) fn from_option(value: Option<String>) -> Self {
        match value.as_deref().unwrap_or("audit").trim().to_lowercase().as_str() {
            "codex" => Self::Codex,
            "opencode" => Self::OpenCode,
            "openclaw" | "opwnclaw" => Self::OpenClaw,
            "claude_code" | "claude-code" | "claudecode" => Self::ClaudeCode,
            "generic_agent" | "generic-agent" | "agent" => Self::GenericAgent,
            _ => Self::Audit,
        }
    }
}
```

| 来源 | `as_str()` | `forced_agent_provider()` |
|--------|-----------|--------------------------|
| `Audit` | `"audit"` | `None` |
| `Codex` | `"codex"` | `Some("codex")` |
| `OpenCode` | `"opencode"` | `Some("opencode")` |
| `OpenClaw` | `"openclaw"` | `Some("openclaw")` |
| `ClaudeCode` | `"claude_code"` | `Some("claude_code")` |
| `GenericAgent` | `"generic_agent"` | `None` |

`forced_agent_provider()` 方法返回应设置在此来源所有事件上的提供商名称，覆盖任何检测到的提供商。

## 用户覆盖

用户可以通过 `log_source` 参数手动指定源类型：

```typescript
await invoke("read_agent_session", {
    filePath: "/path/to/session.jsonl",
    logSource: "claude_code",  // 覆盖自动检测
});
```

## 检测准确率

```mermaid
flowchart LR
    subgraph "Stage 1: Explicit"
        S1["Precision: High<br/>Recall: Low<br/>Only if provider field exists"]
    end

    subgraph "Stage 2: Structural"
        S2["Precision: High<br/>Recall: Medium<br/>Unique patterns like sessionId"]
    end

    subgraph "Stage 3: String Search"
        S3["Precision: Medium<br/>Recall: High<br/>Catches provider names anywhere"]
    end

    subgraph "Voting"
        S4["Accuracy improves<br/>with 20-line sample<br/>Requires consistency"]
    end

    S1 --> S2 --> S3 --> S4
```

| 阶段 | 精确率 | 召回率 | 备注 |
|-------|-----------|--------|-------|
| 显式提供商 | 高 | 低 | 仅在提供商字段存在时有效 |
| 结构信号 | 高 | 中 | 独特模式如 `sessionId` + `message` |
| 字符串搜索 | 中 | 高 | 在任何字段中捕获提供商名称 |

跨 20 行的投票机制通过要求多条记录的一致检测进一步提高了准确率。单条异常行不会覆盖多数共识。
