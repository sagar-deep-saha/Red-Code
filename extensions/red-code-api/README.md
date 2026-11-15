# Red Code API

Sends HTTP requests from inside Red Code and keeps them in the workspace, so an API test is a file
you can review, diff and commit instead of a tab in a separate app.

Requests run in the extension host with Node's `http`/`https` modules. There is no proxy and no
CORS: a local Laravel app answers the same way it answers `curl`.

## Where requests live

```
.redcode/api/collections/<name>.json   collections you create in the editor
.redcode/api/environments/<name>.json  optional variable sets
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

`.http` files use the usual layout: request line, headers, blank line, body, `###` between requests.
They are listed in the sidebar and can be sent, but editing them stays a text edit.

## Variables

`{{name}}` is replaced in URLs, parameters, headers and bodies. Later sources win:

1. `redCode.api.variables` (user setting)
2. `.env` in the workspace root — `baseUrl` is added as an alias of `APP_URL`
3. `.redcode/api/environments/<redCode.api.environment>.json`

Unknown variables are left in place and reported when the request fails, so a typo is visible
instead of silently sending `{{baseUrl}}` to the server.

## Laravel extras

- **New Request from Laravel Route** runs `php artisan route:list --json` (using
  `redCode.laravel.phpPath` when set) and prefills method, path and `{{baseUrl}}`.
- **Fetch Laravel CSRF Cookie** calls `/sanctum/csrf-cookie` and stores the session cookie.
- When `redCode.api.laravelCsrf` is on, a non-GET request sends `X-XSRF-TOKEN` decoded from the
  `XSRF-TOKEN` cookie, and fetches the cookie first when it is missing.
- Cookies are kept in memory for the session, so a login request authenticates the next request.

## Scope

No scripting, no OAuth2 flows, no GraphQL schema introspection and no request history database in
this version. The response body is shown as text, up to 8 MB, with JSON pretty-printed on demand.
