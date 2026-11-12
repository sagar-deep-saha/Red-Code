/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IndexedView } from '../index/graph.js';
import { LaravelViewContext } from './context.js';
import { commandFor } from './routesView.js';

function componentName(view: IndexedView): string {
	return view.componentName ?? view.name;
}

export class ComponentNode extends vscode.TreeItem {
	readonly kind = 'component';

	constructor(readonly view: IndexedView, readonly usedBy: readonly IndexedView[], context: LaravelViewContext) {
		super(componentName(view), usedBy.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		this.description = usedBy.length > 0 ? vscode.l10n.t('{0} views', String(usedBy.length)) : vscode.l10n.t('unused');
		this.contextValue = 'laravelComponent';
		this.iconPath = new vscode.ThemeIcon('symbol-structure');
		this.command = commandFor({ file: view.file, line: 1 }, context);

		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**<x-${componentName(view)} />**\n\n`);
		tooltip.appendMarkdown(`File: \`${view.file}\`\n\n`);
		tooltip.appendMarkdown(
			usedBy.length > 0
				? vscode.l10n.t('Used by {0} view(s).', String(usedBy.length))
				: vscode.l10n.t('No indexed view uses this component.')
		);
		this.tooltip = tooltip;
	}
}

export class ComponentGroupNode extends vscode.TreeItem {
	readonly kind = 'componentGroup';

	constructor(readonly views: readonly IndexedView[]) {
		super('Used by', vscode.TreeItemCollapsibleState.Expanded);
		this.description = `${views.length}`;
		this.contextValue = 'componentGroup';
		this.iconPath = new vscode.ThemeIcon('references');
	}
}

export class ComponentUsageNode extends vscode.TreeItem {
	readonly kind = 'componentUsage';

	constructor(readonly view: IndexedView, context: LaravelViewContext) {
		super(view.name, vscode.TreeItemCollapsibleState.None);
		this.description = view.file;
		this.contextValue = 'laravelView';
		this.iconPath = new vscode.ThemeIcon('file-code');
		this.command = commandFor({ file: view.file, line: 1 }, context);
		this.tooltip = view.file;
	}
}

export type ComponentsNode = ComponentNode | ComponentGroupNode | ComponentUsageNode;

/**
 * Renders the Blade components found under `resources/views/components` with
 * their reverse `view->component` edges. Everything comes from the static
 * index, so the view is identical in a trusted and an untrusted workspace.
 */
export class ComponentsTreeProvider implements vscode.TreeDataProvider<ComponentsNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly context: LaravelViewContext) { }

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: ComponentsNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ComponentsNode): Promise<ComponentsNode[]> {
		if (!element) {
			await this.context.ensureIndex();
			const graph = this.context.graph();
			if (!graph) {
				return [];
			}
			return [...graph.components.values()]
				.sort((left, right) => componentName(left).localeCompare(componentName(right)))
				.map(view => new ComponentNode(view, graph.usedBy(componentName(view)), this.context));
		}

		if (element instanceof ComponentNode) {
			return element.usedBy.length > 0 ? [new ComponentGroupNode(element.usedBy)] : [];
		}

		if (element instanceof ComponentGroupNode) {
			return [...element.views]
				.sort((left, right) => left.name.localeCompare(right.name))
				.map(view => new ComponentUsageNode(view, this.context));
		}

		return [];
	}
}
