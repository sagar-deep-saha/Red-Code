# Red Code: build, isolation and source changes

Red Code is an independently branded Windows x64 build of the MIT-licensed VS Code 1.147
repository. It keeps normal editor functionality, the standard workbench layout and the upstream
extension model. The Extensions view connects to the Open VSX Registry for searching and installing
compatible extensions directly in the editor.

Current release: **1.147.5** (Windows x64). See [README.md](README.md) for the feature overview and
[releases/README.md](releases/README.md) for the release procedure. From `1.147.6` every official
release ships **Windows x64 and Windows arm64** installers; macOS and Linux are not offered. The
mandatory checklist is [releases/platforms.md](releases/platforms.md).

## Bundled Red Code extensions

Everything below is a removable extension under `extensions/`; the workbench is not patched for
these features.

| Extension | Purpose |
|---|---|
| `red-code` | Project Bookmarks, read-only Workspace Doctor, Changed Files with deployment ZIP export. |
| `red-code-laravel` | One semantic Laravel index: Routes/Project/Artisan views, PHP and Blade navigation, Inspect Class, definition-driven Artisan forms. |
| `red-code-api` | Workspace-based HTTP client: collections in `.redcode/api/`, variables from `.env` and environment files, `.http` files, Laravel route prefill, Sanctum CSRF and cookie jar. |
| `red-code-git` | GitLens-style commit graph, commit details and per-file patches, optional inline blame, read-only git. |
| `red-code-sync` | Settings/keybindings/snippets/extension sync through a private GitHub Gist. |
| `red-code-updates` | GitHub Releases update check, SHA-256 verification, installer launch and version history. |
| `theme-red` | **Red** and **Red Light** Deep Blue themes with Laravel-red accents. |

GitHub Copilot remains the built-in AI integration. Red Code does not bundle Intelephense and does
not add its own AI service.

## Isolation design

- The executable, product name, URL protocol (`red-code`), Windows AppUserModelID, mutexes and
  installer identifiers are unique to Red Code.
- The package is installed to `%LOCALAPPDATA%\Programs\Red Code`; no files in a Microsoft VS Code
  installation are read or replaced.
- Start Menu and desktop shortcuts point directly to the Red Code executable and carry no
  arguments, so every launch opens the same profile.
- Runtime data stays outside the installation: user data and settings in `%APPDATA%\Red Code`,
  extensions in `%USERPROFILE%\.red-code\extensions`, shared storage in
  `%USERPROFILE%\.red-code-shared`. Extensions installed through the Extensions view are stored
  separately from VS Code.
- The user-local installer writes no registry values, does not alter file associations and does not
  require administrator privileges. Marker checks prevent overwriting unowned destination
  directories or shortcuts.
- No Red Code server exists: sync talks to your own private GitHub Gist, updates read GitHub
  Releases, and API requests go directly to the URL you enter.

## Source and reproducibility

- Upstream: `https://github.com/microsoft/vscode.git`
- Audited source revision: `b60697f44435315ab7f2d35808def1ebe6e1feb1` (VS Code 1.147)
- Red Code releases: `https://github.com/sagar-deep-saha/Red-Code`
- Package manager: pnpm `12.16.0`, pinned in `package.json`.
- Node.js: `24.22.1` or later in the same 24.x major, as required by `.nvmrc`.
- Windows build prerequisites: Visual Studio 2022 C++ Build Tools with the x64/x86 toolchain and a
  Windows SDK, Python 3 for native dependencies, and `signtool.exe` on `PATH` for the local
  installer build.
- Packaging uses the upstream Windows x64 tasks `vscode-win32-x64` and
  `vscode-win32-x64-user-setup`; no upstream installer or file-association tasks are run.
- `build/red-code/install-extensions.mjs` lists the Red Code extensions that are bundled.
  `build/red-code/release-manifest.mjs` records each published build and generates the updater feed.

Run `scripts/build-sagarcode-red.ps1` from this checkout for the full local flow: it verifies tool
versions, installs dependencies from the frozen lockfile, generates the red icon assets from
`resources/red-code-icon.svg`, runs the upstream packaging task, copies the package to
`RedCode-win32-x64`, and performs a user-local install with isolated shortcuts.

The upstream commit, lockfile, pinned package manager, pinned Node major and checked-in identity
values are fixed inputs. For a future source update, change the recorded source revision and review
upstream product/build changes before rebuilding.

## Source changes

- `product.json`: Red Code product identity — name, application name, protocol, data-folder names,
  Windows identifiers and Open VSX gallery endpoints.
- `extensions/red-code/`: bookmarks, Workspace Doctor and Changed Files, with model tests and a user
  guide.
- `extensions/red-code-laravel/`: semantic Laravel index, views, navigation and Artisan integration.
- `extensions/red-code-api/`: HTTP client, collections, variables, cookie jar and Laravel helpers.
- `extensions/red-code-git/`: git log graph model, commit inspector webview and blame decorations.
- `extensions/red-code-sync/`: private-Gist sync with revisions and conflict handling.
- `extensions/red-code-updates/`: GitHub Releases feed, version comparison and verified installer
  launch.
- `extensions/theme-red/`: Red and Red Light color themes.
- `build/lib/electron.ts`: Red Code executable metadata.
- `build/win32/code.iss`: Red Code publisher; the standard setup task is not used by this
  user-local distribution.
- `build/red-code/`: extension installation list, release manifest and updater feed generation.
- `resources/win32/VisualElementsManifest.xml`: Start tile display name.
- `resources/red-code-icon.svg`: the red Font Awesome Code mark, with upstream icon attribution and
  the CC BY 4.0 notice.
- `resources/win32/code.ico`, `resources/linux/code.png`, `resources/darwin/code.icns` and the
  Windows tile PNGs: generated from the SVG by `scripts/create-red-code-icons.mjs`.
- `resources/win32/inno-big-*.bmp` and `inno-small-*.bmp`: Inno Setup wizard artwork for every DPI
  scale, generated from the same SVG by `scripts/create-red-code-wizard-images.mjs`.
- `scripts/build-sagarcode-red.ps1` and `scripts/install-sagarcode-red.ps1`: reproducible packaging
  and non-admin, user-scoped install/shortcut creation.
- `releases/`: published version history, updater feed, release notes and the release checklist.

## Uninstall

Close Red Code, remove `%LOCALAPPDATA%\Programs\Red Code`, delete `%APPDATA%\Red Code`,
`%USERPROFILE%\.red-code` and `%USERPROFILE%\.red-code-shared`, and delete the **Red Code** Start
Menu and desktop shortcuts. No other editor's files or configuration are involved.
