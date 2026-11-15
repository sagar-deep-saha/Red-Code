/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ApiRequest } from './model.js';

export interface PanelState {
	readonly request: ApiRequest;
	readonly sourceLabel: string;
	readonly environment: string;
	readonly baseUrl: string | undefined;
	readonly readOnly: boolean;
}

function nonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let index = 0; index < 32; index++) {
		value += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return value;
}

export function renderRequestPanel(webview: vscode.Webview, state: PanelState): string {
	const scriptNonce = nonce();
	const initialState = JSON.stringify(state).replace(/</g, '\\u003c');
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	:root { color-scheme: light dark; }
	body { margin: 0; padding: 0 12px 12px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
	header { display: flex; gap: 8px; align-items: center; padding: 12px 0 8px; position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 2; }
	select, input, textarea, button { font-family: inherit; font-size: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 4px 6px; }
	button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
	button:hover { background: var(--vscode-button-secondaryHoverBackground); }
	button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; padding: 4px 18px; }
	button.primary:hover { background: var(--vscode-button-hoverBackground); }
	button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
	#method { width: 96px; font-weight: 600; }
	#url { flex: 1; min-width: 120px; }
	.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; color: var(--vscode-descriptionForeground); font-size: 12px; padding-bottom: 8px; }
	nav { display: flex; gap: 2px; border-bottom: 1px solid var(--vscode-panel-border); }
	nav button { border: none; border-radius: 0; background: transparent; color: var(--vscode-descriptionForeground); padding: 5px 12px; }
	nav button.active { color: var(--vscode-foreground); border-bottom: 1px solid var(--vscode-focusBorder); background: transparent; }
	.panel { display: none; padding: 10px 0; }
	.panel.visible { display: block; }
	table.kv { width: 100%; border-collapse: collapse; }
	table.kv td { padding: 2px 4px 2px 0; vertical-align: middle; }
	table.kv input[type=text] { width: 100%; }
	table.kv input[type=checkbox] { accent-color: var(--vscode-focusBorder); }
	table.kv td.remove { width: 28px; }
	table.kv td.remove button { padding: 2px 6px; }
	textarea { width: 100%; min-height: 140px; resize: vertical; box-sizing: border-box; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
	.modes { display: flex; gap: 12px; margin-bottom: 6px; font-size: 12px; }
	#responsePane { border-top: 1px solid var(--vscode-panel-border); margin-top: 12px; padding-top: 8px; }
	#status { display: flex; gap: 14px; align-items: center; font-size: 12px; color: var(--vscode-descriptionForeground); min-height: 24px; }
	#status .code { font-weight: 700; }
	#status .ok { color: var(--vscode-testing-iconPassed, #3fb950); }
	#status .warn { color: var(--vscode-editorWarning-foreground, #d29922); }
	#status .bad { color: var(--vscode-errorForeground, #f85149); }
	pre#body { margin: 8px 0 0; padding: 10px; overflow: auto; max-height: 62vh; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); border-radius: 2px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre-wrap; word-break: break-word; }
	table.headers { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
	table.headers td { padding: 3px 8px 3px 0; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; word-break: break-all; }
	table.headers td:first-child { color: var(--vscode-descriptionForeground); width: 30%; }
	.hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
	#toast { position: fixed; right: 16px; bottom: 16px; padding: 8px 12px; border-radius: 3px; background: var(--vscode-notifications-background); color: var(--vscode-notifications-foreground); border: 1px solid var(--vscode-notifications-border); opacity: 0; transition: opacity .15s; pointer-events: none; }
	#toast.visible { opacity: 1; }
</style>
</head>
<body>
<header>
	<select id="method" aria-label="Method"></select>
	<input id="url" type="text" spellcheck="false" placeholder="https://example.test/api/users">
	<button id="send" class="primary">Send</button>
	<button id="save">Save</button>
</header>
<div class="toolbar">
	<span id="source"></span>
	<span>·</span>
	<button id="environment"></button>
	<button id="csrf" title="GET /sanctum/csrf-cookie">CSRF cookie</button>
	<button id="cookies">Clear cookies</button>
	<span id="baseurl" class="hint"></span>
</div>

<nav id="requestTabs">
	<button data-tab="params">Params</button>
	<button data-tab="headers">Headers</button>
	<button data-tab="body">Body</button>
</nav>
<div class="panel visible" data-panel="params">
	<table class="kv" id="params"></table>
	<button data-add="params">Add parameter</button>
</div>
<div class="panel" data-panel="headers">
	<table class="kv" id="headers"></table>
	<button data-add="headers">Add header</button>
</div>
<div class="panel" data-panel="body">
	<div class="modes">
		<label><input type="radio" name="mode" value="none"> None</label>
		<label><input type="radio" name="mode" value="json"> JSON</label>
		<label><input type="radio" name="mode" value="text"> Text</label>
	</div>
	<textarea id="body" spellcheck="false" placeholder='{ "name": "Sagar" }'></textarea>
</div>

<section id="responsePane">
	<div id="status"><span class="hint">No response yet.</span></div>
	<nav id="responseTabs">
		<button data-rtab="body" class="active">Body</button>
		<button data-rtab="headers">Headers</button>
	</nav>
	<pre id="responseBody"></pre>
	<table class="headers" id="responseHeaders" style="display:none"></table>
</section>
<div id="toast"></div>

<script nonce="${scriptNonce}">
(function () {
	const vscode = acquireVsCodeApi();
	const state = ${initialState};
	const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
	const method = document.getElementById('method');
	const url = document.getElementById('url');
	const bodyText = document.getElementById('body');
	const status = document.getElementById('status');
	const responseBody = document.getElementById('responseBody');
	const responseHeaders = document.getElementById('responseHeaders');
	let sending = false;

	for (const name of methods) {
		const option = document.createElement('option');
		option.value = name;
		option.textContent = name;
		method.appendChild(option);
	}

	function toast(message) {
		const element = document.getElementById('toast');
		element.textContent = message;
		element.classList.add('visible');
		setTimeout(() => element.classList.remove('visible'), 2200);
	}

	function makeRow(table, entry) {
		const row = document.createElement('tr');
		const enabledCell = document.createElement('td');
		const enabled = document.createElement('input');
		enabled.type = 'checkbox';
		enabled.checked = entry.enabled !== false;
		enabledCell.appendChild(enabled);
		const nameCell = document.createElement('td');
		const name = document.createElement('input');
		name.type = 'text';
		name.value = entry.name || '';
		name.placeholder = 'name';
		name.spellcheck = false;
		nameCell.appendChild(name);
		const valueCell = document.createElement('td');
		const value = document.createElement('input');
		value.type = 'text';
		value.value = entry.value || '';
		value.placeholder = 'value';
		value.spellcheck = false;
		valueCell.appendChild(value);
		const removeCell = document.createElement('td');
		removeCell.className = 'remove';
		const remove = document.createElement('button');
		remove.textContent = '×';
		remove.title = 'Remove';
		remove.addEventListener('click', () => row.remove());
		removeCell.appendChild(remove);
		row.append(enabledCell, nameCell, valueCell, removeCell);
		table.appendChild(row);
	}

	function fillTable(table, entries, addEmpty) {
		table.textContent = '';
		const list = entries && entries.length ? entries : (addEmpty ? [{ name: '', value: '', enabled: true }] : []);
		for (const entry of list) {
			makeRow(table, entry);
		}
	}

	function readTable(table) {
		const entries = [];
		for (const row of table.querySelectorAll('tr')) {
			const inputs = row.querySelectorAll('input');
			const name = inputs[1].value.trim();
			const value = inputs[2].value;
			if (!name && !value) {
				continue;
			}
			entries.push({ name: name, value: value, enabled: inputs[0].checked });
		}
		return entries;
	}

	function currentRequest() {
		return {
			name: state.request.name,
			method: method.value,
			url: url.value.trim(),
			params: readTable(document.getElementById('params')),
			headers: readTable(document.getElementById('headers')),
			body: {
				mode: (document.querySelector('input[name=mode]:checked') || { value: 'none' }).value,
				text: bodyText.value
			}
		};
	}

	function applyState(next) {
		state.request = next.request;
		method.value = next.request.method;
		url.value = next.request.url;
		fillTable(document.getElementById('params'), next.request.params, true);
		fillTable(document.getElementById('headers'), next.request.headers, true);
		for (const radio of document.querySelectorAll('input[name=mode]')) {
			radio.checked = radio.value === (next.request.body.mode || 'none');
		}
		bodyText.value = next.request.body.text || '';
		document.getElementById('source').textContent = next.sourceLabel;
		document.getElementById('environment').textContent = 'Environment: ' + (next.environment || 'none');
		document.getElementById('baseurl').textContent = next.baseUrl ? 'baseUrl = ' + next.baseUrl : 'no APP_URL in .env';
		document.getElementById('save').style.display = next.readOnly ? 'none' : '';
	}

	applyState(state);

	for (const button of document.querySelectorAll('#requestTabs button')) {
		button.addEventListener('click', () => {
			for (const other of document.querySelectorAll('#requestTabs button')) {
				other.classList.toggle('active', other === button);
			}
			for (const panel of document.querySelectorAll('.panel')) {
				panel.classList.toggle('visible', panel.dataset.panel === button.dataset.tab);
			}
		});
	}
	document.querySelector('#requestTabs button').classList.add('active');

	for (const button of document.querySelectorAll('[data-add]')) {
		button.addEventListener('click', () => makeRow(document.getElementById(button.dataset.add), { name: '', value: '', enabled: true }));
	}

	for (const button of document.querySelectorAll('#responseTabs button')) {
		button.addEventListener('click', () => {
			const showBody = button.dataset.rtab === 'body';
			for (const other of document.querySelectorAll('#responseTabs button')) {
				other.classList.toggle('active', other === button);
			}
			responseBody.style.display = showBody ? '' : 'none';
			responseHeaders.style.display = showBody ? 'none' : '';
		});
	}

	document.getElementById('send').addEventListener('click', () => {
		if (sending) {
			return;
		}
		sending = true;
		const send = document.getElementById('send');
		send.textContent = 'Sending…';
		status.textContent = '';
		const note = document.createElement('span');
		note.className = 'hint';
		note.textContent = 'Waiting for response…';
		status.appendChild(note);
		vscode.postMessage({ type: 'send', request: currentRequest() });
	});

	document.getElementById('save').addEventListener('click', () => {
		vscode.postMessage({ type: 'save', request: currentRequest() });
	});

	document.getElementById('environment').addEventListener('click', () => {
		vscode.postMessage({ type: 'selectEnvironment' });
	});

	document.getElementById('cookies').addEventListener('click', () => {
		vscode.postMessage({ type: 'clearCookies' });
	});

	document.getElementById('csrf').addEventListener('click', () => {
		vscode.postMessage({ type: 'fetchCsrf' });
	});

	url.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			document.getElementById('send').click();
		}
	});

	function humanSize(bytes) {
		if (bytes < 1024) {
			return bytes + ' B';
		}
		if (bytes < 1024 * 1024) {
			return (bytes / 1024).toFixed(1) + ' KB';
		}
		return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
	}

	function showResponse(response) {
		sending = false;
		document.getElementById('send').textContent = 'Send';
		status.textContent = '';

		const code = document.createElement('span');
		code.className = 'code ' + (response.status >= 200 && response.status < 300 ? 'ok' : response.status < 400 ? 'warn' : 'bad');
		code.textContent = response.status + ' ' + response.statusText;
		const time = document.createElement('span');
		time.textContent = response.durationMs + ' ms';
		const size = document.createElement('span');
		size.textContent = humanSize(response.sizeBytes);
		status.append(code, time, size);
		if (response.truncated) {
			const note = document.createElement('span');
			note.className = 'bad';
			note.textContent = 'body truncated at 8 MB';
			status.appendChild(note);
		}
		if (response.url && response.url !== url.value.trim()) {
			const final = document.createElement('span');
			final.className = 'hint';
			final.textContent = '→ ' + response.url;
			status.appendChild(final);
		}

		let text = response.body;
		if (/json/i.test(response.contentType || '')) {
			try {
				text = JSON.stringify(JSON.parse(text), null, 2);
			} catch {
				// Not valid JSON despite the header; show it as received.
			}
		}
		responseBody.textContent = text;

		responseHeaders.textContent = '';
		for (const [name, value] of Object.entries(response.headers)) {
			const row = document.createElement('tr');
			const nameCell = document.createElement('td');
			nameCell.textContent = name;
			const valueCell = document.createElement('td');
			valueCell.textContent = value;
			row.append(nameCell, valueCell);
			responseHeaders.appendChild(row);
		}
	}

	function showError(message) {
		sending = false;
		document.getElementById('send').textContent = 'Send';
		status.textContent = '';
		const element = document.createElement('span');
		element.className = 'bad';
		element.textContent = message;
		status.appendChild(element);
	}

	window.addEventListener('message', event => {
		const message = event.data;
		if (message.type === 'response') {
			showResponse(message.response);
		} else if (message.type === 'error') {
			showError(message.message);
		} else if (message.type === 'saved') {
			toast('Saved to ' + message.file);
		} else if (message.type === 'state') {
			applyState(message.state);
		} else if (message.type === 'notice') {
			toast(message.message);
		}
	});
}());
</script>
</body>
</html>`;
}
