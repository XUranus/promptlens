use crate::types::LogSummary;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSummary {
    pub total: usize,
    pub success: usize,
    pub errors: usize,
    pub invalid: usize,
    pub error_rate: f64,
    pub p95_latency: Option<f64>,
    pub p99_latency: Option<f64>,
    pub total_tokens: u64,
    pub p95_tokens: Option<u64>,
    pub top_models: Vec<NameCount>,
    pub top_providers: Vec<NameCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NameCount {
    pub name: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueRecord {
    pub line_number: usize,
    pub byte_offset: u64,
    pub kind: String,
    pub message: String,
    pub severity: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionGroup {
    pub id: String,
    pub label: String,
    pub start_line: usize,
    pub end_line: usize,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub provider: String,
    pub model: String,
    pub trace_key: Option<String>,
    pub record_count: usize,
    pub errors: usize,
    pub total_tokens: u64,
    pub avg_latency_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterOptions {
    pub providers: Vec<String>,
    pub models: Vec<String>,
    pub traces: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputedAnalytics {
    pub analytics: AnalyticsSummary,
    pub issues: Vec<IssueRecord>,
    pub sessions: Vec<SessionGroup>,
    pub filter_options: FilterOptions,
}

fn percentile(values: &mut [f64], quantile: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let index = ((values.len() as f64 * quantile).ceil() as usize).min(values.len() - 1);
    Some(values[index])
}

fn top_counts(values: &[String]) -> Vec<NameCount> {
    let mut counts = std::collections::HashMap::new();
    for v in values {
        *counts.entry(v.clone()).or_insert(0usize) += 1;
    }
    let mut entries: Vec<NameCount> = counts
        .into_iter()
        .map(|(name, count)| NameCount { name, count })
        .collect();
    entries.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));
    entries.truncate(8);
    entries
}

pub fn compute_analytics(summaries: &[LogSummary]) -> AnalyticsSummary {
    let mut latencies: Vec<f64> = summaries
        .iter()
        .filter_map(|s| s.latency_ms.map(|l| l as f64))
        .collect();
    let mut token_values: Vec<f64> = summaries
        .iter()
        .filter_map(|s| s.total_tokens.map(|t| t as f64))
        .collect();

    let errors = summaries
        .iter()
        .filter(|s| s.status == "error" || s.status == "invalid_json")
        .count();
    let total = summaries.len();
    let error_rate = if total > 0 {
        (errors as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    AnalyticsSummary {
        total,
        success: summaries.iter().filter(|s| s.status == "success").count(),
        errors,
        invalid: summaries
            .iter()
            .filter(|s| s.status == "invalid_json")
            .count(),
        error_rate,
        p95_latency: percentile(&mut latencies, 0.95),
        p99_latency: percentile(&mut latencies, 0.99),
        total_tokens: summaries.iter().filter_map(|s| s.total_tokens).sum(),
        p95_tokens: percentile(&mut token_values, 0.95).map(|v| v as u64),
        top_models: top_counts(
            &summaries
                .iter()
                .map(|s| {
                    s.model
                        .clone()
                        .unwrap_or_else(|| "unknown model".to_string())
                })
                .collect::<Vec<_>>(),
        ),
        top_providers: top_counts(
            &summaries
                .iter()
                .map(|s| {
                    s.provider
                        .clone()
                        .unwrap_or_else(|| "unknown provider".to_string())
                })
                .collect::<Vec<_>>(),
        ),
    }
}

pub fn detect_issues(summaries: &[LogSummary], analytics: &AnalyticsSummary) -> Vec<IssueRecord> {
    let latency_threshold = analytics.p95_latency.unwrap_or(0.0).max(10_000.0);
    let token_threshold = analytics.p95_tokens.unwrap_or(0) as f64;

    let mut issues: Vec<IssueRecord> = Vec::new();
    for summary in summaries {
        if summary.status == "invalid_json" {
            issues.push(IssueRecord {
                line_number: summary.line_number,
                byte_offset: summary.byte_offset,
                kind: "invalid".to_string(),
                message: summary
                    .parse_error
                    .clone()
                    .unwrap_or_else(|| "Invalid JSON line".to_string()),
                severity: "high".to_string(),
                model: summary.model.clone(),
            });
        } else if summary.status == "error" {
            issues.push(IssueRecord {
                line_number: summary.line_number,
                byte_offset: summary.byte_offset,
                kind: "error".to_string(),
                message: summary
                    .preview
                    .clone()
                    .unwrap_or_else(|| "Error response".to_string()),
                severity: "high".to_string(),
                model: summary.model.clone(),
            });
        }
        if let Some(latency) = summary.latency_ms {
            if latency as f64 >= latency_threshold {
                issues.push(IssueRecord {
                    line_number: summary.line_number,
                    byte_offset: summary.byte_offset,
                    kind: "latency".to_string(),
                    message: format!("High latency: {latency}ms"),
                    severity: "medium".to_string(),
                    model: summary.model.clone(),
                });
            }
        }
        if let Some(tokens) = summary.total_tokens {
            if tokens as f64 >= token_threshold {
                issues.push(IssueRecord {
                    line_number: summary.line_number,
                    byte_offset: summary.byte_offset,
                    kind: "tokens".to_string(),
                    message: format!("High token usage: {tokens} tokens"),
                    severity: "medium".to_string(),
                    model: summary.model.clone(),
                });
            }
        }
        if summary.preview.is_none() && summary.status == "success" {
            issues.push(IssueRecord {
                line_number: summary.line_number,
                byte_offset: summary.byte_offset,
                kind: "empty".to_string(),
                message: "Successful record has no preview text".to_string(),
                severity: "low".to_string(),
                model: summary.model.clone(),
            });
        }
    }

    issues.sort_by(|a, b| {
        let sa = severity_rank(&a.severity);
        let sb = severity_rank(&b.severity);
        sb.cmp(&sa).then(a.line_number.cmp(&b.line_number))
    });
    issues
}

fn severity_rank(severity: &str) -> u8 {
    match severity {
        "high" => 3,
        "medium" => 2,
        _ => 1,
    }
}

pub fn compute_session_groups(summaries: &[LogSummary]) -> Vec<SessionGroup> {
    use std::collections::HashMap;

    let mut groups: HashMap<String, Vec<&LogSummary>> = HashMap::new();
    for item in summaries {
        let stable = item.trace_id.as_deref().or(item.session_id.as_deref());
        let time = item
            .timestamp
            .as_deref()
            .and_then(chrono_parse_ms)
            .unwrap_or(0);
        let bucket = if time > 0 {
            time / (5 * 60 * 1000)
        } else {
            item.line_number as u64 / 25
        };
        let provider = item.provider.as_deref().unwrap_or("unknown provider");
        let model = item.model.as_deref().unwrap_or("unknown model");
        let id = if let Some(s) = stable {
            format!("trace|{s}")
        } else {
            format!("{provider}|{model}|{bucket}")
        };
        groups.entry(id).or_default().push(item);
    }

    let mut result: Vec<SessionGroup> = groups
        .into_iter()
        .map(|(id, records)| {
            let mut sorted: Vec<&LogSummary> = records;
            sorted.sort_by_key(|r| r.line_number);

            let latencies: Vec<f64> = sorted
                .iter()
                .filter_map(|r| r.latency_ms.map(|l| l as f64))
                .collect();
            let provider = sorted
                .first()
                .and_then(|r| r.provider.as_deref())
                .unwrap_or("unknown provider")
                .to_string();
            let model = sorted
                .first()
                .and_then(|r| r.model.as_deref())
                .unwrap_or("unknown model")
                .to_string();
            let trace_key = sorted.iter().find_map(|r| {
                r.trace_id
                    .as_deref()
                    .or(r.session_id.as_deref())
                    .map(String::from)
            });
            let start_time = sorted.iter().find_map(|r| r.timestamp.clone());
            let end_time = sorted.iter().rev().find_map(|r| r.timestamp.clone());
            let errors = sorted
                .iter()
                .filter(|r| r.status == "error" || r.status == "invalid_json")
                .count();
            let total_tokens: u64 = sorted.iter().filter_map(|r| r.total_tokens).sum();
            let avg_latency = if latencies.is_empty() {
                None
            } else {
                Some(latencies.iter().sum::<f64>() / latencies.len() as f64)
            };

            SessionGroup {
                id,
                label: format!("{provider} / {model}"),
                start_line: sorted.first().map(|r| r.line_number).unwrap_or(0),
                end_line: sorted.last().map(|r| r.line_number).unwrap_or(0),
                start_time,
                end_time,
                provider,
                model,
                trace_key,
                record_count: sorted.len(),
                errors,
                total_tokens,
                avg_latency_ms: avg_latency,
            }
        })
        .collect();

    result.sort_by_key(|s| s.start_line);
    result
}

pub fn compute_filter_options(summaries: &[LogSummary]) -> FilterOptions {
    let mut providers = std::collections::BTreeSet::new();
    let mut models = std::collections::BTreeSet::new();
    let mut traces = std::collections::BTreeSet::new();
    for item in summaries {
        providers.insert(
            item.provider
                .clone()
                .unwrap_or_else(|| "unknown provider".to_string()),
        );
        models.insert(
            item.model
                .clone()
                .unwrap_or_else(|| "unknown model".to_string()),
        );
        if let Some(tid) = item.trace_id.as_deref().or(item.session_id.as_deref()) {
            if !tid.is_empty() {
                traces.insert(tid.to_string());
            }
        }
    }
    FilterOptions {
        providers: providers.into_iter().collect(),
        models: models.into_iter().collect(),
        traces: traces.into_iter().collect(),
    }
}

pub fn compute_all(summaries: &[LogSummary]) -> ComputedAnalytics {
    let analytics = compute_analytics(summaries);
    let issues = detect_issues(summaries, &analytics);
    let sessions = compute_session_groups(summaries);
    let filter_options = compute_filter_options(summaries);
    ComputedAnalytics {
        analytics,
        issues,
        sessions,
        filter_options,
    }
}

fn chrono_parse_ms(s: &str) -> Option<u64> {
    // Try ISO 8601 / RFC 3339
    if let Ok(dt) = time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339) {
        return Some(dt.unix_timestamp() as u64 * 1000 + dt.millisecond() as u64);
    }
    // Try parsing as milliseconds since epoch
    if let Ok(ms) = s.parse::<u64>() {
        return Some(ms);
    }
    // Try parsing as seconds since epoch
    if let Ok(s) = s.parse::<f64>() {
        return Some((s * 1000.0) as u64);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_summary(
        line: usize,
        status: &str,
        latency: Option<f64>,
        tokens: Option<u64>,
    ) -> LogSummary {
        LogSummary {
            id: format!("line-{line}"),
            line_number: line,
            byte_offset: 0,
            timestamp: None,
            provider: Some("openai".to_string()),
            model: Some("gpt-4o".to_string()),
            trace_id: None,
            session_id: None,
            request_id: None,
            parent_id: None,
            status: status.to_string(),
            latency_ms: latency.map(|l| l as u64),
            prompt_tokens: None,
            completion_tokens: None,
            total_tokens: tokens,
            has_image: false,
            has_tool_call: false,
            preview: Some("test".to_string()),
            parse_error: None,
        }
    }

    #[test]
    fn computes_basic_analytics() {
        let summaries = vec![
            make_summary(1, "success", Some(100.0), Some(500)),
            make_summary(2, "error", Some(200.0), Some(1000)),
            make_summary(3, "success", Some(150.0), Some(750)),
        ];
        let analytics = compute_analytics(&summaries);
        assert_eq!(analytics.total, 3);
        assert_eq!(analytics.success, 2);
        assert_eq!(analytics.errors, 1);
        assert!((analytics.error_rate - 33.33).abs() < 0.1);
        assert_eq!(analytics.total_tokens, 2250);
    }

    #[test]
    fn detects_high_latency_issues() {
        let summaries = vec![
            make_summary(1, "success", Some(50_000.0), Some(500)),
            make_summary(2, "success", Some(100.0), Some(500)),
        ];
        let analytics = compute_analytics(&summaries);
        let issues = detect_issues(&summaries, &analytics);
        assert!(issues.iter().any(|i| i.kind == "latency"));
    }

    #[test]
    fn session_groups_by_provider_model() {
        let summaries = vec![
            make_summary(1, "success", Some(100.0), Some(500)),
            make_summary(2, "success", Some(200.0), Some(600)),
        ];
        let sessions = compute_session_groups(&summaries);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].record_count, 2);
    }
}
