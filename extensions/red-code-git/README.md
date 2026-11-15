# Red Code Git

A small GitLens-style extension for Red Code. It adds a commit graph, inline blame and a
read-only commit inspector.

## Git Graph

Run **Red Code Git: Show Git Graph** from the command palette, the Source Control title bar or
the status bar. The graph lists commits with lanes for branches and merges, ref badges, the
subject, author, relative date and short SHA. Select a commit to see its full SHA, parents,
author, date, refs, message and changed files. Selecting a file loads that file's patch.

The list is paged. **Load More** requests the next page; the page size is controlled by
`redCode.git.graphPageSize` (default 300). Search filters the loaded commits by subject, author
or SHA.

## Inline Blame

**Red Code Git: Toggle Inline Blame** enables the `redCode.git.blame.enabled` setting. When it is
on, the active editor shows `author, relative time · short sha` after each line, with a hover
that includes the full SHA and commit summary. Untitled or unsaved documents, files larger than
2 MB and files with more than 20000 lines are skipped.

## Copy a SHA

**Red Code Git: Copy Commit SHA** shows the most recent commits and copies the selected full SHA
to the clipboard.

## Safety

The extension runs only read-only git commands: `rev-parse`, `log`, `show`, `blame` and
`status`. It never checks out, commits, pushes or modifies the repository. Git is started with
paging, prompts and optional locks disabled.
