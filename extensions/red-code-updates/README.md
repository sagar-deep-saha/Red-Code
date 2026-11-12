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
      "version": "1.147.2",
      "date": "2026-11-20T10:00:00Z",
      "installer": "https://github.com/sagar-deep-saha/Red-Code/releases/download/v1.147.2/RedCode-Setup.exe",
      "sha256": "…64 hex characters…",
      "size": 533000000,
      "notes": "Laravel S2: models, schema, env, logs, tests.",
      "prerelease": false
    }
  ]
}
```

Relative `installer` URLs are resolved against the feed URL, so a feed served next to its installer
works as-is.

## Commands

- **Red Code: Check for Updates**
- **Red Code: Version History** — bundled `CHANGELOG.md` plus every published release
- **Red Code: Open Release Page**
- **Red Code: Show Update Status**

The status bar always shows the update button: `Red Code <version>`, switching to
`$(cloud-download) Red Code <new version>` when a build is waiting.

## Installing

The installer runs detached with `redCode.updates.installArguments`
(default `/SILENT /NORESTART /MERGETASKS=!runcode`), then the editor quits. Inno Setup's
`CloseApplications=force` closes any remaining window. A hash mismatch deletes the download and
aborts.
