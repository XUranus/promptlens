# PromptLens v0.3.0 Release Notes

PromptLens v0.3.0 introduces the Local Workspace foundation.

## Highlights

- Open multiple JSONL files in one desktop session.
- Switch between workspace tabs without losing each file's selected record, loaded detail, search state, or diff baseline.
- Rescan the active file from the toolbar.
- Reopen unchanged files faster using the new SQLite summary cache.

## Cache Behavior

PromptLens writes a local `.promptlens-cache.sqlite` file in the workspace. It caches scan summaries and validates entries by:

- file path
- file size
- modified timestamp

Raw record details still come from the JSONL file using byte offsets.

## Validated Locally

- `npm run build`
- `cargo fmt --check && cargo test`
- Tauri development smoke launch

## Next Work

- Persist workspace tabs across app launches.
- Add file append watching and incremental scan.
- Add SQLite FTS search index.
- Add redacted export flows.
