# Red Code Updates

Checks for new Red Code builds, downloads the installer over HTTPS, verifies the published SHA-256
and only then offers to run it. The running version is always `vscode.version`.

## Where updates come from

1. `redCode.updates.feedUrl` — any HTTPS URL returning the feed schema below. Takes precedence.
2. `redCode.updates.repository` (default `sagar-deep-saha/Red-Code`) — GitHub Releases. The extension
   reads the Releases API and prefers a `redcode-updates.json` asset published with the release,
   falling back to the SHA-256 digest GitHub reports for `RedCode-Setup*.exe`.

An update is offered only when it has a version, an HTTPS installer URL and a valid SHA-256. Anything
else is ignored: the extension is deliberately unable to offer an unverifiable download.

## Feed schema

```json
{
	"releases": [
		{
			"version": "1.147.4",
			"date": "2026-11-15T23:22:15.097Z",
			"prerelease": false,
			"notes": "API client and Git graph.",
			"pageUrl": "https://github.com/sagar-deep-saha/Red-Code/releases/tag/v1.147.4",
			"installer": {
				"url": "https://github.com/sagar-deep-saha/Red-Code/releases/download/v1.147.4/RedCode-Setup.exe",
				"sha256": "…64 hex characters…",
				"size": 300678212
			}
		}
	]
}
```

The parser also accepts a top-level `installer` string (or `installerUrl` / `url` / `hash`) and the
GitHub API's `html_url` / `body`, so a hand-written or API-shaped feed works. Relative `installer`
URLs are resolved against the feed URL, so a feed served next to its installer works as-is. A
release without a valid HTTPS URL and SHA-256 is ignored.

## Commands

- **Red Code: Check for Updates**
- **Red Code: Version History** — opens a Markdown preview of the bundled `CHANGELOG.md` plus every
  published release
- **Red Code: Open Release Page**
- **Red Code: Show Update Status**

The status bar always shows the update button: `Red Code <version>`, switching to
`$(cloud-download) Red Code <new version>` when a build is waiting.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `redCode.updates.repository` | `sagar-deep-saha/Red-Code` | GitHub repository whose Releases are read when no feed URL is set. |
| `redCode.updates.feedUrl` | `""` | HTTPS feed URL; takes precedence over the repository. |
| `redCode.updates.checkOnStartup` | `true` | Check once at startup, at most every six hours. |
| `redCode.updates.includePrerelease` | `false` | Also offer pre-release versions. |
| `redCode.updates.downloadDirectory` | `""` | Where the installer is stored; empty = the OS temp folder. |
| `redCode.updates.installArguments` | `/SILENT /NORESTART /MERGETASKS=!runcode` | Arguments passed to the installer. |

## Installing

The installer runs detached with `redCode.updates.installArguments`
(default `/SILENT /NORESTART /MERGETASKS=!runcode`), then the editor quits. Inno Setup's
`CloseApplications=force` closes any remaining window. A hash mismatch deletes the download and
aborts.
