# Red Code API

Sends HTTP requests from inside Red Code and keeps them in the workspace, so an API test is a file
you can review, diff and commit instead of a tab in a separate app.

Requests run in the extension host with Node's `http`/`https` modules. There is no proxy and no
CORS: a local Laravel app answers the same way it answers `curl`.

## Where requests live

```
.redcode/api/collections/<name>.json   collections you create in the editor
.redcode/api/environments/<name>.json  optional variable sets
.redcode/api/base-urls.json            named base URL profiles
*.http                                 plain request files, read-only in this extension
```

A collection file is ordinary JSON:

```json
{
	"name": "Users",
	"requests": [
		{
			"name": "List users",
			"method": "GET",
			"url": "{{baseUrl}}/api/users",
			"params": [{ "name": "page", "value": "1", "enabled": true }],
			"headers": [{ "name": "Accept", "value": "application/json", "enabled": true }],
			"body": { "mode": "none", "text": "" }
		}
	]
}
```

Create collections from the Collections view. `.http` files use the usual layout: request line,
headers, blank line, body, `###` between requests. They are listed in the sidebar and can be sent,
but editing them stays a text edit.

## Variables

`{{name}}` is replaced in URLs, parameters, headers and bodies. Later sources win:

1. `redCode.api.variables` (user setting)
2. `.env` in the workspace root — `baseUrl` is added as an alias of `APP_URL`
3. `.redcode/api/environments/<redCode.api.environment>.json`

Unknown variables are left in place and reported before the request is sent, so a typo is visible
instead of silently sending `{{baseUrl}}` to the server. Each request tab can override `baseUrl`
with its editable field; named URL profiles are stored in `.redcode/api/base-urls.json` and can be
switched from the dropdown. When a request URL starts with the previous base URL, changing profiles
converts that prefix to `{{baseUrl}}` so the endpoint follows the selection. Saving requests to
collections makes them available in the saved endpoint dropdown, so a tab can switch endpoints
without closing.

## Request panel

- Method, URL, query parameters and headers, each row with an enable checkbox.
- Editable base URL with named profiles, plus a dropdown to switch among saved collection endpoints.
- Body modes: **none**, **JSON** and **text**.
- Each request opens in its own editor tab. Drafts and responses are restored after a window restart;
  response bodies over 512 KB are omitted from the saved tab state. Use **Red Code API: Duplicate
  Active Request Tab** or the tab's copy action to clone a request.
- The response shows status, status text, headers, body, size and duration. JSON responses are
  pretty-printed when the body parses. Bodies are read up to 8 MB and marked truncated beyond that.
- GET and HEAD never carry a body.
- Redirects are followed up to 5 hops unless `redCode.api.followRedirects` is off.
- A connection failure, timeout and TLS error are reported in plain words. A 4xx/5xx is a normal
  response, not an error.

## Laravel extras

- **New Request from Laravel Route** runs `php artisan route:list --json` (using
  `redCode.laravel.phpPath` when set) and prefills method, path and `{{baseUrl}}`.
- **Fetch Laravel CSRF Cookie** calls `/sanctum/csrf-cookie` and stores the session cookie.
- When `redCode.api.laravelCsrf` is on, a non-GET request sends `X-XSRF-TOKEN` decoded from the
  `XSRF-TOKEN` cookie, and fetches the cookie first when it is missing.
- Cookies are kept in memory for the session, so a login request authenticates the next request.
  **Clear Cookies** empties the jar.

## Commands

| Command | What it does |
|---|---|
| `Red Code API: New Collection` | Creates an empty workspace collection. |
| `Red Code API: New Request` | Opens the request editor with a blank request. |
| `Red Code API: New Request from Laravel Route` | Picks a route from `route:list` and prefills a request. |
| `Red Code API: Duplicate Active Request Tab` | Opens a copy of the active request, including unsaved edits. |
| `Red Code API: Select Environment` | Chooses the environment file to layer over `.env`. |
| `Red Code API: Fetch Laravel CSRF Cookie` | Stores the Sanctum session and XSRF cookies. |
| `Red Code API: Clear Cookies` | Empties the in-memory cookie jar. |
| `Red Code API: Refresh Collections` | Rescans `.redcode/api/collections` and `.http` files. |

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `redCode.api.variables` | `{}` | Variables applied before `.env` and the environment file. |
| `redCode.api.environment` | `""` | Name of `.redcode/api/environments/<name>.json`; empty = none. |
| `redCode.api.timeoutMs` | `30000` | Request timeout, 1000–300000 ms. |
| `redCode.api.verifyTls` | `true` | Verify HTTPS certificates. |
| `redCode.api.followRedirects` | `true` | Follow up to 5 redirects. |
| `redCode.api.laravelCsrf` | `true` | Fetch and send Sanctum's `X-XSRF-TOKEN`. |

## Scope

No scripting, no OAuth2 flows and no GraphQL schema introspection in this version. Collections and
base URL profiles are reviewable workspace JSON files; unsaved request tabs are restored by the
editor but are not added to a collection until saved.
