> **Do not install this build.** 1.147.6 installers were assembled without compiling the native
> modules, so the app exits at startup with `Error: Could not locate the bindings file` and no
> window ever opens. Install [1.147.7](https://github.com/sagar-deep-saha/Red-Code/releases/tag/v1.147.7)
> instead.

Download `RedCode-Setup.exe` for Windows x64, or `RedCode-Setup-arm64.exe` for Windows on ARM.

### Upstream VS Code 1.147

- Red Code now tracks the VS Code `release/1.147` line, so this build carries the editor fixes,
  security patches and extension-host changes that landed after `1.147.5`.
- Updated Electron to 43.8.9, xterm to 6.1.0, the Copilot SDK to 1.0.33 and the bundled
  `ms-vscode.js-debug` to 1.140.1.
- The built-in Copilot extension is rebuilt from the same sources as stock VS Code 1.147; Copilot,
  Copilot Chat and the agent sessions behave exactly as they do in upstream VS Code.

### Extensions

- Installing an extension from Open VSX no longer stops on **Install Anyway (Don't Verify
  Signature)**. Red Code has no Microsoft signature trust chain, so the check can never pass; it is
  now off by default. The `extensions.verifySignature` setting is still available for anyone who
  wants to turn it back on.

### Platforms

- Red Code ships **Windows x64 and Windows arm64** only.
- macOS and Linux packages are not offered. The earlier plan to add them has been dropped, and no
  release will publish or advertise them.
