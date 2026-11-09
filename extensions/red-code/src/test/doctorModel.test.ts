/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspaceChecks, sanitizeToolVersion } from '../doctorModel.js';

test('workspace doctor reports project dependencies without reading environment contents', () => {
	const checks = createWorkspaceChecks('web', new Set(['.git', 'package.json', 'pnpm-lock.yaml', '.env']));
	assert.deepEqual(checks.map(check => [check.label, check.status]), [
		['Git metadata', 'ok'],
		['JavaScript project', 'ok'],
		['Node dependencies', 'warning'],
		['JavaScript lockfile', 'ok'],
		['PHP project', 'info'],
		['Composer dependencies', 'info'],
		['Environment file', 'ok']
	]);
	assert.equal(checks[0].folderName, 'web');
	assert.equal(checks.at(-1)?.description, 'Found .env; contents were not read');
});

test('tool versions are limited to one sanitized line', () => {
	assert.equal(sanitizeToolVersion('v24.22.1\nsecret-value'), 'v24.22.1');
	assert.equal(sanitizeToolVersion('version\u0000with-control'), 'version with-control');
});
