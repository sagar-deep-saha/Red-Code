# Platform and release standard

**Red Code ships Windows only**, in two architectures:

| Package | Build task |
|---|---|
| Windows x64 user installer (`RedCode-Setup.exe`) | `gulp vscode-win32-x64-user-setup` |
| Windows arm64 user installer | `gulp vscode-win32-arm64-user-setup` |

macOS and Linux are **not offered**. They are excluded from the roadmap and must not be promised in
release notes, README files, issue replies or the updater feed. An earlier plan targeted all three
platforms; that plan was dropped, and `1.147.6` is the release that states the final scope.

This file is the mandatory bar for every official release, starting with `1.147.6`.

## 1. Packages

- Build the app tree from the release commit: `gulp vscode-win32-<arch>`, then
  `gulp vscode-win32-<arch>-inno-updater`, then `gulp vscode-win32-<arch>-user-setup`.
- Never publish a package built from a dirty tree, a reused staging folder that does not match
  `package.json`, or an app tree whose `resources/app/product.json` disagrees with the version being
  released.
- `x64` and `arm64` are separate artifacts. A missing architecture is a release blocker, not a
  footnote.

## 2. Testing per architecture

Before publishing, for **each** architecture:

1. Install from the freshly built setup on that architecture (x64 on x64 Windows, arm64 on Windows
   on ARM; x64-in-arm64 emulation is not a substitute) with a clean profile.
2. Functional pass: open a Laravel project; verify Explorer, Laravel Routes/Project/Artisan, the API
   client (send a request), the Git graph, Sync sign-in, the Updates check, and the Red/Red Light
   themes.
3. Compatibility check: `vscode.version` matches the release, every bundled extension loads, no
   missing native modules, installer icons/wizard artwork and file associations are correct.
4. Performance sanity: cold start, command palette and opening a large workspace stay within the
   previous release's range; note anything worse than ~10%.
5. Update path: the previous release's build of the same architecture sees the new release,
   verifies its SHA-256 and installs it.

Record the result per architecture. An untested architecture blocks the release.

## 3. Issue resolution

Fix every defect found in step 2 before the tag is created — install failures, file-lock and
uninstall-registry problems, icon/shortcut mistakes, arm64-specific crashes. Something that cannot
be fixed in the cycle is a blocker, not a "known issue" in the notes.

## 4. Documentation

Every release includes install instructions and troubleshooting for both architectures
(SmartScreen warning, per-user vs system install, arm64 requirements), and release notes that state
the platform scope. Do not document macOS or Linux installs.

## 5. Artifacts and checksums

- One Git tag per release, semantic (`v<major>.<minor>.<patch>`), matching `package.json`.
- Both installers attached to the GitHub release, named `RedCode-Setup-<arch>.exe` style so the
  architecture is never implied.
- A `SHA256SUMS` file covering **all** artifacts, plus each artifact's SHA-256 in
  `releases/versions.json`.
- `releases/redcode-updates.json` points at the correct architecture with its own SHA-256; the
  updater must never receive a URL for an artifact that does not exist.
- Verify after upload: asset names match the feed, every feed URL returns `200`, and every digest
  matches `SHA256SUMS`.

## Release checklist

```
[ ] version bumped in package.json, CHANGELOG.md, notes-<version>.md
[ ] x64 and arm64 installers built from the release commit
[ ] install + functional + compatibility + performance test recorded per architecture
[ ] defects fixed before tagging
[ ] install guide and troubleshooting updated for both architectures
[ ] SHA256SUMS generated and verified
[ ] tag pushed, release created with both installers
[ ] feed URLs return 200, digests match, updater sees the new version
```
