# Copilot instructions for Red Code

Red Code is a Windows x64 fork of VS Code 1.147 with Laravel-focused built-in extensions. The
authoritative docs are [SAGARCODE-RED.md](../SAGARCODE-RED.md), [README.md](../README.md) and
[releases/README.md](../releases/README.md).

## What to keep true

- Features live in `extensions/red-code-*`; avoid core patches.
- Each Red Code extension is `src` + `esbuild.mts` + `dist/` (built, gitignored) + `src/test`.
  Register new extensions in `build/red-code/install-extensions.mjs`.
- No decorative features, no Red Code server, no custom AI service, no bundled Intelephense. AI is
  the built-in GitHub Copilot integration.
- English user-facing text; localizable strings belong in `package.nls.json`.
- Never run `.bat`/`.cmd`; resolve `php.exe` directly.
- Only read-only git commands in `red-code-git`. Only HTTPS installers with a matching SHA-256 in
  `red-code-updates`.
- Releases come from GitHub Releases of `sagar-deep-saha/Red-Code`; never advertise a version
  without a real downloadable asset.

## Commands

```powershell
pnpm --dir extensions/red-code-api test
pnpm --dir extensions/red-code-api run compile
pnpm --dir extensions/red-code-git test
pnpm --dir extensions/red-code-laravel test
pnpm --dir extensions/red-code-sync test
pnpm --dir extensions/red-code test
pnpm --dir extensions/red-code-updates test
```

Core build and packaging, including the short-path junction for Inno Setup, are documented in
[releases/README.md](../releases/README.md).

## Before finishing

`tsc` clean, the extension's `node --test` suite green, and `dist/extension.js` rebuilt. For release
work, `releases/versions.json`, `releases/redcode-updates.json`, `CHANGELOG.md` and the packaged
`product.json` must agree on the version.
