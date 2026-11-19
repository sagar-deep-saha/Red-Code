Download `RedCode-Setup.exe` for Windows x64, or `RedCode-Setup-arm64.exe` for Windows on ARM.

### Git graph

- **The commit graph is now a GitLens-style graph, not a simplified one.** It has separate graph,
  branch/tag, commit message, author, committer, date, SHA and changes columns, a sticky header,
  resizable column edges and a columns menu that hides any column and switches the changes column
  between a bar, numbers and squares.
- Lanes are drawn as smooth bezier curves, the minimap jumps to a commit when clicked, and rows
  outside the current branch are dimmed.
- A working-changes row lists uncommitted files. Selecting a file opens its diff against `HEAD`,
  and untracked files diff against an empty document.
- Every commit row has hover actions and a context menu: copy the SHA or message, open the commit
  changes, compare the commit with the working tree, show details and refresh.
- Select a commit for a details pane with author and committer dates, refs, message body, a file
  summary and per-file additions/deletions. Each file opens a real read-only diff between the
  commit and its first parent, and the pane is resizable, toggleable with **Alt+D** and remembers
  its state.
- The branch chip and ref pills filter the history by branch, remote or tag, with all, current,
  local, remote and tag scopes. Filtering stays read-only: no branch is ever checked out.
- Search runs in the extension host with GitLens-style `message:`, `commit:`, `author:`,
  `committer:`, `sha:`, `ref:`, `is:merge`, `after:` and `before:` prefixes, negation, quoted
  values and match case, whole word, regular expression and match-all options. **F3** and
  **Shift+F3** step through the matches.

Nothing else changed: this release keeps the 1.147.8 API-panel fix and the 1.147.7 native-module
fix.

### Platforms

- Red Code ships **Windows x64 and Windows arm64** only. macOS and Linux are not offered.
