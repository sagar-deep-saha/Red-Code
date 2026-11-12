/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ArtisanRunner } from './artisan.js';
import { ArtisanDeps, runNamedArtisanCommand, showArtisanPalette } from './artisanCommands.js';
import { ArtisanCatalog, parseArtisanList } from './index/commands.js';
import { appendMissingKeys } from './index/envModel.js';
import { LaravelGraph, SourceLocation } from './index/graph.js';
import { LaravelIndex } from './index/laravelIndex.js';
import { LOG_LEVELS, LogEntry, UNKNOWN_LEVEL } from './index/logModel.js';
import { buildCurlCommand, displayUri, requestMethod, RouteEntry, toConcreteUri } from './index/routes.js';
import { readWorkspaceFile } from './index/scan.js';
import { LOG_SCHEME, LogDocumentProvider } from './logDocument.js';
import { listLogFiles, readLogTail } from './logFiles.js';
import { openLocation, registerLocationCommand } from './locations.js';
import { registerNavigation } from './navigation.js';
import { detectLaravelProject, LaravelProject, resolvePhpPath } from './project.js';
import { parseAboutJson } from './projectModel.js';
import { ArtisanTreeProvider } from './views/artisanView.js';
import { LaravelViewContext } from './views/context.js';
import { EnvTreeProvider, EnvViewDeps } from './views/envView.js';
import { DEFAULT_LOG_LEVELS, LogsTreeProvider, LogsViewDeps } from './views/logsView.js';
import { ModelsTreeProvider } from './views/modelsView.js';
import { ProjectExplorerProvider } from './views/projectExplorer.js';
import { RoutesTreeProvider } from './views/routesView.js';
import { SchemaTreeProvider } from './views/schemaView.js';

const REFRESH_DEBOUNCE_MS = 2500;

/** Default log source; newest file by mtime wins. */
const LOG_PATTERN = 'storage/logs/*.log';
const LOG_TAIL_DEBOUNCE_MS = 300;

export function activate(context: vscode.ExtensionContext): void {
	const channel = vscode.window.createOutputChannel('Red Code Laravel');
	const runner = new ArtisanRunner(channel);
	const index = new LaravelIndex(runner, channel);

	let project: LaravelProject | undefined;
	let catalogCache: ArtisanCatalog | undefined;
	let detecting: Promise<LaravelProject | undefined> | undefined;
	let indexWarningShown = false;
	let refreshTimer: NodeJS.Timeout | undefined;

	async function resolveProject(force = false): Promise<LaravelProject | undefined> {
		if (!force && project) {
			return project;
		}
		if (detecting) {
			return detecting;
		}

		detecting = (async () => {
			const folders = orderedWorkspaceFolders();
			for (const folder of folders) {
				const detected = await detectLaravelProject(folder);
				if (detected) {
					project = detected;
					return detected;
				}
			}
			project = undefined;
			return undefined;
		})();

		try {
			return await detecting;
		} finally {
			detecting = undefined;
		}
	}

	function orderedWorkspaceFolders(): vscode.WorkspaceFolder[] {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const activePath = vscode.window.activeTextEditor?.document.uri.fsPath.replace(/\\/g, '/');
		if (!activePath) {
			return [...folders];
		}
		const containing = folders.find(folder => activePath.startsWith(`${folder.uri.fsPath.replace(/\\/g, '/')}/`));
		return containing ? [containing, ...folders.filter(folder => folder !== containing)] : [...folders];
	}

	async function loadCatalog(force = false): Promise<ArtisanCatalog | undefined> {
		if (!vscode.workspace.isTrusted) {
			return undefined;
		}
		const current = await resolveProject();
		if (!current) {
			return undefined;
		}
		if (catalogCache && !force) {
			return catalogCache;
		}
		try {
			const result = await runner.run(current, ['list', '--format=json'], { timeoutMs: 30_000 });
			if (result.code !== 0) {
				return undefined;
			}
			catalogCache = parseArtisanList(result.stdout);
			return catalogCache;
		} catch (error) {
			channel.appendLine(String(error));
			return undefined;
		}
	}

	async function ensureIndex(force = false): Promise<LaravelGraph | undefined> {
		const current = await resolveProject();
		if (!current) {
			updateViewState();
			return undefined;
		}
		if (!force && index.snapshot) {
			return index.snapshot.graph;
		}

		const maxFiles = vscode.workspace.getConfiguration('redCode.laravel').get<number>('index.maxFiles', 20_000);		try {
			const snapshot = await index.refresh(current, { maxFiles });
			return snapshot?.graph;
		} catch (error) {
			channel.appendLine(String(error));
			if (!indexWarningShown) {
				indexWarningShown = true;
				void vscode.window.showWarningMessage(
					vscode.l10n.t('The Laravel index could not be built. Set redCode.laravel.phpPath to php.exe and try again.'),
					vscode.l10n.t('Show Output')
				).then(action => { if (action) { channel.show(true); } });
			}
			updateViewState();
			return undefined;
		}
	}

	const viewContext: LaravelViewContext = {
		graph: () => index.graph,
		models: () => index.models,
		schema: () => index.schema,
		project: () => project,
		ensureIndex: () => ensureIndex(),
		refreshIndex: async () => {
			project = undefined;
			catalogCache = undefined;
			await resolveProject(true);
			await ensureIndex(true);
			artisanProvider.refresh();
		},
		appUrl: () => index.appUrl,
		openLocation: async (location: SourceLocation) => {
			const current = await resolveProject();
			if (current) {
				await openLocation(location, current.root);
			}
		},
		copy: async (value: string, message: string) => {
			await vscode.env.clipboard.writeText(value);
			void vscode.window.setStatusBarMessage(message, 3000);
		},
		showVendorRoutes: () => vscode.workspace.getConfiguration('redCode.laravel').get<boolean>('routes.showVendor', false)
	};

	const routesProvider = new RoutesTreeProvider(viewContext);
	const routesView = vscode.window.createTreeView('redCode.laravel.routes', {
		treeDataProvider: routesProvider,
		showCollapseAll: true
	});

	const explorerProvider = new ProjectExplorerProvider(viewContext);
	const explorerView = vscode.window.createTreeView('redCode.laravel.project', {
		treeDataProvider: explorerProvider,
		showCollapseAll: true
	});

	const modelsProvider = new ModelsTreeProvider(viewContext);
	const modelsView = vscode.window.createTreeView('redCode.laravel.models', {
		treeDataProvider: modelsProvider,
		showCollapseAll: true
	});

	const schemaProvider = new SchemaTreeProvider(viewContext);
	const schemaView = vscode.window.createTreeView('redCode.laravel.schema', {
		treeDataProvider: schemaProvider,
		showCollapseAll: true
	});

	function envFileName(): string {
		const configured = vscode.workspace.getConfiguration('redCode.laravel').get<string>('envFile', '.env').trim();
		return configured || '.env';
	}

	const envDeps: EnvViewDeps = {
		project: () => project,
		envFileName,
		read: async relativePath => {
			const current = await resolveProject();
			return current ? readWorkspaceFile(current.root, relativePath) : undefined;
		}
	};

	const envProvider = new EnvTreeProvider(envDeps);
	const envView = vscode.window.createTreeView('redCode.laravel.env', {
		treeDataProvider: envProvider
	});

	async function refreshEnvView(): Promise<void> {
		envProvider.refresh();
		envView.message = await envProvider.message();
	}

	async function addMissingEnvKeys(): Promise<void> {
		const current = await resolveProject();
		if (!current) {
			void vscode.window.showWarningMessage(vscode.l10n.t('Open a Laravel project folder to inspect it.'));
			return;
		}

		const file = envFileName();
		const keys = await envProvider.missingKeys();
		if (keys.length === 0) {
			void vscode.window.showInformationMessage(
				vscode.l10n.t('{0} already declares every key from {1}.', file, `${file}.example`)
			);
			return;
		}

		const confirmed = await vscode.window.showWarningMessage(
			vscode.l10n.t('Add {0} missing keys to {1}?', String(keys.length), file),
			{ modal: true, detail: keys.join('\n') },
			vscode.l10n.t('Add Keys')
		);
		if (!confirmed) {
			return;
		}

		const uri = vscode.Uri.joinPath(current.root, file);
		let existing = '';
		try {
			existing = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
		} catch {
			existing = '';
		}
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(appendMissingKeys(existing, keys)));
		channel.appendLine(vscode.l10n.t('Added {0} empty keys to {1}.', String(keys.length), file));
		await refreshEnvView();
	}

	async function openEnvFile(): Promise<void> {
		const current = await resolveProject();
		if (!current) {
			void vscode.window.showWarningMessage(vscode.l10n.t('Open a Laravel project folder to inspect it.'));
			return;
		}
		await vscode.window.showTextDocument(vscode.Uri.joinPath(current.root, envFileName()));
	}

	function logTailBytes(): number {
		const megabytes = vscode.workspace.getConfiguration('redCode.laravel').get<number>('logTailMb', 2);
		const clamped = Math.min(50, Math.max(0.1, megabytes));
		return Math.round(clamped * 1024 * 1024);
	}

	const logDeps: LogsViewDeps = {
		project: () => project,
		logPattern: () => LOG_PATTERN,
		tailBytes: logTailBytes,
		list: async () => {
			const current = await resolveProject();
			return current ? listLogFiles(current.root.fsPath, LOG_PATTERN) : [];
		},
		read: async (relativePath, maxBytes) => {
			const current = await resolveProject();
			return current ? readLogTail(current.root.fsPath, relativePath, maxBytes) : undefined;
		}
	};

	const logsProvider = new LogsTreeProvider(logDeps);
	const logsView = vscode.window.createTreeView('redCode.laravel.logs', {
		treeDataProvider: logsProvider
	});
	const logDocuments = new LogDocumentProvider();

	async function refreshLogsView(): Promise<void> {
		logsProvider.refresh();
		const state = await logsProvider.state();
		logsView.message = state.message;
		logsView.description = state.count > 0 ? vscode.l10n.t('{0} entries', String(state.count)) : undefined;
	}

	let tailEnabled = false;
	let tailWatcher: vscode.FileSystemWatcher | undefined;
	let tailSubscriptions: vscode.Disposable[] = [];
	let logRefreshTimer: NodeJS.Timeout | undefined;

	function scheduleLogRefresh(): void {
		if (logRefreshTimer) {
			clearTimeout(logRefreshTimer);
		}
		logRefreshTimer = setTimeout(() => {
			logRefreshTimer = undefined;
			void refreshLogsView();
		}, LOG_TAIL_DEBOUNCE_MS);
	}

	async function setLogTail(enabled: boolean): Promise<void> {
		if (enabled === tailEnabled) {
			return;
		}
		tailEnabled = enabled;
		if (enabled && !tailWatcher) {
			tailWatcher = vscode.workspace.createFileSystemWatcher(`**/${LOG_PATTERN}`);
			tailSubscriptions = [
				tailWatcher,
				tailWatcher.onDidChange(scheduleLogRefresh),
				tailWatcher.onDidCreate(scheduleLogRefresh),
				tailWatcher.onDidDelete(scheduleLogRefresh)
			];
		} else if (!enabled && tailWatcher) {
			for (const subscription of tailSubscriptions) {
				subscription.dispose();
			}
			tailSubscriptions = [];
			tailWatcher = undefined;
		}
		await vscode.commands.executeCommand('setContext', 'redCodeLaravel.logTail', enabled);
		void vscode.window.setStatusBarMessage(
			enabled ? vscode.l10n.t('Log tail enabled.') : vscode.l10n.t('Log tail disabled.'),
			3000
		);
		await refreshLogsView();
	}

	async function pickLogLevels(): Promise<void> {
		const selected = logsProvider.levelsSelected();
		const allSelected = [...LOG_LEVELS, UNKNOWN_LEVEL].every(level => selected.has(level));
		const items: vscode.QuickPickItem[] = [
			{ label: 'ALL', description: vscode.l10n.t('Show every level'), picked: allSelected },
			...LOG_LEVELS.map(level => ({ label: level, picked: selected.has(level) })),
			{ label: UNKNOWN_LEVEL, description: vscode.l10n.t('Entries without a header'), picked: selected.has(UNKNOWN_LEVEL) }
		];

		const picked = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			title: vscode.l10n.t('Log Levels'),
			placeHolder: vscode.l10n.t('Select the levels to show')
		});
		if (!picked) {
			return;
		}

		const labels = new Set(picked.map(item => item.label));
		logsProvider.setLevels(labels.has('ALL') ? DEFAULT_LOG_LEVELS : new Set(labels));
		await refreshLogsView();
	}

	async function openLogEntry(arg: unknown): Promise<void> {
		if (!arg || typeof arg !== 'object' || !('entry' in arg)) {
			return;
		}
		const { fileName, entry } = arg as { fileName: string; entry: LogEntry };
		await vscode.window.showTextDocument(logDocuments.publish(fileName, entry), { preview: true });
	}

	const artisanDeps: ArtisanDeps = {
		runner,
		channel,
		project: () => project,
		catalog: () => loadCatalog(true)
	};

	const artisanProvider = new ArtisanTreeProvider({
		catalog: () => loadCatalog(),
		runNamedCommand: name => runNamedArtisanCommand(artisanDeps, name)
	});
	const artisanView = vscode.window.createTreeView('redCode.laravel.artisan', {
		treeDataProvider: artisanProvider
	});

	function updateViewState(): void {
		const snapshot = index.snapshot;
		if (!project) {
			routesView.message = vscode.l10n.t('No Laravel project detected in this workspace.');
			explorerView.message = vscode.l10n.t('No Laravel project detected in this workspace.');
			modelsView.message = vscode.l10n.t('No Laravel project detected in this workspace.');
			schemaView.message = vscode.l10n.t('No Laravel project detected in this workspace.');
			artisanView.message = vscode.l10n.t('No Laravel project detected in this workspace.');
			routesView.description = undefined;
			explorerView.description = undefined;
			modelsView.description = undefined;
			schemaView.description = undefined;
			artisanView.description = undefined;
			return;
		}

		if (!snapshot) {
			routesView.message = vscode.l10n.t('Loading Laravel index…');
			explorerView.message = vscode.l10n.t('Loading Laravel index…');
			modelsView.message = vscode.l10n.t('Loading Laravel index…');
			schemaView.message = vscode.l10n.t('Loading Laravel index…');
			artisanView.message = undefined;
			return;
		}

		const counts = snapshot.graph.counts();
		if (!vscode.workspace.isTrusted) {
			routesView.message = vscode.l10n.t('Restricted Mode: trust this workspace to run artisan and index routes.');
			artisanView.message = vscode.l10n.t('Restricted Mode: Artisan commands are disabled.');
		} else {
			routesView.message = counts.routes === 0 ? vscode.l10n.t('No application routes found.') : undefined;
			artisanView.message = undefined;
		}
		routesView.description = vscode.l10n.t('{0} routes', String(counts.routes));
		explorerView.message = snapshot.truncated
			? vscode.l10n.t('Index truncated at {0} files. Raise redCode.laravel.index.maxFiles to include the rest.', String(snapshot.fileCount))
			: undefined;
		explorerView.description = project.version ?? undefined;
		artisanView.description = undefined;

		// Models and schema are read from declarations, so they stay populated in
		// Restricted Mode and never depend on a database connection.
		modelsView.message = snapshot.models.length === 0 ? vscode.l10n.t('No Eloquent models found.') : undefined;
		modelsView.description = vscode.l10n.t('{0} models', String(snapshot.models.length));
		schemaView.message = snapshot.schema.tables.length === 0 ? vscode.l10n.t('No migrations found.') : undefined;
		schemaView.description = vscode.l10n.t('{0} tables', String(snapshot.schema.tables.length));
	}

	function currentRoute(arg: unknown): RouteEntry | undefined {
		if (arg && typeof arg === 'object' && 'route' in arg) {
			return (arg as { route: RouteEntry }).route;
		}
		if (arg && typeof arg === 'object' && 'uri' in arg && 'action' in arg) {
			return arg as RouteEntry;
		}
		return undefined;
	}

	function routeUrl(route: RouteEntry): string {
		return `${index.appUrl}${toConcreteUri(route.uri)}`;
	}

	async function inspectActiveClass(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		const current = await resolveProject();
		if (!current) {
			void vscode.window.showWarningMessage(vscode.l10n.t('Open a Laravel project to inspect a class.'));
			return;
		}
		const graph = await ensureIndex();
		if (!graph) {
			return;
		}

		const relative = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');
		const cls = graph.classByFile(relative);
		if (!cls) {
			void vscode.window.showInformationMessage(vscode.l10n.t('No indexed PHP class was found in this file.'));
			return;
		}

		interface InspectPick extends vscode.QuickPickItem {
			run(): Promise<void>;
		}

		const items: InspectPick[] = [];
		const reveal = async (location: SourceLocation | undefined) => {
			if (location) {
				await openLocation(location, current.root);
			}
		};

		items.push({
			label: `$(go-to-file) ${cls.name}`,
			description: cls.file,
			run: () => reveal(graph.classLocation(cls))
		});

		const routes = graph.routesForClass(cls.fqcn);
		for (const route of routes) {
			items.push({
				label: `$(globe) ${route.methods.join('|')} ${displayUri(route.uri)}`,
				description: route.name ?? route.action,
				run: () => reveal(graph.routeLocation(route))
			});
		}

		for (const relation of cls.relations) {
			const target = graph.relationTarget(relation);
			items.push({
				label: `$(symbol-reference) ${relation.method} → ${target?.name ?? relation.related}`,
				description: relation.type,
				run: () => reveal(target ? graph.classLocation(target) : undefined)
			});
		}

		if (items.length === 1) {
			void vscode.window.showInformationMessage(
				vscode.l10n.t('{0} has no routes or Eloquent relations in the index.', cls.name)
			);
		}

		const picked = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t('Laravel: {0}', cls.name),
			placeHolder: vscode.l10n.t('{0} routes · {1} relations · {2} methods', String(routes.length), String(cls.relations.length), String(cls.methods.length))
		});
		if (picked) {
			await picked.run();
		}
	}

	const indexSubscription = index.onDidChange(() => {
		routesProvider.refresh();
		explorerProvider.refresh();
		modelsProvider.refresh();
		schemaProvider.refresh();
		updateViewState();
	});

	function scheduleRefresh(uri: vscode.Uri): void {
		if (!index.snapshot) {
			return;
		}
		if (!vscode.workspace.getConfiguration('redCode.laravel').get<boolean>('index.autoRefresh', true)) {
			return;
		}
		const path = uri.fsPath.replace(/\\/g, '/');
		if (/(?:\/(?:vendor|node_modules|storage|\.git|bootstrap\/cache|public\/build)\/)/.test(path)) {
			return;
		}
		if (refreshTimer) {
			clearTimeout(refreshTimer);
		}
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined;
			void ensureIndex(true);
		}, REFRESH_DEBOUNCE_MS);
	}

	const phpWatcher = vscode.workspace.createFileSystemWatcher('**/*.php');
	const configWatcher = vscode.workspace.createFileSystemWatcher('**/{composer.json,composer.lock}');
	const envWatcher = vscode.workspace.createFileSystemWatcher('**/.env*');
	for (const watcher of [phpWatcher, configWatcher, envWatcher]) {
		context.subscriptions.push(
			watcher,
			watcher.onDidChange(scheduleRefresh),
			watcher.onDidCreate(scheduleRefresh),
			watcher.onDidDelete(scheduleRefresh)
		);
	}

	registerNavigation(context, {
		graph: () => index.graph,
		root: () => project?.root
	});

	context.subscriptions.push(
		channel,
		index,
		indexSubscription,
		routesView,
		explorerView,
		modelsView,
		schemaView,
		envView,
		logsView,
		artisanView,
		logDocuments,
		vscode.workspace.registerTextDocumentContentProvider(LOG_SCHEME, logDocuments),
		registerLocationCommand(),
		vscode.commands.registerCommand('redCode.laravel.showProject', () => showProjectInformation(runner, resolveProject)),
		vscode.commands.registerCommand('redCode.laravel.refresh', async () => {
			await viewContext.refreshIndex();
			updateViewState();
		}),
		vscode.commands.registerCommand('redCode.laravel.refreshEnv', () => refreshEnvView()),
		vscode.commands.registerCommand('redCode.laravel.addMissingEnvKeys', () => addMissingEnvKeys()),
		vscode.commands.registerCommand('redCode.laravel.openEnvFile', () => openEnvFile()),
		vscode.commands.registerCommand('redCode.laravel.logs.refresh', () => refreshLogsView()),
		vscode.commands.registerCommand('redCode.laravel.logs.filterLevels', () => pickLogLevels()),
		vscode.commands.registerCommand('redCode.laravel.logs.startTail', () => setLogTail(true)),
		vscode.commands.registerCommand('redCode.laravel.logs.stopTail', () => setLogTail(false)),
		vscode.commands.registerCommand('redCode.laravel.logs.openEntry', (arg: unknown) => openLogEntry(arg)),
		vscode.commands.registerCommand('redCode.laravel.palette', async () => {
			await resolveProject();
			await showArtisanPalette(artisanDeps);
		}),
		vscode.commands.registerCommand('redCode.laravel.runArtisan', async () => {
			await resolveProject();
			await showArtisanPalette(artisanDeps);
		}),
		vscode.commands.registerCommand('redCode.laravel.runArtisanCommand', async (name: string) => {
			await resolveProject();
			await runNamedArtisanCommand(artisanDeps, name);
		}),
		vscode.commands.registerCommand('redCode.laravel.inspectClass', () => inspectActiveClass()),
		vscode.commands.registerCommand('redCode.laravel.goToRouteAction', async (arg: unknown) => {
			const route = currentRoute(arg);
			if (!route) {
				return;
			}
			const graph = await ensureIndex();
			const location = graph?.methodLocation(route.controllerClass, route.controllerMethod) ?? graph?.routeLocation(route);
			if (location) {
				await viewContext.openLocation(location);
			}
		}),
		vscode.commands.registerCommand('redCode.laravel.copyRouteUri', async (arg: unknown) => {
			const route = currentRoute(arg);
			if (route) {
				await viewContext.copy(displayUri(route.uri), vscode.l10n.t('Route URI copied.'));
			}
		}),
		vscode.commands.registerCommand('redCode.laravel.copyRouteCurl', async (arg: unknown) => {
			const route = currentRoute(arg);
			if (route) {
				const curl = buildCurlCommand(requestMethod(route), routeUrl(route));
				await viewContext.copy(curl, vscode.l10n.t('cURL command copied.'));
			}
		}),
		vscode.commands.registerCommand('redCode.laravel.openRouteInBrowser', async (arg: unknown) => {
			const route = currentRoute(arg);
			if (route) {
				await vscode.env.openExternal(vscode.Uri.parse(routeUrl(route)));
			}
		}),
		vscode.workspace.onDidChangeConfiguration(async event => {
			if (event.affectsConfiguration('redCode.laravel.phpPath')) {
				project = undefined;
				catalogCache = undefined;
				index.invalidate();
				await ensureIndex(true);
				return;
			}
			if (event.affectsConfiguration('redCode.laravel.routes.showVendor')) {
				routesProvider.refresh();
			}
			if (event.affectsConfiguration('redCode.laravel.envFile')) {
				await refreshEnvView();
			}
			if (event.affectsConfiguration('redCode.laravel.logTailMb')) {
				await refreshLogsView();
			}
			if (event.affectsConfiguration('redCode.laravel.index')) {
				await ensureIndex(true);
			}
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(async () => {
			project = undefined;
			catalogCache = undefined;
			index.invalidate();
			await resolveProject(true);
			updateViewState();
			await refreshEnvView();
			await refreshLogsView();
		})
	);

	void resolveProject().then(async () => {
		updateViewState();
		await refreshEnvView();
		await refreshLogsView();
	});

	context.subscriptions.push({
		dispose: () => {
			if (refreshTimer) {
				clearTimeout(refreshTimer);
				refreshTimer = undefined;
			}
			if (logRefreshTimer) {
				clearTimeout(logRefreshTimer);
				logRefreshTimer = undefined;
			}
		}
	});
}

export function deactivate(): void {
	// Everything is registered in the extension context.
}

async function showProjectInformation(
	runner: ArtisanRunner,
	resolveProject: () => Promise<LaravelProject | undefined>
): Promise<void> {
	const current = await resolveProject();
	if (!current) {
		void vscode.window.showWarningMessage(vscode.l10n.t('Open a Laravel project folder to inspect it.'));
		return;
	}

	const items: vscode.QuickPickItem[] = [
		{ label: vscode.l10n.t('Project'), description: current.folder.name },
		{ label: vscode.l10n.t('Laravel'), description: current.version ?? vscode.l10n.t('version unknown') },
		{
			label: vscode.l10n.t('PHP'),
			description: current.php ?? vscode.l10n.t('php.exe not found. Set redCode.laravel.phpPath.')
		}
	];

	if (!current.php) {
		const resolution = resolvePhpPath();
		if (resolution.warning) {
			items.push({ label: vscode.l10n.t('PHP warning'), description: resolution.warning });
		}
	}

	const about = vscode.workspace.isTrusted
		? await runner.run(current, ['about', '--json'], { timeoutMs: 20_000 })
		: undefined;
	const runtime = about && about.code === 0 ? parseAboutJson(about.stdout) : undefined;

	if (!vscode.workspace.isTrusted) {
		items.push({
			label: vscode.l10n.t('Restricted Mode'),
			description: vscode.l10n.t('Trust this workspace to run artisan. Only static project information is shown.')
		});
	}

	if (runtime) {
		items.push(
			{ label: vscode.l10n.t('PHP version'), description: runtime.phpVersion ?? vscode.l10n.t('unknown') },
			{ label: vscode.l10n.t('Environment'), description: runtime.environment ?? vscode.l10n.t('unknown') },
			{ label: vscode.l10n.t('Debug mode'), description: runtime.debugMode ? vscode.l10n.t('enabled') : vscode.l10n.t('disabled') },
			{ label: vscode.l10n.t('Database'), description: runtime.databaseDriver ?? vscode.l10n.t('unknown') },
			{ label: vscode.l10n.t('Queue'), description: runtime.queueDriver ?? vscode.l10n.t('unknown') },
			{ label: vscode.l10n.t('Cache'), description: runtime.cacheDriver ?? vscode.l10n.t('unknown') }
		);

		if (runtime.debugMode) {
			items.push({
				label: vscode.l10n.t('Warning'),
				description: vscode.l10n.t('APP_DEBUG is enabled. Do not use this configuration in production.')
			});
		}
	}

	await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Laravel — {0}', current.folder.name),
		placeHolder: current.root.fsPath
	});
}
