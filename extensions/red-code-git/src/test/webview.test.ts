/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderGraphHtml } from '../graphHtml.js';

const webview = { cspSource: 'vscode-webview://test', asWebviewUri: (uri: unknown) => uri };

function render(): string {
	return renderGraphHtml(webview as never, 'TESTNONCE1234567890');
}

function scriptOf(html: string): string {
	const match = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html);
	assert.ok(match, 'the panel HTML must contain one inline script');
	return match[1];
}

test('the inline graph script parses', () => {
	// The HTML is a template literal, so an escaped solidus such as `\/` collapses to `/`
	// and can silently turn a regex into a comment. Parsing the emitted script catches it.
	assert.doesNotThrow(() => new Function(scriptOf(render())));
});

test('the inline graph script has no escaped-solidus artifact', () => {
	const script = scriptOf(render());
	assert.ok(!script.includes('replace(//'), 'a regex must not degrade into a line comment');
});

test('the CSP nonce matches the script nonce', () => {
	const html = render();
	const csp = /script-src 'nonce-([^']+)'/.exec(html);
	const tag = /<script nonce="([^"]+)">/.exec(html);
	assert.ok(csp);
	assert.ok(tag);
	assert.equal(csp[1], tag[1]);
});

test('every element the script looks up exists in the markup', () => {
	const html = render();
	const script = scriptOf(html);
	const ids = new Set<string>();
	for (const match of script.matchAll(/getElementById\('([^']+)'\)/g)) {
		ids.add(match[1]);
	}
	assert.ok(ids.size > 10, 'expected the graph script to look up its controls');
	for (const id of ids) {
		assert.ok(html.includes(`id="${id}"`), `missing element id="${id}"`);
	}
});
