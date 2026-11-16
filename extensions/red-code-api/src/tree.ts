/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ApiRequest, Collection, SavedEndpoint, parseHttpFile } from './model.js';
import { collectionFileName, collectionsDirectory, readCollectionFile } from './storage.js';

export interface CollectionNode {
	readonly kind: 'collection';
	readonly file: string;
	readonly name: string;
}

export interface RequestNode {
	readonly kind: 'request';
	readonly file: string;
	readonly request: ApiRequest;
}

export interface HttpFileNode {
	readonly kind: 'httpFile';
	readonly file: string;
	readonly relativePath: string;
}

export interface HttpRequestNode {
	readonly kind: 'httpRequest';
	readonly file: string;
	readonly relativePath: string;
	readonly request: ApiRequest;
}

export type ApiNode = CollectionNode | RequestNode | HttpFileNode | HttpRequestNode;

interface TreeData {
	readonly collections: CollectionNode[];
	readonly httpFiles: HttpFileNode[];
}

/**
 * Sidebar tree: one node per collection file, one per request, plus `.http` files found in the
 * workspace. Files are the source of truth, so an edit on disk is visible after Refresh.
 */
export class CollectionsTreeProvider implements vscode.TreeDataProvider<ApiNode> {
	private readonly changed = new vscode.EventEmitter<ApiNode | undefined>();
	private readonly collections = new Map<string, Collection>();
	private data: TreeData = { collections: [], httpFiles: [] };

	readonly onDidChangeTreeData = this.changed.event;

	dispose(): void {
		this.changed.dispose();
		this.collections.clear();
	}

	refresh(): void {
		this.collections.clear();
		this.load().then(() => this.changed.fire(undefined), () => this.changed.fire(undefined));
	}

	/** Loads the tree data once so `findCollection` can answer before the view is opened. */
	async load(): Promise<TreeData> {
		const collections: CollectionNode[] = [];
		const httpFiles: HttpFileNode[] = [];
		const seen = new Set<string>();

		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const directory = collectionsDirectory(folder.uri.fsPath);
			let entries: string[] = [];
			try {
				entries = await readdir(directory);
			} catch {
				entries = [];
			}
			for (const entry of entries.filter(name => name.toLowerCase().endsWith('.json')).sort((a, b) => a.localeCompare(b))) {
				const file = path.join(directory, entry);
				if (seen.has(file)) {
					continue;
				}
				seen.add(file);
				collections.push({ kind: 'collection', file, name: path.basename(entry, '.json') });
			}

			const matches = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.http'), '**/{node_modules,vendor,.git,.build}/**');
			for (const uri of matches) {
				httpFiles.push({
					kind: 'httpFile',
					file: uri.fsPath,
					relativePath: path.relative(folder.uri.fsPath, uri.fsPath)
				});
			}
		}

		this.data = { collections, httpFiles: httpFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath)) };
		return this.data;
	}

	collection(name: string): CollectionNode | undefined {
		const wanted = collectionFileName(name);
		return this.data.collections.find(node => path.basename(node.file) === wanted);
	}

	async requests(file: string): Promise<ApiRequest[]> {
		const cached = this.collections.get(file);
		if (cached) {
			return cached.requests;
		}
		const collection = await readCollectionFile(file);
		this.collections.set(file, collection);
		return collection.requests;
	}

	async savedEndpoints(): Promise<SavedEndpoint[]> {
		const data = await this.load();
		const endpoints: SavedEndpoint[] = [];
		for (const node of data.collections) {
			try {
				const requests = await this.requests(node.file);
				requests.forEach((request, index) => endpoints.push({
					id: `${node.file}#${index}`,
					collection: node.name,
					request
				}));
			} catch {
				// A malformed collection should not hide endpoints from other collections.
			}
		}
		return endpoints;
	}

	getTreeItem(node: ApiNode): vscode.TreeItem {
		switch (node.kind) {
			case 'collection': {
				const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
				item.id = `collection:${node.file}`;
				item.contextValue = 'redCode.api.collection';
				item.iconPath = new vscode.ThemeIcon('folder-library');
				item.resourceUri = vscode.Uri.file(node.file);
				return item;
			}
			case 'request': {
				const item = new vscode.TreeItem(node.request.name, vscode.TreeItemCollapsibleState.None);
				item.id = `request:${node.file}:${node.request.name}`;
				item.contextValue = 'redCode.api.request';
				item.description = node.request.method;
				item.tooltip = `${node.request.method} ${node.request.url}`;
				item.command = { command: 'redCode.api.openRequest', title: 'Open Request', arguments: [node] };
				return item;
			}
			case 'httpFile': {
				const item = new vscode.TreeItem(path.basename(node.relativePath), vscode.TreeItemCollapsibleState.Collapsed);
				item.id = `http:${node.file}`;
				item.contextValue = 'redCode.api.httpFile';
				item.description = path.dirname(node.relativePath) === '.' ? undefined : path.dirname(node.relativePath);
				item.tooltip = node.relativePath;
				item.iconPath = new vscode.ThemeIcon('file-code');
				return item;
			}
			case 'httpRequest': {
				const item = new vscode.TreeItem(node.request.name, vscode.TreeItemCollapsibleState.None);
				item.id = `httpRequest:${node.file}:${node.request.name}`;
				item.contextValue = 'redCode.api.request';
				item.description = node.request.method;
				item.tooltip = `${node.request.method} ${node.request.url}\n${node.relativePath}`;
				item.command = { command: 'redCode.api.openRequest', title: 'Open Request', arguments: [node] };
				return item;
			}
		}
	}

	async getChildren(node?: ApiNode): Promise<ApiNode[]> {
		if (!node) {
			if (this.data.collections.length === 0 && this.data.httpFiles.length === 0) {
				await this.load();
			}
			return [...this.data.collections, ...this.data.httpFiles];
		}

		if (node.kind === 'collection') {
			const requests = await this.requests(node.file);
			return requests.map(request => ({ kind: 'request', file: node.file, request }));
		}
		if (node.kind === 'httpFile') {
			try {
				const text = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(node.file))).toString('utf8');
				return parseHttpFile(text, node.relativePath).map(request => ({
					kind: 'httpRequest',
					file: node.file,
					relativePath: node.relativePath,
					request
				}));
			} catch {
				return [];
			}
		}
		return [];
	}
}
