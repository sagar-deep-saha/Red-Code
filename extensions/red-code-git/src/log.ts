/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Pure parsers for the raw output produced by `git show` and `git status`. */

export interface CommitDetails {
	sha: string;
	short: string;
	parents: string[];
	author: string;
	email: string;
	date: string;
	committer: string;
	committerEmail: string;
	committerDate: string;
	refs: string[];
	subject: string;
	body: string;
}

export interface FileChange {
	additions: number;
	deletions: number;
	path: string;
}

export interface CommitStats {
	files: number;
	additions: number;
	deletions: number;
}

export interface WorkingFile {
	path: string;
	status: string;
}

const SHA_PATTERN = /^[0-9a-f]{40,64}$/i;

/** Parses one record written with the same `\x1f` format used by `logCommits`. */
export function parseCommitDetails(raw: string): CommitDetails | undefined {
	const text = raw.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '');
	const fields = text.split('\x1f');
	if (fields.length < 12) {
		return undefined;
	}

	const [sha, short, parents, author, email, date, committer, committerEmail, committerDate, refs, subject, ...bodyParts] = fields;
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
		committer,
		committerEmail,
		committerDate,
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

/**
 * Parses `git log --pretty=format:%x1e%H --numstat -z`.
 *
 * Every record starts with the `\x1e` marker and the full SHA, followed by one
 * NUL separated numstat token per file. Rename entries use the same
 * `add \t del \t` + old + new shape as `parseNumstat`.
 */
export function parseLogStats(raw: string): Map<string, CommitStats> {
	const stats = new Map<string, CommitStats>();
	let current: CommitStats | undefined;
	const tokens = raw.split('\0');

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index].replace(/^[\r\n]+/, '');
		if (token.length === 0) {
			continue;
		}

		if (token.startsWith('\x1e')) {
			const sha = token.slice(1).trim();
			current = SHA_PATTERN.test(sha) ? { files: 0, additions: 0, deletions: 0 } : undefined;
			if (current) {
				stats.set(sha, current);
			}
			continue;
		}

		if (!current) {
			continue;
		}

		const firstTab = token.indexOf('\t');
		const secondTab = firstTab === -1 ? -1 : token.indexOf('\t', firstTab + 1);
		if (firstTab === -1 || secondTab === -1) {
			continue;
		}

		current.files += 1;
		current.additions += toNumber(token.slice(0, firstTab));
		current.deletions += toNumber(token.slice(firstTab + 1, secondTab));
		if (token.slice(secondTab + 1).length === 0) {
			index += 2;
		}
	}

	return stats;
}

/** Parses `git status --porcelain=v1 -z` into the changed files. */
export function parseStatus(raw: string): WorkingFile[] {
	const files: WorkingFile[] = [];
	const tokens = raw.split('\0');

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.length < 4) {
			continue;
		}
		const status = token.slice(0, 2).trim() || '?';
		const path = token.slice(3);
		files.push({ path, status });
		if (status.startsWith('R') || status.startsWith('C')) {
			index += 1;
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

/** Renders an ISO date as a relative label such as `2 days ago`. */
export function formatRelativeDate(iso: string, now = Date.now()): string {
	const time = new Date(iso).getTime();
	if (Number.isNaN(time)) {
		return '';
	}

	const seconds = Math.max(0, Math.round((now - time) / 1000));
	if (seconds < 45) {
		return 'just now';
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 36) {
		return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	}
	const days = Math.round(hours / 24);
	if (days < 26) {
		return `${days} day${days === 1 ? '' : 's'} ago`;
	}
	const months = Math.round(days / 30);
	if (months < 12) {
		return `${months} month${months === 1 ? '' : 's'} ago`;
	}
	const years = Math.round(months / 12);
	return `${years} year${years === 1 ? '' : 's'} ago`;
}
