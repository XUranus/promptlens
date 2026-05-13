use serde_json::Value;

pub(crate) fn normalize_role(role: &str) -> String {
    match role {
        "system" | "developer" | "user" | "assistant" | "tool" | "function" => role.to_string(),
        "model" => "assistant".to_string(),
        _ => "unknown".to_string(),
    }
}

pub(crate) fn detect_provider(value: &Value) -> Option<String> {
    if value.get("choices").is_some()
        || value.get("output").is_some()
        || value.get("output_text").is_some()
    {
        return Some("openai".to_string());
    }
    if value.get("candidates").is_some() || value.get("contents").is_some() {
        return Some("gemini".to_string());
    }
    if value.get("message").is_some() && value.get("done").is_some() {
        return Some("ollama".to_string());
    }
    if value
        .get("content")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items
                .iter()
                .any(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        })
    {
        return Some("anthropic".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detects_common_providers() {
        assert_eq!(
            detect_provider(&json!({"choices": []})).as_deref(),
            Some("openai")
        );
        assert_eq!(
            detect_provider(&json!({"candidates": []})).as_deref(),
            Some("gemini")
        );
        assert_eq!(
            detect_provider(&json!({"message": {}, "done": true})).as_deref(),
            Some("ollama")
        );
        assert_eq!(
            detect_provider(&json!({"content": [{"type": "text", "text": "ok"}]})).as_deref(),
            Some("anthropic")
        );
    }
}
