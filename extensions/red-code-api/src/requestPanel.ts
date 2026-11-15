/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CookieJar, decodeCookieValue } from './cookies.js';
import { ApiResponse, sendRequest } from './http.js';
import { allowsBody, ApiRequest, buildUrl, missingVariables, normalizeRequest, resolveRequest } from './model.js';
import { PanelState, renderRequestPanel } from './webview.js';

export interface PanelServices {
	/** Variables from the setting, `.env` and the selected environment file, merged. */
	loadVariables(): Promise<Record<string, string>>;
	environment(): string;
	/** Saves the request and returns the relative path it was written to. */
	save(request: ApiRequest): Promise<string>;
	/** Lets the user pick an environment; resolves when the choice is applied. */
	selectEnvironment(): Promise<void>;
}

interface PanelMessage {
	type: string;
	request?: unknown;
}

/**
 * One reusable request editor panel. It owns the cookie jar so requests made in the same window
 * share a session, which is what a Laravel login flow expects.
 */
export class RequestPanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private current: ApiRequest | undefined;
	private sourceLabel = '';
	private readOnly = false;
	private readonly disposables: vscode.Disposable[] = [];
	private jar = new CookieJar();

	constructor(private readonly services: PanelServices) { }

	dispose(): void {
		this.panel?.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.jar.clear();
	}

	get cookies(): CookieJar {
		return this.jar;
	}

	async show(request: ApiRequest, sourceLabel: string, readOnly: boolean): Promise<void> {
		this.current = request;
		this.sourceLabel = sourceLabel;
		this.readOnly = readOnly;

		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel('redCode.api.request', request.name, vscode.ViewColumn.Active, {
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: []
			});
			this.panel.onDidDispose(() => {
				this.panel = undefined;
			}, undefined, this.disposables);
			this.panel.webview.onDidReceiveMessage(message => void this.onMessage(message as PanelMessage), undefined, this.disposables);
		} else {
			this.panel.reveal(vscode.ViewColumn.Active);
		}

		this.panel.title = request.name;
		this.panel.webview.html = renderRequestPanel(this.panel.webview, await this.state());
	}

	private async state(): Promise<PanelState> {
		const variables = await this.services.loadVariables();
		return {
			request: this.current ?? normalizeRequest({ url: '{{baseUrl}}/api/' }),
			sourceLabel: this.sourceLabel,
			environment: this.services.environment(),
			baseUrl: variables.baseUrl ?? variables.APP_URL,
			readOnly: this.readOnly
		};
	}

	private async post(payload: unknown): Promise<void> {
		await this.panel?.webview.postMessage(payload);
	}

	private async onMessage(message: PanelMessage): Promise<void> {
		try {
			switch (message.type) {
				case 'send':
					await this.send(message.request);
					return;
				case 'save':
					await this.save(message.request);
					return;
				case 'selectEnvironment':
					await this.services.selectEnvironment();
					await this.post({ type: 'state', state: await this.state() });
					return;
				case 'clearCookies':
					this.jar.clear();
					await this.post({ type: 'notice', message: 'Cookies cleared.' });
					return;
				case 'fetchCsrf': {
					const variables = await this.services.loadVariables();
					await this.fetchCsrfFor(this.current ? buildUrl(this.current, variables) : '');
					await this.post({ type: 'notice', message: 'CSRF cookie stored.' });
					return;
				}
				default:
					return;
			}
		} catch (error) {
			await this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	private async send(raw: unknown): Promise<void> {
		const request = normalizeRequest(raw);
		this.current = request;
		const variables = await this.services.loadVariables();
		const missing = missingVariables(request, variables);
		if (missing.length > 0) {
			throw new Error(`Unknown variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} to .env or redCode.api.variables.`);
		}

		const resolved = resolveRequest(request, variables);
		if (!allowsBody(resolved.method)) {
			resolved.body = undefined;
		}

		const configuration = vscode.workspace.getConfiguration('redCode.api');
		if (configuration.get<boolean>('laravelCsrf', true) && resolved.method !== 'GET' && resolved.method !== 'HEAD') {
			const hasHeader = Object.keys(resolved.headers).some(name => name.toLowerCase() === 'x-xsrf-token');
			if (!hasHeader) {
				if (!this.jar.get(resolved.url, 'XSRF-TOKEN')) {
					await this.fetchCsrfFor(resolved.url).catch(() => undefined);
				}
				const token = this.jar.get(resolved.url, 'XSRF-TOKEN');
				if (token) {
					resolved.headers['X-XSRF-TOKEN'] = decodeCookieValue(token);
				}
			}
		}

		const response = await sendRequest(resolved, {
			timeoutMs: configuration.get<number>('timeoutMs', 30000),
			verifyTls: configuration.get<boolean>('verifyTls', true),
			followRedirects: configuration.get<boolean>('followRedirects', true),
			cookieJar: this.jar
		});

		await this.post({ type: 'response', response: this.describe(response) });
	}

	private describe(response: ApiResponse): Record<string, unknown> {
		const contentType = response.headers['content-type'] ?? '';
		const textLike = /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded)|image\/svg)/i.test(contentType);
		const body = textLike || !response.body.includes(0)
			? response.body.toString('utf8')
			: `<${response.body.length} bytes of binary data>`;
		return {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
			body,
			sizeBytes: response.body.length,
			durationMs: response.durationMs,
			url: response.url,
			truncated: response.truncated,
			contentType
		};
	}

	private async save(raw: unknown): Promise<void> {
		if (this.readOnly) {
			throw new Error('A .http file is edited as text; use Save As HTTP or create a request in a collection.');
		}
		const request = normalizeRequest(raw);
		this.current = request;
		const file = await this.services.save(request);
		if (this.panel) {
			this.panel.title = request.name;
		}
		await this.post({ type: 'saved', file });
	}

	/** Fetches `/sanctum/csrf-cookie` for the origin of `url` and keeps the session cookie. */
	async fetchCsrf(url: string): Promise<void> {
		await this.fetchCsrfFor(url);
	}

	private async fetchCsrfFor(url: string): Promise<void> {
		let origin: string;
		try {
			origin = new URL(url).origin;
		} catch {
			throw new Error('Enter an absolute URL first so the CSRF cookie has a host to come from.');
		}
		const configuration = vscode.workspace.getConfiguration('redCode.api');
		await sendRequest({
			method: 'GET',
			url: `${origin}/sanctum/csrf-cookie`,
			headers: { Accept: 'application/json' }
		}, {
			timeoutMs: configuration.get<number>('timeoutMs', 30000),
			verifyTls: configuration.get<boolean>('verifyTls', true),
			followRedirects: configuration.get<boolean>('followRedirects', true),
			cookieJar: this.jar
		});
	}
}
