/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { describeFeedFailure, feedFromGitHubReleases, mergeFeeds, parseFeed, pickRelease, ReleaseInfo, UpdateFeed } from './feed.js';

const LAST_CHECK_KEY = 'redCode.updates.lastCheck';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 15_000;
const MANIFEST_ASSET = /^redcode-updates\.json$/i;
const USER_AGENT = 'Red-Code-Updater';

let statusItem: vscode.StatusBarItem | undefined;
let pendingRelease: ReleaseInfo | undefined;
let checking = false;
let context: vscode.ExtensionContext;

export function activate(extensionContext: vscode.ExtensionContext): void {
	context = extensionContext;

	statusItem = vscode.window.createStatusBarItem('redCode.updates', vscode.StatusBarAlignment.Right, 100);
	statusItem.name = 'Red Code Updates';
	statusItem.command = 'redCode.updates.check';
	updateStatusItem();
	statusItem.show();

	context.subscriptions.push(
		statusItem,
		vscode.commands.registerCommand('redCode.updates.check', () => checkForUpdates(true)),
		vscode.commands.registerCommand('redCode.updates.versionHistory', () => showVersionHistory()),
		vscode.commands.registerCommand('redCode.updates.openReleasePage', () => openReleasePage()),
		vscode.commands.registerCommand('redCode.updates.showStatus', () => showStatus()),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('redCode.updates')) {
				updateStatusItem();
			}
		})
	);

	const config = vscode.workspace.getConfiguration('redCode.updates');
	if (config.get<boolean>('checkOnStartup', true)) {
		const lastCheck = context.globalState.get<number>(LAST_CHECK_KEY, 0);
		if (Date.now() - lastCheck > CHECK_INTERVAL_MS) {
			const timer = setTimeout(() => { void checkForUpdates(false); }, STARTUP_DELAY_MS);
			context.subscriptions.push({ dispose: () => clearTimeout(timer) });
		}
	}
}

export function deactivate(): void {
	pendingRelease = undefined;
}

function updateStatusItem(): void {
	if (!statusItem) {
		return;
	}
	if (pendingRelease) {
		statusItem.text = `$(cloud-download) Red Code ${pendingRelease.version}`;
		statusItem.tooltip = `Red Code ${pendingRelease.version} is available (running ${vscode.version}). Click to review and install.`;
		statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		return;
	}
	statusItem.text = `$(verified) Red Code ${vscode.version}`;
	statusItem.tooltip = 'Check for Red Code updates';
	statusItem.backgroundColor = undefined;
}

async function checkForUpdates(interactive: boolean): Promise<void> {
	if (checking) {
		return;
	}
	checking = true;
	if (statusItem) {
		statusItem.text = '$(sync~spin) Checking for updates…';
	}

	try {
		const includePrerelease = vscode.workspace.getConfiguration('redCode.updates').get<boolean>('includePrerelease', false);
		const feed = await loadFeed(includePrerelease);
		if (!feed) {
			throw new Error(describeFeedFailure(repositoryName()));
		}

		await context.globalState.update(LAST_CHECK_KEY, Date.now());
		pendingRelease = pickRelease(feed, vscode.version, includePrerelease);
		updateStatusItem();

		if (!pendingRelease) {
			if (interactive) {
				void vscode.window.showInformationMessage(feed.releases.length === 0
					? `No Red Code updates have been published for ${repositoryName()} yet. You are running ${vscode.version}.`
					: `Red Code ${vscode.version} is up to date.`);
			}
			return;
		}

		const actions = ['Download & Install', 'Release Notes', 'Later'];
		const choice = await vscode.window.showInformationMessage(
			`Red Code ${pendingRelease.version} is available. You are running ${vscode.version}.`,
			...actions
		);

		if (choice === actions[0]) {
			await downloadAndInstall(pendingRelease);
		} else if (choice === actions[1]) {
			await openReleasePage();
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (statusItem) {
			statusItem.text = '$(alert) Update check failed';
			statusItem.tooltip = message;
		}
		if (interactive) {
			void vscode.window.showErrorMessage(`Red Code update check failed: ${message}`);
		}
	} finally {
		checking = false;
	}
}

function repositoryName(): string {
	return vscode.workspace.getConfiguration('redCode.updates').get<string>('repository', 'sagar-deep-saha/Red-Code');
}

async function loadFeed(includePrerelease: boolean): Promise<UpdateFeed | undefined> {
	const config = vscode.workspace.getConfiguration('redCode.updates');
	const feedUrl = config.get<string>('feedUrl', '').trim();
	if (feedUrl) {
		if (!/^https:\/\//i.test(feedUrl)) {
			throw new Error('redCode.updates.feedUrl must be an HTTPS URL.');
		}
		const text = await fetchText(feedUrl);
		return parseFeed(text, feedUrl);
	}
	return loadGitHubFeed(repositoryName(), includePrerelease);
}

interface GitHubAsset {
	readonly name?: unknown;
	readonly browser_download_url?: unknown;
	readonly digest?: unknown;
	readonly size?: unknown;
}

interface GitHubRelease {
	readonly assets?: unknown;
	readonly draft?: unknown;
}

async function loadGitHubFeed(repository: string, includePrerelease: boolean): Promise<UpdateFeed | undefined> {
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
		throw new Error('redCode.updates.repository must be "owner/name".');
	}

	const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=30`, {
		headers: { 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' },
		signal: AbortSignal.timeout(20_000)
	});

	if (response.status === 404) {
		throw new Error(`Repository ${repository} was not found.`);
	}
	if (response.status === 403 || response.status === 429) {
		throw new Error('GitHub API rate limit reached. Try again later, or set redCode.updates.feedUrl.');
	}
	if (!response.ok) {
		throw new Error(`GitHub returned HTTP ${response.status}.`);
	}

	const json: unknown = await response.json();
	const derived = feedFromGitHubReleases(json, includePrerelease);
	const manifests: ReleaseInfo[] = [];

	// A manifest published with the release carries the exact installer hash and
	// release notes. It wins over the digest GitHub reports, and is the only way
	// to offer a release whose asset has no digest yet.
	for (const item of Array.isArray(json) ? (json as GitHubRelease[]).slice(0, 12) : []) {
		const assets = Array.isArray(item.assets) ? item.assets as GitHubAsset[] : [];
		const asset = assets.find(candidate => MANIFEST_ASSET.test(String(candidate.name ?? '')));
		const url = typeof asset?.browser_download_url === 'string' ? asset.browser_download_url : undefined;
		if (!url || !/^https:\/\//i.test(url)) {
			continue;
		}
		try {
			const parsed = parseFeed(await fetchText(url), url);
			if (parsed) {
				manifests.push(...parsed.releases);
			}
		} catch {
			// A broken manifest must not hide releases that are otherwise valid.
		}
	}

	// A repository with no published releases yet is not a failure: there is
	// simply nothing to offer. Only an unreachable or unreadable source is.
	return mergeFeeds(derived, { releases: manifests });
}

async function downloadAndInstall(release: ReleaseInfo): Promise<void> {
	const config = vscode.workspace.getConfiguration('redCode.updates');
	const directory = config.get<string>('downloadDirectory', '').trim() || path.join(os.tmpdir(), 'red-code-updates');
	const target = path.join(directory, `RedCode-Setup-${release.version}.exe`);

	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Downloading Red Code ${release.version}`,
			cancellable: true
		}, async (progress, token) => {
			await downloadInstaller(release.installerUrl, target, progress, token);
			const stat = await fs.promises.stat(target);
			const actual = await hashFile(target);
			if (actual !== release.sha256.toLowerCase()) {
				await fs.promises.rm(target, { force: true });
				throw new Error('The downloaded installer did not match the published SHA-256 and was deleted.');
			}
			if (release.size && stat.size !== release.size) {
				await fs.promises.rm(target, { force: true });
				throw new Error('The downloaded installer size did not match the release record.');
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!(error instanceof vscode.CancellationError)) {
			void vscode.window.showErrorMessage(`Red Code update failed: ${message}`);
		}
		return;
	}

	const installLabel = 'Quit and Install';
	const choice = await vscode.window.showWarningMessage(
		`Install Red Code ${release.version}? Red Code will close while the installer runs.`,
		{ modal: true },
		installLabel
	);
	if (choice !== installLabel) {
		return;
	}

	const args = config.get<string[]>('installArguments', ['/SILENT', '/NORESTART', '/MERGETASKS=!runcode']);
	try {
		cp.spawn(target, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
	} catch (error) {
		void vscode.window.showErrorMessage(`Could not start the installer: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	await vscode.commands.executeCommand('workbench.action.quit');
}

async function downloadInstaller(
	url: string,
	target: string,
	progress: vscode.Progress<{ increment?: number; message?: string }>,
	token: vscode.CancellationToken
): Promise<void> {
	if (!/^https:\/\//i.test(url)) {
		throw new Error('Installer URLs must use HTTPS.');
	}

	const response = await fetch(url, {
		headers: { 'user-agent': USER_AGENT },
		redirect: 'follow',
		signal: AbortSignal.timeout(30 * 60 * 1000)
	});
	if (!response.ok || !response.body) {
		throw new Error(`Download failed with HTTP ${response.status}.`);
	}

	const total = Number(response.headers.get('content-length') ?? 0);
	await fs.promises.mkdir(path.dirname(target), { recursive: true });
	const handle = await fs.promises.open(target, 'w');
	const reader = response.body.getReader();
	let received = 0;

	try {
		for (; ;) {
			if (token.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			await handle.write(value);
			received += value.byteLength;
			progress.report({
				increment: total > 0 ? (value.byteLength / total) * 100 : undefined,
				message: `${(received / (1024 * 1024)).toFixed(1)} MB${total > 0 ? ` of ${(total / (1024 * 1024)).toFixed(1)} MB` : ''}`
			});
		}
	} catch (error) {
		await reader.cancel().catch(() => undefined);
		await handle.close().catch(() => undefined);
		await fs.promises.rm(target, { force: true }).catch(() => undefined);
		throw error;
	}

	await handle.close();
}

function hashFile(file: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(file);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('error', reject);
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
		redirect: 'follow',
		signal: AbortSignal.timeout(20_000)
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} for ${url}`);
	}
	return await response.text();
}

async function showVersionHistory(): Promise<void> {
	const config = vscode.workspace.getConfiguration('redCode.updates');
	const sections: string[] = [];

	try {
		const local = await fs.promises.readFile(path.join(context.extensionPath, 'CHANGELOG.md'), 'utf8');
		if (local.trim().length > 0) {
			sections.push(local.trim());
		}
	} catch {
		// A missing bundled changelog is not fatal; the feed still has notes.
	}

	try {
		const feed = await loadFeed(config.get<boolean>('includePrerelease', false));
		if (feed) {
			const lines = ['# Published releases', '', `Running: **${vscode.version}**`, ''];
			for (const release of feed.releases) {
				lines.push(`## ${release.version}${release.date ? ` — ${release.date.slice(0, 10)}` : ''}`, '');
				lines.push(release.notes?.trim() || '_No release notes._', '');
			}
			lines.push(`Source: ${repositoryName()}`);
			sections.push(lines.join('\n'));
		}
	} catch (error) {
		sections.push(`# Published releases\n\nCould not load release history: ${error instanceof Error ? error.message : String(error)}`);
	}

	if (sections.length === 0) {
		void vscode.window.showInformationMessage('No version history is available yet.');
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: sections.join('\n\n---\n\n'),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: true });
}

async function openReleasePage(): Promise<void> {
	const url = pendingRelease?.pageUrl ?? `https://github.com/${repositoryName()}/releases`;
	if (!/^https:\/\//i.test(url)) {
		void vscode.window.showErrorMessage('No release page is configured.');
		return;
	}
	await vscode.env.openExternal(vscode.Uri.parse(url));
}

async function showStatus(): Promise<void> {
	const lastCheck = context.globalState.get<number>(LAST_CHECK_KEY, 0);
	const lines = [
		`Running: ${vscode.version}`,
		`Repository: ${repositoryName()}`,
		`Last check: ${lastCheck ? new Date(lastCheck).toLocaleString() : 'never'}`,
		`Status: ${pendingRelease ? `update ${pendingRelease.version} available` : 'no update pending'}`
	];
	const action = await vscode.window.showInformationMessage(lines.join(' · '), 'Check Now', 'Version History');
	if (action === 'Check Now') {
		await checkForUpdates(true);
	} else if (action === 'Version History') {
		await showVersionHistory();
	}
}
