# Red Code releases

Every Red Code build is recorded here. `versions.json` is the machine-readable history (version,
date, installer URL, SHA-256, size, notes); `redcode-updates.json` is the feed the updater reads.

## Version scheme

Keep the upstream `major.minor` and increment the patch for each Red Code build:

| Build | Version |
|---|---|
| VS Code 1.147.0, first Red Code build | `1.147.0` |
| First published Red Code build | `1.147.1` |
| Laravel S0+S1, Sync, Updates, Changed Files | `1.147.2` |
| GitHub sync upload fix | `1.147.3` |
| API client and Git graph | `1.147.4` |
| API/Git polish, branded installer and watermark | `1.147.5` |
| Next Red Code build (first x64 + arm64 release) | `1.147.6` |

`1.147.0` was built locally and never published, so `versions.json` starts at `1.147.1`; a history
must not advertise a download that does not exist. The latest published build is `1.147.5`
(`RedCode-Setup.exe`, 300,697,496 bytes, sha256 `29e69599…e1e955`).

## Platform coverage

Red Code is Windows only: **x64** and **arm64**. Both installers are mandatory for every release
starting with `1.147.6`, each tested on its own architecture, with a `SHA256SUMS` file covering all
artifacts. **macOS and Linux are not offered** — no packages, no install guides and no promises in
release notes. The checklist is in [platforms.md](platforms.md); it is a release blocker, not a
nice-to-have.

The version lives in `package.json`. The build writes it into `product.json`, which is what the
editor reports as `vscode.version`. Pre-releases use a suffix (`1.147.3-beta.1`) and are only
offered when `redCode.updates.includePrerelease` is on.

## Releasing

1. Bump `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Build the app and the installers for both architectures:

   ```powershell
   $env:PATH = "C:\Users\sagar\.config\herd\bin\nvm\v24.22.1;C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64;$env:PATH"
   corepack pnpm@12.16.0 run gulp vscode-win32-x64
   corepack pnpm@12.16.0 run gulp vscode-win32-x64-inno-updater
   corepack pnpm@12.16.0 run gulp vscode-win32-x64-user-setup

   corepack pnpm@12.16.0 run gulp vscode-win32-arm64
   corepack pnpm@12.16.0 run gulp vscode-win32-arm64-inno-updater
   corepack pnpm@12.16.0 run gulp vscode-win32-arm64-user-setup
   ```

   Build the two trees sequentially and remove the first one after it is recorded; each tree is
   several GB. `VSCode-win32-arm64` is a real arm64 build (Electron arm64 plus arm64 native
   modules), not the x64 tree renamed.

   If `esbuild-bundle-*` aborts with `Build failed: Error: The service was stopped`, the esbuild
   service ran out of memory next to the extension bundling. Build the desktop bundle on its own and
   then package from it, which skips the failing step:

   ```powershell
   node build/next/index.ts bundle --out out-vscode --target desktop --nls
   corepack pnpm@12.16.0 run gulp vscode-win32-arm64-ci
   ```

   `vscode-win32-<arch>-ci` skips recompiling the core and packages whatever is already in
   `out-vscode`.

   `vscode-win32-x64-inno-updater` copies `inno_updater.exe` and `vcruntime140.dll` into
   `<app tree>\tools\` and stamps the Red Code icon on the updater. The setup task does not
   depend on it, so a tree that was never run through it fails the Inno compile with
   `No files found matching "...\tools\*"`.

   `vscode-win32-x64-ci` skips recompiling the core when `out` is already present and up to date;
   use it for an extension-only release whose core sources have not changed. It still packages every
   bundled extension from `extensions/` into the app tree.

   The Inno Setup compiler comes from the `innosetup` npm package; nothing has to be installed
   globally. Two tools must be on `PATH` for a local (non-CI) build: Node 24.22.1 and the Windows
   SDK `signtool.exe` (`C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64`), because
   packaging strips Authenticode signatures from bundled binaries before stamping new version
   information into them.

3. Record the build and generate the feed:

   ```powershell
   node build/red-code/release-manifest.mjs `
     --installer .build\win32-x64\user-setup\VSCodeSetup.exe `
     --package-dir ..\VSCode-win32-x64 `
     --asset-name RedCode-Setup.exe `
     --arm64-installer .build\win32-arm64\user-setup\VSCodeSetup.exe `
     --arm64-package-dir ..\VSCode-win32-arm64 `
     --arm64-asset-name RedCode-Setup-arm64.exe `
     --sha256sums ..\SHA256SUMS `
     --version 1.147.6 --tag v1.147.6 --repository sagar-deep-saha/Red-Code
   ```

   This hashes both installers, appends to `releases/versions.json`, writes
   `releases/redcode-updates.json`, writes `SHA256SUMS` and copies `CHANGELOG.md` into the updater
   extension. From `1.147.6` the record carries `installers: [{ arch: "x64" }, { arch: "arm64" }]`;
   `installer` keeps pointing at the x64 build so Red Code 1.147.5 and older can still update.

   `--asset-name` / `--arm64-asset-name` are the file names the installers are uploaded as, and they
   are the names the feed records, so a download URL cannot point at an asset the release does not
   carry.

   The record is only written when the version in `package.json` and the `product.json` inside
   the packaged app both match `--version`. A stale build tree therefore fails here instead of
   being published and then reporting an older version after an update.

   `--package-dir` / `--arm64-package-dir` must point at the app tree each installer was built from;
   without it the setup output folder contains no `product.json` and the manifest can only warn
   instead of verifying.

   If the repository lives under a deep path, Inno Setup cannot stat bundled files
   whose full path passes 260 characters (Copilot's nested `node_modules` does this).
   Point the setup task at a short-path junction instead of moving the tree:

   ```powershell
   cmd /c mklink /J C:\rcapp "..\VSCode-win32-x64"
   $env:VSCODE_SETUP_SOURCE_DIR = 'C:\rcapp'
   corepack pnpm@12.16.0 run gulp vscode-win32-x64-user-setup
   ```

   For an extension-only release, the packaged tree may be reused after updating its
   `resources/app/product.json` (version, commit, date), replacing
   `resources/app/extensions/<name>/` and refreshing
   `extensions/red-code-updates/CHANGELOG.md` inside it. The manifest still verifies the bundled
   version, and the release must be built and recorded from that tree; never point
   `--package-dir` at a tree that was not the installer source.

4. Publish the GitHub release and attach every artifact:

   ```powershell
   git tag v1.147.6
   git push origin v1.147.6
   New-Item -ItemType HardLink -Path "$env:TEMP\RedCode-Setup.exe" `
     -Target (Resolve-Path '.build\win32-x64\user-setup\VSCodeSetup.exe').Path
   New-Item -ItemType HardLink -Path "$env:TEMP\RedCode-Setup-arm64.exe" `
     -Target (Resolve-Path '.build\win32-arm64\user-setup\VSCodeSetup.exe').Path
   gh release create v1.147.6 "$env:TEMP\RedCode-Setup.exe" "$env:TEMP\RedCode-Setup-arm64.exe" `
     "releases\redcode-updates.json" "SHA256SUMS" `
     --repo sagar-deep-saha/Red-Code --verify-tag --title "Red Code 1.147.6" `
     --notes-file "releases\notes-1.147.6.md"
   ```

   The updater accepts any asset named `RedCode-Setup*.exe` and picks the one for the running
   architecture: arm64 prefers `RedCode-Setup-arm64.exe`, x64 never takes an arm64 build. It reads
   the SHA-256 from `redcode-updates.json` first, and falls back to the digest GitHub reports for
   the EXE. Upload each installer under the same name that was passed as `--asset-name` /
   `--arm64-asset-name`.

   **`path#Name` sets the asset label, not its file name.** Current `gh` uploads the file under
   its local name and only records `Name` in the label field, so
   `VSCodeSetup.exe#RedCode-Setup.exe` publishes an asset whose download path is
   `.../download/v1.147.3/VSCodeSetup.exe` — the feed URL for `RedCode-Setup.exe` then returns 404.
   Renaming the asset afterwards with `gh api -X PATCH .../releases/assets/<id> -f name=...`
   does not fix the download route either. 1.147.3 needed a manual delete plus re-upload.
   Always hardlink (or rename) the installer to the final asset name **before** uploading, as in
   the step above.

   After publishing, verify all three before announcing the release: the asset **name** equals
   the name in the feed URL, `curl.exe -s -o NUL -w "%{http_code}" -L --head <feed url>`
   prints `200`, and the asset `digest` reported by `gh release view --json assets` matches the
   `sha256` in `redcode-updates.json`.

5. Never launch or pin the build folders (`VSCode-win32-x64`, `RedCode-win32-x64`). They are
   staging output that the next build overwrites, so a shortcut or taskbar pin created from one
   keeps opening the previous version after an update even though the update succeeded. Install
   into `%LOCALAPPDATA%\Programs\Red Code` and pin from the Start Menu entry, and `scripts/install-sagarcode-red.ps1`
   repoints existing shortcuts and pins at the installed copy.

## How an installed build sees an update

`red-code-updates` asks the GitHub Releases API (or `redCode.updates.feedUrl`) on startup, at most
once every six hours, and when the status bar button is clicked. It offers only releases newer than
`vscode.version` with a valid HTTPS installer URL and SHA-256. Nothing is downloaded until the user
chooses **Download & Install**, and the installer is not run until the hash matches.
