/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SourceLocation } from './graph.js';
import { tableForForeignKeyColumn } from './models.js';

export interface SchemaColumn {
	readonly name: string;
	/** Display type, e.g. `varchar(255)`, `bigint unsigned`. */
	readonly type: string;
	readonly nullable: boolean;
	readonly default: string | undefined;
	readonly autoIncrement: boolean;
}

export interface SchemaIndex {
	readonly columns: readonly string[];
	readonly unique: boolean;
	readonly primary: boolean;
	readonly name: string | undefined;
}

export interface SchemaForeignKey {
	readonly columns: readonly string[];
	readonly table: string;
	readonly references: readonly string[];
	readonly onDelete: string | undefined;
}

export interface SchemaTable {
	readonly name: string;
	readonly columns: readonly SchemaColumn[];
	readonly indexes: readonly SchemaIndex[];
	readonly foreignKeys: readonly SchemaForeignKey[];
	/** Migration that first created the table. */
	readonly createdIn: SourceLocation | undefined;
	/** Last migration that altered it. */
	readonly lastChangedIn: SourceLocation | undefined;
	readonly dropped: boolean;
}

export type MigrationEffectKind = 'created' | 'altered' | 'dropped';

export interface MigrationEffect {
	readonly table: string;
	readonly effect: MigrationEffectKind;
}

export interface MigrationTimelineEntry {
	readonly file: string;
	/** Timestamp encoded in the file name, e.g. `2026_01_01_000001`. */
	readonly timestamp: string | undefined;
	/** Readable name derived from the file name, e.g. `create posts table`. */
	readonly name: string;
	readonly effects: readonly MigrationEffect[];
}

export interface DatabaseSchema {
	readonly tables: readonly SchemaTable[];
	readonly migrationCount: number;
	/** Every migration in execution (file name) order, with its table effects. */
	readonly timeline: readonly MigrationTimelineEntry[];
	/** `database` when read from the live connection, `migrations` when parsed. */
	readonly source: SchemaSource;
	/** Connection name/driver reported by `db:show`, when the source is `database`. */
	readonly connection?: string;
	readonly serverVersion?: string;
}

export type SchemaSource = 'database' | 'migrations';

export interface MigrationFile {
	readonly file: string;
	readonly text: string;
}

interface MutableTable {
	name: string;
	columns: SchemaColumn[];
	indexes: SchemaIndex[];
	foreignKeys: SchemaForeignKey[];
	createdIn: SourceLocation | undefined;
	lastChangedIn: SourceLocation | undefined;
	dropped: boolean;
}

const CREATE_OR_ALTER = /Schema::(create|table)\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:static\s+)?(?:function\s*\([^)]*\)|fn\s*\([^)]*\))\s*(?::\s*[^{]+)?\{/g;
const DROP_TABLE = /Schema::drop(?:IfExists)?\s*\(\s*['"]([^'"]+)['"]/g;
const STATEMENT = /\$table\s*->\s*([A-Za-z_]\w*)\s*\(/g;

/** Types that are really a shorthand for several columns. */
const TIMESTAMP_HELPERS = new Set(['timestamps', 'timestampsTz']);
const SOFT_DELETE_HELPERS = new Set(['softDeletes', 'softDeletesTz', 'softDeletesDatetime']);
const ID_HELPERS = new Set(['id', 'bigIncrements']);
const INCREMENT_HELPERS = new Set(['increments', 'mediumIncrements', 'smallIncrements', 'tinyIncrements']);

export function lineAt(text: string, index: number): number {
	let line = 1;
	for (let position = 0; position < index && position < text.length; position++) {
		if (text.charCodeAt(position) === 10) {
			line++;
		}
	}
	return line;
}

/** Index of the `}` matching the `{` at `open`, ignoring quoted strings. */
export function matchingBrace(text: string, open: number): number {
	let depth = 0;
	let quote: string | undefined;
	for (let index = open; index < text.length; index++) {
		const character = text[index];
		if (quote) {
			if (character === '\\') {
				index++;
			} else if (character === quote) {
				quote = undefined;
			}
			continue;
		}
		if (character === '\'' || character === '"') {
			quote = character;
			continue;
		}
		if (character === '{') {
			depth++;
		} else if (character === '}') {
			depth--;
			if (depth === 0) {
				return index;
			}
		}
	}
	return text.length - 1;
}

function firstQuoted(segment: string): string | undefined {
	const match = /['"]([^'"]+)['"]/.exec(segment);
	return match?.[1];
}

function quotedList(segment: string): string[] {
	const values: string[] = [];
	const pattern = /['"]([^'"]+)['"]/g;
	let match = pattern.exec(segment);
	while (match) {
		values.push(match[1]);
		match = pattern.exec(segment);
	}
	return values;
}

function argumentsOf(statement: string, methodStart: number): { args: string; tail: string } {
	// `methodStart` points at the `$table->method(` match start.
	const open = statement.indexOf('(', methodStart);
	if (open < 0) {
		return { args: '', tail: '' };
	}
	let depth = 0;
	let quote: string | undefined;
	let close = -1;
	for (let index = open; index < statement.length; index++) {
		const character = statement[index];
		if (quote) {
			if (character === '\\') {
				index++;
			} else if (character === quote) {
				quote = undefined;
			}
			continue;
		}
		if (character === '\'' || character === '"') {
			quote = character;
			continue;
		}
		if (character === '(') {
			depth++;
		} else if (character === ')') {
			depth--;
			if (depth === 0) {
				close = index;
				break;
			}
		}
	}
	if (close < 0) {
		return { args: statement.slice(open + 1), tail: '' };
	}
	return { args: statement.slice(open + 1, close), tail: statement.slice(close + 1) };
}

function defaultOf(tail: string): string | undefined {
	const match = /->\s*default\s*\(([^)]*)\)/.exec(tail);
	if (!match) {
		return undefined;
	}
	return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function isNullable(tail: string): boolean {
	return /->\s*nullable\s*\(/.test(tail);
}

function tableFor(statement: string, fallback: string): string {
	const constrained = /->\s*constrained\s*\(\s*(?:['"]([^'"]+)['"])?/.exec(statement);
	if (constrained) {
		return constrained[1] ?? fallback;
	}
	const references = /->\s*references\s*\(([^)]*)\)\s*->\s*on\s*\(\s*['"]([^'"]+)['"]/.exec(statement);
	return references?.[2] ?? fallback;
}

function onDeleteOf(statement: string): string | undefined {
	const match = /->\s*(cascadeOnDelete|nullOnDelete|restrictOnDelete|noActionOnDelete)\s*\(/.exec(statement);
	return match?.[1].replace(/OnDelete$/, '');
}

function addColumn(table: MutableTable, column: SchemaColumn): void {
	const existing = table.columns.findIndex(candidate => candidate.name === column.name);
	if (existing >= 0) {
		table.columns[existing] = column;
	} else {
		table.columns.push(column);
	}
}

function addIndex(table: MutableTable, columns: readonly string[], unique: boolean, primary: boolean, name?: string): void {
	if (columns.length === 0) {
		return;
	}
	const signature = `${primary ? 'p' : unique ? 'u' : 'i'}:${columns.join(',')}`;
	const known = table.indexes.some(index => `${index.primary ? 'p' : index.unique ? 'u' : 'i'}:${index.columns.join(',')}` === signature);
	if (!known) {
		table.indexes.push({ columns, unique, primary, name });
	}
}

const MIGRATION_NAME = /^(\d{4}_\d{2}_\d{2}_\d{6})_(.+)$/;

/** An effect plus the position it appeared at, so the file order survives. */
interface IndexedEffect {
	readonly index: number;
	readonly effect: MigrationEffect;
}

function timelineEntry(file: string, effects: readonly IndexedEffect[]): MigrationTimelineEntry {
	const base = file.slice(file.lastIndexOf('/') + 1).replace(/\.php$/i, '');
	const match = MIGRATION_NAME.exec(base);
	return {
		file,
		timestamp: match?.[1],
		name: (match ? match[2] : base).replace(/_/g, ' '),
		effects: [...effects].sort((left, right) => left.index - right.index).map(entry => entry.effect)
	};
}

function addEffect(effects: IndexedEffect[], index: number, table: string, effect: MigrationEffectKind): void {
	if (!effects.some(entry => entry.effect.table === table && entry.effect.effect === effect)) {
		effects.push({ index, effect: { table, effect } });
	}
}

function typeOf(method: string, args: string): string {
	// The first argument is always the column name, so only the arguments after
	// it describe the type (length, precision, enum values).
	const [, ...rest] = args.split(',');
	const base = rest.join(',').trim().replace(/^['"]|['"]$/g, '');
	switch (method) {
		case 'string':
		case 'char':
			return `${method === 'string' ? 'varchar' : 'char'}(${base || '255'})`;
		case 'foreignId':
		case 'foreignUuid':
			return method === 'foreignId' ? 'bigint unsigned' : 'char(36)';
		case 'unsignedBigInteger':
			return 'bigint unsigned';
		case 'unsignedInteger':
		case 'unsignedMediumInteger':
		case 'unsignedSmallInteger':
		case 'unsignedTinyInteger':
			return method.replace('unsigned', 'unsigned ').toLowerCase();
		case 'bigInteger':
		case 'mediumInteger':
		case 'smallInteger':
		case 'tinyInteger':
			return method.replace('Integer', '').toLowerCase() + 'int';
		case 'boolean':
			return 'tinyint(1)';
		case 'decimal':
		case 'float':
		case 'double': {
			const scale = rest.map(part => part.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).join(',');
			return scale ? `${method}(${scale})` : method;
		}
		case 'enum':
			return `enum(${quotedList(args).slice(1).join(',')})`;
		case 'timestamps':
		case 'timestampsTz':
			return 'timestamp';
		default:
			return method.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
	}
}

/**
 * Reads the schema from migration declarations. It is intentionally static:
 * the DB Schema view then works without a database connection, without
 * executing migrations and in Restricted Mode.
 */
export function parseMigrations(files: readonly MigrationFile[]): DatabaseSchema {
	const tables = new Map<string, MutableTable>();
	const ordered = [...files].sort((left, right) => left.file.localeCompare(right.file));
	const timeline: MigrationTimelineEntry[] = [];

	const tableForName = (name: string): MutableTable => {
		const existing = tables.get(name);
		if (existing) {
			return existing;
		}
		const created: MutableTable = {
			name,
			columns: [],
			indexes: [],
			foreignKeys: [],
			createdIn: undefined,
			lastChangedIn: undefined,
			dropped: false
		};
		tables.set(name, created);
		return created;
	};

	for (const migration of ordered) {
		const location = (index: number): SourceLocation => ({ file: migration.file, line: lineAt(migration.text, index) });
		const effects: IndexedEffect[] = [];

		DROP_TABLE.lastIndex = 0;
		let drop = DROP_TABLE.exec(migration.text);
		while (drop) {
			const table = tableForName(drop[1]);
			table.dropped = true;
			table.lastChangedIn = location(drop.index);
			addEffect(effects, drop.index, drop[1], 'dropped');
			drop = DROP_TABLE.exec(migration.text);
		}

		CREATE_OR_ALTER.lastIndex = 0;
		let block = CREATE_OR_ALTER.exec(migration.text);
		while (block) {
			const kind = block[1];
			const name = block[2];
			const table = tableForName(name);
			const blockLocation = location(block.index);
			if (kind === 'create') {
				table.dropped = false;
				table.createdIn = table.createdIn ?? blockLocation;
				table.lastChangedIn = blockLocation;
			} else {
				table.lastChangedIn = blockLocation;
			}
			addEffect(effects, block.index, name, kind === 'create' ? 'created' : 'altered');

			const open = migration.text.indexOf('{', block.index + block[0].length - 1);
			const close = open >= 0 ? matchingBrace(migration.text, open) : -1;
			const body = open >= 0 && close > open ? migration.text.slice(open + 1, close) : '';

			STATEMENT.lastIndex = 0;
			let statement = STATEMENT.exec(body);
			while (statement) {
				const method = statement[1];
				const next = body.slice(statement.index + 1).search(/\$table\s*->/);
				const end = next >= 0 ? statement.index + 1 + next : body.length;
				const segment = body.slice(statement.index, end);
				const { args, tail } = argumentsOf(segment, 0);
				const columnName = firstQuoted(args);

				if (ID_HELPERS.has(method)) {
					addColumn(table, { name: columnName ?? 'id', type: 'bigint unsigned', nullable: false, default: undefined, autoIncrement: true });
					addIndex(table, [columnName ?? 'id'], false, true);
				} else if (INCREMENT_HELPERS.has(method)) {
					addColumn(table, { name: columnName ?? 'id', type: 'int unsigned', nullable: false, default: undefined, autoIncrement: true });
					addIndex(table, [columnName ?? 'id'], false, true);
				} else if (TIMESTAMP_HELPERS.has(method)) {
					addColumn(table, { name: 'created_at', type: 'timestamp', nullable: true, default: undefined, autoIncrement: false });
					addColumn(table, { name: 'updated_at', type: 'timestamp', nullable: true, default: undefined, autoIncrement: false });
				} else if (SOFT_DELETE_HELPERS.has(method)) {
					addColumn(table, { name: 'deleted_at', type: 'timestamp', nullable: true, default: undefined, autoIncrement: false });
				} else if (method === 'rememberToken') {
					addColumn(table, { name: 'remember_token', type: 'varchar(100)', nullable: true, default: undefined, autoIncrement: false });
				} else if (method === 'morphs' || method === 'nullableMorphs' || method === 'uuidMorphs' || method === 'nullableUuidMorphs') {
					const base = columnName ?? 'morphable';
					const uuid = method.toLowerCase().includes('uuid');
					const nullable = method.toLowerCase().startsWith('nullable');
					addColumn(table, { name: `${base}_type`, type: 'varchar(255)', nullable, default: undefined, autoIncrement: false });
					addColumn(table, { name: `${base}_id`, type: uuid ? 'char(36)' : 'bigint unsigned', nullable, default: undefined, autoIncrement: false });
					addIndex(table, [`${base}_type`, `${base}_id`], false, false);
				} else if (method === 'index' || method === 'unique' || method === 'primary' || method === 'fullText' || method === 'spatialIndex') {
					const columns = args.includes('[') ? quotedList(args) : (columnName ? [columnName] : []);
					addIndex(table, columns, method === 'unique', method === 'primary');
				} else if (method === 'foreign') {
					const columns = args.includes('[') ? quotedList(args) : (columnName ? [columnName] : []);
					const references = /->\s*references\s*\(\s*([^)]*)\)/.exec(segment)?.[1] ?? '';
					table.foreignKeys.push({
						columns,
						table: tableFor(segment, ''),
						references: quotedList(references),
						onDelete: onDeleteOf(segment)
					});
				} else if (method.startsWith('dropColumn') || method === 'dropColumn' || method === 'dropMorphs') {
					for (const dropped of quotedList(args)) {
						table.columns = table.columns.filter(column => column.name !== dropped);
					}
				} else if (method.startsWith('drop') && method !== 'dropColumn') {
					// Drop indexes/foreign keys do not change the column list.
				} else if (columnName) {
					const column: SchemaColumn = {
						name: columnName,
						type: typeOf(method, args),
						nullable: isNullable(tail),
						default: defaultOf(tail),
						autoIncrement: /->\s*autoIncrement\s*\(/.test(tail)
					};
					addColumn(table, column);

					if (/->\s*unique\s*\(/.test(tail)) {
						addIndex(table, [columnName], true, false);
					}
					if (/->\s*primary\s*\(/.test(tail)) {
						addIndex(table, [columnName], false, true);
					}
					if (method === 'foreignId' || method === 'foreignUuid') {
						const fallback = `${tableForForeignKeyColumn(columnName)}`;
						table.foreignKeys.push({
							columns: [columnName],
							table: tableFor(segment, fallback),
							references: ['id'],
							onDelete: onDeleteOf(segment)
						});
					}
					if (/->\s*index\s*\(/.test(tail)) {
						addIndex(table, [columnName], false, false);
					}
				}

				statement = STATEMENT.exec(body);
			}

			block = CREATE_OR_ALTER.exec(migration.text);
		}

		timeline.push(timelineEntry(migration.file, effects));
	}

	return {
		tables: [...tables.values()].sort((left, right) => left.name.localeCompare(right.name)),
		migrationCount: ordered.length,
		timeline,
		source: 'migrations'
	};
}
