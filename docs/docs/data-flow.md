---
id: data-flow
title: Data Flow
sidebar_position: 31
sidebar_label: Data Flow
description: "Sequence diagrams for PromptLens' four major user-initiated flows: open file, select record, search, and incremental scan."
---

# Data Flow

This document traces four major user-initiated flows through the PromptLens technology stack using Mermaid sequence diagrams. Each flow shows the exact IPC calls, Rust functions, and storage interactions involved.

## Flow 1: Opening a File

The user opens a `.jsonl` file through the native file dialog. The backend scans the file line by line, builds `LogSummary` entries with byte offsets, writes the scan cache and FTS5 search index, and returns the complete result.

```mermaid
sequenceDiagram
    actor User as User
    participant UI as React (App.tsx)
    participant Store as Zustand Store
    participant IPC as tauri.ts
    participant Cmd as commands.rs
    participant Scan as scanner.rs
    participant Norm as normalize.rs
    participant Cache as cache.rs
    participant SIdx as search.rs
    participant FS as Filesystem

    User->>UI: Click "Open File"
    UI->>Store: handleOpenSource("audit")
    Store->>IPC: openFileDialog()
    IPC->>Cmd: invoke("open_file_dialog")
    Cmd->>FS: rfd::FileDialog::pick_file()
    FS-->>Cmd: file_path
    Cmd-->>IPC: Some(path)
    IPC-->>Store: File path

    Store->>IPC: scanJsonl(filePath, logSource)
    IPC->>Cmd: invoke("scan_jsonl", { filePath, logSource })
    Cmd->>FS: File::open + metadata
    FS-->>Cmd: File handle, size, modified time

    Cmd->>Cache: read_scan_cache(path, size, modified)
    Cache->>Cache: SELECT payload FROM scan_cache
    alt Cache hit (matches file_path + size + modified)
        Cache-->>Cmd: Some(FileScanResult)
        Cmd-->>IPC: Result with cache_hit=true
    else Cache miss
        Cache-->>Cmd: None

        loop For each line in file
            Scan->>FS: BufReader::read_line()
            FS-->>Scan: Line bytes
            Scan->>Scan: Track byte_offset += bytes_read
            Scan->>Norm: summary_from_value(value, line_number, byte_offset)
            Norm->>Norm: Extract id, model, provider, usage, status, preview
            Norm-->>Scan: LogSummary
            Scan->>Scan: Append to summaries Vec

            alt Every 250 lines
                Scan->>UI: emit("scan-progress", ProgressEvent)
            end
            alt Every 500 lines
                Scan->>UI: emit("scan-chunk", ScanChunkPayload)
            end
        end

        Scan->>Cache: write_scan_cache(result)
        Cache->>Cache: INSERT INTO scan_cache ... ON CONFLICT DO UPDATE
        Scan->>SIdx: write_search_index_from_file(path)
        SIdx->>SIdx: DELETE FROM search_index WHERE file_path = ?
        SIdx->>FS: Seek to offset 0, read all lines
        SIdx->>SIdx: INSERT INTO search_index (path, line, offset, content)
    end

    Cmd-->>IPC: FileScanResult
    IPC-->>Store: summaries[], totalLines, validRecords, invalidRecords
    Store->>Store: Update tabs[], activeTabId
    Store-->>UI: Re-render LogList
```

### Scan Progress Events

During a full scan, the backend emits two types of Tauri events:

```rust
// file: src-tauri/src/scanner.rs:66
if total_lines == 1 || total_lines.is_multiple_of(250) {
    if let Some(app) = app {
        let _ = app.emit("scan-progress", ProgressEvent {
            processed_bytes: byte_offset,
            total_bytes: metadata.len(),
            line_number: total_lines,
        });
    }
}
```

| Event | Frequency | Payload | Purpose |
|-------|-----------|---------|---------|
| `scan-progress` | Every 250 lines | `{ processedBytes, totalBytes, lineNumber }` | Progress bar update |
| `scan-chunk` | Every 500 lines | `{ filePath, summaries[], lineFrom, lineTo }` | Incremental list rendering |

### Cancellation

Users can cancel an active scan by invoking `cancel_scan`. This sets an `AtomicBool` flag that the scanner checks on each read loop iteration:

```rust
// file: src-tauri/src/scanner.rs:49
if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
    cancelled = true;
    break;
}
```

## Flow 2: Selecting a Record (Read Record)

When a user clicks a record in the list, the backend seeks directly to the stored byte offset and reads a single line. This is an O(1) operation regardless of where the record is in the file.

```mermaid
sequenceDiagram
    actor User as User
    participant UI as React (App.tsx)
    participant Store as Zustand Store
    participant IPC as tauri.ts
    participant Cmd as commands.rs
    participant Norm as normalize.rs
    participant FS as Filesystem

    User->>UI: Click record #N in LogList
    UI->>Store: handleSelect(summary)
    Store->>Store: Get summary.byteOffset, summary.lineNumber
    Store->>IPC: readRecord(filePath, byteOffset, lineNumber)
    IPC->>Cmd: invoke("read_record", { filePath, byteOffset, lineNumber })

    Cmd->>FS: File::open(filePath)
    FS-->>Cmd: File handle
    Cmd->>FS: BufReader::seek(SeekFrom::Start(byteOffset))
    Note over Cmd,FS: O(1) seek — no need to read preceding lines
    Cmd->>FS: BufReader::read_line()
    FS-->>Cmd: Single JSON line

    Cmd->>Cmd: serde_json::from_str(line)
    Cmd->>Norm: normalize_call(value, summary)
    Norm->>Norm: detect_provider(value)
    Norm->>Norm: Extract request messages
    Norm->>Norm: Extract response messages
    Norm->>Norm: normalize_content_part for each message part
    Norm-->>Cmd: NormalizedCall

    Cmd-->>IPC: RecordDetail { summary, normalized, raw }
    IPC-->>Store: RecordDetail
    Store->>Store: updateActiveSessionTab({ detail })
    Store-->>UI: Re-render DetailView
```

### On-Demand Normalization

Normalization happens only when the user selects a record, not during the initial scan. The scan phase extracts only the lightweight `LogSummary` (id, model, provider, tokens, preview). The full `NormalizedCall` (with messages, content parts, tool calls, and errors) is computed on-demand from the raw JSON read via the byte offset.

## Flow 3: Search

The user enters a query in the search bar. The backend uses the FTS5 index for `substring` and `fts` modes, falling back to a linear scan if the index is unavailable. The `regex` mode always uses a linear scan.

```mermaid
sequenceDiagram
    actor User as User
    participant UI as React (App.tsx)
    participant Store as Zustand Store
    participant IPC as tauri.ts
    participant Cmd as commands.rs
    participant Search as search.rs
    participant Cache as cache.rs
    participant FS as Filesystem

    User->>UI: Type query, press Enter
    UI->>Store: handleSearch("substring")
    Store->>IPC: searchJsonl(filePath, query, mode)
    IPC->>Cmd: invoke("search_jsonl", { filePath, query, mode })
    Cmd->>Cmd: cancel_search.store(false)

    alt mode != "regex"
        Cmd->>Search: search_indexed(path, query, mode)
        Search->>Cache: open_cache()
        Cache-->>Search: SQLite connection

        alt mode == "fts"
            Search->>Search: match_query = query (tokenized)
        else mode == "substring"
            Search->>Search: match_query = '"query"' (phrase match)
        end

        Search->>Cache: SELECT line_number, byte_offset, substr(content, 1, 240)
        Cache->>Cache: FROM search_index WHERE content MATCH ?
        Cache-->>Search: Rows (up to 1001)

        alt Results found
            Search-->>Cmd: Some(SearchResponse { indexed: true })
        else No results in index
            Search-->>Cmd: None (fall back to linear scan)
        end
    end

    alt No index results or mode == "regex"
        Cmd->>FS: File::open + BufReader(256KB buffer)
        loop For each line
            Cmd->>FS: read_line()
            FS-->>Cmd: Line bytes
            Cmd->>Cmd: Track byte_offset
            alt mode == "regex"
                Cmd->>Cmd: Regex::is_match(line)
            else mode == "substring"
                Cmd->>Cmd: line.to_lowercase().contains(needle)
            end
            alt Match found
                Cmd->>Cmd: Extract context: 80 chars before + match + 120 chars after
                Cmd->>Cmd: Push SearchResult { lineNumber, byteOffset, context }
                Note over Cmd: Stop at MAX_SEARCH_RESULTS (1000)
            end
            alt Every 250 lines
                Cmd->>UI: emit("search-progress", ProgressEvent)
            end
        end
    end

    Cmd-->>IPC: SearchResponse { results, truncated, indexed }
    IPC-->>Store: SearchResponse
    Store-->>UI: Set searchResults, highlight matches in LogList
```

### Search Modes

| Mode | Index Used | Query Style | Performance | Use Case |
|------|-----------|-------------|-------------|----------|
| `substring` | FTS5 | Phrase match (`"query"`) | Fast (indexed) | Finding exact phrases |
| `fts` | FTS5 | Tokenized match | Fast (indexed) | Word-based search |
| `regex` | None | Compiled `Regex` pattern | Slower (linear) | Complex pattern matching |

## Flow 4: Incremental Scan (File Watching)

When a file is being actively written to (e.g., live audit logs), the file watcher detects changes and triggers an incremental scan from the last known byte offset.

```mermaid
sequenceDiagram
    participant Watch as watcher.rs
    participant Notify as notify crate
    participant Cmd as commands.rs
    participant Scan as scanner.rs
    participant Cache as cache.rs
    participant SIdx as search.rs
    participant UI as React
    participant Store as Zustand Store

    Watch->>Notify: Watcher::watch(path, NonRecursive)
    Notify->>Watch: EventKind::Modify (500ms debounce)
    Watch->>UI: emit("file-changed", path)

    UI->>Store: handleLoadAppendedRecords()
    Store->>IPC: getFileStatus(filePath)
    Cmd-->>Store: FileStatus { fileSize, modified }

    alt New data appended (size > cached size)
        Store->>IPC: scanJsonlIncremental(filePath, fromOffset, fromLineNumber)
        IPC->>Cmd: invoke("scan_jsonl_incremental", { filePath, fromOffset, fromLineNumber })
        Cmd->>Scan: scan_jsonl_incremental(path, from_offset, from_line)
        Scan->>Scan: Seek to from_offset
        loop Read only new lines
            Scan->>Scan: read_line, parse, build LogSummary
        end
        Scan->>SIdx: append_search_index_from_file(path, from_offset)
        SIdx->>SIdx: DELETE + re-index from offset
        Scan->>Cache: append_scan_cache(path, new summaries)
        Cache->>Cache: Read existing payload, extend summaries, write back
        Scan-->>Cmd: IncrementalScanResult
        Cmd-->>Store: New summaries to append to list
        Store->>Store: Extend active tab's file.summaries
        Store-->>UI: Re-render with highlighted new records
    end
```

### Incremental vs Full Scan

| Aspect | Full Scan | Incremental Scan |
|--------|-----------|------------------|
| Trigger | Initial file open | Watcher detects file change |
| Starting offset | 0 | Last known `file_size` from cache |
| Lines scanned | All lines | Only new lines |
| Cache operation | `write_scan_cache` (overwrite) | `append_scan_cache` (extend) |
| Search index | `write_search_index_from_file` | `append_search_index_from_file` |
| Speed | O(n), n = total lines | O(delta), delta = new lines |
