# Red Code

Red Code is an independent Windows x64 build of the MIT-licensed
[Visual Studio Code](https://github.com/microsoft/vscode) 1.147 source, tuned for Laravel
development. It keeps the familiar VS Code layout, keybindings and extension model, and adds a
small set of removable built-in extensions instead of patching the workbench.

**Current release: 1.147.5** · [Download the installer](https://github.com/sagar-deep-saha/Red-Code/releases/latest) ·
[Release notes](releases/README.md) · [Changelog](CHANGELOG.md)

## What Red Code adds

| Area | What you get |
|---|---|
| **Laravel** | One semantic index built from `php artisan route:list`, a bounded static scan and project metadata: Routes, Project and Artisan views, clickable `route()`/`view()`/`@include`/`<x-…>`/`@vite` links, Inspect Class, and definition-driven Artisan forms. |
| **API client** | A Postman/Thunder-Client-style request editor that lives in the workspace: methods, query parameters, headers, JSON/text bodies, variables from `.env` and environments, collections in `.redcode/api/`, `.http` files, Laravel route prefill, Sanctum CSRF and a session cookie jar. Requests run in the extension host, so there is no CORS. |
| **Git graph** | A GitLens-style commit graph with lanes, ref badges, search, paging, commit details, per-file patches, optional inline blame and a status bar entry. Read-only git commands only. |
| **Sync** | Settings, keybindings, snippets and the extension list stored in your own private GitHub Gist. Device-code or token sign-in; conflicts are always your choice. |
| **Updates** | Checks GitHub Releases, verifies the installer SHA-256 and only then installs. **Version History** opens a Markdown preview of the bundled changelog plus every published release. |
| **Theme** | **Red** / **Red Light** Deep Blue themes with Laravel red (`#ff2d20`) accents and the familiar VS Code panel layout. |
| **Productivity** | Project Bookmarks, a read-only Workspace Doctor, and a Changed Files view that exports a deployment ZIP for hosts that accept individual uploads. |

AI stays the built-in **GitHub Copilot** integration. Red Code does not bundle Intelephense or add a
custom AI service; PHP support comes from `php-language-features` plus the Laravel views. Extensions
are searched and installed from [Open VSX](https://open-vsx.org).

## Install, update, uninstall

1. Download `RedCode-Setup.exe` from the [latest release](https://github.com/sagar-deep-saha/Red-Code/releases/latest).
2. Run it as your normal user. It installs per-user to `%LOCALAPPDATA%\Programs\Red Code` and needs
   no administrator rights.
3. Red Code keeps its own data outside the installation: user data, logs and settings in
   `%APPDATA%\Red Code`, extensions in `%USERPROFILE%\.red-code\extensions`, shared storage in
   `%USERPROFILE%\.red-code-shared`. It never reads or replaces another VS Code installation.

Updates are offered in the editor. The updater verifies the published `sha256` before running the
installer, then Red Code restarts. Pinning a shortcut to a build folder (`VSCode-win32-x64`,
`RedCode-win32-x64`) is not supported: install from the setup and pin from the Start Menu.

To uninstall, close Red Code, remove `%LOCALAPPDATA%\Programs\Red Code`, delete `%APPDATA%\Red Code`,
`%USERPROFILE%\.red-code` and `%USERPROFILE%\.red-code-shared`, and remove the Start Menu and
desktop shortcuts.

## Repository layout

```
src/                       VS Code core (upstream 1.147)
extensions/red-code/       bookmarks, Workspace Doctor, Changed Files
extensions/red-code-laravel/  Laravel index, views, navigation, Artisan
extensions/red-code-api/   HTTP client, collections, variables, CSRF
extensions/red-code-git/   commit graph, inline blame, commit inspector
extensions/red-code-sync/  private-Gist settings sync
extensions/red-code-updates/  release feed, hash verification, version history
extensions/theme-red/      Red and Red Light themes
build/red-code/            install-extensions.mjs, release-manifest.mjs
releases/                  versions.json, redcode-updates.json, notes, release procedure
```

Each Red Code extension is self-contained: `src` plus `esbuild.mts`, bundled to `dist/extension.js`.
`build/lib/extensions.ts` rewrites `./out/` to `./dist/` when a local extension has `esbuild.mts`, so
new extensions only need adding to `build/red-code/install-extensions.mjs` — no gulpfile change and
no core patch.

## Build from source

Requirements: Windows x64, Node.js **24.22.1** (see `.nvmrc`), pnpm **12.16.0** (pinned by
`packageManager`), Visual Studio 2022 C++ Build Tools with the x64 toolchain, Python 3, and the
Windows SDK `signtool.exe` on `PATH`.

```powershell
corepack pnpm@12.16.0 install --frozen-lockfile
corepack pnpm@12.16.0 run gulp vscode-win32-x64
corepack pnpm@12.16.0 run gulp vscode-win32-x64-user-setup
```

If the checkout path is deep, Inno Setup cannot stat Copilot's nested `node_modules`. Build the
installer from a short-path junction instead:

```powershell
cmd /c mklink /J C:\rcapp "..\VSCode-win32-x64"
$env:VSCODE_SETUP_SOURCE_DIR = 'C:\rcapp'
corepack pnpm@12.16.0 run gulp vscode-win32-x64-user-setup
```

For a CI-style build with an existing compiled `out`, `gulp vscode-win32-x64-ci` skips recompiling
the core and is much cheaper.

### Extension development

```powershell
# API client
pnpm --dir extensions/red-code-api test
pnpm --dir extensions/red-code-api run compile

# Git graph
pnpm --dir extensions/red-code-git test
pnpm --dir extensions/red-code-git run compile
```

Tests run through `tsc` plus `node --test`; there is no editor needed. Bundles are written to
`dist/extension.js` and are gitignored.

## Releasing

`releases/README.md` has the full procedure. In short: bump `package.json`, add a `CHANGELOG.md`
section, build the app and installer, run `build/red-code/release-manifest.mjs` (it verifies the
packaged product version and writes `releases/versions.json` plus the updater feed), tag, then
publish the installer **already named** `RedCode-Setup.exe` together with `redcode-updates.json`.
The installer asset name, its download URL and the feed SHA-256 must all match before a release is
announced.

Version scheme: keep VS Code's `major.minor`, increment the Red Code patch (`1.147.0`, `1.147.1`, …).

## License and attribution

Red Code is based on Visual Studio Code, Copyright (c) Microsoft Corporation, licensed under the
[MIT License](LICENSE.txt). Red Code retains the upstream source and license notices; its own
additions are MIT-licensed. The Laravel mark and the Font Awesome Code icon are used under their
respective licenses (see `resources/red-code-icon.svg` and `cgmanifest.json` files).
