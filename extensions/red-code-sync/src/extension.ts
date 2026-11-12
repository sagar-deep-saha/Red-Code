/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createGist, gistWebUrl, getAuthenticatedUser, getGist, Gist, GistError, listGists, updateGist } from './gist.js';
import {
	buildGistFiles, buildManifest, describeSnapshot, extensionDiff, EXTENSIONS_FILE, filterSettings,
	KEYBINDINGS_FILE, MANIFEST_FILE, matchesExclusion, parseGistFiles, SNIPPETS_FILE,
	shouldPull, SyncSnapshot
} from './payload.js';
import { parseJsonc } from './jsonc.js';
import { readSettings, readSnippets, readTextIfExists, userDirectory, writeSnippets, writeWithBackup } from './userFiles.js';

const GIST_ID_KEY = 'redCode.sync.gistId';
const REVISION_KEY = 'redCode.sync.revision';
const LAST_SYNC_KEY = 'redCode.sync.lastSyncAt';
const LOGIN_KEY = 'redCode.sync.login';
const PAT_SECRET = 'redCode.sync.token';
const AUTO_PUSH_DELAY_MS = 10_000;

let context: vscode.ExtensionContext;
let statusItem: vscode.StatusBarItem | undefined;
let autoPushTimer: NodeJS.Timeout | undefined;
let busy = false;

export function activate(extensionContext: vscode.ExtensionContext): void {
	context = extensionContext;

	statusItem = vscode.window.createStatusBarItem('redCode.sync', vscode.StatusBarAlignment.Right, 99);
	statusItem.name = 'Red Code Sync';
	statusItem.command = 'redCode.sync.syncNow';
	updateStatus();
	statusItem.show();

	context.subscriptions.push(
		statusItem,
		vscode.commands.registerCommand('redCode.sync.signIn', () => signIn()),
		vscode.commands.registerCommand('redCode.sync.signInWithToken', () => signInWithToken()),
		vscode.commands.registerCommand('redCode.sync.signOut', () => signOut()),
		vscode.commands.registerCommand('redCode.sync.syncNow', () => syncNow()),
		vscode.commands.registerCommand('redCode.sync.push', () => push(true)),
		vscode.commands.registerCommand('redCode.sync.pull', () => pull()),
		vscode.commands.registerCommand('redCode.sync.showStatus', () => showStatus()),
		vscode.commands.registerCommand('redCode.sync.viewRemote', () => viewRemote()),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (!event.affectsConfiguration('redCode.sync')) {
				scheduleAutoPush();
			}
		})
	);
}

export function deactivate(): void {
	if (autoPushTimer) {
		clearTimeout(autoPushTimer);
		autoPushTimer = undefined;
	}
}

function userDir(): string {
	return userDirectory(context.globalStorageUri.fsPath);
}

function updateStatus(): void {
	if (!statusItem) {
		return;
	}
	const login = context.globalState.get<string>(LOGIN_KEY);
	const revision = context.globalState.get<number>(REVISION_KEY, 0);
	const lastSync = context.globalState.get<number>(LAST_SYNC_KEY, 0);

	if (!login) {
		statusItem.text = '$(account) Sign in to Sync';
		statusItem.tooltip = 'Sign in with GitHub to sync Red Code settings, keybindings, snippets and extensions.';
		return;
	}

	statusItem.text = '$(cloud) Red Code Sync';
	statusItem.tooltip = [
		`Signed in as ${login}`,
		`Last upload revision ${revision}`,
		lastSync ? `Last sync ${new Date(lastSync).toLocaleString()}` : 'Never synced',
		'Click to sync now'
	].join('\n');
}

async function getToken(createIfNone: boolean): Promise<string | undefined> {
	const stored = await context.secrets.get(PAT_SECRET);
	if (stored) {
		return stored;
	}

	try {
		const session = await vscode.authentication.getSession('github', ['gist'], { createIfNone });
		return session?.accessToken;
	} catch (error) {
		if (createIfNone) {
			const message = error instanceof Error ? error.message : String(error);
			const action = await vscode.window.showErrorMessage(`GitHub sign-in failed: ${message}`, 'Use a token instead');
			if (action) {
				await signInWithToken();
			}
		}
		return undefined;
	}
}

async function rememberLogin(token: string): Promise<void> {
	try {
		const user = await getAuthenticatedUser(token);
		await context.globalState.update(LOGIN_KEY, user.login);
	} catch {
		// A token that cannot read /user is still usable for gists; the status
		// line simply stays generic.
	}
	updateStatus();
}

async function signIn(): Promise<void> {
	const token = await getToken(true);
	if (!token) {
		return;
	}
	await rememberLogin(token);
	const login = context.globalState.get<string>(LOGIN_KEY);
	void vscode.window.showInformationMessage(`Red Code Sync is connected${login ? ` as ${login}` : ''}. Use Sync Now to upload or restore.`);
}

async function signInWithToken(): Promise<void> {
	const token = await vscode.window.showInputBox({
		title: 'GitHub token for Red Code Sync',
		prompt: 'Paste a personal access token with the gist scope. It is stored in the OS credential store, never in a file.',
		password: true,
		ignoreFocusOut: true,
		validateInput: value => value.trim().length === 0 ? 'A token is required.' : undefined
	});
	if (!token) {
		return;
	}

	try {
		const user = await getAuthenticatedUser(token.trim());
		await context.secrets.store(PAT_SECRET, token.trim());
		await context.globalState.update(LOGIN_KEY, user.login);
		updateStatus();
		void vscode.window.showInformationMessage(`Red Code Sync is connected as ${user.login}.`);
	} catch (error) {
		void vscode.window.showErrorMessage(`That token was rejected: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function signOut(): Promise<void> {
	await context.secrets.delete(PAT_SECRET);
	await context.globalState.update(LOGIN_KEY, undefined);
	updateStatus();
	void vscode.window.showInformationMessage('Signed out of Red Code Sync. Synced data stays in your private Gist.');
}

function installedExtensions(): string[] {
	return vscode.extensions.all
		.filter(extension => !extension.packageJSON.isBuiltin)
		.map(extension => extension.id)
		.sort((a, b) => a.localeCompare(b));
}

async function collectSnapshot(): Promise<{ snapshot: SyncSnapshot; excluded: string[]; secretLike: string[] }> {
	const config = vscode.workspace.getConfiguration('redCode.sync');
	const directory = userDir();

	const rawSettings = await readSettings(path.join(directory, 'settings.json'));
	const filtered = filterSettings(
		rawSettings,
		config.get<string[]>('excludeSettings', []),
		config.get<boolean>('includeSecretLikeSettings', false)
	);

	const keybindings = config.get<boolean>('includeKeybindings', true)
		? await readTextIfExists(path.join(directory, 'keybindings.json'))
		: undefined;
	const snippets = config.get<boolean>('includeSnippets', true)
		? await readSnippets(path.join(directory, 'snippets'))
		: {};
	const extensions = config.get<boolean>('includeExtensions', true) ? installedExtensions() : [];

	return {
		snapshot: { settings: filtered.settings, keybindings, snippets, extensions },
		excluded: filtered.excluded,
		secretLike: filtered.secretLike
	};
}

function gistDescription(): string {
	return vscode.workspace.getConfiguration('redCode.sync').get<string>('gistDescription', 'Red Code Sync');
}

async function push(interactive: boolean): Promise<void> {
	if (busy) {
		return;
	}
	busy = true;
	if (statusItem) {
		statusItem.text = '$(sync~spin) Syncing…';
	}

	try {
		const token = await getToken(interactive);
		if (!token) {
			return;
		}

		const { snapshot, excluded, secretLike } = await collectSnapshot();
		if (Object.keys(snapshot.settings).length === 0 && snapshot.keybindings === undefined && Object.keys(snapshot.snippets).length === 0 && snapshot.extensions.length === 0) {
			void vscode.window.showWarningMessage('There is nothing to sync: settings, keybindings, snippets and extensions are all excluded or empty.');
			return;
		}

		const storedId = context.globalState.get<string>(GIST_ID_KEY);
		let gist: Gist | undefined;
		if (storedId) {
			try {
				gist = await getGist(token, storedId);
			} catch (error) {
				if (!(error instanceof GistError && error.status === 404)) {
					throw error;
				}
			}
		}

		const remoteManifest = gist ? parseGistFiles(gist.files)?.manifest : undefined;
		const lastRevision = context.globalState.get<number>(REVISION_KEY, 0);
		if (interactive && shouldPull(remoteManifest, lastRevision)) {
			const choice = await vscode.window.showWarningMessage(
				`GitHub already has revision ${remoteManifest?.revision} from ${remoteManifest?.device}. Uploading replaces it with this machine's data.`,
				{ modal: true },
				'Upload Anyway'
			);
			if (choice !== 'Upload Anyway') {
				return;
			}
		}

		const manifest = buildManifest(remoteManifest, os.hostname(), vscode.version);
		const files = buildGistFiles(snapshot, manifest);
		const payload: Record<string, { content: string } | null> = { ...files };
		for (const optional of [KEYBINDINGS_FILE, SNIPPETS_FILE, EXTENSIONS_FILE]) {
			if (!(optional in files)) {
				payload[optional] = null;
			}
		}

		const saved = gist ? await updateGist(token, gist.id, payload) : await createGist(token, gistDescription(), payload);
		await context.globalState.update(GIST_ID_KEY, saved.id);
		await context.globalState.update(REVISION_KEY, manifest.revision);
		await context.globalState.update(LAST_SYNC_KEY, Date.now());

		await rememberLogin(token);
		updateStatus();

		if (interactive) {
			const notes: string[] = [describeSnapshot(snapshot)];
			if (excluded.length > 0) {
				notes.push(`${excluded.length} excluded by settings`);
			}
			if (secretLike.length > 0) {
				notes.push(`${secretLike.length} credential-like keys withheld (${secretLike.slice(0, 3).join(', ')}${secretLike.length > 3 ? '…' : ''})`);
			}
			void vscode.window.showInformationMessage(`Uploaded revision ${manifest.revision}: ${notes.join(' · ')}`);
		}
	} catch (error) {
		if (interactive) {
			void vscode.window.showErrorMessage(`Red Code Sync upload failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	} finally {
		busy = false;
		updateStatus();
	}
}

async function syncNow(): Promise<void> {
	if (busy) {
		return;
	}
	const token = await getToken(true);
	if (!token) {
		return;
	}

	const gistId = context.globalState.get<string>(GIST_ID_KEY);
	if (!gistId) {
		await push(true);
		return;
	}

	busy = true;
	try {
		const gist = await getGist(token, gistId);
		const parsed = parseGistFiles(gist.files);
		const lastRevision = context.globalState.get<number>(REVISION_KEY, 0);

		if (!parsed) {
			const choice = await vscode.window.showWarningMessage(
				'The sync Gist does not contain a valid Red Code snapshot. Upload this machine to replace it?',
				{ modal: true },
				'Upload'
			);
			if (choice === 'Upload') {
				await push(true);
			}
			return;
		}

		if (shouldPull(parsed.manifest, lastRevision)) {
			const summary = parsed.manifest;
			const choice = await vscode.window.showInformationMessage(
				`GitHub has revision ${summary.revision} from ${summary.device} (${new Date(summary.updatedAt).toLocaleString()}). This machine last synced revision ${lastRevision}.`,
				{ modal: true },
				'Restore from GitHub',
				'Upload This Machine'
			);
			if (choice === 'Restore from GitHub') {
				await pull();
			} else if (choice === 'Upload This Machine') {
				await push(true);
			}
			return;
		}

		await push(true);
	} catch (error) {
		void vscode.window.showErrorMessage(`Red Code Sync failed: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		busy = false;
		updateStatus();
	}
}

async function findSyncGist(token: string): Promise<Gist | undefined> {
	const storedId = context.globalState.get<string>(GIST_ID_KEY);
	if (storedId) {
		try {
			const gist = await getGist(token, storedId);
			if (gist.files && MANIFEST_FILE in gist.files) {
				return gist;
			}
		} catch (error) {
			if (!(error instanceof GistError && error.status === 404)) {
				throw error;
			}
		}
	}

	const description = gistDescription();
	const gists = (await listGists(token))
		.filter(candidate => candidate.files && MANIFEST_FILE in candidate.files)
		.filter(candidate => (candidate.description ?? '').startsWith(description));

	if (gists.length === 0) {
		return undefined;
	}
	if (gists.length === 1) {
		return gists[0];
	}

	const items = gists.map(candidate => ({
		label: candidate.description ?? candidate.id,
		description: candidate.updated_at ? new Date(candidate.updated_at).toLocaleString() : '',
		detail: candidate.id,
		gist: candidate
	}));
	const picked = await vscode.window.showQuickPick(items, {
		title: 'Choose a sync Gist',
		placeHolder: 'Private Gists created by Red Code Sync'
	});
	return picked?.gist;
}

async function pull(): Promise<void> {
	if (busy) {
		return;
	}
	busy = true;
	try {
		const token = await getToken(true);
		if (!token) {
			return;
		}

		const gist = await findSyncGist(token);
		if (!gist) {
			void vscode.window.showInformationMessage('No Red Code Sync Gist was found for this account. Use Sync Now to create one.');
			return;
		}

		const parsed = parseGistFiles(gist.files);
		if (!parsed) {
			void vscode.window.showErrorMessage('The sync Gist does not contain a readable snapshot.');
			return;
		}

		const summary = parsed.manifest;
		const confirm = await vscode.window.showWarningMessage(
			`Restore ${describeSnapshot(parsed.snapshot)} from ${summary.device} (${new Date(summary.updatedAt).toLocaleString()})? Existing settings with the same keys are replaced; keybindings and snippets are backed up first.`,
			{ modal: true },
			'Restore'
		);
		if (confirm !== 'Restore') {
			return;
		}

		await applySnapshot(parsed.snapshot);

		await context.globalState.update(GIST_ID_KEY, gist.id);
		await context.globalState.update(REVISION_KEY, summary.revision);
		await context.globalState.update(LAST_SYNC_KEY, Date.now());
		await rememberLogin(token);
		updateStatus();

		const action = await vscode.window.showInformationMessage(`Restored revision ${summary.revision} from ${gistWebUrl(gist) ?? 'GitHub'}.`, 'Reload Window');
		if (action === 'Reload Window') {
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	} catch (error) {
		void vscode.window.showErrorMessage(`Red Code Sync restore failed: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		busy = false;
		updateStatus();
	}
}

async function applySnapshot(snapshot: SyncSnapshot): Promise<void> {
	const config = vscode.workspace.getConfiguration();
	const excluded = vscode.workspace.getConfiguration('redCode.sync').get<string[]>('excludeSettings', []);

	for (const [key, value] of Object.entries(snapshot.settings)) {
		if (matchesExclusion(key, excluded)) {
			continue;
		}
		await config.update(key, value, vscode.ConfigurationTarget.Global);
	}

	const directory = userDir();

	if (snapshot.keybindings !== undefined) {
		const parsed = parseJsonc(snapshot.keybindings);
		if (Array.isArray(parsed)) {
			await writeWithBackup(path.join(directory, 'keybindings.json'), snapshot.keybindings);
		} else {
			void vscode.window.showWarningMessage('The keybindings file in the snapshot is not a JSON array and was skipped.');
		}
	}

	if (Object.keys(snapshot.snippets).length > 0) {
		await writeSnippets(path.join(directory, 'snippets'), snapshot.snippets);
	}

	if (snapshot.extensions.length > 0) {
		const diff = extensionDiff(installedExtensions(), snapshot.extensions);
		if (diff.missing.length > 0) {
			const install = await vscode.window.showInformationMessage(
				`${diff.missing.length} extension${diff.missing.length === 1 ? '' : 's'} from the snapshot are not installed.`,
				{ modal: true },
				'Install'
			);
			if (install === 'Install') {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Installing extensions from the snapshot'
				}, async progress => {
					for (const id of diff.missing) {
						progress.report({ message: id, increment: 100 / diff.missing.length });
						try {
							await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
						} catch {
							// A single failure must not abort the rest.
						}
					}
				});
			}
		}
	}
}

async function viewRemote(): Promise<void> {
	const token = await getToken(true);
	if (!token) {
		return;
	}

	try {
		const gist = await findSyncGist(token);
		if (!gist) {
			void vscode.window.showInformationMessage('No Red Code Sync Gist was found for this account.');
			return;
		}
		const parsed = parseGistFiles(gist.files);
		if (!parsed) {
			void vscode.window.showErrorMessage('The sync Gist does not contain a readable snapshot.');
			return;
		}

		const settings = Object.keys(parsed.snapshot.settings).sort();
		const lines = [
			`# Red Code Sync`,
			'',
			`Revision: **${parsed.manifest.revision}**`,
			`Device: ${parsed.manifest.device}`,
			`Updated: ${new Date(parsed.manifest.updatedAt).toLocaleString()}`,
			`Editor: ${parsed.manifest.editorVersion}`,
			gistWebUrl(gist) ? `Gist: ${gistWebUrl(gist)}` : '',
			'',
			`## Settings (${settings.length})`,
			'',
			...settings.map(key => `- \`${key}\``),
			'',
			`## Extensions (${parsed.snapshot.extensions.length})`,
			'',
			...parsed.snapshot.extensions.map(id => `- \`${id}\``),
			'',
			'> Values are deliberately not shown here. Open the Gist to inspect them.'
		].filter(line => line !== '');

		const document = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
		await vscode.window.showTextDocument(document, { preview: true });
	} catch (error) {
		void vscode.window.showErrorMessage(`Could not read the sync Gist: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function showStatus(): Promise<void> {
	const login = context.globalState.get<string>(LOGIN_KEY);
	const revision = context.globalState.get<number>(REVISION_KEY, 0);
	const lastSync = context.globalState.get<number>(LAST_SYNC_KEY, 0);
	const lines = [
		login ? `Signed in as ${login}` : 'Not signed in',
		`Gist: ${context.globalState.get<string>(GIST_ID_KEY) ?? 'not created yet'}`,
		`Revision: ${revision}`,
		`Last sync: ${lastSync ? new Date(lastSync).toLocaleString() : 'never'}`
	];

	const actions = login ? ['Sync Now', 'View Remote', 'Sign Out'] : ['Sign In'];
	const choice = await vscode.window.showInformationMessage(lines.join(' · '), ...actions);
	if (choice === 'Sync Now') {
		await syncNow();
	} else if (choice === 'View Remote') {
		await viewRemote();
	} else if (choice === 'Sign Out') {
		await signOut();
	} else if (choice === 'Sign In') {
		await signIn();
	}
}

function scheduleAutoPush(): void {
	if (!vscode.workspace.getConfiguration('redCode.sync').get<boolean>('autoPush', false)) {
		return;
	}
	if (!context.globalState.get<string>(LOGIN_KEY)) {
		return;
	}
	if (autoPushTimer) {
		clearTimeout(autoPushTimer);
	}
	autoPushTimer = setTimeout(() => {
		autoPushTimer = undefined;
		void push(false);
	}, AUTO_PUSH_DELAY_MS);
}
