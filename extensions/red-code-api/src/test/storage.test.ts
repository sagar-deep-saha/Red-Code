/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createCollection, deleteBaseUrlProfile, deleteCollectionFile, deleteRequest, listCollections, readBaseUrlProfiles, readCollectionFile, renameRequest, saveBaseUrlProfile, saveRequestToFile } from '../storage.js';
import { normalizeRequest } from '../model.js';

test('base URL profiles can be saved, replaced and loaded from the workspace', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'red-code-api-'));
	try {
		await saveBaseUrlProfile(root, 'Local', 'http://localhost:8080///');
		await saveBaseUrlProfile(root, 'local', 'https://api.example.test/');

		assert.deepEqual(await readBaseUrlProfiles(root), [{ name: 'local', url: 'https://api.example.test' }]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('base URL profiles reject non-HTTP protocols', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'red-code-api-'));
	try {
		await assert.rejects(saveBaseUrlProfile(root, 'Files', 'file:///etc/passwd'), /http:\/\/ or https:\/\//);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('collections can be created once as workspace JSON files', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'red-code-api-'));
	try {
		const file = await createCollection(root, 'Users');
		assert.match(await readFile(file, 'utf8'), /"requests": \[\]/);
		await assert.rejects(createCollection(root, 'users'), /already exists/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('requests can be added, renamed and removed in a collection file', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'red-code-api-'));
	try {
		const file = await createCollection(root, 'Users');
		const list = normalizeRequest({ name: 'List', method: 'GET', url: '{{baseUrl}}/api/users' });
		const create = normalizeRequest({ name: 'Create', method: 'POST', url: '{{baseUrl}}/api/users' });

		await saveRequestToFile(file, list);
		await saveRequestToFile(file, create);
		assert.deepEqual((await readCollectionFile(file)).requests.map(request => request.name), ['List', 'Create']);

		// Saving the same name updates the existing entry instead of duplicating it.
		await saveRequestToFile(file, { ...list, url: '{{baseUrl}}/api/v2/users' });
		const updated = await readCollectionFile(file);
		assert.equal(updated.requests.length, 2);
		assert.equal(updated.requests[0].url, '{{baseUrl}}/api/v2/users');

		assert.equal((await renameRequest(file, 'Create', 'Store'))?.name, 'Store');
		assert.deepEqual((await readCollectionFile(file)).requests.map(request => request.name), ['List', 'Store']);
		assert.equal(await renameRequest(file, 'missing', 'x'), undefined);

		assert.equal(await deleteRequest(file, 'List'), true);
		assert.equal(await deleteRequest(file, 'List'), false);
		assert.deepEqual((await readCollectionFile(file)).requests.map(request => request.name), ['Store']);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('collections are listed and deleted, and profiles can be removed', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'red-code-api-'));
	try {
		const first = await createCollection(root, 'Users');
		await createCollection(root, 'Orders');
		assert.deepEqual((await listCollections(root)).map(collection => collection.name), ['orders', 'users']);
		assert.deepEqual(await listCollections(path.join(root, 'missing')), []);

		await deleteCollectionFile(first);
		assert.deepEqual((await listCollections(root)).map(collection => collection.name), ['orders']);

		await saveBaseUrlProfile(root, 'Local', 'http://localhost:8000');
		assert.equal(await deleteBaseUrlProfile(root, 'Local'), true);
		assert.equal(await deleteBaseUrlProfile(root, 'Local'), false);
		assert.deepEqual(await readBaseUrlProfiles(root), []);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
