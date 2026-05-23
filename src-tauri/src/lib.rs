mod adapters;
mod agent;
mod agent_adapters;
mod analytics;
mod cache;
mod commands;
mod export;
mod normalize;
mod parser;
mod pricing;
mod scanner;
mod search;
mod types;
mod watcher;

pub use commands::run;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_adapters::LogSource;
    use crate::cache::read_agent_session_cache;
    use crate::normalize::{contains_image, normalize_call, summary_from_value};
    use crate::scanner::{scan_jsonl_incremental, scan_jsonl_inner};
    use crate::search::search_jsonl_inner;
    use crate::types::*;
    use serde_json::json;
    use serde_json::Value;
    use std::fs;
    use std::io::Write;
    use std::sync::Mutex;
    use tempfile::NamedTempFile;

    static TEST_CACHE_ENV: Mutex<()> = Mutex::new(());

    #[test]
    fn scan_jsonl_tracks_offsets_and_invalid_lines() {
        let _guard = TEST_CACHE_ENV.lock().unwrap();
        let mut file = NamedTempFile::new().expect("temp file");
        let cache_file = NamedTempFile::new().expect("cache file");
        std::env::set_var("PROMPTLENS_CACHE_PATH", cache_file.path());
        writeln!(
            file,
            "{}",
            json!({
                "id": "call_1",
                "timestamp": "2026-05-13T10:00:00Z",
                "provider": "openai",
                "model": "gpt-4.1",
                "trace_id": "trace-1",
                "conversation_id": "session-1",
                "request_id": "request-1",
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
        assert_eq!(result.summaries[0].trace_id.as_deref(), Some("trace-1"));
        assert_eq!(result.summaries[0].session_id.as_deref(), Some("session-1"));
        assert_eq!(result.summaries[0].request_id.as_deref(), Some("request-1"));
        assert_eq!(result.summaries[1].status, "invalid_json");
        assert!(result.summaries[1].byte_offset > 0);
        std::env::remove_var("PROMPTLENS_CACHE_PATH");
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
    fn normalizes_mixed_text_and_image_content() {
        let image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
        let value = json!({
            "message": {
                "role": "user",
                "content": [
                    {"type": "text", "text": "inspect this"},
                    {"type": "image_url", "image_url": {"url": image}}
                ]
            }
        });
        let normalized = normalize_call(&value, &summary_from_value(&value, 1, 0, None));
        let content = &normalized.request.unwrap().messages.unwrap()[0].content;
        assert!(matches!(content[0], NormalizedContent::Text { .. }));
        assert!(matches!(content[1], NormalizedContent::Image { .. }));
        let serialized = serde_json::to_value(&content[1]).unwrap();
        assert!(serialized.get("dataUrl").is_some());
        assert!(serialized.get("data_url").is_none());
    }

    #[test]
    fn normalizes_claude_code_session_messages() {
        let user = json!({
            "type": "user",
            "sessionId": "session-1",
            "message": {"role": "user", "content": [{"type": "text", "text": "hello"}]}
        });
        let assistant = json!({
            "type": "assistant",
            "sessionId": "session-1",
            "message": {"role": "assistant", "content": [{"type": "text", "text": "world"}]}
        });
        let user_normalized = normalize_call(&user, &summary_from_value(&user, 1, 0, None));
        let assistant_normalized =
            normalize_call(&assistant, &summary_from_value(&assistant, 2, 10, None));
        assert!(user_normalized.request.unwrap().raw.is_some());
        assert!(user_normalized.response.unwrap().messages.is_none());
        let assistant_response = assistant_normalized.response.unwrap();
        assert!(assistant_response.raw.is_some());
        assert_eq!(assistant_response.messages.unwrap()[0].role, "assistant");
    }

    #[test]
    fn parses_agent_session_events() {
        let mut file = NamedTempFile::new().expect("temp file");
        writeln!(
            file,
            "{}",
            json!({
                "type": "user",
                "sessionId": "agent-session-1",
                "message": {"role": "user", "content": [{"type": "text", "text": "open the file"}]}
            })
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            json!({
                "type": "assistant",
                "sessionId": "agent-session-1",
                "message": {"role": "assistant", "content": [{"type": "text", "text": "I'll inspect it."}]}
            })
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            json!({
                "type": "tool_call",
                "sessionId": "agent-session-1",
                "name": "exec_command",
                "input": {"cmd": "sed -n '1,20p' src/app/App.tsx"}
            })
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            json!({
                "type": "tool_call",
                "sessionId": "agent-session-1",
                "name": "apply_patch",
                "input": {"target_file": "src/app/App.tsx"}
            })
        )
        .unwrap();

        let result = commands::read_agent_session(
            file.path().to_string_lossy().to_string(),
            Some("codex".to_string()),
        )
        .unwrap();

        assert_eq!(result.total_events, 4);
        assert_eq!(result.source, "codex");
        assert_eq!(result.sessions, vec!["agent-session-1"]);
        assert_eq!(result.events[0].provider.as_deref(), Some("codex"));
        assert_eq!(result.events[0].event_type, "user_message");
        assert_eq!(result.events[1].event_type, "assistant_message");
        assert_eq!(result.events[2].event_type, "shell_command");
        assert_eq!(
            result.events[2].command.as_deref(),
            Some("sed -n '1,20p' src/app/App.tsx")
        );
        assert_eq!(result.events[3].event_type, "patch");
        assert_eq!(result.events[3].file_paths, vec!["src/app/App.tsx"]);
    }

    #[test]
    fn codex_adapter_classifies_reasoning_patch_and_checkpoint() {
        let mut file = NamedTempFile::new().expect("temp file");
        writeln!(
            file,
            "{}",
            json!({"type": "reasoning", "summary": "Need inspect project"})
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            json!({"type": "patch", "tool_name": "apply_patch", "diff": "--- a/src/app.tsx", "path": "src/app.tsx"})
        )
        .unwrap();
        writeln!(file, "{}", json!({"type": "checkpoint", "id": "ckpt-1"})).unwrap();

        let result = commands::read_agent_session(
            file.path().to_string_lossy().to_string(),
            Some("codex".to_string()),
        )
        .unwrap();

        assert_eq!(result.events[0].event_type, "reasoning");
        assert_eq!(result.events[1].event_type, "patch");
        assert_eq!(result.events[1].file_paths, vec!["src/app.tsx"]);
        assert_eq!(result.events[2].event_type, "checkpoint");
    }

    #[test]
    fn claude_code_adapter_classifies_tool_use_and_result_parts() {
        let mut file = NamedTempFile::new().expect("temp file");
        writeln!(
            file,
            "{}",
            json!({
                "type": "assistant",
                "sessionId": "claude-1",
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "name": "Bash",
                        "input": {"command": "npm test"}
                    }]
                }
            })
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            json!({
                "type": "user",
                "sessionId": "claude-1",
                "message": {
                    "role": "user",
                    "content": [{"type": "tool_result", "content": "tests passed"}]
                }
            })
        )
        .unwrap();

        let result = commands::read_agent_session(
            file.path().to_string_lossy().to_string(),
            Some("claude_code".to_string()),
        )
        .unwrap();

        assert_eq!(result.events[0].event_type, "shell_command");
        assert_eq!(result.events[0].command.as_deref(), Some("npm test"));
        assert_eq!(result.events[1].event_type, "tool_result");
        assert_eq!(result.events[1].text.as_deref(), Some("tests passed"));
    }

    #[test]
    fn claude_code_adapter_links_task_subagent_call_and_result() {
        let mut file = NamedTempFile::new().expect("temp file");
        writeln!(
            file,
            "{}",
            json!({
                "type": "assistant",
                "sessionId": "claude-1",
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": "toolu_subagent_1",
                        "name": "Task",
                        "input": {
                            "subagent_type": "explorer",
                            "description": "Inspect session parser",
                            "prompt": "Find where Claude sessions are parsed."
                        }
                    }]
                }
            })
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            json!({
                "type": "user",
                "sessionId": "claude-1",
                "message": {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": "toolu_subagent_1",
                        "content": "Parser lives in src-tauri/src/lib.rs"
                    }]
                }
            })
        )
        .unwrap();

        let result = commands::read_agent_session(
            file.path().to_string_lossy().to_string(),
            Some("claude_code".to_string()),
        )
        .unwrap();

        assert_eq!(result.events[0].event_type, "subagent_call");
        assert_eq!(
            result.events[0].tool_use_id.as_deref(),
            Some("toolu_subagent_1")
        );
        assert_eq!(result.events[0].subagent_type.as_deref(), Some("explorer"));
        assert_eq!(
            result.events[0].subagent_description.as_deref(),
            Some("Inspect session parser")
        );
        assert_eq!(result.events[1].event_type, "subagent_result");
        assert_eq!(result.events[1].subagent_type.as_deref(), Some("explorer"));
        assert_eq!(
            result.events[1].subagent_description.as_deref(),
            Some("Inspect session parser")
        );
        assert_eq!(
            result.events[1].text.as_deref(),
            Some("Parser lives in src-tauri/src/lib.rs")
        );
    }

    #[test]
    fn opencode_adapter_classifies_file_and_checkpoint_parts() {
        let mut file = NamedTempFile::new().expect("temp file");
        writeln!(
            file,
            "{}",
            json!({
                "type": "part",
                "part": {"type": "tool", "tool": "read", "input": {"path": "src/main.ts"}}
            })
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            json!({"type": "part", "part": {"type": "snapshot", "id": "snap-1"}})
        )
        .unwrap();

        let result = commands::read_agent_session(
            file.path().to_string_lossy().to_string(),
            Some("opencode".to_string()),
        )
        .unwrap();

        assert_eq!(result.events[0].event_type, "file_read");
        assert_eq!(result.events[0].file_paths, vec!["src/main.ts"]);
        assert_eq!(result.events[1].event_type, "checkpoint");
    }

    #[test]
    fn openclaw_adapter_classifies_action_patch_and_shell() {
        let mut file = NamedTempFile::new().expect("temp file");
        writeln!(
            file,
            "{}",
            json!({
                "action": {"kind": "patch", "diff": "@@ update", "target_file": "src/lib.rs"}
            })
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            json!({
                "action": {"kind": "tool", "name": "shell", "args": {"cmd": "cargo test"}}
            })
        )
        .unwrap();

        let result = commands::read_agent_session(
            file.path().to_string_lossy().to_string(),
            Some("openclaw".to_string()),
        )
        .unwrap();

        assert_eq!(result.events[0].event_type, "patch");
        assert_eq!(result.events[0].file_paths, vec!["src/lib.rs"]);
        assert_eq!(result.events[1].event_type, "shell_command");
        assert_eq!(result.events[1].command.as_deref(), Some("cargo test"));
    }

    #[test]
    fn codex_fixture_matches_real_payload_schema() {
        let mut file = NamedTempFile::new().expect("temp file");
        write!(
            file,
            "{}",
            include_str!("../fixtures/agent_codex_session.jsonl")
        )
        .unwrap();

        let result = commands::read_agent_session(
            file.path().to_string_lossy().to_string(),
            Some("codex".to_string()),
        )
        .unwrap();
        let types = result
            .events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>();

        assert!(types.contains(&"checkpoint"));
        assert!(types.contains(&"user_message"));
        assert!(types.contains(&"reasoning"));
        assert!(types.contains(&"assistant_message"));
        assert!(types.contains(&"shell_command"));
        assert!(types.contains(&"tool_result"));
        assert!(types.contains(&"patch"));
        let shell = result
            .events
            .iter()
            .find(|event| event.event_type == "shell_command")
            .expect("shell event");
        assert_eq!(shell.command.as_deref(), Some("sed -n '1,40p' src/app.tsx"));
    }

    #[test]
    fn claude_code_fixture_matches_real_message_schema() {
        let mut file = NamedTempFile::new().expect("temp file");
        write!(
            file,
            "{}",
            include_str!("../fixtures/agent_claude_code_session.jsonl")
        )
        .unwrap();

        let result = commands::read_agent_session(
            file.path().to_string_lossy().to_string(),
            Some("claude_code".to_string()),
        )
        .unwrap();
        let types = result
            .events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>();

        assert!(types.contains(&"checkpoint"));
        assert!(types.contains(&"user_message"));
        assert!(types.contains(&"reasoning"));
        assert!(types.contains(&"file_read"));
        assert!(types.contains(&"tool_result"));
        assert!(types.contains(&"shell_command"));
        let read = result
            .events
            .iter()
            .find(|event| event.event_type == "file_read")
            .expect("file read event");
        assert_eq!(read.file_paths, vec!["README.md"]);
        let shell = result
            .events
            .iter()
            .find(|event| event.event_type == "shell_command")
            .expect("shell event");
        assert_eq!(shell.command.as_deref(), Some("npm test"));
    }

    #[test]
    fn agent_session_cache_round_trips_by_source() {
        let _guard = TEST_CACHE_ENV.lock().unwrap();
        let cache_file = NamedTempFile::new().expect("cache file");
        std::env::set_var("PROMPTLENS_CACHE_PATH", cache_file.path());
        let mut file = NamedTempFile::new().expect("temp file");
        writeln!(
            file,
            "{}",
            json!({"type": "reasoning", "message": "cached reasoning"})
        )
        .unwrap();
        let path = file.path().to_string_lossy().to_string();

        let first = commands::read_agent_session(path.clone(), Some("codex".to_string())).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs().to_string());
        let cached =
            read_agent_session_cache(&path, LogSource::Codex, metadata.len(), modified.as_deref())
                .unwrap()
                .expect("agent session cache");

        assert_eq!(first.total_events, cached.total_events);
        assert_eq!(cached.events[0].event_type, "reasoning");
        assert!(read_agent_session_cache(
            &path,
            LogSource::ClaudeCode,
            metadata.len(),
            modified.as_deref()
        )
        .unwrap()
        .is_none());
        std::env::remove_var("PROMPTLENS_CACHE_PATH");
    }

    #[test]
    fn search_limits_results() {
        let _guard = TEST_CACHE_ENV.lock().unwrap();
        let mut file = NamedTempFile::new().expect("temp file");
        let cache_file = NamedTempFile::new().expect("cache file");
        std::env::set_var("PROMPTLENS_CACHE_PATH", cache_file.path());
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
        std::env::remove_var("PROMPTLENS_CACHE_PATH");
    }

    #[test]
    fn incremental_scan_appends_summaries_and_search_index() {
        let _guard = TEST_CACHE_ENV.lock().unwrap();
        let mut file = NamedTempFile::new().expect("temp file");
        let cache_file = NamedTempFile::new().expect("cache file");
        std::env::set_var("PROMPTLENS_CACHE_PATH", cache_file.path());
        writeln!(
            file,
            "{{\"id\":\"first\",\"model\":\"gpt-4.1\",\"text\":\"alpha\"}}"
        )
        .unwrap();
        let path = file.path().to_string_lossy().to_string();
        let first = scan_jsonl_inner(path.clone(), None, None).unwrap();
        let append_offset = first.file_size;
        writeln!(
            file,
            "{{\"id\":\"second\",\"model\":\"gpt-4.1\",\"text\":\"beta needle\"}}"
        )
        .unwrap();

        let appended =
            scan_jsonl_incremental(path.clone(), append_offset, first.total_lines).unwrap();
        assert_eq!(appended.summaries.len(), 1);
        assert_eq!(appended.summaries[0].line_number, 2);
        assert_eq!(appended.next_line_number, 2);

        let response = search_jsonl_inner(path, "needle".to_string(), None, None).unwrap();
        assert!(response.indexed);
        assert_eq!(response.results[0].line_number, 2);
        let cached =
            scan_jsonl_inner(file.path().to_string_lossy().to_string(), None, None).unwrap();
        assert!(cached.cache_hit);
        assert_eq!(cached.summaries.len(), 2);
        std::env::remove_var("PROMPTLENS_CACHE_PATH");
    }

    #[test]
    fn scan_cache_round_trips_valid_scan() {
        let _guard = TEST_CACHE_ENV.lock().unwrap();
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
