# Contributing to Red Code

Red Code is a Windows x64 fork of [Visual Studio Code](https://github.com/microsoft/vscode) 1.147
with Laravel-focused built-in extensions. Contributions to the fork — bug reports, extension fixes,
Laravel tooling, docs — are welcome. Upstream editor bugs belong to the VS Code project, not here.

## Before you start

- Read [README.md](README.md) for what ships and [SAGARCODE-RED.md](SAGARCODE-RED.md) for the
  architecture and source changes.
- Use Node **24.22.1** and pnpm **12.16.0** (both pinned in the repository). `npm` and `yarn` are
  not supported for the workspace.
- Keep a change focused: one behavior or bug per pull request, with the tests that prove it.

## Where a change belongs

| Change | Location |
|---|---|
| Laravel index, Routes/Project/Artisan views, navigation | `extensions/red-code-laravel/` |
| HTTP client, collections, variables, CSRF | `extensions/red-code-api/` |
| Commit graph, blame, commit inspector | `extensions/red-code-git/` |
| Bookmarks, Workspace Doctor, Changed Files | `extensions/red-code/` |
| Settings sync | `extensions/red-code-sync/` |
| Update feed, version history | `extensions/red-code-updates/` |
| Themes and colors | `extensions/theme-red/` |
| Branding, product identity, installer | `product.json`, `build/`, `resources/` |

Features should stay in an extension unless the workbench genuinely cannot expose them. Do not add a
custom AI service (GitHub Copilot is the built-in integration) and do not bundle Intelephense.

## Setup

```powershell
corepack pnpm@12.16.0 install --frozen-lockfile
```

Extension development does not need the full editor build: each Red Code extension compiles with
esbuild and tests with Node's test runner.

```powershell
pnpm --dir extensions/red-code-api test
pnpm --dir extensions/red-code-api run compile
```

To run the editor from source, use the upstream flow:

```powershell
corepack pnpm@12.16.0 run gulp compile
corepack pnpm@12.16.0 run gulp watch
```

## Reporting a problem

Include:

- Red Code version (`Help > About`), Windows version and architecture.
- The workspace type (plain folder, multi-root, Laravel project) and whether Restricted Mode is on.
- For Laravel issues, the output of **Laravel: Show Project Information** and the PHP path source
  (setting, Herd or `PATH`).
- For API issues, the request method and URL shape (`{{baseUrl}}/…`), the status and the response
  headers — never a token or password.
- For Git issues, whether the repository is on a network drive or has a very large history.
- Steps to reproduce, expected result and actual result. Screenshots or a short recording help.

Do not paste secrets, `.env` contents, personal access tokens or full response bodies that contain
credentials.

## Pull requests

1. Add or update tests for the behavior you change. Red Code extension tests are plain Node tests:
   `tsc` first, then `node --test`.
2. Keep user-facing text in English, and put UI strings that can be localized in `package.nls.json`.
3. Update the extension `README.md` when commands, settings or limits change, and `CHANGELOG.md` for
   anything that ships in a release.
4. Run the checks before opening the pull request:

   ```powershell
   pnpm --dir extensions/<name> test
   pnpm --dir extensions/<name> run compile
   ```

5. Do not edit `releases/versions.json` or `releases/redcode-updates.json` by hand. They are written
   by `build/red-code/release-manifest.mjs` from a verified build.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open a public issue for a vulnerability.

## Upstream and license

Red Code retains the upstream MIT license and attribution. By contributing you agree that your
changes are licensed under the same MIT terms.
