Download `RedCode-Setup.exe` for Windows x64, or `RedCode-Setup-arm64.exe` for Windows on ARM.

### Git graph

- **The commit graph can show the real GitHub profile photo of every author.** Enable
  `redCode.git.graphAvatars.enabled` and the author and committer columns, the details pane and the
  working-changes row show the photo instead of initials.
- **No sign-in prompt and no GitLens account.** The graph reuses the GitHub session Copilot already
  created, resolves the photo through the public commit API by author email and caches it, so a
  page of commits from a few authors costs a handful of requests. Without a session, on a
  non-GitHub remote or when GitHub has no photo, the initials stay. Signing in or out refreshes the
  panel automatically.
- `redCode.git.graphAvatars.provider` chooses the source: `github` (default) uses the GitHub
  session, `gravatar` sends a hashed author email to Gravatar without GitHub access. Both paths
  keep the graph read-only.

Nothing else changed: this release keeps the 1.147.9 GitLens-parity graph, the 1.147.8 API-panel
fix and the 1.147.7 native-module fix.

### Platforms

- Red Code ships **Windows x64 and Windows arm64** only. macOS and Linux are not offered.
