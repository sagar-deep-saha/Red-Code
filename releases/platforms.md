# Platform release standard

This is the **mandatory** bar for every official Red Code release, starting with the build after
`1.147.5`. A release that misses any item in this file is not published.

`1.147.1`–`1.147.5` shipped Windows x64 only. That is historical; the checklist below is the rule
from the next cycle onward.

## 1. Distribution packages

Every release carries a compiled, installable package for each supported operating system:

| Platform | Package format | Build task |
|---|---|---|
| Windows | Inno Setup installer (`-user-setup`) | `gulp vscode-win32-<arch>-user-setup` |
| Windows | Portable ZIP | `gulp vscode-win32-<arch>` + archive |
| macOS | `.dmg` (or signed `.zip`) | `gulp vscode-darwin-<arch>` |
| Linux | `.deb`, `.rpm`, `.tar.gz` | `gulp vscode-linux-<arch>-deb` / `-rpm` / `vscode-linux-<arch>` |

A package is only "compiled and production-ready" when it was built from the released commit — not
from a dirty tree, not from a cached staging folder.

## 2. Architecture variants

Each platform ships one package per supported architecture:

- **Windows**: `x64`, `arm64` (and `ia32` only if a real user-facing need appears).
- **macOS**: `x64` (Intel) and `arm64` (Apple silicon).
- **Linux**: `x64`, `arm64`, plus `armhf` where the toolchain supports it.

Architecture is part of the artifact name, never implied. A missing architecture is called out
explicitly in the release notes instead of being silently skipped.

## 3. Testing per platform and architecture

Before publishing, for **every** platform + architecture pair above:

1. Install the package into a clean environment (fresh profile, no leftover user data) and launch.
2. Functional pass: open a Laravel project, verify Explorer, Laravel Routes/Project/Artisan,
   API client (send a request), Git graph, Sync sign-in, Updates check, and the Red/Red Light themes.
3. Compatibility check: the build reports the expected `vscode.version`, loads every bundled
   extension, and has no missing native modules or code-signing/quarantine failures.
4. Performance sanity: cold start, command palette, and opening a large workspace stay within
   the previous release's range; note anything worse than ~10%.
5. Update path: the previous release's build of the same platform/architecture sees the new
   release, verifies its SHA-256 and installs it.

Record the result of each pair. Unverified pairs block the release.

## 4. Issue resolution

All platform-specific defects found in step 3 are fixed before the tag is created — installation
errors, dependency/native-module conflicts, packaging mistakes, and signing/notarization problems.
A defect that cannot be fixed in this cycle is a release blocker, not a known issue in the notes.

## 5. Documentation

Every release includes, alongside the general notes:

- A per-platform install guide (Windows, macOS, Linux) in the repository `docs/` tree, linked from
  the release notes.
- Platform-specific troubleshooting (Gatekeeper/notarization, `.deb` dependency install, SmartScreen,
  ARM64 emulation notes) that matches what actually shipped.
- Release notes grouped per platform when behaviour differs, plus one "all platforms" summary.

## 6. Artifacts and checksums

- One Git tag per release, semantic (`v<major>.<minor>.<patch>`), matching `package.json`.
- Every artifact attached to the GitHub release, named `<Product>-<os>-<arch>.<ext>`.
- A `SHA256SUMS` file covering **all** artifacts, plus each artifact's SHA-256 in
  `releases/versions.json`.
- `releases/redcode-updates.json` points at the correct per-platform installer with its own
  SHA-256; the updater must never receive a URL for an artifact that does not exist.
- Verify after upload: asset names match the feed, every feed URL returns `200`, and every digest
  matches `SHA256SUMS`.

## Release checklist

```
[ ] version bumped in package.json, CHANGELOG.md, notes-<version>.md
[ ] all platform/arch packages built from the released commit
[ ] install + functional + compatibility + performance test recorded per platform/arch
[ ] platform defects fixed before tagging
[ ] install guides and per-platform troubleshooting updated
[ ] SHA256SUMS generated and verified
[ ] tag pushed, release created with every artifact
[ ] feed URLs return 200, digests match, updater sees the new version
```
