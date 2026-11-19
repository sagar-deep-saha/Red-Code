# Red Code Git

A small GitLens-style extension for Red Code. It adds a commit graph, inline blame and a
read-only commit inspector.

## Git Graph

Run **Red Code Git: Show Git Graph** from the command palette, the Source Control title bar or
the status bar. The panel opens on the active repository and shows:

- a graph column with bezier lanes for branches, merges and tags, plus a compact history minimap
  that jumps to a commit when clicked;
- columns for branch/tag refs, the commit message, author, committer, relative date, short SHA and
  the files/additions/deletions of the commit. Columns can be hidden, resized by dragging a header
  edge and reset from the columns menu, and the changes column renders as a bar, numbers or
  squares;
- a working-changes row above the history with the uncommitted file count. Selecting it lists the
  working files and opens their diffs against `HEAD`;
- ref pills that filter the history by that branch or tag. The branch chip opens the full branch
  picker and the filter menu switches between all, current, local, remote and tag scopes. Filters
  never check out or switch a branch.

Select a commit to fill the details pane: full SHA, parents, author and committer with dates, refs,
message body and the changed files with their status and line counts. Each file opens a real
read-only diff between the commit and its first parent, and the details actions open the whole
commit, compare it with the working tree or copy the SHA. The details pane width is resizable and
the pane can be hidden with **Alt+D** or the layout button.

Rows have hover actions (copy SHA, open changes, more) and a context menu with copy actions, commit
changes, compare with the working tree and refresh. Selecting a row loads its details; double-click
opens the changes. The header stays visible while the list scrolls, and the list is virtualized, so
large pages stay smooth.

The list is paged. **Load More** requests the next page; the page size is controlled by
`redCode.git.graphPageSize` (default 300). Author initials are shown by default. Enable
`redCode.git.graphAvatars.enabled` to show real photos in the graph and in the commit details.

Photos come from GitHub by default (`redCode.git.graphAvatars.provider` = `github`). The graph
reuses the GitHub account you are already signed in with — Copilot creates that session — and never
opens a sign-in prompt: without a session, or for a repository that is not hosted on GitHub, the
initials stay. The avatar is resolved from the public commit API by author email and cached, so a
page of commits from a few authors costs a few requests. Signing in later (or out) refreshes the
panel automatically.

Set the provider to `gravatar` instead if you prefer not to give the graph GitHub access; that path
sends a hashed author email to Gravatar. Either way the graph still stays read-only.

### Search

The search box filters the loaded commits in the extension host, not in the panel, so the same
rules apply everywhere. It understands GitLens-style field prefixes:

| Prefix | Matches |
|---|---|
| `message:` or `commit:` | the commit subject |
| `author:` | the author name and email |
| `committer:` | the committer name and email |
| `sha:` | the full and short SHA |
| `ref:` or `refs:` | branch, remote and tag names |
| `is:merge` or `type:merge` | commits with more than one parent |

Plain text searches every field at once; `-prefix:value` excludes matches; quoted values keep
spaces; `after:YYYY-MM-DD` and `before:YYYY-MM-DD` bound the commit date. The search options menu
adds match case, whole word, regular expression and match-all (AND). **F3** and **Shift+F3** step
through the matches, **Ctrl+F** focuses the search box and **Esc** closes the open menus.

## Inline Blame

**Red Code Git: Toggle Inline Blame** enables the `redCode.git.blame.enabled` setting. When it is
on, the active editor shows `author, relative time · short sha` after each line, with a hover
that includes the full SHA and commit summary. Untitled or unsaved documents, files larger than
2 MB and files with more than 20000 lines are skipped.

## Copy a SHA

**Red Code Git: Copy Commit SHA** shows the most recent commits and copies the selected full SHA
to the clipboard.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `redCode.git.graphPageSize` | `300` | Commits loaded per page, 50–5000. **Load More** adds another page. |
| `redCode.git.graphAvatars.enabled` | `false` | Show author photos in the graph and details pane. Uses the signed-in GitHub account silently; falls back to initials. |
| `redCode.git.graphAvatars.provider` | `github` | `github` resolves photos through the GitHub session and commit API. `gravatar` sends a hashed author email to Gravatar instead. |
| `redCode.git.blame.enabled` | `false` | Inline blame annotations in the active editor. |

The graph layout (visible columns, column widths, changes style, minimap and details pane) is
remembered per panel through the webview state.

## Commands

| Command | What it does |
|---|---|
| `Red Code Git: Show Git Graph` | Opens or reveals the graph panel for the selected repository. |
| `Red Code Git: Refresh Git Graph` | Reloads the graph and the status bar summary. |
| `Red Code Git: Toggle Inline Blame` | Turns `redCode.git.blame.enabled` on or off. |
| `Red Code Git: Copy Commit SHA` | Picks a recent commit and copies its full SHA. |

## Safety

The extension runs only read-only git commands: `rev-parse`, `log`, `show`, `blame`, `status`,
`rev-list`, `for-each-ref`, `remote` and `config --get`. It never checks out, commits, pushes or
modifies the repository. Git is started with paging, prompts and optional locks disabled. Diffs are
served from a `redcode-git:` document provider backed by `git show <rev>:<path>`, so the editor
shows committed content without touching the working tree.
