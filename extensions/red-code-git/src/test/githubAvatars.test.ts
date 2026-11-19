/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGitHubRemote, planAvatarLookups } from '../avatarPlan.js';

test('parseGitHubRemote reads https and ssh remotes', () => {
	assert.deepEqual(parseGitHubRemote('https://github.com/sagar-deep-saha/Red-Code.git'), { owner: 'sagar-deep-saha', repo: 'Red-Code' });
	assert.deepEqual(parseGitHubRemote('https://github.com/sagar-deep-saha/Red-Code'), { owner: 'sagar-deep-saha', repo: 'Red-Code' });
	assert.deepEqual(parseGitHubRemote('git@github.com:sagar-deep-saha/Red-Code.git'), { owner: 'sagar-deep-saha', repo: 'Red-Code' });
	assert.deepEqual(parseGitHubRemote('ssh://git@github.com/sagar-deep-saha/Red-Code.git'), { owner: 'sagar-deep-saha', repo: 'Red-Code' });
	assert.deepEqual(parseGitHubRemote('  git@github.com:sagar-deep-saha/Red-Code  '), { owner: 'sagar-deep-saha', repo: 'Red-Code' });
});

test('parseGitHubRemote ignores non-GitHub and broken remotes', () => {
	assert.equal(parseGitHubRemote(''), undefined);
	assert.equal(parseGitHubRemote('https://gitlab.com/sagar/Red-Code.git'), undefined);
	assert.equal(parseGitHubRemote('https://github.com/only-owner'), undefined);
	assert.equal(parseGitHubRemote('not a url'), undefined);
	assert.equal(parseGitHubRemote('C:\\repos\\Red-Code'), undefined);
});

test('planAvatarLookups keeps one commit per email and skips cached authors', () => {
	const commits = [
		{ sha: 'a'.repeat(40), email: 'Sagar@example.test' },
		{ sha: 'b'.repeat(40), email: 'sagar@example.test' },
		{ sha: 'c'.repeat(40), email: 'other@example.test' },
		{ sha: 'd'.repeat(40), email: 'cached@example.test' },
		{ sha: 'e'.repeat(40), email: '   ' }
	];
	const cached = new Map([['cached@example.test', 'https://avatars.githubusercontent.com/u/1']]);

	assert.deepEqual(planAvatarLookups(commits, cached), [
		{ sha: 'a'.repeat(40), email: 'sagar@example.test' },
		{ sha: 'c'.repeat(40), email: 'other@example.test' }
	]);
});

test('planAvatarLookups returns nothing when every author is cached', () => {
	const commits = [{ sha: 'a'.repeat(40), email: 'sagar@example.test' }];
	const cached = new Map([['sagar@example.test', 'https://avatars.githubusercontent.com/u/1']]);
	assert.deepEqual(planAvatarLookups(commits, cached), []);
});
