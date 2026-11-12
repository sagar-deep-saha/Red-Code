/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Dotenv keys are `KEY=value` lines. Keys follow the uppercase convention, so
 * a line whose key is not `[A-Z0-9_]+` is ignored rather than mis-reported.
 */
const KEY_LINE = /^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/;

export interface EnvEntry {
	readonly key: string;
	/** Non-empty value. The value itself is never retained. */
	readonly hasValue: boolean;
	readonly lineNumber: number;
}

export interface EnvFileModel {
	readonly entries: readonly EnvEntry[];
	readonly keys: ReadonlySet<string>;
	readonly duplicates: readonly string[];
}

export type EnvRowStatus = 'missing' | 'extra' | 'empty' | 'duplicate';

export interface EnvRow {
	readonly key: string;
	readonly status: EnvRowStatus;
	readonly lineNumber: number;
}

export interface EnvDiff {
	/** Present in the example, absent from the env file. */
	readonly missing: readonly EnvRow[];
	/** Present in the env file, absent from the example. */
	readonly extra: readonly EnvRow[];
	readonly duplicates: readonly EnvRow[];
}

/**
 * Reads key names and whether they carry a value. Values are inspected only to
 * answer `hasValue` and are never returned, so no secret can leak into a view.
 */
export function parseEnvFile(text: string): EnvFileModel {
	const entries: EnvEntry[] = [];
	const counts = new Map<string, number>();

	for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}
		const match = KEY_LINE.exec(line);
		if (!match) {
			continue;
		}
		const key = match[1];
		entries.push({ key, hasValue: hasValue(match[2]), lineNumber: index + 1 });
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	const duplicates = [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([key]) => key)
		.sort();

	return { entries, keys: new Set(entries.map(entry => entry.key)), duplicates };
}

function hasValue(rawValue: string): boolean {
	let value = rawValue.trim();
	const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
	if (quoted) {
		value = quoted[2];
	} else {
		const comment = value.indexOf(' #');
		if (comment >= 0) {
			value = value.slice(0, comment);
		}
	}
	return value.trim().length > 0;
}

/** Compares a parsed env file against its example and reports only key names. */
export function diffEnv(env: EnvFileModel, example: EnvFileModel): EnvDiff {
	const envKeys = env.keys;
	const exampleKeys = example.keys;
	const firstEntry = new Map<string, EnvEntry>();
	for (const entry of env.entries) {
		if (!firstEntry.has(entry.key)) {
			firstEntry.set(entry.key, entry);
		}
	}

	const missing = dedupeFirst(example.entries
		.filter(entry => !envKeys.has(entry.key))
		.map(entry => ({ key: entry.key, status: 'missing' as const, lineNumber: entry.lineNumber })));

	const extra = dedupeFirst(env.entries
		.filter(entry => !exampleKeys.has(entry.key))
		.map(entry => toExtraRow(entry, env.duplicates)));

	const duplicates = env.duplicates.map(key => ({
		key,
		status: 'duplicate' as const,
		lineNumber: firstEntry.get(key)?.lineNumber ?? 0
	}));

	return { missing, extra, duplicates };
}

/** A repeated key is reported once, at its first occurrence. */
function dedupeFirst(rows: readonly EnvRow[]): EnvRow[] {
	const seen = new Set<string>();
	const result: EnvRow[] = [];
	for (const row of rows) {
		if (!seen.has(row.key)) {
			seen.add(row.key);
			result.push(row);
		}
	}
	return result;
}

function toExtraRow(entry: EnvEntry, duplicates: readonly string[]): EnvRow {
	if (duplicates.includes(entry.key)) {
		return { key: entry.key, status: 'duplicate', lineNumber: entry.lineNumber };
	}
	return { key: entry.key, status: entry.hasValue ? 'extra' : 'empty', lineNumber: entry.lineNumber };
}

/**
 * Appends `KEY=` lines for the given keys, one blank line apart, reusing the
 * file's existing EOL so the diff of the edit stays a single addition.
 */
export function appendMissingKeys(existingText: string, keys: readonly string[]): string {
	if (keys.length === 0) {
		return existingText;
	}
	const eol = existingText.includes('\r\n') ? '\r\n' : '\n';
	let result = existingText;
	if (result.length > 0 && !result.endsWith(eol)) {
		result += eol;
	}
	return result + keys.map(key => `${key}=${eol}`).join(eol);
}
