# Red Code Git

A small GitLens-style extension for Red Code. It adds a commit graph, inline blame and a
read-only commit inspector.

## Git Graph

Run **Red Code Git: Show Git Graph** from the command palette, the Source Control title bar or
the status bar. The graph lists commits with lanes for branches and merges, ref badges, the
subject, author, relative date and short SHA. Select a commit to see its full SHA, parents,
author, date, refs, message and changed files. Selecting a file loads that file's patch.

The graph includes a compact history overview and separate branch/tag, graph and commit columns.
The list is paged. **Load More** requests the next page; the page size is controlled by
`redCode.git.graphPageSize` (default 300). Search filters the loaded commits by subject, author
or SHA. Author initials are shown by default. To load Gravatar photos, enable
`redCode.git.graphAvatars.enabled`; this sends a hashed author email to Gravatar.

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
| `redCode.git.graphAvatars.enabled` | `false` | Load author photos from Gravatar. Sends a hashed author email to Gravatar; otherwise initials are shown. |
| `redCode.git.blame.enabled` | `false` | Inline blame annotations in the active editor. |

## Commands

| Command | What it does |
|---|---|
| `Red Code Git: Show Git Graph` | Opens or reveals the graph panel for the selected repository. |
| `Red Code Git: Refresh Git Graph` | Reloads the graph and the status bar summary. |
| `Red Code Git: Toggle Inline Blame` | Turns `redCode.git.blame.enabled` on or off. |
| `Red Code Git: Copy Commit SHA` | Picks a recent commit and copies its full SHA. |

## Safety

The extension runs only read-only git commands: `rev-parse`, `log`, `show`, `blame` and
`status`. It never checks out, commits, pushes or modifies the repository. Git is started with
paging, prompts and optional locks disabled.
