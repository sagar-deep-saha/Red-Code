/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { filterByLevel, LogEntry, LOG_LEVELS, LogFile, LogTail, parseLogWindow, pickNewestLog, UNKNOWN_LEVEL } from '../index/logModel.js';
import { LaravelProject } from '../project.js';

/** A busy log cannot flood the tree: only the newest entries are shown. */
export const MAX_LOG_ROWS = 500;

export const DEFAULT_LOG_LEVELS: ReadonlySet<string> = new Set<string>([...LOG_LEVELS, UNKNOWN_LEVEL]);

export interface LogsViewDeps {
	project(): LaravelProject | undefined;
	logPattern(): string;
	tailBytes(): number;
	list(): Promise<readonly LogFile[]>;
	read(relativePath: string, maxBytes: number): Promise<LogTail | undefined>;
}

export interface LogsViewState {
	readonly message: string | undefined;
	readonly fileName: string | undefined;
	readonly count: number;
}

interface LogSnapshot {
	readonly entries: readonly LogEntry[];
	readonly fileName: string | undefined;
	readonly message: string | undefined;
}

function levelIcon(level: string): vscode.ThemeIcon {
	switch (level) {
		case 'EMERGENCY':
		case 'ALERT':
		case 'CRITICAL':
		case 'ERROR':
			return new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground'));
		case 'WARNING':
			return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
		case 'NOTICE':
		case 'INFO':
			return new vscode.ThemeIcon('info', new vscode.ThemeColor('problemsInfoIcon.foreground'));
		case 'DEBUG':
			return new vscode.ThemeIcon('debug-alt');
		default:
			return new vscode.ThemeIcon('question');
	}
}

export class LogEntryNode extends vscode.TreeItem {
	readonly kind = 'logEntry';

	constructor(readonly entry: LogEntry, readonly fileName: string) {
		super(entry.message || vscode.l10n.t('(no message)'), vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'logEntry';
		this.description = [entry.timestamp, entry.level].filter(Boolean).join(' · ');
		this.iconPath = levelIcon(entry.level);
		this.tooltip = [this.description, entry.message].filter(Boolean).join('\n');
		this.command = {
			command: 'redCode.laravel.logs.openEntry',
			title: vscode.l10n.t('Open Log Entry'),
			arguments: [{ fileName, entry }]
		};
	}
}

function formatWindow(bytes: number): string {
	const megabytes = Math.round((bytes / (1024 * 1024)) * 10) / 10;
	return `${megabytes} MB`;
}

/**
 * Renders the tail of the newest Laravel log. Only the configured byte window
 * is ever read, so the view stays responsive on a huge log; a level filter and
 * a row cap keep the tree itself small.
 */
export class LogsTreeProvider implements vscode.TreeDataProvider<LogEntryNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private snapshot: LogSnapshot | undefined;
	private levels: ReadonlySet<string> = DEFAULT_LOG_LEVELS;

	constructor(private readonly deps: LogsViewDeps) { }

	refresh(): void {
		this.snapshot = undefined;
		this.changeEmitter.fire();
	}

	setLevels(levels: ReadonlySet<string>): void {
		this.levels = levels;
		this.changeEmitter.fire();
	}

	levelsSelected(): ReadonlySet<string> {
		return this.levels;
	}

	/** Newest entries first, filtered by level and capped at {@link MAX_LOG_ROWS}. */
	visibleEntries(entries: readonly LogEntry[]): LogEntry[] {
		return filterByLevel(entries, this.levels).slice(-MAX_LOG_ROWS).reverse();
	}

	getTreeItem(element: LogEntryNode): vscode.TreeItem {
		return element;
	}

	async getChildren(): Promise<LogEntryNode[]> {
		const snapshot = await this.load();
		return this.visibleEntries(snapshot.entries).map(entry => new LogEntryNode(entry, snapshot.fileName ?? ''));
	}

	async state(): Promise<LogsViewState> {
		const snapshot = await this.load();
		return {
			message: snapshot.message,
			fileName: snapshot.fileName,
			count: this.visibleEntries(snapshot.entries).length
		};
	}

	private async load(): Promise<LogSnapshot> {
		if (this.snapshot) {
			return this.snapshot;
		}

		const project = this.deps.project();
		if (!project) {
			this.snapshot = { entries: [], fileName: undefined, message: vscode.l10n.t('No Laravel project detected in this workspace.') };
			return this.snapshot;
		}

		const newest = pickNewestLog(await this.deps.list());
		if (!newest) {
			this.snapshot = {
				entries: [],
				fileName: undefined,
				message: vscode.l10n.t('No log files matched {0}.', this.deps.logPattern())
			};
			return this.snapshot;
		}

		const tail = await this.deps.read(newest.path, this.deps.tailBytes());
		if (!tail) {
			this.snapshot = {
				entries: [],
				fileName: newest.path,
				message: vscode.l10n.t('{0} could not be read.', newest.path)
			};
			return this.snapshot;
		}

		const { entries } = parseLogWindow(tail.text, tail.sliced);
		this.snapshot = {
			entries,
			fileName: newest.path,
			message: entries.length === 0
				? vscode.l10n.t('No log entries found in the last {0}.', formatWindow(this.deps.tailBytes()))
				: undefined
		};
		return this.snapshot;
	}
}
