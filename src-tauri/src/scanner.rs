use crate::cache::{append_scan_cache, read_scan_cache, write_scan_cache};
use crate::normalize::{invalid_line_summary, modified_timestamp, summary_from_value};
use crate::search::{append_search_index_from_file, write_search_index_from_file};
use crate::types::*;
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
use tauri::{AppHandle, Emitter};

pub(crate) fn scan_jsonl_inner(
    file_path: String,
    app: Option<&AppHandle>,
    cancel_flag: Option<&AtomicBool>,
) -> Result<FileScanResult, String> {
    let started = Instant::now();
    let path = Path::new(&file_path);
    let file = File::open(path).map_err(|err| format!("Failed to open file: {err}"))?;
    let metadata = fs::metadata(path).map_err(|err| format!("Failed to read metadata: {err}"))?;
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown.jsonl".to_string());
    let modified = modified_timestamp(&metadata);

    if let Ok(Some(mut cached)) = read_scan_cache(&file_path, metadata.len(), modified.as_deref()) {
        cached.duration_ms = started.elapsed().as_millis();
        cached.cache_hit = true;
        cached.cancelled = false;
        return Ok(cached);
    }

    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut summaries = Vec::new();
    let mut total_lines = 0usize;
    let mut valid_records = 0usize;
    let mut invalid_records = 0usize;
    let mut byte_offset = 0u64;
    let mut line = String::new();
    let mut cancelled = false;
    let mut chunk_buffer: Vec<LogSummary> = Vec::new();
    let mut chunk_start_line = 1usize;

    loop {
        if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            cancelled = true;
            break;
        }

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

        if total_lines == 1 || total_lines % 250 == 0 {
            if let Some(app) = app {
                let _ = app.emit(
                    "scan-progress",
                    ProgressEvent {
                        processed_bytes: byte_offset,
                        total_bytes: metadata.len(),
                        line_number: total_lines,
                    },
                );
            }
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match serde_json::from_str::<Value>(trimmed) {
            Ok(value) => {
                valid_records += 1;
                let summary = summary_from_value(&value, total_lines, current_offset, None);
                chunk_buffer.push(summary.clone());
                summaries.push(summary);
            }
            Err(err) => {
                invalid_records += 1;
                let summary = invalid_line_summary(total_lines, current_offset, trimmed, &err);
                chunk_buffer.push(summary.clone());
                summaries.push(summary);
            }
        }

        // Emit scan-chunk every 500 lines
        if total_lines % 500 == 0 && !chunk_buffer.is_empty() {
            if let Some(app) = app {
                let _ = app.emit(
                    "scan-chunk",
                    ScanChunkPayload {
                        file_path: file_path.clone(),
                        summaries: chunk_buffer.drain(..).collect(),
                        line_from: chunk_start_line,
                        line_to: total_lines,
                    },
                );
            }
            chunk_start_line = total_lines + 1;
        }
    }

    // Emit remaining summaries as final chunk
    if !chunk_buffer.is_empty() {
        if let Some(app) = app {
            let _ = app.emit(
                "scan-chunk",
                ScanChunkPayload {
                    file_path: file_path.clone(),
                    summaries: chunk_buffer,
                    line_from: chunk_start_line,
                    line_to: total_lines,
                },
            );
        }
    }

    // Emit final progress so UI always shows completion
    if let Some(app) = app {
        let _ = app.emit(
            "scan-progress",
            ProgressEvent {
                processed_bytes: metadata.len(),
                total_bytes: metadata.len(),
                line_number: total_lines,
            },
        );
    }

    let result = FileScanResult {
        file_path,
        file_name,
        file_size: metadata.len(),
        modified,
        total_lines,
        valid_records,
        invalid_records,
        duration_ms: started.elapsed().as_millis(),
        cancelled,
        cache_hit: false,
        summaries,
    };
    if !result.cancelled {
        let _ = write_scan_cache(&result);
        let _ = write_search_index_from_file(&result.file_path);
    }
    Ok(result)
}

pub(crate) fn scan_jsonl_incremental(
    file_path: String,
    from_offset: u64,
    from_line_number: usize,
) -> Result<IncrementalScanResult, String> {
    let started = Instant::now();
    let metadata =
        fs::metadata(&file_path).map_err(|err| format!("Failed to read metadata: {err}"))?;
    let modified = modified_timestamp(&metadata);
    if metadata.len() < from_offset {
        return Err("File appears to have been truncated. Run a full rescan.".to_string());
    }

    let file = File::open(&file_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let mut reader = BufReader::new(file);
    reader
        .seek(SeekFrom::Start(from_offset))
        .map_err(|err| format!("Failed to seek append offset: {err}"))?;

    let mut line = String::new();
    let mut byte_offset = from_offset;
    let mut line_number = from_line_number;
    let mut summaries = Vec::new();
    let mut valid_records = 0usize;
    let mut invalid_records = 0usize;

    loop {
        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|err| format!("Failed to read appended line: {err}"))?;
        if bytes_read == 0 {
            break;
        }
        line_number += 1;
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
                    line_number,
                    current_offset,
                    None,
                ));
            }
            Err(err) => {
                invalid_records += 1;
                summaries.push(invalid_line_summary(
                    line_number,
                    current_offset,
                    trimmed,
                    &err,
                ));
            }
        }
    }

    append_search_index_from_file(&file_path, from_offset, from_line_number)?;
    let _ = append_scan_cache(
        &file_path,
        from_offset,
        metadata.len(),
        modified.clone(),
        &summaries,
        line_number,
        valid_records,
        invalid_records,
        started.elapsed().as_millis(),
    );

    Ok(IncrementalScanResult {
        summaries,
        file_size: metadata.len(),
        modified,
        next_line_number: line_number,
        valid_records,
        invalid_records,
        duration_ms: started.elapsed().as_millis(),
    })
}
