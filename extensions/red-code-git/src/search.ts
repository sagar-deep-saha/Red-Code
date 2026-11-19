/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Commit search: the GitLens-style field prefixes and match options. This module
 * is pure so the parser and matcher are covered by `node --test`.
 */

export interface SearchOptions {
	matchCase?: boolean;
	wholeWord?: boolean;
	regex?: boolean;
	matchAll?: boolean;
}

export interface SearchableCommit {
	sha: string;
	short: string;
	subject: string;
	author: string;
	email: string;
	committer: string;
	committerEmail: string;
	refs: readonly string[];
	parents: readonly string[];
}

type Field = 'text' | 'message' | 'author' | 'committer' | 'sha' | 'ref';

interface Clause {
	field: Field;
	value: string;
	negate: boolean;
}

export interface ParsedSearch {
	clauses: Clause[];
	mergesOnly: boolean;
	hasQuery: boolean;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PREFIXES: Record<string, Field> = {
	message: 'message',
	commit: 'message',
	author: 'author',
	committer: 'committer',
	sha: 'sha',
	ref: 'ref',
	refs: 'ref'
};

function unquote(value: string): string {
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1);
	}
	return value;
}

/**
 * Splits a query into field clauses. Unknown `field:value` pairs are treated as
 * free text so a search for `http://x` is not swallowed. `is:merge` and
 * `type:merge` restrict the result to merge commits; `-field:value` negates.
 */
export function parseSearch(input: string): ParsedSearch {
	const clauses: Clause[] = [];
	let mergesOnly = false;
	let hasQuery = false;

	for (const rawToken of tokenize(input)) {
		const token = unquote(rawToken);
		if (token.length === 0) {
			continue;
		}

		const negate = token.startsWith('-') && token.length > 1;
		const value = negate ? token.slice(1) : token;
		const separator = value.indexOf(':');
		if (separator > 0) {
			const name = value.slice(0, separator).toLowerCase();
			const rest = value.slice(separator + 1);
			if ((name === 'is' || name === 'type') && rest.toLowerCase() === 'merge') {
				mergesOnly = true;
				hasQuery = true;
				continue;
			}
			const field = PREFIXES[name];
			if (field && rest.length > 0) {
				clauses.push({ field, value: rest, negate });
				hasQuery = true;
				continue;
			}
		}

		clauses.push({ field: 'text', value, negate });
		hasQuery = true;
	}

	return { clauses, mergesOnly, hasQuery };
}

function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let quoted = false;
	for (const character of input) {
		if (character === '"') {
			quoted = !quoted;
			current += character;
			continue;
		}
		if (!quoted && /\s/.test(character)) {
			if (current.length > 0) {
				tokens.push(current);
				current = '';
			}
			continue;
		}
		current += character;
	}
	if (current.length > 0) {
		tokens.push(current);
	}
	return tokens;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makePattern(value: string, options: SearchOptions): RegExp | undefined {
	if (value.length === 0) {
		return undefined;
	}
	const source = options.regex ? value : escapeRegExp(value);
	const wrapped = options.wholeWord ? `\\b(?:${source})\\b` : source;
	try {
		return new RegExp(wrapped, options.matchCase ? '' : 'i');
	} catch {
		// An invalid regular expression falls back to a literal search instead of failing.
		try {
			return new RegExp(escapeRegExp(value), options.matchCase ? '' : 'i');
		} catch {
			return undefined;
		}
	}
}

function haystack(commit: SearchableCommit, field: Field): string {
	switch (field) {
		case 'message': return `${commit.subject}`;
		case 'author': return `${commit.author} <${commit.email}>`;
		case 'committer': return `${commit.committer} <${commit.committerEmail}>`;
		case 'sha': return commit.sha;
		case 'ref': return commit.refs.join(' ');
		default: return `${commit.subject} ${commit.author} ${commit.email} ${commit.committer} ${commit.committerEmail} ${commit.short} ${commit.sha} ${commit.refs.join(' ')}`;
	}
}

function isDatePrefix(token: string): boolean {
	const value = token.toLowerCase();
	return value.startsWith('after:') || value.startsWith('before:');
}

function dateBound(token: string): number {
	const value = token.slice(token.indexOf(':') + 1);
	const match = ISO_DATE.exec(value);
	if (!match) {
		return Number.NaN;
	}
	return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Returns a predicate that applies the parsed query and match options. */
export function createMatcher(input: string, options: SearchOptions = {}): (commit: SearchableCommit) => boolean {
	// Date prefixes are handled separately because they need the commit date.
	const after: number[] = [];
	const before: number[] = [];
	for (const token of tokenize(input)) {
		if (!isDatePrefix(token)) {
			continue;
		}
		const bound = dateBound(token);
		if (Number.isNaN(bound)) {
			continue;
		}
		if (token.toLowerCase().startsWith('after:')) {
			after.push(bound);
		} else {
			before.push(bound + 86400000);
		}
	}
	const parsed = parseSearch(input.replace(/\b(after|before):\S+/gi, ''));
	const matchers = parsed.clauses.map(clause => ({ clause, pattern: makePattern(clause.value, options) }));

	return (commit: SearchableCommit & { date?: string }) => {
		if (parsed.mergesOnly && commit.parents.length < 2) {
			return false;
		}
		if (after.length > 0 || before.length > 0) {
			const time = commit.date ? new Date(commit.date).getTime() : Number.NaN;
			if (Number.isNaN(time)) {
				return false;
			}
			if (after.some(bound => time < bound) || before.some(bound => time >= bound)) {
				return false;
			}
		}
		if (matchers.length === 0) {
			return parsed.hasQuery ? parsed.mergesOnly || after.length > 0 || before.length > 0 : true;
		}

		const results = matchers.map(({ clause, pattern }) => {
			if (!pattern) {
				return !clause.negate;
			}
			const matched = pattern.test(haystack(commit, clause.field));
			return clause.negate ? !matched : matched;
		});
		return options.matchAll ? results.every(Boolean) : results.some(Boolean);
	};
}

/** Counts how many commits match; used for the search result counter. */
export function countMatches<T extends SearchableCommit & { date?: string }>(commits: readonly T[], matcher: (commit: T) => boolean): number {
	let count = 0;
	for (const commit of commits) {
		if (matcher(commit)) {
			count += 1;
		}
	}
	return count;
}
