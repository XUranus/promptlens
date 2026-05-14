# PromptLens v0.3.1 Release Notes

PromptLens v0.3.1 stabilizes the v0.3 workspace foundation.

## Highlights

- Workspace tabs now persist across app launches.
- Recently open workspace files are restored on startup when the files still exist.
- Scan summary cache now lives in the system app data directory.
- Cache schema versioning is handled through SQLite `user_version`.
- Cache read failures gracefully fall back to a cold scan.
- The toolbar includes a cache clear action.
- Active files are polled for external changes and show a rescan warning.

## Known Limits

- Workspace persistence stores file paths and restores by rescanning or cache lookup.
- File watching is currently polling-based and only warns; append-only incremental scanning is planned.
- SQLite cache stores summaries only. Raw record reads still use the original JSONL file.

## Validation

- `npm run build`
- `cargo fmt --check && cargo test`
- Tauri development smoke launch
- Linux `deb` and `rpm` bundle build
