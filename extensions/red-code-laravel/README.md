# Red Code Laravel

Laravel-aware tooling for Red Code, built on a single semantic index rather than a set of unrelated
commands. The index is assembled from three layers:

1. **Authoritative** — `php artisan route:list --json` (and `list --format=json`) run with a fixed
   argument array.
2. **Static** — an incremental, bounded scan of project files (PHP classes, Eloquent relations,
   migrations, Blade views and references). `vendor`, `node_modules` and `storage` are never read.
3. **Project metadata** — `composer.lock`, `.env` key names (`APP_URL` only), the PHP interpreter
   found on this machine, and the live database schema when it is reachable.

Every view and navigation target queries the same graph, so a route, its controller method, its
Blade view and a component's usages cannot disagree.

## Views

The **Laravel** Activity Bar container has nine views:

| View | Contents |
|---|---|
| **Project** | A generated tree by Laravel role (HTTP, Application, Views, Database, Configuration, Tests, Packages) instead of raw folders. The normal Explorer is untouched. |
| **Routes** | Routes grouped by middleware, with controller method, middleware and declaration line. Vendor routes hidden by default. |
| **Models** | Eloquent models with their relations and target classes; selecting a relation jumps to the declaration. |
| **Database** | Tables and columns read from the live connection with `db:show`/`db:table --json`, falling back to the migration index when the database is unreachable. |
| **Components** | Blade components and class-based components with their views. |
| **Migrations** | Migration files in order, with the tables and columns each one creates or alters. |
| **Environment** | Key names in `.env` compared with `.env.example`; values are never shown. **Add Missing Keys…** appends only the missing keys. |
| **Logs** | Entries from the newest `storage/logs/*.log`, filtered by level, with an optional tail. Only a configurable tail window is read, so a large log stays responsive. |
| **Artisan** | Every visible command, grouped by namespace. Selecting a command opens a form generated from its own `definition` (arguments, flags and value options), with a preview of the exact `php artisan …` invocation before it runs. |

Route context menu: **Go to Controller**, **Copy Route URI**, **Copy cURL**, **Open Route in
Browser**. Long-running Artisan commands (`serve`, `queue:work`, `tinker`, `pail`, …) open in a
terminal instead of being captured.

## Navigation

Clickable links, backed by the index, in PHP and Blade:

| In source | Goes to |
|---|---|
| `route('posts.show')` | the route declaration, or the controller method |
| `view('posts.index')`, `View::make(…)` | the Blade file |
| `@include`, `@extends`, `@component` | the referenced view |
| `<x-alert />` | the component view |
| `@vite('resources/…')` | the asset |

Links only appear when the target actually resolves; dynamic arguments are ignored rather than
guessed.

## Tests

PHPUnit and Pest runs are published into the native **Testing** view. Discovery reads the project's
test classes, a run uses `vendor/bin/phpunit`/`pest` with JUnit output (never `artisan test`, which
does not forward `--log-junit`), failures show their file and line, and failed tests produce
diagnostics. Tests require a trusted workspace. Pest runs can pass `--parallel` with
`redCode.laravel.test.parallel`.

## Commands

- **Laravel: Show Project Information** — Laravel version, PHP version/path, environment, debug
  mode, database, queue and cache drivers.
- **Laravel: Refresh Index**, **Laravel: Command Palette** (default `Ctrl+Alt+L`) and
  **Laravel: Inspect Class**.
- Environment: **Refresh Environment**, **Add Missing Keys…**, **Open .env**.
- Logs: **Refresh Logs**, **Level Filter**, **Start/Stop Tailing Log**, **Open Log Entry**.
- Routes and navigation: **Go to Controller**, **Copy Route URI**, **Copy cURL**, **Open Route in
  Browser**, **Open Location**.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `redCode.laravel.phpPath` | `""` | Absolute path to `php.exe`. Empty = detect Herd's active PHP, then PATH. |
| `redCode.laravel.routes.showVendor` | `false` | Include package-registered routes. |
| `redCode.laravel.index.maxFiles` | `20000` | Scan bound; larger projects truncate instead of hanging. |
| `redCode.laravel.index.autoRefresh` | `true` | Rebuild a few seconds after PHP/Blade/composer/`.env` changes. |
| `redCode.laravel.envFile` | `".env"` | File compared with `<file>.example`. Only key names are read. |
| `redCode.laravel.logTailMb` | `2` | How much of the end of the newest log is read, 0.1–50 MB. |
| `redCode.laravel.test.parallel` | `false` | Pass `--parallel` to Pest (PHPUnit has no such option). |

## PHP resolution

1. `redCode.laravel.phpPath`, if set and it points at a `php.exe`.
2. Herd's selected CLI version, read from `%USERPROFILE%\.config\herd\bin\php.bat` (parsed, never run).
3. Herd `php85`, `php84`, `php83` in that order.
4. `php.exe` on `PATH`.

Batch files are never executed: Node cannot launch `.bat`/`.cmd` without a shell, and running project
tooling through one would be unpredictable. Wrong configuration produces a warning, not a guess.

## Safety

- Every artisan invocation is logged to the **Red Code Laravel** output channel with secret-looking
  assignments redacted.
- `LARAVEL_SAIL=0` and `NO_COLOR=1` are set so output is parseable and Sail cannot intercept calls.
- **Restricted Mode**: detection, the static index, Environment key names and read-only information
  work. `route:list`, `list`, `about`, `db:show`/`db:table`, Artisan execution and test runs are
  disabled until the workspace is trusted.
- `.env` values are never displayed or logged; only keys and `APP_URL` are read.
- The database schema is read with read-only Artisan commands; nothing writes to the database.

## Development

```sh
npm run compile   # esbuild bundle → dist/extension.js
npm test          # tsc + node --test "out/test/*.test.js"
```

No core patches and no build-system changes: `build/lib/extensions.ts` rewrites `./out/` to
`./dist/` automatically when `esbuild.mts` is present.
