/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface BookmarkRecord {
	readonly id: string;
	readonly rootName: string;
	readonly rootIndex: number;
	readonly relativePath: string;
	readonly label: string;
	readonly kind: 'file' | 'folder';
}

export interface WorkspaceRootIdentity {
	readonly name: string;
}

export interface SerializedBookmarkState {
	readonly version: 1;
	readonly entries: readonly BookmarkRecord[];
}

const MAX_BOOKMARKS = 500;
const MAX_LABEL_LENGTH = 256;

export function normalizeRelativePath(value: string): string | undefined {
	const normalized = value.replace(/\\/g, '/');
	if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
		return undefined;
	}

	const segments = normalized.split('/').filter(segment => segment.length > 0 && segment !== '.');
	if (segments.some(segment => segment === '..' || segment.includes('\0'))) {
		return undefined;
	}
	return segments.join('/');
}

export function resolveWorkspaceRoot<T extends WorkspaceRootIdentity>(roots: readonly T[], bookmark: Pick<BookmarkRecord, 'rootName' | 'rootIndex'>): T | undefined {
	const indexedRoot = roots[bookmark.rootIndex];
	if (indexedRoot?.name === bookmark.rootName) {
		return indexedRoot;
	}

	if (roots.length === 1) {
		return roots[0];
	}

	const namedRoots = roots.filter(root => root.name === bookmark.rootName);
	return namedRoots.length === 1 ? namedRoots[0] : undefined;
}

export function parseBookmarkState(value: unknown): BookmarkRecord[] {
	if (!value || typeof value !== 'object') {
		return [];
	}

	const state = value as Partial<SerializedBookmarkState>;
	if (state.version !== 1 || !Array.isArray(state.entries)) {
		return [];
	}

	const entries: BookmarkRecord[] = [];
	const seen = new Set<string>();
	for (const candidate of state.entries.slice(0, MAX_BOOKMARKS)) {
		if (!candidate || typeof candidate !== 'object') {
			continue;
		}
		const entry = candidate as Partial<BookmarkRecord>;
		const relativePath = typeof entry.relativePath === 'string' ? normalizeRelativePath(entry.relativePath) : undefined;
		if (typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 128
			|| typeof entry.rootName !== 'string' || entry.rootName.length === 0 || entry.rootName.length > MAX_LABEL_LENGTH
			|| !Number.isInteger(entry.rootIndex) || (entry.rootIndex as number) < 0
			|| relativePath === undefined
			|| typeof entry.label !== 'string' || entry.label.length === 0 || entry.label.length > MAX_LABEL_LENGTH
			|| (entry.kind !== 'file' && entry.kind !== 'folder')
			|| seen.has(entry.id)) {
			continue;
		}

		seen.add(entry.id);
		entries.push({
			id: entry.id,
			rootName: entry.rootName,
			rootIndex: entry.rootIndex as number,
			relativePath,
			label: entry.label,
			kind: entry.kind
		});
	}
	return entries;
}
