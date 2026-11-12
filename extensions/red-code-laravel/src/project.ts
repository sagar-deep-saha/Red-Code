/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseComposerJson, parseHerdPhpShim, parseLaravelVersionFromLock, phpCandidates } from './projectModel.js';

export interface LaravelProject {
	readonly folder: vscode.WorkspaceFolder;
	readonly root: vscode.Uri;
	readonly artisan: vscode.Uri;
	readonly php: string | undefined;
	readonly version: string | undefined;
}

export interface PhpResolution {
	readonly path: string | undefined;
	readonly warning: string | undefined;
}

function decode(bytes: Uint8Array): string {
	return new TextDecoder('utf-8').decode(bytes);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolves the PHP executable. Explicit configuration wins, then Herd, then
 * PATH. `.bat`/`.cmd` entries are refused because Node cannot launch them
 * without a shell, which would reintroduce argument-quoting risk.
 */
export function resolvePhpPath(): PhpResolution {
	const configured = vscode.workspace.getConfiguration('redCode.laravel').get<string>('phpPath', '').trim();
	if (configured) {
		if (/\.(bat|cmd)$/i.test(configured)) {
			return {
				path: undefined,
				warning: vscode.l10n.t('redCode.laravel.phpPath points at a batch file. Set it to php.exe instead.')
			};
		}
		if (fs.existsSync(configured)) {
			return { path: configured, warning: undefined };
		}
		return {
			path: undefined,
			warning: vscode.l10n.t('redCode.laravel.phpPath does not exist: {0}', configured)
		};
	}

	// Respect the PHP version Herd selected for the CLI, so artisan runs under
	// the same interpreter as the site.
	const herdShim = path.join(os.homedir(), '.config', 'herd', 'bin', 'php.bat');
	if (fs.existsSync(herdShim)) {
		try {
			const selected = parseHerdPhpShim(fs.readFileSync(herdShim, 'utf8'));
			if (selected && fs.existsSync(selected)) {
				return { path: selected, warning: undefined };
			}
		} catch {
			// An unreadable shim falls through to the candidate list.
		}
	}

	for (const candidate of phpCandidates(os.homedir(), process.platform)) {
		if (path.isAbsolute(candidate)) {
			if (fs.existsSync(candidate)) {
				return { path: candidate, warning: undefined };
			}
			continue;
		}

		const found = findOnPath(candidate);
		if (found) {
			return { path: found, warning: undefined };
		}
	}

	return { path: undefined, warning: undefined };
}

function findOnPath(name: string): string | undefined {
	const pathValue = process.env.PATH;
	if (!pathValue) {
		return undefined;
	}

	const separator = process.platform === 'win32' ? ';' : ':';
	for (const directory of pathValue.split(separator)) {
		if (!directory) {
			continue;
		}
		// `name` is always php.exe / php, never a batch file, so this cannot
		// resolve to a `.bat` shim.
		const fullPath = path.join(directory, name);
		if (fs.existsSync(fullPath)) {
			return fullPath;
		}
	}

	return undefined;
}

/**
 * A folder is a Laravel project when it has `artisan` and either declares
 * `laravel/framework` or carries the modern `bootstrap/app.php` entry point.
 */
export async function detectLaravelProject(folder: vscode.WorkspaceFolder): Promise<LaravelProject | undefined> {
	const composerUri = vscode.Uri.joinPath(folder.uri, 'composer.json');
	if (!await exists(composerUri)) {
		return undefined;
	}

	let composerText: string;
	try {
		composerText = decode(await vscode.workspace.fs.readFile(composerUri));
	} catch {
		return undefined;
	}

	const composer = parseComposerJson(composerText);
	if (!composer) {
		return undefined;
	}

	const artisan = vscode.Uri.joinPath(folder.uri, 'artisan');
	if (!await exists(artisan)) {
		return undefined;
	}

	const hasBootstrapApp = await exists(vscode.Uri.joinPath(folder.uri, 'bootstrap', 'app.php'));
	if (!composer.isLaravel && !hasBootstrapApp) {
		return undefined;
	}

	let version: string | undefined;
	const lockUri = vscode.Uri.joinPath(folder.uri, 'composer.lock');
	if (await exists(lockUri)) {
		try {
			version = parseLaravelVersionFromLock(decode(await vscode.workspace.fs.readFile(lockUri)));
		} catch {
			// A malformed lock file must not prevent project detection.
		}
	}

	return {
		folder,
		root: folder.uri,
		artisan,
		php: resolvePhpPath().path,
		version
	};
}
