# Red Code Laravel

Laravel-aware tooling for Red Code, built on a single semantic index rather than a set of unrelated
commands. The index is assembled from three layers:

1. **Authoritative** — `php artisan route:list --json` (and `list --format=json`) run with a fixed
   argument array.
2. **Static** — an incremental, bounded scan of project files (PHP classes, Eloquent relations,
   Blade views and references). `vendor`, `node_modules` and `storage` are never read.
3. **Project metadata** — `composer.lock`, `.env` (`APP_URL` only), and the PHP interpreter found on
   this machine.

Every view and navigation target queries the same graph, so a route, its controller method, its
Blade view and a component's usages cannot disagree.

## Features (S0 + S1)

### Laravel container

A dedicated Activity Bar container with three views:

- **Project** — a generated tree by Laravel role (HTTP, Application, Views, Database, Configuration,
  Tests, Packages) instead of raw folders. The normal Explorer is untouched.
- **Routes** — routes grouped by middleware. Expanding a route shows its controller method,
  middleware and the declaration line when Laravel exposes one. Context menu: **Go to Controller**,
  **Copy Route URI**, **Copy cURL**, **Open Route in Browser**. Vendor routes are hidden by default.
- **Artisan** — every visible command, grouped by namespace. Selecting a command opens a form
  generated from the command's own `definition` (arguments, flags and value options), with a
  preview of the exact `php artisan …` invocation before it runs. Long-running commands
  (`serve`, `queue:work`, `tinker`, `pail`, …) open in a terminal instead of being captured.

### Navigation

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

### Inspect Class

**Laravel: Inspect Class** (`Ctrl+Alt+L` opens the Artisan palette) on a PHP file lists the class,
its routes, and its Eloquent relations, each jumping to the real line.

### Commands

- `Laravel: Show Project Information` — Laravel version, PHP version/path, environment, debug mode,
  database, queue and cache drivers.
- `Laravel: Refresh Index`
- `Laravel: Command Palette` / `Laravel: Run Artisan Command`
- `Laravel: Inspect Class`

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `redCode.laravel.phpPath` | `""` | Absolute path to `php.exe`. Empty = auto-detect. |
| `redCode.laravel.routes.showVendor` | `false` | Include package-registered routes. |
| `redCode.laravel.index.maxFiles` | `20000` | Scan bound; larger projects truncate instead of hanging. |
| `redCode.laravel.index.autoRefresh` | `true` | Rebuild a few seconds after PHP/Blade/composer/`.env` changes. |

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
- **Restricted Mode**: detection, the static index, and read-only information work. `route:list`,
  `list`, `about` and every Artisan execution are disabled until the workspace is trusted.
- `.env` values are never displayed or logged; only `APP_URL` is read, to build route URLs.

## Development

```sh
npm run compile   # esbuild bundle → dist/extension.js
npm test          # tsc + node --test "out/test/*.test.js"
```

No core patches and no build-system changes: `build/lib/extensions.ts` rewrites `./out/` to
`./dist/` automatically when `esbuild.mts` is present.
