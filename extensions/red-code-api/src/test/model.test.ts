/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	allowsBody,
	buildHeaders,
	buildUrl,
	missingVariables,
	normalizeRequest,
	parseCollectionJson,
	parseDotEnv,
	parseHttpFile,
	resolveRequest,
	serializeCollection,
	substitute
} from '../model.js';

const variables = { baseUrl: 'https://app.test', token: 'abc 123', page: '2' };

test('substitute replaces known variables and reports unknown ones', () => {
	const result = substitute('{{baseUrl}}/api/{{missing}}/{{token}}', variables);
	assert.equal(result.text, 'https://app.test/api/{{missing}}/abc 123');
	assert.deepEqual(result.missing, ['missing']);
});

test('buildUrl encodes parameter values and keeps an existing query string', () => {
	const request = normalizeRequest({
		method: 'get',
		url: '{{baseUrl}}/api/users?sort=name#top',
		params: [
			{ name: 'page', value: '{{page}}' },
			{ name: 'q', value: 'a&b=c' },
			{ name: 'off', value: 'x', enabled: false }
		]
	});
	assert.equal(buildUrl(request, variables), 'https://app.test/api/users?sort=name&page=2&q=a%26b%3Dc#top');
});

test('buildUrl rejects a relative or empty URL', () => {
	assert.throws(() => buildUrl(normalizeRequest({ url: '' }), variables));
	assert.throws(() => buildUrl(normalizeRequest({ url: '{{baseUrl}}/api' }), {}), /https?:\/\//);
});

test('buildHeaders adds a JSON content type unless the request sets one', () => {
	const json = normalizeRequest({ url: '{{baseUrl}}/api', body: { mode: 'json', text: '{}' } });
	assert.equal(buildHeaders(json, variables)['Content-Type'], 'application/json');

	const custom = normalizeRequest({
		url: '{{baseUrl}}/api',
		headers: [{ name: 'content-type', value: 'application/vnd.api+json' }],
		body: { mode: 'json', text: '{}' }
	});
	const headers = buildHeaders(custom, variables);
	assert.equal(headers['Content-Type'], 'application/vnd.api+json');
	assert.equal(Object.keys(headers).filter(name => name.toLowerCase() === 'content-type').length, 1);
});

test('missingVariables sees every part of a request', () => {
	const request = normalizeRequest({
		url: '{{baseUrl}}/api/{{path}}',
		headers: [{ name: 'Authorization', value: 'Bearer {{token}}' }],
		body: { mode: 'json', text: '{ "id": "{{id}}" }' }
	});
	assert.deepEqual(missingVariables(request, { baseUrl: 'x', token: 't' }), ['path', 'id']);
});

test('normalizeRequest accepts the object header form and defaults the name', () => {
	const request = normalizeRequest({ url: 'https://app.test', headers: { Accept: 'text/html' } });
	assert.equal(request.name, 'GET https://app.test');
	assert.deepEqual(request.headers, [{ name: 'Accept', value: 'text/html', enabled: true }]);
	assert.deepEqual(request.body, { mode: 'none', text: '' });
});

test('a collection round-trips through JSON', () => {
	const collection = parseCollectionJson(JSON.stringify({
		name: 'Users',
		requests: [{ name: 'List', method: 'POST', url: '{{baseUrl}}/api/users', body: { mode: 'text', text: 'hi' } }]
	}), 'fallback');

	assert.equal(collection.name, 'Users');
	assert.equal(collection.requests[0].method, 'POST');
	assert.equal(collection.requests[0].body.text, 'hi');

	const reparsed = parseCollectionJson(serializeCollection(collection), 'fallback');
	assert.deepEqual(reparsed, collection);
});

test('parseCollectionJson explains invalid input', () => {
	assert.throws(() => parseCollectionJson('{', 'x'), /Not valid JSON/);
	assert.throws(() => parseCollectionJson('{}', 'x'), /"requests" array/);
	assert.throws(() => parseCollectionJson('[{"method":"GET"}]', 'x'), /needs a URL/);
});

test('parseDotEnv handles quotes, comments and export', () => {
	const values = parseDotEnv([
		'APP_URL=http://localhost:8000',
		'# comment',
		'export APP_NAME="Red Code"',
		'QUOTED_SINGLE=\'a # b\'',
		'COMMENTED=value # trailing',
		'MULTILINE="line\\nnext"',
		'EMPTY='
	].join('\n'));

	assert.equal(values.APP_URL, 'http://localhost:8000');
	assert.equal(values.APP_NAME, 'Red Code');
	assert.equal(values.QUOTED_SINGLE, 'a # b');
	assert.equal(values.COMMENTED, 'value');
	assert.equal(values.MULTILINE, 'line\nnext');
	assert.equal(values.EMPTY, '');
});

test('parseHttpFile reads several requests with headers and a body', () => {
	const requests = parseHttpFile([
		'### List users',
		'GET {{baseUrl}}/api/users',
		'Accept: application/json',
		'',
		'### Create user',
		'POST {{baseUrl}}/api/users',
		'Content-Type: application/json',
		'',
		'{ "name": "Sagar" }'
	].join('\n'), 'test.http');

	assert.equal(requests.length, 2);
	assert.equal(requests[0].name, 'List users');
	assert.equal(requests[0].method, 'GET');
	assert.equal(requests[0].headers.length, 1);
	assert.equal(requests[1].name, 'Create user');
	assert.equal(requests[1].body.mode, 'json');
	assert.equal(requests[1].body.text, '{ "name": "Sagar" }');
});

test('parseHttpFile skips the leading comment block and defaults to GET', () => {
	const requests = parseHttpFile([
		'# a note',
		'https://app.test/api/status',
		'',
		'# trailing note'
	].join('\n'), 'test.http');

	assert.equal(requests.length, 1);
	assert.equal(requests[0].method, 'GET');
	assert.equal(requests[0].url, 'https://app.test/api/status');
});

test('GET and HEAD never carry a body', () => {
	assert.equal(allowsBody('GET'), false);
	assert.equal(allowsBody('HEAD'), false);
	assert.equal(allowsBody('POST'), true);
});

test('basic and bearer auth become Authorization headers', () => {
	const basic = buildHeaders(normalizeRequest({
		url: '{{baseUrl}}/api',
		auth: { type: 'basic', username: 'sagar', password: 'secret' }
	}), variables);
	assert.equal(basic.Authorization, `Basic ${Buffer.from('sagar:secret', 'utf8').toString('base64')}`);

	const bearer = buildHeaders(normalizeRequest({
		url: '{{baseUrl}}/api',
		auth: { type: 'bearer', token: '{{token}}' }
	}), variables);
	assert.equal(bearer.Authorization, 'Bearer abc 123');

	const overridden = buildHeaders(normalizeRequest({
		url: '{{baseUrl}}/api',
		auth: { type: 'bearer', token: '{{token}}' },
		headers: [{ name: 'authorization', value: 'Token manual' }]
	}), variables);
	assert.equal(overridden.Authorization, 'Token manual');
	assert.equal(Object.keys(overridden).filter(name => name.toLowerCase() === 'authorization').length, 1);
});

test('auth and form fields survive a JSON round-trip', () => {
	const collection = parseCollectionJson(JSON.stringify({
		name: 'Forms',
		requests: [{
			name: 'Upload',
			method: 'POST',
			url: '{{baseUrl}}/api/forms',
			body: {
				mode: 'multipart',
				params: [
					{ name: 'title', value: 'Hello', enabled: true },
					{ name: 'avatar', value: 'C:/tmp/pic.png', enabled: true, kind: 'file' }
				]
			},
			auth: { type: 'bearer', token: '{{token}}' }
		}]
	}), 'fallback');

	const request = collection.requests[0];
	assert.equal(request.body.mode, 'multipart');
	assert.deepEqual(request.body.params, [
		{ name: 'title', value: 'Hello', enabled: true },
		{ name: 'avatar', value: 'C:/tmp/pic.png', enabled: true, kind: 'file' }
	]);
	assert.equal(request.auth.type, 'bearer');

	assert.deepEqual(parseCollectionJson(serializeCollection(collection), 'fallback'), collection);
});

test('resolveRequest encodes a url-encoded form body', async () => {
	const resolved = await resolveRequest(normalizeRequest({
		method: 'POST',
		url: '{{baseUrl}}/api/forms',
		body: {
			mode: 'form',
			params: [
				{ name: 'name', value: 'Red Code' },
				{ name: 'off', value: 'x', enabled: false }
			]
		}
	}), variables);

	assert.equal(resolved.body?.toString('utf8'), 'name=Red%20Code');
	assert.match(resolved.headers['Content-Type'], /application\/x-www-form-urlencoded/);
});

test('resolveRequest builds a multipart body with a file part', async () => {
	const resolved = await resolveRequest(normalizeRequest({
		method: 'POST',
		url: '{{baseUrl}}/api/uploads',
		body: {
			mode: 'multipart',
			params: [
				{ name: 'title', value: 'Hello' },
				{ name: 'avatar', value: 'C:/tmp/pic.png', kind: 'file' }
			]
		}
	}), variables, {
		boundary: 'REDBOUNDARY',
		loadFile: async () => Buffer.from('PNGDATA')
	});

	assert.equal(resolved.headers['Content-Type'], 'multipart/form-data; boundary=REDBOUNDARY');
	const body = resolved.body?.toString('utf8') ?? '';
	assert.match(body, /--REDBOUNDARY\r\nContent-Disposition: form-data; name="title"\r\n\r\nHello\r\n/);
	assert.match(body, /Content-Disposition: form-data; name="avatar"; filename="pic\.png"\r\nContent-Type: image\/png\r\n\r\nPNGDATA\r\n/);
	assert.match(body, /--REDBOUNDARY--\r\n$/);
});

test('a multipart file part without a loader fails with a readable error', async () => {
	await assert.rejects(resolveRequest(normalizeRequest({
		method: 'POST',
		url: '{{baseUrl}}/api/uploads',
		body: { mode: 'multipart', params: [{ name: 'avatar', value: 'C:/tmp/pic.png', kind: 'file' }] }
	}), variables), /needs a readable file/);
});

test('an empty body drops the inferred Content-Type header', async () => {
	const resolved = await resolveRequest(normalizeRequest({
		method: 'POST',
		url: '{{baseUrl}}/api',
		body: { mode: 'json', text: '' }
	}), variables);
	assert.equal(resolved.body, undefined);
	assert.equal(Object.keys(resolved.headers).some(name => name.toLowerCase() === 'content-type'), false);
});

test('missingVariables includes auth and multipart fields', () => {
	const request = normalizeRequest({
		url: '{{baseUrl}}/api',
		auth: { type: 'bearer', token: '{{token}}' },
		body: { mode: 'multipart', params: [{ name: 'file', value: '{{uploadPath}}', kind: 'file' }] }
	});
	assert.deepEqual(missingVariables(request, { baseUrl: 'x', token: 't' }), ['uploadPath']);
});
