/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import * as vscode from 'vscode';
import { ApiRequest, normalizeRequest } from './model.js';
import { PanelServices, RequestPanel } from './requestPanel.js';
import { requestFromRoute, runPhpListRoutes } from './routes.js';
import {
	addRequest,
	createCollection,
	deleteCollectionFile,
	deleteRequest,
	listCollections,
	readBaseUrlProfiles,
	renameRequest,
	saveBaseUrlProfile
} from './storage.js';
import { ApiNode, CollectionsTreeProvider } from './tree.js';
import { listEnvironments, loadVariables, createEnvironment } from './variables.js';

const LAST_COLLECTION_KEY = 'redCode.api.lastCollection';

export function activate(context: vscode.ExtensionContext): void {
	const tree = new CollectionsTreeProvider();
	const treeView = vscode.window.createTreeView('redCode.api.collections', { treeDataProvider: tree, showCollapseAll: true });
	let panelRef: RequestPanel | undefined;

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

	/**
	 * Writes a request into `collectionName` when the tab is bound to a collection, otherwise asks
	 * which collection to use: an existing file, or a new one.
	 */
	async function save(request: ApiRequest, collectionName?: string): Promise<string | undefined> {
		const root = workspaceRoot();
		if (!root) {
			throw new Error('Open a folder first; requests are saved inside the workspace.');
		}

		let name = collectionName?.trim();
		if (!name) {
			const collections = await listCollections(root);
			const last = context.workspaceState.get<string>(LAST_COLLECTION_KEY) ?? '';
			const items: (vscode.QuickPickItem & { value: string })[] = [
				...collections.map(collection => ({
					label: collection.name,
					description: collection.name === last ? 'Last used' : '.redcode/api/collections',
					value: collection.name
				})),
				{ label: '$(add) New collection…', description: 'Create a collection file', value: '' }
			];
			const choice = await vscode.window.showQuickPick(items, {
				placeHolder: `Save "${request.name}" in a collection`
			});
			if (!choice) {
				return undefined;
			}
			name = choice.value;
			if (!name) {
				name = await vscode.window.showInputBox({
					title: 'Save Request',
					prompt: 'Collection name. The request is written to .redcode/api/collections/<name>.json',
					value: last || 'Requests',
					validateInput: value => value.trim().length === 0 ? 'Enter a collection name.' : undefined
				});
				if (!name) {
					return undefined;
				}
			}
		}

		name = name.trim();
		await context.workspaceState.update(LAST_COLLECTION_KEY, name);
		const file = await addRequest(root, name, request);
		tree.refresh();
		return path.relative(root, file).split(path.sep).join('/');
	}

	const services: PanelServices = {
		loadVariables: variables,
		environment,
		save,
		selectEnvironment,
		loadBaseUrlProfiles: () => readBaseUrlProfiles(workspaceRoot()),
		saveBaseUrlProfile: (name, url) => saveBaseUrlProfile(workspaceRoot(), name, url),
		loadSavedEndpoints: () => tree.savedEndpoints(),
		currentCollection: () => panelRef?.activeCollection
	};

	const panel = new RequestPanel(services);
	panelRef = panel;
	context.subscriptions.push(panel, treeView, tree);

	function collectionNameOf(file: string): string {
		return path.basename(file, '.json');
	}

	function open(node: ApiNode): void {
		if (node.kind === 'request') {
			const collection = collectionNameOf(node.file);
			void panel.show(node.request, `${collection} / ${node.request.name}`, false, undefined, '', collection);
			return;
		}
		if (node.kind === 'httpRequest') {
			void panel.show(node.request, node.relativePath, true);
			return;
		}
		if (node.kind === 'collection') {
			void tree.requests(node.file).then(requests => {
				if (requests.length > 0) {
					open({ kind: 'request', file: node.file, request: requests[0] });
				} else {
					void newRequest(node);
				}
			}, error => report(error));
		}
	}

	async function newCollection(): Promise<void> {
		const root = workspaceRoot();
		if (!root) {
			void vscode.window.showInformationMessage('Red Code API: open a folder before creating a collection.');
			return;
		}
		const name = await vscode.window.showInputBox({
			title: 'New API Collection',
			prompt: 'Collection name. It is saved in .redcode/api/collections.',
			validateInput: value => value.trim().length === 0 ? 'Enter a collection name.' : undefined
		});
		if (!name) {
			return;
		}
		try {
			await createCollection(root, name);
			tree.refresh();
		} catch (error) {
			report(error);
		}
	}

	async function newEnvironment(): Promise<void> {
		const root = workspaceRoot();
		if (!root) {
			void vscode.window.showInformationMessage('Red Code API: open a folder before creating an environment.');
			return;
		}
		const name = await vscode.window.showInputBox({
			title: 'New API Environment',
			prompt: 'Environment name. It is saved as .redcode/api/environments/<name>.json and selected.',
			validateInput: value => value.trim().length === 0 ? 'Enter an environment name.' : undefined
		});
		if (!name) {
			return;
		}
		try {
			const file = await createEnvironment(root, name);
			const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
			await vscode.workspace.getConfiguration('redCode.api').update('environment', path.basename(file, '.json'), target);
			tree.refresh();
			await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)));
		} catch (error) {
			report(error);
		}
	}

	function newRequest(node?: ApiNode): void {
		const collection = node?.kind === 'collection' ? collectionNameOf(node.file) : undefined;
		void panel.show(
			normalizeRequest({ name: 'New Request', url: '{{baseUrl}}/api/' }),
			collection ? `${collection} / New Request` : 'Unsaved request',
			false,
			undefined,
			'',
			collection
		);
	}

	async function duplicateRequest(node?: ApiNode): Promise<void> {
		if (node && (node.kind === 'request' || node.kind === 'httpRequest')) {
			const copy = { ...node.request, name: `${node.request.name} copy` };
			const collection = node.kind === 'request' ? collectionNameOf(node.file) : undefined;
			await panel.show(copy, `Copy of ${node.request.name}`, false, undefined, '', collection);
			return;
		}
		await panel.duplicateActive();
	}

	async function rename(node: ApiNode | undefined): Promise<void> {
		if (node?.kind !== 'request') {
			void vscode.window.showInformationMessage('Red Code API: select a saved request in Collections to rename it. Requests in .http files are edited on disk.');
			return;
		}
		const name = await vscode.window.showInputBox({
			title: 'Rename Request',
			prompt: 'The new name replaces the old one in the collection file.',
			value: node.request.name,
			validateInput: value => value.trim().length === 0 ? 'Enter a request name.' : undefined
		});
		if (!name || name.trim() === node.request.name) {
			return;
		}
		try {
			await renameRequest(node.file, node.request.name, name.trim());
			tree.refresh();
		} catch (error) {
			report(error);
		}
	}

	async function removeRequest(node: ApiNode | undefined): Promise<void> {
		if (node?.kind !== 'request') {
			void vscode.window.showInformationMessage('Red Code API: select a saved request in Collections to delete it. Requests in .http files are edited on disk.');
			return;
		}
		const answer = await vscode.window.showWarningMessage(
			`Delete "${node.request.name}" from ${collectionNameOf(node.file)}?`,
			{ modal: true },
			'Delete'
		);
		if (answer !== 'Delete') {
			return;
		}
		try {
			if (await deleteRequest(node.file, node.request.name)) {
				tree.refresh();
			} else {
				void vscode.window.showInformationMessage('Red Code API: that request was already removed. Refresh the view.');
			}
		} catch (error) {
			report(error);
		}
	}

	async function removeCollection(node: ApiNode | undefined): Promise<void> {
		if (node?.kind !== 'collection') {
			void vscode.window.showInformationMessage('Red Code API: select a collection to delete it.');
			return;
		}
		const answer = await vscode.window.showWarningMessage(
			`Delete the collection "${node.name}" and every request in it?`,
			{ modal: true, detail: path.relative(workspaceRoot() ?? '', node.file) },
			'Delete'
		);
		if (answer !== 'Delete') {
			return;
		}
		try {
			await deleteCollectionFile(node.file);
			tree.refresh();
		} catch (error) {
			report(error);
		}
	}

	function reveal(node: ApiNode | undefined): void {
		if (!node) {
			return;
		}
		void vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(node.file));
	}

	function phpPath(): string {
		const configured = vscode.workspace.getConfiguration('redCode.laravel').get<string>('phpPath', '');
		return configured.trim() || 'php';
	}

	context.subscriptions.push(
		vscode.window.registerWebviewPanelSerializer('redCode.api.request', {
			async deserializeWebviewPanel(webviewPanel, state) {
				await panel?.restore(webviewPanel, state);
			}
		}),
		vscode.commands.registerCommand('redCode.api.openRequest', (node?: ApiNode) => {
			if (node) {
				open(node);
			}
		}),
		vscode.commands.registerCommand('redCode.api.openSavedEndpoint', async (id?: unknown) => {
			if (typeof id !== 'string' || !id) {
				return;
			}
			try {
				await panel?.openEndpoint(id);
			} catch (error) {
				report(error);
			}
		}),
		vscode.commands.registerCommand('redCode.api.refresh', () => tree.refresh()),
		vscode.commands.registerCommand('redCode.api.newCollection', () => newCollection()),
		vscode.commands.registerCommand('redCode.api.newEnvironment', () => newEnvironment()),
		vscode.commands.registerCommand('redCode.api.newRequest', (node?: ApiNode) => newRequest(node)),
		vscode.commands.registerCommand('redCode.api.duplicateRequest', (node?: ApiNode) => duplicateRequest(node)),
		vscode.commands.registerCommand('redCode.api.renameRequest', (node?: ApiNode) => rename(node)),
		vscode.commands.registerCommand('redCode.api.deleteRequest', (node?: ApiNode) => removeRequest(node)),
		vscode.commands.registerCommand('redCode.api.deleteCollection', (node?: ApiNode) => removeCollection(node)),
		vscode.commands.registerCommand('redCode.api.revealInExplorer', (node?: ApiNode) => reveal(node)),
		vscode.commands.registerCommand('redCode.api.selectEnvironment', () => selectEnvironment()),
		vscode.commands.registerCommand('redCode.api.clearCookies', () => {
			panel?.cookies.clear();
			void vscode.window.showInformationMessage('Red Code API: cookies cleared.');
		}),
		vscode.commands.registerCommand('redCode.api.fetchCsrfCookie', async () => {
			try {
				const base = await panel?.activeBaseUrl();
				if (!base) {
					void vscode.window.showWarningMessage('Red Code API: set a base URL in the active request tab or add APP_URL to .env.');
					return;
				}
				await panel?.fetchCsrf(`${base.replace(/\/+$/, '')}/`);
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
					await panel?.show(requestFromRoute(choice.route), 'Laravel route', false);
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
