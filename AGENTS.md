# Agent instructions: Red Code

Red Code is a Windows x64 fork of VS Code 1.147 with Laravel-focused built-in extensions. These
instructions apply to the whole repository. Read [SAGARCODE-RED.md](SAGARCODE-RED.md) for the
architecture and [releases/README.md](releases/README.md) before changing anything that ships. The
same guidance in Copilot format lives in [.github/copilot-instructions.md](.github/copilot-instructions.md).

## Ground rules

- Keep features in `extensions/red-code-*` unless a change genuinely cannot be made from an
  extension. Prefer no core patch.
- Every Red Code extension is self-contained: `src`, `esbuild.mts`, `dist/extension.js` (built,
  gitignored), tests under `src/test`. Adding an extension also means adding it to
  `build/red-code/install-extensions.mjs`.
- Do not add decorative features, telemetry, a Red Code server, or a custom AI service. AI is the
  built-in GitHub Copilot integration; Intelephense is not bundled.
- Keep the user-visible layout familiar: VS Code panel positions, Deep Blue surfaces, Laravel red
  (`#ff2d20`) accents.
- Never execute `.bat`/`.cmd` files. Resolve `php.exe` directly (Herd paths are parsed, not run).
- Releases come from GitHub Releases of `sagar-deep-saha/Red-Code`; the updater trusts only HTTPS
  URLs with a matching SHA-256. Never advertise a version that has no downloadable asset.
- **Release standard, mandatory from `1.147.6`:** Red Code ships **Windows x64 and Windows arm64**
  only. Every official release builds and tests an installer for both architectures, resolves
  platform defects before tagging, and publishes a `SHA256SUMS` file covering all artifacts.
  **macOS and Linux are not offered** — do not promise, document or attach packages for them. See
  [releases/platforms.md](releases/platforms.md). `1.147.1`–`1.147.5` shipped x64 only.

## Working with the code

- Node 24.22.1 and pnpm 12.16.0, pinned in `.nvmrc` and `package.json`.
- Extension tests: `pnpm --dir extensions/red-code-api test`, and the same for `red-code-git`,
  `red-code-laravel`, `red-code-sync`, `red-code`, `red-code-updates`.
- Extension build: `pnpm --dir extensions/<name> run compile` → `dist/extension.js`.
- Core build: `gulp vscode-win32-x64` then `gulp vscode-win32-x64-user-setup`; the release procedure
  in `releases/README.md` covers version bumping, manifest recording and verification.
- Source files are TypeScript with tabs, LF line endings, and the upstream MIT header on new files
  in core code. Keep extension code dependency-free where possible; the extension host has Node.

## Validation before calling work done

1. `tsc` is clean for every extension you touched.
2. Its `node --test` suite passes.
3. `dist/extension.js` rebuilds without errors.
4. For release-affecting work, `releases/versions.json`, `releases/redcode-updates.json`,
   `CHANGELOG.md` and the packaged `product.json` agree on the version.
