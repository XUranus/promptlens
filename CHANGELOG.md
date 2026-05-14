# Changelog

## v0.3.2 - Incremental Indexing

### Added

- Append-only JSONL loading for active files that grow on disk.
- Newly appended record markers in the call list.
- SQLite FTS5 search index with indexed search status in the UI.
- Incremental cache and search index updates after appended records are loaded.
- Unit coverage for incremental scanning and indexed search.

### Changed

- Full scans now refresh both summary cache and search index.
- File search prefers the FTS index and falls back to streaming search when the index has no match.
- Cache schema upgraded to version 2 and resets stale scan/search cache tables.

### Known Limits

- Incremental loading is intended for append-only writes; rewritten or truncated files still require a full rescan.
- Indexed search is exact-token oriented through SQLite FTS, so substring-style misses fall back to streaming search.

## v0.3.1 - Workspace Stabilization

### Added

- Workspace tab persistence across app launches.
- Startup restoration of recently open workspace files.
- Cache clear command and toolbar action.
- Cache info command with app data cache path.
- Active file status polling with changed-on-disk warning.
- Cache schema versioning via SQLite `user_version`.

### Changed

- Scan summary cache moved from the current working directory to the system app data directory.
- Cache read errors now degrade to a cold scan instead of failing file open.

### Known Limits

- Workspace restore reopens files by path and depends on the original files still existing.
- Rewritten or truncated file changes still require manual rescan.

## v0.3.0 - Local Workspace Foundation

### Added

- Multi-file workspace tabs.
- Per-file state for selected record, loaded detail, diff baseline, search term, search results, and scan/search durations.
- Active file rescan control.
- SQLite scan summary cache keyed by file path, file size, and modified timestamp.
- Cache hit indicator in workspace tabs.
- Cache round-trip unit test.

### Changed

- Generated and private JSONL files remain ignored by default; only `samples/basic.jsonl` is tracked.

### Known Limits

- SQLite cache stores scan summaries only; raw record reads still use the source JSONL file by byte offset.
- Cache invalidation is based on file path, size, and modified time.
- Workspace tabs are persisted starting in v0.3.1.

## v0.2.0 - Debugger Release Candidate

### Added

- Local JSONL scanning with progress, duration display, and cancellation.
- Full-file search with progress, cancellation, and a 1,000-result safety cap.
- Two-record diff workflow for request, response, latency, status, model, and token changes.
- Tool, Error, Raw, Metadata, JSON Tree, Search, and Diff right-panel views.
- JSON Tree key/value filtering and JSON path copy.
- data URL/base64 image preview modal.
- Provider fixtures and tests for OpenAI, Anthropic, Gemini, and Ollama-style payloads.
- Large sample generator with row-count and target-MB modes.
- Linux `deb` and `rpm` bundle validation.

### Changed

- Linux bundle identifier changed to `dev.promptlens.desktop`.
- Linux bundle targets are currently limited to `deb` and `rpm`.
- Local sample ignore rules now avoid committing generated or private JSONL logs.

### Known Limits

- AppImage is disabled until the linuxdeploy release environment is validated.
- Diff is line-oriented and capped for readability; it is not yet a full semantic prompt diff.
- Scanner returns summaries after command completion; progress is streamed, but partial incremental list rendering is future work.

## v0.1.0 - Initial MVP

- Tauri + React + TypeScript + Rust desktop shell.
- Local JSONL file opening, scanning, virtualized call list, lazy record loading, conversation rendering, Markdown rendering, base64 image preview, JSON Tree, and basic search/filter/sort.
