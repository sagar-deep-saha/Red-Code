Red Code 1.147.4 adds the built-in API client and the git graph.

### API client

- New **Red Code API** extension: an HTTP client in the editor, so Laravel endpoints can be called
  without leaving Red Code. Requests are sent from the extension host with Node's `http`/`https`,
  so there is no browser CORS restriction.
- Request editor with method, URL, query parameters, headers, body modes (JSON, text, form, none),
  response status, headers, body, size and duration.
- Variables are merged from `redCode.api.variables` < `.env` (`baseUrl` falls back to `APP_URL`) <
  `.redcode/api/environments/<name>.json`.
- Collections live in `.redcode/api/collections/*.json`; `.http` files in the workspace open as
  requests too. Collections are browsable in the **API** view and refresh when files change.
- Laravel extras: **New Request from Route** reads `php artisan route:list --json` with the
  configured PHP binary, and a cookie jar plus `GET /sanctum/csrf-cookie` sends `X-XSRF-TOKEN` on
  state-changing requests.

### Git graph

- New **Red Code Git** extension: a GitLens-style commit graph with lanes for branches and merges,
  ref badges, search, paging and a status bar entry.
- Selecting a commit shows its full SHA, parents, author, date, refs, message and changed files;
  selecting a file loads that file's patch, with a 300 KB display cap.
- Optional inline blame decorates the active editor with author, relative time and short SHA, and a
  hover holds the full commit summary. Only read-only git commands are used.
- **Copy Commit SHA** and **Toggle Inline Blame** commands; page size is configurable.
