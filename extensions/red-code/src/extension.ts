/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { BookmarkItem, ProjectBookmarks } from './bookmarks.js';
import { DeploySetView, registerDeployCommands } from './deploy.js';
import { WorkspaceDoctor } from './doctor.js';

export function activate(context: vscode.ExtensionContext): void {
	const bookmarks = new ProjectBookmarks(context);
	const doctor = new WorkspaceDoctor();
	const deploy = new DeploySetView(context);
	context.subscriptions.push(bookmarks, doctor, deploy);
	registerDeployCommands(context, deploy);

	context.subscriptions.push(
		vscode.commands.registerCommand('redCode.bookmarks.add', async (resource?: vscode.Uri | { readonly resourceUri?: vscode.Uri }) => {
			try {
				const selected = await getResourceUris(resource);
				for (const uri of selected) {
					await bookmarks.add(uri);
				}
				if (selected.length > 0) {
					vscode.window.setStatusBarMessage(vscode.l10n.t('Added {0} item(s) to Project Bookmarks.', selected.length), 3000);
				}
			} catch (error) {
				await vscode.window.showErrorMessage(error instanceof Error ? error.message : vscode.l10n.t('Could not add the bookmark.'));
			}
		}),
		vscode.commands.registerCommand('redCode.bookmarks.addActiveFile', async () => {
			const uri = vscode.window.activeTextEditor?.document.uri;
			if (!uri) {
				await vscode.window.showInformationMessage(vscode.l10n.t('Open a file in the editor before bookmarking it.'));
				return;
			}
			try {
				await bookmarks.add(uri);
				bookmarks.refresh();
			} catch (error) {
				await vscode.window.showErrorMessage(error instanceof Error ? error.message : vscode.l10n.t('Could not add the bookmark.'));
			}
		}),
		vscode.commands.registerCommand('redCode.bookmarks.open', async (item?: BookmarkItem) => {
			if (item) {
				await bookmarks.open(item.bookmark);
			}
		}),
		vscode.commands.registerCommand('redCode.bookmarks.remove', async (item?: BookmarkItem) => {
			if (item) {
				await bookmarks.remove(item.bookmark.id);
			}
		}),
		vscode.commands.registerCommand('redCode.bookmarks.refresh', () => bookmarks.refresh()),
		vscode.commands.registerCommand('redCode.doctor.scanWorkspace', () => doctor.scanWorkspace()),
		vscode.commands.registerCommand('redCode.doctor.checkTools', async () => {
			const selection = await vscode.window.showWarningMessage(
				vscode.l10n.t('Red Code will run fixed --version checks for Git, Node.js, npm, PHP, and Composer. It will not run project scripts or read environment-file contents.'),
				{ modal: true },
				vscode.l10n.t('Run Checks')
			);
			if (selection) {
				await doctor.checkTools();
			}
		})
	);

	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
		bookmarks.refresh();
		void doctor.scanWorkspace();
	}));
	void doctor.scanWorkspace();
}

export function deactivate(): void {
	// VS Code disposes registered views and commands through ExtensionContext.subscriptions.
}

async function getResourceUris(resource?: vscode.Uri | { readonly resourceUri?: vscode.Uri }): Promise<vscode.Uri[]> {
	if (resource instanceof vscode.Uri) {
		return [resource];
	}
	if (resource?.resourceUri) {
		return [resource.resourceUri];
	}

	const selection = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectFolders: true,
		canSelectMany: true,
		openLabel: vscode.l10n.t('Add to Project Bookmarks'),
		title: vscode.l10n.t('Select workspace files or folders to bookmark')
	});
	return selection ?? [];
}
