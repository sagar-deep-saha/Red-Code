/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildDeploymentSet, DEFAULT_EXCLUDES, formatManifest, isExcluded, matchesGlob, mergeChanges, parseNameStatus
} from '../deploySet.js';

test('name-status output is parsed, including renames and spaces', () => {
	assert.deepEqual(parseNameStatus('M\0app/Foo.php\0A\0app/Bar.php\0D\0app/Gone.php\0'), [
		{ path: 'app/Foo.php', status: 'modified' },
		{ path: 'app/Bar.php', status: 'added' },
		{ path: 'app/Gone.php', status: 'deleted' }
	]);

	assert.deepEqual(parseNameStatus('R087\0app/Old Name.php\0app/New Name.php\0'), [
		{ path: 'app/New Name.php', previousPath: 'app/Old Name.php', status: 'renamed' }
	]);

	assert.deepEqual(parseNameStatus('C100\0a.php\0b.php\0T\0c.php\0'), [
		{ path: 'b.php', previousPath: 'a.php', status: 'copied' },
		{ path: 'c.php', status: 'type-changed' }
	]);

	assert.deepEqual(parseNameStatus(''), []);
	// `git show --format=` may prefix the first record with the empty format's newline.
	assert.deepEqual(parseNameStatus('\nM\0a.php\0'), [{ path: 'a.php', status: 'modified' }]);
});

test('unescapable statuses and truncated records are ignored, not half-parsed', () => {
	assert.deepEqual(parseNameStatus('Z\0unknown.php\0'), []);
	assert.deepEqual(parseNameStatus('R100\0only-old.php\0'), []);
});

test('merging commits keeps the newest status and the oldest rename source', () => {
	const merged = mergeChanges(
		[{ path: 'app/B.php', previousPath: 'app/A.php', status: 'renamed' }],
		[{ path: 'app/B.php', status: 'modified' }],
		[{ path: 'app/C.php', status: 'added' }]
	);

	assert.deepEqual(merged, [
		{ path: 'app/B.php', previousPath: 'app/A.php', status: 'modified' },
		{ path: 'app/C.php', status: 'added' }
	]);
});

test('globs match the way ignore patterns are described in the setting', () => {
	assert.equal(matchesGlob('vendor/**', 'vendor/laravel/framework/src/Foo.php'), true);
	assert.equal(matchesGlob('vendor/**', 'packages/vendor/x.php'), false);
	assert.equal(matchesGlob('**/*.log', 'storage/logs/laravel.log'), true);
	assert.equal(matchesGlob('**/*.log', 'laravel.log'), true);
	assert.equal(matchesGlob('*.php', 'app/Foo.php'), false);
	assert.equal(matchesGlob('app/*.php', 'app/Foo.php'), true);
	assert.equal(matchesGlob('app/*.php', 'app/Http/Foo.php'), false);
	assert.equal(matchesGlob('.env', '.env'), true);
	assert.equal(matchesGlob('.env.*', '.env.production'), true);
	assert.equal(matchesGlob('.env.*', 'config/.env'), false);
	assert.equal(matchesGlob('a.b', 'axb'), false);
	assert.equal(matchesGlob('', 'anything'), false);
	assert.equal(isExcluded('vendor/autoload.php', DEFAULT_EXCLUDES), true);
	assert.equal(isExcluded('app/Models/Post.php', DEFAULT_EXCLUDES), false);
	// A Windows-style pattern is normalised.
	assert.equal(matchesGlob('vendor\\**', 'vendor/a.php'), true);
});

test('uploads and deletions are exact when both trees are known', () => {
	const set = buildDeploymentSet(
		[
			{ path: 'app/Modified.php', status: 'modified' },
			{ path: 'app/Added.php', status: 'added' },
			{ path: 'app/Deleted.php', status: 'deleted' },
			{ path: 'app/New.php', previousPath: 'app/Old.php', status: 'renamed' },
			{ path: 'vendor/autoload.php', status: 'modified' }
		],
		DEFAULT_EXCLUDES,
		new Set(['app/Modified.php', 'app/Deleted.php', 'app/Old.php', 'vendor/autoload.php']),
		new Set(['app/Modified.php', 'app/Added.php', 'app/New.php', 'vendor/autoload.php'])
	);

	assert.deepEqual(set.files.map(file => file.path), ['app/Added.php', 'app/Modified.php', 'app/New.php']);
	assert.deepEqual(set.deletions.map(file => file.path), ['app/Deleted.php', 'app/Old.php']);
	assert.deepEqual(set.excluded, ['vendor/autoload.php']);
	assert.equal(set.changedCount, 5);
});

test('a file added and later deleted inside the range is not deleted on the server', () => {
	const set = buildDeploymentSet(
		[
			{ path: 'app/Temporary.php', status: 'deleted' },
			{ path: 'app/Kept.php', status: 'modified' }
		],
		DEFAULT_EXCLUDES,
		new Set(['app/Kept.php']),
		new Set(['app/Kept.php'])
	);

	assert.deepEqual(set.files.map(file => file.path), ['app/Kept.php']);
	assert.deepEqual(set.deletions, []);
});

test('a path removed then re-added is uploaded, never deleted', () => {
	const set = buildDeploymentSet(
		[
			{ path: 'app/Back.php', status: 'deleted' },
			{ path: 'app/Back.php', status: 'added' }
		],
		DEFAULT_EXCLUDES,
		new Set(['app/Back.php']),
		new Set(['app/Back.php'])
	);

	assert.deepEqual(set.files.map(file => file.path), ['app/Back.php']);
	assert.deepEqual(set.deletions, []);
});

test('without trees the status letters alone still produce a usable set', () => {
	const set = buildDeploymentSet(
		[
			{ path: 'a.php', status: 'modified' },
			{ path: 'b.php', previousPath: 'old.php', status: 'renamed' },
			{ path: 'c.php', status: 'deleted' }
		],
		[]
	);

	assert.deepEqual(set.files.map(file => file.path), ['a.php', 'b.php']);
	assert.deepEqual(set.deletions.map(file => file.path), ['c.php', 'old.php']);
});

test('the manifest states what to upload and what to delete', () => {
	const set = buildDeploymentSet(
		[
			{ path: 'app/Model.php', status: 'modified' },
			{ path: 'app/Old.php', status: 'deleted' }
		],
		DEFAULT_EXCLUDES,
		new Set(['app/Model.php', 'app/Old.php']),
		new Set(['app/Model.php'])
	);

	const manifest = formatManifest(set, {
		selection: 'abc1234..def5678',
		target: 'def5678',
		generatedAt: '2026-11-12T10:00:00.000Z'
	});

	assert.match(manifest, /Selection: {4}abc1234\.\.def5678/);
	assert.match(manifest, /Upload \(1\)\nM {2}app\/Model\.php/);
	assert.match(manifest, /Delete on server \(1\)\nD {2}app\/Old\.php/);
	assert.match(manifest, /target commit, not from your working tree/);
});
