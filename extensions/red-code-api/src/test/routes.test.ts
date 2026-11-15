/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRouteList, requestFromRoute } from '../routes.js';

const ROUTES = JSON.stringify([
	{ domain: null, method: 'GET|HEAD', uri: 'api/users', name: 'users.index', action: 'App\\Http\\Controllers\\UserController@index', middleware: ['api'] },
	{ domain: null, method: 'DELETE', uri: 'api/users/{user}', name: 'users.destroy', action: 'App\\Http\\Controllers\\UserController@destroy', middleware: ['api'] },
	{ domain: null, method: 'GET|HEAD', uri: '/', name: 'home', action: 'Closure', middleware: ['web'] }
]);

test('parseRouteList reads the JSON even when artisan prints warnings first', () => {
	const routes = parseRouteList(`Warning: something\n${ROUTES}\n`);

	assert.equal(routes.length, 3);
	assert.equal(routes[0].method, 'GET|HEAD');
	assert.equal(routes[0].uri, 'api/users');
	assert.equal(routes[0].name, 'users.index');
});

test('parseRouteList rejects output without a JSON list', () => {
	assert.throws(() => parseRouteList('Route list is empty'), /JSON/);
	assert.throws(() => parseRouteList('{"routes": []}'), /list/);
});

test('requestFromRoute prefills the first verb and the baseUrl variable', () => {
	const index = requestFromRoute({ method: 'GET|HEAD', uri: 'api/users', name: 'users.index', action: '' });
	assert.equal(index.method, 'GET');
	assert.equal(index.url, '{{baseUrl}}/api/users');
	assert.equal(index.name, 'users.index');

	const home = requestFromRoute({ method: 'GET', uri: '/', name: '', action: '' });
	assert.equal(home.url, '{{baseUrl}}');
	assert.equal(home.name, 'GET /');

	const destroy = requestFromRoute({ method: 'delete', uri: '/api/users/{user}', name: '', action: '' });
	assert.equal(destroy.method, 'DELETE');
	assert.equal(destroy.url, '{{baseUrl}}/api/users/{user}');
});
