/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import * as vscode from 'vscode';
import { gravatarUrl } from './avatars.js';
import {
	EMPTY_REVISION,
	showAllChanges,
	showAllChangesWithWorking,
	showFileAtRevision,
	showFileChanges,
	showFileChangesWithWorking,
	showWorkingTreeChanges
} from './contentProvider.js';
import {
	Branches,
	commitDetails,
	commitFiles,
	commitStats,
	GitError,
	headCommits,
	listBranches,
	listRemotes,
	logCommits,
	LogOptions,
	LogScope,
	statusSummary
} from './git.js';
import { computeGraph, GraphRow, graphWidth, isMerge, refLabel } from './graph.js';
import { CommitDetails, CommitStats, FileChange, formatRelativeDate, WorkingFile } from './log.js';
import { createMatcher, SearchOptions } from './search.js';
import { renderGraphHtml } from './graphHtml.js';

export interface GraphPanelDeps {
	/** Resolved repository root, or `undefined` when the workspace has no git repository. */
	root(): string | undefined;
	pageSize(): number;
	avatarLookupEnabled(): boolean;
	/** Called after a panel action changed the working tree state. */
	onRepositoryChanged?(): void;
}

interface GraphMessage {
	type: string;
	sha?: string;
	path?: string;
	text?: string;
	label?: string;
	status?: string;
	scope?: LogScope;
	rev?: string;
	query?: string;
	options?: SearchOptions;
}

interface SerializedRef {
	text: string;
	kind: string;
}

interface SerializedRow {
	sha: string;
	short: string;
	subject: string;
	author: string;
	email: string;
	date: string;
	relative: string;
	committer: string;
	committerEmail: string;
	committerRelative: string;
	avatarUrl: string | undefined;
	refs: SerializedRef[];
	lane: number;
	before: (string | null)[];
	after: (string | null)[];
	merge: boolean;
	dim: boolean;
	stats: CommitStats;
}

function nonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let index = 0; index < 32; index++) {
		value += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return value;
}

function emptyStats(): CommitStats {
	return { files: 0, additions: 0, deletions: 0 };
}

export class GraphPanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	private limit = 300;
	private rows: GraphRow[] = [];
	private visible: GraphRow[] = [];
	private stats = new Map<string, CommitStats>();
	private working: WorkingFile[] = [];
	private branches: Branches = { current: '', local: [], remote: [], tags: [] };
	private remotes: string[] = [];
	private headSet = new Set<string>();
	private repoLabel = '';
	private branch = '';
	private dirtyFiles = 0;
	private hasMore = false;
	private scope: LogScope = 'all';
	private rev: string | undefined;
	private query = '';
	private searchOptions: SearchOptions = {};
	private selected: { details: CommitDetails; files: FileChange[] } | undefined;

	constructor(private readonly deps: GraphPanelDeps) { }

	dispose(): void {
		this.panel?.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	get isOpen(): boolean {
		return this.panel !== undefined;
	}

	async open(): Promise<void> {
		const root = this.deps.root();
		if (!root) {
			void vscode.window.showInformationMessage('Red Code Git: open a folder inside a git repository first.');
			return;
		}

		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel('redCode.git.graph', 'Commit Graph', vscode.ViewColumn.Active, {
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: []
			});
			this.panel.webview.html = renderGraphHtml(this.panel.webview, nonce());
			this.panel.onDidDispose(() => {
				this.panel = undefined;
			}, undefined, this.disposables);
			this.panel.webview.onDidReceiveMessage(message => void this.onMessage(message as GraphMessage), undefined, this.disposables);
		} else {
			this.panel.reveal(vscode.ViewColumn.Active);
		}

		this.limit = this.deps.pageSize();
		await this.reload();
	}

	async refresh(): Promise<void> {
		if (!this.panel) {
			return;
		}
		await this.reload();
	}

	private logOptions(): LogOptions {
		return { limit: this.limit, scope: this.scope, rev: this.rev };
	}

	private async reload(): Promise<void> {
		const root = this.deps.root();
		if (!root || !this.panel) {
			return;
		}

		const options = this.logOptions();
		try {
			const headPromise = this.scope === 'all' && !this.rev
				? headCommits(root, this.limit)
				: Promise.resolve(new Set<string>());
			const [status, commits, stats, branches, remotes, headSet] = await Promise.all([
				statusSummary(root),
				logCommits(root, options),
				commitStats(root, options),
				listBranches(root),
				listRemotes(root),
				headPromise
			]);

			this.branch = status.branch;
			this.repoLabel = path.basename(root);
			this.rows = computeGraph(commits);
			this.stats = stats;
			this.branches = branches;
			this.remotes = remotes;
			this.working = status.files;
			this.dirtyFiles = status.dirtyFiles;
			this.headSet = headSet;
			this.hasMore = commits.length >= this.limit;
			this.panel.title = `Commit Graph: ${this.repoLabel}`;

			if (this.selected && !commits.some(commit => commit.sha === this.selected?.details.sha)) {
				this.selected = undefined;
			}

			this.visible = this.filterRows();
			await this.postCommits();
		} catch (error) {
			await this.fail(error);
		}
	}

	private filterRows(): GraphRow[] {
		if (this.query.trim().length === 0) {
			return this.rows;
		}
		const matcher = createMatcher(this.query, this.searchOptions);
		return this.rows.filter(row => matcher(row.commit));
	}

	private adapt(row: GraphRow): SerializedRow {
		const commit = row.commit;
		const stats = this.stats.get(commit.sha) ?? emptyStats();
		const isHead = commit.refs.some(ref => refLabel(ref, this.remotes).kind === 'head');
		return {
			sha: commit.sha,
			short: commit.short,
			subject: commit.subject,
			author: commit.author,
			email: commit.email,
			date: commit.date,
			relative: formatRelativeDate(commit.date),
			committer: commit.committer,
			committerEmail: commit.committerEmail,
			committerRelative: formatRelativeDate(commit.committerDate),
			avatarUrl: gravatarUrl(commit.email, this.deps.avatarLookupEnabled()),
			refs: commit.refs.map(ref => {
				const label = refLabel(ref, this.remotes);
				return { text: label.name, kind: label.kind };
			}),
			lane: row.lane,
			before: row.before,
			after: row.after,
			merge: isMerge(commit),
			dim: this.headSet.size > 0 && !this.headSet.has(commit.sha) && !isHead,
			stats
		};
	}

	private async postCommits(): Promise<void> {
		await this.post({
			type: 'commits',
			rows: this.visible.map(row => this.adapt(row)),
			lanes: graphWidth(this.rows),
			hasMore: this.hasMore,
			repoLabel: this.repoLabel,
			branch: this.branch,
			dirtyFiles: this.dirtyFiles,
			working: this.working,
			branches: this.branches,
			scope: this.scope,
			rev: this.rev ?? '',
			query: this.query,
			matchCount: this.visible.length
		});
	}

	private async postFiltered(): Promise<void> {
		this.visible = this.filterRows();
		await this.post({
			type: 'filtered',
			rows: this.visible.map(row => this.adapt(row)),
			matchCount: this.visible.length,
			query: this.query,
			hasMore: this.hasMore
		});
	}

	private async detailsFor(root: string, sha: string): Promise<{ details: CommitDetails; files: FileChange[] } | undefined> {
		if (this.selected?.details.sha === sha) {
			return this.selected;
		}
		const [details, files] = await Promise.all([commitDetails(root, sha), commitFiles(root, sha)]);
		if (!details) {
			return undefined;
		}
		const entry = { details, files };
		this.selected = entry;
		return entry;
	}

	private async onMessage(message: GraphMessage): Promise<void> {
		const root = this.deps.root();
		if (!root) {
			return;
		}

		try {
			switch (message.type) {
				case 'ready':
				case 'refresh':
					await this.reload();
					return;
				case 'loadMore':
					if (!this.hasMore) {
						return;
					}
					this.limit += this.deps.pageSize();
					await this.reload();
					return;
				case 'search':
					this.query = message.query ?? '';
					this.searchOptions = message.options ?? {};
					await this.postFiltered();
					return;
				case 'setScope':
					this.scope = message.scope ?? 'all';
					this.rev = undefined;
					await this.reload();
					return;
				case 'setRev':
					this.rev = message.rev || undefined;
					await this.reload();
					return;
				case 'selectCommit':
					if (message.sha) {
						await this.selectCommit(root, message.sha);
					}
					return;
				case 'openAllChanges':
					if (message.sha) {
						await this.openAllChanges(root, message.sha);
					}
					return;
				case 'compareWithWorking':
					if (message.sha) {
						await this.compareWithWorking(root, message.sha);
					}
					return;
				case 'openFile':
					if (message.sha && message.path) {
						await showFileAtRevision(root, message.sha, message.path, message.path);
					}
					return;
				case 'openFileChanges':
					if (message.sha && message.path) {
						await this.openFileChanges(root, message.sha, message.path);
					}
					return;
				case 'copy':
					if (message.text) {
						await vscode.env.clipboard.writeText(message.text);
						await this.post({ type: 'toast', message: message.label ?? 'Copied to the clipboard' });
					}
					return;
				case 'openWorkingFile':
					if (message.path) {
						await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, message.path)), { preview: true });
					}
					return;
				case 'openWorkingFileChanges':
					if (message.path) {
						const untracked = this.working.find(file => file.path === message.path)?.status.includes('?') ?? false;
						await showFileChangesWithWorking(
							root,
							message.path,
							untracked ? EMPTY_REVISION : 'HEAD',
							`${path.basename(message.path)} (Working Tree)`
						);
					}
					return;
				case 'openWorkingChanges':
					await showWorkingTreeChanges(
						root,
						'Working Changes',
						this.working.map(file => ({ path: file.path, untracked: file.status.includes('?') }))
					);
					return;
			}
		} catch (error) {
			await this.fail(error);
		}
	}

	private async selectCommit(root: string, sha: string): Promise<void> {
		const entry = await this.detailsFor(root, sha);
		if (!entry) {
			return;
		}
		const { details, files } = entry;
		const stats = this.stats.get(sha) ?? files.reduce<CommitStats>((total, file) => ({
			files: total.files + 1,
			additions: total.additions + file.additions,
			deletions: total.deletions + file.deletions
		}), emptyStats());
		await this.post({
			type: 'commit',
			details,
			files,
			stats,
			authorAvatar: gravatarUrl(details.email, this.deps.avatarLookupEnabled()),
			committerAvatar: gravatarUrl(details.committerEmail, this.deps.avatarLookupEnabled())
		});
	}

	private async openAllChanges(root: string, sha: string): Promise<void> {
		const entry = await this.detailsFor(root, sha);
		if (!entry) {
			return;
		}
		const parent = entry.details.parents.length > 0 ? entry.details.parents[0] : EMPTY_REVISION;
		await showAllChanges(
			root,
			parent,
			sha,
			`Changes in ${entry.details.short}`,
			entry.files.map(file => file.path)
		);
	}

	private async compareWithWorking(root: string, sha: string): Promise<void> {
		const entry = await this.detailsFor(root, sha);
		if (!entry) {
			return;
		}
		await showAllChangesWithWorking(
			root,
			sha,
			`${entry.details.short} vs Working Tree`,
			entry.files.map(file => file.path)
		);
	}

	private async openFileChanges(root: string, sha: string, file: string): Promise<void> {
		const entry = await this.detailsFor(root, sha);
		if (!entry) {
			return;
		}
		const parent = entry.details.parents.length > 0 ? entry.details.parents[0] : EMPTY_REVISION;
		await showFileChanges(root, file, parent, sha, `${path.basename(file)} (${entry.details.short})`);
	}

	private async fail(error: unknown): Promise<void> {
		const message = error instanceof GitError || error instanceof Error ? error.message : String(error);
		await this.post({ type: 'error', message });
	}

	private post(payload: unknown): Thenable<boolean> {
		return this.panel ? this.panel.webview.postMessage(payload) : Promise.resolve(false);
	}
}
