/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure deployment-set logic: turning git name-status output into the exact set
 * of files that must be uploaded (and the set that must be deleted) when a
 * server is moved from one commit to another.
 *
 * Nothing here touches the filesystem or git, so all of it is unit-tested.
 */

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed';

export interface FileChange {
	/** Path in the newer state. For a deletion this is the path that no longer exists. */
	readonly path: string;
	/** Source path of a rename or copy. */
	readonly previousPath?: string;
	readonly status: ChangeStatus;
}

export interface DeploymentSet {
	/** Files to upload, already deduplicated and sorted. */
	readonly files: readonly FileChange[];
	/** Paths that must be removed on the server. */
	readonly deletions: readonly FileChange[];
	/** Changed paths skipped by `redCode.deploy.excludePaths`. */
	readonly excluded: readonly string[];
	readonly changedCount: number;
}

/**
 * These are never part of a deployment: dependencies are installed on the
 * server, storage and cache are machine-local, and `.env` holds secrets that
 * must differ between machines.
 */
export const DEFAULT_EXCLUDES: readonly string[] = [
	'vendor/**',
	'node_modules/**',
	'storage/**',
	'bootstrap/cache/**',
	'.git/**',
	'.env',
	'.env.*',
	'public/hot'
];

const STATUS_BY_LETTER: Readonly<Record<string, ChangeStatus>> = {
	A: 'added',
	M: 'modified',
	D: 'deleted',
	R: 'renamed',
	C: 'copied',
	T: 'type-changed',
	U: 'modified',
	X: 'modified'
};

/**
 * Parses `git diff --name-status -z` output:
 *
 *   M\0app/Foo.php\0
 *   R100\0app/Old.php\0app/New.php\0
 *
 * NUL separation is what makes paths with spaces or newlines safe.
 */
export function parseNameStatus(raw: string): FileChange[] {
	const tokens = raw.split('\0');
	const changes: FileChange[] = [];

	for (let index = 0; index < tokens.length;) {
		const token = tokens[index++].replace(/^[\r\n]+/, '');
		if (!token) {
			continue;
		}

		const letter = token[0];
		const status = STATUS_BY_LETTER[letter];
		if (!status) {
			continue;
		}

		if (letter === 'R' || letter === 'C') {
			const previousPath = tokens[index++];
			const path = tokens[index++];
			if (!previousPath || !path) {
				break;
			}
			changes.push({ path, previousPath, status });
			continue;
		}

		const path = tokens[index++];
		if (!path) {
			break;
		}
		changes.push({ path, status });
	}

	return changes;
}

/**
 * Unions several commits' changes. Later groups win because they are newer, but
 * a `previousPath` found earlier is kept: `rename A→B` followed by `modify B`
 * still has to tell the server that `A` is gone.
 */
export function mergeChanges(...groups: ReadonlyArray<readonly FileChange[]>): FileChange[] {
	const byPath = new Map<string, FileChange>();

	for (const group of groups) {
		for (const change of group) {
			const existing = byPath.get(change.path);
			byPath.set(change.path, existing
				? { ...change, previousPath: change.previousPath ?? existing.previousPath }
				: change);
		}
	}

	return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/** Converts a glob with `**`, `*` and `?` into an anchored regular expression. */
function globToRegExp(pattern: string): RegExp {
	let source = '^';

	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index];
		if (character === '*') {
			if (pattern[index + 1] === '*') {
				if (pattern[index + 2] === '/') {
					// `**/` also matches zero directories.
					source += '(?:.*/)?';
					index += 2;
				} else {
					source += '.*';
					index += 1;
				}
			} else {
				source += '[^/]*';
			}
			continue;
		}
		if (character === '?') {
			source += '[^/]';
			continue;
		}
		if ('\\^$+.()|{}[]'.includes(character)) {
			source += `\\${character}`;
			continue;
		}
		source += character;
	}

	return new RegExp(`${source}$`);
}

export function matchesGlob(pattern: string, path: string): boolean {
	const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '').trim();
	if (!normalizedPattern) {
		return false;
	}
	return globToRegExp(normalizedPattern).test(path.replace(/\\/g, '/'));
}

export function isExcluded(path: string, patterns: readonly string[]): boolean {
	return patterns.some(pattern => matchesGlob(pattern, path));
}

/**
 * Splits changes into uploads and deletions.
 *
 * `sourceTree` is the set of paths that existed before the selection and
 * `targetTree` the set that exists after it. They make renames and
 * add-then-delete cases exact: a path is deleted on the server only when the
 * server could still have it, and uploaded only when the target commit has it.
 * Either may be omitted when the caller cannot compute it.
 */
export function buildDeploymentSet(
	changes: readonly FileChange[],
	excludes: readonly string[],
	sourceTree?: ReadonlySet<string>,
	targetTree?: ReadonlySet<string>
): DeploymentSet {
	const uploads = new Map<string, FileChange>();
	const deletions = new Map<string, FileChange>();
	const excluded = new Set<string>();

	const canUpload = (path: string) => !targetTree || targetTree.has(path);
	const canDelete = (path: string) => (!targetTree || !targetTree.has(path)) && (!sourceTree || sourceTree.has(path));

	for (const change of changes) {
		if (isExcluded(change.path, excludes)) {
			excluded.add(change.path);
			continue;
		}

		if (change.status === 'deleted') {
			if (canDelete(change.path)) {
				deletions.set(change.path, { path: change.path, status: 'deleted' });
			}
			continue;
		}

		if (!canUpload(change.path)) {
			// The file was changed inside the selection but is gone from the
			// target commit; the server must remove it if it ever had it.
			if (canDelete(change.path)) {
				deletions.set(change.path, { path: change.path, status: 'deleted' });
			}
			continue;
		}

		uploads.set(change.path, change);

		if (change.previousPath && canDelete(change.previousPath) && !isExcluded(change.previousPath, excludes)) {
			deletions.set(change.previousPath, { path: change.previousPath, status: 'deleted' });
		}
	}

	// A path that exists at the target is never deleted, even if an older
	// change in the selection removed it at some point.
	for (const path of uploads.keys()) {
		deletions.delete(path);
	}

	return {
		files: [...uploads.values()].sort((left, right) => left.path.localeCompare(right.path)),
		deletions: [...deletions.values()].sort((left, right) => left.path.localeCompare(right.path)),
		excluded: [...excluded].sort(),
		changedCount: changes.length
	};
}

export interface ManifestHeader {
	/** Human-readable selection, for example `main~3..main`. */
	readonly selection: string;
	/** Short SHA of the commit the uploaded files were read from. */
	readonly target: string;
	readonly generatedAt: string;
}

const STATUS_LETTER: Readonly<Record<ChangeStatus, string>> = {
	added: 'A',
	modified: 'M',
	deleted: 'D',
	renamed: 'R',
	copied: 'C',
	'type-changed': 'T'
};

/**
 * Text file that travels inside the exported archive. It is the part that tells
 * the person doing the upload what to delete, which no file list alone can.
 */
export function formatManifest(set: DeploymentSet, header: ManifestHeader): string {
	const lines = [
		'Red Code - deployment set',
		`Selection:    ${header.selection}`,
		`Uploaded at:  ${header.target}`,
		`Generated:    ${header.generatedAt}`,
		'',
		`Upload (${set.files.length})`,
		...set.files.map(file => `${STATUS_LETTER[file.status]}  ${file.path}${file.previousPath ? `   (was ${file.previousPath})` : ''}`),
		'',
		`Delete on server (${set.deletions.length})`,
		...set.deletions.map(file => `D  ${file.path}`),
		''
	];

	if (set.excluded.length > 0) {
		lines.push(`Excluded by settings (${set.excluded.length})`, ...set.excluded.map(path => `-  ${path}`), '');
	}

	lines.push(
		'Notes',
		'- Uploaded files are read from the target commit, not from your working tree.',
		'- All paths are relative to the repository root.',
		'- Delete the paths listed above on the server; they no longer exist at the target commit.'
	);

	return `${lines.join('\n')}\n`;
}
