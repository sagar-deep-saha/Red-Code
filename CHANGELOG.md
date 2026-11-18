# Red Code changelog

Red Code is a VS Code 1.147 fork. Version numbers keep the upstream `major.minor` and increment the
patch for each Red Code build. `1.147.0` was built and installed locally but never released, so it
has no download; `1.147.1` is the first published Red Code build.
`releases/versions.json` is the machine-readable record; this file is the human one.

## [1.147.8] — 2026-11-18

### Fixed

- **The Red Code API panel was dead.** The HTTP method list was empty, the Base URL and request
  name stayed blank, the Params/Headers tables never filled in and the tab counters showed no
  numbers — nothing in the panel reacted to a click. The panel script is emitted from a template
  literal, and the regex `\/+$` in `retargetRequest` lost its backslash there, so the emitted code
  contained `replace(//+$/, '')`. That starts a line comment, the rest of the function became
  invalid JavaScript, and the whole inline script failed to parse with `Unexpected token 'const'`
  before it could add a single `<option>`.
- The regex now uses a character class (`/[/]+$/`), which survives the template literal. A new
  `webview.test.ts` renders the panel and parses the emitted script, so a broken escape fails the
  test suite instead of shipping.

Nothing else changed: this release keeps the 1.147.7 native-module fix, so it starts correctly on
both x64 and arm64.

## [1.147.7] — 2026-11-18

### Fixed

- **Windows x64 and arm64 could fail to launch after installing 1.147.6.** The app stopped at
  startup with `Error: Could not locate the bindings file` for
  `@vscode/policy-watcher/build/Release/vscode-policy-watcher.node`, so no window ever appeared.
  The 1.147.6 packages were assembled with dependency scripts disabled, so the native modules were
  never compiled and the installer shipped without them.
- Every native module is now compiled against Electron 43.8.9 (Node ABI 148) for **both** x64 and
  arm64, and the packaged tree is checked for each `.node` binary before an installer is recorded.
  This covers `@vscode/policy-watcher`, `@vscode/spdlog`, `@vscode/sqlite3`, `@vscode/deviceid`,
  `@vscode/windows-mutex`, `@vscode/windows-registry`, `@vscode/native-watchdog`,
  `@vscode/windows-process-tree`, `native-keymap`, `native-is-elevated`, `kerberos` and
  `@parcel/watcher`.

If you installed 1.147.6 and the window never opened, download 1.147.7 and install it over the
existing copy; the in-app updater cannot run because the old build never starts.

## [1.147.6] — 2026-11-17

> **Broken build, do not install.** The native modules were never compiled, so both installers
> stop at startup with `Error: Could not locate the bindings file`. Fixed in `1.147.7`.

### Upstream VS Code 1.147

- Track the VS Code `release/1.147` line, bringing the editor fixes, security patches and
  extension-host changes that landed after `1.147.5`.
- Electron 43.8.9, xterm 6.1.0, Copilot SDK 1.0.33 and bundled `ms-vscode.js-debug` 1.140.1.
- The built-in Copilot extension is rebuilt from the stock VS Code 1.147 sources, so Copilot,
  Copilot Chat and agent sessions match upstream.

### Extensions

- Installing from Open VSX no longer prompts **Install Anyway (Don't Verify Signature)**. Signature
  verification is off by default because Red Code cannot satisfy Microsoft's trust chain; the
  `extensions.verifySignature` setting remains available.

### Platforms

- This release ships Windows x64 and Windows arm64 installers. macOS and Linux are not offered.

## [1.147.5] — 2026-11-16

### API client

- Add collections, persistent request tabs and a command to duplicate the active request.
- Add editable base URL profiles and a dropdown for switching between saved endpoints.
- Refresh the API Activity Bar icon with a transparent, theme-aware request/response design.

### Git graph

- Align the graph with GitLens-style branch, graph and commit-message columns.
- Add optional commit-author avatars, disabled by default for privacy.

### Workbench

- Replace the editor's document watermark with Red Code branding across themes.
- Refresh the Windows installer wizard artwork with the Red Code mark.

### Platforms

- This build ships Windows x64. The following release adds a Windows arm64 installer, and both
  architectures are built and tested from `1.147.6` onward. macOS and Linux are not offered
  (`releases/platforms.md`).

## [1.147.4] — 2026-11-16

### API client

- New **Red Code API** extension: an HTTP client in the editor, so Laravel endpoints can be called
  without leaving Red Code. Requests are sent from the extension host with Node's `http`/`https`,
  so there is no browser CORS restriction.
- Request editor with method, URL, query parameters, headers, body modes (JSON, text, form, none),
  response status, headers, body, size and duration.
- Variables are merged from `redCode.api.variables` < `.env` (`baseUrl` falls back to `APP_URL`) <
  `.redcode/api/environments/<name>.json`.
- Collections live in `.redcode/api/collections/*.json`; `.http` files in the workspace open as
  requests too. Collections are browsable in the **API** view and refresh when files change.
- Laravel extras: **New Request from Route** reads `php artisan route:list --json` with the
  configured PHP binary, and a cookie jar plus `GET /sanctum/csrf-cookie` sends `X-XSRF-TOKEN` on
  state-changing requests.

### Git graph

- New **Red Code Git** extension: a GitLens-style commit graph with lanes for branches and merges,
  ref badges, search, paging and a status bar entry.
- Selecting a commit shows its full SHA, parents, author, date, refs, message and changed files;
  selecting a file loads that file's patch, with a 300 KB display cap.
- Optional inline blame decorates the active editor with author, relative time and short SHA, and
  a hover holds the full commit summary. Only read-only git commands are used.
- **Copy Commit SHA** and **Toggle Inline Blame** commands; page size is configurable.

## [1.147.3] — 2026-11-14

### GitHub sync

- Fix the first upload failing with HTTP 422. The Gist payload now carries only files that have
  content, and deletes a snapshot file only when the remote Gist still has it, so GitHub's rule
  that `null` is a delete for an existing file (and invalid otherwise) is respected. Unknown files
  in the Gist are never touched.
- Show GitHub's own validation message instead of a bare "rejected the sync data".
- Derive the status bar from the token a sync would use, so a stored but unrecognised session no
  longer leaves the bar showing "Sign in to Sync".

## [1.147.2] — 2026-11-13

### Workbench

- Replace the maroon Red theme with a Deep Blue palette and Laravel-red focus, selection and active
  indicators while keeping the familiar VS Code panel positions.
- Use the supplied Laravel mark in its Activity Bar container.
- Keep GitHub Copilot Chat as the existing VS Code integration; no custom AI service is added.

### Updates

- Open actions for a cached update directly from the status bar instead of checking the release feed
  again; report when an update check is already running.

### Security

- Use synthetic key-shaped test data and non-production MongoDB example values in redaction tests.

## [1.147.1] — 2026-11-12

### Laravel (S0 + S1)

- Semantic index built from three layers: `artisan route:list --json`, a bounded static scan of PHP
  and Blade, and project metadata. One immutable graph, replaced atomically.
- **Routes** view grouped by middleware with vendor routes hidden, controller/middleware/declaration
  details, Go to Controller, Copy URI, Copy cURL and Open in Browser.
- **Project** view generated by Laravel role (HTTP, Application, Views, Database, Configuration,
  Tests, Packages) alongside the normal Explorer.
- Navigation links for `route()`, `view()`, `View::make()`, `@include`, `@extends`, `@component`,
  `<x-…>` and `@vite`, resolved only through the index.
- **Artisan** view and palette with definition-driven forms, previews, and long-running commands
  redirected to a terminal.
- **Inspect Class** shows a class's routes and Eloquent relations, each a real `file:line`.
- Restricted Mode: static index and read-only information work; `route:list`, `list`, `about` and
  execution require a trusted workspace.

### GitHub sync

- **Red Code Sync** signs in with GitHub (device code, or a personal access token with `gist` scope)
  and stores settings, keybindings, snippets and the extension list in a private Gist.
- Revisions with device, editor version and timestamp; conflicts are always a user choice.
- Credential-shaped setting keys are withheld by default; restores back up replaced files.

### Updates

- **Red Code Updates** checks GitHub Releases (or a custom HTTPS feed), verifies the installer
  SHA-256 and offers to install it. A status bar button shows the running version and turns into an
  update button when a newer build exists.
- **Version History** reads the bundled changelog plus every published release.

### Changed files between commits

- New **Changed Files** view: builds the deduplicated set of files that moves a server from one commit to another, or across any selection of commits.
- Shows uploads with their status (added, modified, renamed) and a separate list of paths to delete, including the old side of renames.
- **Export Deployment ZIP** writes the newest version of each changed file, read from the commit rather than the working tree, with a `RED-CODE-DEPLOY.txt` manifest.
- Laravel-safe defaults exclude `vendor`, `node_modules`, `storage`, `bootstrap/cache` and `.env`; paths are configurable in `redCode.deploy.excludePaths`.

### Fixed

- The **Laravel** container used a dotted id, which VS Code rejects, so its three views were moved
  into Explorer and the icon never appeared. The container is now `redCodeLaravel`; view ids are
  unchanged.

### Earlier work included in this build

- `Red` dark theme and `Red Light`.
- Red Code container with Bookmarks (rename/delete, Explorer badge) and Doctor (grouping, Restricted
  Mode gate).
- Workspace Doctor checks for project files and developer tools.

## [1.147.0] — 2026-11-09

- First Red Code build: branded VS Code 1.147.0, `Red` theme, Bookmarks and Doctor extensions, and
  the Windows installer.
