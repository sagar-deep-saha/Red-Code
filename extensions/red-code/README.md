# Red Code Productivity

This built-in extension adds a Project Bookmarks tree, a read-only Workspace Doctor view and a Changed Files deployment view to Red Code. It uses standard VS Code extension APIs and does not change the default Welcome page, Tasks, Zen Mode, Explorer, or source editor.

## Changed Files

Builds the exact file set that moves a server from one commit to another, which is what a host that only accepts individual uploads needs.

- **Select Commit Range…** — every file that differs between two commits, in the state of the newer commit.
- **Select Commits…** — check any number of commits; their changes are combined, oldest to newest, so a later change wins.
- Files changed in several commits appear **once**. A rename becomes an upload of the new path plus a deletion of the old one.
- **Export Deployment ZIP…** writes the newest version of every changed file, read from the selected commit (not the working tree), plus `RED-CODE-DEPLOY.txt` listing what to upload and what to delete.
- **Copy Changed File Paths** and **Copy Files to Delete** put the lists on the clipboard.
- Excluded by default: `vendor/**`, `node_modules/**`, `storage/**`, `bootstrap/cache/**`, `.git/**`, `.env`, `.env.*`, `public/hot`. Edit `redCode.deploy.excludePaths` to change this.

A file that was added and then deleted inside the selection is not reported, because the server never needs it. A file that existed before the selection and is gone after it is reported as a deletion. Everything is read-only: the extension never checks out, stages, commits or touches the working tree, and the view is unavailable in Restricted Mode.

## Project Bookmarks

- Use **Red Code: Add to Project Bookmarks** in the Explorer context menu to bookmark a file or folder, or run the command and select multiple workspace items.
- Use **Red Code: Bookmark Active File** from the Command Palette for the current editor file.
- Click a file bookmark to open it. Click a folder bookmark to reveal it in Explorer.
- Remove a bookmark from its context menu.
- Bookmarks follow renamed or moved files and folders, and are removed automatically when their target is deleted. Bookmarked files also show a badge in the Explorer.
- Bookmarks are saved in workspace extension state as workspace-relative paths, so they can be resolved after a workspace folder is moved. Multi-root workspaces use the saved folder name and index; duplicate names can be ambiguous after reordering.

## Workspace Doctor

- **Scan Workspace** checks a bounded set of project markers such as Git metadata, JavaScript and Composer manifests, lockfiles, dependency directories, and `.env` presence.
- Results are grouped into **Workspace** findings and **Tools**, and each group summarizes how many checks reported warnings.
- It never reads `.env` contents and does not install or repair dependencies.
- **Check Installed Tools** asks for confirmation, then runs fixed `--version` checks for Git, Node.js, npm, PHP, and Composer from the system temporary directory. It does not execute project scripts and does not display inherited environment variables. In Restricted Mode the tool checks are skipped until the workspace is trusted.
- Tool checks run in the current Node extension host, which may be remote when using a remote workspace. The extension host PATH determines which tools it finds. A failed or timed-out probe is reported as unavailable.

The extension supports workspace trust and virtual workspace file checks. It does not run project-defined commands. Automated model tests can be run with `pnpm --dir extensions/red-code test` from the repository root; the real-git deployment check is `node ./scripts/verify-deploy.mjs` after compiling.
