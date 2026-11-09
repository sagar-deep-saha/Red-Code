/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { createWorkspaceChecks, DoctorCheck, sanitizeToolVersion } from './doctorModel.js';

const execFileAsync = promisify(execFile);
const WORKSPACE_ENTRIES = [
	'.git',
	'package.json',
	'pnpm-lock.yaml',
	'package-lock.json',
	'yarn.lock',
	'bun.lockb',
	'bun.lock',
	'node_modules',
	'composer.json',
	'composer.lock',
	'vendor',
	'.env'
] as const;
const MAX_WORKSPACE_FOLDERS = 20;

const TOOLS = [
	{ name: 'Git', command: 'git' },
	{ name: 'Node.js', command: 'node' },
	{ name: 'npm', command: 'npm' },
	{ name: 'PHP', command: 'php' },
	{ name: 'Composer', command: 'composer' }
] as const;

const LOCALIZED_LABELS = new Map<string, string>([
	['Git metadata', vscode.l10n.t('Git metadata')],
	['JavaScript project', vscode.l10n.t('JavaScript project')],
	['Node dependencies', vscode.l10n.t('Node dependencies')],
	['JavaScript lockfile', vscode.l10n.t('JavaScript lockfile')],
	['PHP project', vscode.l10n.t('PHP project')],
	['Composer dependencies', vscode.l10n.t('Composer dependencies')],
	['Environment file', vscode.l10n.t('Environment file')]
]);

const LOCALIZED_DESCRIPTIONS = new Map<string, string>([
	['Found .git', vscode.l10n.t('Found .git')],
	['No .git entry found', vscode.l10n.t('No .git entry found')],
	['Found package.json', vscode.l10n.t('Found package.json')],
	['No package.json found', vscode.l10n.t('No package.json found')],
	['Not applicable without package.json', vscode.l10n.t('Not applicable without package.json')],
	['Found node_modules', vscode.l10n.t('Found node_modules')],
	['Dependencies are not installed', vscode.l10n.t('Dependencies are not installed')],
	['Found a recognized lockfile', vscode.l10n.t('Found a recognized lockfile')],
	['No recognized lockfile found', vscode.l10n.t('No recognized lockfile found')],
	['Found composer.json', vscode.l10n.t('Found composer.json')],
	['No composer.json found', vscode.l10n.t('No composer.json found')],
	['Not applicable without composer.json', vscode.l10n.t('Not applicable without composer.json')],
	['Found vendor', vscode.l10n.t('Found vendor')],
	['Found .env; contents were not read', vscode.l10n.t('Found .env; contents were not read')],
	['No .env file found; contents were not read', vscode.l10n.t('No .env file found; contents were not read')]
]);

export class WorkspaceDoctor implements vscode.TreeDataProvider<DoctorItem> {
	private readonly changeEmitter = new vscode.EventEmitter<DoctorItem | undefined | null | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private readonly treeView: vscode.TreeView<DoctorItem>;
	private workspaceChecks: DoctorCheck[] = [];
	private toolChecks: DoctorCheck[] = [];
	private activeOperations = 0;
	private skippedFolderCount = 0;

	constructor() {
		this.treeView = vscode.window.createTreeView('redCode.doctor', {
			treeDataProvider: this,
			showCollapseAll: false
		});
	}

	dispose(): void {
		this.treeView.dispose();
		this.changeEmitter.dispose();
	}

	getChildren(): DoctorItem[] {
		if (this.activeOperations > 0) {
			return [new DoctorItem(vscode.l10n.t('Checking workspace…'), '', 'info')];
		}
		const checks = [...this.workspaceChecks, ...this.toolChecks];
		if (checks.length === 0) {
			return [new DoctorItem(vscode.l10n.t('Select Scan Workspace to inspect project files.'), '', 'info')];
		}
		const items = checks.map(check => {
			const label = LOCALIZED_LABELS.get(check.label) ?? check.label;
			return new DoctorItem(
				check.folderName ? vscode.l10n.t('{0}: {1}', check.folderName, label) : label,
				LOCALIZED_DESCRIPTIONS.get(check.description) ?? check.description,
				check.status
			);
		});
		if (this.skippedFolderCount > 0) {
			items.push(new DoctorItem(
				vscode.l10n.t('Additional workspace folders'),
				vscode.l10n.t('Skipped {0} folders to keep the scan bounded.', this.skippedFolderCount),
				'info'
			));
		}
		return items;
	}

	getTreeItem(element: DoctorItem): vscode.TreeItem {
		return element;
	}

	async scanWorkspace(): Promise<void> {
		const allFolders = vscode.workspace.workspaceFolders ?? [];
		if (allFolders.length === 0) {
			this.workspaceChecks = [{
				label: vscode.l10n.t('No workspace is open'),
				description: vscode.l10n.t('Open a folder or workspace to run project checks.'),
				status: 'warning'
			}];
			this.skippedFolderCount = 0;
			this.changeEmitter.fire();
			return;
		}

		const folders = allFolders.slice(0, MAX_WORKSPACE_FOLDERS);
		this.skippedFolderCount = Math.max(0, allFolders.length - folders.length);
		this.activeOperations++;
		this.changeEmitter.fire();
		try {
			const results = await Promise.all(folders.map(async folder => {
				const presentPaths = new Set<string>();
				await Promise.all(WORKSPACE_ENTRIES.map(async entry => {
					try {
						await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, entry));
						presentPaths.add(entry);
					} catch {
						// Missing or inaccessible optional project files are reported as absent.
					}
				}));
				return createWorkspaceChecks(folder.name, presentPaths);
			}));
			this.workspaceChecks = results.flat();
		} finally {
			this.activeOperations--;
			this.changeEmitter.fire();
		}
	}

	async checkTools(): Promise<void> {
		this.activeOperations++;
		this.changeEmitter.fire();
		try {
			this.toolChecks = await Promise.all(TOOLS.map(async tool => this.checkTool(tool.name, tool.command)));
		} finally {
			this.activeOperations--;
			this.changeEmitter.fire();
		}
	}

	private async checkTool(name: string, command: string): Promise<DoctorCheck> {
		try {
			// Only fixed executable names and the fixed --version argument are run, on explicit user action.
			// Running from the temporary directory avoids project-local package scripts or config discovery.
			const isWindowsCommandScript = process.platform === 'win32' && command === 'npm';
			const result = await execFileAsync(isWindowsCommandScript ? 'npm.cmd' : command, ['--version'], {
				cwd: tmpdir(),
				env: this.getProbeEnvironment(),
				windowsHide: true,
				timeout: 3000,
				maxBuffer: 8192,
				shell: isWindowsCommandScript
			});
			const version = sanitizeToolVersion(result.stdout);
			return {
				label: vscode.l10n.t('Tool: {0}', name),
				description: version || vscode.l10n.t('Available; version was not reported'),
				status: version ? 'ok' : 'warning'
			};
		} catch {
			return {
				label: vscode.l10n.t('Tool: {0}', name),
				description: vscode.l10n.t('Not found or unable to run version check'),
				status: 'warning'
			};
		}
	}

	private getProbeEnvironment(): NodeJS.ProcessEnv {
		const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'COMSPEC']);
		const environment: NodeJS.ProcessEnv = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (allowed.has(key.toUpperCase()) && value !== undefined) {
				environment[key] = value;
			}
		}
		return environment;
	}
}

class DoctorItem extends vscode.TreeItem {
	constructor(label: string, description: string, status: DoctorCheck['status']) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.iconPath = new vscode.ThemeIcon(status === 'ok' ? 'check' : status === 'warning' ? 'warning' : 'info');
		this.tooltip = description ? `${label}: ${description}` : label;
	}
}
