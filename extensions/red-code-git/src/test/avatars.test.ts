/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { gravatarUrl } from '../avatars.js';

test('Gravatar lookup is disabled unless explicitly enabled', () => {
	assert.equal(gravatarUrl('sagar@example.com', false), undefined);
});

test('Gravatar URLs use the normalized email hash, not the email itself', () => {
	const url = gravatarUrl('  SAGAR@example.com  ', true);

	assert.match(url ?? '', /^https:\/\/www\.gravatar\.com\/avatar\/[a-f0-9]{32}\?d=404&s=64$/);
	assert.equal(url?.includes('sagar@example.com'), false);
	assert.equal(url, gravatarUrl('sagar@example.com', true));
});

test('invalid author emails do not trigger remote avatar lookups', () => {
	assert.equal(gravatarUrl('not-an-email', true), undefined);
	assert.equal(gravatarUrl('', true), undefined);
});
