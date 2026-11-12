/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSameOrDescendantPath, normalizeRelativePath, parseBookmarkState, renameBookmarkPath, resolveWorkspaceRoot } from '../bookmarkModel.js';

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

test('renamed bookmarks follow the file and keep their label in sync', () => {
	const renamed = renameBookmarkPath(validBookmark, 'src/index.ts', 'src/main.ts');
	assert.equal(renamed?.relativePath, 'src/main.ts');
	assert.equal(renamed?.label, 'main.ts');
	assert.equal(renamed?.id, validBookmark.id);
});

test('renaming a folder remaps its bookmarked children and leaves others untouched', () => {
	const child = { ...validBookmark, id: 'bookmark-2', relativePath: 'docs/guide/setup.md', label: 'setup.md' };
	const moved = renameBookmarkPath(child, 'docs', 'documentation');
	assert.equal(moved?.relativePath, 'documentation/guide/setup.md');

	const untouched = renameBookmarkPath(child, 'src', 'source');
	assert.equal(untouched, undefined);
});

test('bookmarks moved to the workspace root stay valid and paths are matched exactly', () => {
	assert.equal(isSameOrDescendantPath('src/lib/file.ts', 'src'), true);
	assert.equal(isSameOrDescendantPath('src', 'src'), true);
	assert.equal(isSameOrDescendantPath('srcthing/file.ts', 'src'), false);

	const folderBookmark = { ...validBookmark, id: 'bookmark-3', relativePath: 'src', label: 'src', kind: 'folder' as const };
	const renamedFolder = renameBookmarkPath(folderBookmark, 'src', 'source');
	assert.equal(renamedFolder?.relativePath, 'source');
	assert.equal(renamedFolder?.label, 'source');
});
