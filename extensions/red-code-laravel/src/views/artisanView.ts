/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ArtisanCatalog, ArtisanCommand, isSelectableCommand } from '../index/commands.js';

export interface ArtisanViewDeps {
	catalog(): Promise<ArtisanCatalog | undefined>;
	runNamedCommand(name: string): Promise<void>;
}

export class ArtisanNamespaceNode extends vscode.TreeItem {
	readonly kind = 'artisanNamespace';

	constructor(readonly namespace: string, readonly commands: readonly ArtisanCommand[]) {
		super(namespace || 'general', vscode.TreeItemCollapsibleState.Expanded);
		this.description = `${commands.length}`;
		this.contextValue = 'artisanNamespace';
		this.iconPath = new vscode.ThemeIcon('terminal');
	}
}

export class ArtisanCommandNode extends vscode.TreeItem {
	readonly kind = 'artisanCommand';

	constructor(readonly artisanCommand: ArtisanCommand) {
		super(artisanCommand.name, vscode.TreeItemCollapsibleState.None);
		this.description = artisanCommand.description;
		this.contextValue = 'artisanCommand';
		this.iconPath = new vscode.ThemeIcon('chevron-right');
		this.tooltip = artisanCommand.description;
		this.command = {
			command: 'redCode.laravel.runArtisanCommand',
			title: 'Run',
			arguments: [artisanCommand.name]
		};
	}
}

/**
 * Command Center tree: namespaces and the commands Laravel actually exposes.
 * Selecting a command opens the definition-driven form, not a terminal prompt.
 */
export class ArtisanTreeProvider implements vscode.TreeDataProvider<ArtisanNamespaceNode | ArtisanCommandNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly deps: ArtisanViewDeps) { }

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: ArtisanNamespaceNode | ArtisanCommandNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ArtisanNamespaceNode | ArtisanCommandNode): Promise<Array<ArtisanNamespaceNode | ArtisanCommandNode>> {
		if (element) {
			return element instanceof ArtisanNamespaceNode
				? element.commands.map(command => new ArtisanCommandNode(command))
				: [];
		}

		const catalog = await this.deps.catalog();
		if (!catalog) {
			return [];
		}

		const groups = new Map<string, ArtisanCommand[]>();
		for (const command of catalog.commands) {
			if (!isSelectableCommand(command)) {
				continue;
			}
			const existing = groups.get(command.namespace);
			if (existing) {
				existing.push(command);
			} else {
				groups.set(command.namespace, [command]);
			}
		}

		return [...groups.entries()]
			.sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
			.map(([namespace, commands]) => new ArtisanNamespaceNode(namespace, commands));
	}
}
