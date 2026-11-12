# Red Code Sync

Signs in with GitHub and keeps your Red Code configuration in your own **private Gist**. There is no
Red Code server: the data goes from your machine to GitHub and back.

## Why a Gist, not the VS Code sync service

Microsoft's Settings Sync backend is proprietary and is not usable by forks. The alternative that is
actually ours is to store the same payload in a private Gist, which also gives you the full revision
history on gist.github.com and data you can inspect, delete or fork yourself.

## What is synced

| Data | Source | Notes |
|---|---|---|
| Settings | `User/settings.json` | JSONC comments and trailing commas are handled |
| Keybindings | `User/keybindings.json` | written only after its JSON is validated |
| Snippets | `User/snippets/*.json` | flat folder |
| Extensions | installed, non-built-in extensions | restoring offers to install missing ones |

Never synced: workspace files, extension global state, secrets handled by the OS credential store,
and anything matched by `redCode.sync.excludeSettings`.

Credential-shaped setting keys (`…token`, `…secret`, `…password`, `…apiKey`, `…accessKey`) are
withheld by default. The status message lists how many were withheld. Setting
`redCode.sync.includeSecretLikeSettings` to `true` overrides this, but the values then leave your
machine.

## Signing in

1. **Red Code Sync: Sign In with GitHub** — uses the built-in GitHub authentication provider with
   the `gist` scope. Because Red Code's URL protocol is `red-code`, the browser redirect flow cannot
   match VS Code's registered callback, so this extension enables
   `github-authentication.preferDeviceCodeFlow` and sign-in uses a device code.
2. **Red Code Sync: Sign In with a GitHub Token** — paste a personal access token with the `gist`
   scope. It is verified against `/user` and stored in the OS credential store, not in a file.

Signing out removes the stored token and the local login record. The private Gist is left in place;
delete it on GitHub if you want the data gone.

## Commands

- **Sync Now** — upload when GitHub is not ahead, otherwise offer *Restore from GitHub* or
  *Upload This Machine*
- **Upload This Machine's Data** — always creates a new revision; refuses silently to overwrite a
  newer remote revision unless confirmed
- **Restore from GitHub** — finds the sync Gist (by stored id, or by description), shows what it
  contains and applies it
- **Show Sync Status**, **Show What Is Stored on GitHub**, **Sign Out**

Restoring writes settings through the configuration API, validates `keybindings.json` before
replacing it, and copies every replaced file to `<file>.red-code-backup-<timestamp>` first. Missing
extensions are installed only after an explicit confirmation.

## Revisions

Every upload increments `revision` in `red-code-manifest.json`, together with the device name, the
editor version and an ISO timestamp. `Sync Now` uses those to decide whether GitHub is newer than
this machine. There is no silent merge: a conflict is always a user choice.

`redCode.sync.autoPush` (off by default) uploads ten seconds after a Red Code setting changes.
