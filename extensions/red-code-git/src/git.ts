/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { CommitNode, parseCommitLog } from './graph.js';
import { CommitDetails, CommitStats, FileChange, parseCommitDetails, parseLogStats, parseNumstat, parseStatus, WorkingFile } from './log.js';

/**
 * Read-only wrapper around the git CLI for the graph and the blame decorations.
 *
 * Only `rev-parse`, `log`, `show`, `blame`, `status`, `remote`, `for-each-ref`
 * and `config --get` are issued. Nothing runs hooks, filters, a pager or an
 * editor, and the caller never passes a shell string.
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
	files: WorkingFile[];
}

export async function statusSummary(root: string): Promise<RepositoryStatus> {
	const branch = (await runGitText(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
	const dirty = await runGitText(root, ['status', '--porcelain=v1', '-z']);
	const files = parseStatus(dirty);
	return { branch: branch || 'HEAD', dirtyFiles: files.length, files };
}

export type LogScope = 'all' | 'current' | 'local' | 'remote' | 'tags';

export interface LogOptions {
	all?: boolean;
	limit: number;
	/** A branch, tag or SHA to walk instead of the whole repository. */
	rev?: string;
	scope?: LogScope;
}

function scopeArgs(options: LogOptions): string[] {
	if (options.rev) {
		return [options.rev];
	}
	switch (options.scope ?? (options.all === false ? 'current' : 'all')) {
		case 'local': return ['--branches'];
		case 'remote': return ['--remotes'];
		case 'tags': return ['--tags'];
		case 'current': return ['HEAD'];
		default: return ['--all'];
	}
}

const LOG_FORMAT = '%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%ce%x1f%cd%x1f%D%x1f%s%x1e';

function logArgs(options: LogOptions, pretty: string): string[] {
	return [
		'-c', 'core.quotepath=false',
		'--no-pager',
		'log',
		...scopeArgs(options),
		'--date-order',
		'--date=iso-strict',
		`-n${options.limit}`,
		`--pretty=format:${pretty}`
	];
}

export async function logCommits(root: string, options: LogOptions): Promise<CommitNode[]> {
	return parseCommitLog(await runGitText(root, logArgs(options, LOG_FORMAT)));
}

/** Additions and deletions per commit for the rows in the same page. */
export async function commitStats(root: string, options: LogOptions): Promise<Map<string, CommitStats>> {
	const raw = await runGitText(root, [
		...logArgs(options, '%x1e%H'),
		'--numstat',
		'-z',
		'--no-ext-diff',
		'--no-color'
	]);
	return parseLogStats(raw);
}

export interface Branches {
	current: string;
	local: string[];
	remote: string[];
	tags: string[];
}

export async function listBranches(root: string): Promise<Branches> {
	const raw = await runGitText(root, [
		'--no-pager',
		'for-each-ref',
		'--format=%(refname)%09%(HEAD)',
		'refs/heads',
		'refs/remotes',
		'refs/tags'
	]);
	const branches: Branches = { current: '', local: [], remote: [], tags: [] };
	for (const line of raw.split(/\r?\n/)) {
		const [ref, head] = line.split('\t');
		if (!ref) {
			continue;
		}
		if (ref.startsWith('refs/heads/')) {
			const name = ref.slice('refs/heads/'.length);
			branches.local.push(name);
			if (head === '*') {
				branches.current = name;
			}
		} else if (ref.startsWith('refs/remotes/')) {
			const name = ref.slice('refs/remotes/'.length);
			if (!name.endsWith('/HEAD')) {
				branches.remote.push(name);
			}
		} else if (ref.startsWith('refs/tags/')) {
			branches.tags.push(ref.slice('refs/tags/'.length));
		}
	}
	branches.local.sort((left, right) => left.localeCompare(right));
	branches.remote.sort((left, right) => left.localeCompare(right));
	return branches;
}

export async function listRemotes(root: string): Promise<string[]> {
	try {
		const raw = await runGitText(root, ['remote']);
		return raw.split(/\r?\n/).map(value => value.trim()).filter(value => value.length > 0);
	} catch {
		return [];
	}
}

/** SHAs reachable from HEAD, used to dim the rows of other branches. */
export async function headCommits(root: string, limit: number): Promise<Set<string>> {
	const raw = await runGitText(root, ['--no-pager', 'rev-list', `--max-count=${limit}`, 'HEAD']);
	return new Set(raw.split(/\r?\n/).map(value => value.trim()).filter(value => value.length > 0));
}

export async function commitDetails(root: string, sha: string): Promise<CommitDetails | undefined> {
	const raw = await runGitText(root, [
		'-c', 'core.quotepath=false',
		'--no-pager',
		'show',
		'-s',
		'--date=iso-strict',
		'--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%ce%x1f%cd%x1f%D%x1f%s%x1f%b',
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
	guardPath(file);
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

/** File contents at a revision, for the read-only diff editor. */
export async function fileAtRevision(root: string, sha: string, file: string): Promise<string> {
	guardPath(file);
	return runGitText(root, ['-c', 'core.quotepath=false', '--no-pager', 'show', `${sha}:${file}`], 32 * 1024 * 1024);
}

function guardPath(file: string): void {
	if (!file || file.includes('\0') || file.startsWith('/') || file.split('/').includes('..')) {
		throw new GitError(`Refusing unsafe repository path: ${file}`);
	}
}

export async function blamePorcelain(root: string, file: string): Promise<string> {
	return runGitText(root, ['--no-pager', 'blame', '--line-porcelain', '--', file], 32 * 1024 * 1024);
}
