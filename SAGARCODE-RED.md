# Red Code

Red Code is an independently branded Windows x64 build of the MIT-licensed VS Code open-source repository. It retains upstream source/license notices and normal editor functionality. The Extensions view connects to the Open VSX Registry for searching and installing compatible extensions directly in the editor.

The built-in Red Code Productivity extension adds workspace-relative Project Bookmarks and a read-only Workspace Doctor view. It does not replace the standard Welcome page, Explorer, Tasks, or Zen Mode.

## Isolation design

- The executable, product name, URL protocol, Windows AppUserModelID, mutexes, and installer identifiers are unique to Red Code.
- The package is copied to `%LOCALAPPDATA%\Programs\Red Code`; no files in either Microsoft VS Code installation are read or replaced.
- Start Menu and desktop shortcuts point directly to the Red Code executable and pass explicit `--user-data-dir`, `--extensions-dir`, and `--shared-data-dir` paths.
- Runtime data is stored under `%LOCALAPPDATA%\Red Code\User Data`, `Extensions`, and `Shared Data`. Extensions installed through the Extensions view are stored separately from VS Code.
- The user-local installer writes no registry values, does not alter file associations, and does not require administrator privileges. Its marker checks prevent overwriting unowned destination directories or shortcuts.

## Source and reproducibility

- Upstream: `https://github.com/microsoft/vscode.git`
- Audited source revision: `b60697f44435315ab7f2d35808def1ebe6e1feb1`
- Package manager: pnpm `12.16.0` as pinned in `package.json`.
- Node.js: `24.22.1` or later in the same 24.x major, as required by `.nvmrc`.
- Windows build prerequisites: Visual Studio 2022 C++ Build Tools with the x64/x86 toolchain and a Windows SDK, plus Python 3 for native dependencies.
- The build uses the upstream Windows x64 packaging task `vscode-win32-x64`; no upstream installer or file-association tasks are run.

Run `scripts/build-sagarcode-red.ps1` from this checkout. It verifies the tool versions, installs dependencies from the frozen lockfile, generates the red icon assets from `resources/red-code-icon.svg`, runs the upstream packaging task, copies the package to `RedCode-win32-x64`, and performs a user-local install with isolated shortcuts.

The upstream commit, lockfile, pinned package manager, pinned Node major, and checked-in identity values are fixed inputs. For a future source update, change the recorded source revision and review the upstream product/build changes before rebuilding.

## Source changes

- `product.json`: Red Code product name, unique app identity, protocol, data-folder names, and Open VSX gallery endpoints.
- `extensions/red-code/`: bundled Project Bookmarks and read-only Workspace Doctor extension, with model tests and a focused user guide.
- `build/lib/electron.ts`: Red Code executable metadata.
- `build/win32/code.iss`: Red Code publisher; the standard setup task is not used by this user-local distribution.
- `resources/win32/VisualElementsManifest.xml`: Start tile display name.
- `resources/red-code-icon.svg`: the red Font Awesome Code mark, with the upstream icon attribution and CC BY 4.0 notice.
- `resources/win32/code.ico`, `resources/linux/code.png`, `resources/darwin/code.icns`, and Windows tile PNGs: generated from the SVG by `scripts/create-red-code-icons.mjs`.
- `scripts/build-sagarcode-red.ps1` and `scripts/install-sagarcode-red.ps1`: reproducible packaging and non-admin, user-scoped install/shortcut creation.

## Uninstall

Close Red Code, remove `%LOCALAPPDATA%\Programs\Red Code`, remove `%LOCALAPPDATA%\Red Code`, and delete the `Red Code` Start Menu and desktop shortcuts. No other editor's files or configuration are involved.