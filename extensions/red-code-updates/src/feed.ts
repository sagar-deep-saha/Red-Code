/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { compareVersions, isNewer, parseVersion } from './version.js';

/**
 * Installer architectures Red Code publishes. Windows on ARM must never be handed
 * the x64 installer silently: it only works through emulation and installs the
 * wrong runtime.
 */
export type InstallerArch = 'x64' | 'arm64';

export interface ReleaseInfo {
	readonly version: string;
	/** Absolute HTTPS URL of the installer for the requested architecture. */
	readonly installerUrl: string;
	/** Lower-case hex SHA-256 of the installer. Required: an update without it is refused. */
	readonly sha256: string;
	readonly size: number | undefined;
	readonly date: string | undefined;
	readonly notes: string | undefined;
	readonly pageUrl: string | undefined;
	readonly prerelease: boolean;
}

interface InstallerInfo {
	readonly url: string;
	readonly sha256: string;
	readonly size: number | undefined;
}

export interface UpdateFeed {
	readonly releases: readonly ReleaseInfo[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function normalizeSha256(value: string | undefined): string | undefined {
	const hex = (value ?? '').replace(/^sha256:/i, '').trim().toLowerCase();
	return /^[a-f0-9]{64}$/.test(hex) ? hex : undefined;
}

function resolveUrl(base: string | undefined, value: string): string | undefined {
	try {
		return base ? new URL(value, base).toString() : new URL(value).toString();
	} catch {
		return undefined;
	}
}

function normalizeArch(value: string | undefined): InstallerArch | undefined {
	switch ((value ?? '').toLowerCase()) {
		case 'x64':
		case 'amd64':
		case 'x86_64':
			return 'x64';
		case 'arm64':
		case 'aarch64':
			return 'arm64';
		default:
			return undefined;
	}
}

function installerInfo(rawUrl: string | undefined, rawSha: string | undefined, size: number | undefined, baseUrl: string | undefined): InstallerInfo | undefined {
	const sha256 = normalizeSha256(rawSha);
	if (!rawUrl || !sha256) {
		return undefined;
	}
	const url = resolveUrl(baseUrl, rawUrl);
	if (!url || !/^https:\/\//i.test(url)) {
		return undefined;
	}
	return { url, sha256, size };
}

function releaseFromRecord(value: unknown, baseUrl: string | undefined, arch: InstallerArch): ReleaseInfo | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}

	const version = asString(record.version) ?? asString(record.tag) ?? asString(record.name);
	const parsed = version ? parseVersion(version) : undefined;
	if (!version || !parsed) {
		return undefined;
	}

	// `installer` is the original single-architecture form, kept so older Red Code
	// builds can still read the feed. New releases list one entry per architecture.
	const single = asRecord(record.installer);
	const singleInstaller = installerInfo(
		asString(single?.url) ?? asString(record.installerUrl) ?? asString(record.url) ?? asString(record.installer),
		asString(single?.sha256) ?? asString(record.sha256) ?? asString(record.hash),
		asNumber(single?.size) ?? asNumber(record.size),
		baseUrl
	);

	const perArch = (Array.isArray(record.installers) ? record.installers : [])
		.map(entry => {
			const item = asRecord(entry);
			const entryArch = normalizeArch(asString(item?.arch) ?? asString(item?.architecture));
			const info = item ? installerInfo(asString(item.url), asString(item.sha256), asNumber(item.size), baseUrl) : undefined;
			return entryArch && info ? { arch: entryArch, info } : undefined;
		})
		.filter((entry): entry is { arch: InstallerArch; info: InstallerInfo } => Boolean(entry));

	const installer = perArch.find(entry => entry.arch === arch)?.info ?? singleInstaller ?? perArch[0]?.info;
	if (!installer) {
		return undefined;
	}

	return {
		version: `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ''}`,
		installerUrl: installer.url,
		sha256: installer.sha256,
		size: installer.size,
		date: asString(record.date) ?? asString(record.publishedAt) ?? asString(record.published_at),
		notes: asString(record.notes) ?? asString(record.body),
		pageUrl: asString(record.pageUrl) ?? asString(record.html_url),
		prerelease: asBoolean(record.prerelease) ?? Boolean(parsed.prerelease)
	};
}

function dedupe(releases: readonly ReleaseInfo[]): ReleaseInfo[] {
	const byVersion = new Map<string, ReleaseInfo>();
	for (const release of releases) {
		// Later entries win: a fetched manifest is more precise than a GitHub
		// asset digest, so callers append it after the derived entry.
		byVersion.set(release.version, release);
	}
	return [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Parses our feed schema:
 *
 *   { "releases": [ { "version": "1.147.6",
 *                     "installer": { "url": "…", "sha256": "…", "size": 533000000 },
 *                     "installers": [ { "arch": "x64", "url": "…", "sha256": "…", "size": 533000000 },
 *                                     { "arch": "arm64", "url": "…", "sha256": "…", "size": 520000000 } ],
 *                     "notes": "…" } ] }
 *
 * `installer` is the single-installer form written by releases up to 1.147.5.
 * `installers` selects the artifact for the running architecture, falling back
 * to `installer` so older releases stay updatable. Relative installer URLs are
 * resolved against the feed URL. Invalid entries are dropped rather than
 * half-accepted, so the UI can never offer an update it cannot verify.
 */
export function parseFeed(text: string, baseUrl?: string, arch: InstallerArch = 'x64'): UpdateFeed | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch {
		return undefined;
	}

	const record = asRecord(parsed);
	const items = Array.isArray(parsed) ? parsed : record?.releases ?? record?.versions;
	if (!Array.isArray(items)) {
		return undefined;
	}

	const releases = dedupe(items.map(item => releaseFromRecord(item, baseUrl, arch)).filter((item): item is ReleaseInfo => Boolean(item)));
	return releases.length > 0 ? { releases } : undefined;
}

function pickGitHubInstaller(assets: readonly Record<string, unknown>[], arch: InstallerArch): Record<string, unknown> | undefined {
	const installers = assets.filter(asset => /^RedCode-Setup.*\.exe$/i.test(asString(asset.name) ?? ''));
	const isArm64 = (asset: Record<string, unknown>) => /arm64/i.test(asString(asset.name) ?? '');
	// Windows on ARM prefers its own installer, but an x64 build still installs
	// through emulation, so it is a better fallback than offering no update.
	return arch === 'arm64' ? installers.find(isArm64) ?? installers.find(asset => !isArm64(asset)) : installers.find(asset => !isArm64(asset));
}

/**
 * Converts the GitHub Releases API into the same feed model. The download digest
 * GitHub reports for an asset is trusted as the hash; releases without a digest
 * are skipped until the release publishes `redcode-updates.json`.
 */
export function feedFromGitHubReleases(value: unknown, includePrerelease: boolean, arch: InstallerArch = 'x64'): UpdateFeed {
	const items = Array.isArray(value) ? value : [];
	const releases: ReleaseInfo[] = [];

	for (const item of items) {
		const record = asRecord(item);
		if (!record || asBoolean(record.draft)) {
			continue;
		}

		const prerelease = asBoolean(record.prerelease) ?? false;
		if (prerelease && !includePrerelease) {
			continue;
		}

		const version = asString(record.tag_name);
		const parsed = version ? parseVersion(version) : undefined;
		if (!version || !parsed) {
			continue;
		}

		const assets = Array.isArray(record.assets) ? record.assets.map(asRecord).filter((asset): asset is Record<string, unknown> => Boolean(asset)) : [];
		const installer = pickGitHubInstaller(assets, arch);
		if (!installer) {
			continue;
		}

		const url = asString(installer.browser_download_url);
		const sha256 = normalizeSha256(asString(installer.digest));
		if (!url || !sha256 || !/^https:\/\//i.test(url)) {
			continue;
		}

		releases.push({
			version: `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ''}`,
			installerUrl: url,
			sha256,
			size: asNumber(installer.size),
			date: asString(record.published_at),
			notes: asString(record.body),
			pageUrl: asString(record.html_url),
			prerelease
		});
	}

	return { releases: dedupe(releases) };
}

export function mergeFeeds(base: UpdateFeed, extra: UpdateFeed): UpdateFeed {
	return { releases: dedupe([...base.releases, ...extra.releases]) };
}

/**
 * Picks the newest release that is strictly newer than the running build and
 * allowed by the pre-release setting. Returns `undefined` when up to date.
 */
export function pickRelease(feed: UpdateFeed | undefined, currentVersion: string, includePrerelease: boolean): ReleaseInfo | undefined {
	if (!feed) {
		return undefined;
	}
	for (const release of feed.releases) {
		if (release.prerelease && !includePrerelease) {
			continue;
		}
		if (isNewer(release.version, currentVersion)) {
			return release;
		}
	}
	return undefined;
}

export function describeFeedFailure(repository: string): string {
	return `Could not read update information for ${repository}. Publish a release that contains RedCode-Setup.exe, or set redCode.updates.feedUrl.`;
}
