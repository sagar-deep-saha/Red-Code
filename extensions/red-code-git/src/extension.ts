/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { BlameDecorations } from './blameDecorations.js';
import { GitContentProvider } from './contentProvider.js';
import { GitError, logCommits, repositoryRoot, statusSummary } from './git.js';
import { GraphPanel } from './graphView.js';

const STATUS_INTERVAL_MS = 20000;

export function activate(context: vscode.ExtensionContext): void {
	let root: string | undefined;
	let statusItem: vscode.StatusBarItem | undefined;
	let timer: NodeJS.Timeout | undefined;

	const provider = new GitContentProvider();
	const blame = new BlameDecorations();
	const panel = new GraphPanel({
		root: () => root,
		pageSize: () => vscode.workspace.getConfiguration('redCode.git').get<number>('graphPageSize', 300),
		avatarLookupEnabled: () => vscode.workspace.getConfiguration('redCode.git').get<boolean>('graphAvatars.enabled', false)
	});

	async function workspaceRoots(): Promise<string[]> {
		const roots: string[] = [];
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const resolved = await repositoryRoot(folder.uri.fsPath);
			if (resolved && !roots.includes(resolved)) {
				roots.push(resolved);
			}
		}
		return roots;
	}

	async function resolveRoot(pick: boolean): Promise<string | undefined> {
		const roots = await workspaceRoots();
		if (roots.length === 0) {
			root = undefined;
			return undefined;
		}
		if (roots.length === 1 || !pick) {
			root = roots[0];
			return root;
		}
		const choice = await vscode.window.showQuickPick(
			roots.map(value => ({ label: vscode.workspace.asRelativePath(value), value })),
			{ placeHolder: 'Select the repository to show' }
		);
		if (!choice) {
			return root;
		}
		root = choice.value;
		return root;
	}

	async function updateStatus(): Promise<void> {
		const resolved = root ?? await resolveRoot(false);
		if (!resolved) {
			statusItem?.hide();
			return;
		}
		try {
			const status = await statusSummary(resolved);
			if (!statusItem) {
				statusItem = vscode.window.createStatusBarItem('redCode.git.status', vscode.StatusBarAlignment.Right, 90);
				statusItem.name = 'Red Code Git';
				statusItem.command = 'redCode.git.showGraph';
				context.subscriptions.push(statusItem);
			}
			statusItem.text = `$(git-branch) ${status.branch}${status.dirtyFiles > 0 ? ` $(circle-filled) ${status.dirtyFiles}` : ''}`;
			statusItem.tooltip = `${status.branch} in ${resolved}${status.dirtyFiles > 0 ? `\n${status.dirtyFiles} changed file(s)` : '\nWorking tree clean'}\nClick to open the git graph.`;
			statusItem.show();
		} catch {
			statusItem?.hide();
		}
	}

	function scheduleStatus(): void {
		if (timer) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = undefined;
			if (vscode.window.state.focused) {
				void updateStatus();
			}
			scheduleStatus();
		}, STATUS_INTERVAL_MS);
	}

	context.subscriptions.push(
		provider,
		blame,
		panel,
		vscode.workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, provider),
		vscode.commands.registerCommand('redCode.git.showGraph', async () => {
			const resolved = await resolveRoot(true);
			if (!resolved) {
				void vscode.window.showInformationMessage('Red Code Git: open a folder inside a git repository first.');
				return;
			}
			await panel.open();
		}),
		vscode.commands.registerCommand('redCode.git.refresh', async () => {
			provider.clear();
			await panel.refresh();
			await updateStatus();
		}),
		vscode.commands.registerCommand('redCode.git.toggleBlame', async () => {
			const configuration = vscode.workspace.getConfiguration('redCode.git');
			const next = !configuration.get<boolean>('blame.enabled', false);
			await configuration.update('blame.enabled', next, vscode.ConfigurationTarget.Global);
			void vscode.window.setStatusBarMessage(next ? 'Inline blame enabled' : 'Inline blame disabled', 3000);
		}),
		vscode.commands.registerCommand('redCode.git.copySha', async () => {
			const resolved = root ?? await resolveRoot(false);
			if (!resolved) {
				return;
			}
			try {
				const commits = await logCommits(resolved, { limit: 50 });
				const choice = await vscode.window.showQuickPick(
					commits.map(commit => ({
						label: commit.short,
						description: commit.subject,
						detail: `${commit.author} · ${commit.date}`,
						sha: commit.sha
					})),
					{ placeHolder: 'Copy the SHA of a commit' }
				);
				if (choice) {
					await vscode.env.clipboard.writeText(choice.sha);
					void vscode.window.setStatusBarMessage(`Copied ${choice.label}`, 3000);
				}
			} catch (error) {
				report(error);
			}
		}),
		vscode.workspace.onDidSaveTextDocument(() => void updateStatus()),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			root = undefined;
			void updateStatus();
		})
	);

	blame.setEnabled(vscode.workspace.getConfiguration('redCode.git').get<boolean>('blame.enabled', false));
	void updateStatus();
	scheduleStatus();
	context.subscriptions.push({ dispose: () => { if (timer) { clearTimeout(timer); } } });
}

function report(error: unknown): void {
	const message = error instanceof GitError || error instanceof Error ? error.message : String(error);
	void vscode.window.showErrorMessage(`Red Code Git: ${message}`);
}

export function deactivate(): void {
	// Nothing to do; everything is registered in the extension context.
}
