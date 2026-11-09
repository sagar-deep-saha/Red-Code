# SagarCode Red

SagarCode Red is a user-local, independently branded Windows x64 build of the MIT-licensed VS Code open-source repository. It retains upstream source/license notices and normal editor functionality. This distribution does not use Microsoft VS Code icons, product names, Windows app identity, or publisher metadata.

## Isolation design

- The executable, product name, URL protocol, Windows AppUserModelID, mutexes, and installer identifiers are unique to SagarCode Red.
- The package is copied to `%LOCALAPPDATA%\Programs\SagarCode Red`; no files in either Microsoft VS Code installation are read or replaced.
- Start Menu and desktop shortcuts point directly to the SagarCode Red executable and pass explicit `--user-data-dir`, `--extensions-dir`, and `--shared-data-dir` paths.
- Runtime data is stored under `%LOCALAPPDATA%\SagarCode Red\User Data`, `Extensions`, and `Shared Data`. Installing extensions in this build therefore does not use either VS Code extension directory.
- The user-local installer writes no registry values, does not alter file associations, and does not require administrator privileges. Its marker checks prevent overwriting unowned destination directories or shortcuts.

## Source and reproducibility

- Upstream: `https://github.com/microsoft/vscode.git`
- Audited source revision: `b60697f44435315ab7f2d35808def1ebe6e1feb1`
- Package manager: pnpm `12.16.0` as pinned in `package.json`.
- Node.js: `24.22.1` or later in the same 24.x major, as required by `.nvmrc`.
- Windows build prerequisites: Visual Studio 2022 C++ Build Tools with the x64/x86 toolchain and a Windows SDK, plus Python 3 for native dependencies.
- The build uses the upstream Windows x64 packaging task `vscode-win32-x64`; no upstream installer or file-association tasks are run.

Run `scripts/build-sagarcode-red.ps1` from this checkout. It verifies the tool versions, regenerates the icon assets, installs dependencies from the frozen lockfile, runs the upstream packaging task, copies the package to `SagarCodeRed-win32-x64`, and performs a user-local install with isolated shortcuts.

The upstream commit, lockfile, pinned package manager, pinned Node major, and checked-in identity values are fixed inputs. For a future source update, change the recorded source revision and review the upstream product/build changes before rebuilding.

## Source changes

- `product.json`: original product name, unique Windows identity, protocol, and default data-folder names.
- `build/lib/electron.ts`: SagarCode executable metadata.
- `build/win32/code.iss`: SagarCode publisher; the standard setup task is not used by this user-local distribution.
- `resources/win32/VisualElementsManifest.xml`: Start tile display name.
- `resources/win32/code.ico` and `code_70x70.png` / `code_150x150.png`: generated red S-mark assets, regenerated with `scripts/create-sagarcode-red-icon.ps1`.
- `scripts/build-sagarcode-red.ps1` and `scripts/install-sagarcode-red.ps1`: reproducible packaging and non-admin, user-scoped install/shortcut creation.

## Uninstall

Close SagarCode Red, remove `%LOCALAPPDATA%\Programs\SagarCode Red`, remove `%LOCALAPPDATA%\SagarCode Red`, and delete the `SagarCode Red` Start Menu and desktop shortcuts. No other editor's files or configuration are involved.