---
id: data-flow
title: 数据流
sidebar_position: 31
sidebar_label: 数据流
description: "PromptLens 四个主要数据流的序列图：打开文件、选择记录、搜索和增量扫描。"
---

# 数据流

本文档使用 Mermaid 序列图追踪 PromptLens 技术栈中四个主要的用户发起流程。每个流程展示了涉及的确切 IPC 调用、Rust 函数和存储交互。

## 流程 1：打开文件

用户通过原生文件对话框打开 `.jsonl` 文件。后端逐行扫描文件，构建带字节偏移量的 `LogSummary` 条目，写入扫描缓存和 FTS5 搜索索引，并返回完整结果。

```mermaid
sequenceDiagram
    actor User as 用户
    participant UI as React (App.tsx)
    participant Store as Zustand Store
    participant IPC as tauri.ts
    participant Cmd as commands.rs
    participant Scan as scanner.rs
    participant Norm as normalize.rs
    participant Cache as cache.rs
    participant SIdx as search.rs
    participant FS as 文件系统

    User->>UI: 点击"打开文件"
    UI->>Store: handleOpenSource("audit")
    Store->>IPC: openFileDialog()
    IPC->>Cmd: invoke("open_file_dialog")
    Cmd->>FS: rfd::FileDialog::pick_file()
    FS-->>Cmd: file_path
    Cmd-->>IPC: Some(path)
    IPC-->>Store: 文件路径

    Store->>IPC: scanJsonl(filePath, logSource)
    IPC->>Cmd: invoke("scan_jsonl", { filePath, logSource })
    Cmd->>FS: File::open + metadata
    FS-->>Cmd: 文件句柄、大小、修改时间

    Cmd->>Cache: read_scan_cache(path, size, modified)
    Cache->>Cache: SELECT payload FROM scan_cache
    alt 缓存命中（匹配 file_path + size + modified）
        Cache-->>Cmd: Some(FileScanResult)
        Cmd-->>IPC: 结果，cache_hit=true
    else 缓存未命中
        Cache-->>Cmd: None

        loop 文件中每一行
            Scan->>FS: BufReader::read_line()
            FS-->>Scan: 行字节
            Scan->>Scan: 跟踪 byte_offset += bytes_read
            Scan->>Norm: summary_from_value(value, line_number, byte_offset)
            Norm->>Norm: 提取 id, model, provider, usage, status, preview
            Norm-->>Scan: LogSummary
            Scan->>Scan: 追加到 summaries Vec

            alt 每 250 行
                Scan->>UI: emit("scan-progress", ProgressEvent)
            end
            alt 每 500 行
                Scan->>UI: emit("scan-chunk", ScanChunkPayload)
            end
        end

        Scan->>Cache: write_scan_cache(result)
        Cache->>Cache: INSERT INTO scan_cache ... ON CONFLICT DO UPDATE
        Scan->>SIdx: write_search_index_from_file(path)
        SIdx->>SIdx: DELETE FROM search_index WHERE file_path = ?
        SIdx->>FS: 偏移到 0，读取所有行
        SIdx->>SIdx: INSERT INTO search_index (path, line, offset, content)
    end

    Cmd-->>IPC: FileScanResult
    IPC-->>Store: summaries[], totalLines, validRecords, invalidRecords
    Store->>Store: 更新 tabs[], activeTabId
    Store-->>UI: 重新渲染 LogList
```

### 扫描进度事件

在完整扫描期间，后端发出两种类型的 Tauri 事件：

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

| 事件 | 频率 | 载荷 | 用途 |
|------|------|------|------|
| `scan-progress` | 每 250 行 | `{ processedBytes, totalBytes, lineNumber }` | 进度条更新 |
| `scan-chunk` | 每 500 行 | `{ filePath, summaries[], lineFrom, lineTo }` | 增量列表渲染 |

### 取消操作

用户可以通过调用 `cancel_scan` 取消活跃扫描。这会设置一个 `AtomicBool` 标志，扫描器在每次读取循环迭代时检查该标志：

```rust
// file: src-tauri/src/scanner.rs:49
if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
    cancelled = true;
    break;
}
```

## 流程 2：选择记录（读取记录）

当用户点击列表中的记录时，后端直接定位到存储的字节偏移量并读取单行。无论记录在文件中的位置如何，这都是 O(1) 操作。

```mermaid
sequenceDiagram
    actor User as 用户
    participant UI as React (App.tsx)
    participant Store as Zustand Store
    participant IPC as tauri.ts
    participant Cmd as commands.rs
    participant Norm as normalize.rs
    participant FS as 文件系统

    User->>UI: 在 LogList 中点击记录 #N
    UI->>Store: handleSelect(summary)
    Store->>Store: 获取 summary.byteOffset, summary.lineNumber
    Store->>IPC: readRecord(filePath, byteOffset, lineNumber)
    IPC->>Cmd: invoke("read_record", { filePath, byteOffset, lineNumber })

    Cmd->>FS: File::open(filePath)
    FS-->>Cmd: 文件句柄
    Cmd->>FS: BufReader::seek(SeekFrom::Start(byteOffset))
    Note over Cmd,FS: O(1) 寻址 — 无需读取前面的行
    Cmd->>FS: BufReader::read_line()
    FS-->>Cmd: 单行 JSON

    Cmd->>Cmd: serde_json::from_str(line)
    Cmd->>Norm: normalize_call(value, summary)
    Norm->>Norm: detect_provider(value)
    Norm->>Norm: 提取请求消息
    Norm->>Norm: 提取响应消息
    Norm->>Norm: 对每个消息部分执行 normalize_content_part
    Norm-->>Cmd: NormalizedCall

    Cmd-->>IPC: RecordDetail { summary, normalized, raw }
    IPC-->>Store: RecordDetail
    Store->>Store: updateActiveSessionTab({ detail })
    Store-->>UI: 重新渲染 DetailView
```

### 按需规范化

规范化只在用户选择记录时发生，而不是在初始扫描期间。扫描阶段仅提取轻量级的 `LogSummary`（id、model、provider、tokens、preview）。完整的 `NormalizedCall`（包含消息、内容部分、工具调用和错误）是从通过字节偏移量读取的原始 JSON 按需计算的。

## 流程 3：搜索

用户在搜索栏中输入查询。后端对 `substring` 和 `fts` 模式使用 FTS5 索引，如果索引不可用则回退到线性扫描。`regex` 模式始终使用线性扫描。

```mermaid
sequenceDiagram
    actor User as 用户
    participant UI as React (App.tsx)
    participant Store as Zustand Store
    participant IPC as tauri.ts
    participant Cmd as commands.rs
    participant Search as search.rs
    participant Cache as cache.rs
    participant FS as 文件系统

    User->>UI: 输入查询，按 Enter
    UI->>Store: handleSearch("substring")
    Store->>IPC: searchJsonl(filePath, query, mode)
    IPC->>Cmd: invoke("search_jsonl", { filePath, query, mode })
    Cmd->>Cmd: cancel_search.store(false)

    alt mode != "regex"
        Cmd->>Search: search_indexed(path, query, mode)
        Search->>Cache: open_cache()
        Cache-->>Search: SQLite 连接

        alt mode == "fts"
            Search->>Search: match_query = query（分词）
        else mode == "substring"
            Search->>Search: match_query = '"query"'（短语匹配）
        end

        Search->>Cache: SELECT line_number, byte_offset, substr(content, 1, 240)
        Cache->>Cache: FROM search_index WHERE content MATCH ?
        Cache-->>Search: 行（最多 1001 行）

        alt 找到结果
            Search-->>Cmd: Some(SearchResponse { indexed: true })
        else 索引中无结果
            Search-->>Cmd: None（回退到线性扫描）
        end
    end

    alt 无索引结果或 mode == "regex"
        Cmd->>FS: File::open + BufReader(256KB 缓冲区)
        loop 每一行
            Cmd->>FS: read_line()
            FS-->>Cmd: 行字节
            Cmd->>Cmd: 跟踪 byte_offset
            alt mode == "regex"
                Cmd->>Cmd: Regex::is_match(line)
            else mode == "substring"
                Cmd->>Cmd: line.to_lowercase().contains(needle)
            end
            alt 找到匹配
                Cmd->>Cmd: 提取上下文：匹配前 80 字符 + 匹配 + 匹配后 120 字符
                Cmd->>Cmd: 推送 SearchResult { lineNumber, byteOffset, context }
                Note over Cmd: 在 MAX_SEARCH_RESULTS (1000) 处停止
            end
            alt 每 250 行
                Cmd->>UI: emit("search-progress", ProgressEvent)
            end
        end
    end

    Cmd-->>IPC: SearchResponse { results, truncated, indexed }
    IPC-->>Store: SearchResponse
    Store-->>UI: 设置 searchResults，在 LogList 中高亮匹配
```

### 搜索模式

| 模式 | 使用的索引 | 查询风格 | 性能 | 用例 |
|------|-----------|----------|------|------|
| `substring` | FTS5 | 短语匹配（`"query"`） | 快（索引） | 查找精确短语 |
| `fts` | FTS5 | 分词匹配 | 快（索引） | 基于词的搜索 |
| `regex` | 无 | 编译的 `Regex` 模式 | 较慢（线性） | 复杂模式匹配 |

## 流程 4：增量扫描（文件监视）

当文件正在被积极写入时（例如实时审计日志），文件监视器检测到变更并从最后已知的字节偏移量触发增量扫描。

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
    Notify->>Watch: EventKind::Modify（500ms 防抖）
    Watch->>UI: emit("file-changed", path)

    UI->>Store: handleLoadAppendedRecords()
    Store->>IPC: getFileStatus(filePath)
    Cmd-->>Store: FileStatus { fileSize, modified }

    alt 有新数据追加（size > cached size）
        Store->>IPC: scanJsonlIncremental(filePath, fromOffset, fromLineNumber)
        IPC->>Cmd: invoke("scan_jsonl_incremental", { filePath, fromOffset, fromLineNumber })
        Cmd->>Scan: scan_jsonl_incremental(path, from_offset, from_line)
        Scan->>Scan: 偏移到 from_offset
        loop 只读取新行
            Scan->>Scan: read_line, parse, build LogSummary
        end
        Scan->>SIdx: append_search_index_from_file(path, from_offset)
        SIdx->>SIdx: DELETE + 从偏移量重新索引
        Scan->>Cache: append_scan_cache(path, new summaries)
        Cache->>Cache: 读取现有载荷，扩展 summaries，写回
        Scan-->>Cmd: IncrementalScanResult
        Cmd-->>Store: 要追加到列表的新 summaries
        Store->>Store: 扩展活动标签的 file.summaries
        Store-->>UI: 用高亮的新记录重新渲染
    end
```

### 增量扫描 vs 完整扫描

| 方面 | 完整扫描 | 增量扫描 |
|------|---------|---------|
| 触发 | 初始文件打开 | 监视器检测到文件变更 |
| 起始偏移 | 0 | 缓存中的最后已知 `file_size` |
| 扫描的行 | 所有行 | 仅新行 |
| 缓存操作 | `write_scan_cache`（覆盖） | `append_scan_cache`（扩展） |
| 搜索索引 | `write_search_index_from_file` | `append_search_index_from_file` |
| 速度 | O(n)，n = 总行数 | O(delta)，delta = 新行数 |
