/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { LaravelProject } from './project.js';
import { redactSecrets } from './redact.js';

export interface RunResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly durationMs: number;
	readonly timedOut: boolean;
}

export interface RunOptions {
	readonly timeoutMs?: number;
	readonly token?: vscode.CancellationToken;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 8 * 1024 * 1024;
const ENVIRONMENT_ALLOW_LIST = new Set([
	'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP',
	'HOME', 'USERPROFILE', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA'
]);

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

function probeEnvironment(): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && ENVIRONMENT_ALLOW_LIST.has(key.toUpperCase())) {
			environment[key] = value;
		}
	}
	// Parseable output, and never let a Sail wrapper intercept the command.
	environment['NO_COLOR'] = '1';
	environment['LARAVEL_SAIL'] = '0';
	return environment;
}

/**
 * Runs `php artisan` with fixed argument arrays and no shell. Every invocation
 * is logged to the Red Code Laravel output channel with secrets redacted.
 */
export class ArtisanRunner {
	constructor(private readonly channel: vscode.OutputChannel) { }

	/**
	 * Runs any executable with fixed argument arrays and no shell. Shared with
	 * the test runner so both get the same environment allow-list, buffer limit
	 * and cancellation behaviour.
	 */
	async exec(executable: string, args: readonly string[], cwd: string, options: RunOptions = {}): Promise<RunResult> {
		const startedAt = Date.now();
		return new Promise<RunResult>(resolve => {
			const child = execFile(
				executable,
				[...args],
				{
					cwd,
					env: probeEnvironment(),
					windowsHide: true,
					timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
					maxBuffer: MAX_BUFFER,
					encoding: 'utf8'
				},
				(error, stdout, stderr) => {
					cancellation?.dispose();
					const timedOut = Boolean(error && (error as { killed?: boolean }).killed);
					const rawCode = (error as { code?: unknown } | null)?.code;
					const exitCode = typeof rawCode === 'number' ? rawCode : (timedOut ? 124 : -1);
					resolve({
						code: error ? exitCode : 0,
						stdout: typeof stdout === 'string' ? stdout : '',
						stderr: typeof stderr === 'string' ? stderr : (error?.message ?? ''),
						durationMs: Date.now() - startedAt,
						timedOut
					});
				}
			);

			const cancellation = options.token?.onCancellationRequested(() => child.kill());
		});
	}

	async run(project: LaravelProject, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
		if (!project.php) {
			throw new Error(vscode.l10n.t('No php.exe was found. Set redCode.laravel.phpPath.'));
		}

		const result = await this.exec(project.php, [project.artisan.fsPath, ...args], project.root.fsPath, options);

		this.channel.appendLine(redactSecrets(
			`php artisan ${args.join(' ')} → exit ${result.code}, ${result.durationMs} ms${result.timedOut ? ' (timed out)' : ''}`
		));
		if (result.stderr.trim()) {
			this.channel.appendLine(redactSecrets(result.stderr.trim()));
		}

		return result;
	}

	/**
	 * Runs a command expected to emit JSON and returns `undefined` for any
	 * failure, so callers can show an explanatory row instead of an exception.
	 */
	async runJson(project: LaravelProject, args: readonly string[], options: RunOptions = {}): Promise<unknown | undefined> {
		const result = await this.run(project, args, options);
		if (result.code !== 0) {
			return undefined;
		}

		const text = result.stdout.replace(ANSI_ESCAPE, '').trim();
		if (!text) {
			return undefined;
		}

		try {
			return JSON.parse(text);
		} catch {
			this.channel.appendLine(vscode.l10n.t('Expected JSON but received: {0}', text.slice(0, 200)));
			return undefined;
		}
	}
}
