Download `RedCode-Setup.exe` for Windows x64, or `RedCode-Setup-arm64.exe` for Windows on ARM.

### Workbench

- **Red Code now opens in the classic square VS Code layout.** The upstream 1.147 default turns on
  the experimental Modern UI, which shows the side bar, panel and editor as floating cards with
  rounded corners and gaps. That experiment is now off by default, so the explorer, tabs, editor,
  panel and status bar meet at straight edges exactly like the VS Code reference design.
- The Modern UI experiment is no longer auto-enrolled, so it cannot switch itself back on. It
  remains available for anyone who wants it: set `workbench.experimental.modernUI` to `true`.

Nothing else changed: this release keeps the 1.147.10 GitHub avatar support, the 1.147.9
GitLens-parity graph, the 1.147.8 API-panel fix and the 1.147.7 native-module fix.

### Platforms

- Red Code ships **Windows x64 and Windows arm64** only. macOS and Linux are not offered.
