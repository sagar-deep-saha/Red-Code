/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseJsonc } from './jsonc.js';

/**
 * `context.globalStorageUri` is `<userData>/User/globalStorage/<extension>`, so
 * two levels up is the `User` directory that holds settings, keybindings and
 * snippets.
 */
export function userDirectory(globalStorageFsPath: string): string {
	return path.dirname(path.dirname(globalStorageFsPath));
}

export async function readTextIfExists(file: string): Promise<string | undefined> {
	try {
		return await fs.readFile(file, 'utf8');
	} catch {
		return undefined;
	}
}

export async function readSettings(settingsFile: string): Promise<Record<string, unknown>> {
	const text = await readTextIfExists(settingsFile);
	if (!text) {
		return {};
	}
	const parsed = parseJsonc(text);
	return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

export async function readSnippets(snippetsDirectory: string): Promise<Record<string, string>> {
	const snippets: Record<string, string> = {};
	let entries: string[];
	try {
		entries = await fs.readdir(snippetsDirectory);
	} catch {
		return snippets;
	}

	for (const name of entries.filter(entry => entry.toLowerCase().endsWith('.json')).sort()) {
		const content = await readTextIfExists(path.join(snippetsDirectory, name));
		if (content !== undefined) {
			snippets[name] = content;
		}
	}
	return snippets;
}

/**
 * Writes a file only after copying the previous one aside. Restoring without a
 * backup is how a sync feature loses someone's hand-written keybindings.
 */
export async function writeWithBackup(file: string, content: string): Promise<string | undefined> {
	let backup: string | undefined;
	try {
		const existing = await fs.readFile(file);
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		backup = `${file}.red-code-backup-${stamp}`;
		await fs.writeFile(backup, existing);
	} catch {
		// No previous file: nothing to back up.
	}

	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, content, 'utf8');
	return backup;
}

export async function writeSnippets(snippetsDirectory: string, snippets: Readonly<Record<string, string>>): Promise<string[]> {
	const backups: string[] = [];
	await fs.mkdir(snippetsDirectory, { recursive: true });
	for (const [name, content] of Object.entries(snippets)) {
		if (!/^[A-Za-z0-9 _.-]+\.json$/i.test(name) || name.includes('..')) {
			continue;
		}
		const backup = await writeWithBackup(path.join(snippetsDirectory, name), content);
		if (backup) {
			backups.push(backup);
		}
	}
	return backups;
}
