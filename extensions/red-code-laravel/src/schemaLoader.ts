/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ArtisanRunner } from './artisan.js';
import { buildDatabaseSchema, parseDbShow, parseDbTable } from './index/dbSchema.js';
import { DatabaseSchema, SchemaTable } from './index/migrations.js';
import { LaravelProject } from './project.js';

export interface SchemaLoaderDeps {
	readonly runner: ArtisanRunner;
	readonly channel: vscode.OutputChannel;
}

const TABLE_CONCURRENCY = 4;
const TIMEOUT_MS = 30_000;

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

/**
 * Reads the schema from the live database with `db:show`/`db:table`. This is
 * the authoritative source: the migration parser is only a fallback for when
 * the database is unreachable. A handful of tables are read concurrently, so a
 * project with many tables does not spawn one process per table at once.
 */
export async function loadDatabaseSchema(
	project: LaravelProject,
	deps: SchemaLoaderDeps,
	token?: vscode.CancellationToken,
	fallback?: DatabaseSchema
): Promise<DatabaseSchema | undefined> {
	if (!project.php) {
		return undefined;
	}

	const show = await deps.runner.run(project, ['db:show', '--json'], { timeoutMs: TIMEOUT_MS, token });
	const info = show.code === 0 ? parseDbShow(show.stdout) : undefined;
	if (!info) {
		return undefined;
	}

	const results = await mapLimit(info.tables, TABLE_CONCURRENCY, async name => {
		const result = await deps.runner.run(project, ['db:table', name, '--json'], { timeoutMs: TIMEOUT_MS, token });
		return result.code === 0 ? parseDbTable(result.stdout, name) : undefined;
	});

	const tables = results.filter((table): table is SchemaTable => table !== undefined);
	deps.channel.appendLine(vscode.l10n.t('Read {0} tables from the database connection.', String(tables.length)));
	return buildDatabaseSchema(info, tables, fallback);
}
