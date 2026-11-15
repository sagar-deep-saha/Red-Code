/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommitNode, computeGraph, parseCommitLog, refLabel } from '../graph.js';

function commit(sha: string, parents: string[], subject = `commit ${sha}`): CommitNode {
	return {
		sha,
		short: sha.slice(0, 7),
		parents,
		author: 'Sagar',
		email: 'sagar@example.test',
		date: '2026-11-14T10:00:00+05:30',
		refs: [],
		subject
	};
}

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);

test('parseCommitLog reads every field and keeps refs', () => {
	const raw = `${A}\x1fa\x1f${B} ${C}\x1fSagar\x1fsagar@example.test\x1f2026-11-14T10:00:00+05:30\x1fHEAD -> main, origin/main\x1fSubject\x1e`;
	const commits = parseCommitLog(raw);

	assert.equal(commits.length, 1);
	assert.deepEqual(commits[0], {
		sha: A,
		short: 'a',
		parents: [B, C],
		author: 'Sagar',
		email: 'sagar@example.test',
		date: '2026-11-14T10:00:00+05:30',
		refs: ['HEAD -> main', 'origin/main'],
		subject: 'Subject'
	});
});

test('parseCommitLog skips malformed records and accepts an empty ref list', () => {
	const raw = `not-a-sha\x1fx\x1f\x1fx\x1fx\x1fx\x1f\x1fx\x1e${A}\x1fa\x1f\x1fSagar\x1fs\x1f2026-11-14\x1f\x1fOnly subject\x1e`;
	const commits = parseCommitLog(raw);

	assert.equal(commits.length, 1);
	assert.equal(commits[0].sha, A);
	assert.deepEqual(commits[0].parents, []);
	assert.deepEqual(commits[0].refs, []);
	assert.equal(commits[0].subject, 'Only subject');
});

test('a linear history stays in lane zero', () => {
	const rows = computeGraph([commit(A, [B]), commit(B, [C]), commit(C, [])]);

	assert.deepEqual(rows.map(row => row.lane), [0, 0, 0]);
	assert.deepEqual(rows[0].before, []);
	assert.deepEqual(rows[0].after, [B]);
	assert.deepEqual(rows[1].before, [B]);
	assert.deepEqual(rows[1].after, [C]);
	assert.deepEqual(rows[2].before, [C]);
	assert.deepEqual(rows[2].after, []);
});

test('a side branch gets its own lane and the merge keeps both parents', () => {
	const merge = commit(D, [A, B]);
	const rows = computeGraph([merge, commit(A, [C]), commit(B, [C]), commit(C, [])]);

	assert.equal(rows[0].lane, 0);
	assert.deepEqual(rows[0].after, [A, B]);

	assert.equal(rows[1].lane, 0);
	assert.deepEqual(rows[1].before, [A, B]);
	assert.deepEqual(rows[1].after, [C, B]);

	assert.equal(rows[2].lane, 1);
	assert.deepEqual(rows[2].after, [C, C]);

	assert.equal(rows[3].lane, 0);
	assert.deepEqual(rows[3].before, [C, C]);
	assert.deepEqual(rows[3].after, []);
});

test('an octopus merge places every parent in a lane of its own', () => {
	const rows = computeGraph([commit(D, [A, B, C])]);

	assert.equal(rows[0].lane, 0);
	assert.deepEqual(rows[0].after, [A, B, C]);
});

test('a root commit clears its lane and lanes do not grow without need', () => {
	const rows = computeGraph([commit(A, [])]);

	assert.equal(rows[0].lane, 0);
	assert.deepEqual(rows[0].before, []);
	assert.deepEqual(rows[0].after, []);
});

test('refLabel classifies heads, tags, remotes and local branches', () => {
	assert.deepEqual(refLabel('HEAD -> main'), { kind: 'head', name: 'main' });
	assert.deepEqual(refLabel('HEAD'), { kind: 'head', name: 'HEAD' });
	assert.deepEqual(refLabel('tag: v1.147.4'), { kind: 'tag', name: 'v1.147.4' });
	assert.deepEqual(refLabel('origin/AnCo'), { kind: 'remote', name: 'origin/AnCo' });
	assert.deepEqual(refLabel('feature/api-tester'), { kind: 'branch', name: 'feature/api-tester' });
});
