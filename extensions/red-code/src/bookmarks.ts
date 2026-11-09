/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { BookmarkRecord, normalizeRelativePath, parseBookmarkState, resolveWorkspaceRoot, SerializedBookmarkState } from './bookmarkModel.js';

const STORAGE_KEY = 'redCode.projectBookmarks.v1';

export class ProjectBookmarks implements vscode.TreeDataProvider<BookmarkItem> {
	private readonly changeEmitter = new vscode.EventEmitter<BookmarkItem | undefined | null | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private readonly treeView: vscode.TreeView<BookmarkItem>;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.treeView = vscode.window.createTreeView('redCode.bookmarks', {
			treeDataProvider: this,
			showCollapseAll: false
		});
	}

	dispose(): void {
		this.treeView.dispose();
		this.changeEmitter.dispose();
	}

	async getChildren(): Promise<BookmarkItem[]> {
		const bookmarks = this.readBookmarks();
		return Promise.all(bookmarks.map(async bookmark => this.createTreeItem(bookmark)));
	}

	getTreeItem(element: BookmarkItem): vscode.TreeItem {
		return element;
	}

	async add(uri: vscode.Uri): Promise<void> {
		const root = vscode.workspace.getWorkspaceFolder(uri);
		if (!root) {
			throw new Error(vscode.l10n.t('Bookmarks must be inside an open workspace folder.'));
		}

		const relativePath = this.toRelativePath(root.uri, uri);
		if (relativePath === undefined) {
			throw new Error(vscode.l10n.t('This item cannot be bookmarked because it is outside the selected workspace folder.'));
		}

		const kind = await this.getKind(uri);
		const bookmarks = this.readBookmarks();
		const existing = bookmarks.find(bookmark => this.matches(bookmark, root, relativePath));
		if (existing) {
			return;
		}
		if (bookmarks.length >= 500) {
			throw new Error(vscode.l10n.t('The bookmark limit of {0} has been reached.', 500));
		}

		bookmarks.push({
			id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
			rootName: root.name,
			rootIndex: vscode.workspace.workspaceFolders?.indexOf(root) ?? 0,
			relativePath,
			label: this.getLabel(uri, relativePath),
			kind
		});
		await this.writeBookmarks(bookmarks);
	}

	async remove(id: string): Promise<void> {
		const bookmarks = this.readBookmarks();
		const updated = bookmarks.filter(bookmark => bookmark.id !== id);
		if (updated.length !== bookmarks.length) {
			await this.writeBookmarks(updated);
		}
	}

	async open(bookmark: BookmarkRecord): Promise<void> {
		const uri = this.resolveUri(bookmark);
		if (!uri) {
			await vscode.window.showWarningMessage(vscode.l10n.t('The workspace folder for this bookmark is no longer available. Remove the stale bookmark or reopen its workspace.'));
			return;
		}

		try {
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.type & vscode.FileType.Directory) {
				await vscode.commands.executeCommand('revealInExplorer', uri);
			} else {
				await vscode.commands.executeCommand('vscode.open', uri);
			}
		} catch {
			await vscode.window.showWarningMessage(vscode.l10n.t('The bookmarked item could not be found: {0}', bookmark.label));
		}
	}

	refresh(): void {
		this.changeEmitter.fire();
	}

	private readBookmarks(): BookmarkRecord[] {
		return parseBookmarkState(this.context.workspaceState.get<unknown>(STORAGE_KEY));
	}

	private async writeBookmarks(bookmarks: BookmarkRecord[]): Promise<void> {
		const state: SerializedBookmarkState = { version: 1, entries: bookmarks };
		await this.context.workspaceState.update(STORAGE_KEY, state);
		this.refresh();
	}

	private async createTreeItem(bookmark: BookmarkRecord): Promise<BookmarkItem> {
		const item = new BookmarkItem(bookmark);
		const uri = this.resolveUri(bookmark);
		if (!uri) {
			item.description = vscode.l10n.t('Workspace folder unavailable');
			item.iconPath = new vscode.ThemeIcon('warning');
			return item;
		}

		try {
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.type & vscode.FileType.Directory) {
				item.iconPath = new vscode.ThemeIcon('folder');
			} else {
				item.iconPath = vscode.ThemeIcon.File;
			}
			item.command = {
				command: 'redCode.bookmarks.open',
				title: vscode.l10n.t('Open Bookmark'),
				arguments: [bookmark]
			};
		} catch {
			item.description = vscode.l10n.t('Item not found');
			item.iconPath = new vscode.ThemeIcon('warning');
		}
		return item;
	}

	private resolveUri(bookmark: BookmarkRecord): vscode.Uri | undefined {
		const roots = vscode.workspace.workspaceFolders ?? [];
		const root = resolveWorkspaceRoot(roots, bookmark);
		if (!root) {
			return undefined;
		}
		const relativePath = normalizeRelativePath(bookmark.relativePath);
		if (relativePath === undefined) {
			return undefined;
		}
		return relativePath.length === 0 ? root.uri : vscode.Uri.joinPath(root.uri, ...relativePath.split('/'));
	}

	private toRelativePath(root: vscode.Uri, target: vscode.Uri): string | undefined {
		if (root.scheme !== target.scheme || root.authority !== target.authority) {
			return undefined;
		}
		const normalizedRootPath = root.path.endsWith('/') ? root.path : `${root.path}/`;
		if (target.path === root.path) {
			return '';
		}
		if (!target.path.startsWith(normalizedRootPath)) {
			return undefined;
		}
		return normalizeRelativePath(target.path.slice(normalizedRootPath.length));
	}

	private async getKind(uri: vscode.Uri): Promise<'file' | 'folder'> {
		const stat = await vscode.workspace.fs.stat(uri);
		return stat.type & vscode.FileType.Directory ? 'folder' : 'file';
	}

	private getLabel(uri: vscode.Uri, relativePath: string): string {
		const name = relativePath.split('/').filter(Boolean).at(-1);
		return name || uri.path.split('/').filter(Boolean).at(-1) || uri.toString();
	}

	private matches(bookmark: BookmarkRecord, root: vscode.WorkspaceFolder, relativePath: string): boolean {
		return bookmark.rootName === root.name
			&& bookmark.rootIndex === (vscode.workspace.workspaceFolders?.indexOf(root) ?? 0)
			&& bookmark.relativePath === relativePath;
	}
}

export class BookmarkItem extends vscode.TreeItem {
	override readonly contextValue = 'redCodeBookmark';

	constructor(readonly bookmark: BookmarkRecord) {
		super(bookmark.label, vscode.TreeItemCollapsibleState.None);
		this.id = bookmark.id;
		this.tooltip = bookmark.relativePath || bookmark.rootName;
	}
}
