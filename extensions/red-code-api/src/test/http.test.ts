/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { CookieJar } from '../cookies.js';
import { sendRequest } from '../http.js';
import { ResolvedRequest } from '../model.js';

let server: Server;
let origin = '';
let jar: CookieJar;

function handler(req: IncomingMessage, res: ServerResponse): void {
	const url = req.url ?? '/';
	if (url === '/json') {
		const body = JSON.stringify({ ok: true, method: req.method, cookie: req.headers.cookie ?? null });
		res.writeHead(200, 'OK', { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
		res.end(body);
		return;
	}
	if (url === '/gzip') {
		const body = gzipSync(Buffer.from('compressed payload'));
		res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip', 'Content-Length': body.length });
		res.end(body);
		return;
	}
	if (url === '/redirect') {
		res.writeHead(302, { Location: '/json' });
		res.end();
		return;
	}
	if (url === '/login') {
		res.writeHead(200, { 'Set-Cookie': ['laravel_session=abc123; Path=/; HttpOnly'], 'Content-Type': 'application/json' });
		res.end('{}');
		return;
	}
	if (url === '/echo') {
		const chunks: Buffer[] = [];
		req.on('data', chunk => chunks.push(chunk));
		req.on('end', () => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ body: Buffer.concat(chunks).toString('utf8'), contentType: req.headers['content-type'] }));
		});
		return;
	}
	res.writeHead(404, 'Not Found', { 'Content-Type': 'text/plain' });
	res.end('missing');
}

before(async () => {
	server = createServer(handler);
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	jar = new CookieJar();
});

after(async () => {
	await new Promise<void>(resolve => server.close(() => resolve()));
});

function options() {
	return { timeoutMs: 5000, verifyTls: true, followRedirects: true, cookieJar: jar };
}

function request(method: ResolvedRequest['method'], path: string, body?: Buffer, headers?: Record<string, string>): ResolvedRequest {
	return { method, url: `${origin}${path}`, headers: headers ?? {}, body };
}

test('a GET returns status, headers, body and a duration', async () => {
	const response = await sendRequest(request('GET', '/json'), options());
	assert.equal(response.status, 200);
	assert.equal(response.statusText, 'OK');
	assert.equal(response.headers['content-type'], 'application/json');
	assert.deepEqual(JSON.parse(response.body.toString('utf8')), { ok: true, method: 'GET', cookie: null });
	assert.ok(response.durationMs >= 0);
	assert.equal(response.truncated, false);
});

test('a gzip response is decompressed', async () => {
	const response = await sendRequest(request('GET', '/gzip', undefined, { 'Accept-Encoding': 'gzip' }), options());
	assert.equal(response.body.toString('utf8'), 'compressed payload');
});

test('a redirect is followed and the final URL is the requested one', async () => {
	const response = await sendRequest(request('GET', '/redirect'), options());
	assert.equal(response.status, 200);
	assert.match(response.body.toString('utf8'), /"ok":true/);
	assert.equal(response.url, `${origin}/json`);
});

test('redirects are not followed when the setting is off', async () => {
	const response = await sendRequest(request('GET', '/redirect'), { ...options(), followRedirects: false });
	assert.equal(response.status, 302);
	assert.equal(response.headers.location, '/json');
});

test('a POST body and content type reach the server', async () => {
	const response = await sendRequest(
		request('POST', '/echo', Buffer.from('{"name":"Sagar"}'), { 'Content-Type': 'application/json' }),
		options()
	);
	assert.deepEqual(JSON.parse(response.body.toString('utf8')), { body: '{"name":"Sagar"}', contentType: 'application/json' });
});

test('the cookie jar keeps a session between requests', async () => {
	await sendRequest(request('GET', '/login'), options());
	assert.equal(jar.get(`${origin}/json`, 'laravel_session'), 'abc123');

	const response = await sendRequest(request('GET', '/json'), options());
	assert.equal(JSON.parse(response.body.toString('utf8')).cookie, 'laravel_session=abc123');
});

test('a 404 is returned as a normal response, not an error', async () => {
	const response = await sendRequest(request('GET', '/nope'), options());
	assert.equal(response.status, 404);
	assert.equal(response.body.toString('utf8'), 'missing');
});

test('a refused connection is reported in plain words', async () => {
	const closed = createServer(handler);
	const port = await new Promise<number>(resolve => closed.listen(0, '127.0.0.1', () => resolve((closed.address() as AddressInfo).port)));
	await new Promise<void>(resolve => closed.close(() => resolve()));

	await assert.rejects(
		sendRequest({ method: 'GET', url: `http://127.0.0.1:${port}/json`, headers: {} }, options()),
		/Is the server running/
	);
});

test('a timeout is reported with the configured duration', async () => {
	const slow = createServer((_req, res) => {
		setTimeout(() => {
			res.writeHead(200);
			res.end('late');
		}, 2000);
	});
	await new Promise<void>(resolve => slow.listen(0, '127.0.0.1', resolve));
	const port = (slow.address() as AddressInfo).port;
	try {
		await assert.rejects(
			sendRequest({ method: 'GET', url: `http://127.0.0.1:${port}/`, headers: {} }, { ...options(), timeoutMs: 300 }),
			/timed out after/
		);
	} finally {
		await new Promise<void>(resolve => slow.close(() => resolve()));
	}
});
