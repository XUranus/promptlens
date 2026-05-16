# PromptLens v0.5.0 Release Notes

PromptLens v0.5.0 adds raw data export and trace-aware diagnostics.

## Highlights

- Scan summaries now extract trace, session, request, and parent identifiers when present.
- Trace tab shows trace/session chains and can filter the active record list.
- Provider, model, and issue-only filters make diagnostics more precise.
- Export supports summary JSONL/CSV/report plus streamed raw JSONL, normalized JSONL, and session Markdown.
- Cache schema v3 refreshes cached summaries so trace metadata is available after scan.

## Validation

- `npm run build`
- `cd src-tauri && cargo fmt --check && cargo test`
- `npm run tauri -- build`

## Known Limits

- Trace visualization is list-based rather than a graphical tree.
- Raw exports require the original source JSONL file to still exist.
