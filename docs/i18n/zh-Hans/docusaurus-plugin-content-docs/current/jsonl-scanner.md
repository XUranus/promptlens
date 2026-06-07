---
sidebar_position: 52
title: JSONL 扫描器
description: 扫描器如何读取、解析和索引 JSONL 文件
---

# JSONL 扫描器

JSONL 扫描器负责逐行读取 JSONL 文件，将每行解析为 `LogSummary`，并构建搜索索引。它支持全量扫描和仅追加文件的增量扫描。扫描器是 PromptLens 所有数据摄入的入口。

## 全量扫描

`scanner.rs` 中的 `scan_jsonl_inner` 函数执行 JSONL 文件的完整扫描。

```mermaid
flowchart TD
    A["开始扫描"] --> B{缓存命中?}
    B -->|是| C["返回缓存的 FileScanResult<br/>cache_hit=true"]
    B -->|否| D["打开文件，BufReader<br/>缓冲区=256KB"]
    D --> E["逐行读取"]
    E --> F{有效 JSON?}
    F -->|是| G["summary_from_value()"]
    F -->|否| H["invalid_line_summary()"]
    G --> I["推入 summaries 向量"]
    H --> I
    I --> J{每 500 行?}
    J -->|是| K["发射 scan-chunk 事件"]
    J -->|否| L{每 250 行?}
    K --> L
    L -->|是| M["发射 scan-progress 事件"]
    L -->|否| N{已取消?}
    M --> N
    N -->|是| O["返回 cancelled=true"]
    N -->|否| P{还有更多行?}
    P -->|是| E
    P -->|否| Q["写入扫描缓存"]
    Q --> R["构建 FTS5 搜索索引"]
    R --> S["返回 FileScanResult"]
```

### 缓存键

扫描前，函数检查 SQLite 缓存中是否存在现有结果。缓存键是以下三个字段的组合：

| 字段 | 类型 | 来源 |
|------|------|------|
| `file_path` | `TEXT PRIMARY KEY` | JSONL 文件的绝对路径 |
| `file_size` | `INTEGER` | `metadata.len()` |
| `modified` | `TEXT` | 来自 `metadata.modified()` 的 Unix 纪元秒数 |

```rust
// file: src-tauri/src/scanner.rs:30
if let Ok(Some(mut cached)) = read_scan_cache(&file_path, metadata.len(), modified.as_deref()) {
    cached.duration_ms = started.elapsed().as_millis();
    cached.cache_hit = true;
    cached.cancelled = false;
    return Ok(cached);
}
```

### BufReader 配置

扫描器使用 256 KB 缓冲区以优化顺序 I/O 性能：

```rust
// file: src-tauri/src/scanner.rs:37
let mut reader = BufReader::with_capacity(256 * 1024, file);
```

### 进度事件

| 事件 | 条件 | 载荷 |
|------|------|------|
| `scan-progress` | 第 1 行，然后每 250 行 | `ProgressEvent { processed_bytes, total_bytes, line_number }` |
| `scan-chunk` | 每 500 行 | `ScanChunkPayload { file_path, summaries[], line_from, line_to }` |

### 扫描后操作

成功（未取消）扫描后：

```rust
// file: src-tauri/src/scanner.rs:156
if !result.cancelled {
    let _ = write_scan_cache(&result);
    let _ = write_search_index_from_file(&result.file_path);
}
```

1. **写入扫描缓存**：将整个 `FileScanResult` 序列化到 `scan_cache` SQLite 表
2. **构建搜索索引**：调用 `write_search_index_from_file` 将所有行插入 FTS5 虚拟表

## 增量扫描

`scan_jsonl_incremental` 函数处理仅追加的文件变更，无需重新读取整个文件。

```mermaid
flowchart TD
    A["开始增量扫描"] --> B["读取文件元数据"]
    B --> C{"metadata.len() < from_offset?"}
    C -->|是| D["错误：<br/>文件似乎已被截断"]
    C -->|否| E["打开文件，seek 到 from_offset"]
    E --> F["从偏移量读取新行"]
    F --> G["解析 JSON，创建摘要"]
    G --> H["追加到 FTS5 搜索索引"]
    H --> I["合并到缓存的 FileScanResult"]
    I --> J["返回 IncrementalScanResult"]
```

```rust
// file: src-tauri/src/scanner.rs:163
pub(crate) fn scan_jsonl_incremental(
    file_path: String, from_offset: u64, from_line_number: usize,
) -> Result<IncrementalScanResult, String>
```

### 缓存追加

增量扫描更新现有缓存条目而非替换它：

```rust
// file: src-tauri/src/cache.rs:187
pub(crate) fn append_scan_cache(
    file_path: &str, from_offset: u64, file_size: u64,
    modified: Option<String>, summaries: &[LogSummary],
    total_lines: usize, valid_records: usize, invalid_records: usize, duration_ms: u128,
) -> Result<(), String>
```

## 字节偏移跟踪

每个 `LogSummary` 记录其行在文件中开始的字节偏移量。这使得 `read_record` 能够通过 `BufReader::seek(SeekFrom::Start(byte_offset))` O(1) 随机访问任何记录。

```mermaid
graph LR
    subgraph "JSONL 文件（磁盘上）"
        L1["行 1: offset=0"]
        L2["行 2: offset=142"]
        L3["行 3: offset=387"]
        L4["行 4: offset=521"]
    end

    subgraph "read_record（seek）"
        SEEK["BufReader::seek(387)"] --> READ["read_line()"]
        READ --> PARSE["serde_json::from_str"]
        PARSE --> NORM["normalize_call()"]
    end

    L3 -.->|"O(1) seek"| SEEK
```

## 取消机制

`scan_jsonl` 和 `search_jsonl` 在每次行迭代开始时检查 `AtomicBool` 取消标志：

```rust
// file: src-tauri/src/scanner.rs:49
if cancel_flag.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
    cancelled = true;
    break;
}
```

使用 `Relaxed` 排序是因为精确排序不是关键的 -- 取消通知延迟一次迭代是可以接受的。

## 无效行处理

当行 JSON 解析失败时，扫描器创建 `invalid_line_summary`：

```rust
// file: src-tauri/src/normalize.rs:636
pub(crate) fn invalid_line_summary(
    line_number: usize, byte_offset: u64, trimmed: &str, err: &serde_json::Error,
) -> LogSummary {
    LogSummary {
        id: format!("line-{line_number}"),
        status: "invalid_json".to_string(),
        preview: Some(trimmed.chars().take(180).collect()),
        parse_error: Some(err.to_string()),
        // ... 其他字段设为 None/false
    }
}
```

## 性能特征

| 指标 | 行为 |
|------|------|
| I/O 缓冲区 | 256 KB `BufReader` 用于顺序读取 |
| 进度粒度 | 每行用于进度，每 250 行用于事件，每 500 行用于块 |
| 内存使用 | 扫描期间所有摘要保存在内存中 |
| 缓存写入 | 整个 `FileScanResult` 的单次 JSON 序列化 |
| 索引写入 | FTS5 表中每行一次 INSERT |

对于典型的 100 MB JSONL 文件（100,000 行）：
- 全量扫描：约 2-5 秒，取决于行复杂度
- 缓存命中：&lt;10ms（仅反序列化）
- 增量扫描：与追加数据量成正比
