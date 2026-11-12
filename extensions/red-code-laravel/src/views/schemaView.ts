/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SourceLocation } from '../index/graph.js';
import { SchemaColumn, SchemaForeignKey, SchemaIndex, SchemaTable } from '../index/migrations.js';
import { LaravelViewContext } from './context.js';
import { commandFor } from './routesView.js';

type SchemaGroupKind = 'columns' | 'indexes' | 'foreignKeys';

const GROUP_LABELS: Record<SchemaGroupKind, string> = {
	columns: 'Columns',
	indexes: 'Indexes',
	foreignKeys: 'Foreign Keys'
};

const GROUP_ICONS: Record<SchemaGroupKind, string> = {
	columns: 'symbol-field',
	indexes: 'list-ordered',
	foreignKeys: 'key'
};

function formatLocation(location: SourceLocation): string {
	return `${location.file}:${location.line}`;
}

export class SchemaTableNode extends vscode.TreeItem {
	readonly kind = 'table';

	constructor(readonly table: SchemaTable, context: LaravelViewContext) {
		super(table.name, hasDetails(table) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		this.description = table.dropped ? 'dropped' : `${table.columns.length} columns`;
		this.contextValue = 'laravelTable';
		this.iconPath = new vscode.ThemeIcon(table.dropped ? 'trash' : 'table');
		if (table.createdIn) {
			this.command = commandFor(table.createdIn, context);
		}

		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**${table.name}**\n\n`);
		if (table.createdIn) {
			tooltip.appendMarkdown(`Created in \`${formatLocation(table.createdIn)}\`\n\n`);
		}
		if (table.lastChangedIn) {
			tooltip.appendMarkdown(`Last changed in \`${formatLocation(table.lastChangedIn)}\`\n\n`);
		}
		tooltip.appendMarkdown(
			`${table.columns.length} columns · ${table.indexes.length} indexes · ${table.foreignKeys.length} foreign keys`
		);
		this.tooltip = tooltip;
	}
}

export class SchemaGroupNode extends vscode.TreeItem {
	readonly kind = 'schemaGroup';

	constructor(readonly group: SchemaGroupKind, readonly table: SchemaTable) {
		super(GROUP_LABELS[group], vscode.TreeItemCollapsibleState.Expanded);
		this.description = `${countFor(group, table)}`;
		this.contextValue = 'schemaGroup';
		this.iconPath = new vscode.ThemeIcon(GROUP_ICONS[group]);
	}
}

export class SchemaColumnNode extends vscode.TreeItem {
	readonly kind = 'column';

	constructor(readonly column: SchemaColumn) {
		super(column.name, vscode.TreeItemCollapsibleState.None);
		const parts = [column.type];
		if (column.autoIncrement) {
			parts.push('autoincrement');
		}
		if (column.nullable) {
			parts.push('nullable');
		}
		if (column.default !== undefined) {
			parts.push(`default ${column.default}`);
		}
		this.description = parts.join(' · ');
		this.contextValue = 'schemaColumn';
		this.iconPath = new vscode.ThemeIcon('symbol-field');
	}
}

export class SchemaIndexNode extends vscode.TreeItem {
	readonly kind = 'index';

	constructor(readonly index: SchemaIndex) {
		super(index.columns.join(', '), vscode.TreeItemCollapsibleState.None);
		this.description = index.primary ? 'primary' : index.unique ? 'unique' : 'index';
		this.contextValue = 'schemaIndex';
		this.iconPath = new vscode.ThemeIcon('list-ordered');
	}
}

export class SchemaForeignKeyNode extends vscode.TreeItem {
	readonly kind = 'foreignKey';

	constructor(readonly foreignKey: SchemaForeignKey) {
		super(foreignKey.columns.join(', '), vscode.TreeItemCollapsibleState.None);
		const target = `${foreignKey.table}.${foreignKey.references.join(', ')}`;
		this.description = [`→ ${target}`, foreignKey.onDelete ? `on delete ${foreignKey.onDelete}` : undefined]
			.filter(Boolean)
			.join(' · ');
		this.contextValue = 'schemaForeignKey';
		this.iconPath = new vscode.ThemeIcon('key');
	}
}

export type SchemaNode = SchemaTableNode | SchemaGroupNode | SchemaColumnNode | SchemaIndexNode | SchemaForeignKeyNode;

function countFor(group: SchemaGroupKind, table: SchemaTable): number {
	if (group === 'columns') {
		return table.columns.length;
	}
	return group === 'indexes' ? table.indexes.length : table.foreignKeys.length;
}

function hasDetails(table: SchemaTable): boolean {
	return table.columns.length > 0 || table.indexes.length > 0 || table.foreignKeys.length > 0;
}

/**
 * Renders the schema read from migrations: tables with their columns, indexes
 * and foreign keys. It needs no database connection, so it works before a
 * migration has ever run and in a trusted or untrusted workspace alike.
 */
export class SchemaTreeProvider implements vscode.TreeDataProvider<SchemaNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly context: LaravelViewContext) { }

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: SchemaNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: SchemaNode): Promise<SchemaNode[]> {
		if (!element) {
			await this.context.ensureIndex();
			const schema = this.context.schema();
			if (!schema) {
				return [];
			}
			return [...schema.tables]
				.sort((left, right) => left.name.localeCompare(right.name))
				.map(table => new SchemaTableNode(table, this.context));
		}

		if (element instanceof SchemaTableNode) {
			const groups: SchemaNode[] = [];
			if (element.table.columns.length > 0) {
				groups.push(new SchemaGroupNode('columns', element.table));
			}
			if (element.table.indexes.length > 0) {
				groups.push(new SchemaGroupNode('indexes', element.table));
			}
			if (element.table.foreignKeys.length > 0) {
				groups.push(new SchemaGroupNode('foreignKeys', element.table));
			}
			return groups;
		}

		if (element instanceof SchemaGroupNode) {
			if (element.group === 'columns') {
				return element.table.columns.map(column => new SchemaColumnNode(column));
			}
			if (element.group === 'indexes') {
				return element.table.indexes.map(index => new SchemaIndexNode(index));
			}
			return element.table.foreignKeys.map(foreignKey => new SchemaForeignKeyNode(foreignKey));
		}

		return [];
	}
}
