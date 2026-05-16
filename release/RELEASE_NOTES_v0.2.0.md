# PromptLens v0.2.0 Release Notes

PromptLens v0.2.0 turns the initial JSONL viewer into a practical local debugger for LLM audit logs.

## Highlights

- Open local JSONL audit logs without uploading data.
- Stream scan large files with progress and cancellation.
- Search raw JSONL with progress, cancellation, and result caps.
- Inspect request/response conversations, Markdown, images, tools, errors, raw payloads, metadata, and JSON Tree.
- Compare two records with the new Diff workflow.
- Validate common provider shapes with OpenAI, Anthropic, Gemini, and Ollama fixtures.

## Validated Locally

- `npm run build`
- `cargo fmt --check && cargo test`
- 100,000-row sample generation
- 100 MB sample generation
- Tauri Linux bundles:
  - `deb`
  - `rpm`

## Linux Packages

Build outputs:

- `src-tauri/target/release/bundle/deb/PromptLens_0.2.0_amd64.deb`
- `src-tauri/target/release/bundle/rpm/PromptLens-0.2.0-1.x86_64.rpm`

AppImage is intentionally not enabled for this release candidate until the linuxdeploy toolchain is validated.

## Manual Smoke Test

1. Run `npm run tauri:dev`.
2. Open `samples/basic.jsonl`.
3. Verify Markdown rendering on the first record.
4. Verify Error panel on the failing record.
5. Set one record as diff baseline and compare another record.
6. Search for `markdown`.
7. Toggle theme.
8. Generate and open a large file to verify scan/search progress and cancellation.
