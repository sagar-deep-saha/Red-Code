/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createEnvironment, ENVIRONMENTS_FOLDER, environmentFileName, listEnvironments, loadVariables } from '../variables.js';

test('variables merge user setting, .env and the selected environment', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'redcode-api-'));
	try {
		await writeFile(path.join(root, '.env'), 'APP_URL=https://app.test/\nTOKEN=from-env\nSHARED=env\n', 'utf8');
		const environments = path.join(root, ENVIRONMENTS_FOLDER);
		await mkdir(environments, { recursive: true });
		await writeFile(path.join(environments, 'local.json'), JSON.stringify({ TOKEN: 'from-environment', EXTRA: 42 }), 'utf8');

		const variables = await loadVariables({
			workspaceRoot: root,
			environment: 'local',
			userVariables: { SHARED: 'setting', ONLY_SETTING: 'yes' }
		});

		assert.equal(variables.baseUrl, 'https://app.test');
		assert.equal(variables.APP_URL, 'https://app.test/');
		assert.equal(variables.SHARED, 'env');
		assert.equal(variables.TOKEN, 'from-environment');
		assert.equal(variables.EXTRA, '42');
		assert.equal(variables.ONLY_SETTING, 'yes');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('a missing workspace or missing files is not an error', async () => {
	assert.deepEqual(await loadVariables({ workspaceRoot: undefined, environment: 'local', userVariables: { A: 'b' } }), { A: 'b' });
	const root = await mkdtemp(path.join(tmpdir(), 'redcode-api-'));
	try {
		assert.deepEqual(await loadVariables({ workspaceRoot: root, environment: 'nope', userVariables: {} }), {});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('listEnvironments sorts the JSON file names', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'redcode-api-'));
	try {
		const environments = path.join(root, ENVIRONMENTS_FOLDER);
		await mkdir(environments, { recursive: true });
		await writeFile(path.join(environments, 'staging.json'), '{}', 'utf8');
		await writeFile(path.join(environments, 'local.json'), '{}', 'utf8');
		await writeFile(path.join(environments, 'notes.txt'), '', 'utf8');

		assert.deepEqual(await listEnvironments(root), ['local', 'staging']);
		assert.deepEqual(await listEnvironments(undefined), []);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('baseUrl follows the final APP_URL unless a source sets baseUrl', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'redcode-api-'));
	try {
		const environments = path.join(root, ENVIRONMENTS_FOLDER);
		await mkdir(environments, { recursive: true });
		await writeFile(path.join(root, '.env'), 'APP_URL=https://env.test/\n', 'utf8');
		await writeFile(path.join(environments, 'local.json'), JSON.stringify({ APP_URL: 'https://local.test//' }), 'utf8');
		await writeFile(path.join(environments, 'custom.json'), JSON.stringify({ baseUrl: 'https://explicit.test', APP_URL: 'https://ignored.test' }), 'utf8');

		const local = await loadVariables({ workspaceRoot: root, environment: 'local', userVariables: {} });
		assert.equal(local.baseUrl, 'https://local.test');

		const custom = await loadVariables({ workspaceRoot: root, environment: 'custom', userVariables: {} });
		assert.equal(custom.baseUrl, 'https://explicit.test');

		const fromSetting = await loadVariables({ workspaceRoot: root, environment: 'local', userVariables: { baseUrl: 'https://setting.test' } });
		assert.equal(fromSetting.baseUrl, 'https://setting.test');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('createEnvironment writes one JSON file and refuses duplicates', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'redcode-api-'));
	try {
		assert.equal(environmentFileName('Local Dev'), 'Local-Dev.json');
		assert.equal(environmentFileName('  '), 'environment.json');

		const file = await createEnvironment(root, 'Local Dev');
		assert.equal(path.basename(file), 'Local-Dev.json');
		assert.equal(await readFile(file, 'utf8'), '{}\n');
		await assert.rejects(createEnvironment(root, 'Local Dev'), /already exists/);
		await assert.rejects(createEnvironment(undefined, 'Local'), /Open a folder/);
		await assert.rejects(createEnvironment(root, '   '), /needs a name/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
