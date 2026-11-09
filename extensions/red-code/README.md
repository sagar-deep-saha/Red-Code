# Red Code Productivity

This built-in extension adds a Project Bookmarks tree and a read-only Workspace Doctor view to Red Code. It uses standard VS Code extension APIs and does not change the default Welcome page, Tasks, Zen Mode, Explorer, or source editor.

## Project Bookmarks

- Use **Red Code: Add to Project Bookmarks** in the Explorer context menu to bookmark a file or folder, or run the command and select multiple workspace items.
- Use **Red Code: Bookmark Active File** from the Command Palette for the current editor file.
- Click a file bookmark to open it. Click a folder bookmark to reveal it in Explorer.
- Remove a bookmark from its context menu.
- Bookmarks are saved in workspace extension state as workspace-relative paths, so they can be resolved after a workspace folder is moved. Multi-root workspaces use the saved folder name and index; duplicate names can be ambiguous after reordering.

## Workspace Doctor

- **Scan Workspace** checks a bounded set of project markers such as Git metadata, JavaScript and Composer manifests, lockfiles, dependency directories, and `.env` presence.
- It never reads `.env` contents and does not install or repair dependencies.
- **Check Installed Tools** asks for confirmation, then runs fixed `--version` checks for Git, Node.js, npm, PHP, and Composer from the system temporary directory. It does not execute project scripts and does not display inherited environment variables.
- Tool checks run in the current Node extension host, which may be remote when using a remote workspace. The extension host PATH determines which tools it finds. A failed or timed-out probe is reported as unavailable.

The extension supports workspace trust and virtual workspace file checks. It does not run project-defined commands. Automated model tests can be run with `pnpm --dir extensions/red-code test` from the repository root.
