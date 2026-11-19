/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, formatRelativeDate, parseCommitDetails, parseLogStats, parseNumstat, parseStatus } from '../log.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('parseCommitDetails reads multi-line messages and the committer', () => {
	const raw = `${A}\x1fa\x1f${B}\x1fSagar\x1fsagar@example.test\x1f2026-11-14T10:00:00+05:30\x1fCommitter\x1fcommitter@example.test\x1f2026-11-14T11:00:00+05:30\x1fHEAD -> main\x1fSubject line\x1fBody line one\nbody line two`;
	const details = parseCommitDetails(raw);

	assert.ok(details);
	assert.equal(details.sha, A);
	assert.deepEqual(details.parents, [B]);
	assert.equal(details.subject, 'Subject line');
	assert.equal(details.body, 'Body line one\nbody line two');
	assert.deepEqual(details.refs, ['HEAD -> main']);
	assert.equal(details.committer, 'Committer');
	assert.equal(details.committerEmail, 'committer@example.test');
	assert.equal(details.committerDate, '2026-11-14T11:00:00+05:30');
});

test('parseCommitDetails rejects output without the expected fields', () => {
	assert.equal(parseCommitDetails('garbage'), undefined);
	assert.equal(parseCommitDetails(`zzz\x1fa\x1f\x1fx\x1fx\x1fx\x1f\x1fx\x1fx\x1fx\x1fx\x1fbody`), undefined);
});

test('parseNumstat handles plain entries', () => {
	const raw = '3\t1\tapp/Http/Controllers/UserController.php\0' + '0\t12\tresources/js/app.ts\0';
	assert.deepEqual(parseNumstat(raw), [
		{ additions: 3, deletions: 1, path: 'app/Http/Controllers/UserController.php' },
		{ additions: 0, deletions: 12, path: 'resources/js/app.ts' }
	]);
});

test('parseNumstat keeps the new path of a rename and tolerates a binary dash', () => {
	const raw = '5\t0\t\0old/Name.php\0app/NewName.php\0' + '-\t-\tpublic/logo.png\0';
	assert.deepEqual(parseNumstat(raw), [
		{ additions: 5, deletions: 0, path: 'app/NewName.php' },
		{ additions: 0, deletions: 0, path: 'public/logo.png' }
	]);
});

test('parseLogStats groups numstat lines by commit', () => {
	const raw =
		`\x1e${A}\0` + '3\t1\tapp/Http/Controllers/UserController.php\0' + '0\t12\tresources/js/app.ts\0' +
		`\x1e${B}\0` + '5\t0\t\0old/Name.php\0app/NewName.php\0' + '-\t-\tpublic/logo.png\0';

	const stats = parseLogStats(raw);

	assert.deepEqual(stats.get(A), { files: 2, additions: 3, deletions: 13 });
	assert.deepEqual(stats.get(B), { files: 2, additions: 5, deletions: 0 });
	assert.equal(stats.size, 2);
});

test('parseLogStats ignores a record that is not a SHA', () => {
	assert.equal(parseLogStats('\x1enope\0').size, 0);
});

test('parseStatus reads changed and untracked files', () => {
	const raw = ' M app/Models/User.php\0?? notes.txt\0';
	assert.deepEqual(parseStatus(raw), [
		{ status: 'M', path: 'app/Models/User.php' },
		{ status: '??', path: 'notes.txt' }
	]);
});

test('parseStatus skips the original path of a rename', () => {
	const raw = 'R  app/New.php\0app/Old.php\0';
	assert.deepEqual(parseStatus(raw), [{ status: 'R', path: 'app/New.php' }]);
});

test('formatDate keeps the commit time zone', () => {
	assert.equal(formatDate('2026-11-14T10:42:11+05:30'), '2026-11-14 10:42');
	assert.equal(formatDate(''), '');
	assert.equal(formatDate('not a date'), '');
});

test('formatRelativeDate buckets a commit age', () => {
	const now = Date.UTC(2026, 10, 18, 12, 0, 0);
	assert.equal(formatRelativeDate(new Date(now - 20 * 1000).toISOString(), now), 'just now');
	assert.equal(formatRelativeDate(new Date(now - 5 * 60 * 1000).toISOString(), now), '5 minutes ago');
	assert.equal(formatRelativeDate(new Date(now - 2 * 60 * 60 * 1000).toISOString(), now), '2 hours ago');
	assert.equal(formatRelativeDate(new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(), now), '3 days ago');
	assert.equal(formatRelativeDate(new Date(now - 70 * 24 * 60 * 60 * 1000).toISOString(), now), '2 months ago');
	assert.equal(formatRelativeDate('not a date', now), '');
});
