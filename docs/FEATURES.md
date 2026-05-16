# Features

## Core

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

## Workspace

- Multi-file workspace tabs with independent selection, detail, search, diff baseline, and timing state
- SQLite summary cache for faster repeated opens when file path, size, and modified time are unchanged
- Workspace tabs restore on app startup when source files still exist
- Cache can be cleared from the toolbar
- Active file changes on disk are detected and surfaced as a rescan warning
- Append-only file changes can be loaded incrementally without a full rescan
- Newly appended records are marked in the call list until selected

## Agent Session Viewer

- Agent session JSONL parsing for Codex, Claude Code, OpenCode/OpenClaw-style, and generic agent events
- Agent Timeline tab for user/assistant messages, tool calls, shell commands, file edits, reasoning, and errors
- Agent Files tab for file activity extracted from agent tool events

## Intelligence

- Heuristic session grouping by provider, model, and time/line windows
- Stable trace/session/request/parent identifier extraction when present in source logs
- Trace panel for trace/session chains with parent request context
- Analytics panel for error rate, latency percentiles, token totals, and top model/provider counts
- Issue detection for errors, invalid JSON, high latency, high token usage, and empty successful records
- Provider, model, and issue-only advanced filters

## Export

- Local export for filtered summaries as JSONL/CSV and Markdown analysis reports
- Streamed raw JSONL, normalized JSONL, and session Markdown export from source files

## UI

- Frosted glass visual refresh with custom transparent window chrome
- Resizable workspace panes with persisted panel widths
- Loading overlays for scans, tab switches, record loads, and compare loads
- GitHub Actions workflow for macOS, Linux, and Windows build artifacts
