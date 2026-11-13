Red Code 1.147.3 fixes GitHub sync uploads.

### GitHub sync

- Fix the first upload failing with HTTP 422. The Gist payload now carries only files that have
  content, and deletes a snapshot file only when the remote Gist still has it, so GitHub's rule that
  `null` is a delete for an existing file (and invalid otherwise) is respected. Unknown files in the
  Gist are never touched.
- Show GitHub's own validation message instead of a bare "rejected the sync data".
- Derive the status bar from the token a sync would use, so a stored but unrecognised session no
  longer leaves the bar showing "Sign in to Sync".
