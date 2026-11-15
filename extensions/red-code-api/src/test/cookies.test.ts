/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CookieJar, decodeCookieValue } from '../cookies.js';

const APP = 'http://localhost:8000/api/users';
const OTHER = 'http://127.0.0.1:8000/api/users';

test('cookies are scoped to the host and sent back as one header', () => {
	const jar = new CookieJar();
	jar.store(APP, ['XSRF-TOKEN=abc%3D%3D; Path=/', 'laravel_session=xyz; Path=/; HttpOnly']);

	assert.equal(jar.header(APP), 'XSRF-TOKEN=abc%3D%3D; laravel_session=xyz');
	assert.equal(jar.header(OTHER), undefined);
	assert.equal(jar.size, 2);
	assert.equal(decodeCookieValue(jar.get(APP, 'XSRF-TOKEN')!), 'abc==');
});

test('the same host on another port keeps the session', () => {
	const jar = new CookieJar();
	jar.store('http://localhost:8000/login', 'laravel_session=xyz');
	assert.equal(jar.header('http://localhost:8080/api/users'), 'laravel_session=xyz');
});

test('a cookie is replaced and an expired cookie is removed', () => {
	const jar = new CookieJar();
	jar.store(APP, 'token=one');
	jar.store(APP, 'token=two');
	assert.equal(jar.header(APP), 'token=two');

	jar.store(APP, 'token=gone; Max-Age=0');
	assert.equal(jar.header(APP), undefined);
	assert.equal(jar.size, 0);
});

test('an Expires date in the past removes the cookie', () => {
	const jar = new CookieJar();
	jar.store(APP, 'old=1');
	jar.store(APP, 'old=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
	assert.equal(jar.header(APP), undefined);
});

test('a non-cookie header and a malformed Set-Cookie are ignored', () => {
	const jar = new CookieJar();
	jar.store(APP, 'no-equals-sign');
	jar.store(APP, '=value');
	jar.store('not a url', 'a=b');
	assert.equal(jar.header(APP), undefined);
	assert.equal(jar.header(OTHER), undefined);
});

test('clear removes everything', () => {
	const jar = new CookieJar();
	jar.store(APP, 'a=b');
	jar.clear();
	assert.equal(jar.header(APP), undefined);
	assert.equal(jar.size, 0);
});

test('decodeCookieValue leaves a value without escapes untouched', () => {
	assert.equal(decodeCookieValue('plain'), 'plain');
	assert.equal(decodeCookieValue('%E0%A4%A'), '%E0%A4%A');
});
