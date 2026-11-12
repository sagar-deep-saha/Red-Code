/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const DEFAULT_MAX_FILES = 20_000;

const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
	'.git', '.hg', '.svn', 'node_modules', 'vendor', 'storage', '.idea', '.vscode',
	'.phpunit.cache', '.cache', '.fleet'
]);

const IGNORED_RELATIVE_PATHS: readonly string[] = [
	'public/build',
	'public/hot',
	'bootstrap/cache'
];

export interface ScanResult {
	readonly files: readonly string[];
	readonly truncated: boolean;
	readonly scannedFiles: number;
}

export function shouldIgnoreDirectory(name: string): boolean {
	return IGNORED_DIRECTORIES.has(name);
}

function isIgnoredPath(relativePath: string): boolean {
	return IGNORED_RELATIVE_PATHS.some(prefix => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

function decode(bytes: Uint8Array): string {
	return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Enumerates project files without touching `vendor`, `node_modules`, `storage`
 * or build output. Bounded by `maxFiles`: a pathologically large tree degrades
 * to a truncated scan instead of hanging the extension host.
 *
 * Paths are workspace-relative and always use `/`, so they can be compared with
 * route `path` values and Blade names.
 */
export async function scanProjectFiles(
	root: vscode.Uri,
	maxFiles = DEFAULT_MAX_FILES,
	token?: vscode.CancellationToken
): Promise<ScanResult> {
	const files: string[] = [];
	let truncated = false;

	async function walk(directory: vscode.Uri, prefix: string): Promise<void> {
		if (truncated || token?.isCancellationRequested) {
			return;
		}

		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(directory);
		} catch {
			return;
		}

		entries.sort(([a], [b]) => a.localeCompare(b));
		for (const [name, type] of entries) {
			const relativePath = prefix ? `${prefix}/${name}` : name;
			if (isIgnoredPath(relativePath)) {
				continue;
			}

			const uri = vscode.Uri.joinPath(directory, name);
			if (type & vscode.FileType.Directory) {
				if (type & vscode.FileType.SymbolicLink) {
					continue;
				}
				if (shouldIgnoreDirectory(name)) {
					continue;
				}
				await walk(uri, relativePath);
				if (truncated) {
					return;
				}
				continue;
			}

			if (!(type & vscode.FileType.File)) {
				continue;
			}

			if (files.length >= maxFiles) {
				truncated = true;
				return;
			}
			files.push(relativePath);
		}
	}

	await walk(root, '');
	return { files, truncated, scannedFiles: files.length };
}

export async function readWorkspaceFile(root: vscode.Uri, relativePath: string, maxBytes = 512 * 1024): Promise<string | undefined> {
	try {
		const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, relativePath));
		if (stat.size > maxBytes) {
			return undefined;
		}
		return decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, relativePath)));
	} catch {
		return undefined;
	}
}
