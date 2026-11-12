#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Copies the Red Code built-in extensions into an existing Red Code installation
 * so they can be tried without a full rebuild and reinstall.
 *
 * A packaged build gets these extensions automatically: `gulp vscode-win32-x64`
 * copies every directory under `extensions/`. This script exists for the
 * unpacked build directory and for an installed copy (`%LOCALAPPDATA%\Programs\Red Code`).
 *
 * Usage:
 *   node build/red-code/install-extensions.mjs                 # discover and update every target
 *   node build/red-code/install-extensions.mjs --target "C:\path\to\Red Code\resources\app"
 */

import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const workspaceRoot = path.dirname(repoRoot);
const EXTENSIONS = ['red-code', 'red-code-laravel', 'red-code-sync', 'red-code-updates', 'theme-red'];
const PACKAGE_FILES = ['package.json', 'package.nls.json', 'README.md', 'CHANGELOG.md'];
const ASSET_DIRECTORIES = ['media', 'themes', 'out'];

function parseArgs(argv) {
	const args = { targets: [] };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--target') {
			args.targets.push(argv[++index]);
		} else if (arg.startsWith('--target=')) {
			args.targets.push(arg.slice('--target='.length));
		}
	}
	return args;
}

async function isDirectory(candidate) {
	try {
		return (await stat(candidate)).isDirectory();
	} catch {
		return false;
	}
}

/** `--target` and the defaults below both point at `.../resources/app`. */
function extensionRoot(appDirectory) {
	return path.join(appDirectory, 'extensions');
}

async function findTargets() {
	const candidates = [
		path.join(workspaceRoot, 'RedCode-win32-x64', 'resources', 'app'),
		path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Red Code', 'resources', 'app')
	];
	const found = [];
	for (const candidate of candidates) {
		if (process.env.LOCALAPPDATA === '' && candidate.startsWith(path.sep)) {
			continue;
		}
		if (await isDirectory(extensionRoot(candidate))) {
			found.push(candidate);
		}
	}
	return found;
}

async function copyExtension(source, destination, name) {
	const extensionRootPath = path.join(destination, name);
	await mkdir(extensionRootPath, { recursive: true });

	for (const file of PACKAGE_FILES) {
		const from = path.join(source, file);
		if (await stat(from).catch(() => undefined)) {
			await cp(from, path.join(extensionRootPath, file));
		}
	}

	for (const directory of ASSET_DIRECTORIES) {
		const from = path.join(source, directory);
		if (!(await isDirectory(from))) {
			continue;
		}
		const to = path.join(extensionRootPath, directory);
		// `out/` is rebuilt output, so replace it; `media/` and `themes/` may
		// contain nothing else, but replacing keeps deleted assets from lingering.
		await rm(to, { recursive: true, force: true });
		await cp(from, to, { recursive: true });
		if (directory === 'out') {
			// Test output is not part of the extension.
			await rm(path.join(to, 'test'), { recursive: true, force: true });
		}
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const targets = args.targets.length > 0
		? args.targets.map(target => path.resolve(target))
		: await findTargets();

	if (targets.length === 0) {
		console.error('install-extensions: no Red Code installation found. Pass --target "<...>\\resources\\app".');
		process.exit(1);
	}

	for (const appDirectory of targets) {
		const destination = extensionRoot(appDirectory);
		console.log(`\n${destination}`);
		for (const name of EXTENSIONS) {
			const source = path.join(repoRoot, 'extensions', name);
			const packageJson = await readFile(path.join(source, 'package.json'), 'utf8').catch(() => undefined);
			if (!packageJson) {
				console.log(`  skip ${name}: not built`);
				continue;
			}
			await copyExtension(source, destination, name);
			console.log(`  ${name} -> ${JSON.parse(packageJson).version}`);
		}
		console.log('  reload the window (or restart Red Code) to load the new extensions');
	}
}

await main();
