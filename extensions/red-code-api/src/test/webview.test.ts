/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRequest } from '../model.js';
import { renderRequestPanel } from '../webview.js';

const webview = { cspSource: 'vscode-webview://test', asWebviewUri: (uri: unknown) => uri };

function render(): string {
	return renderRequestPanel(webview as never, {
		request: normalizeRequest({ name: 'New Request', method: 'GET', url: '{{baseUrl}}/api/users' }),
		sourceLabel: 'New Request',
		environment: '',
		baseUrl: 'http://localhost:8000',
		defaultBaseUrl: 'http://localhost:8000',
		selectedBaseUrlProfile: '',
		baseUrlProfiles: [],
		endpoints: [],
		readOnly: false,
		activeRequestTab: 'params'
	});
}

function scriptOf(html: string): string {
	const match = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html);
	assert.ok(match, 'the panel HTML must contain one inline script');
	return match[1];
}

test('the inline panel script parses', () => {
	// The panel script lives inside a template literal, so an escape such as `\/` collapses to `/`
	// and silently turns a regex into a comment. Parsing the emitted script catches that.
	assert.doesNotThrow(() => new Function(scriptOf(render())));
});

test('the inline panel script does not contain an escaped-solidus artifact', () => {
	assert.ok(!scriptOf(render()).includes('replace(//'), 'a regex must not degrade into a line comment');
});

test('the CSP nonce matches the script nonce', () => {
	const html = render();
	const csp = /script-src 'nonce-([^']+)'/.exec(html);
	const tag = /<script nonce="([^"]+)">/.exec(html);
	assert.ok(csp);
	assert.ok(tag);
	assert.equal(csp[1], tag[1]);
});
