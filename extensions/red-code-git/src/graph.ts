/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure graph model helpers. This module has no `vscode` or Node.js imports so
 * the lane assignment and parsing logic can be tested without an editor.
 */

export interface CommitNode {
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
}

export interface GraphRow {
	commit: CommitNode;
	lane: number;
	before: (string | null)[];
	after: (string | null)[];
}

export interface RefLabel {
	kind: 'head' | 'branch' | 'remote' | 'tag';
	name: string;
}

const SHA_PATTERN = /^[0-9a-f]{40,64}$/i;

/**
 * Parses the `\x1f`/`\x1e` separated output of `git log`.
 *
 * Fields: sha, short, parents, author, email, author date, committer,
 * committer email, committer date, decorations, subject.
 */
export function parseCommitLog(raw: string): CommitNode[] {
	const commits: CommitNode[] = [];

	for (const record of raw.split('\x1e')) {
		const text = record.replace(/^[\r\n]+/, '').replace(/[\r\n]+$/, '');
		if (text.length === 0) {
			continue;
		}

		const fields = text.split('\x1f');
		if (fields.length < 11) {
			continue;
		}

		const [sha, short, parents, author, email, date, committer, committerEmail, committerDate, refs, ...subjectParts] = fields;
		if (!SHA_PATTERN.test(sha)) {
			continue;
		}

		commits.push({
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
			subject: subjectParts.join('\x1f')
		});
	}

	return commits;
}

function firstFreeLane(lanes: readonly (string | null)[]): number {
	const index = lanes.indexOf(null);
	return index === -1 ? lanes.length : index;
}

/**
 * Assigns every commit a lane and records the lane state above and below the
 * row. Lanes hold the SHA that is expected to appear there next; a merge keeps
 * its side branches in stable lanes instead of moving them on every row.
 */
export function computeGraph(commits: readonly CommitNode[]): GraphRow[] {
	const lanes: (string | null)[] = [];
	const rows: GraphRow[] = [];

	for (const commit of commits) {
		const before = lanes.slice();
		let lane = lanes.indexOf(commit.sha);
		if (lane === -1) {
			lane = firstFreeLane(lanes);
		}

		// A merge makes several lanes point at this commit. All of them end here.
		for (let index = 0; index < lanes.length; index++) {
			if (lanes[index] === commit.sha) {
				lanes[index] = null;
			}
		}
		while (lanes.length <= lane) {
			lanes.push(null);
		}
		while (before.length <= lane) {
			before.push(null);
		}

		lanes[lane] = commit.parents.length > 0 ? commit.parents[0] : null;

		for (let parentIndex = 1; parentIndex < commit.parents.length; parentIndex++) {
			const parent = commit.parents[parentIndex];
			if (parent.length === 0 || lanes.indexOf(parent) !== -1) {
				continue;
			}
			const free = firstFreeLane(lanes);
			while (lanes.length <= free) {
				lanes.push(null);
			}
			lanes[free] = parent;
		}

		while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
			lanes.pop();
		}
		while (before.length > 0 && before[before.length - 1] === null) {
			before.pop();
		}

		rows.push({ commit, lane, before, after: lanes.slice() });
	}

	return rows;
}

/** Number of lanes the graph needs for a page, used to size the graph column. */
export function graphWidth(rows: readonly GraphRow[]): number {
	let lanes = 1;
	for (const row of rows) {
		lanes = Math.max(lanes, row.lane + 1, row.before.length, row.after.length);
	}
	return lanes;
}

/** True when the commit has more than one parent. */
export function isMerge(commit: CommitNode): boolean {
	return commit.parents.length > 1;
}

/** Strips a fully qualified ref prefix so `%D` decorations can be classified. */
function shortRef(value: string): string {
	return value
		.replace(/^refs\/heads\//, '')
		.replace(/^refs\/remotes\//, '')
		.replace(/^refs\/tags\//, '')
		.trim();
}

/**
 * Classifies a `%D` decoration such as `HEAD -> main`, `origin/main`,
 * `tag: v1.0.0` or `refs/remotes/origin/main`.
 *
 * `remotes` is the list of configured remote names; when supplied, a ref that
 * starts with `<remote>/` is reported as a remote branch even when its name
 * does not look like one.
 */
export function refLabel(ref: string, remotes: readonly string[] = []): RefLabel {
	const value = shortRef(ref);
	const arrow = value.indexOf(' -> ');
	if (arrow !== -1) {
		const left = value.slice(0, arrow).trim();
		const right = shortRef(value.slice(arrow + 4));
		return { kind: left === 'HEAD' ? 'head' : 'remote', name: right || left };
	}
	if (value === 'HEAD') {
		return { kind: 'head', name: 'HEAD' };
	}
	if (value.startsWith('tag: ')) {
		return { kind: 'tag', name: value.slice('tag: '.length) };
	}
	for (const remote of remotes) {
		if (value.startsWith(`${remote}/`)) {
			return { kind: 'remote', name: value };
		}
	}
	if (/^(origin|upstream)\//.test(value)) {
		return { kind: 'remote', name: value };
	}
	return { kind: 'branch', name: value };
}
