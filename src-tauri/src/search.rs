use crate::cache::open_cache;
use crate::types::*;
use regex::Regex;
use rusqlite::params;
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Seek, SeekFrom},
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
use tauri::{AppHandle, Emitter};

pub(crate) fn write_search_index_from_file(file_path: &str) -> Result<(), String> {
    let conn = open_cache()?;
    conn.execute(
        "DELETE FROM search_index WHERE file_path = ?1",
        params![file_path],
    )
    .map_err(|err| format!("Failed to clear search index: {err}"))?;
    index_file_from_offset(&conn, file_path, 0, 0)
}

pub(crate) fn append_search_index_from_file(
    file_path: &str,
    from_offset: u64,
    from_line_number: usize,
) -> Result<(), String> {
    let conn = open_cache()?;
    conn.execute(
        "DELETE FROM search_index WHERE file_path = ?1 AND byte_offset >= ?2",
        params![file_path, from_offset as i64],
    )
    .map_err(|err| format!("Failed to clear appended search index: {err}"))?;
    index_file_from_offset(&conn, file_path, from_offset, from_line_number)
}

fn index_file_from_offset(
    conn: &rusqlite::Connection,
    file_path: &str,
    from_offset: u64,
    from_line_number: usize,
) -> Result<(), String> {
    let file = File::open(file_path).map_err(|err| format!("Failed to index file: {err}"))?;
    let mut reader = BufReader::new(file);
    reader
        .seek(SeekFrom::Start(from_offset))
        .map_err(|err| format!("Failed to seek search index: {err}"))?;
    let mut line = String::new();
    let mut byte_offset = from_offset;
    let mut line_number = from_line_number;
    loop {
        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|err| format!("Failed to index line: {err}"))?;
        if bytes_read == 0 {
            break;
        }
        line_number += 1;
        let current_offset = byte_offset;
        byte_offset += bytes_read as u64;
        let content = line.trim();
        if !content.is_empty() {
            conn.execute(
                "INSERT INTO search_index (file_path, line_number, byte_offset, content)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    file_path,
                    line_number as i64,
                    current_offset as i64,
                    content
                ],
            )
            .map_err(|err| format!("Failed to write search index: {err}"))?;
        }
    }
    Ok(())
}

pub(crate) fn search_jsonl_inner(
    file_path: String,
    query: String,
    mode: &str,
    app: Option<&AppHandle>,
    cancel_flag: Option<&AtomicBool>,
) -> Result<SearchResponse, String> {
    let started = Instant::now();
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(SearchResponse {
            results: Vec::new(),
            truncated: false,
            cancelled: false,
            duration_ms: 0,
            indexed: false,
        });
    }

    // Try indexed search for substring and fts modes
    if mode != "regex" {
        if let Ok(Some(indexed)) = search_indexed(&file_path, &needle, mode, started, app) {
            return Ok(indexed);
        }
    }

    // Regex mode: compile pattern
    let re = if mode == "regex" {
        Some(Regex::new(&query).map_err(|e| format!("Invalid regex: {e}"))?)
    } else {
        None
    };

    let file = File::open(&file_path).map_err(|err| format!("Failed to open file: {err}"))?;
    let total_bytes = fs::metadata(&file_path)
        .map_err(|err| format!("Failed to read metadata: {err}"))?
        .len();
    let mut reader = BufReader::with_capacity(256 * 1024, file);
    let mut results = Vec::new();
    let mut line = String::new();
    let mut byte_offset = 0u64;
    let mut line_number = 0usize;
    let mut truncated = false;
    let mut cancelled = false;

    loop {
        if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            cancelled = true;
            break;
        }

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
        if line_number == 1 || line_number % 250 == 0 {
            if let Some(app) = app {
                let _ = app.emit(
                    "search-progress",
                    ProgressEvent {
                        processed_bytes: byte_offset,
                        total_bytes,
                        line_number,
                    },
                );
            }
        }

        let matched = if let Some(re) = &re {
            re.is_match(&line)
        } else {
            line.to_lowercase().contains(&needle)
        };

        if matched {
            let (start_chars, match_len) = if let Some(re) = &re {
                if let Some(m) = re.find(&line) {
                    let prefix = &line[..m.start()];
                    (prefix.chars().count(), m.as_str().chars().count())
                } else {
                    (0, 0)
                }
            } else {
                let haystack = line.to_lowercase();
                if let Some(index) = haystack.find(&needle) {
                    (haystack[..index].chars().count(), needle.chars().count())
                } else {
                    (0, 0)
                }
            };
            let context_start = start_chars.saturating_sub(80);
            let context_end = start_chars + match_len + 120;
            let context = line
                .chars()
                .skip(context_start)
                .take(context_end.saturating_sub(context_start))
                .collect::<String>();
            results.push(SearchResult {
                line_number,
                byte_offset: current_offset,
                context: context.trim().to_string(),
            });
            if results.len() >= MAX_SEARCH_RESULTS {
                truncated = true;
                break;
            }
        }
    }

    Ok(SearchResponse {
        results,
        truncated,
        cancelled,
        duration_ms: started.elapsed().as_millis(),
        indexed: false,
    })
}

fn search_indexed(
    file_path: &str,
    query: &str,
    mode: &str,
    started: Instant,
    app: Option<&AppHandle>,
) -> Result<Option<SearchResponse>, String> {
    let conn = open_cache()?;
    // fts mode uses tokenized search, substring uses phrase matching
    let match_query = if mode == "fts" {
        query.to_string()
    } else {
        format!("\"{}\"", query.replace('"', "\"\""))
    };
    let mut stmt = conn
        .prepare(
            "SELECT line_number, byte_offset, substr(content, 1, 240)
             FROM search_index
             WHERE file_path = ?1 AND content MATCH ?2
             LIMIT ?3",
        )
        .map_err(|err| format!("Failed to prepare indexed search: {err}"))?;
    let mut rows = stmt
        .query(params![
            file_path,
            match_query,
            (MAX_SEARCH_RESULTS + 1) as i64
        ])
        .map_err(|err| format!("Failed to query indexed search: {err}"))?;
    let mut results = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|err| format!("Failed to read indexed search: {err}"))?
    {
        if results.len() % 100 == 0 {
            if let Some(app) = app {
                let _ = app.emit(
                    "search-progress",
                    ProgressEvent {
                        processed_bytes: results.len() as u64,
                        total_bytes: 0,
                        line_number: results.len(),
                    },
                );
            }
        }
        if results.len() >= MAX_SEARCH_RESULTS {
            return Ok(Some(SearchResponse {
                results,
                truncated: true,
                cancelled: false,
                duration_ms: started.elapsed().as_millis(),
                indexed: true,
            }));
        }
        results.push(SearchResult {
            line_number: row
                .get::<_, i64>(0)
                .map_err(|err| format!("Failed to read indexed line: {err}"))?
                as usize,
            byte_offset: row
                .get::<_, i64>(1)
                .map_err(|err| format!("Failed to read indexed offset: {err}"))?
                as u64,
            context: row
                .get::<_, String>(2)
                .map_err(|err| format!("Failed to read indexed context: {err}"))?,
        });
    }
    if results.is_empty() {
        return Ok(None);
    }
    Ok(Some(SearchResponse {
        results,
        truncated: false,
        cancelled: false,
        duration_ms: started.elapsed().as_millis(),
        indexed: true,
    }))
}
