# Development

## Setup

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
cargo test
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
