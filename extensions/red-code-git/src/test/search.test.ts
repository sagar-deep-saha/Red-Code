/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatcher, parseSearch, SearchableCommit } from '../search.js';

function commit(subject: string, author = 'Sagar', extra: Partial<SearchableCommit> = {}): SearchableCommit & { date: string } {
	return {
		sha: 'a'.repeat(40),
		short: 'aaaaaaa',
		subject,
		author,
		email: 'sagar@example.test',
		committer: author,
		committerEmail: 'sagar@example.test',
		refs: ['main'],
		parents: ['b'.repeat(40)],
		date: '2026-11-14T10:00:00+05:30',
		...extra
	};
}

test('parseSearch understands field prefixes and negation', () => {
	const parsed = parseSearch('message:login author:sagar -file:x is:merge');
	assert.deepEqual(parsed.clauses.map(clause => [clause.field, clause.value, clause.negate]), [
		['message', 'login', false],
		['author', 'sagar', false],
		['text', 'file:x', true]
	]);
	assert.equal(parsed.mergesOnly, true);
});

test('parseSearch keeps a URL as free text instead of a field', () => {
	const parsed = parseSearch('http://localhost:8000');
	assert.equal(parsed.clauses.length, 1);
	assert.equal(parsed.clauses[0].field, 'text');
	assert.equal(parsed.clauses[0].value, 'http://localhost:8000');
});

test('free text matches the subject and the author', () => {
	assert.equal(createMatcher('login')(commit('Fix login form')), true);
	assert.equal(createMatcher('sagar')(commit('Fix login form')), true);
	assert.equal(createMatcher('missing')(commit('Fix login form')), false);
});

test('field prefixes only search their own field', () => {
	assert.equal(createMatcher('message:login')(commit('Fix login form')), true);
	assert.equal(createMatcher('author:login')(commit('Fix login form')), false);
	assert.equal(createMatcher('committer:sagar')(commit('Fix login form')), true);
	assert.equal(createMatcher('sha:aaaaaaa')(commit('Fix login form')), true);
	assert.equal(createMatcher('ref:main')(commit('Fix login form')), true);
});

test('negation excludes matches', () => {
	assert.equal(createMatcher('-message:login')(commit('Fix login form')), false);
	assert.equal(createMatcher('-message:login')(commit('Update docs')), true);
});

test('match all requires every clause, otherwise any clause wins', () => {
	const row = commit('Fix login form');
	assert.equal(createMatcher('login docs')(row), true);
	assert.equal(createMatcher('login docs', { matchAll: true })(row), false);
	assert.equal(createMatcher('login form', { matchAll: true })(row), true);
});

test('match case and whole word change the result', () => {
	assert.equal(createMatcher('login')(commit('Fix LOGIN')), true);
	assert.equal(createMatcher('login', { matchCase: true })(commit('Fix LOGIN')), false);
	assert.equal(createMatcher('log', { wholeWord: true })(commit('Fix login')), false);
	assert.equal(createMatcher('login', { wholeWord: true })(commit('Fix the login form')), true);
});

test('regular expressions are honoured and invalid ones fall back to text', () => {
	assert.equal(createMatcher('^Fix', { regex: true })(commit('Fix login')), true);
	assert.equal(createMatcher('^Fix', { regex: true })(commit('Re-Fix login')), false);
	assert.equal(createMatcher('(', { regex: true })(commit('Fix (login)')), true);
});

test('is:merge only keeps commits with two parents', () => {
	const merge = commit('Merge branch', 'Sagar', { parents: ['b'.repeat(40), 'c'.repeat(40)] });
	assert.equal(createMatcher('is:merge')(merge), true);
	assert.equal(createMatcher('is:merge')(commit('Normal')), false);
});

test('after: and before: bound the commit date', () => {
	const row = commit('Fix login');
	assert.equal(createMatcher('after:2026-11-01')(row), true);
	assert.equal(createMatcher('before:2026-11-01')(row), false);
	assert.equal(createMatcher('after:2026-11-01 before:2026-12-01')(row), true);
});
