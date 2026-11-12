/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatVersionOutput, parseAboutJson, parseComposerJson, parseHerdPhpShim, parseLaravelVersionFromLock, phpCandidates } from '../projectModel.js';

test('composer.json is recognized as Laravel only with laravel/framework', () => {
	const laravel = parseComposerJson(JSON.stringify({
		require: { php: '^8.3', 'laravel/framework': '^13.0' }
	}));
	assert.equal(laravel?.isLaravel, true);
	assert.equal(laravel?.frameworkConstraint, '^13.0');
	assert.equal(laravel?.phpConstraint, '^8.3');

	const plain = parseComposerJson(JSON.stringify({ require: { 'symfony/console': '^7.0' } }));
	assert.equal(plain?.isLaravel, false);
	assert.equal(plain?.frameworkConstraint, undefined);
});

test('invalid composer.json is rejected without throwing', () => {
	assert.equal(parseComposerJson('{ not json'), undefined);
	assert.equal(parseComposerJson('[]'), undefined);
	assert.equal(parseComposerJson('null'), undefined);
});

test('composer.json with a BOM is parsed', () => {
	const withBom = `\uFEFF${JSON.stringify({ require: { 'laravel/framework': '^13.0' } })}`;
	assert.equal(parseComposerJson(withBom)?.isLaravel, true);
});

test('the installed framework version comes from composer.lock, not the constraint', () => {
	const lock = JSON.stringify({
		packages: [
			{ name: 'symfony/console', version: 'v7.4.23' },
			{ name: 'laravel/framework', version: 'v13.42.0' }
		]
	});
	assert.equal(parseLaravelVersionFromLock(lock), 'v13.42.0');
	assert.equal(parseLaravelVersionFromLock(JSON.stringify({ packages: [] })), undefined);
	assert.equal(parseLaravelVersionFromLock('not json'), undefined);
});

test('about --json is normalized and tolerates missing sections', () => {
	const runtime = parseAboutJson(JSON.stringify({
		environment: {
			laravel_version: '13.42.0',
			php_version: '8.3.36',
			composer_version: '2.10.1',
			environment: 'local',
			debug_mode: true
		},
		drivers: { database: 'sqlite', cache: 'database', queue: 'database' }
	}));
	assert.equal(runtime?.laravelVersion, '13.42.0');
	assert.equal(runtime?.phpVersion, '8.3.36');
	assert.equal(runtime?.debugMode, true);
	assert.equal(runtime?.databaseDriver, 'sqlite');

	const partial = parseAboutJson(JSON.stringify({ environment: { environment: 'staging' } }));
	assert.equal(partial?.environment, 'staging');
	assert.equal(partial?.laravelVersion, undefined);
	assert.equal(partial?.debugMode, false);
});

test('PHP candidates prefer Herd versions in descending order and never batch files', () => {
	const candidates = phpCandidates('C:\\Users\\sagar', 'win32');
	assert.deepEqual(candidates.slice(0, 3), [
		'C:\\Users\\sagar\\.config\\herd\\bin\\php85\\php.exe',
		'C:\\Users\\sagar\\.config\\herd\\bin\\php84\\php.exe',
		'C:\\Users\\sagar\\.config\\herd\\bin\\php83\\php.exe'
	]);
	assert.equal(candidates.at(-1), 'php.exe');
	assert.equal(candidates.some(candidate => /\.(bat|cmd)$/i.test(candidate)), false);
});

test('Herd active-version shim is read without executing the batch file', () => {
	const shim = '@echo off\r\n"C:\\Users\\sagar\\.config\\herd\\bin\\php83\\php.exe" %*\r\n';
	assert.equal(parseHerdPhpShim(shim), 'C:\\Users\\sagar\\.config\\herd\\bin\\php83\\php.exe');
	assert.equal(parseHerdPhpShim('@echo off\n"F:/herd/bin/php84/php.exe" %*'), 'F:/herd/bin/php84/php.exe');
	assert.equal(parseHerdPhpShim('@echo off\r\necho no interpreter here\r\n'), undefined);
	assert.equal(parseHerdPhpShim(''), undefined);
});

test('non-Windows candidates never contain a .exe path', () => {
	const candidates = phpCandidates('/home/dev', 'linux');
	assert.equal(candidates.some(candidate => candidate.endsWith('.exe')), false);
	assert.equal(candidates.at(-1), 'php');
});

test('version output keeps one short line and rejects oversized output', () => {
	assert.equal(formatVersionOutput('PHP 8.3.36\r\n'), 'PHP 8.3.36');
	assert.equal(formatVersionOutput('\n\n8.4.2\n'), '8.4.2');
	assert.equal(formatVersionOutput(''), undefined);
	assert.equal(formatVersionOutput('x'.repeat(65)), undefined);
});
