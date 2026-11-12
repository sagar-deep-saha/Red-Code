/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ArtisanRunner } from '../artisan.js';
import { LaravelProject } from '../project.js';
import { normalizeBaseUrl, parseEnvValue } from './env.js';
import { buildGraph, IndexedClass, IndexedView, LaravelGraph } from './graph.js';
import { parsePhpFile } from './phpSymbols.js';
import { parseRouteList, RouteEntry } from './routes.js';
import { readWorkspaceFile, scanProjectFiles } from './scan.js';
import { componentNameFromPath, extractReferences, isBladePath, viewNameFromPath } from './views.js';

export interface IndexSnapshot {
	readonly graph: LaravelGraph;
	readonly truncated: boolean;
	readonly fileCount: number;
	readonly appUrl: string;
	readonly buildDurationMs: number;
}

const READ_CONCURRENCY = 24;

async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;

	async function worker(): Promise<void> {
		while (next < items.length) {
			const index = next++;
			results[index] = await task(items[index]);
		}
	}

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

function indexedClass(file: string, text: string): IndexedClass | undefined {
	const symbols = parsePhpFile(text);
	if (!symbols.className) {
		return undefined;
	}
	return {
		fqcn: symbols.namespace ? `${symbols.namespace}\\${symbols.className}` : symbols.className,
		name: symbols.className,
		namespace: symbols.namespace,
		file,
		extendsClass: symbols.extendsClass,
		methods: symbols.methods,
		relations: symbols.relations
	};
}

function indexedView(file: string, text: string): IndexedView | undefined {
	const name = viewNameFromPath(file);
	if (!name) {
		return undefined;
	}
	const componentName = componentNameFromPath(file);
	return {
		name,
		componentName,
		file,
		isComponent: Boolean(componentName),
		references: extractReferences(text)
	};
}

/**
 * Owns the semantic graph. One writer, immutable snapshots, and an explicit
 * change event: views never rebuild or mutate the index themselves.
 */
export class LaravelIndex implements vscode.Disposable {
	private snapshotValue: IndexSnapshot | undefined;
	private building: Promise<IndexSnapshot | undefined> | undefined;
	private readonly changeEmitter = new vscode.EventEmitter<IndexSnapshot | undefined>();
	private disposed = false;

	readonly onDidChange = this.changeEmitter.event;

	constructor(
		private readonly runner: ArtisanRunner,
		private readonly channel: vscode.OutputChannel
	) { }

	get snapshot(): IndexSnapshot | undefined {
		return this.snapshotValue;
	}

	get graph(): LaravelGraph | undefined {
		return this.snapshotValue?.graph;
	}

	get appUrl(): string {
		return this.snapshotValue?.appUrl ?? normalizeBaseUrl(undefined);
	}

	/**
	 * Coalesces concurrent builds: two views revealing at once must not run
	 * `route:list` twice.
	 */
	async refresh(project: LaravelProject, options: { maxFiles?: number; token?: vscode.CancellationToken } = {}): Promise<IndexSnapshot | undefined> {
		if (this.building) {
			return this.building;
		}

		this.building = this.build(project, options.maxFiles, options.token)
			.finally(() => { this.building = undefined; });

		const snapshot = await this.building;
		if (snapshot && !this.disposed) {
			this.snapshotValue = snapshot;
			this.changeEmitter.fire(snapshot);
		}
		return snapshot;
	}

	private async build(project: LaravelProject, maxFiles: number | undefined, token: vscode.CancellationToken | undefined): Promise<IndexSnapshot | undefined> {
		const startedAt = Date.now();
		// Restricted Mode must not execute project code. The static slice is safe;
		// the authoritative artisan slice is only read in a trusted workspace.
		const routesPromise = vscode.workspace.isTrusted
			? this.runner.run(project, ['route:list', '--json'], { timeoutMs: 30_000, token })
			: Promise.resolve(undefined);

		const [scan, routesResult] = await Promise.all([
			scanProjectFiles(project.root, maxFiles, token),
			routesPromise
		]);

		if (token?.isCancellationRequested) {
			return undefined;
		}

		let routes: readonly RouteEntry[] = [];
		if (!routesResult) {
			this.channel.appendLine(vscode.l10n.t('Restricted Mode: skipping route:list. Trust this workspace to index routes.'));
		} else if (routesResult.code === 0) {
			const parsed = parseRouteList(routesResult.stdout);
			if (parsed) {
				routes = parsed;
			} else {
				this.channel.appendLine(vscode.l10n.t('route:list returned no parseable JSON; the route index is empty.'));
			}
		} else {
			this.channel.appendLine(vscode.l10n.t('route:list failed with exit code {0}; the route index is empty.', routesResult.code));
		}

		const phpFiles = scan.files.filter(file => file.endsWith('.php') && !isBladePath(file));
		const bladeFiles = scan.files.filter(file => isBladePath(file));

		const classResults = await mapLimit(phpFiles, READ_CONCURRENCY, async file => {
			const text = await readWorkspaceFile(project.root, file);
			return text ? indexedClass(file, text) : undefined;
		});
		const viewResults = await mapLimit(bladeFiles, READ_CONCURRENCY, async file => {
			const text = await readWorkspaceFile(project.root, file);
			return text ? indexedView(file, text) : undefined;
		});

		let appUrl = normalizeBaseUrl(undefined);
		if (scan.files.includes('.env')) {
			const envText = await readWorkspaceFile(project.root, '.env');
			if (envText) {
				appUrl = normalizeBaseUrl(parseEnvValue(envText, 'APP_URL'));
			}
		}

		const classes = classResults.filter((item): item is IndexedClass => Boolean(item));
		const views = viewResults.filter((item): item is IndexedView => Boolean(item));

		const graph = buildGraph({ routes, classes, views, files: scan.files });
		this.channel.appendLine(vscode.l10n.t(
			'Indexed {0} files in {1} ms: {2} routes, {3} classes, {4} views.',
			scan.files.length, Date.now() - startedAt, routes.length, classes.length, views.length
		));

		return {
			graph,
			truncated: scan.truncated,
			fileCount: scan.files.length,
			appUrl,
			buildDurationMs: Date.now() - startedAt
		};
	}

	invalidate(): void {
		this.snapshotValue = undefined;
		this.changeEmitter.fire(undefined);
	}

	dispose(): void {
		this.disposed = true;
		this.changeEmitter.dispose();
	}
}
