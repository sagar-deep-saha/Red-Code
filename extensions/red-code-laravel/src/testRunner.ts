/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ArtisanRunner, RunOptions } from './artisan.js';
import { classFromTestPath, DiscoveredTest, parseJUnit, parseTestList, parseTestSource, TestResult } from './index/junit.js';
import { readWorkspaceFile, scanProjectFiles } from './index/scan.js';
import { LaravelProject } from './project.js';
import { redactSecrets } from './redact.js';

export type TestRunnerKind = 'pest' | 'phpunit';

/**
 * Suites routinely run for minutes, so artisan's 15 s default would cut them
 * off. Cancellation through the run profile still stops a runaway suite.
 */
const SUITE_TIMEOUT_MS = 10 * 60_000;

export interface TestRunnerDeps {
	readonly runner: ArtisanRunner;
	readonly channel: vscode.OutputChannel;
}

export interface TestRunOutput {
	readonly results: readonly TestResult[];
	readonly exitCode: number;
}

function binaryPath(kind: TestRunnerKind): string {
	return kind === 'pest' ? 'vendor/bin/pest' : 'vendor/bin/phpunit';
}

async function exists(project: LaravelProject, relativePath: string): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(vscode.Uri.joinPath(project.root, relativePath));
		return true;
	} catch {
		return false;
	}
}

/** Pest wins when both are installed, matching `artisan test`'s own preference. */
export async function detectTestRunner(project: LaravelProject): Promise<TestRunnerKind | undefined> {
	if (await exists(project, 'vendor/bin/pest')) {
		return 'pest';
	}
	if (await exists(project, 'vendor/bin/phpunit')) {
		return 'phpunit';
	}
	return undefined;
}

let sequence = 0;

function tempPath(prefix: string, extension: string): string {
	sequence = (sequence + 1) % 1_000_000;
	return path.join(os.tmpdir(), `red-code-laravel-${prefix}-${process.pid}-${Date.now()}-${sequence}${extension}`);
}

async function readText(file: string): Promise<string | undefined> {
	try {
		return await fs.readFile(file, 'utf8');
	} catch {
		return undefined;
	}
}

async function removeFile(file: string): Promise<void> {
	try {
		await fs.rm(file, { force: true });
	} catch {
		// A leftover temp file is harmless.
	}
}

/**
 * `--list-tests-xml` needs PHPUnit 9.3+, so an older runner (or a failure)
 * falls back to reading the test sources under `tests/`.
 */
export async function discoverTests(project: LaravelProject, deps: TestRunnerDeps, options: RunOptions = {}): Promise<DiscoveredTest[]> {
	if (!project.php) {
		return [];
	}
	const kind = await detectTestRunner(project);
	if (!kind) {
		return [];
	}

	const listed = await listTests(project, project.php, kind, deps, options);
	if (listed.length > 0) {
		return listed;
	}

	deps.channel.appendLine(vscode.l10n.t('--list-tests-xml returned no tests. Scanning tests/ instead.'));
	return scanTestFiles(project);
}

async function listTests(
	project: LaravelProject,
	php: string,
	kind: TestRunnerKind,
	deps: TestRunnerDeps,
	options: RunOptions
): Promise<DiscoveredTest[]> {
	const target = tempPath('list', '.xml');
	try {
		const result = await deps.runner.exec(
			php,
			[binaryPath(kind), '--list-tests-xml', target],
			project.root.fsPath,
			{ timeoutMs: options.timeoutMs ?? SUITE_TIMEOUT_MS, token: options.token }
		);
		deps.channel.appendLine(redactSecrets(`${binaryPath(kind)} --list-tests-xml → exit ${result.code}, ${result.durationMs} ms`));
		if (result.code !== 0) {
			return [];
		}
		const xml = await readText(target);
		return xml ? parseTestList(xml) : [];
	} catch (error) {
		deps.channel.appendLine(String(error));
		return [];
	} finally {
		await removeFile(target);
	}
}

async function scanTestFiles(project: LaravelProject): Promise<DiscoveredTest[]> {
	const scan = await scanProjectFiles(project.root);
	const discovered: DiscoveredTest[] = [];
	for (const file of scan.files) {
		if (!/^tests\/.+Test\.php$/.test(file)) {
			continue;
		}
		const className = classFromTestPath(file);
		if (!className) {
			continue;
		}
		const source = await readWorkspaceFile(project.root, file);
		if (source === undefined) {
			continue;
		}
		const absolute = vscode.Uri.joinPath(project.root, file).fsPath;
		for (const name of parseTestSource(source)) {
			discovered.push({ id: `${className}::${name}`, name, class: className, file: absolute });
		}
	}
	return discovered;
}

export interface RunTestsOptions extends RunOptions {
	readonly filter?: string;
}

/**
 * Runs the underlying runner directly. `artisan test` never forwards
 * `--log-junit`, so it cannot be used for result mapping.
 */
export async function runTests(project: LaravelProject, deps: TestRunnerDeps, options: RunTestsOptions = {}): Promise<TestRunOutput | undefined> {
	if (!project.php) {
		return undefined;
	}
	const kind = await detectTestRunner(project);
	if (!kind) {
		return undefined;
	}

	const junit = tempPath('junit', '.xml');
	const args = [binaryPath(kind), '--log-junit', junit];
	if (options.filter) {
		args.push('--filter', options.filter);
	}
	// `--parallel` is a Pest option; PHPUnit would reject it.
	if (kind === 'pest' && vscode.workspace.getConfiguration('redCode.laravel').get<boolean>('test.parallel', false)) {
		args.push('--parallel');
	}

	try {
		const result = await deps.runner.exec(
			project.php,
			args,
			project.root.fsPath,
			{ timeoutMs: options.timeoutMs ?? SUITE_TIMEOUT_MS, token: options.token }
		);
		deps.channel.appendLine(redactSecrets(`php ${args.join(' ')} → exit ${result.code}, ${result.durationMs} ms${result.timedOut ? ' (timed out)' : ''}`));

		const xml = await readText(junit);
		return { results: xml ? parseJUnit(xml) : [], exitCode: result.code };
	} catch (error) {
		deps.channel.appendLine(String(error));
		return undefined;
	} finally {
		await removeFile(junit);
	}
}
