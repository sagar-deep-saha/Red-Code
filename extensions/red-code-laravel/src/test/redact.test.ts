/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactSecrets } from '../redact.js';

test('secret assignments are redacted while variable names survive', () => {
	const output = redactSecrets('DB_PASSWORD=hunter2\nAPP_KEY=base64:abc123\nAWS_SECRET_ACCESS_KEY=xyz');
	assert.equal(output, 'DB_PASSWORD=***\nAPP_KEY=***\nAWS_SECRET_ACCESS_KEY=***');
});

test('ordinary values are not modified', () => {
	assert.equal(redactSecrets('APP_NAME=Laravel'), 'APP_NAME=Laravel');
	assert.equal(redactSecrets('php artisan route:list --json'), 'php artisan route:list --json');
});

test('already-redacted values stay redacted and repeated assignments are all caught', () => {
	const output = redactSecrets('API_TOKEN=*** API_TOKEN=second');
	assert.equal(output, 'API_TOKEN=*** API_TOKEN=***');
});
