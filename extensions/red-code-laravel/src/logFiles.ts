/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LogFile, LogTail, parseLogPattern } from './index/logModel.js';

/**
 * Lists the log files a pattern selects under the project root. Virtual
 * workspaces are disabled for this extension, so the root is a real directory
 * and Node's filesystem can be used without a remote round-trip.
 */
export async function listLogFiles(root: string, pattern: string): Promise<LogFile[]> {
	const { directory, match, exact } = parseLogPattern(pattern);
	const absolute = path.join(root, directory);

	let names: string[];
	try {
		names = await fs.readdir(absolute);
	} catch {
		return [];
	}

	const files: LogFile[] = [];
	for (const name of names) {
		if (exact ? name !== match : !name.endsWith(match)) {
			continue;
		}
		try {
			const stat = await fs.stat(path.join(absolute, name));
			if (stat.isFile()) {
				files.push({ path: directory ? `${directory}/${name}` : name, mtime: stat.mtimeMs });
			}
		} catch {
			// A file that disappeared between listing and stat is simply skipped.
		}
	}
	return files;
}

/**
 * Reads at most `maxBytes` from the end of the file, so a multi-megabyte log
 * never loads into the extension host in full. The result is flagged as sliced
 * when the read started mid-entry.
 */
export async function readLogTail(root: string, relativePath: string, maxBytes: number): Promise<LogTail | undefined> {
	let handle: fs.FileHandle | undefined;
	try {
		handle = await fs.open(path.join(root, relativePath), 'r');
		const { size } = await handle.stat();
		const window = Math.max(1, Math.floor(maxBytes));
		const start = Math.max(0, size - window);
		const length = size - start;
		if (length === 0) {
			return { text: '', sliced: false };
		}

		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, start);
		return { text: buffer.toString('utf8'), sliced: start > 0 };
	} catch {
		return undefined;
	} finally {
		await handle?.close();
	}
}
