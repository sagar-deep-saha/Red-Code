/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GistFile } from './payload.js';

const API = 'https://api.github.com';
const USER_AGENT = 'Red-Code-Sync';

export class GistError extends Error {
	constructor(message: string, readonly status: number, readonly details?: string) {
		super(message);
		this.name = 'GistError';
	}
}

export interface Gist {
	readonly id: string;
	readonly description?: string;
	readonly public?: boolean;
	readonly html_url?: string;
	readonly updated_at?: string;
	readonly files?: Record<string, GistFile>;
}

export interface GitHubUser {
	readonly login: string;
	readonly name?: string;
}

type GistFilePayload = { readonly content: string } | null;

function messageFor(status: number): string {
	switch (status) {
		case 401:
			return 'GitHub rejected the token. Sign in again.';
		case 403:
			return 'GitHub refused the request. The token may be missing the gist scope, or the API rate limit was reached.';
		case 404:
			return 'The sync Gist was not found. It may have been deleted, or the token cannot see it.';
		case 422:
			return 'GitHub rejected the sync data.';
		default:
			return `GitHub returned HTTP ${status}.`;
	}
}

/**
 * GitHub answers most validation failures with a `message` plus a structured
 * `errors` array. Keeping that text makes a failure diagnosable instead of a
 * bare "GitHub rejected the sync data".
 */
export function describeFailure(text: string): string | undefined {
	if (!text) {
		return undefined;
	}
	try {
		const body = JSON.parse(text) as { message?: unknown; errors?: unknown };
		const parts: string[] = [];
		if (typeof body.message === 'string' && body.message.length > 0) {
			parts.push(body.message);
		}
		if (Array.isArray(body.errors)) {
			for (const entry of body.errors) {
				if (entry === null || typeof entry !== 'object') {
					continue;
				}
				const record = entry as { resource?: unknown; field?: unknown; code?: unknown; message?: unknown };
				const pieces = [record.resource, record.field].filter((value): value is string => typeof value === 'string' && value.length > 0);
				const code = typeof record.code === 'string' && record.code.length > 0
					? record.code
					: typeof record.message === 'string' ? record.message : undefined;
				if (pieces.length > 0 || code) {
					parts.push(`${pieces.join('.') || 'error'}${code ? `: ${code}` : ''}`);
				}
			}
		}
		return parts.length > 0 ? parts.join(' — ') : undefined;
	} catch {
		return undefined;
	}
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(`${API}${path}`, {
		...init,
		headers: {
			accept: 'application/vnd.github+json',
			'user-agent': USER_AGENT,
			'x-github-api-version': '2022-11-28',
			authorization: `Bearer ${token}`,
			...init.headers
		},
		signal: AbortSignal.timeout(20_000)
	});

	const text = await response.text();
	if (!response.ok) {
		const details = describeFailure(text);
		const message = messageFor(response.status);
		throw new GistError(details ? `${message} (${details})` : message, response.status, details);
	}
	return (text ? JSON.parse(text) : undefined) as T;
}

export function getAuthenticatedUser(token: string): Promise<GitHubUser> {
	return request<GitHubUser>(token, '/user');
}

export function createGist(token: string, description: string, files: Record<string, GistFilePayload>): Promise<Gist> {
	return request<Gist>(token, '/gists', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ description, public: false, files })
	});
}

/**
 * Updating a gist replaces only the files that are sent. Files that are no
 * longer part of the snapshot must be sent as `null`, otherwise a removed
 * keybindings file would linger forever.
 */
export function updateGist(token: string, id: string, files: Record<string, GistFilePayload>): Promise<Gist> {
	return request<Gist>(token, `/gists/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ files })
	});
}

export function getGist(token: string, id: string): Promise<Gist> {
	return request<Gist>(token, `/gists/${encodeURIComponent(id)}`);
}

export async function listGists(token: string, pages = 3): Promise<Gist[]> {
	const all: Gist[] = [];
	for (let page = 1; page <= pages; page++) {
		const batch = await request<Gist[]>(token, `/gists?per_page=100&page=${page}`);
		all.push(...batch);
		if (batch.length < 100) {
			break;
		}
	}
	return all;
}

export function gistWebUrl(gist: Gist): string | undefined {
	return gist.html_url && /^https:\/\/gist\.github\.com\//.test(gist.html_url) ? gist.html_url : undefined;
}
