/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const SETTINGS_FILE = 'red-code-settings.json';
export const KEYBINDINGS_FILE = 'red-code-keybindings.json';
export const SNIPPETS_FILE = 'red-code-snippets.json';
export const EXTENSIONS_FILE = 'red-code-extensions.json';
export const MANIFEST_FILE = 'red-code-manifest.json';

export const SCHEMA_VERSION = 1;

export interface SyncManifest {
	readonly schemaVersion: number;
	readonly revision: number;
	readonly updatedAt: string;
	readonly device: string;
	readonly editorVersion: string;
}

export interface SyncSnapshot {
	readonly settings: Readonly<Record<string, unknown>>;
	readonly keybindings: string | undefined;
	readonly snippets: Readonly<Record<string, string>>;
	readonly extensions: readonly string[];
}

export interface GistFileContent {
	readonly content: string;
}

export interface GistFile {
	readonly content?: string;
	readonly truncated?: boolean;
}

export interface FilteredSettings {
	readonly settings: Record<string, unknown>;
	readonly excluded: string[];
	readonly secretLike: string[];
}

/**
 * Credential-shaped keys are withheld by default. Settings are stored in a
 * private Gist, but a private Gist is still a copy on GitHub, and users
 * routinely paste API keys into settings without thinking about it.
 */
const SECRET_KEY_PATTERN = /(?:api[-_]?key|apikey|access[-_]?key|token|secret|password|passwd|credential|private[-_]?key)s?$/i;

export function isSecretLikeKey(key: string): boolean {
	return SECRET_KEY_PATTERN.test(key);
}

/**
 * `*` matches a prefix; everything else is an exact key. Exclusion is applied
 * before the secret check so a broad prefix cannot be re-enabled by accident.
 */
export function matchesExclusion(key: string, patterns: readonly string[]): boolean {
	return patterns.some(pattern => {
		const trimmed = pattern.trim();
		if (!trimmed) {
			return false;
		}
		if (trimmed.endsWith('*')) {
			return key.startsWith(trimmed.slice(0, -1));
		}
		return key === trimmed;
	});
}

export function filterSettings(
	settings: Readonly<Record<string, unknown>>,
	excludedPatterns: readonly string[],
	includeSecretLike: boolean
): FilteredSettings {
	const kept: Record<string, unknown> = {};
	const excluded: string[] = [];
	const secretLike: string[] = [];

	for (const [key, value] of Object.entries(settings)) {
		if (matchesExclusion(key, excludedPatterns)) {
			excluded.push(key);
			continue;
		}
		if (!includeSecretLike && isSecretLikeKey(key)) {
			secretLike.push(key);
			continue;
		}
		kept[key] = value;
	}

	return { settings: kept, excluded, secretLike };
}

export function buildManifest(
	previous: SyncManifest | undefined,
	device: string,
	editorVersion: string,
	now = new Date()
): SyncManifest {
	return {
		schemaVersion: SCHEMA_VERSION,
		revision: (previous?.revision ?? 0) + 1,
		updatedAt: now.toISOString(),
		device,
		editorVersion
	};
}

/**
 * Gist file set. Every file is a small JSON or raw-text document so a gist
 * stays readable on github.com without the extension.
 */
export function buildGistFiles(snapshot: SyncSnapshot, manifest: SyncManifest): Record<string, GistFileContent> {
	const files: Record<string, GistFileContent> = {
		[SETTINGS_FILE]: { content: `${JSON.stringify(snapshot.settings, null, '\t')}\n` },
		[MANIFEST_FILE]: { content: `${JSON.stringify(manifest, null, '\t')}\n` }
	};

	if (snapshot.keybindings !== undefined) {
		files[KEYBINDINGS_FILE] = { content: snapshot.keybindings };
	}
	if (Object.keys(snapshot.snippets).length > 0) {
		files[SNIPPETS_FILE] = { content: `${JSON.stringify(snapshot.snippets, null, '\t')}\n` };
	}
	if (snapshot.extensions.length > 0) {
		files[EXTENSIONS_FILE] = { content: `${JSON.stringify({ extensions: snapshot.extensions }, null, '\t')}\n` };
	}

	return files;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function parseManifest(text: string | undefined): SyncManifest | undefined {
	if (!text) {
		return undefined;
	}
	const record = asRecord(safeParse(text));
	if (!record) {
		return undefined;
	}
	const revision = record.revision;
	const updatedAt = record.updatedAt;
	const device = record.device;
	const editorVersion = record.editorVersion;
	if (typeof revision !== 'number' || !Number.isFinite(revision) || revision < 1) {
		return undefined;
	}
	if (typeof updatedAt !== 'string' || typeof device !== 'string' || typeof editorVersion !== 'string') {
		return undefined;
	}
	return {
		schemaVersion: typeof record.schemaVersion === 'number' ? record.schemaVersion : SCHEMA_VERSION,
		revision,
		updatedAt,
		device,
		editorVersion
	};
}

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * Reads a gist back into a snapshot. Truncated files are rejected instead of
 * applying half of the user's configuration.
 */
export function parseGistFiles(files: Readonly<Record<string, GistFile>> | undefined): { snapshot: SyncSnapshot; manifest: SyncManifest } | undefined {
	if (!files) {
		return undefined;
	}

	for (const name of [SETTINGS_FILE, MANIFEST_FILE]) {
		const file = files[name];
		if (!file || file.truncated || typeof file.content !== 'string') {
			return undefined;
		}
	}

	const manifest = parseManifest(files[MANIFEST_FILE]?.content);
	const settings = asRecord(safeParse(files[SETTINGS_FILE]?.content ?? ''));
	if (!manifest || !settings) {
		return undefined;
	}

	let snippets: Record<string, string> = {};
	const snippetsFile = files[SNIPPETS_FILE];
	if (snippetsFile && !snippetsFile.truncated && typeof snippetsFile.content === 'string') {
		const parsed = asRecord(safeParse(snippetsFile.content));
		if (parsed) {
			for (const [name, content] of Object.entries(parsed)) {
				if (typeof content === 'string') {
					snippets[name] = content;
				}
			}
		}
	}

	let extensions: string[] = [];
	const extensionsFile = files[EXTENSIONS_FILE];
	if (extensionsFile && !extensionsFile.truncated && typeof extensionsFile.content === 'string') {
		const parsed = asRecord(safeParse(extensionsFile.content));
		const list = Array.isArray(parsed?.extensions) ? parsed.extensions : [];
		extensions = list.filter((value): value is string => typeof value === 'string' && value.includes('.'));
	}

	const keybindingsFile = files[KEYBINDINGS_FILE];
	const keybindings = keybindingsFile && !keybindingsFile.truncated && typeof keybindingsFile.content === 'string'
		? keybindingsFile.content
		: undefined;

	return {
		snapshot: { settings, keybindings, snippets, extensions },
		manifest
	};
}

export function normalizeExtensionId(id: string): string {
	return id.trim().toLowerCase();
}

/**
 * `missing` are extensions the remote has and this machine does not;
 * `extra` are installed here but absent from the snapshot.
 */
export function extensionDiff(local: readonly string[], remote: readonly string[]): { missing: string[]; extra: string[] } {
	const localIds = new Set(local.map(normalizeExtensionId));
	const remoteIds = new Set(remote.map(normalizeExtensionId));

	return {
		missing: remote.filter(id => !localIds.has(normalizeExtensionId(id))),
		extra: local.filter(id => !remoteIds.has(normalizeExtensionId(id)))
	};
}

export function shouldPull(remote: SyncManifest | undefined, lastRevision: number): boolean {
	return Boolean(remote && remote.revision > lastRevision);
}

export function describeSnapshot(snapshot: SyncSnapshot): string {
	const settings = Object.keys(snapshot.settings).length;
	const snippets = Object.keys(snapshot.snippets).length;
	return `${settings} settings · ${snapshot.keybindings !== undefined ? 'keybindings' : 'no keybindings'} · ${snippets} snippet files · ${snapshot.extensions.length} extensions`;
}
