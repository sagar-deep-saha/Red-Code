/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendMissingKeys, diffEnv, parseEnvFile } from '../index/envModel.js';

const envText = [
	'# comment',
	'',
	'APP_NAME="My App"',
	'export APP_ENV=local',
	'APP_KEY=',
	'EMPTY_QUOTED=""',
	'COMMENTED=value # trailing',
	'lowercase=ignored',
	'  SPACED  =  spaced value  ',
	'DB_PASSWORD=secret',
	'DB_PASSWORD=other'
].join('\n');

const parsed = parseEnvFile(envText);

test('keys are parsed without retaining any value', () => {
	assert.equal(parsed.entries.length, 8);
	assert.equal(parsed.keys.size, 7);
	assert.deepEqual([...parsed.keys], [
		'APP_NAME', 'APP_ENV', 'APP_KEY', 'EMPTY_QUOTED', 'COMMENTED', 'SPACED', 'DB_PASSWORD'
	]);
	assert.equal(parsed.entries[0].key, 'APP_NAME');
	assert.equal(parsed.entries[0].hasValue, true);
	assert.equal(parsed.entries[0].lineNumber, 3);
	assert.equal(parsed.entries[1].key, 'APP_ENV');
	assert.equal(parsed.entries[1].lineNumber, 4);
	assert.equal(parsed.entries[2].key, 'APP_KEY');
	assert.equal(parsed.entries[2].lineNumber, 5);
});

test('empty values are reported as empty, not as missing', () => {
	const byKey = new Map(parsed.entries.map(entry => [entry.key, entry]));
	assert.equal(byKey.get('APP_KEY')?.hasValue, false);
	assert.equal(byKey.get('EMPTY_QUOTED')?.hasValue, false);
	assert.equal(byKey.get('COMMENTED')?.hasValue, true);
	assert.equal(byKey.get('SPACED')?.hasValue, true);
	assert.equal(byKey.has('lowercase'), false);
});

test('duplicate keys are detected once and sorted', () => {
	assert.deepEqual(parsed.duplicates, ['DB_PASSWORD']);
});

test('the diff reports keys only, split into missing and extra', () => {
	const env = parseEnvFile([
		'APP_NAME=App',
		'APP_KEY=base64:abc',
		'EXTRA_KEY=1',
		'EMPTY_EXTRA='
	].join('\n'));
	const example = parseEnvFile([
		'APP_NAME=',
		'APP_KEY=',
		'APP_ENV=local'
	].join('\n'));

	const diff = diffEnv(env, example);
	assert.deepEqual(diff.missing.map(row => [row.key, row.status, row.lineNumber]), [['APP_ENV', 'missing', 3]]);
	assert.deepEqual(diff.extra.map(row => [row.key, row.status]), [['EXTRA_KEY', 'extra'], ['EMPTY_EXTRA', 'empty']]);
	assert.deepEqual(diff.duplicates, []);
});

test('a duplicated key is flagged where it appears as extra', () => {
	const env = parseEnvFile('EXTRA=1\nEXTRA=2\n');
	const diff = diffEnv(env, parseEnvFile('APP_NAME=\n'));
	assert.deepEqual(diff.extra.map(row => row.status), ['duplicate']);
	assert.deepEqual(diff.duplicates.map(row => [row.key, row.lineNumber]), [['EXTRA', 1]]);
});

test('missing keys are appended with the file EOL and a blank line between', () => {
	assert.equal(appendMissingKeys('A=1\r\n', ['B', 'C']), 'A=1\r\nB=\r\n\r\nC=\r\n');
	assert.equal(appendMissingKeys('A=1', ['B']), 'A=1\nB=\n');
	assert.equal(appendMissingKeys('', ['B']), 'B=\n');
	assert.equal(appendMissingKeys('A=1\n', []), 'A=1\n');
});
