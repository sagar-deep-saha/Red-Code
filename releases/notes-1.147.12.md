Download `RedCode-Setup.exe` for Windows x64, or `RedCode-Setup-arm64.exe` for Windows on ARM.

### Fixed

- **The integrated terminal failed to launch on Windows.** Opening a terminal showed
  `The terminal process failed to launch: A native exception occurred during launch (Cannot find
  conpty.dll at ...\node-pty\prebuilds\win32-x64\conpty\conpty.dll, error code: 3)`. The node-pty
  prebuilds were packed inside `node_modules.asar`, but `conpty.node` loads its bundled
  `conpty.dll` and `OpenConsole.exe` from a real `conpty` folder next to itself, so the lookup
  failed.
- The packaging now unpacks `node-pty/prebuilds/*/conpty/*` alongside the native module, so the
  terminal host starts on both x64 and arm64.

Nothing else changed: this release keeps the 1.147.11 classic square VS Code layout, the 1.147.10
GitHub avatar support, the 1.147.9 GitLens-parity graph, the 1.147.8 API-panel fix and the 1.147.7
native-module fix.

### Platforms

- Red Code ships **Windows x64 and Windows arm64** only. macOS and Linux are not offered.
