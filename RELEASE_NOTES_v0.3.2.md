# PromptLens v0.3.2 Release Notes

PromptLens v0.3.2 adds append-only incremental loading and indexed file search.

## Highlights

- Active JSONL files that grow on disk can load appended records without a full rescan.
- Newly appended records are marked in the call list until opened.
- Full scans now build a local SQLite FTS5 index for faster repeated file search.
- File search reports whether the latest result came from indexed or streaming search.
- The scan cache schema is upgraded to version 2 and resets stale cache/index tables automatically.

## Validation

- `npm run build`
- `cd src-tauri && cargo test`

## Known Limits

- Rewritten or truncated files still require a full rescan.
- FTS search is token-oriented; substring misses fall back to streaming search.
