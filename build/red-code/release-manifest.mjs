#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Records a Red Code build: hashes the installer, appends a version record to
 * releases/versions.json, regenerates releases/redcode-updates.json and copies
 * the changelog into the updater extension so offline version history works.
 *
 * The version recorded here must match both the repository package.json and the
 * product.json inside the packaged app, so a stale build tree can never be
 * published as a newer release.
 *
 * Usage:
 *   node build/red-code/release-manifest.mjs \
 *     --installer ..\VSCode-win32-x64\.build\win32-x64\user-setup\VSCodeSetup.exe \
 *     --asset-name RedCode-Setup.exe \
 *     --version 1.147.2 \
 *     --tag v1.147.2 \
 *     --repository sagar-deep-saha/Red-Code
 *
 * --asset-name is the file name the installer is uploaded as. It defaults to the
 * installer's own file name and is used to build the download URL, so the feed
 * keeps working when the local VSCodeSetup.exe is published as RedCode-Setup.exe.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function fail(message) {
	console.error(`release-manifest: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const args = {};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (!arg.startsWith('--')) {
			continue;
		}
		const key = arg.slice(2);
		const next = argv[index + 1];
		if (next === undefined || next.startsWith('--')) {
			args[key] = true;
		} else {
			args[key] = next;
			index++;
		}
	}
	return args;
}

function compareVersions(left, right) {
	const parse = value => {
		const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(value);
		return match ? { numbers: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] } : undefined;
	};
	const a = parse(left);
	const b = parse(right);
	if (!a || !b) {
		return String(left).localeCompare(String(right));
	}
	for (let index = 0; index < 3; index++) {
		if (a.numbers[index] !== b.numbers[index]) {
			return a.numbers[index] - b.numbers[index];
		}
	}
	if (a.prerelease === b.prerelease) {
		return 0;
	}
	if (!a.prerelease) {
		return 1;
	}
	if (!b.prerelease) {
		return -1;
	}
	return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

async function hashFile(file) {
	const hash = createHash('sha256');
	await new Promise((resolve, reject) => {
		const stream = createReadStream(file);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('error', reject);
		stream.on('end', resolve);
	});
	return hash.digest('hex');
}

function extractChangelogSection(markdown, version) {
	const lines = markdown.split(/\r?\n/);
	const heading = new RegExp(`^##\\s+\\[?v?${version.replace(/\./g, '\\.')}\\]?`, 'i');
	const start = lines.findIndex(line => heading.test(line));
	if (start === -1) {
		return undefined;
	}
	const section = [];
	for (let index = start + 1; index < lines.length; index++) {
		if (/^##\s+/.test(lines[index])) {
			break;
		}
		section.push(lines[index]);
	}
	return section.join('\n').trim();
}

async function readJson(file, fallback) {
	try {
		return JSON.parse(await readFile(file, 'utf8'));
	} catch {
		return fallback;
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const version = String(args.version ?? '').trim();
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
		fail('--version must look like 1.147.1 (or 1.147.1-beta.1).');
	}

	const repository = String(args.repository ?? 'sagar-deep-saha/Red-Code').trim();
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
		fail('--repository must be owner/name.');
	}

	const tag = String(args.tag ?? `v${version}`).trim();
	const outDir = path.resolve(repoRoot, String(args.out ?? 'releases'));
	const historyFile = path.join(outDir, 'versions.json');
	const feedFile = path.join(outDir, 'redcode-updates.json');
	const extensionChangelog = path.join(repoRoot, 'extensions', 'red-code-updates', 'CHANGELOG.md');
	const changelogFile = path.resolve(repoRoot, String(args.changelog ?? 'CHANGELOG.md'));

	let installerPath;
	let sha256;
	let size;
	if (typeof args.installer === 'string') {
		installerPath = path.resolve(repoRoot, args.installer);
		const info = await stat(installerPath).catch(() => undefined);
		if (!info || !info.isFile()) {
			fail(`installer not found: ${installerPath}`);
		}
		size = info.size;
		console.log(`Hashing ${installerPath} (${(size / (1024 * 1024)).toFixed(1)} MB)…`);
		sha256 = await hashFile(installerPath);
	} else {
		sha256 = String(args.sha256 ?? '').toLowerCase();
		size = Number(args.size ?? 0);
		if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isFinite(size) || size <= 0) {
			fail('provide --installer, or both --sha256 and --size.');
		}
	}

	const rootPackage = await readJson(path.join(repoRoot, 'package.json'), {});
	if (rootPackage.version !== version) {
		fail(`package.json is ${rootPackage.version} but --version is ${version}; bump package.json before recording a release.`);
	}

	if (installerPath) {
		const candidates = [
			typeof args['package-dir'] === 'string' ? path.resolve(repoRoot, args['package-dir']) : undefined,
			path.dirname(installerPath),
			path.resolve(path.dirname(installerPath), '..')
		].filter(Boolean);
		let packagedRoot;
		let packagedVersion;
		for (const candidate of candidates) {
			const productJson = path.join(candidate, 'resources', 'app', 'product.json');
			if ((await stat(productJson).catch(() => undefined))?.isFile()) {
				packagedRoot = candidate;
				packagedVersion = (await readJson(productJson, {})).version;
				break;
			}
		}
		if (packagedVersion === undefined) {
			console.warn('release-manifest: found no packaged product.json to verify the built version against.');
		} else if (packagedVersion !== version) {
			fail(`the package at ${packagedRoot} reports version ${packagedVersion} but this release is ${version}; rebuild before recording.`);
		} else {
			console.log(`Verified packaged version ${packagedVersion} in ${path.relative(repoRoot, packagedRoot)}.`);
		}
	}

	const assetName = typeof args['asset-name'] === 'string'
		? args['asset-name'].trim()
		: installerPath ? path.basename(installerPath) : `RedCode-Setup-${version}.exe`;
	if (!/^[A-Za-z0-9._-]+$/.test(assetName)) {
		fail('--asset-name must be a plain file name such as RedCode-Setup.exe.');
	}
	if (!/^RedCode-Setup.*\.exe$/i.test(assetName)) {
		console.warn(`release-manifest: ${assetName} does not match RedCode-Setup*.exe; upload the installer under the name recorded in the feed.`);
	}
	if (installerPath && assetName !== path.basename(installerPath)) {
		console.log(`Publishing ${path.basename(installerPath)} as ${assetName}.`);
	}

	const installerUrl = typeof args['installer-url'] === 'string'
		? args['installer-url']
		: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
	if (!/^https:\/\//i.test(installerUrl)) {
		fail('--installer-url must use HTTPS.');
	}

	const changelog = await readFile(changelogFile, 'utf8').catch(() => '');
	const notes = typeof args.notes === 'string'
		? args.notes
		: extractChangelogSection(changelog, version) ?? '';
	if (!notes) {
		console.warn(`release-manifest: no changelog section for ${version}; the release will have empty notes.`);
	}

	const entry = {
		version,
		date: typeof args.date === 'string' ? new Date(args.date).toISOString() : new Date().toISOString(),
		prerelease: version.includes('-'),
		notes,
		pageUrl: `https://github.com/${repository}/releases/tag/${encodeURIComponent(tag)}`,
		installer: {
			url: installerUrl,
			sha256,
			size
		}
	};

	const history = await readJson(historyFile, { releases: [] });
	const releases = Array.isArray(history.releases) ? history.releases.filter(release => release.version !== version) : [];
	releases.push(entry);
	releases.sort((left, right) => compareVersions(right.version, left.version));

	const record = {
		schemaVersion: 1,
		repository,
		updatedAt: new Date().toISOString(),
		releases
	};

	await mkdir(outDir, { recursive: true });
	await writeFile(historyFile, `${JSON.stringify(record, undefined, '\t')}\n`, 'utf8');
	await writeFile(feedFile, `${JSON.stringify({ releases }, undefined, '\t')}\n`, 'utf8');

	if (changelog) {
		await copyFile(changelogFile, extensionChangelog);
	}

	console.log(`Recorded ${version}`);
	console.log(`  installer : ${installerUrl}`);
	console.log(`  sha256    : ${sha256}`);
	console.log(`  size      : ${size} bytes`);
	console.log(`  history   : ${path.relative(repoRoot, historyFile)}`);
	console.log(`  feed      : ${path.relative(repoRoot, feedFile)}`);
	console.log(`  next      : upload ${assetName} and ${path.basename(feedFile)} to release ${tag}`);
}

await main();
