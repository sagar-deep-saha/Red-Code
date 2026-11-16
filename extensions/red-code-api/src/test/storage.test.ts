/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createCollection, readBaseUrlProfiles, saveBaseUrlProfile } from '../storage.js';

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
