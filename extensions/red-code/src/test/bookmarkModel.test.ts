/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRelativePath, parseBookmarkState, resolveWorkspaceRoot } from '../bookmarkModel.js';

const validBookmark = {
	id: 'bookmark-1',
	rootName: 'project',
	rootIndex: 0,
	relativePath: 'src/index.ts',
	label: 'index.ts',
	kind: 'file' as const
};

test('bookmark paths are normalized and reject traversal or absolute paths', () => {
	assert.equal(normalizeRelativePath('src\\lib\\..\\index.ts'), undefined);
	assert.equal(normalizeRelativePath('../outside.txt'), undefined);
	assert.equal(normalizeRelativePath('/outside.txt'), undefined);
	assert.equal(normalizeRelativePath('src/./index.ts'), 'src/index.ts');
});

test('bookmark state discards invalid entries and duplicate ids', () => {
	const state = parseBookmarkState({
		version: 1,
		entries: [validBookmark, { ...validBookmark, relativePath: '../outside' }, validBookmark]
	});
	assert.deepEqual(state, [validBookmark]);
});

test('bookmark roots survive a single-folder rename and resolve uniquely by name in multi-root workspaces', () => {
	const renamedSingleRoot = resolveWorkspaceRoot([{ name: 'renamed-project' }], { rootName: 'project', rootIndex: 0 });
	const namedMultiRoot = resolveWorkspaceRoot([{ name: 'api' }, { name: 'web' }], { rootName: 'web', rootIndex: 0 });
	const ambiguousMultiRoot = resolveWorkspaceRoot([{ name: 'api' }, { name: 'api' }], { rootName: 'api', rootIndex: 2 });
	assert.deepEqual([renamedSingleRoot?.name, namedMultiRoot?.name, ambiguousMultiRoot], ['renamed-project', 'web', undefined]);
});
