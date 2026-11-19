/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers behind the GitHub avatar lookup. They live in their own module so they can be
 * tested without the `vscode` runtime.
 */

export interface GitHubRepository {
	owner: string;
	repo: string;
}

export interface AvatarCommit {
	sha: string;
	email: string;
}

/** Reads `owner/repo` from an https or ssh GitHub remote URL. */
export function parseGitHubRemote(url: string): GitHubRepository | undefined {
	const value = url.trim();
	if (value.length === 0) {
		return undefined;
	}

	let pathname: string | undefined;
	const scp = /^(?:[^@/]+@)?github\.com:(.+)$/i.exec(value);
	if (scp) {
		pathname = scp[1];
	} else {
		let parsed: URL;
		try {
			parsed = new URL(value);
		} catch {
			return undefined;
		}
		if (!/^(?:www\.)?github\.com$/i.test(parsed.hostname)) {
			return undefined;
		}
		pathname = parsed.pathname;
	}

	const parts = pathname.replace(/^\/+/, '').replace(/\.git$/i, '').split('/').filter(part => part.length > 0);
	if (parts.length < 2) {
		return undefined;
	}
	return { owner: parts[0], repo: parts[1] };
}

/**
 * Works out which commits have to be looked up: one commit per distinct email that is not cached
 * yet. Requests are keyed by commit, so two emails that share a commit cost one request.
 */
export function planAvatarLookups(commits: readonly AvatarCommit[], cached: ReadonlyMap<string, string>): AvatarCommit[] {
	const seen = new Set<string>();
	const planned: AvatarCommit[] = [];
	for (const commit of commits) {
		const email = commit.email.trim().toLowerCase();
		if (email.length === 0 || seen.has(email) || cached.has(email)) {
			continue;
		}
		seen.add(email);
		planned.push({ sha: commit.sha, email });
	}
	return planned;
}
