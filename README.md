# PromptLens

PromptLens is a local-first desktop viewer for JSONL LLM audit logs. It focuses on developer workflows: scanning large JSONL files, browsing call summaries, reading request/response conversations, rendering Markdown, previewing embedded base64 images, inspecting raw JSON, and searching records without uploading data.

## Current Status

Implemented v0.5 raw data and trace intelligence foundation:

- Tauri + Rust + React + TypeScript desktop app
- Local JSONL file opening
- Rust streaming scanner with line number and byte offset index
- Invalid JSON line detection
- Virtualized call list
- Summary extraction for model, provider, status, latency, token usage, image/tool markers, and preview text
- Lazy record loading by byte offset
- Generic/OpenAI-style normalization into conversation messages
- Markdown rendering
- data URL/base64 image thumbnail and preview modal
- Metadata panel
- Read-only JSON Tree with large string truncation
- Full-file search with FTS index acceleration and streaming fallback
- List filtering, threshold filters, and sorting
- Recent files, theme toggle, and basic shortcuts
- Two-record diff baseline flow
- Tool, Error, and Raw payload debugger panels
- Scan/search progress, duration display, and cancellation
- Provider fixtures and Rust tests for OpenAI, Anthropic, Gemini, and Ollama-style payloads
- Multi-file workspace tabs with independent selection, detail, search, diff baseline, and timing state
- SQLite summary cache for faster repeated opens when file path, size, and modified time are unchanged
- Workspace tabs restore on app startup when source files still exist
- Cache can be cleared from the toolbar
- Active file changes on disk are detected and surfaced as a rescan warning
- Append-only file changes can be loaded incrementally without a full rescan
- Newly appended records are marked in the call list until selected
- Heuristic session grouping by provider, model, and time/line windows
- Stable trace/session/request/parent identifier extraction when present in source logs
- Trace panel for trace/session chains with parent request context
- Analytics panel for error rate, latency percentiles, token totals, and top model/provider counts
- Issue detection for errors, invalid JSON, high latency, high token usage, and empty successful records
- Local export for filtered summaries as JSONL/CSV and Markdown analysis reports
- Streamed raw JSONL, normalized JSONL, and session Markdown export from source files
- Provider, model, and issue-only advanced filters

## Development

Install dependencies:

```bash
npm install
```

Run the browser frontend only:

```bash
npm run dev
```

Run the desktop app:

```bash
npm run tauri:dev
```

## Use PromptLens

1. Start the desktop app with `npm run tauri:dev`.
2. Click `Open` and select a `.jsonl` file.
3. Use the left call list to filter, sort, and select records.
4. Read normalized request/response content in the center conversation view.
5. Use the right panel tabs for metadata, diff, tools, errors, raw payloads, JSON Tree, and search.
6. Use the compare icon in the list to set a diff baseline, then select another record.
7. Use scan/search cancel buttons when working with large files.
8. Open multiple files to switch between workspace tabs without losing per-file state.
9. Use the database button to clear the scan and search cache when needed.
10. When an active file grows on disk, use `Load appended records` to add new rows without rescanning the full file.
11. Use Sessions, Analytics, Issues, and Export tabs to summarize local audit data.
12. Use Trace and advanced filters to isolate linked calls or high-signal problem records.

Build the frontend:

```bash
npm run build
```

Check the Rust backend:

```bash
cd src-tauri
cargo fmt --check
cargo check
```

## Sample Data

Small sample:

```text
samples/basic.jsonl
```

Generate a large sample:

```bash
npm run sample:large
```

Generate a custom row count:

```bash
node scripts/generate-large-sample.mjs 100000
```

Generate at least a target file size in MB:

```bash
node scripts/generate-large-sample.mjs 100000 100
```

The search command uses the local FTS index when available, falls back to streaming search when needed, and caps results at 1,000 matches so broad searches do not overload the UI on large files.

## Shortcuts

- `Ctrl/Cmd + O`: open file
- `Ctrl/Cmd + F`: focus file search
- `Ctrl/Cmd + Shift + C`: copy current record JSON
- `Arrow Up / Arrow Down`: move selected record
- `Esc`: close image preview

## Large File Validation

Generate 100,000 rows:

```bash
node scripts/generate-large-sample.mjs 100000
```

Generate at least 100 MB:

```bash
node scripts/generate-large-sample.mjs 100000 100
```

Open the generated files in the desktop app and verify scan progress, cancellation, list filtering, virtual scrolling, and search truncation behavior.

## Diff Flow

1. Open a JSONL file.
2. Click the compare icon on a list row to set the baseline.
3. Select another row.
4. Open the `Diff` tab in the right panel.

## Privacy

PromptLens reads local files through the Tauri desktop app. The MVP does not upload files, call remote services, collect telemetry, or send crash reports.

## Release

See [CHANGELOG.md](./CHANGELOG.md), [RELEASE_NOTES_v0.2.0.md](./RELEASE_NOTES_v0.2.0.md), and [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md).
