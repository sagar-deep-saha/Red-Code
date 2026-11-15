/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Pure parsers for the raw output produced by `git show`. */

export interface CommitDetails {
	sha: string;
	short: string;
	parents: string[];
	author: string;
	email: string;
	date: string;
	refs: string[];
	subject: string;
	body: string;
}

export interface FileChange {
	additions: number;
	deletions: number;
	path: string;
}

const SHA_PATTERN = /^[0-9a-f]{40,64}$/i;

/** Parses one record written with the same `\x1f` format used by `logCommits`. */
export function parseCommitDetails(raw: string): CommitDetails | undefined {
	const text = raw.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '');
	const fields = text.split('\x1f');
	if (fields.length < 9) {
		return undefined;
	}

	const [sha, short, parents, author, email, date, refs, subject, ...bodyParts] = fields;
	if (!SHA_PATTERN.test(sha)) {
		return undefined;
	}

	return {
		sha,
		short: short || sha.slice(0, 7),
		parents: parents.split(/\s+/).filter(parent => SHA_PATTERN.test(parent)),
		author,
		email,
		date,
		refs: refs.split(',').map(ref => ref.trim()).filter(ref => ref.length > 0),
		subject,
		body: bodyParts.join('\x1f').replace(/^\s*\n/, '').replace(/\s+$/, '')
	};
}

function toNumber(value: string): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parses `git show --numstat -z`. A normal record is
 * `add \t delete \t path \0`; a rename is `add \t delete \t \0 old \0 new \0`.
 */
export function parseNumstat(raw: string): FileChange[] {
	const files: FileChange[] = [];
	const tokens = raw.split('\0');

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index].replace(/^[\r\n]+/, '');
		if (token.length === 0) {
			continue;
		}

		const firstTab = token.indexOf('\t');
		const secondTab = firstTab === -1 ? -1 : token.indexOf('\t', firstTab + 1);
		if (firstTab === -1 || secondTab === -1) {
			continue;
		}

		const additions = toNumber(token.slice(0, firstTab));
		const deletions = toNumber(token.slice(firstTab + 1, secondTab));
		const tail = token.slice(secondTab + 1);

		let path: string;
		if (tail.length > 0) {
			path = tail;
		} else {
			const oldPath = tokens[index + 1] ?? '';
			const newPath = tokens[index + 2] ?? '';
			index += 2;
			path = newPath || oldPath;
		}

		if (path.length > 0) {
			files.push({ additions, deletions, path });
		}
	}

	return files;
}

/** Renders an ISO date as `YYYY-MM-DD HH:mm` in the commit's own time zone. */
export function formatDate(iso: string): string {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso.trim());
	if (match) {
		return `${match[1]} ${match[2]}`;
	}

	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
