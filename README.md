# PromptLens

PromptLens is a local-first desktop viewer for JSONL LLM audit logs. It focuses on developer workflows: scanning large JSONL files, browsing call summaries, reading request/response conversations, rendering Markdown, previewing embedded base64 images, inspecting raw JSON, and searching records without uploading data.

## Current Status

Implemented v0.1 MVP surface:

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
- Full-file streaming string search
- List filtering, threshold filters, and sorting
- Recent files, theme toggle, and basic shortcuts

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

## Shortcuts

- `Ctrl/Cmd + O`: open file
- `Ctrl/Cmd + F`: focus file search
- `Ctrl/Cmd + Shift + C`: copy current record JSON
- `Arrow Up / Arrow Down`: move selected record
- `Esc`: close image preview

## Privacy

PromptLens reads local files through the Tauri desktop app. The MVP does not upload files, call remote services, collect telemetry, or send crash reports.
