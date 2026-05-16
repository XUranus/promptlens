# PromptLens v0.6.0 Release Notes

PromptLens v0.6.0 starts the Agent Session Viewer track.

## Highlights

- Adds a unified Agent Session parser for Codex, Claude Code, OpenCode/OpenClaw-style, and generic JSONL event streams.
- Adds an Agent Timeline tab for messages, tool calls, shell commands, file edits, reasoning, plan updates, and errors.
- Adds an Agent Files tab that groups detected file paths and jumps back to the source record.
- Preserves source line number and byte offset so agent views stay connected to raw JSONL records.

## Validation

- `npm run build`
- `cd src-tauri && cargo fmt --check && cargo test`

## Known Limits

- Provider-specific classification is still heuristic and should be hardened with real-world fixtures.
- Timeline is list-based; thread/branch graph visualization is a later Agent Session Viewer milestone.
