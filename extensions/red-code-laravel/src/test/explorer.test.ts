/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSecretKey, normalizeBaseUrl, parseEnvValue } from '../index/env.js';
import { buildExplorer, classifyExplorerFile } from '../index/explorer.js';

const files = [
	'app/Http/Controllers/PostController.php',
	'app/Http/Controllers/Api/UserController.php',
	'app/Http/Requests/StorePostRequest.php',
	'app/Models/Post.php',
	'app/Services/PostService.php',
	'resources/views/components/alert.blade.php',
	'resources/views/posts/index.blade.php',
	'resources/views/welcome.blade.php',
	'database/migrations/2026_01_01_create_posts_table.php',
	'database/factories/PostFactory.php',
	'config/app.php',
	'routes/web.php',
	'composer.json',
	'tests/Feature/PostTest.php',
	'tests/Unit/ExampleTest.php',
	'packages/acme/src/Service.php',
	'notes.txt',
	'public/index.php'
];

test('files are classified by Laravel role, not by raw folder order', () => {
	assert.deepEqual(classifyExplorerFile('app/Http/Controllers/Api/UserController.php'), {
		group: 'HTTP', section: 'Controllers', label: 'Api/UserController.php'
	});
	assert.deepEqual(classifyExplorerFile('app/Models/Post.php'), {
		group: 'Application', section: 'Models', label: 'Post.php'
	});
	assert.deepEqual(classifyExplorerFile('resources/views/components/alert.blade.php'), {
		group: 'Views', section: 'components', label: 'alert.blade.php'
	});
	assert.deepEqual(classifyExplorerFile('resources/views/welcome.blade.php'), {
		group: 'Views', section: 'views', label: 'welcome.blade.php'
	});
	assert.deepEqual(classifyExplorerFile('composer.json'), {
		group: 'Configuration', section: 'Project', label: 'composer.json'
	});
	assert.equal(classifyExplorerFile('notes.txt'), undefined);
	assert.equal(classifyExplorerFile('public/index.php'), undefined);
});

test('the explorer tree hides unrecognised files and orders Laravel sections', () => {
	const groups = buildExplorer(files);
	assert.deepEqual(groups.map(group => group.name), [
		'Application', 'HTTP', 'Views', 'Database', 'Configuration', 'Tests', 'Packages'
	]);

	const http = groups.find(group => group.name === 'HTTP');
	assert.ok(http);
	assert.deepEqual(http.sections.map(section => section.name), ['Controllers', 'Requests']);
	assert.deepEqual(http.sections[0].files.map(file => file.label), ['Api/UserController.php', 'PostController.php']);

	const views = groups.find(group => group.name === 'Views');
	assert.ok(views);
	assert.deepEqual(views.sections.map(section => section.name), ['components', 'posts', 'views']);

	const configuration = groups.find(group => group.name === 'Configuration');
	assert.ok(configuration);
	assert.deepEqual(configuration.sections.map(section => section.name), ['Project', 'routes', 'config']);

	const allPaths = groups.flatMap(group => group.sections.flatMap(section => section.files.map(file => file.relativePath)));
	assert.equal(allPaths.includes('notes.txt'), false);
	assert.equal(allPaths.includes('public/index.php'), false);
	assert.equal(allPaths.includes('app/Http/Controllers/PostController.php'), true);
});

test('empty input produces no groups', () => {
	assert.deepEqual(buildExplorer([]), []);
});

test('dotenv values are read without exposing secret semantics', () => {
	const env = [
		'APP_NAME="Laravel"',
		'APP_URL=http://localhost:8000 # local',
		"DB_PASSWORD='p@ss word'",
		'# COMMENT=ignored',
		'export CACHE_STORE=redis',
		'EMPTY='
	].join('\n');

	assert.equal(parseEnvValue(env, 'APP_NAME'), 'Laravel');
	assert.equal(parseEnvValue(env, 'APP_URL'), 'http://localhost:8000');
	assert.equal(parseEnvValue(env, 'DB_PASSWORD'), 'p@ss word');
	assert.equal(parseEnvValue(env, 'CACHE_STORE'), 'redis');
	assert.equal(parseEnvValue(env, 'EMPTY'), '');
	assert.equal(parseEnvValue(env, 'MISSING'), undefined);
	assert.equal(parseEnvValue(env, 'COMMENT'), undefined);
});

test('base URLs are normalized for browser and cURL use', () => {
	assert.equal(normalizeBaseUrl('localhost'), 'http://localhost');
	assert.equal(normalizeBaseUrl('https://example.test/'), 'https://example.test');
	assert.equal(normalizeBaseUrl(''), 'http://localhost:8000');
	assert.equal(normalizeBaseUrl(undefined), 'http://localhost:8000');
});

test('secret keys are recognised across naming conventions', () => {
	assert.equal(isSecretKey('APP_KEY'), true);
	assert.equal(isSecretKey('DB_PASSWORD'), true);
	assert.equal(isSecretKey('STRIPE_SECRET'), true);
	assert.equal(isSecretKey('AWS_SECRET_ACCESS_KEY'), true);
	assert.equal(isSecretKey('API_TOKEN'), true);
	assert.equal(isSecretKey('APP_URL'), false);
	assert.equal(isSecretKey('DB_HOST'), false);
	assert.equal(isSecretKey('PASSWORD_HASH_ROUNDS'), false);
});
