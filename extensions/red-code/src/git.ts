/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';

/**
 * Thin, read-only wrapper around the git CLI.
 *
 * Only fixed, read-only subcommands are issued and none of them run hooks,
 * filters or pagers. Callers pass a repository root and revisions, never a
 * shell string.
 */

const DEFAULT_LIMIT = 32 * 1024 * 1024;
const STDERR_LIMIT = 64 * 1024;

export class GitError extends Error {
	constructor(message: string, readonly exitCode?: number) {
		super(message);
		this.name = 'GitError';
	}
}

export interface CommitInfo {
	readonly sha: string;
	readonly short: string;
	readonly date: string;
	readonly subject: string;
}

export interface TagInfo {
	readonly name: string;
}

interface RunOptions {
	readonly maxBuffer?: number;
}

function gitEnvironment(): NodeJS.ProcessEnv {
	return {
		...process.env,
		// A deployment listing must never open an editor, prompt for a password
		// or take a lock in a repository the user is working in.
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

function runGit(cwd: string, args: readonly string[], options: RunOptions = {}): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let received = 0;
		const limit = options.maxBuffer ?? DEFAULT_LIMIT;
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stderrLength = 0;

		const child = spawn('git', [...args], {
			cwd,
			windowsHide: true,
			env: gitEnvironment()
		});

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
			if (received > limit) {
				child.kill();
				finish(new GitError(`Git output exceeded ${Math.round(limit / (1024 * 1024))} MB. Select a smaller commit range.`));
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

async function runGitText(cwd: string, args: readonly string[], options?: RunOptions): Promise<string> {
	return (await runGit(cwd, args, options)).toString('utf8');
}

/** Refuses paths that could escape the repository when turned into a file URI. */
export function assertRepositoryPath(path: string): void {
	if (!path
		|| path.includes('\0')
		|| path.startsWith('/')
		|| /^[A-Za-z]:/.test(path)
		|| path.split('/').includes('..')
		|| path.split('\\').includes('..')) {
		throw new GitError(`Refusing unsafe repository path: ${path}`);
	}
}

export async function repositoryRoot(start: string): Promise<string | undefined> {
	try {
		const root = (await runGitText(start, ['rev-parse', '--show-toplevel'])).trim();
		return root.length > 0 ? root : undefined;
	} catch {
		return undefined;
	}
}

export async function resolveCommit(root: string, revision: string): Promise<string | undefined> {
	try {
		const sha = (await runGitText(root, ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`])).trim();
		return /^[0-9a-f]{7,64}$/i.test(sha) ? sha : undefined;
	} catch {
		return undefined;
	}
}

export async function headCommit(root: string): Promise<string | undefined> {
	return resolveCommit(root, 'HEAD');
}

export async function listCommits(root: string, limit = 200): Promise<CommitInfo[]> {
	const raw = await runGitText(root, [
		'-c', 'core.quotepath=false',
		'--no-pager',
		'log',
		`-n${limit}`,
		'--date=short',
		'--pretty=format:%H%x1f%h%x1f%ad%x1f%s%x1e'
	]);

	return raw.split('\x1e')
		.map(record => record.replace(/^[\r\n]+/, ''))
		.filter(record => record.length > 0)
		.map(record => {
			const [sha, short, date, subject] = record.split('\x1f');
			return { sha, short, date, subject: subject ?? '' };
		})
		.filter(commit => Boolean(commit.sha && commit.short));
}

export async function listTags(root: string, limit = 30): Promise<TagInfo[]> {
	try {
		const raw = await runGitText(root, ['-c', 'core.quotepath=false', '--no-pager', 'tag', '--sort=-creatordate', '--format=%(refname:short)']);
		return raw.split(/\r?\n/)
			.map(name => name.trim())
			.filter(name => name.length > 0)
			.slice(0, limit)
			.map(name => ({ name }));
	} catch {
		return [];
	}
}

/** `git diff --name-status -z` between two commits, with rename detection. */
export async function diffNameStatus(root: string, from: string, to: string): Promise<string> {
	return runGitText(root, [
		'-c', 'core.quotepath=false',
		'--no-pager',
		'diff',
		'--name-status',
		'-z',
		'-M',
		'--no-ext-diff',
		'--no-color',
		from,
		to
	]);
}

/** A single commit against its first parent; a root commit lists everything. */
export async function commitNameStatus(root: string, sha: string): Promise<string> {
	const raw = await runGitText(root, [
		'-c', 'core.quotepath=false',
		'--no-pager',
		'show',
		'--first-parent',
		'--format=',
		'--name-status',
		'-z',
		'-M',
		'--no-ext-diff',
		'--no-color',
		sha
	]);
	// `show` may emit the empty format's separator before the first entry.
	return raw.replace(/^[\r\n]+/, '');
}

/** Every path that exists in a revision. */
export async function treePaths(root: string, revision: string): Promise<Set<string>> {
	const raw = await runGitText(root, [
		'-c', 'core.quotepath=false',
		'--no-pager',
		'ls-tree',
		'-r',
		'-z',
		'--name-only',
		revision
	]);
	return new Set(raw.split('\0').filter(path => path.length > 0));
}

/** Reads a file from a commit. Never reads the working tree. */
export async function readBlob(root: string, revision: string, path: string): Promise<Buffer> {
	assertRepositoryPath(path);
	return runGit(root, ['cat-file', 'blob', `${revision}:${path}`], { maxBuffer: 256 * 1024 * 1024 });
}

export async function shortSha(root: string, revision: string): Promise<string> {
	try {
		return (await runGitText(root, ['rev-parse', '--short', revision])).trim();
	} catch {
		return revision.slice(0, 7);
	}
}
