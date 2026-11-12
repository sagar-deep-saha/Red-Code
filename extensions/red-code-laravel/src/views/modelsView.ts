/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IndexedModel, ModelRelation } from '../index/models.js';
import { LaravelViewContext } from './context.js';
import { commandFor } from './routesView.js';

export class ModelNode extends vscode.TreeItem {
	readonly kind = 'model';

	constructor(readonly model: IndexedModel, context: LaravelViewContext) {
		super(model.name, hasDetails(model) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		this.description = model.table;
		this.contextValue = 'laravelModel';
		this.iconPath = new vscode.ThemeIcon('symbol-class');
		this.command = commandFor({ file: model.file, line: 1 }, context);

		const flags = [
			model.timestamps ? 'timestamps' : 'no timestamps',
			model.softDeletes ? 'soft deletes' : 'no soft deletes'
		];

		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**${model.name}**\n\n`);
		tooltip.appendMarkdown(`Class: \`${model.fqcn}\`\n\n`);
		tooltip.appendMarkdown(`Table: \`${model.table}\` · Primary key: \`${model.primaryKey}\`\n\n`);
		tooltip.appendMarkdown(`Flags: ${flags.join(', ')}`);
		this.tooltip = tooltip;
	}
}

export class ModelGroupNode extends vscode.TreeItem {
	readonly kind = 'modelGroup';

	constructor(readonly group: 'relations' | 'fillable', readonly model: IndexedModel) {
		super(group === 'relations' ? 'Relations' : 'Fillable', vscode.TreeItemCollapsibleState.Expanded);
		const count = group === 'relations' ? model.relations.length : model.fillable.length;
		this.description = `${count}`;
		this.contextValue = 'modelGroup';
		this.iconPath = new vscode.ThemeIcon(group === 'relations' ? 'references' : 'symbol-field');
	}
}

export class ModelRelationNode extends vscode.TreeItem {
	readonly kind = 'modelRelation';

	constructor(readonly relation: ModelRelation, context: LaravelViewContext) {
		super(`${relation.method} → ${relation.relatedName}`, vscode.TreeItemCollapsibleState.None);
		this.description = [relation.type, relation.relatedTable].filter(Boolean).join(' · ');
		this.contextValue = 'laravelRelation';
		this.iconPath = new vscode.ThemeIcon('symbol-reference');
		this.tooltip = relation.related;

		// A relation can point at a class the index does not own (framework
		// models), in which case there is nothing to navigate to.
		const target = context.graph()?.class(relation.related);
		if (target) {
			this.command = commandFor({ file: target.file, line: 1 }, context);
		}
	}
}

export class ModelColumnNode extends vscode.TreeItem {
	readonly kind = 'modelColumn';

	constructor(readonly column: string, model: IndexedModel, context: LaravelViewContext) {
		super(column, vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'laravelAttribute';
		this.iconPath = new vscode.ThemeIcon('symbol-field');
		this.command = commandFor({ file: model.file, line: 1 }, context);
	}
}

export type ModelsNode = ModelNode | ModelGroupNode | ModelRelationNode | ModelColumnNode;

function hasDetails(model: IndexedModel): boolean {
	return model.relations.length > 0 || model.fillable.length > 0;
}

/**
 * Renders the Eloquent models derived from the index: every model, its table,
 * and the relationships/columns declared in the class. Nothing is executed, so
 * the view is identical in a trusted and an untrusted workspace.
 */
export class ModelsTreeProvider implements vscode.TreeDataProvider<ModelsNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly context: LaravelViewContext) { }

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: ModelsNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: ModelsNode): Promise<ModelsNode[]> {
		if (!element) {
			await this.context.ensureIndex();
			const models = this.context.models() ?? [];
			return [...models]
				.sort((left, right) => left.name.localeCompare(right.name))
				.map(model => new ModelNode(model, this.context));
		}

		if (element instanceof ModelNode) {
			const children: ModelsNode[] = [];
			if (element.model.relations.length > 0) {
				children.push(new ModelGroupNode('relations', element.model));
			}
			if (element.model.fillable.length > 0) {
				children.push(new ModelGroupNode('fillable', element.model));
			}
			return children;
		}

		if (element instanceof ModelGroupNode) {
			if (element.group === 'relations') {
				return element.model.relations.map(relation => new ModelRelationNode(relation, this.context));
			}
			return element.model.fillable.map(column => new ModelColumnNode(column, element.model, this.context));
		}

		return [];
	}
}
