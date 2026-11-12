/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { compareVersions, isNewer, parseVersion } from './version.js';

export interface ReleaseInfo {
	readonly version: string;
	/** Absolute HTTPS URL of the installer. */
	readonly installerUrl: string;
	/** Lower-case hex SHA-256 of the installer. Required: an update without it is refused. */
	readonly sha256: string;
	readonly size: number | undefined;
	readonly date: string | undefined;
	readonly notes: string | undefined;
	readonly pageUrl: string | undefined;
	readonly prerelease: boolean;
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

function releaseFromRecord(value: unknown, baseUrl: string | undefined): ReleaseInfo | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}

	const version = asString(record.version) ?? asString(record.tag) ?? asString(record.name);
	const parsed = version ? parseVersion(version) : undefined;
	if (!version || !parsed) {
		return undefined;
	}

	const installer = asRecord(record.installer);
	const rawUrl = asString(installer?.url) ?? asString(record.installerUrl) ?? asString(record.url) ?? asString(record.installer);
	const rawSha = asString(installer?.sha256) ?? asString(record.sha256) ?? asString(record.hash);
	const sha256 = normalizeSha256(rawSha);
	if (!rawUrl || !sha256) {
		return undefined;
	}

	const url = resolveUrl(baseUrl, rawUrl);
	if (!url || !/^https:\/\//i.test(url)) {
		return undefined;
	}

	return {
		version: `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ''}`,
		installerUrl: url,
		sha256,
		size: asNumber(installer?.size) ?? asNumber(record.size),
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
 *   { "releases": [ { "version": "1.147.2", "installer": "RedCode-Setup.exe",
 *                     "sha256": "…", "size": 533000000, "notes": "…" } ] }
 *
 * `installer` may also be `{ "url", "sha256", "size" }`. Relative installer URLs
 * are resolved against the feed URL. Invalid entries are dropped rather than
 * half-accepted, so the UI can never offer an update it cannot verify.
 */
export function parseFeed(text: string, baseUrl?: string): UpdateFeed | undefined {
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

	const releases = dedupe(items.map(item => releaseFromRecord(item, baseUrl)).filter((item): item is ReleaseInfo => Boolean(item)));
	return releases.length > 0 ? { releases } : undefined;
}

/**
 * Converts the GitHub Releases API into the same feed model. The download digest
 * GitHub reports for an asset is trusted as the hash; releases without a digest
 * are skipped until the release publishes `redcode-updates.json`.
 */
export function feedFromGitHubReleases(value: unknown, includePrerelease: boolean): UpdateFeed {
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
		const installer = assets.find(asset => /^RedCode-Setup.*\.exe$/i.test(asString(asset.name) ?? ''));
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
