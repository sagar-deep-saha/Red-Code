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
 *     --installer .build\win32-x64\user-setup\VSCodeSetup.exe \
 *     --package-dir ..\VSCode-win32-x64 \
 *     --asset-name RedCode-Setup.exe \
 *     --arm64-installer .build\win32-arm64\user-setup\VSCodeSetup.exe \
 *     --arm64-package-dir ..\VSCode-win32-arm64 \
 *     --arm64-asset-name RedCode-Setup-arm64.exe \
 *     --sha256sums ..\SHA256SUMS \
 *     --version 1.147.6 \
 *     --tag v1.147.6 \
 *     --repository sagar-deep-saha/Red-Code
 *
 * --asset-name is the file name the installer is uploaded as. It defaults to the
 * installer's own file name and is used to build the download URL, so the feed
 * keeps working when the local VSCodeSetup.exe is published as RedCode-Setup.exe.
 * The arm64 equivalents are optional for versions before the two-architecture
 * standard, and required from 1.147.6. `installer` always carries the x64 build so
 * Red Code 1.147.5 and older can still read the feed.
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

/**
 * Hashes one installer, checks that the packaged app behind it reports the
 * release version, and resolves the asset name and download URL. `arch` only
 * shapes defaults and messages; callers pass the explicit values for arm64.
 */
async function recordInstaller({ arch, installerArg, sha256Arg, sizeArg, packageDirArg, assetNameArg, urlArg, repository, tag, version }) {
	const label = arch === 'arm64' ? 'arm64 installer' : 'installer';

	let installerPath;
	let sha256;
	let size;
	if (typeof installerArg === 'string') {
		installerPath = path.resolve(repoRoot, installerArg);
		const info = await stat(installerPath).catch(() => undefined);
		if (!info || !info.isFile()) {
			fail(`${label} not found: ${installerPath}`);
		}
		size = info.size;
		console.log(`Hashing ${installerPath} (${(size / (1024 * 1024)).toFixed(1)} MB)…`);
		sha256 = await hashFile(installerPath);
	} else {
		sha256 = String(sha256Arg ?? '').toLowerCase();
		size = Number(sizeArg ?? 0);
		if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isFinite(size) || size <= 0) {
			fail(`provide the ${label} file, or both its --sha256 and --size.`);
		}
	}

	if (installerPath) {
		const candidates = [
			typeof packageDirArg === 'string' ? path.resolve(repoRoot, packageDirArg) : undefined,
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
			console.warn(`release-manifest: found no packaged product.json behind the ${label} to verify the built version against.`);
		} else if (packagedVersion !== version) {
			fail(`the ${label} package at ${packagedRoot} reports version ${packagedVersion} but this release is ${version}; rebuild before recording.`);
		} else {
			console.log(`Verified ${label} packaged version ${packagedVersion} in ${path.relative(repoRoot, packagedRoot)}.`);
		}
	}

	const assetName = typeof assetNameArg === 'string'
		? assetNameArg.trim()
		: installerPath
			? path.basename(installerPath)
			: `RedCode-Setup${arch === 'arm64' ? '-arm64' : ''}-${version}.exe`;
	if (!/^[A-Za-z0-9._-]+$/.test(assetName)) {
		fail(`the ${label} asset name must be a plain file name such as RedCode-Setup.exe.`);
	}
	if (!/^RedCode-Setup.*\.exe$/i.test(assetName)) {
		console.warn(`release-manifest: ${assetName} does not match RedCode-Setup*.exe; upload the ${label} under the name recorded in the feed.`);
	}
	if (installerPath && assetName !== path.basename(installerPath)) {
		console.log(`Publishing ${path.basename(installerPath)} as ${assetName}.`);
	}

	const url = typeof urlArg === 'string'
		? urlArg
		: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
	if (!/^https:\/\//i.test(url)) {
		fail(`the ${label} URL must use HTTPS.`);
	}

	return { assetName, url, sha256, size };
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

	const rootPackage = await readJson(path.join(repoRoot, 'package.json'), {});
	if (rootPackage.version !== version) {
		fail(`package.json is ${rootPackage.version} but --version is ${version}; bump package.json before recording a release.`);
	}

	const x64 = await recordInstaller({
		arch: 'x64',
		installerArg: args.installer,
		sha256Arg: args.sha256,
		sizeArg: args.size,
		packageDirArg: args['package-dir'],
		assetNameArg: args['asset-name'],
		urlArg: args['installer-url'],
		repository,
		tag,
		version
	});

	let arm64;

	const wantsArm64 = typeof args['arm64-installer'] === 'string' || typeof args['arm64-sha256'] === 'string';
	if (wantsArm64) {
		arm64 = await recordInstaller({
			arch: 'arm64',
			installerArg: args['arm64-installer'],
			sha256Arg: args['arm64-sha256'],
			sizeArg: args['arm64-size'],
			packageDirArg: args['arm64-package-dir'],
			assetNameArg: args['arm64-asset-name'],
			urlArg: args['arm64-installer-url'],
			repository,
			tag,
			version
		});
	} else if (compareVersions(version, '1.147.6') >= 0) {
		console.warn(`release-manifest: no --arm64-installer given, but ${version} must ship Windows arm64 as well.`);
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
		// `installer` stays the x64 build so Red Code 1.147.5 and older can still update.
		installer: {
			url: x64.url,
			sha256: x64.sha256,
			size: x64.size
		}
	};
	if (arm64) {
		entry.installers = [
			{ arch: 'x64', url: x64.url, sha256: x64.sha256, size: x64.size },
			{ arch: 'arm64', url: arm64.url, sha256: arm64.sha256, size: arm64.size }
		];
	}

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

	const recorded = [x64, ...(arm64 ? [arm64] : [])];
	if (typeof args.sha256sums === 'string') {
		const sumsFile = path.resolve(repoRoot, args.sha256sums);
		await mkdir(path.dirname(sumsFile), { recursive: true });
		await writeFile(sumsFile, recorded.map(item => `${item.sha256.toUpperCase()} *${item.assetName}\n`).join(''), 'utf8');
		console.log(`Wrote ${path.relative(repoRoot, sumsFile)}.`);
	}

	console.log(`Recorded ${version}`);
	for (const item of recorded) {
		const arch = item === x64 ? 'x64' : 'arm64';
		console.log(`  ${arch.padEnd(5)} : ${item.url}`);
		console.log(`  ${' '.repeat(5)}   sha256 ${item.sha256}`);
		console.log(`  ${' '.repeat(5)}   size   ${item.size} bytes`);
	}
	console.log(`  history : ${path.relative(repoRoot, historyFile)}`);
	console.log(`  feed    : ${path.relative(repoRoot, feedFile)}`);
	console.log(`  next    : upload ${recorded.map(item => item.assetName).join(', ')} and ${path.basename(feedFile)} to release ${tag}`);
}

await main();
