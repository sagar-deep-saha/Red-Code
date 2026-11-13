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
     --version 1.147.2 --tag v1.147.2 --repository sagar-deep-saha/Red-Code `
     --installer-url https://github.com/sagar-deep-saha/Red-Code/releases/download/v1.147.2/RedCode-Setup.exe
   ```

   This hashes the installer, appends to `releases/versions.json`, writes
   `releases/redcode-updates.json` and copies `CHANGELOG.md` into the updater extension.

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

## How an installed build sees an update

`red-code-updates` asks the GitHub Releases API (or `redCode.updates.feedUrl`) on startup, at most
once every six hours, and when the status bar button is clicked. It offers only releases newer than
`vscode.version` with a valid HTTPS installer URL and SHA-256. Nothing is downloaded until the user
chooses **Download & Install**, and the installer is not run until the hash matches.
