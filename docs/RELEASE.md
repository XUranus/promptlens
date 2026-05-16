# Release

## Process

1. Ensure all checks pass:
   ```bash
   npm run build
   cd src-tauri && cargo fmt --check && cargo test
   ```
2. Verify versions match across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
3. Update `release/CHANGELOG.md` and add release notes in `release/RELEASE_NOTES_vX.Y.Z.md`.
4. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
5. GitHub Actions will build all platforms and create a draft release with artifacts.
6. Review the draft release, edit notes if needed, and publish.

## Platform Artifacts

| Platform | Bundles |
|----------|---------|
| macOS arm64 | `.dmg`, `.app.tar.gz` |
| macOS x64 | `.dmg`, `.app.tar.gz` |
| Linux x64 | `.deb`, `.rpm` |
| Windows x64 | `.msi`, `.nsis.zip` |

## Linux Notes

Tauri on Linux requires the WebKit/GTK stack installed by the host distribution. If the app compiles but fails to launch, verify WebKitGTK, GTK, and common desktop portal packages are installed.

## See Also

- [CHANGELOG.md](./CHANGELOG.md)
- [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)
- Release notes: `RELEASE_NOTES_v*.md`
