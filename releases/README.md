# Red Code releases

Every Red Code build is recorded here. `versions.json` is the machine-readable history (version,
date, installer URL, SHA-256, size, notes); `redcode-updates.json` is the feed the updater reads.

## Version scheme

Keep the upstream `major.minor` and increment the patch for each Red Code build:

| Build | Version |
|---|---|
| VS Code 1.147.0, first Red Code build | `1.147.0` |
| First published Red Code build | `1.147.1` |
| Next Red Code build | `1.147.2` |

`1.147.0` was built locally and never published, so `versions.json` starts at `1.147.1`; a history
must not advertise a download that does not exist.

The version lives in `package.json`. The build writes it into `product.json`, which is what the
editor reports as `vscode.version`. Pre-releases use a suffix (`1.147.3-beta.1`) and are only
offered when `redCode.updates.includePrerelease` is on.

## Releasing

1. Bump `version` in `package.json` and add a section to `CHANGELOG.md`.
2. Build the app and the installer:

   ```powershell
   $env:PATH = "C:\Users\sagar\.config\herd\bin\nvm\v24.22.1;$env:PATH"
   corepack pnpm@12.16.0 run gulp vscode-win32-x64
   corepack pnpm@12.16.0 run gulp vscode-win32-x64-user-setup
   ```

   The Inno Setup compiler comes from the `innosetup` npm package; nothing has to be installed
   globally. Two tools must be on `PATH` for a local (non-CI) build: Node 24.22.1 and the Windows
   SDK `signtool.exe` (`C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64`), because
   packaging strips Authenticode signatures from bundled binaries before stamping new version
   information into them.

3. Record the build and generate the feed:

   ```powershell
   node build/red-code/release-manifest.mjs `
     --installer ..\VSCode-win32-x64\.build\win32-x64\user-setup\VSCodeSetup.exe `
     --asset-name RedCode-Setup.exe `
     --version 1.147.2 --tag v1.147.2 --repository sagar-deep-saha/Red-Code
   ```

   This hashes the installer, appends to `releases/versions.json`, writes
   `releases/redcode-updates.json` and copies `CHANGELOG.md` into the updater extension.

   `--asset-name` is the file name the installer is uploaded as, and it is the name the feed
   records, so the download URL cannot point at an asset the release does not carry.

   The record is only written when the version in `package.json` and the `product.json` inside
   the packaged app both match `--version`. A stale build tree therefore fails here instead of
   being published and then reporting an older version after an update.

   If the repository lives under a deep path, Inno Setup cannot stat bundled files
   whose full path passes 260 characters (Copilot's nested `node_modules` does this).
   Point the setup task at a short-path junction instead of moving the tree:

   ```powershell
   cmd /c mklink /J C:\rcapp "..\VSCode-win32-x64"
   $env:VSCODE_SETUP_SOURCE_DIR = 'C:\rcapp'
   corepack pnpm@12.16.0 run gulp vscode-win32-x64-user-setup
   ```

4. Publish the GitHub release and attach both files:

   ```powershell
   gh release create v1.147.2 `
     "...\VSCodeSetup.exe#RedCode-Setup.exe" `
     "releases\redcode-updates.json" `
     --repo sagar-deep-saha/Red-Code `
     --title "Red Code 1.147.2" --notes-file "releases\notes-1.147.2.md"
   ```

   The updater accepts any asset named `RedCode-Setup*.exe`. It reads the SHA-256 from
   `redcode-updates.json` first, and falls back to the digest GitHub reports for the EXE.
   Upload the installer under the same name that was passed as `--asset-name`.

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
