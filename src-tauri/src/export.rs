use crate::normalize::{normalize_call, summary_from_value};
use crate::types::*;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{BufRead, BufReader},
};

pub(crate) fn export_records(request: ExportRecordsRequest) -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_file_name(request.default_file_name)
        .save_file()
    else {
        return Ok(None);
    };
    let selected: HashSet<usize> = request.line_numbers.into_iter().collect();
    let file =
        File::open(&request.file_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut reader = BufReader::new(file);
    let mut output = String::new();
    let mut line = String::new();
    let mut byte_offset = 0u64;
    let mut line_number = 0usize;

    loop {
        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|err| format!("Failed to export record: {err}"))?;
        if bytes_read == 0 {
            break;
        }
        line_number += 1;
        let current_offset = byte_offset;
        byte_offset += bytes_read as u64;
        if !selected.contains(&line_number) {
            continue;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match request.kind.as_str() {
            "raw_jsonl" => {
                output.push_str(trimmed);
                output.push('\n');
            }
            "normalized_jsonl" => {
                let value = serde_json::from_str::<Value>(trimmed)
                    .map_err(|err| format!("Failed to parse line {line_number}: {err}"))?;
                let summary = summary_from_value(&value, line_number, current_offset, None);
                let normalized = normalize_call(&value, &summary);
                output.push_str(
                    &serde_json::to_string(&normalized)
                        .map_err(|err| format!("Failed to serialize normalized record: {err}"))?,
                );
                output.push('\n');
            }
            "session_markdown" => {
                let value = serde_json::from_str::<Value>(trimmed)
                    .map_err(|err| format!("Failed to parse line {line_number}: {err}"))?;
                let summary = summary_from_value(&value, line_number, current_offset, None);
                let normalized = normalize_call(&value, &summary);
                output.push_str(&format!(
                    "## Line {} · {}\n\n- Provider: {}\n- Model: {}\n- Trace: {}\n- Session: {}\n- Status: {}\n- Latency: {} ms\n\n",
                    summary.line_number,
                    summary.id,
                    summary.provider.as_deref().unwrap_or("unknown"),
                    summary.model.as_deref().unwrap_or("unknown"),
                    summary.trace_id.as_deref().unwrap_or("-"),
                    summary.session_id.as_deref().unwrap_or("-"),
                    summary.status,
                    summary.latency_ms.map(|value| value.to_string()).unwrap_or_else(|| "-".to_string()),
                ));
                if let Some(response) = normalized.response.and_then(|response| response.text) {
                    output.push_str(&response);
                    output.push_str("\n\n");
                }
            }
            _ => return Err("Unsupported export kind".to_string()),
        }
    }
    fs::write(&path, output).map_err(|err| format!("Failed to save export: {err}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}
