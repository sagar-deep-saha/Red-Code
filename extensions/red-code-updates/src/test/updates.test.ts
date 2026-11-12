/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feedFromGitHubReleases, mergeFeeds, parseFeed, pickRelease } from '../feed.js';
import { compareVersions, isNewer, parseVersion } from '../version.js';

const SHA = 'a'.repeat(64);

test('versions parse with optional pre-release and build metadata', () => {
	assert.deepEqual(parseVersion('1.147.0'), { major: 1, minor: 147, patch: 0, prerelease: undefined });
	assert.deepEqual(parseVersion('v2.0.1-beta.3'), { major: 2, minor: 0, patch: 1, prerelease: 'beta.3' });
	assert.deepEqual(parseVersion('1.147.0+abc123'), { major: 1, minor: 147, patch: 0, prerelease: undefined });
	assert.equal(parseVersion('1.147'), undefined);
	assert.equal(parseVersion('latest'), undefined);
});

test('version ordering treats a release as newer than its pre-releases', () => {
	assert.equal(compareVersions('1.147.1', '1.147.0'), 1);
	assert.equal(compareVersions('1.147.0', '1.147.1'), -1);
	assert.equal(compareVersions('1.147.0', '1.147.0+abc'), 0);
	assert.equal(compareVersions('1.147.1', '1.147.1-beta.2'), 1);
	assert.equal(compareVersions('1.147.1-beta.10', '1.147.1-beta.2'), 1);
	assert.equal(compareVersions('1.147.1-beta.rc', '1.147.1-beta.2'), 1);
	assert.equal(isNewer('1.148.0', '1.147.9'), true);
	assert.equal(isNewer('1.147.0', '1.147.0'), false);
});

test('the feed accepts absolute and relative installer URLs', () => {
	const feed = parseFeed(JSON.stringify({
		releases: [
			{ version: '1.147.2', installer: 'https://example.test/RedCode-Setup.exe', sha256: SHA.toUpperCase(), size: 100 },
			{ version: '1.147.1', installer: 'RedCode-Setup-1.147.1.exe', sha256: SHA, date: '2026-11-01' }
		]
	}), 'https://example.test/releases/feed.json');

	assert.ok(feed);
	assert.deepEqual(feed.releases.map(release => release.version), ['1.147.2', '1.147.1']);
	assert.equal(feed.releases[1].installerUrl, 'https://example.test/releases/RedCode-Setup-1.147.1.exe');
	assert.equal(feed.releases[0].sha256, SHA);
});

test('the feed refuses anything it cannot verify', () => {
	const invalid = parseFeed(JSON.stringify({
		releases: [
			{ version: '1.147.2', installer: 'https://example.test/a.exe' },
			{ version: '1.147.3', installer: 'http://example.test/a.exe', sha256: SHA },
			{ version: 'not-a-version', installer: 'https://example.test/a.exe', sha256: SHA },
			{ version: '1.147.4', installer: 'https://example.test/a.exe', sha256: 'short' },
			{ version: '1.147.5', installer: 'javascript:alert(1)', sha256: SHA }
		]
	}));
	assert.equal(invalid, undefined);
	assert.equal(parseFeed('not json'), undefined);
	assert.equal(parseFeed(JSON.stringify({ releases: [] })), undefined);
});

test('duplicate versions resolve to the later, more precise record', () => {
	const feed = parseFeed(JSON.stringify({
		releases: [
			{ version: '1.147.2', installer: 'https://example.test/a.exe', sha256: 'b'.repeat(64), notes: 'derived' },
			{ version: '1.147.2', installer: 'https://example.test/a.exe', sha256: SHA, notes: 'manifest' }
		]
	}));
	assert.ok(feed);
	assert.equal(feed.releases.length, 1);
	assert.equal(feed.releases[0].notes, 'manifest');
	assert.equal(feed.releases[0].sha256, SHA);
});

test('the newest release newer than the running build is chosen', () => {
	const feed = parseFeed(JSON.stringify({
		releases: [
			{ version: '1.150.0', installer: 'https://example.test/a.exe', sha256: SHA, prerelease: true },
			{ version: '1.148.0', installer: 'https://example.test/a.exe', sha256: SHA },
			{ version: '1.147.5', installer: 'https://example.test/a.exe', sha256: SHA },
			{ version: '1.147.1', installer: 'https://example.test/a.exe', sha256: SHA }
		]
	}));

	assert.equal(pickRelease(feed, '1.147.2', false)?.version, '1.148.0');
	assert.equal(pickRelease(feed, '1.148.0', false), undefined);
	assert.equal(pickRelease(feed, '1.147.9', true)?.version, '1.150.0');
	assert.equal(pickRelease(undefined, '1.147.0', false), undefined);
});

test('GitHub releases become feed entries only when a digest exists', () => {
	const feed = feedFromGitHubReleases([
		{
			tag_name: 'v1.147.2',
			published_at: '2026-11-20T10:00:00Z',
			html_url: 'https://github.com/sagar-deep-saha/Red-Code/releases/tag/v1.147.2',
			body: 'Fix',
			draft: false,
			prerelease: false,
			assets: [
				{ name: 'RedCode-Setup.exe', browser_download_url: 'https://example.test/RedCode-Setup.exe', digest: `sha256:${SHA}`, size: 42 },
				{ name: 'redcode-updates.json', browser_download_url: 'https://example.test/redcode-updates.json' }
			]
		},
		{
			tag_name: 'v1.147.1',
			assets: [{ name: 'RedCode-Setup.exe', browser_download_url: 'https://example.test/old.exe' }]
		},
		{
			tag_name: 'v1.147.0',
			draft: true,
			assets: [{ name: 'RedCode-Setup.exe', browser_download_url: 'https://example.test/draft.exe', digest: `sha256:${SHA}` }]
		},
		{
			tag_name: 'v1.149.0-beta.1',
			prerelease: true,
			assets: [{ name: 'RedCode-Setup.exe', browser_download_url: 'https://example.test/beta.exe', digest: `sha256:${SHA}` }]
		},
		'garbage'
	], false);

	assert.deepEqual(feed.releases.map(release => release.version), ['1.147.2']);
	assert.equal(feed.releases[0].size, 42);
	assert.equal(feed.releases[0].notes, 'Fix');

	const withPrerelease = feedFromGitHubReleases([
		{ tag_name: 'v1.149.0-beta.1', prerelease: true, assets: [{ name: 'RedCode-Setup.exe', browser_download_url: 'https://example.test/beta.exe', digest: `sha256:${SHA}` }] }
	], true);
	assert.deepEqual(withPrerelease.releases.map(release => release.version), ['1.149.0-beta.1']);

	// A repository with no releases yet is empty, not an error.
	assert.deepEqual(feedFromGitHubReleases([], false), { releases: [] });
});

test('merging feeds prefers the manifest copy of a version', () => {
	const base = parseFeed(JSON.stringify({ releases: [{ version: '1.147.2', installer: 'https://example.test/a.exe', sha256: 'b'.repeat(64) }] }));
	const extra = parseFeed(JSON.stringify({ releases: [{ version: '1.147.2', installer: 'https://example.test/a.exe', sha256: SHA }] }));
	assert.ok(base && extra);
	const merged = mergeFeeds(base, extra);
	assert.equal(merged.releases.length, 1);
	assert.equal(merged.releases[0].sha256, SHA);
});
