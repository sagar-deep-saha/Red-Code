# Security policy

## Reporting a vulnerability

Do **not** report security vulnerabilities through public GitHub issues, discussions or pull
requests.

Report a problem privately through GitHub's private vulnerability reporting on this repository
(**Security** tab → **Report a vulnerability**), or contact the maintainer of
`sagar-deep-saha/Red-Code` directly on GitHub.

Please include:

- the Red Code version from **Help > About** and your Windows version;
- the affected component — Workbench/core, Laravel index, API client, Git graph, Sync or Updates;
- reproduction steps and the impact you believe it has;
- whether the issue requires a malicious workspace, a malicious extension, or only a crafted
  server response.

You can expect an acknowledgement, a private place to discuss the details, and credit in the release
notes if you want it.

## Scope

Red Code is a fork of Visual Studio Code. Report vulnerabilities in the upstream editor to
[Microsoft's security process](https://aka.ms/SECURITY.md). Report problems in Red Code's own
extensions (`extensions/red-code*`), product identity, installer, update feed or Sync behavior here.

Areas worth extra care:

- **API client** — request bodies, headers, redirects and cookie handling. Credentials must never be
  logged or written to a collection file.
- **Laravel extension** — `route:list` and Artisan execution, `.env` handling (only `APP_URL` is
  read), secret redaction in the output channel, and Restricted Mode gating.
- **Git extension** — only read-only git commands are allowed; repository paths are validated
  before being passed to `git show`.
- **Updates** — an update is offered only with an HTTPS installer URL and a matching SHA-256.
- **Sync** — tokens live in the OS credential store, and credential-shaped settings are withheld by
  default.

## Supported versions

Only the latest published Red Code release receives security fixes. `releases/versions.json` lists
the current build and its installer hash.
