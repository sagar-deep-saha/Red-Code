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
| Upstream 1.147 sync, first x64 + arm64 release | `1.147.6` |
| Native modules compiled for Electron 43.8.9 (startup fix) | `1.147.7` |
| API panel script escaping fix | `1.147.8` |

`1.147.0` was built locally and never published, so `versions.json` starts at `1.147.1`; a history
must not advertise a download that does not exist. The latest published build is `1.147.8`:

| Asset | Size | SHA-256 |
|---|---|---|
| `RedCode-Setup.exe` (x64) | 322,799,689 | `aa3b24be…f58711` |
| `RedCode-Setup-arm64.exe` | 317,607,574 | `9e605f77…8687c5` |

`1.147.6` was withdrawn as a startup regression: its installers were assembled with dependency
scripts disabled, so no native module was compiled and the app exited with
`Could not locate the bindings file`. `1.147.7` is the first build whose x64 and arm64 packages
carry the Electron 43.8.9 native modules, and it is the build users should install.

The release also carries `SHA256SUMS` and `redcode-updates.json`.

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

   **Native modules must be compiled before packaging.** The packaging tasks copy `node_modules`
   as-is; they never build it. An install that ran with `--config.ignore-scripts=true` (needed to
   dodge the `@vscode/windows-process-tree` path-length failure) leaves every `.node` binary
   missing, and the installer then ships an app that dies at startup with
   `Error: Could not locate the bindings file`. That is what broke `1.147.6`. Compile them for the
   Electron runtime with the native build hooks from `.pnpmfile.mjs`, once per architecture:

   ```powershell
   # x64 (host arch)
   corepack pnpm@12.16.0 rebuild @parcel/watcher @vscode/deviceid @vscode/native-watchdog `
     @vscode/policy-watcher @vscode/spdlog @vscode/sqlite3 @vscode/windows-mutex `
     @vscode/windows-registry kerberos native-is-elevated native-keymap

   # arm64 cross build: the host needs Microsoft.VisualStudio.Component.VC.Tools.ARM64
   # and Microsoft.VisualStudio.Component.VC.Runtimes.ARM64.Spectre
   $env:npm_config_arch = 'arm64'
   corepack pnpm@12.16.0 rebuild @parcel/watcher @vscode/deviceid @vscode/native-watchdog `
     @vscode/policy-watcher @vscode/spdlog @vscode/sqlite3 @vscode/windows-mutex `
     @vscode/windows-registry kerberos native-is-elevated native-keymap
   $env:npm_config_arch = $null
   ```

   `@vscode/windows-process-tree` has to be built outside the repository path; copy its
   `src/`, `binding.gyp` and a `node_modules/node-addon-api` to a short directory such as `C:\wpa`
   and run `node-gyp rebuild --arch=<arch>` with `npm_config_runtime=electron`,
   `npm_config_target=<electron version>` and `npm_config_disturl=https://electronjs.org/headers`,
   then copy `build\Release\windows_process_tree.node` back. `@vscode/fs-copyfile` is
   `type: none` on Windows and produces no binary.

   Before packaging, check every binary: the machine field at the PE header offset must be
   `0x8664` for x64 and `0xAA64` for arm64, and the packaged tree must contain the same list under
   `resources\app\node_modules.asar.unpacked`. Loading them through
   `ELECTRON_RUN_AS_NODE=1 <electron.exe> -e "require(...)"` catches a host-ABI build
   (Node 24 is v137, Electron 43.8.9 is v148).

   If `esbuild-bundle-*` aborts with `Build failed: Error: The service was stopped`, the esbuild
   service ran out of memory next to the extension bundling. Build the desktop bundle on its own and
   then package from it, which skips the failing step:

   ```powershell
   node build/next/index.ts bundle --out out-vscode --target desktop --nls
   corepack pnpm@12.16.0 run gulp vscode-win32-arm64-ci
   ```

   `vscode-win32-<arch>-ci` skips recompiling the core and packages whatever is already in
   `out-vscode`.

   The `-ci` task packages extensions from the `.build/extensions` staging cache, not from
   `extensions/`, so an edit to a built-in extension is invisible to it until that cache is
   refreshed. Run `corepack pnpm@12.16.0 run gulp compile-non-native-extensions-build` (or the
   `compile-native-extensions-build` / `compile-copilot-extension-build` tasks for those groups)
   before packaging. A stale `red-code-api` bundle reached `1.147.7` exactly this way: the fixed
   `dist` was in `extensions/`, while `.build/extensions/red-code-api` still held the old one.

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
