/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBlamePorcelain } from '../blame.js';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('lines from the same commit reuse the metadata of the group', () => {
	const raw = [
		`${A} 1 1 2`,
		'author Sagar',
		'author-mail <sagar@example.test>',
		'author-time 1763100000',
		'author-tz +0530',
		'committer Sagar',
		'committer-mail <sagar@example.test>',
		'committer-time 1763100000',
		'committer-tz +0530',
		'summary Add blame',
		'filename app/User.php',
		'\t<?php',
		`${A} 2 2`,
		'\techo 1;',
		`${B} 3 3 1`,
		'author Other',
		'author-mail <other@example.test>',
		'author-time 1763200000',
		'author-tz +0530',
		'summary Change line',
		'filename app/User.php',
		'\techo 2;'
	].join('\n');

	const lines = parseBlamePorcelain(raw);

	assert.equal(lines.size, 3);
	assert.deepEqual(lines.get(1), {
		sha: A,
		short: 'aaaaaaa',
		author: 'Sagar',
		authorTime: new Date(1763100000 * 1000).toISOString(),
		summary: 'Add blame'
	});
	assert.equal(lines.get(2)?.author, 'Sagar');
	assert.equal(lines.get(2)?.sha, A);
	assert.equal(lines.get(3)?.author, 'Other');
	assert.equal(lines.get(3)?.summary, 'Change line');
});

test('a single-line file maps one entry', () => {
	const raw = [
		`${A} 1 1 1`,
		'author Sagar',
		'author-time 1763100000',
		'summary Initial commit',
		'\tline'
	].join('\n');

	const lines = parseBlamePorcelain(raw);

	assert.equal(lines.size, 1);
	assert.equal(lines.get(1)?.short, 'aaaaaaa');
	assert.equal(lines.get(1)?.summary, 'Initial commit');
});

test('empty output yields an empty map', () => {
	assert.equal(parseBlamePorcelain('').size, 0);
});
