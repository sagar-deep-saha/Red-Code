/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { CommitNode, parseCommitLog } from './graph.js';
import { CommitDetails, FileChange, parseCommitDetails, parseNumstat } from './log.js';

/**
 * Read-only wrapper around the git CLI for the graph and the blame decorations.
 *
 * Only `rev-parse`, `log`, `show`, `blame` and `status` are issued. Nothing runs hooks, filters,
 * a pager or an editor, and the caller never passes a shell string.
 */

const DEFAULT_LIMIT = 64 * 1024 * 1024;
const STDERR_LIMIT = 64 * 1024;

export class GitError extends Error {
	constructor(message: string, readonly exitCode?: number) {
		super(message);
		this.name = 'GitError';
	}
}

function gitEnvironment(): NodeJS.ProcessEnv {
	return {
		...process.env,
		GIT_TERMINAL_PROMPT: '0',
		GIT_OPTIONAL_LOCKS: '0',
		GCM_INTERACTIVE: 'never',
		GIT_PAGER: 'cat',
		LC_ALL: 'C'
	};
}

function cleanError(stderr: string, fallback: string): string {
	const line = stderr.split(/\r?\n/).map(value => value.trim()).find(value => value.length > 0);
	if (!line) {
		return fallback;
	}
	return line.replace(/^fatal:\s*/i, '').replace(/^error:\s*/i, '');
}

function runGit(cwd: string, args: readonly string[], maxBuffer = DEFAULT_LIMIT): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let received = 0;
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stderrLength = 0;

		const child = spawn('git', [...args], { cwd, windowsHide: true, env: gitEnvironment() });

		const finish = (error: Error | undefined, result?: Buffer) => {
			if (settled) {
				return;
			}
			settled = true;
			if (error) {
				reject(error);
			} else {
				resolve(result ?? Buffer.alloc(0));
			}
		};

		child.stdout.on('data', (chunk: Buffer) => {
			received += chunk.length;
			if (received > maxBuffer) {
				child.kill();
				finish(new GitError(`Git output exceeded ${Math.round(maxBuffer / (1024 * 1024))} MB.`));
				return;
			}
			stdout.push(chunk);
		});

		child.stderr.on('data', (chunk: Buffer) => {
			if (stderrLength < STDERR_LIMIT) {
				stderr.push(chunk);
				stderrLength += chunk.length;
			}
		});

		child.on('error', error => {
			const message = (error as NodeJS.ErrnoException).code === 'ENOENT'
				? 'Git was not found. Install Git and make sure it is on PATH.'
				: `Could not run git: ${error.message}`;
			finish(new GitError(message));
		});

		child.on('close', code => {
			if (code === 0) {
				finish(undefined, Buffer.concat(stdout));
				return;
			}
			const text = Buffer.concat(stderr).toString('utf8');
			finish(new GitError(cleanError(text, `git ${args[0]} exited with code ${code}.`), code ?? undefined));
		});
	});
}

async function runGitText(cwd: string, args: readonly string[], maxBuffer?: number): Promise<string> {
	return (await runGit(cwd, args, maxBuffer)).toString('utf8');
}

export async function repositoryRoot(start: string): Promise<string | undefined> {
	try {
		const root = (await runGitText(start, ['rev-parse', '--show-toplevel'])).trim();
		return root.length > 0 ? root : undefined;
	} catch {
		return undefined;
	}
}

export interface RepositoryStatus {
	branch: string;
	dirtyFiles: number;
}

export async function statusSummary(root: string): Promise<RepositoryStatus> {
	const branch = (await runGitText(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
	const dirty = await runGitText(root, ['status', '--porcelain=v1', '-z']);
	const dirtyFiles = dirty.split('\0').filter(entry => entry.length > 2).length;
	return { branch: branch || 'HEAD', dirtyFiles };
}

export interface LogOptions {
	all?: boolean;
	limit: number;
}

export async function logCommits(root: string, options: LogOptions): Promise<CommitNode[]> {
	const args = [
		'-c', 'core.quotepath=false',
		'--no-pager',
		'log',
		...(options.all ? ['--all'] : []),
		'--date-order',
		'--date=iso-strict',
		`-n${options.limit}`,
		'--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%s%x1e'
	];
	return parseCommitLog(await runGitText(root, args));
}

export async function commitDetails(root: string, sha: string): Promise<CommitDetails | undefined> {
	const raw = await runGitText(root, [
		'-c', 'core.quotepath=false',
		'--no-pager',
		'show',
		'-s',
		'--date=iso-strict',
		'--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%s%x1f%b',
		sha
	]);
	return parseCommitDetails(raw);
}

export async function commitFiles(root: string, sha: string): Promise<FileChange[]> {
	const raw = await runGitText(root, [
		'-c', 'core.quotepath=false',
		'--no-pager',
		'show',
		'--first-parent',
		'--format=',
		'--numstat',
		'-z',
		'--no-ext-diff',
		'--no-color',
		sha
	]);
	return parseNumstat(raw.replace(/^[\r\n]+/, ''));
}

/** The patch of one file in one commit; the caller truncates for display. */
export async function commitPatch(root: string, sha: string, file: string): Promise<string> {
	if (!file || file.includes('\0') || file.startsWith('/') || file.split('/').includes('..')) {
		throw new GitError(`Refusing unsafe repository path: ${file}`);
	}
	return runGitText(root, [
		'-c', 'core.quotepath=false',
		'--no-pager',
		'show',
		'--format=',
		'--no-ext-diff',
		'--no-color',
		sha,
		'--',
		file
	], 8 * 1024 * 1024);
}

export async function blamePorcelain(root: string, file: string): Promise<string> {
	return runGitText(root, ['--no-pager', 'blame', '--line-porcelain', '--', file], 32 * 1024 * 1024);
}
