/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { buildExplorer, ExplorerFile, ExplorerGroup, ExplorerSection } from '../index/explorer.js';
import { ProjectGroup } from '../index/views.js';
import { LaravelViewContext } from './context.js';

const GROUP_ICONS: Partial<Record<ProjectGroup, string>> = {
	Application: 'symbol-class',
	HTTP: 'globe',
	Views: 'layout',
	Database: 'database',
	Configuration: 'settings-gear',
	Tests: 'beaker',
	Packages: 'package'
};

export class ExplorerGroupNode extends vscode.TreeItem {
	readonly kind = 'explorerGroup';

	constructor(readonly group: ExplorerGroup) {
		super(group.name, vscode.TreeItemCollapsibleState.Expanded);
		const count = group.sections.reduce((total, section) => total + section.files.length, 0);
		this.description = `${count}`;
		this.contextValue = 'explorerGroup';
		const icon = GROUP_ICONS[group.name];
		if (icon) {
			this.iconPath = new vscode.ThemeIcon(icon);
		}
	}
}

export class ExplorerSectionNode extends vscode.TreeItem {
	readonly kind = 'explorerSection';

	constructor(readonly section: ExplorerSection) {
		super(section.name, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = `${section.files.length}`;
		this.contextValue = 'explorerSection';
		this.iconPath = vscode.ThemeIcon.Folder;
	}
}

export class ExplorerFileNode extends vscode.TreeItem {
	readonly kind = 'explorerFile';

	constructor(readonly file: ExplorerFile, root: vscode.Uri) {
		super(file.label, vscode.TreeItemCollapsibleState.None);
		const resource = vscode.Uri.joinPath(root, file.relativePath);
		this.resourceUri = resource;
		this.contextValue = 'explorerFile';
		this.command = { command: 'vscode.open', title: 'Open', arguments: [resource] };
		this.tooltip = file.relativePath;
	}
}

/**
 * A second, generated tree: Laravel roles rather than raw folders. The normal
 * Explorer is untouched, so this is purely additive.
 */
export class ProjectExplorerProvider implements vscode.TreeDataProvider<ExplorerGroupNode | ExplorerSectionNode | ExplorerFileNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly context: LaravelViewContext) { }

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: ExplorerGroupNode | ExplorerSectionNode | ExplorerFileNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ExplorerGroupNode | ExplorerSectionNode | ExplorerFileNode): Promise<Array<ExplorerGroupNode | ExplorerSectionNode | ExplorerFileNode>> {
		const project = this.context.project();
		if (!project) {
			return [];
		}

		if (!element) {
			const graph = await this.context.ensureIndex();
			if (!graph) {
				return [];
			}
			return buildExplorer([...graph.files]).map(group => new ExplorerGroupNode(group));
		}

		if (element instanceof ExplorerGroupNode) {
			return element.group.sections.map(section => new ExplorerSectionNode(section));
		}

		if (element instanceof ExplorerSectionNode) {
			return element.section.files.map(file => new ExplorerFileNode(file, project.root));
		}

		return [];
	}
}
