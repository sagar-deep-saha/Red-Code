/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { diffEnv, EnvDiff, EnvRow, parseEnvFile } from '../index/envModel.js';
import { LaravelProject } from '../project.js';

export interface EnvViewDeps {
	project(): LaravelProject | undefined;
	envFileName(): string;
	read(relativePath: string): Promise<string | undefined>;
}

export type EnvGroupKind = 'missing' | 'extra' | 'duplicates';

const EMPTY_DIFF: EnvDiff = { missing: [], extra: [], duplicates: [] };

function groupLabel(group: EnvGroupKind, fileName: string): string {
	switch (group) {
		case 'missing':
			return vscode.l10n.t('Missing from {0}', fileName);
		case 'extra':
			return vscode.l10n.t('Extra in {0}', fileName);
		default:
			return vscode.l10n.t('Duplicate keys');
	}
}

function groupIcon(group: EnvGroupKind): vscode.ThemeIcon {
	switch (group) {
		case 'missing':
			return new vscode.ThemeIcon('diff-added');
		case 'extra':
			return new vscode.ThemeIcon('diff-removed');
		default:
			return new vscode.ThemeIcon('warning');
	}
}

export class EnvGroupNode extends vscode.TreeItem {
	readonly kind = 'envGroup';

	constructor(readonly group: EnvGroupKind, readonly rows: readonly EnvRow[], fileName: string) {
		super(groupLabel(group, fileName), vscode.TreeItemCollapsibleState.Expanded);
		this.description = `${rows.length}`;
		this.contextValue = 'envGroup';
		this.iconPath = groupIcon(group);
	}
}

export class EnvKeyNode extends vscode.TreeItem {
	readonly kind = 'envKey';

	constructor(readonly row: EnvRow, readonly fileName: string) {
		super(row.key, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'envKey';
		this.tooltip = `${row.key} · ${fileName}:${row.lineNumber}`;

		switch (row.status) {
			case 'empty':
				this.description = vscode.l10n.t('empty value');
				this.iconPath = new vscode.ThemeIcon('warning');
				break;
			case 'duplicate':
				this.description = vscode.l10n.t('duplicate key');
				this.iconPath = new vscode.ThemeIcon('warning');
				break;
			case 'missing':
				this.iconPath = new vscode.ThemeIcon('diff-added');
				break;
			default:
				this.iconPath = new vscode.ThemeIcon('diff-removed');
				break;
		}
	}
}

interface EnvSnapshot {
	readonly diff: EnvDiff;
	readonly message: string | undefined;
}

/**
 * Read-only key diff between `.env` and `.env.example`. Values are never read
 * into the tree, so nothing secret is rendered on screen.
 */
export class EnvTreeProvider implements vscode.TreeDataProvider<EnvGroupNode | EnvKeyNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private snapshot: EnvSnapshot | undefined;

	constructor(private readonly deps: EnvViewDeps) { }

	refresh(): void {
		this.snapshot = undefined;
		this.changeEmitter.fire();
	}

	getTreeItem(element: EnvGroupNode | EnvKeyNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: EnvGroupNode | EnvKeyNode): Promise<Array<EnvGroupNode | EnvKeyNode>> {
		if (element instanceof EnvGroupNode) {
			return element.rows.map(row => new EnvKeyNode(row, this.deps.envFileName()));
		}
		if (element) {
			return [];
		}

		const { diff } = await this.load();
		const fileName = this.deps.envFileName();
		const groups: EnvGroupNode[] = [];
		if (diff.missing.length > 0) {
			groups.push(new EnvGroupNode('missing', diff.missing, fileName));
		}
		if (diff.extra.length > 0) {
			groups.push(new EnvGroupNode('extra', diff.extra, fileName));
		}
		if (diff.duplicates.length > 0) {
			groups.push(new EnvGroupNode('duplicates', diff.duplicates, fileName));
		}
		return groups;
	}

	/** Keys the example declares but the env file does not. */
	async missingKeys(): Promise<string[]> {
		const { diff } = await this.load();
		return diff.missing.map(row => row.key);
	}

	async message(): Promise<string | undefined> {
		return (await this.load()).message;
	}

	private async load(): Promise<EnvSnapshot> {
		if (this.snapshot) {
			return this.snapshot;
		}

		const project = this.deps.project();
		if (!project) {
			this.snapshot = { diff: EMPTY_DIFF, message: vscode.l10n.t('No Laravel project detected in this workspace.') };
			return this.snapshot;
		}

		const envFile = this.deps.envFileName();
		const envText = await this.deps.read(envFile);
		if (envText === undefined) {
			this.snapshot = { diff: EMPTY_DIFF, message: vscode.l10n.t('{0} was not found in this workspace.', envFile) };
			return this.snapshot;
		}

		const exampleFile = `${envFile}.example`;
		const exampleText = await this.deps.read(exampleFile);
		if (exampleText === undefined) {
			this.snapshot = { diff: EMPTY_DIFF, message: vscode.l10n.t('{0} was not found to compare against.', exampleFile) };
			return this.snapshot;
		}

		const diff = diffEnv(parseEnvFile(envText), parseEnvFile(exampleText));
		const total = diff.missing.length + diff.extra.length + diff.duplicates.length;
		this.snapshot = {
			diff,
			message: total === 0 ? vscode.l10n.t('{0} matches {1}.', envFile, exampleFile) : undefined
		};
		return this.snapshot;
	}
}
