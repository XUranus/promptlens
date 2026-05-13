# Changelog

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
