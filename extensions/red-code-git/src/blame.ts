/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Pure parser for `git blame --line-porcelain`. */

export interface BlameLine {
	sha: string;
	short: string;
	author: string;
	authorTime: string;
	summary: string;
}

const HEADER_PATTERN = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: (\d+))?$/i;

export function parseBlamePorcelain(raw: string): Map<number, BlameLine> {
	const lines = new Map<number, BlameLine>();
	let sha = '';
	let author = '';
	let authorTime = '';
	let summary = '';
	let finalLine = 0;

	for (const line of raw.split('\n')) {
		const header = HEADER_PATTERN.exec(line);
		if (header) {
			const nextSha = header[1];
			finalLine = Number.parseInt(header[3], 10);
			if (nextSha !== sha) {
				// Metadata is repeated for the first line of each commit group and
				// reused for the remaining lines, so reset on a new commit only.
				sha = nextSha;
				author = '';
				authorTime = '';
				summary = '';
			}
			continue;
		}

		if (line.startsWith('\t')) {
			if (sha.length > 0 && finalLine > 0) {
				lines.set(finalLine, {
					sha,
					short: sha.slice(0, 7),
					author,
					authorTime,
					summary
				});
			}
			continue;
		}

		if (line.startsWith('author ')) {
			author = line.slice('author '.length);
		} else if (line.startsWith('author-time ')) {
			const seconds = Number.parseInt(line.slice('author-time '.length), 10);
			authorTime = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : '';
		} else if (line.startsWith('summary ')) {
			summary = line.slice('summary '.length);
		}
	}

	return lines;
}
