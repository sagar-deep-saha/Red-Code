/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildDeploymentSet, DEFAULT_EXCLUDES, DeploymentSet, FileChange, formatManifest, mergeChanges, parseNameStatus } from './deploySet.js';
import { commitNameStatus, CommitInfo, diffNameStatus, headCommit, listCommits, listTags, readBlob, repositoryRoot, resolveCommit, treePaths } from './git.js';
import { createZip, ZipEntry } from './zip.js';

interface CommitChoice {
	readonly revision: string;
	readonly sha: string;
	readonly short: string;
	readonly label: string;
}

interface RangeSelection {
	readonly kind: 'range';
	readonly from: CommitChoice;
	readonly to: CommitChoice;
}

interface CommitsSelection {
	readonly kind: 'commits';
	/** Oldest first. */
	readonly commits: readonly CommitChoice[];
}

type Selection = RangeSelection | CommitsSelection;

interface LoadedSet {
	readonly root: string;
	readonly selection: Selection;
	readonly label: string;
	readonly targetSha: string;
	readonly targetShort: string;
	readonly set: DeploymentSet;
}

const RANGE_KEY = 'redCode.deploy.selection';
const MAX_RANGE_COMMITS = 200;
const READ_CONCURRENCY = 4;

type DeployNode = DeployGroupNode | DeployFileNode;

class DeployGroupNode extends vscode.TreeItem {
	constructor(
		readonly group: 'upload' | 'delete' | 'excluded',
		label: string,
		readonly files: readonly DeployFileNode[]
	) {
		super(label, vscode.TreeItemCollapsibleState.Expanded);
		this.id = `redCode.deploy.${group}`;
		this.contextValue = 'redCodeDeployGroup';
		this.iconPath = new vscode.ThemeIcon(group === 'upload' ? 'cloud-upload' : group === 'delete' ? 'trash' : 'circle-slash');
		this.description = String(files.length);
	}
}

class DeployFileNode extends vscode.TreeItem {
	constructor(
		readonly root: string,
		readonly change: FileChange,
		readonly mode: 'upload' | 'delete' | 'excluded'
	) {
		super(change.path, vscode.TreeItemCollapsibleState.None);
		this.id = `redCode.deploy.${mode}.${change.path}`;
		this.contextValue = mode === 'delete' ? 'redCodeDeployDelete' : 'redCodeDeployUpload';
		this.iconPath = new vscode.ThemeIcon(statusIcon(change.status));
		this.description = mode === 'excluded'
			? vscode.l10n.t('excluded')
			: mode === 'delete'
				? vscode.l10n.t('remove')
				: change.previousPath
					? vscode.l10n.t('{0} (was {1})', statusLabel(change.status), change.previousPath)
					: statusLabel(change.status);
		this.tooltip = new vscode.MarkdownString([
			`**${change.path}**`,
			'',
			`${statusLabel(change.status)}${change.previousPath ? ` — ${vscode.l10n.t('previously {0}', change.previousPath)}` : ''}`,
			mode === 'delete' ? '' : vscode.l10n.t('_Read from the selected commit, not the working tree._')
		].filter(line => line !== '').join('\n'));

		if (mode !== 'delete') {
			this.command = { command: 'redCode.deploy.openFile', title: vscode.l10n.t('Open File'), arguments: [this] };
		}
	}
}

function statusIcon(status: FileChange['status']): string {
	switch (status) {
		case 'added': return 'diff-added';
		case 'deleted': return 'diff-removed';
		case 'renamed': return 'diff-renamed';
		case 'copied': return 'files';
		case 'type-changed': return 'symbol-file';
		default: return 'diff-modified';
	}
}

function statusLabel(status: FileChange['status']): string {
	switch (status) {
		case 'added': return vscode.l10n.t('added');
		case 'deleted': return vscode.l10n.t('deleted');
		case 'renamed': return vscode.l10n.t('renamed');
		case 'copied': return vscode.l10n.t('copied');
		case 'type-changed': return vscode.l10n.t('type changed');
		default: return vscode.l10n.t('modified');
	}
}

export class DeploySetView implements vscode.TreeDataProvider<DeployNode> {
	private readonly changeEmitter = new vscode.EventEmitter<DeployNode | undefined | null | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private readonly treeView: vscode.TreeView<DeployNode>;
	private readonly disposables: vscode.Disposable[] = [];
	private selection: Selection | undefined;
	private loaded: LoadedSet | undefined;
	private loading = false;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.treeView = vscode.window.createTreeView('redCode.deploy', {
			treeDataProvider: this,
			showCollapseAll: false
		});
		this.selection = context.workspaceState.get<Selection>(RANGE_KEY);

		this.disposables.push(
			this.treeView,
			this.changeEmitter,
			this.treeView.onDidChangeVisibility(event => {
				if (event.visible && !this.loaded && !this.loading) {
					void this.refresh();
				}
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.reset())
		);

		this.watchHead();
		void this.refresh();
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private watchHead(): void {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.git/HEAD'));
		const refresh = () => { void this.refresh(); };
		this.disposables.push(watcher, watcher.onDidChange(refresh), watcher.onDidCreate(refresh), watcher.onDidDelete(refresh));
	}

	private reset(): void {
		this.selection = undefined;
		this.loaded = undefined;
		this.loading = false;
		void this.refresh();
	}

	getChildren(element?: DeployNode): DeployNode[] {
		if (element instanceof DeployGroupNode) {
			return [...element.files];
		}
		if (element instanceof DeployFileNode || this.loading || !this.loaded) {
			return [];
		}

		const { set } = this.loaded;
		const groups: DeployNode[] = [];
		if (set.files.length > 0) {
			groups.push(new DeployGroupNode(
				'upload',
				vscode.l10n.t('Upload ({0})', set.files.length),
				set.files.map(change => new DeployFileNode(this.loaded!.root, change, 'upload'))
			));
		}
		if (set.deletions.length > 0) {
			groups.push(new DeployGroupNode(
				'delete',
				vscode.l10n.t('Delete on the server ({0})', set.deletions.length),
				set.deletions.map(change => new DeployFileNode(this.loaded!.root, change, 'delete'))
			));
		}
		if (set.excluded.length > 0) {
			groups.push(new DeployGroupNode(
				'excluded',
				vscode.l10n.t('Excluded by settings ({0})', set.excluded.length),
				set.excluded.map(change => new DeployFileNode(this.loaded!.root, { path: change, status: 'modified' }, 'excluded'))
			));
		}
		return groups;
	}

	getTreeItem(element: DeployNode): vscode.TreeItem {
		return element;
	}

	async refresh(): Promise<void> {
		if (this.loading) {
			return;
		}

		if (!vscode.workspace.isTrusted) {
			this.loaded = undefined;
			this.treeView.message = vscode.l10n.t('Unavailable in Restricted Mode. Trust this workspace to read Git history.');
			this.changeEmitter.fire();
			return;
		}

		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			this.loaded = undefined;
			this.treeView.message = vscode.l10n.t('Open a folder that belongs to a Git repository.');
			this.changeEmitter.fire();
			return;
		}

		this.loading = true;
		this.treeView.message = vscode.l10n.t('Reading Git history…');
		this.changeEmitter.fire();

		try {
			const root = await findRepositoryRoot();
			if (!root) {
				this.loaded = undefined;
				this.treeView.message = vscode.l10n.t('This folder is not inside a Git repository.');
				return;
			}

			const selection = this.selection ?? await this.defaultSelection(root);
			if (!selection) {
				this.loaded = undefined;
				this.treeView.message = vscode.l10n.t('The repository has no commits yet.');
				return;
			}
			if (selection !== this.selection) {
				this.selection = selection;
				await this.context.workspaceState.update(RANGE_KEY, selection);
			}

			const loaded = await loadSelection(root, selection);
			this.loaded = loaded;
			this.treeView.message = describeLoaded(loaded);
		} catch (error) {
			this.loaded = undefined;
			this.treeView.message = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
			this.changeEmitter.fire();
		}
	}

	async pickRange(): Promise<void> {
		const root = await findRepositoryRoot();
		if (!root) {
			void vscode.window.showInformationMessage(vscode.l10n.t('Open a Git repository first.'));
			return;
		}

		const from = await pickCommit(root, vscode.l10n.t('From commit (exclusive)'), vscode.l10n.t('Show changes made after this commit'));
		if (!from) {
			return;
		}
		const to = await pickCommit(root, vscode.l10n.t('To commit (inclusive)'), vscode.l10n.t('Show changes up to and including this commit'));
		if (!to) {
			return;
		}

		this.selection = { kind: 'range', from, to };
		await this.context.workspaceState.update(RANGE_KEY, this.selection);
		await this.refresh();
	}

	async pickCommits(): Promise<void> {
		const root = await findRepositoryRoot();
		if (!root) {
			void vscode.window.showInformationMessage(vscode.l10n.t('Open a Git repository first.'));
			return;
		}

		const commits = await listCommits(root, MAX_RANGE_COMMITS);
		const tags = await listTags(root);
		const items = buildCommitItems(commits, tags);
		const picked = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			matchOnDescription: true,
			matchOnDetail: true,
			title: vscode.l10n.t('Select commits'),
			placeHolder: vscode.l10n.t('Choose one or more commits; their changed files are combined into one set')
		});
		if (!picked || picked.length === 0) {
			return;
		}

		const choices: CommitChoice[] = [];
		for (const item of picked) {
			const choice = await resolveChoice(root, item);
			if (choice) {
				choices.push(choice);
			}
		}
		if (choices.length === 0) {
			return;
		}

		// Order the selection as it appears in the list (newest first), then
		// reverse so processing runs oldest to newest and the newest change wins.
		const positions = new Map<string, number>();
		items.forEach((item, index) => {
			if (item.revision) {
				positions.set(item.revision, index);
			}
		});
		const ordered = [...choices]
			.sort((left, right) => (positions.get(left.revision) ?? 0) - (positions.get(right.revision) ?? 0))
			.reverse();

		this.selection = { kind: 'commits', commits: ordered };
		await this.context.workspaceState.update(RANGE_KEY, this.selection);
		await this.refresh();
	}

	async exportZip(): Promise<void> {
		await this.ensureLoaded();
		const loaded = this.loaded;
		if (!loaded) {
			return;
		}
		if (loaded.set.files.length === 0) {
			void vscode.window.showInformationMessage(vscode.l10n.t('Nothing to upload for this selection.'));
			return;
		}

		const fileName = `red-code-deploy-${sanitize(loaded.label)}.zip`;
		const baseFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.tmpdir();
		const defaultUri = vscode.Uri.file(path.join(path.dirname(baseFolder), fileName));
		const target = await vscode.window.showSaveDialog({
			defaultUri,
			filters: { [vscode.l10n.t('ZIP archive')]: ['zip'] },
			saveLabel: vscode.l10n.t('Export deployment archive'),
			title: vscode.l10n.t('Export {0} files and {1} deletions', loaded.set.files.length, loaded.set.deletions.length)
		});
		if (!target) {
			return;
		}

		const failures: string[] = [];
		let totalBytes = 0;

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Exporting deployment set'),
				cancellable: true
			}, async (progress, token) => {
				const entries: ZipEntry[] = [];
				const files = loaded.set.files;
				let completed = 0;

				for (let index = 0; index < files.length; index += READ_CONCURRENCY) {
					if (token.isCancellationRequested) {
						throw new vscode.CancellationError();
					}
					const batch = files.slice(index, index + READ_CONCURRENCY);
					const results = await Promise.all(batch.map(async file => {
						try {
							return { file, data: await readBlob(loaded.root, loaded.targetSha, file.path) };
						} catch {
							failures.push(file.path);
							return undefined;
						}
					}));

					for (const result of results) {
						if (!result) {
							continue;
						}
						totalBytes += result.data.length;
						entries.push({ path: result.file.path, data: result.data, modified: new Date() });
					}

					completed += batch.length;
					progress.report({
						increment: (batch.length / files.length) * 100,
						message: vscode.l10n.t('{0} of {1} files', completed, files.length)
					});
				}

				const manifest = formatManifest(loaded.set, {
					selection: loaded.label,
					target: loaded.targetShort,
					generatedAt: new Date().toISOString()
				});
				entries.push({ path: 'RED-CODE-DEPLOY.txt', data: Buffer.from(manifest, 'utf8') });

				const archive = createZip(entries);
				await vscode.workspace.fs.writeFile(target, archive);
			});
		} catch (error) {
			if (!(error instanceof vscode.CancellationError)) {
				void vscode.window.showErrorMessage(vscode.l10n.t('Could not export the deployment archive: {0}', error instanceof Error ? error.message : String(error)));
			}
			return;
		}

		const size = formatBytes(totalBytes);
		const notes = [vscode.l10n.t('{0} files ({1}) and {2} deletions', loaded.set.files.length, size, loaded.set.deletions.length)];
		if (failures.length > 0) {
			notes.push(vscode.l10n.t('{0} files could not be read', failures.length));
		}

		const action = await vscode.window.showInformationMessage(
			vscode.l10n.t('Exported deployment archive: {0}.', notes.join(', ')),
			vscode.l10n.t('Reveal Archive'),
			vscode.l10n.t('Copy File Paths')
		);
		if (action === vscode.l10n.t('Reveal Archive')) {
			await vscode.commands.executeCommand('revealFileInOS', target);
		} else if (action === vscode.l10n.t('Copy File Paths')) {
			await this.copyPaths();
		}
	}

	async copyPaths(): Promise<void> {
		await this.ensureLoaded();
		const files = this.loaded?.set.files ?? [];
		if (files.length === 0) {
			void vscode.window.showInformationMessage(vscode.l10n.t('There are no files to copy for this selection.'));
			return;
		}
		await vscode.env.clipboard.writeText(files.map(file => file.path).join('\n'));
		void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied {0} file paths.', files.length), 3000);
	}

	async copyDeletions(): Promise<void> {
		await this.ensureLoaded();
		const deletions = this.loaded?.set.deletions ?? [];
		if (deletions.length === 0) {
			void vscode.window.showInformationMessage(vscode.l10n.t('No files have to be deleted for this selection.'));
			return;
		}
		await vscode.env.clipboard.writeText(deletions.map(file => file.path).join('\n'));
		void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied {0} paths to delete.', deletions.length), 3000);
	}

	async copySinglePath(node?: DeployFileNode): Promise<void> {
		if (!node) {
			return;
		}
		await vscode.env.clipboard.writeText(node.change.path);
	}

	async openFile(node?: DeployFileNode): Promise<void> {
		if (!(node instanceof DeployFileNode) || node.mode === 'delete') {
			return;
		}
		const uri = vscode.Uri.file(path.join(node.root, node.change.path));
		try {
			await vscode.window.showTextDocument(uri, { preview: true });
		} catch {
			void vscode.window.showInformationMessage(vscode.l10n.t('{0} is not in the working tree. It exists in {1}.', node.change.path, this.loaded?.targetShort ?? vscode.l10n.t('the selected commit')));
		}
	}

	private async ensureLoaded(): Promise<void> {
		if (!this.loaded && !this.loading) {
			await this.refresh();
		}
	}

	private async defaultSelection(root: string): Promise<Selection | undefined> {
		const head = await headCommit(root);
		if (!head) {
			return undefined;
		}
		const parent = await resolveCommit(root, 'HEAD~1');
		const to: CommitChoice = { revision: 'HEAD', sha: head, short: head.slice(0, 7), label: 'HEAD' };
		if (!parent) {
			return { kind: 'range', from: to, to };
		}
		return {
			kind: 'range',
			from: { revision: 'HEAD~1', sha: parent, short: parent.slice(0, 7), label: 'HEAD~1' },
			to
		};
	}
}

function describeLoaded(loaded: LoadedSet): string {
	const files = loaded.set.files.length;
	const deletions = loaded.set.deletions.length;
	if (files === 0 && deletions === 0) {
		return vscode.l10n.t('No changes in {0}.', loaded.label);
	}
	return vscode.l10n.t('{0} files to upload, {1} to delete · {2}', files, deletions, loaded.label);
}

async function findRepositoryRoot(): Promise<string | undefined> {
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const root = await repositoryRoot(folder.uri.fsPath);
		if (root) {
			return path.resolve(root);
		}
	}
	return undefined;
}

function sanitize(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'selection';
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadSelection(root: string, selection: Selection): Promise<LoadedSet> {
	if (selection.kind === 'range') {
		const { from, to } = selection;
		const changes = parseNameStatus(await diffNameStatus(root, from.sha, to.sha));
		const [sourceTree, targetTree] = await Promise.all([
			treePaths(root, from.sha),
			treePaths(root, to.sha)
		]);
		const set = buildDeploymentSet(changes, excludePatterns(), sourceTree, targetTree);
		return {
			root,
			selection,
			label: `${from.short}..${to.short}`,
			targetSha: to.sha,
			targetShort: to.short,
			set
		};
	}

	const commits = [...selection.commits];
	const groups: FileChange[][] = [];
	for (const commit of commits) {
		groups.push(parseNameStatus(await commitNameStatus(root, commit.sha)));
	}

	const newest = commits[commits.length - 1];
	const oldest = commits[0];
	const targetTree = await treePaths(root, newest.sha);
	const parentOfOldest = await resolveCommit(root, `${oldest.sha}^`);
	const sourceTree = parentOfOldest ? await treePaths(root, parentOfOldest) : undefined;
	const set = buildDeploymentSet(mergeChanges(...groups), excludePatterns(), sourceTree, targetTree);

	return {
		root,
		selection,
		label: `${oldest.short}..${newest.short} (${commits.length} selected)`,
		targetSha: newest.sha,
		targetShort: newest.short,
		set
	};
}

function excludePatterns(): string[] {
	const configured = vscode.workspace.getConfiguration('redCode.deploy').get<string[]>('excludePaths', [...DEFAULT_EXCLUDES]);
	return configured.map(pattern => pattern.trim()).filter(pattern => pattern.length > 0);
}

interface CommitQuickPickItem extends vscode.QuickPickItem {
	readonly revision?: string;
	readonly manual?: boolean;
}

function buildCommitItems(commits: readonly CommitInfo[], tags: readonly { name: string }[]): CommitQuickPickItem[] {
	const items: CommitQuickPickItem[] = [
		{ label: `$(edit) ${vscode.l10n.t('Enter a commit hash…')}`, description: vscode.l10n.t('any revision or SHA'), manual: true },
		{ label: '$(git-commit) HEAD', description: vscode.l10n.t('latest commit'), revision: 'HEAD' }
	];

	for (const tag of tags) {
		items.push({ label: `$(tag) ${tag.name}`, description: vscode.l10n.t('tag'), revision: tag.name });
	}
	for (const commit of commits) {
		items.push({
			label: `$(git-commit) ${commit.short}  ${commit.subject}`.trimEnd(),
			description: commit.date,
			detail: commit.sha,
			revision: commit.sha
		});
	}
	return items;
}

async function resolveChoice(root: string, item: CommitQuickPickItem): Promise<CommitChoice | undefined> {
	let revision = item.revision;
	if (item.manual) {
		revision = await vscode.window.showInputBox({
			title: vscode.l10n.t('Commit'),
			prompt: vscode.l10n.t('A commit hash, tag, branch or relative revision such as HEAD~3'),
			validateInput: async value => (await resolveCommit(root, value.trim())) ? undefined : vscode.l10n.t('That revision does not exist.')
		});
		if (!revision) {
			return undefined;
		}
		revision = revision.trim();
	}
	if (!revision) {
		return undefined;
	}

	const sha = await resolveCommit(root, revision);
	if (!sha) {
		void vscode.window.showErrorMessage(vscode.l10n.t('{0} is not a commit in this repository.', revision));
		return undefined;
	}
	return { revision, sha, short: sha.slice(0, 7), label: revision };
}

async function pickCommit(root: string, title: string, placeHolder: string): Promise<CommitChoice | undefined> {
	const [commits, tags] = await Promise.all([listCommits(root, MAX_RANGE_COMMITS), listTags(root)]);
	const items = buildCommitItems(commits, tags);
	const picked = await vscode.window.showQuickPick(items, {
		title,
		placeHolder,
		matchOnDescription: true,
		matchOnDetail: true
	});
	return picked ? resolveChoice(root, picked) : undefined;
}

export function registerDeployCommands(context: vscode.ExtensionContext, view: DeploySetView): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('redCode.deploy.pickRange', () => view.pickRange()),
		vscode.commands.registerCommand('redCode.deploy.pickCommits', () => view.pickCommits()),
		vscode.commands.registerCommand('redCode.deploy.refresh', () => view.refresh()),
		vscode.commands.registerCommand('redCode.deploy.exportZip', () => view.exportZip()),
		vscode.commands.registerCommand('redCode.deploy.copyPaths', () => view.copyPaths()),
		vscode.commands.registerCommand('redCode.deploy.copyDeletions', () => view.copyDeletions()),
		vscode.commands.registerCommand('redCode.deploy.copyPath', (node?: DeployFileNode) => view.copySinglePath(node)),
		vscode.commands.registerCommand('redCode.deploy.openFile', (node?: DeployFileNode) => view.openFile(node)),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('redCode.deploy')) {
				void view.refresh();
			}
		})
	);
}
