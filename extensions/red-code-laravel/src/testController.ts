/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { buildFilter, DiscoveredTest, testIdentity, TestResult } from './index/junit.js';
import { LaravelProject } from './project.js';
import { discoverTests, runTests, TestRunnerDeps } from './testRunner.js';

export interface TestControllerDeps extends TestRunnerDeps {
	readonly project: () => Promise<LaravelProject | undefined>;
	readonly trusted: () => boolean;
}

export interface LaravelTestController extends vscode.Disposable {
	/** Drops the discovered tree so the next resolve re-reads the project. */
	invalidate(): void;
}

function shortClassName(className: string): string {
	const separator = className.lastIndexOf('\\');
	return separator < 0 ? className : className.slice(separator + 1);
}

function namespaceOf(className: string): string | undefined {
	const separator = className.lastIndexOf('\\');
	return separator < 0 ? undefined : className.slice(0, separator);
}

function methodName(id: string): string {
	const separator = id.lastIndexOf('::');
	return separator < 0 ? id : id.slice(separator + 2);
}

function locationOf(result: TestResult): vscode.Location | undefined {
	if (!result.file || result.line === undefined) {
		return undefined;
	}
	const line = Math.max(0, result.line - 1);
	return new vscode.Location(vscode.Uri.file(result.file), new vscode.Position(line, 0));
}

function publishDiagnostic(collection: vscode.DiagnosticCollection, result: TestResult): void {
	const location = locationOf(result);
	if (!location || !result.message) {
		return;
	}

	const start = location.range.start;
	const range = new vscode.Range(start, new vscode.Position(start.line, Number.MAX_SAFE_INTEGER));
	const diagnostic = new vscode.Diagnostic(range, result.message, vscode.DiagnosticSeverity.Error);
	diagnostic.source = 'Laravel';
	diagnostic.code = testIdentity(result);
	collection.set(location.uri, [...(collection.get(location.uri) ?? []), diagnostic]);
}

/**
 * Publishes PHPUnit results into the native Testing API. Discovery and the run
 * go through the underlying runner, never `artisan test`, which does not
 * forward `--log-junit`.
 */
export function registerTestController(deps: TestControllerDeps): LaravelTestController {
	const controller = vscode.tests.createTestController('redCodeLaravelTests', vscode.l10n.t('Laravel'));
	const diagnostics = vscode.languages.createDiagnosticCollection('redCodeLaravelTests');

	let current: LaravelProject | undefined;
	let discovery: Promise<void> | undefined;

	function buildTree(discovered: readonly DiscoveredTest[]): vscode.TestItem[] {
		const classes = new Map<string, vscode.TestItem>();
		for (const entry of discovered) {
			let parent = classes.get(entry.class);
			if (!parent) {
				parent = controller.createTestItem(entry.class, shortClassName(entry.class), entry.file ? vscode.Uri.file(entry.file) : undefined);
				parent.description = namespaceOf(entry.class);
				classes.set(entry.class, parent);
			}
			parent.children.add(controller.createTestItem(entry.id, entry.name, entry.file ? vscode.Uri.file(entry.file) : undefined));
		}
		return [...classes.values()];
	}

	async function load(): Promise<void> {
		if (discovery) {
			return discovery;
		}
		discovery = (async () => {
			current = await deps.project();
			if (!current || !deps.trusted()) {
				controller.items.replace([]);
				return;
			}
			controller.items.replace(buildTree(await discoverTests(current, deps)));
		})();

		try {
			await discovery;
		} catch (error) {
			deps.channel.appendLine(String(error));
		} finally {
			discovery = undefined;
		}
	}

	function runnable(request: vscode.TestRunRequest): vscode.TestItem[] {
		const excluded = new Set(request.exclude ?? []);
		const items: vscode.TestItem[] = [];
		const collect = (item: vscode.TestItem) => {
			if (excluded.has(item)) {
				return;
			}
			if (item.children.size === 0) {
				items.push(item);
				return;
			}
			item.children.forEach(child => collect(child));
		};

		if (request.include) {
			request.include.forEach(collect);
		} else {
			controller.items.forEach(collect);
		}
		return items;
	}

	function messageFor(result: TestResult): vscode.TestMessage {
		const message = new vscode.TestMessage(
			result.message ?? vscode.l10n.t('{0} failed without a message.', testIdentity(result))
		);
		const location = locationOf(result);
		if (location) {
			message.location = location;
		} else {
			deps.channel.appendLine(vscode.l10n.t('{0} reported no file and line.', testIdentity(result)));
		}
		return message;
	}

	async function run(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
		await load();

		const run = controller.createTestRun(request);
		const items = runnable(request);
		for (const item of items) {
			run.enqueued(item);
		}
		diagnostics.clear();

		const project = current;
		if (!project || !deps.trusted()) {
			for (const item of items) {
				run.errored(item, new vscode.TestMessage(vscode.l10n.t('Trust this workspace to run the test suite.')));
			}
			run.end();
			return;
		}

		const outcome = await runTests(project, deps, { filter: buildFilter(items.map(item => item.id)), token });
		if (!outcome) {
			for (const item of items) {
				run.errored(item, new vscode.TestMessage(vscode.l10n.t('No Pest or PHPUnit binary was found in vendor/bin.')));
			}
			run.end();
			return;
		}

		const reported = new Map<string, TestResult>();
		const unique = new Map<string, TestResult>();
		const duplicated = new Set<string>();
		for (const result of outcome.results) {
			reported.set(testIdentity(result), result);
			if (unique.has(result.name)) {
				duplicated.add(result.name);
			}
			unique.set(result.name, result);
		}

		let failed = 0;
		for (const item of items) {
			// Pest reports its own test names, so fall back to the method name
			// when the full `Class::method` identity is not reported.
			const name = methodName(item.id);
			const result = reported.get(item.id) ?? (duplicated.has(name) ? undefined : unique.get(name));
			const duration = result?.time === undefined ? undefined : Math.round(result.time * 1000);

			if (!result) {
				run.errored(item, new vscode.TestMessage(vscode.l10n.t('No result was reported for {0}.', item.id)));
				continue;
			}
			if (result.outcome === 'passed') {
				run.passed(item, duration);
				continue;
			}
			if (result.outcome === 'skipped') {
				run.skipped(item);
				continue;
			}

			failed++;
			run.failed(item, messageFor(result), duration);
			publishDiagnostic(diagnostics, result);
		}

		run.appendOutput(
			vscode.l10n.t('PHPUnit exit code {0}. {1} tests run, {2} failed.', String(outcome.exitCode), String(items.length), String(failed)) + '\r\n'
		);
		run.end();
	}

	controller.resolveHandler = async item => {
		if (!item) {
			await load();
		}
	};

	controller.refreshHandler = async () => {
		controller.items.replace([]);
		diagnostics.clear();
		await load();
	};

	controller.createRunProfile(
		vscode.l10n.t('Run'),
		vscode.TestRunProfileKind.Run,
		(request, token) => run(request, token),
		true
	);

	return {
		invalidate: () => {
			current = undefined;
			controller.items.replace([]);
			diagnostics.clear();
		},
		dispose: () => {
			diagnostics.dispose();
			controller.dispose();
		}
	};
}
