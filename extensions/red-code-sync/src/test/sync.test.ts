/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJsonc } from '../jsonc.js';
import {
	buildGistFiles, buildManifest, extensionDiff, EXTENSIONS_FILE, filterSettings, isSecretLikeKey,
	KEYBINDINGS_FILE, MANIFEST_FILE, matchesExclusion, parseGistFiles, SETTINGS_FILE, shouldPull, SNIPPETS_FILE
} from '../payload.js';

test('settings.jsonc is parsed with comments and trailing commas', () => {
	const text = `{
		// a line comment
		"editor.fontSize": 14,
		/* a block comment */
		"workbench.colorTheme": "Red",
		"url": "https://example.test//not-a-comment",
		"literal": "/* still a string */",
		"list": [1, 2, 3,],
	}`;
	assert.deepEqual(parseJsonc(text), {
		'editor.fontSize': 14,
		'workbench.colorTheme': 'Red',
		url: 'https://example.test//not-a-comment',
		literal: '/* still a string */',
		list: [1, 2, 3]
	});
	assert.equal(parseJsonc('{ invalid'), undefined);
});

test('exclusions support exact keys and prefixes', () => {
	assert.equal(matchesExclusion('editor.fontSize', ['editor.fontSize']), true);
	assert.equal(matchesExclusion('editor.fontSize', ['editor.*']), true);
	assert.equal(matchesExclusion('redCode.sync.autoPush', ['redCode.sync.*']), true);
	assert.equal(matchesExclusion('editor.wordWrap', ['editor.fontSize']), false);
	assert.equal(matchesExclusion('anything', ['   ']), false);
});

test('credential-shaped settings are withheld unless explicitly included', () => {
	assert.equal(isSecretLikeKey('openai.apiKey'), true);
	assert.equal(isSecretLikeKey('github.token'), true);
	assert.equal(isSecretLikeKey('aws.secretAccessKey'), true);
	assert.equal(isSecretLikeKey('db.password'), true);
	assert.equal(isSecretLikeKey('editor.fontSize'), false);
	assert.equal(isSecretLikeKey('editor.smoothScrolling'), false);

	const settings = {
		'editor.fontSize': 14,
		'openai.apiKey': 'sk-secret',
		'redCode.sync.autoPush': true,
		'redCode.laravel.phpPath': 'C:/php/php.exe'
	};

	const filtered = filterSettings(settings, ['redCode.sync.*', 'redCode.laravel.phpPath'], false);
	assert.deepEqual(Object.keys(filtered.settings), ['editor.fontSize']);
	assert.deepEqual(filtered.excluded.sort(), ['redCode.laravel.phpPath', 'redCode.sync.autoPush']);
	assert.deepEqual(filtered.secretLike, ['openai.apiKey']);

	const withSecrets = filterSettings(settings, [], true);
	assert.equal(withSecrets.settings['openai.apiKey'], 'sk-secret');
	assert.deepEqual(withSecrets.secretLike, []);
});

test('a snapshot round-trips through gist files without losing data', () => {
	const manifest = buildManifest(undefined, 'workstation', '1.147.1', new Date('2026-11-11T10:00:00Z'));
	assert.equal(manifest.revision, 1);
	assert.equal(manifest.updatedAt, '2026-11-11T10:00:00.000Z');

	const snapshot = {
		settings: { 'editor.fontSize': 14, 'files.autoSave': 'afterDelay' },
		keybindings: '[\n\t{ "key": "ctrl+alt+l", "command": "redCode.laravel.palette" }\n]\n',
		snippets: { 'php.json': '{\n\t"dd": { "prefix": "dd" }\n}\n' },
		extensions: ['redcode.red-code-laravel', 'redcode.theme-red']
	};

	const files = buildGistFiles(snapshot, manifest);
	assert.deepEqual(Object.keys(files).sort(), [
		EXTENSIONS_FILE, KEYBINDINGS_FILE, MANIFEST_FILE, SETTINGS_FILE, SNIPPETS_FILE
	].sort());

	const gistFiles = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, { content: file.content }]));
	const parsed = parseGistFiles(gistFiles);
	assert.ok(parsed);
	assert.deepEqual(parsed.snapshot.settings, snapshot.settings);
	assert.equal(parsed.snapshot.keybindings, snapshot.keybindings);
	assert.deepEqual(parsed.snapshot.snippets, snapshot.snippets);
	assert.deepEqual(parsed.snapshot.extensions, snapshot.extensions);
	assert.equal(parsed.manifest.revision, 1);
});

test('optional files are omitted when empty and can be removed on update', () => {
	const manifest = buildManifest(undefined, 'device', '1.147.1');
	const files = buildGistFiles({ settings: {}, keybindings: undefined, snippets: {}, extensions: [] }, manifest);
	assert.deepEqual(Object.keys(files).sort(), [MANIFEST_FILE, SETTINGS_FILE].sort());
});

test('a truncated or incomplete snapshot is rejected instead of half-applied', () => {
	const manifest = buildManifest(undefined, 'device', '1.147.1');
	const valid = buildGistFiles({ settings: { a: 1 }, keybindings: undefined, snippets: {}, extensions: [] }, manifest);

	const truncated = structuredClone(valid);
	(truncated[SETTINGS_FILE] as { content: string }).content = '{"a":1';
	assert.equal(parseGistFiles(truncated), undefined);

	const missingManifest = structuredClone(valid);
	delete (missingManifest as Record<string, unknown>)[MANIFEST_FILE];
	assert.equal(parseGistFiles(missingManifest), undefined);

	assert.equal(parseGistFiles(undefined), undefined);
});

test('manifests only accept complete records', () => {
	const manifest = buildManifest(undefined, 'device', '1.147.1');
	const files = buildGistFiles({ settings: {}, keybindings: undefined, snippets: {}, extensions: [] }, manifest);
	const gistFiles = { [MANIFEST_FILE]: files[MANIFEST_FILE], [SETTINGS_FILE]: files[SETTINGS_FILE] };

	const broken = structuredClone(gistFiles);
	(broken[MANIFEST_FILE] as { content: string }).content = JSON.stringify({ revision: 0, updatedAt: 'x', device: 'd', editorVersion: '1' });
	assert.equal(parseGistFiles(broken), undefined);
});

test('revision comparison decides whether GitHub is newer', () => {
	assert.equal(shouldPull({ schemaVersion: 1, revision: 4, updatedAt: '', device: 'd', editorVersion: '1' }, 3), true);
	assert.equal(shouldPull({ schemaVersion: 1, revision: 3, updatedAt: '', device: 'd', editorVersion: '1' }, 3), false);
	assert.equal(shouldPull(undefined, 0), false);
});

test('extension diffs are case-insensitive and preserve original ids', () => {
	const diff = extensionDiff(
		['Redcode.Theme-Red', 'ms-python.python'],
		['redcode.theme-red', 'redcode.red-code-laravel', 'MS-Python.Python']
	);
	assert.deepEqual(diff.missing, ['redcode.red-code-laravel']);
	assert.deepEqual(diff.extra, []);
});
