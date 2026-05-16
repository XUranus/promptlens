# PromptLens v0.4.0 Release Notes

PromptLens v0.4.0 adds local analysis and diagnostics workflows on top of the v0.3 workspace and indexing foundation.

## Highlights

- Sessions tab groups records heuristically by provider, model, and time or line windows.
- Analytics tab summarizes error rate, latency percentiles, token totals, and top model/provider counts.
- Issues tab flags invalid JSON, error responses, high latency, high token usage, and empty successful records.
- Export tab writes filtered summary exports as JSONL, CSV, or Markdown reports through the native save dialog.

## Validation

- `npm run build`
- `cd src-tauri && cargo fmt --check && cargo test`
- `npm run tauri -- build`

## Known Limits

- Session grouping is heuristic until stable trace/conversation identifiers are promoted into summaries.
- Exported JSONL and CSV are summary-level exports; full raw batch export is still future work.
