/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CookieJar, decodeCookieValue } from './cookies.js';
import { ApiResponse, decodeBody, looksBinary, sendRequest } from './http.js';
import { allowsBody, ApiRequest, BaseUrlProfile, buildUrl, KeyValue, missingVariables, normalizeRequest, resolveRequest, SavedEndpoint } from './model.js';
import { PanelState, renderRequestPanel } from './webview.js';

export interface PanelServices {
	loadVariables(): Promise<Record<string, string>>;
	environment(): string;
	save(request: ApiRequest, collectionName?: string): Promise<string | undefined>;
	selectEnvironment(): Promise<void>;
	loadBaseUrlProfiles(): Promise<BaseUrlProfile[]>;
	saveBaseUrlProfile(name: string, url: string): Promise<void>;
	loadSavedEndpoints(): Promise<SavedEndpoint[]>;
	currentCollection(): string | undefined;
}

interface PanelMessage {
	type: string;
	request?: unknown;
	snapshot?: unknown;
	baseUrl?: unknown;
	profileName?: unknown;
	url?: unknown;
	endpointId?: unknown;
	collectionName?: unknown;
	text?: unknown;
	uid?: unknown;
}

export class RequestPanel implements vscode.Disposable {
	private readonly tabs = new Set<RequestTab>();
	private activeTab: RequestTab | undefined;
	private jar = new CookieJar();

	constructor(private readonly services: PanelServices) { }

	dispose(): void {
		for (const tab of this.tabs) {
			tab.release();
		}
		this.tabs.clear();
		this.activeTab = undefined;
		this.jar.clear();
	}

	get cookies(): CookieJar {
		return this.jar;
	}

	/** Collection the focused tab saves into, used by the Save dialog. */
	get activeCollection(): string | undefined {
		return this.activeTab?.collectionName;
	}

	async show(request: ApiRequest, sourceLabel: string, readOnly: boolean, baseUrl?: string, profileName = '', collectionName?: string): Promise<void> {
		let tab!: RequestTab;
		tab = new RequestTab(this.services, this.jar, {
			focus: () => this.activeTab = tab,
			dispose: () => {
				this.tabs.delete(tab);
				if (this.activeTab === tab) {
					this.activeTab = undefined;
				}
			}
		});
		this.tabs.add(tab);
		this.activeTab = tab;
		await tab.show(request, sourceLabel, readOnly, baseUrl, profileName, collectionName);
	}

	async restore(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
		let tab!: RequestTab;
		tab = new RequestTab(this.services, this.jar, {
			focus: () => this.activeTab = tab,
			dispose: () => {
				this.tabs.delete(tab);
				if (this.activeTab === tab) {
					this.activeTab = undefined;
				}
			}
		});
		this.tabs.add(tab);
		if (panel.active || !this.activeTab) {
			this.activeTab = tab;
		}
		await tab.restore(panel, state);
	}

	/** Opens a saved endpoint in a new tab so unsaved work in the current one is not lost. */
	async openEndpoint(id: string): Promise<void> {
		const endpoint = (await this.services.loadSavedEndpoints()).find(candidate => candidate.id === id);
		if (!endpoint) {
			throw new Error('That saved endpoint no longer exists. Refresh the collections view.');
		}
		await this.show(endpoint.request, `${endpoint.collection} / ${endpoint.request.name}`, false, undefined, '', endpoint.collection);
	}

	async duplicateActive(): Promise<void> {
		const tab = this.activeTab;
		if (!tab) {
			void vscode.window.showInformationMessage('Red Code API: open a request tab to duplicate it.');
			return;
		}
		const request = { ...tab.request, name: `${tab.request.name} copy` };
		await this.show(request, `${tab.label} (copy)`, false, tab.baseUrl, tab.profileName, tab.collectionName);
	}

	async activeBaseUrl(): Promise<string | undefined> {
		if (this.activeTab?.baseUrl !== undefined) {
			return this.activeTab.baseUrl;
		}
		const variables = await this.services.loadVariables();
		return variables.baseUrl ?? variables.APP_URL;
	}

	/** Used by the "Fetch CSRF cookie" command when no tab is open. */
	async fetchCsrf(url: string): Promise<void> {
		await fetchCsrfFor(url, this.jar);
	}
}

interface TabCallbacks {
	focus(): void;
	dispose(): void;
}

interface PersistedTab {
	request?: unknown;
	sourceLabel?: unknown;
	readOnly?: unknown;
	baseUrl?: unknown;
	selectedBaseUrlProfile?: unknown;
	response?: unknown;
	activeRequestTab?: unknown;
	collection?: unknown;
}

class RequestTab {
	private panel: vscode.WebviewPanel | undefined;
	private current: ApiRequest = normalizeRequest({ url: '{{baseUrl}}/api/' });
	private sourceLabel = 'Unsaved request';
	private readOnly = false;
	private baseUrlOverride: string | undefined;
	private selectedBaseUrlProfile = '';
	private response: Record<string, unknown> | undefined;
	private activeRequestTab = 'params';
	private collection: string | undefined;
	private inFlight: AbortController | undefined;
	private sendToken = 0;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly services: PanelServices,
		private readonly jar: CookieJar,
		private readonly callbacks: TabCallbacks
	) { }

	get request(): ApiRequest {
		return this.current;
	}

	get baseUrl(): string | undefined {
		return this.baseUrlOverride;
	}

	get label(): string {
		return this.sourceLabel;
	}

	get profileName(): string {
		return this.selectedBaseUrlProfile;
	}

	get collectionName(): string | undefined {
		return this.collection;
	}

	async show(request: ApiRequest, sourceLabel: string, readOnly: boolean, baseUrl?: string, profileName = '', collectionName?: string): Promise<void> {
		this.current = normalizeRequest(request);
		this.sourceLabel = sourceLabel;
		this.readOnly = readOnly;
		this.baseUrlOverride = baseUrl;
		this.selectedBaseUrlProfile = profileName;
		this.collection = collectionName;
		this.panel = vscode.window.createWebviewPanel('redCode.api.request', request.name, vscode.ViewColumn.Active, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: []
		});
		this.attach();
		this.callbacks.focus();
		await this.render();
	}

	async restore(panel: vscode.WebviewPanel, serialized: unknown): Promise<void> {
		const state = (typeof serialized === 'object' && serialized !== null ? serialized : {}) as PersistedTab;
		try {
			this.current = normalizeRequest(state.request);
		} catch {
			this.current = normalizeRequest({ name: 'Restored Request', url: '{{baseUrl}}/api/' });
		}
		this.sourceLabel = typeof state.sourceLabel === 'string' ? state.sourceLabel : 'Restored request';
		this.readOnly = state.readOnly === true;
		this.baseUrlOverride = typeof state.baseUrl === 'string' ? state.baseUrl : undefined;
		this.selectedBaseUrlProfile = typeof state.selectedBaseUrlProfile === 'string' ? state.selectedBaseUrlProfile : '';
		this.collection = typeof state.collection === 'string' ? state.collection : undefined;
		this.response = isRecord(state.response) ? state.response : undefined;
		this.activeRequestTab = typeof state.activeRequestTab === 'string' ? state.activeRequestTab : 'params';
		this.panel = panel;
		this.panel.webview.options = {
			enableScripts: true,
			localResourceRoots: []
		};
		this.attach();
		this.callbacks.focus();
		await this.render();
	}

	private attach(): void {
		const panel = this.panel;
		if (!panel) {
			return;
		}
		panel.title = this.current.name;
		this.disposables.push(panel.onDidDispose(() => {
			this.inFlight?.abort();
			for (const disposable of this.disposables.splice(0)) {
				disposable.dispose();
			}
			this.callbacks.dispose();
		}));
		this.disposables.push(panel.onDidChangeViewState(event => {
			if (event.webviewPanel.active) {
				this.callbacks.focus();
			}
		}));
		this.disposables.push(panel.webview.onDidReceiveMessage(message => void this.onMessage(message as PanelMessage)));
	}

	release(): void {
		this.inFlight?.abort();
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
	}

	private async variables(): Promise<Record<string, string>> {
		const variables = await this.services.loadVariables();
		if (this.baseUrlOverride !== undefined) {
			variables.baseUrl = this.baseUrlOverride.replace(/\/+$/, '');
		}
		return variables;
	}

	private async state(): Promise<PanelState> {
		const [variables, baseUrlProfiles, endpoints] = await Promise.all([
			this.services.loadVariables(),
			this.services.loadBaseUrlProfiles(),
			this.services.loadSavedEndpoints()
		]);
		const defaultBaseUrl = variables.baseUrl ?? variables.APP_URL;
		return {
			request: this.current,
			sourceLabel: this.sourceLabel,
			environment: this.services.environment(),
			baseUrl: this.baseUrlOverride ?? defaultBaseUrl,
			defaultBaseUrl,
			selectedBaseUrlProfile: this.selectedBaseUrlProfile,
			baseUrlProfiles,
			endpoints,
			readOnly: this.readOnly,
			response: this.response,
			activeRequestTab: this.activeRequestTab,
			collection: this.collection,
			sending: this.inFlight !== undefined
		};
	}

	private async render(): Promise<void> {
		if (this.panel) {
			this.panel.title = this.current.name;
			this.panel.webview.html = renderRequestPanel(this.panel.webview, await this.state());
		}
	}

	private async post(payload: unknown): Promise<void> {
		await this.panel?.webview.postMessage(payload);
	}

	private updateDraft(value: unknown): void {
		if (!isRecord(value)) {
			return;
		}
		try {
			this.current = normalizeRequest(value.request);
		} catch {
			// Keep the last valid request while the user is temporarily editing an empty URL.
		}
		if (typeof value.sourceLabel === 'string') {
			this.sourceLabel = value.sourceLabel;
		}
		this.readOnly = value.readOnly === true;
		this.baseUrlOverride = typeof value.baseUrl === 'string' && value.baseUrl.trim().length > 0 ? value.baseUrl.trim() : undefined;
		this.selectedBaseUrlProfile = typeof value.selectedBaseUrlProfile === 'string' ? value.selectedBaseUrlProfile : '';
		this.response = isRecord(value.response) ? value.response : undefined;
		this.activeRequestTab = typeof value.activeRequestTab === 'string' ? value.activeRequestTab : 'params';
		if (typeof value.collection === 'string') {
			this.collection = value.collection;
		}
		if (this.panel) {
			this.panel.title = this.current.name;
		}
	}

	private async onMessage(message: PanelMessage): Promise<void> {
		try {
			switch (message.type) {
				case 'draftChanged':
					this.updateDraft(message.snapshot);
					return;
				case 'send':
					this.applyBaseUrl(message.baseUrl, message.profileName);
					await this.send(message.request);
					return;
				case 'cancel':
					this.cancel();
					return;
				case 'save':
					this.applyBaseUrl(message.baseUrl, message.profileName);
					await this.save(message.request, typeof message.collectionName === 'string' ? message.collectionName : undefined);
					return;
				case 'selectEnvironment':
					await this.services.selectEnvironment();
					await this.postState();
					return;
				case 'selectBaseUrl':
					await this.selectBaseUrl(typeof message.profileName === 'string' ? message.profileName : '');
					return;
				case 'saveBaseUrlProfile':
					await this.saveBaseUrlProfile(typeof message.url === 'string' ? message.url : '');
					return;
				case 'openEndpoint': {
					const id = typeof message.endpointId === 'string' ? message.endpointId : '';
					if (id) {
						await vscode.commands.executeCommand('redCode.api.openSavedEndpoint', id);
					}
					return;
				}
				case 'openInEditor':
					await this.openResponseInEditor();
					return;
				case 'pickFile': {
					const uid = typeof message.uid === 'string' ? message.uid : '';
					const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Use file' });
					if (picked?.[0]) {
						await this.post({ type: 'filePicked', uid, path: picked[0].fsPath });
					}
					return;
				}
				case 'copyResponse':
					await vscode.env.clipboard.writeText(typeof this.response?.body === 'string' ? this.response.body : '');
					await this.post({ type: 'notice', message: 'Response body copied.' });
					return;
				case 'clearCookies':
					this.jar.clear();
					await this.post({ type: 'notice', message: 'Cookies cleared.' });
					return;
				case 'fetchCsrf': {
					const variables = await this.variables();
					await this.fetchCsrfFor(buildUrl(this.current, variables));
					await this.post({ type: 'notice', message: 'CSRF cookie stored.' });
					return;
				}
				default:
					return;
			}
		} catch (error) {
			if (isAbort(error)) {
				await this.post({ type: 'cancelled' });
				return;
			}
			await this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	private cancel(): void {
		this.inFlight?.abort();
		this.inFlight = undefined;
	}

	private applyBaseUrl(value: unknown, profileName: unknown): void {
		this.baseUrlOverride = typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
		this.selectedBaseUrlProfile = typeof profileName === 'string' ? profileName : '';
	}

	private async selectBaseUrl(profileName: string): Promise<void> {
		this.selectedBaseUrlProfile = profileName;
		if (!profileName) {
			this.baseUrlOverride = undefined;
		} else {
			const profile = (await this.services.loadBaseUrlProfiles()).find(item => item.name === profileName);
			if (!profile) {
				throw new Error(`Base URL profile "${profileName}" no longer exists.`);
			}
			this.baseUrlOverride = profile.url;
		}
		await this.postState();
	}

	private async saveBaseUrlProfile(url: string): Promise<void> {
		if (!url.trim()) {
			throw new Error('Enter a base URL before saving it.');
		}
		const name = await vscode.window.showInputBox({
			title: 'Save Base URL',
			prompt: 'Name this base URL profile. It is saved in .redcode/api/base-urls.json.',
			validateInput: value => value.trim().length === 0 ? 'Enter a profile name.' : undefined
		});
		if (!name) {
			return;
		}
		await this.services.saveBaseUrlProfile(name, url);
		this.baseUrlOverride = url.trim();
		this.selectedBaseUrlProfile = name.trim();
		await this.postState();
		await this.post({ type: 'notice', message: `Base URL "${name.trim()}" saved.` });
	}

	private async postState(): Promise<void> {
		await this.post({ type: 'state', state: await this.state() });
	}

	private async send(raw: unknown): Promise<void> {
		const request = normalizeRequest(raw);
		validateRows(request.params, 'query parameter');
		validateRows(request.headers, 'header');
		validateRows(request.body.params ?? [], request.body.mode === 'multipart' ? 'multipart field' : 'form field');

		this.current = request;
		const variables = await this.variables();
		const missing = missingVariables(request, variables);
		if (missing.length > 0) {
			throw new Error(`Unknown variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} to .env or redCode.api.variables.`);
		}

		const resolved = await resolveRequest(request, variables, {
			loadFile: filePath => {
				const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				const absolute = path.isAbsolute(filePath) || !root ? filePath : path.join(root, filePath);
				return readFile(absolute);
			}
		});
		if (!allowsBody(resolved.method)) {
			resolved.body = undefined;
		}

		const configuration = vscode.workspace.getConfiguration('redCode.api');
		const controller = new AbortController();
		this.inFlight = controller;
		// Only the newest send may report into the panel; a cancelled request must not clear a new one.
		const token = ++this.sendToken;
		await this.post({ type: 'sending' });
		try {
			if (configuration.get<boolean>('laravelCsrf', true) && resolved.method !== 'GET' && resolved.method !== 'HEAD') {
				const hasHeader = Object.keys(resolved.headers).some(name => name.toLowerCase() === 'x-xsrf-token');
				if (!hasHeader) {
					if (!this.jar.get(resolved.url, 'XSRF-TOKEN')) {
						await fetchCsrfFor(resolved.url, this.jar, controller.signal).catch(() => undefined);
					}
					const csrfToken = this.jar.get(resolved.url, 'XSRF-TOKEN');
					if (csrfToken) {
						resolved.headers['X-XSRF-TOKEN'] = decodeCookieValue(csrfToken);
					}
				}
			}

			const response = await sendRequest(resolved, {
				timeoutMs: configuration.get<number>('timeoutMs', 30000),
				verifyTls: configuration.get<boolean>('verifyTls', true),
				followRedirects: configuration.get<boolean>('followRedirects', true),
				cookieJar: this.jar,
				signal: controller.signal
			});
			if (token !== this.sendToken) {
				return;
			}
			this.response = this.describe(response);
			await this.post({ type: 'response', response: this.response });
		} catch (error) {
			if (isAbort(error)) {
				if (token === this.sendToken) {
					await this.post({ type: 'cancelled' });
				}
				return;
			}
			if (token === this.sendToken) {
				throw error;
			}
		} finally {
			if (this.inFlight === controller) {
				this.inFlight = undefined;
			}
		}
	}

	private describe(response: ApiResponse): Record<string, unknown> {
		const contentType = response.headers['content-type'] ?? '';
		const text = decodeBody(response.body, contentType);
		const binary = looksBinary(response.body);
		const body = binary
			? `<${response.body.length} bytes of binary data>`
			: text;
		return {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
			body,
			sizeBytes: response.body.length,
			durationMs: response.durationMs,
			url: response.url,
			truncated: response.truncated,
			contentType,
			binary
		};
	}

	private async openResponseInEditor(): Promise<void> {
		if (!this.response) {
			throw new Error('Send the request first; there is no response to open.');
		}
		const body = typeof this.response.body === 'string' ? this.response.body : '';
		const extension = /json/i.test(String(this.response.contentType ?? '')) ? 'json'
			: /html/i.test(String(this.response.contentType ?? '')) ? 'html'
				: /xml/i.test(String(this.response.contentType ?? '')) ? 'xml'
					: 'txt';
		const document = await vscode.workspace.openTextDocument({ content: body, language: extension === 'txt' ? 'plaintext' : extension });
		await vscode.window.showTextDocument(document, { preview: true });
	}

	private async save(raw: unknown, collectionName?: string): Promise<void> {
		const request = normalizeRequest(raw);
		this.current = request;
		const target = collectionName?.trim() || this.services.currentCollection();
		const file = await this.services.save(request, target);
		if (!file) {
			return;
		}
		this.sourceLabel = file;
		this.readOnly = false;
		if (this.panel) {
			this.panel.title = request.name;
		}
		await this.post({ type: 'saved', file });
		await this.postState();
	}

	private async fetchCsrfFor(url: string): Promise<void> {
		await fetchCsrfFor(url, this.jar);
	}

	/** Exposed for the command palette: stores the cookie for the active request origin. */
	async fetchCsrf(): Promise<void> {
		const variables = await this.variables();
		await this.fetchCsrfFor(buildUrl(this.current, variables));
	}
}

function validateRows(rows: readonly KeyValue[], label: string): void {
	for (const row of rows) {
		if (row.enabled && row.name.trim().length === 0 && row.value.trim().length > 0) {
			throw new Error(`A ${label} has a value but no name. Fill the name or remove the row.`);
		}
	}
}

function isAbort(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

async function fetchCsrfFor(url: string, jar: CookieJar, signal?: AbortSignal): Promise<void> {
	let origin: string;
	try {
		origin = new URL(url).origin;
	} catch {
		throw new Error('Enter an absolute URL first so the CSRF cookie has a host to come from.');
	}
	const configuration = vscode.workspace.getConfiguration('redCode.api');
	const response = await sendRequest({
		method: 'GET',
		url: `${origin}/sanctum/csrf-cookie`,
		headers: { Accept: 'application/json' }
	}, {
		timeoutMs: configuration.get<number>('timeoutMs', 30000),
		verifyTls: configuration.get<boolean>('verifyTls', true),
		followRedirects: configuration.get<boolean>('followRedirects', true),
		cookieJar: jar,
		signal
	});
	if (response.status >= 400) {
		throw new Error(`GET ${origin}/sanctum/csrf-cookie answered ${response.status}. Is Sanctum installed?`);
	}
	if (!jar.get(`${origin}/`, 'XSRF-TOKEN')) {
		throw new Error(`No XSRF-TOKEN cookie came back from ${origin}/sanctum/csrf-cookie.`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
