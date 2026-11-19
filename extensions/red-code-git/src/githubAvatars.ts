/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AvatarCommit, GitHubRepository, parseGitHubRemote, planAvatarLookups } from './avatarPlan.js';
import { remoteUrl } from './git.js';

/**
 * GitHub avatars for the commit graph.
 *
 * GitLens asks you to sign in to its own GitHub app. Red Code reuses the GitHub session the
 * built-in authentication extension already provides (the same one Copilot uses): when a session
 * exists it is picked up silently, and when it does not the graph simply keeps the initials.
 * Nothing here ever opens a sign-in prompt.
 *
 * A commit only carries an email, so the avatar is resolved through the public commit API:
 * `GET /repos/{owner}/{repo}/commits/{sha}` returns the GitHub user (and avatar) of the author and
 * committer. Lookups are deduplicated per email and cached, so a page of 300 commits from a
 * handful of authors costs a handful of requests.
 */

const API = 'https://api.github.com';
const CACHE_LIMIT = 1000;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

interface CommitAuthor {
	email?: string;
}

interface GitHubUser {
	login?: string;
	avatar_url?: string;
}

interface CommitResponse {
	author?: GitHubUser | null;
	committer?: GitHubUser | null;
	commit?: {
		author?: CommitAuthor | null;
		committer?: CommitAuthor | null;
	};
}

export class GitHubAvatars implements vscode.Disposable {
	private readonly cache = new Map<string, string>();
	private readonly repositories = new Map<string, GitHubRepository | undefined>();
	private session: vscode.AuthenticationSession | undefined;
	private sessionChecked = false;
	private rateLimitedUntil = 0;
	private disposed = false;

	dispose(): void {
		this.disposed = true;
		this.cache.clear();
		this.repositories.clear();
	}

	/** Drops the resolved avatars, so a refresh picks up a changed GitHub account or remote. */
	clear(): void {
		this.cache.clear();
		this.repositories.clear();
	}

	/** email -> avatar URL for every commit that could be resolved. */
	async resolve(root: string, commits: readonly AvatarCommit[]): Promise<Map<string, string>> {
		const result = new Map<string, string>();
		if (this.disposed || commits.length === 0) {
			return result;
		}

		const repository = await this.repository(root);
		if (!repository) {
			return result;
		}
		const token = await this.accessToken();
		if (!token || Date.now() < this.rateLimitedUntil) {
			return result;
		}

		const planned = planAvatarLookups(commits, this.cache);
		const bySha = new Map<string, string[]>();
		for (const entry of planned) {
			const emails = bySha.get(entry.sha);
			if (emails) {
				emails.push(entry.email);
			} else {
				bySha.set(entry.sha, [entry.email]);
			}
		}

		for (const sha of bySha.keys()) {
			if (this.disposed || Date.now() < this.rateLimitedUntil) {
				break;
			}
			await this.lookup(repository, sha, token);
		}

		for (const commit of commits) {
			const email = commit.email.trim().toLowerCase();
			const avatar = this.cache.get(email);
			if (avatar) {
				result.set(email, avatar);
			}
		}
		return result;
	}

	private async repository(root: string): Promise<GitHubRepository | undefined> {
		if (this.repositories.has(root)) {
			return this.repositories.get(root);
		}
		const url = await remoteUrl(root);
		const repository = url ? parseGitHubRemote(url) : undefined;
		this.repositories.set(root, repository);
		return repository;
	}

	private async accessToken(): Promise<string | undefined> {
		if (this.sessionChecked) {
			return this.session?.accessToken;
		}
		this.sessionChecked = true;
		try {
			// Silent: reuse an existing GitHub session (Copilot creates one), never prompt.
			this.session = await vscode.authentication.getSession('github', ['read:user'], { createIfNone: false, silent: true })
				?? await vscode.authentication.getSession('github', [], { createIfNone: false, silent: true });
		} catch {
			this.session = undefined;
		}
		return this.session?.accessToken;
	}

	private async lookup(repository: GitHubRepository, sha: string, token: string): Promise<void> {
		let response: Response;
		try {
			response = await fetch(`${API}/repos/${repository.owner}/${repository.repo}/commits/${sha}`, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/vnd.github+json',
					'X-GitHub-Api-Version': '2022-11-28',
					'User-Agent': 'red-code-git'
				}
			});
		} catch {
			return;
		}

		if (response.status === 403 || response.status === 429) {
			// Exhausted the API quota; stop calling until the window resets.
			this.rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
			return;
		}
		if (!response.ok) {
			return;
		}

		let body: CommitResponse;
		try {
			body = await response.json() as CommitResponse;
		} catch {
			return;
		}

		this.remember(body.commit?.author?.email, body.author?.avatar_url);
		this.remember(body.commit?.committer?.email, body.committer?.avatar_url);
	}

	private remember(email: string | undefined, avatar: string | undefined): void {
		if (!email || !avatar || !/^https:\/\//i.test(avatar)) {
			return;
		}
		if (!/^https:\/\/avatars\.githubusercontent\.com\//i.test(avatar)) {
			return;
		}
		if (this.cache.size >= CACHE_LIMIT) {
			this.cache.clear();
		}
		this.cache.set(email.trim().toLowerCase(), avatar);
	}
}
