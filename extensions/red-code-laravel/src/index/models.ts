/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IndexedClass } from './graph.js';
import { PhpRelationType } from './phpSymbols.js';

export interface ModelRelation {
	readonly method: string;
	readonly type: PhpRelationType;
	/** Fully qualified class name written in the declaration. */
	readonly related: string;
	readonly relatedName: string;
	/** Table of the related model, when that model is part of the index. */
	readonly relatedTable: string | undefined;
	readonly line: number;
}

export interface IndexedModel {
	readonly fqcn: string;
	readonly name: string;
	readonly namespace: string | undefined;
	readonly file: string;
	readonly table: string;
	readonly primaryKey: string;
	readonly fillable: readonly string[];
	readonly guarded: readonly string[];
	readonly timestamps: boolean;
	readonly softDeletes: boolean;
	readonly relations: readonly ModelRelation[];
}

const TABLE_PATTERN = /(?:protected|public)\s+\$table\s*=\s*['"]([^'"]+)['"]/;
const PRIMARY_KEY_PATTERN = /(?:protected|public)\s+\$primaryKey\s*=\s*['"]([^'"]+)['"]/;
const TIMESTAMPS_PATTERN = /(?:public|protected)\s+\$timestamps\s*=\s*false/;
const SOFT_DELETES_PATTERN = /\buse\s+SoftDeletes\b/;

/**
 * Laravel's default table name: snake_case plural of the class name.
 * The pluralizer here covers the shapes that appear in table names; unusual
 * cases are expected to declare `$table`.
 */
export function pluralize(word: string): string {
	if (/(?:s|x|z|ch|sh)$/i.test(word)) {
		return `${word}es`;
	}
	if (/[^aeiou]y$/i.test(word)) {
		return `${word.slice(0, -1)}ies`;
	}
	return `${word}s`;
}

export function snakeCase(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.replace(/[\s-]+/g, '_')
		.toLowerCase();
}

/** `App\Models\UserProfile` → `user_profiles`. */
export function defaultTableName(className: string): string {
	return pluralize(snakeCase(className));
}

/** `user_id` → `users`, matching `foreignId(...)->constrained()`. */
export function tableForForeignKeyColumn(column: string): string {
	return pluralize(snakeCase(column.replace(/_id$/i, '')));
}

function readStringArray(text: string, property: string): string[] {
	const pattern = new RegExp(`\\$${property}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm');
	const match = pattern.exec(text);
	if (!match) {
		return [];
	}
	const values: string[] = [];
	const valuePattern = /['"]([^'"]+)['"]/g;
	let value = valuePattern.exec(match[1]);
	while (value) {
		values.push(value[1]);
		value = valuePattern.exec(match[1]);
	}
	return values;
}

export function isEloquentModel(cls: IndexedClass): boolean {
	return cls.extendsClass === 'Illuminate\\Database\\Eloquent\\Model'
		|| cls.extendsClass === 'Illuminate\\Foundation\\Auth\\User'
		|| /(?:^|\/)models\//i.test(cls.file);
}

/**
 * Builds the model metadata Red Code reads. It is deliberately derived from
 * declarations, so the Models view works without executing project code and
 * without a database connection.
 */
export function indexedModel(file: string, text: string, cls: IndexedClass): IndexedModel | undefined {
	if (!isEloquentModel(cls)) {
		return undefined;
	}

	const table = TABLE_PATTERN.exec(text)?.[1] ?? defaultTableName(cls.name);
	const primaryKey = PRIMARY_KEY_PATTERN.exec(text)?.[1] ?? 'id';

	return {
		fqcn: cls.fqcn,
		name: cls.name,
		namespace: cls.namespace,
		file,
		table,
		primaryKey,
		fillable: readStringArray(text, 'fillable'),
		guarded: readStringArray(text, 'guarded'),
		timestamps: !TIMESTAMPS_PATTERN.test(text),
		softDeletes: SOFT_DELETES_PATTERN.test(text),
		relations: cls.relations.map(relation => ({
			method: relation.method,
			type: relation.type,
			related: relation.related,
			relatedName: relation.related.split('\\').at(-1) ?? relation.related,
			relatedTable: undefined,
			line: relation.line
		}))
	};
}

/**
 * Second pass: relations can only point at a table once every model is known,
 * and a relation may target a model declared later in the scan.
 */
export function linkModelTables(models: readonly IndexedModel[]): IndexedModel[] {
	const tables = new Map(models.map(model => [model.fqcn, model.table]));
	return models.map(model => ({
		...model,
		relations: model.relations.map(relation => ({
			...relation,
			relatedTable: tables.get(relation.related)
		}))
	}));
}
