/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { asArray, asRecord, asString, parseJson } from './json.js';
import { DatabaseSchema, SchemaColumn, SchemaForeignKey, SchemaIndex, SchemaTable } from './migrations.js';

/** Connection metadata and table list from `db:show --json`. */
export interface DatabaseInfo {
	readonly connection: string | undefined;
	readonly name: string | undefined;
	readonly version: string | undefined;
	readonly tables: readonly string[];
}

function stringList(value: unknown): string[] {
	const array = asArray(value);
	if (array) {
		return array.filter((entry): entry is string => typeof entry === 'string');
	}
	const single = asString(value);
	return single ? [single] : [];
}

/**
 * Symfony's column *attributes* come back either as a list or, when the list is
 * sparse, as an object with numeric keys (`{"0":"text","3":"nullable"}`). Both
 * shapes mean the same thing, so they are flattened into one string list.
 */
function attributeList(value: unknown): string[] {
	const array = asArray(value);
	if (array) {
		return array.filter((entry): entry is string => typeof entry === 'string');
	}
	const record = asRecord(value);
	if (!record) {
		return [];
	}
	return Object.keys(record)
		.sort((left, right) => Number(left) - Number(right))
		.map(key => record[key])
		.filter((entry): entry is string => typeof entry === 'string');
}

function parseColumn(value: unknown): SchemaColumn | undefined {
	const record = asRecord(value);
	const name = asString(record?.column);
	if (!record || !name) {
		return undefined;
	}
	const attributes = attributeList(record.attributes);
	const fallback = record.default;
	return {
		name,
		type: asString(record.type) ?? attributes[0] ?? 'unknown',
		nullable: attributes.includes('nullable'),
		default: fallback === null || fallback === undefined ? undefined : String(fallback),
		autoIncrement: attributes.includes('autoincrement')
	};
}

function parseIndex(value: unknown): SchemaIndex | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const columns = stringList(record.columns);
	if (columns.length === 0) {
		return undefined;
	}
	const attributes = attributeList(record.attributes);
	return {
		columns,
		unique: attributes.includes('unique'),
		primary: attributes.includes('primary'),
		name: asString(record.name)
	};
}

function parseForeignKey(value: unknown): SchemaForeignKey | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const columns = stringList(record.columns);
	if (columns.length === 0) {
		return undefined;
	}
	const onDelete = asString(record.on_delete);
	return {
		columns,
		table: asString(record.foreign_table) ?? '',
		references: stringList(record.foreign_columns),
		// `no action` is the engine default, not an explicit constraint.
		onDelete: onDelete && onDelete.toLowerCase() !== 'no action' ? onDelete : undefined
	};
}

function collect<T>(values: unknown, parse: (value: unknown) => T | undefined): T[] {
	return (asArray(values) ?? []).map(parse).filter((entry): entry is T => entry !== undefined);
}

export function parseDbShow(stdout: string): DatabaseInfo | undefined {
	const root = asRecord(parseJson(stdout));
	if (!root) {
		return undefined;
	}
	const platform = asRecord(root.platform);
	return {
		connection: asString(platform?.connection),
		name: asString(platform?.name),
		version: asString(platform?.version),
		tables: (asArray(root.tables) ?? [])
			.map(entry => asString(asRecord(entry)?.table))
			.filter((name): name is string => Boolean(name))
	};
}

/**
 * Reads one table from `db:table <name> --json`. This is the authoritative
 * source for columns, indexes and foreign keys: Blueprint parsing is only a
 * fallback, because the DSL and the migrated database can disagree.
 */
export function parseDbTable(stdout: string, fallbackName?: string): SchemaTable | undefined {
	const root = asRecord(parseJson(stdout));
	if (!root) {
		return undefined;
	}
	const name = asString(asRecord(root.table)?.name) ?? fallbackName;
	if (!name) {
		return undefined;
	}
	return {
		name,
		columns: collect(root.columns, parseColumn),
		indexes: collect(root.indexes, parseIndex),
		foreignKeys: collect(root.foreign_keys, parseForeignKey),
		createdIn: undefined,
		lastChangedIn: undefined,
		dropped: false
	};
}

/**
 * Turns the live schema into a `DatabaseSchema`. The migration declarations are
 * still passed in as a fallback: the database reports what a table *is*, but
 * only the migration history knows where it came from and in which order.
 */
export function buildDatabaseSchema(
	info: DatabaseInfo,
	tables: readonly SchemaTable[],
	fallback?: DatabaseSchema
): DatabaseSchema {
	const provenance = new Map<string, SchemaTable>();
	for (const table of fallback?.tables ?? []) {
		provenance.set(table.name, table);
	}

	return {
		tables: [...tables]
			.map(table => ({
				...table,
				createdIn: provenance.get(table.name)?.createdIn,
				lastChangedIn: provenance.get(table.name)?.lastChangedIn
			}))
			.sort((left, right) => left.name.localeCompare(right.name)),
		migrationCount: fallback?.migrationCount ?? 0,
		timeline: fallback?.timeline ?? [],
		source: 'database',
		connection: info.name ?? info.connection,
		serverVersion: info.version
	};
}
