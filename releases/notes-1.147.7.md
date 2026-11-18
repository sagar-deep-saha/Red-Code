Download `RedCode-Setup.exe` for Windows x64, or `RedCode-Setup-arm64.exe` for Windows on ARM.

### Fixed

- **1.147.6 could fail to start.** Installing 1.147.6 on Windows left Red Code stuck before any
  window appeared, failing with `Error: Could not locate the bindings file` for
  `@vscode/policy-watcher`. The 1.147.6 installers were assembled with dependency scripts disabled,
  so the native modules were never compiled and the package shipped without them.
- 1.147.7 ships those modules compiled against Electron 43.8.9 (Node ABI 148) for both x64 and
  arm64 — policy-watcher, spdlog, sqlite3, deviceid, windows-mutex, windows-registry,
  native-watchdog, windows-process-tree, native-keymap, native-is-elevated, kerberos and
  `@parcel/watcher` — and the packaged tree is checked for every `.node` file before a release is
  recorded.

If you are on 1.147.6, download this build and install it over your existing copy. The in-app
updater cannot deliver it, because the 1.147.6 app never starts.

### Platforms

- Red Code ships **Windows x64 and Windows arm64** only.
- macOS and Linux packages are not offered.
