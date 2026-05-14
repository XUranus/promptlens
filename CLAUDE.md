# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PromptLens is a local-first Tauri v2 desktop app for viewing and analyzing JSONL LLM audit logs. It normalizes logs from OpenAI, Anthropic, Gemini, and Ollama into a unified format. No network calls, no telemetry.

## Commands

```bash
# Frontend dev server only (Vite, port 1420)
npm run dev

# Full Tauri desktop app (compiles Rust + runs Vite)
npm run tauri:dev

# Type-check and build production frontend
npm run build

# Rust checks and tests (run from src-tauri/)
cd src-tauri && cargo fmt --check
cd src-tauri && cargo check
cd src-tauri && cargo test

# Generate large sample JSONL for testing
npm run sample:large
node scripts/generate-large-sample.mjs [rows] [mb]
```

There is no frontend test framework, linter, or formatter configured. There is no CI/CD.

## Architecture

**Tauri v2** with a React+TypeScript frontend and Rust backend communicating via Tauri IPC commands.

### Frontend (`src/`)

- **`app/App.tsx`** — Monolithic single-file component (~2000 lines) containing all UI components, state management (`useState`/`useMemo`), and business logic. Components include `LogList`, `DetailView`, `MessageCard`, `TraceView`, `SessionsView`, `AnalyticsView`, `DiffView`, etc.
- **`tauri.ts`** — Typed wrappers around Tauri `invoke()` IPC calls. This is the boundary between frontend and backend.
- **`types.ts`** — Shared TypeScript types (`LogSummary`, `NormalizedCall`, `WorkspaceTab`, etc.)
- **`styles.css`** — All CSS, dark/light theme via CSS custom properties on `data-theme` attribute.
- **`lib/`** — Small utilities: clipboard, formatting, recent files (localStorage).

### Backend (`src-tauri/src/`)

- **`lib.rs`** — Core library (~1800 lines): all 12 Tauri `#[command]` functions, JSONL scanning, normalization, SQLite caching, FTS5 search, export, and unit tests.
- **`adapters.rs`** — Provider auto-detection (heuristic JSON structure matching) and role normalization.
- **`parser/image_detector.rs`** — Base64/data-URL image detection.

### Data Flow

1. User opens `.jsonl` via native dialog → Rust streams file line-by-line
2. Each JSON line parsed into `LogSummary` with byte offset for O(1) seeking
3. Results cached in SQLite keyed by (file_path, file_size, modified_time)
4. FTS5 index built in parallel for search
5. On record select, raw JSON read by byte offset → normalized to `NormalizedCall`
6. Frontend renders normalized conversation with Markdown, images, tool calls

### Key Design Decisions

- **Byte-offset indexing**: Records located by byte offset for O(1) random access
- **SQLite + FTS5**: Scan cache and full-text search persisted locally
- **Incremental scanning**: Append-only file changes detected without full rescan
- **Provider normalization**: All supported LLM providers normalized to common `NormalizedCall` schema with messages containing typed content parts (text, image, tool_call, tool_result)
- **Workspace tabs**: Multiple files open simultaneously with independent per-file state (`WorkspaceTab` type)

## Tauri IPC Commands

The backend exposes 12 commands: `open_file_dialog`, `scan_jsonl`, `scan_jsonl_incremental`, `cancel_scan`, `clear_scan_cache`, `get_cache_info`, `get_file_status`, `save_text_file`, `export_records`, `read_record`, `search_jsonl`, `cancel_search`.
