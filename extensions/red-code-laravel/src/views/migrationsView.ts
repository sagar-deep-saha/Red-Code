/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { MigrationEffect, MigrationEffectKind, MigrationTimelineEntry } from '../index/migrations.js';
import { LaravelViewContext } from './context.js';
import { commandFor } from './routesView.js';

const EFFECT_LABELS: Record<MigrationEffectKind, string> = {
	created: 'created',
	altered: 'altered',
	dropped: 'dropped'
};

const EFFECT_ICONS: Record<MigrationEffectKind, string> = {
	created: 'add',
	altered: 'edit',
	dropped: 'trash'
};

export class MigrationNode extends vscode.TreeItem {
	readonly kind = 'migration';

	constructor(readonly entry: MigrationTimelineEntry, context: LaravelViewContext) {
		super(entry.name, entry.effects.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		this.description = entry.timestamp;
		this.contextValue = 'laravelMigration';
		this.iconPath = new vscode.ThemeIcon('history');
		this.command = commandFor({ file: entry.file, line: 1 }, context);

		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**${entry.name}**\n\n`);
		tooltip.appendMarkdown(`File: \`${entry.file}\`\n\n`);
		if (entry.timestamp) {
			tooltip.appendMarkdown(`Timestamp: \`${entry.timestamp}\`\n\n`);
		}
		tooltip.appendMarkdown(
			entry.effects.length > 0
				? entry.effects.map(effect => `- \`${effect.table}\` ${EFFECT_LABELS[effect.effect]}`).join('\n')
				: vscode.l10n.t('No table changes detected.')
		);
		this.tooltip = tooltip;
	}
}

export class MigrationEffectNode extends vscode.TreeItem {
	readonly kind = 'migrationEffect';

	constructor(readonly effect: MigrationEffect, context: LaravelViewContext) {
		super(effect.table, vscode.TreeItemCollapsibleState.None);
		this.description = EFFECT_LABELS[effect.effect];
		this.contextValue = 'migrationTable';
		this.iconPath = new vscode.ThemeIcon(EFFECT_ICONS[effect.effect]);

		// Jump to wherever the table is defined when the schema knows it.
		const table = context.schema()?.tables.find(candidate => candidate.name === effect.table);
		const location = effect.effect === 'created'
			? table?.createdIn ?? table?.lastChangedIn
			: table?.lastChangedIn ?? table?.createdIn;
		if (location) {
			this.command = commandFor(location, context);
		}
	}
}

export type MigrationsNode = MigrationNode | MigrationEffectNode;

/**
 * Renders the migrations in execution (file name) order with the tables each
 * one creates, alters or drops. The timeline comes from migration file names
 * and declarations, so it needs no database connection and works in Restricted
 * Mode. Applied/pending state requires a database and is not shown here.
 */
export class MigrationsTreeProvider implements vscode.TreeDataProvider<MigrationsNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly context: LaravelViewContext) { }

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: MigrationsNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: MigrationsNode): Promise<MigrationsNode[]> {
		if (!element) {
			await this.context.ensureIndex();
			const timeline = this.context.schema()?.timeline ?? [];
			return timeline.map(entry => new MigrationNode(entry, this.context));
		}

		if (element instanceof MigrationNode) {
			return element.entry.effects.map(effect => new MigrationEffectNode(effect, this.context));
		}

		return [];
	}
}
