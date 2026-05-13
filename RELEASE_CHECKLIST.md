# PromptLens Release Checklist

## v0.2 Debugger Readiness

Before tagging a release:

- Run `npm run build`
- Run `cd src-tauri && cargo fmt --check && cargo test`
- Run `npm run tauri:dev` and open `samples/basic.jsonl`
- Verify list filtering, file search, JSON Tree search, image preview, and diff baseline selection
- Generate a 100k-row sample with `node scripts/generate-large-sample.mjs 100000`
- Generate a 100MB sample with `node scripts/generate-large-sample.mjs 100000 100`
- Open the generated large samples in the desktop app
- Confirm search stops at 1,000 matches and shows a truncation warning
- Confirm raw request/response copy and assistant text copy work

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
