/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ApiRequest, BaseUrlProfile, SavedEndpoint } from './model.js';

export interface PanelState {
	readonly request: ApiRequest;
	readonly sourceLabel: string;
	readonly environment: string;
	readonly baseUrl: string | undefined;
	readonly defaultBaseUrl: string | undefined;
	readonly selectedBaseUrlProfile: string;
	readonly baseUrlProfiles: readonly BaseUrlProfile[];
	readonly endpoints: readonly SavedEndpoint[];
	readonly readOnly: boolean;
	readonly response?: Record<string, unknown>;
	readonly activeRequestTab?: string;
	readonly collection?: string;
	readonly sending?: boolean;
}

function nonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let index = 0; index < 32; index++) {
		value += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return value;
}

/** Escapes a JSON payload so it can sit inside a `<script>` element. */
export function serializeInitialState(state: unknown): string {
	return JSON.stringify(state)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

export function renderRequestPanel(webview: vscode.Webview, state: PanelState): string {
	const scriptNonce = nonce();
	const initialState = serializeInitialState(state);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	:root { color-scheme: light dark; }
	* { box-sizing: border-box; }
	body { margin: 0; padding: 0 12px 16px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
	header { display: flex; gap: 8px; align-items: center; padding: 12px 0 8px; position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 2; }
	select, input, textarea, button { font-family: inherit; font-size: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 4px 6px; }
	select:focus, input:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
	button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
	button:hover { background: var(--vscode-button-secondaryHoverBackground); }
	button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; padding: 4px 18px; }
	button.primary:hover { background: var(--vscode-button-hoverBackground); }
	button.danger { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-inputValidation-errorForeground, #fff); }
	button:disabled { opacity: .5; cursor: default; }
	#method { width: 104px; font-weight: 600; }
	#url { flex: 1; min-width: 120px; font-family: var(--vscode-editor-font-family); }
	.namebar { display: grid; grid-template-columns: 74px minmax(0, 1fr); align-items: center; gap: 8px; padding: 2px 0 8px; }
	.namebar .label { color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
	#requestName { width: 100%; }
	.workspacebar { display: grid; grid-template-columns: auto minmax(120px, 180px) minmax(160px, 1fr) auto minmax(160px, 260px); align-items: center; gap: 8px; padding: 7px 0 10px; border-bottom: 1px solid var(--vscode-panel-border); }
	.workspacebar .label { color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; letter-spacing: .04em; }
	.workspacebar input, .workspacebar select { min-width: 0; width: 100%; }
	.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; color: var(--vscode-descriptionForeground); font-size: 12px; padding: 8px 0; }
	.toolbar .spacer { flex: 1; }
	nav { display: flex; gap: 2px; border-bottom: 1px solid var(--vscode-panel-border); }
	nav button { border: none; border-radius: 0; background: transparent; color: var(--vscode-descriptionForeground); padding: 5px 12px; }
	nav button.active { color: var(--vscode-foreground); border-bottom: 1px solid var(--vscode-focusBorder); background: transparent; }
	nav button .count { color: var(--vscode-descriptionForeground); }
	.panel { display: none; padding: 10px 0; }
	.panel.visible { display: block; }
	table.kv { width: 100%; border-collapse: collapse; }
	table.kv th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); font-weight: 600; padding: 0 4px 2px; }
	table.kv td { padding: 2px 4px 2px 0; vertical-align: middle; }
	table.kv input[type=text] { width: 100%; }
	table.kv input[type=checkbox] { accent-color: var(--vscode-focusBorder); }
	table.kv td.flag { width: 24px; }
	table.kv td.remove { width: 28px; }
	table.kv td.remove button, table.kv td.pick button { padding: 2px 6px; }
	table.kv select.kind { width: 82px; }
	textarea { width: 100%; min-height: 150px; resize: vertical; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
	.modes { display: flex; gap: 14px; margin-bottom: 8px; font-size: 12px; flex-wrap: wrap; }
	.authgrid { display: grid; grid-template-columns: 150px minmax(160px, 1fr); align-items: center; gap: 6px 10px; max-width: 640px; }
	.authgrid .label { color: var(--vscode-descriptionForeground); font-size: 12px; }
	#responsePane { border-top: 1px solid var(--vscode-panel-border); margin-top: 12px; padding-top: 8px; }
	#status { display: flex; gap: 14px; align-items: center; font-size: 12px; color: var(--vscode-descriptionForeground); min-height: 26px; flex-wrap: wrap; }
	#status .code { font-weight: 700; }
	#status .ok { color: var(--vscode-testing-iconPassed, #3fb950); }
	#status .warn { color: var(--vscode-editorWarning-foreground, #d29922); }
	#status .bad { color: var(--vscode-errorForeground, #f85149); }
	.responsebar { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
	.responsebar .actions { display: flex; gap: 6px; }
	pre#responseBody { margin: 8px 0 0; padding: 10px; overflow: auto; max-height: 62vh; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); border-radius: 2px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre-wrap; word-break: break-word; }
	table.headers { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
	table.headers td { padding: 3px 8px 3px 0; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; word-break: break-all; }
	table.headers td:first-child { color: var(--vscode-descriptionForeground); width: 30%; }
	.hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
	.empty { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 10px 0; }
	#toast { position: fixed; right: 16px; bottom: 16px; padding: 8px 12px; border-radius: 3px; background: var(--vscode-notifications-background); color: var(--vscode-notifications-foreground); border: 1px solid var(--vscode-notifications-border); opacity: 0; transition: opacity .15s; pointer-events: none; max-width: 60vw; }
	#toast.visible { opacity: 1; }
	.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
</head>
<body>
<header>
	<select id="method" aria-label="HTTP method"></select>
	<input id="url" type="text" spellcheck="false" placeholder="{{baseUrl}}/api/users" aria-label="Request URL">
	<button id="send" class="primary">Send</button>
	<button id="save" title="Save this request into a collection">Save</button>
</header>
<div class="namebar"><span class="label">Request</span><input id="requestName" type="text" placeholder="Name this request" aria-label="Request name"></div>
<div class="workspacebar">
	<span class="label">Base URL</span>
	<select id="baseUrlProfile" aria-label="Saved base URL profiles"></select>
	<input id="baseUrl" type="text" spellcheck="false" placeholder="http://localhost:8000" aria-label="Base URL">
	<button id="saveBaseUrl" title="Save this base URL as a named profile">Save URL</button>
	<select id="savedEndpoint" aria-label="Saved endpoints"><option value="">Open saved request…</option></select>
</div>
<div class="toolbar">
	<span id="source"></span>
	<span class="spacer"></span>
	<button id="environment" title="Pick the environment file layered over .env"></button>
	<button id="csrf" title="GET /sanctum/csrf-cookie">CSRF cookie</button>
	<button id="cookies">Clear cookies</button>
</div>

<nav id="requestTabs" role="tablist">
	<button data-tab="params" role="tab">Params <span class="count" data-count="params"></span></button>
	<button data-tab="auth" role="tab">Auth</button>
	<button data-tab="headers" role="tab">Headers <span class="count" data-count="headers"></span></button>
	<button data-tab="body" role="tab">Body</button>
</nav>

<div class="panel visible" data-panel="params" role="tabpanel">
	<table class="kv" id="params">
		<thead><tr><th class="flag"></th><th>Name</th><th>Value</th><th></th><th></th></tr></thead>
		<tbody></tbody>
	</table>
	<button data-add="params">Add parameter</button>
</div>

<div class="panel" data-panel="auth" role="tabpanel">
	<div class="authgrid">
		<span class="label">Type</span>
		<select id="authType" aria-label="Authorization type">
			<option value="none">No authorization</option>
			<option value="basic">Basic</option>
			<option value="bearer">Bearer token</option>
		</select>
		<span class="label" data-auth="basic">Username</span>
		<input id="authUsername" type="text" spellcheck="false" data-auth="basic" placeholder="user@example.test" aria-label="Basic auth username">
		<span class="label" data-auth="basic">Password</span>
		<input id="authPassword" type="password" data-auth="basic" aria-label="Basic auth password">
		<span class="label" data-auth="bearer">Token</span>
		<input id="authToken" type="password" spellcheck="false" data-auth="bearer" placeholder="{{token}}" aria-label="Bearer token">
	</div>
	<p class="hint">Authorization headers you add yourself under Headers win over this tab.</p>
</div>

<div class="panel" data-panel="headers" role="tabpanel">
	<table class="kv" id="headers">
		<thead><tr><th class="flag"></th><th>Header</th><th>Value</th><th></th><th></th></tr></thead>
		<tbody></tbody>
	</table>
	<button data-add="headers">Add header</button>
</div>

<div class="panel" data-panel="body" role="tabpanel">
	<div class="modes">
		<label><input type="radio" name="mode" value="none"> None</label>
		<label><input type="radio" name="mode" value="json"> JSON</label>
		<label><input type="radio" name="mode" value="text"> Text</label>
		<label><input type="radio" name="mode" value="form"> Form URL-encoded</label>
		<label><input type="radio" name="mode" value="multipart"> Multipart form</label>
	</div>
	<textarea id="body" spellcheck="false" placeholder='{ "name": "Sagar" }' aria-label="Request body"></textarea>
	<div id="bodyFields" style="display:none">
		<table class="kv" id="bodyParams">
			<thead><tr><th class="flag"></th><th>Name</th><th>Value</th><th class="kindcol">Type</th><th></th><th></th></tr></thead>
			<tbody></tbody>
		</table>
		<button data-add="bodyParams">Add field</button>
	</div>
	<p class="hint" id="bodyHint"></p>
</div>

<section id="responsePane">
	<div class="responsebar">
		<nav id="responseTabs">
			<button data-rtab="body" class="active">Body</button>
			<button data-rtab="headers">Headers</button>
		</nav>
		<div class="actions">
			<button id="copyResponse" title="Copy the response body">Copy</button>
			<button id="openResponse" title="Open the response body in an editor">Open in editor</button>
		</div>
	</div>
	<div id="status"><span class="hint">No response yet.</span></div>
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
	const requestName = document.getElementById('requestName');
	const baseUrl = document.getElementById('baseUrl');
	const baseUrlProfile = document.getElementById('baseUrlProfile');
	const savedEndpoint = document.getElementById('savedEndpoint');
	const bodyText = document.getElementById('body');
	const bodyFields = document.getElementById('bodyFields');
	const bodyParams = document.getElementById('bodyParams');
	const bodyHint = document.getElementById('bodyHint');
	const authType = document.getElementById('authType');
	const authUsername = document.getElementById('authUsername');
	const authPassword = document.getElementById('authPassword');
	const authToken = document.getElementById('authToken');
	const status = document.getElementById('status');
	const responseBody = document.getElementById('responseBody');
	const responseHeaders = document.getElementById('responseHeaders');
	const sendButton = document.getElementById('send');
	let sending = false;
	let dirty = false;
	let persistTimer;
	let lastResponse = state.response;
	let appliedBaseUrl = state.baseUrl || state.defaultBaseUrl || '';
	let rowUid = 0;

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
		clearTimeout(toast.timer);
		toast.timer = setTimeout(() => element.classList.remove('visible'), 2400);
	}

	function makeRow(table, entry, options) {
		const settings = options || {};
		const tbody = table.tBodies[0] || table;
		const row = document.createElement('tr');
		row.dataset.uid = String(++rowUid);

		const flagCell = document.createElement('td');
		flagCell.className = 'flag';
		const enabled = document.createElement('input');
		enabled.type = 'checkbox';
		enabled.checked = entry.enabled !== false;
		enabled.title = 'Include this row';
		enabled.setAttribute('aria-label', 'Include row');
		flagCell.appendChild(enabled);

		const nameCell = document.createElement('td');
		const name = document.createElement('input');
		name.type = 'text';
		name.value = entry.name || '';
		name.placeholder = settings.namePlaceholder || 'name';
		name.spellcheck = false;
		name.setAttribute('aria-label', settings.nameLabel || 'Name');
		nameCell.appendChild(name);

		const valueCell = document.createElement('td');
		const value = document.createElement('input');
		value.type = 'text';
		value.value = entry.value || '';
		value.placeholder = settings.valuePlaceholder || 'value';
		value.spellcheck = false;
		value.setAttribute('aria-label', settings.valueLabel || 'Value');
		valueCell.appendChild(value);

		row.append(flagCell, nameCell, valueCell);

		if (settings.multipart) {
			const kindCell = document.createElement('td');
			const kind = document.createElement('select');
			kind.className = 'kind';
			kind.setAttribute('aria-label', 'Field type');
			for (const [value_, label] of [['text', 'Text'], ['file', 'File']]) {
				const option = document.createElement('option');
				option.value = value_;
				option.textContent = label;
				kind.appendChild(option);
			}
			kind.value = entry.kind === 'file' ? 'file' : 'text';
			kind.addEventListener('change', () => {
				value.disabled = kind.value === 'file';
				value.placeholder = kind.value === 'file' ? '(choose a file)' : 'value';
				if (kind.value === 'file') {
					value.value = '';
				}
				markDirty();
			});
			value.disabled = kind.value === 'file';
			value.placeholder = kind.value === 'file' ? '(choose a file)' : 'value';
			kindCell.appendChild(kind);
			row.append(kindCell);

			const pickCell = document.createElement('td');
			pickCell.className = 'pick';
			const pick = document.createElement('button');
			pick.textContent = '…';
			pick.title = 'Choose file';
			pick.addEventListener('click', () => {
				vscode.postMessage({ type: 'pickFile', uid: row.dataset.uid });
			});
			pickCell.appendChild(pick);
			row.append(pickCell);

			const removeCell = document.createElement('td');
			removeCell.className = 'remove';
			const remove = document.createElement('button');
			remove.textContent = '×';
			remove.title = 'Remove row';
			remove.addEventListener('click', () => { row.remove(); markDirty(); });
			removeCell.appendChild(remove);
			row.append(removeCell);
		} else {
			row.append(document.createElement('td'));
			const removeCell = document.createElement('td');
			removeCell.className = 'remove';
			const remove = document.createElement('button');
			remove.textContent = '×';
			remove.title = 'Remove row';
			remove.addEventListener('click', () => { row.remove(); markDirty(); });
			removeCell.appendChild(remove);
			row.append(removeCell);
		}

		tbody.appendChild(row);
		return row;
	}

	function fillTable(table, entries, addEmpty, options) {
		const tbody = table.tBodies[0];
		tbody.textContent = '';
		const list = entries && entries.length ? entries : (addEmpty ? [{ name: '', value: '', enabled: true }] : []);
		for (const entry of list) {
			makeRow(table, entry, options);
		}
		updateCounts();
	}

	function readTable(table, multipart) {
		const entries = [];
		for (const row of table.tBodies[0].rows) {
			const inputs = row.querySelectorAll('input[type=text]');
			const name = inputs[0].value.trim();
			const value = inputs[1].value;
			if (!name && !value) {
				continue;
			}
			const entry = { name: name, value: value, enabled: row.querySelector('input[type=checkbox]').checked };
			if (multipart) {
				const kind = row.querySelector('select.kind');
				entry.kind = kind && kind.value === 'file' ? 'file' : 'text';
			}
			entries.push(entry);
		}
		return entries;
	}

	function updateCounts() {
		const params = document.querySelectorAll('#params tbody tr').length;
		const headers = document.querySelectorAll('#headers tbody tr').length;
		const paramsCount = document.querySelector('[data-count=params]');
		const headersCount = document.querySelector('[data-count=headers]');
		if (paramsCount) { paramsCount.textContent = params > 1 ? '(' + params + ')' : ''; }
		if (headersCount) { headersCount.textContent = headers > 1 ? '(' + headers + ')' : ''; }
	}

	function currentRequest() {
		const mode = (document.querySelector('input[name=mode]:checked') || { value: 'none' }).value;
		const request = {
			name: requestName.value.trim() || state.request.name,
			method: method.value,
			url: url.value.trim(),
			params: readTable(document.getElementById('params'), false),
			headers: readTable(document.getElementById('headers'), false),
			body: { mode: mode, text: bodyText.value },
			auth: {
				type: authType.value,
				username: authUsername.value,
				password: authPassword.value,
				token: authToken.value
			}
		};
		if (mode === 'form' || mode === 'multipart') {
			request.body.params = readTable(bodyParams, true);
		}
		return request;
	}

	function snapshot() {
		const activeTab = document.querySelector('#requestTabs button.active');
		let savedResponse = lastResponse;
		if (savedResponse && typeof savedResponse.body === 'string' && savedResponse.body.length > 512 * 1024) {
			savedResponse = Object.assign({}, savedResponse, { body: '[Response omitted from the restored tab because it exceeded 512 KB.]' });
		}
		return {
			request: currentRequest(),
			sourceLabel: state.sourceLabel,
			baseUrl: chosenBaseUrl(),
			selectedBaseUrlProfile: baseUrlProfile.value,
			readOnly: state.readOnly,
			collection: state.collection,
			response: savedResponse,
			activeRequestTab: activeTab ? activeTab.dataset.tab : 'params'
		};
	}

	function chosenBaseUrl() {
		const value = baseUrl.value.trim();
		if (!value) {
			return undefined;
		}
		if (baseUrlProfile.value) {
			return value;
		}
		return value === (state.defaultBaseUrl || '') ? undefined : value;
	}

	function markDirty() {
		dirty = true;
		clearTimeout(persistTimer);
		persistTimer = setTimeout(persistDraft, 150);
	}

	function persistDraft() {
		const current = snapshot();
		vscode.setState(current);
		vscode.postMessage({ type: 'draftChanged', snapshot: current });
	}

	function setSending(value) {
		sending = value;
		sendButton.textContent = value ? 'Cancel' : 'Send';
		sendButton.classList.toggle('danger', value);
		sendButton.classList.toggle('primary', !value);
	}

	function updateAuthVisibility() {
		const type = authType.value;
		for (const element of document.querySelectorAll('[data-auth]')) {
			element.style.display = element.dataset.auth === type ? '' : 'none';
		}
	}

	function updateBodyMode() {
		const mode = (document.querySelector('input[name=mode]:checked') || { value: 'none' }).value;
		const textual = mode === 'json' || mode === 'text';
		const keyed = mode === 'form' || mode === 'multipart';
		bodyText.style.display = textual ? '' : 'none';
		bodyFields.style.display = keyed ? '' : 'none';
		bodyParams.querySelectorAll('select.kind, td.pick').forEach(element => {
			element.style.display = mode === 'multipart' ? '' : 'none';
		});
		bodyParams.querySelectorAll('th.kindcol').forEach(element => {
			element.style.display = mode === 'multipart' ? '' : 'none';
		});
		for (const row of bodyParams.tBodies[0].rows) {
			const kind = row.querySelector('select.kind');
			const inputs = row.querySelectorAll('input[type=text]');
			if (!kind || inputs.length < 2) {
				continue;
			}
			const isFile = mode === 'multipart' && kind.value === 'file';
			inputs[1].disabled = isFile;
			inputs[1].placeholder = isFile ? '(choose a file)' : 'value';
		}
		bodyHint.textContent = mode === 'multipart'
			? 'File fields send the selected file; text fields send their value.'
			: mode === 'form'
				? 'Sent as application/x-www-form-urlencoded.'
				: mode === 'json'
					? 'Sent as application/json unless a Content-Type header says otherwise.'
					: '';
		updateCounts();
	}

	function applyState(next, forceRequest) {
		Object.assign(state, next);
		if (forceRequest || !dirty) {
			if (next.request) {
				method.value = next.request.method;
				requestName.value = next.request.name;
				url.value = next.request.url;
				authType.value = (next.request.auth && next.request.auth.type) || 'none';
				authUsername.value = (next.request.auth && next.request.auth.username) || '';
				authPassword.value = (next.request.auth && next.request.auth.password) || '';
				authToken.value = (next.request.auth && next.request.auth.token) || '';
				fillTable(document.getElementById('params'), next.request.params, true);
				fillTable(document.getElementById('headers'), next.request.headers, true);
				for (const radio of document.querySelectorAll('input[name=mode]')) {
					radio.checked = radio.value === (next.request.body.mode || 'none');
				}
				bodyText.value = next.request.body.text || '';
				fillTable(bodyParams, next.request.body.params, true, {
					multipart: true,
					namePlaceholder: 'field',
					valuePlaceholder: 'value'
				});
			}
			baseUrl.value = next.baseUrl || next.defaultBaseUrl || '';
			appliedBaseUrl = baseUrl.value;
			dirty = false;
		}

		baseUrlProfile.textContent = '';
		const defaultOption = document.createElement('option');
		defaultOption.value = '';
		defaultOption.textContent = 'Use .env / custom URL';
		baseUrlProfile.appendChild(defaultOption);
		for (const profile of next.baseUrlProfiles || []) {
			const option = document.createElement('option');
			option.value = profile.name;
			option.textContent = profile.name + ' · ' + profile.url;
			baseUrlProfile.appendChild(option);
		}
		baseUrlProfile.value = next.selectedBaseUrlProfile || '';

		savedEndpoint.textContent = '';
		const endpointPlaceholder = document.createElement('option');
		endpointPlaceholder.value = '';
		endpointPlaceholder.textContent = 'Open saved request…';
		savedEndpoint.appendChild(endpointPlaceholder);
		let collectionName = '';
		let group;
		for (const endpoint of next.endpoints || []) {
			if (endpoint.collection !== collectionName) {
				collectionName = endpoint.collection;
				group = document.createElement('optgroup');
				group.label = collectionName;
				savedEndpoint.appendChild(group);
			}
			const option = document.createElement('option');
			option.value = endpoint.id;
			option.textContent = endpoint.request.method + ' ' + endpoint.request.name;
			group.appendChild(option);
		}
		savedEndpoint.value = '';

		document.getElementById('source').textContent = next.sourceLabel + (next.collection ? '  ·  saves to ' + next.collection : '');
		document.getElementById('environment').textContent = 'Environment: ' + (next.environment || 'none');
		for (const button of document.querySelectorAll('#requestTabs button')) {
			button.classList.toggle('active', button.dataset.tab === (next.activeRequestTab || 'params'));
		}
		for (const panel of document.querySelectorAll('.panel')) {
			panel.classList.toggle('visible', panel.dataset.panel === (next.activeRequestTab || 'params'));
		}
		updateAuthVisibility();
		updateBodyMode();
		if (next.sending !== undefined) {
			setSending(next.sending);
		}
		if (next.response) {
			showResponse(next.response);
		}
	}

	applyState(state, true);

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

	for (const button of document.querySelectorAll('[data-add]')) {
		button.addEventListener('click', () => {
			const table = document.getElementById(button.dataset.add);
			const multipart = button.dataset.add === 'bodyParams';
			makeRow(table, { name: '', value: '', enabled: true }, {
				multipart: multipart,
				namePlaceholder: multipart ? 'field' : 'name'
			});
			updateCounts();
			updateBodyMode();
			markDirty();
		});
	}

	for (const radio of document.querySelectorAll('input[name=mode]')) {
		radio.addEventListener('change', () => { updateBodyMode(); markDirty(); });
	}

	authType.addEventListener('change', () => { updateAuthVisibility(); markDirty(); });

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

	sendButton.addEventListener('click', () => {
		if (sending) {
			vscode.postMessage({ type: 'cancel' });
			return;
		}
		clearTimeout(persistTimer);
		persistDraft();
		setSending(true);
		status.textContent = '';
		const note = document.createElement('span');
		note.className = 'hint';
		note.textContent = 'Waiting for response…';
		status.appendChild(note);
		vscode.postMessage({ type: 'send', request: currentRequest(), baseUrl: chosenBaseUrl(), profileName: baseUrlProfile.value });
	});

	document.getElementById('save').addEventListener('click', () => {
		vscode.postMessage({ type: 'save', request: currentRequest(), baseUrl: chosenBaseUrl(), profileName: baseUrlProfile.value, collectionName: state.collection });
	});

	baseUrlProfile.addEventListener('change', () => {
		const profile = (state.baseUrlProfiles || []).find(item => item.name === baseUrlProfile.value);
		const nextBaseUrl = profile ? profile.url : (state.defaultBaseUrl || '');
		retargetRequest(appliedBaseUrl);
		baseUrl.value = nextBaseUrl;
		appliedBaseUrl = nextBaseUrl;
		markDirty();
		vscode.postMessage({ type: 'selectBaseUrl', profileName: baseUrlProfile.value });
	});

	baseUrl.addEventListener('input', () => {
		retargetRequest(appliedBaseUrl);
		baseUrlProfile.value = '';
		appliedBaseUrl = baseUrl.value.trim();
		markDirty();
	});

	document.getElementById('saveBaseUrl').addEventListener('click', () => {
		vscode.postMessage({ type: 'saveBaseUrlProfile', url: baseUrl.value.trim() });
	});

	savedEndpoint.addEventListener('change', () => {
		const id = savedEndpoint.value;
		savedEndpoint.value = '';
		if (id) {
			vscode.postMessage({ type: 'openEndpoint', endpointId: id });
		}
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

	document.getElementById('copyResponse').addEventListener('click', () => {
		vscode.postMessage({ type: 'copyResponse' });
	});

	document.getElementById('openResponse').addEventListener('click', () => {
		vscode.postMessage({ type: 'openInEditor' });
	});

	url.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendButton.click();
		}
	});

	document.body.addEventListener('keydown', event => {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			sendButton.click();
		}
	});

	function retargetRequest(previous) {
		// NOTE: this file emits the panel script through a template literal, so an escaped solidus
		// would collapse to a plain solidus and start a line comment. Use a character class.
		const oldBase = (previous || '').replace(/[/]+$/, '');
		const currentUrl = url.value;
		if (!oldBase || !currentUrl.toLowerCase().startsWith(oldBase.toLowerCase())) {
			return;
		}
		const suffix = currentUrl.slice(oldBase.length);
		if (suffix && !['/', '?', '#'].includes(suffix.charAt(0))) {
			return;
		}
		url.value = '{{baseUrl}}' + suffix;
	}

	document.body.addEventListener('input', event => {
		if (event.target.closest('#responseBody')) {
			return;
		}
		markDirty();
	});
	document.body.addEventListener('change', event => {
		if (event.target.closest('#responseBody')) {
			return;
		}
		markDirty();
	});
	window.addEventListener('beforeunload', () => {
		clearTimeout(persistTimer);
		persistDraft();
	});
	persistDraft();

	function humanSize(bytes) {
		if (bytes < 1024) {
			return bytes + ' B';
		}
		if (bytes < 1024 * 1024) {
			return (bytes / 1024).toFixed(1) + ' KB';
		}
		return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
	}

	function describeStatus(response) {
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
	}

	function showResponse(response) {
		setSending(false);
		lastResponse = response;
		describeStatus(response);

		let text = response.body;
		if (!response.binary && /json/i.test(response.contentType || '')) {
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

		// Keep the response across a window restart without touching unsaved edits.
		vscode.setState(snapshot());
	}

	function showError(message) {
		setSending(false);
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
		} else if (message.type === 'sending') {
			setSending(true);
		} else if (message.type === 'cancelled') {
			setSending(false);
			status.textContent = '';
			const element = document.createElement('span');
			element.className = 'warn';
			element.textContent = 'Request cancelled.';
			status.appendChild(element);
		} else if (message.type === 'error') {
			showError(message.message);
		} else if (message.type === 'saved') {
			toast('Saved to ' + message.file);
		} else if (message.type === 'state') {
			applyState(message.state, false);
		} else if (message.type === 'notice') {
			toast(message.message);
		} else if (message.type === 'filePicked') {
			const row = document.querySelector('tr[data-uid="' + message.uid + '"]');
			if (row) {
				const inputs = row.querySelectorAll('input[type=text]');
				inputs[1].value = message.path;
				markDirty();
			}
		}
	});
}());
</script>
</body>
</html>`;
}
