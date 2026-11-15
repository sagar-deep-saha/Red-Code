/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import * as vscode from 'vscode';
import { ApiRequest, normalizeRequest } from './model.js';
import { PanelServices, RequestPanel } from './requestPanel.js';
import { requestFromRoute, runPhpListRoutes } from './routes.js';
import { addRequest } from './storage.js';
import { ApiNode, CollectionsTreeProvider } from './tree.js';
import { listEnvironments, loadVariables } from './variables.js';

const LAST_COLLECTION_KEY = 'redCode.api.lastCollection';

export function activate(context: vscode.ExtensionContext): void {
	const tree = new CollectionsTreeProvider();
	const treeView = vscode.window.createTreeView('redCode.api.collections', { treeDataProvider: tree, showCollapseAll: true });

	function workspaceRoot(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	function environment(): string {
		return vscode.workspace.getConfiguration('redCode.api').get<string>('environment', '');
	}

	async function variables(): Promise<Record<string, string>> {
		const configured = vscode.workspace.getConfiguration('redCode.api').get<Record<string, string>>('variables', {});
		return loadVariables({
			workspaceRoot: workspaceRoot(),
			environment: environment(),
			userVariables: configured ?? {}
		});
	}

	async function selectEnvironment(): Promise<void> {
		const names = await listEnvironments(workspaceRoot());
		const items: (vscode.QuickPickItem & { value: string })[] = [
			{ label: '$(circle-slash) None', description: 'Use only the setting and .env', value: '' },
			...names.map(name => ({ label: name, description: '.redcode/api/environments', value: name }))
		];
		const choice = await vscode.window.showQuickPick(items, {
			placeHolder: 'Variables to apply on top of .env'
		});
		if (!choice) {
			return;
		}
		const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
		await vscode.workspace.getConfiguration('redCode.api').update('environment', choice.value, target);
	}

	async function save(request: ApiRequest): Promise<string> {
		const root = workspaceRoot();
		if (!root) {
			throw new Error('Open a folder first; requests are saved inside the workspace.');
		}
		const last = context.workspaceState.get<string>(LAST_COLLECTION_KEY) ?? 'Requests';
		const name = await vscode.window.showInputBox({
			title: 'Save Request',
			prompt: 'Collection name. The request is written to .redcode/api/collections/<name>.json',
			value: last,
			validateInput: value => value.trim().length === 0 ? 'Enter a collection name.' : undefined
		});
		if (!name) {
			throw new Error('Save cancelled.');
		}
		await context.workspaceState.update(LAST_COLLECTION_KEY, name.trim());
		const file = await addRequest(root, name.trim(), request);
		tree.refresh();
		return path.relative(root, file).split(path.sep).join('/');
	}

	const services: PanelServices = {
		loadVariables: variables,
		environment,
		save,
		selectEnvironment
	};

	const panel = new RequestPanel(services);
	context.subscriptions.push(panel, treeView, tree);

	function open(node: ApiNode): void {
		if (node.kind === 'request' || node.kind === 'httpRequest') {
			const label = node.kind === 'httpRequest'
				? `${node.relativePath}`
				: path.basename(node.file);
			void panel.show(node.request, label, node.kind === 'httpRequest');
			return;
		}
		if (node.kind === 'collection') {
			void tree.requests(node.file).then(requests => {
				if (requests.length > 0) {
					void panel.show(requests[0], path.basename(node.file), false);
				} else {
					void vscode.window.showInformationMessage(`${node.name} has no requests yet.`);
				}
			});
		}
	}

	function phpPath(): string {
		const configured = vscode.workspace.getConfiguration('redCode.laravel').get<string>('phpPath', '');
		return configured.trim() || 'php';
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('redCode.api.refresh', () => tree.refresh()),
		vscode.commands.registerCommand('redCode.api.openRequest', (node?: ApiNode) => {
			if (node) {
				open(node);
			}
		}),
		vscode.commands.registerCommand('redCode.api.newRequest', () => {
			void panel.show(normalizeRequest({ name: 'New Request', url: '{{baseUrl}}/api/' }), 'Unsaved request', false);
		}),
		vscode.commands.registerCommand('redCode.api.selectEnvironment', () => selectEnvironment()),
		vscode.commands.registerCommand('redCode.api.clearCookies', () => {
			panel.cookies.clear();
			void vscode.window.showInformationMessage('Red Code API: cookies cleared.');
		}),
		vscode.commands.registerCommand('redCode.api.fetchCsrfCookie', async () => {
			try {
				const values = await variables();
				const base = values.baseUrl ?? values.APP_URL;
				if (!base) {
					void vscode.window.showWarningMessage('Red Code API: add APP_URL to .env, or set redCode.api.variables.baseUrl.');
					return;
				}
				await panel.fetchCsrf(`${base.replace(/\/+$/, '')}/`);
				void vscode.window.showInformationMessage('Red Code API: CSRF cookie stored.');
			} catch (error) {
				report(error);
			}
		}),
		vscode.commands.registerCommand('redCode.api.newRequestFromRoute', async () => {
			const roots = (vscode.workspace.workspaceFolders ?? [])
				.map(folder => folder.uri.fsPath)
				.filter(folder => folder);
			if (roots.length === 0) {
				void vscode.window.showInformationMessage('Red Code API: open a Laravel project first.');
				return;
			}

			try {
				const routes = await runPhpListRoutes(roots[0], phpPath());
				if (routes.length === 0) {
					void vscode.window.showInformationMessage('Red Code API: no routes found.');
					return;
				}
				const choice = await vscode.window.showQuickPick(
					routes.map(route => ({
						label: `${route.method.split('|')[0]} /${route.uri}`,
						description: route.name,
						detail: route.action,
						route
					})),
					{ placeHolder: 'Laravel route to prefill', matchOnDescription: true, matchOnDetail: true }
				);
				if (choice) {
					await panel.show(requestFromRoute(choice.route), 'Laravel route', false);
				}
			} catch (error) {
				report(error);
			}
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('redCode.api.environment') || event.affectsConfiguration('redCode.api.variables')) {
				tree.refresh();
			}
		}),
		vscode.workspace.onDidCreateFiles(() => tree.refresh()),
		vscode.workspace.onDidDeleteFiles(() => tree.refresh()),
		vscode.workspace.onDidSaveTextDocument(document => {
			if (document.uri.fsPath.includes(`${path.sep}.redcode${path.sep}api${path.sep}`)) {
				tree.refresh();
			}
		})
	);

	// The tree starts empty; the first `getChildren` discovers collections on disk.
	tree.refresh();
}

function report(error: unknown): void {
	void vscode.window.showErrorMessage(`Red Code API: ${error instanceof Error ? error.message : String(error)}`);
}

export function deactivate(): void {
	// Registrations are disposed with the extension context.
}
