Download `RedCode-Setup.exe` for Windows x64, or `RedCode-Setup-arm64.exe` for Windows on ARM.

### Git graph

- **The commit graph now looks and behaves like GitLens.** Wide panels use the compact 24px table
  layout with the GitLens column set — Branches / Tags, Message, Author, Changes, Date and SHA —
  an uppercase muted header and 10px lanes. Narrow views, including the Activity Bar sidebar,
  automatically switch to the two-line list layout: message on the first line, ref pills, short
  SHA, author and relative date on the second.
- **Ref pills follow the GitLens language.** Small outline pills with branch, cloud and tag icons,
  a filled Laravel-red HEAD pill and a `+N` overflow pill. Clicking a pill still only filters the
  history; the graph stays read-only.
- **Working Changes row refreshed** with the current branch pill, commit-style message and change
  counts, and the details pane uses the same dense header language.
- **The graph is discoverable from the Activity Bar.** A new **Red Code Git** container opens the
  commit graph as a sidebar view, not only as a command or SCM title action.
- Columns and layout stay configurable: Committer is off by default (matching GitLens), the
  minimap and merge-commit dimming are off by default, and the Columns menu still exposes all of
  them with resize handles.

### Fixed

- Manually copied built-in extensions now point their `main` entry at `dist/extension.js`, so the
  installed **Red Code Git** extension activates and the graph view loads.

Nothing else changed: this release keeps the 1.147.12 ConPTY terminal fix, the 1.147.11 classic
square VS Code layout, the 1.147.10 GitHub avatar support and the 1.147.7 native-module fix.

### Platforms

- Red Code ships **Windows x64 and Windows arm64** only. macOS and Linux are not offered.
