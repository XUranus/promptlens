# PromptLens v0.5.1 Release Notes

PromptLens v0.5.1 focuses on UI polish and packaging automation.

## Highlights

- Frosted glass visual refresh with transparent custom window chrome.
- Custom title bar supports drag, minimize, maximize, close, and theme toggle.
- Left and right workspace panes can be resized and persist their widths.
- Loading overlay now covers file scans, tab switching, record loading, and compare baseline loading.
- GitHub Actions builds macOS, Linux, and Windows artifacts with platform-specific bundle targets.

## Validation

- `npm run build`
- `cd src-tauri && cargo fmt --check && cargo test`
- `npm run tauri -- build`

## Known Limits

- Transparent frosted window effects depend on host OS compositor support.
- Cross-platform packaging is configured for CI; local package validation remains host-platform specific.
