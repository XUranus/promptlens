# Usage

1. Start the desktop app with `npm run tauri:dev`.
2. Click `Open` and select a `.jsonl` file.
3. Use the left call list to filter, sort, and select records.
4. Read normalized request/response content in the center conversation view.
5. Use the right panel tabs for metadata, Agent Timeline, Agent Files, diff, tools, errors, raw payloads, JSON Tree, and search.
6. Use the compare icon in the list to set a diff baseline, then select another record.
7. Use scan/search cancel buttons when working with large files.
8. Open multiple files to switch between workspace tabs without losing per-file state.
9. Use the database button to clear the scan and search cache when needed.
10. When an active file grows on disk, use `Load appended records` to add new rows without rescanning the full file.
11. Use Sessions, Analytics, Issues, and Export tabs to summarize local audit data.
12. Use Trace and advanced filters to isolate linked calls or high-signal problem records.
13. Drag the pane dividers to tune the list/detail/debug layout for your screen.

## Shortcuts

- `Ctrl/Cmd + O`: open file
- `Ctrl/Cmd + F`: focus file search
- `Ctrl/Cmd + Shift + C`: copy current record JSON
- `Arrow Up / Arrow Down`: move selected record
- `Esc`: close image preview

## Diff Flow

1. Open a JSONL file.
2. Click the compare icon on a list row to set the baseline.
3. Select another row.
4. Open the `Diff` tab in the right panel.
