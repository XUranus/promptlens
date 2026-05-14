# PromptLens Release Checklist

## v0.2.0 Debugger Readiness

Before tagging a release:

- Run `npm run build`
- Run `cd src-tauri && cargo fmt --check && cargo test`
- Run `npm run tauri -- build`
- Run `npm run tauri:dev` and open `samples/basic.jsonl`
- Verify list filtering, file search, JSON Tree search, image preview, and diff baseline selection
- Generate a 100k-row sample with `node scripts/generate-large-sample.mjs 100000`
- Generate a 100MB sample with `node scripts/generate-large-sample.mjs 100000 100`
- Open the generated large samples in the desktop app
- Verify scan progress updates and Cancel scan stops with partial results
- Verify search progress updates and Cancel search stops with partial results
- Confirm search stops at 1,000 matches and shows a truncation warning
- Confirm raw request/response copy and assistant text copy work
- Confirm `CHANGELOG.md` and release notes are updated
- Confirm `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` versions match

## Manual Smoke Cases

- Open `samples/basic.jsonl`
- Select line 1 and verify Markdown rendering
- Select line 2 and verify Error panel
- Use the compare icon on line 1, then select line 2 and inspect Diff
- Search for `markdown`
- Filter by Errors
- Toggle theme

## Linux Notes

Tauri on Linux requires the WebKit/GTK stack installed by the host distribution. If the app compiles but fails to launch, verify WebKitGTK, GTK, and common desktop portal packages are installed.

Current Linux bundle targets are `deb` and `rpm`. AppImage should be re-enabled after validating the linuxdeploy toolchain in the release environment.

## v0.3.0 Workspace Readiness

- Open two different JSONL files and verify both appear as tabs.
- Switch tabs and verify each file keeps selected record, search results, and diff baseline.
- Reopen an unchanged file and verify the tab shows `cache`.
- Click rescan and verify the active file reloads.
- Delete `.promptlens-cache.sqlite` when testing cold scan behavior.

## v0.3.1 Workspace Stabilization

- Open several JSONL files, quit, restart, and verify tabs restore.
- Verify cache path points to the system app data directory.
- Use the database toolbar button and verify cache is cleared.
- Modify the active JSONL file externally and verify the rescan warning appears.
- Confirm cache failures fall back to cold scan.

## v0.3.2 Incremental Indexing

- Open a JSONL file, append valid JSONL rows externally, and verify `Load appended records` appears.
- Load appended records and verify new rows are marked in the call list.
- Select an appended row and verify its raw/detail payload loads by byte offset.
- Search for text from an indexed row and verify the Search panel reports indexed search.
- Search for a substring that misses FTS token matching and verify streaming fallback still returns matches.
- Truncate or rewrite the active file and verify the UI asks for a full rescan.

## v0.4.0 Analysis & Diagnostics

- Open `samples/basic.jsonl` and verify Sessions, Analytics, Issues, and Export tabs render.
- Apply list filters and verify Analytics/Issues/Export reflect the filtered record set.
- Verify issue cards jump to the referenced record.
- Export JSONL summaries, CSV summaries, and Markdown report through the native save dialog.
- Confirm Markdown report includes top models/providers, sessions, and detected issues.
- Confirm rewritten or truncated files still require full rescan after diagnostics tabs are used.

## v0.5.0 Raw Data & Trace Intelligence

- Open a JSONL file containing `trace_id`, `conversation_id`, `request_id`, or parent span fields.
- Verify Metadata and Trace tabs show stable identifiers.
- Filter by a trace from the Trace or Sessions panel and verify the active list narrows.
- Use provider/model selectors and issue-only filter together with text search.
- Export raw JSONL, normalized JSONL, and session Markdown for the active filtered records.
- Confirm cache schema upgrade performs a cold scan once and then cache hits include trace metadata.
