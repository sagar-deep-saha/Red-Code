/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDatabaseSchema, parseDbShow, parseDbTable } from '../index/dbSchema.js';
import { parseMigrations } from '../index/migrations.js';

/** Captured from `php artisan db:show --json` on the Laravel 13 / SQLite fixture. */
const DB_SHOW = JSON.stringify({
	platform: {
		config: { driver: 'sqlite', url: null, database: 'database/database.sqlite', prefix: '', foreign_key_constraints: true },
		name: 'SQLite',
		connection: 'sqlite',
		version: '3.53.4',
		open_connections: null
	},
	tables: [
		{ table: 'cache', schema: 'main', schema_qualified_name: 'main.cache', size: null, rows: null },
		{ table: 'cache_locks', schema: 'main', schema_qualified_name: 'main.cache_locks', size: null, rows: null },
		{ table: 'failed_jobs', schema: 'main', schema_qualified_name: 'main.failed_jobs', size: null, rows: null },
		{ table: 'job_batches', schema: 'main', schema_qualified_name: 'main.job_batches', size: null, rows: null },
		{ table: 'jobs', schema: 'main', schema_qualified_name: 'main.jobs', size: null, rows: null },
		{ table: 'migrations', schema: 'main', schema_qualified_name: 'main.migrations', size: null, rows: null },
		{ table: 'password_reset_tokens', schema: 'main', schema_qualified_name: 'main.password_reset_tokens', size: null, rows: null },
		{ table: 'posts', schema: 'main', schema_qualified_name: 'main.posts', size: null, rows: null },
		{ table: 'sessions', schema: 'main', schema_qualified_name: 'main.sessions', size: null, rows: null },
		{ table: 'users', schema: 'main', schema_qualified_name: 'main.users', size: null, rows: null }
	]
});

/** Captured from `php artisan db:table posts --json` on the same fixture. */
const POSTS_TABLE = JSON.stringify({
	table: { schema: 'main', name: 'posts', schema_qualified_name: 'main.posts', columns: 6, size: null, engine: null },
	columns: [
		{ column: 'id', attributes: { 0: 'integer', 2: 'autoincrement' }, default: null, type: 'integer' },
		{ column: 'user_id', attributes: ['integer'], default: null, type: 'integer' },
		{ column: 'title', attributes: ['varchar'], default: null, type: 'varchar' },
		{ column: 'body', attributes: { 0: 'text', 3: 'nullable' }, default: null, type: 'text' },
		{ column: 'created_at', attributes: { 0: 'datetime', 3: 'nullable' }, default: null, type: 'datetime' },
		{ column: 'updated_at', attributes: { 0: 'datetime', 3: 'nullable' }, default: null, type: 'datetime' }
	],
	indexes: [{ name: 'primary', columns: ['id'], attributes: { 3: 'primary' } }],
	foreign_keys: [{
		name: null,
		columns: ['user_id'],
		foreign_schema: 'main',
		foreign_table: 'users',
		foreign_columns: ['id'],
		on_update: 'no action',
		on_delete: 'cascade'
	}]
});

const createPosts = `<?php
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('posts', function (Blueprint $table) {
            $table->id();
            $table->string('title');
        });
    }
};
`;

test('db:show yields the connection and every table', () => {
	const info = parseDbShow(DB_SHOW);
	assert.ok(info);
	assert.equal(info.connection, 'sqlite');
	assert.equal(info.name, 'SQLite');
	assert.equal(info.version, '3.53.4');
	assert.deepEqual(info.tables, [
		'cache', 'cache_locks', 'failed_jobs', 'job_batches', 'jobs',
		'migrations', 'password_reset_tokens', 'posts', 'sessions', 'users'
	]);
});

test('db:show tolerates a BOM, a missing platform and nameless rows', () => {
	const withBom = `\uFEFF${JSON.stringify({ platform: { connection: 'mysql' }, tables: [{ table: 'users' }, {}] })}`;
	const info = parseDbShow(withBom);
	assert.equal(info?.connection, 'mysql');
	assert.equal(info?.name, undefined);
	assert.equal(info?.version, undefined);
	assert.deepEqual(info?.tables, ['users']);

	assert.equal(parseDbShow('not json'), undefined);
	assert.equal(parseDbShow('[]'), undefined);
});

test('db:table yields columns, indexes and foreign keys', () => {
	const table = parseDbTable(POSTS_TABLE);
	assert.ok(table);
	assert.equal(table.name, 'posts');
	assert.equal(table.dropped, false);
	assert.equal(table.createdIn, undefined);
	assert.equal(table.lastChangedIn, undefined);

	assert.deepEqual(table.columns.map(column => column.name), [
		'id', 'user_id', 'title', 'body', 'created_at', 'updated_at'
	]);

	const id = table.columns[0];
	assert.equal(id.type, 'integer');
	assert.equal(id.autoIncrement, true);
	assert.equal(id.nullable, false);
	assert.equal(id.default, undefined);

	assert.equal(table.columns[2].type, 'varchar');
	assert.equal(table.columns[3].type, 'text');
	assert.equal(table.columns[3].nullable, true);
	assert.equal(table.columns[4].nullable, true);

	assert.deepEqual(table.indexes, [{ columns: ['id'], unique: false, primary: true, name: 'primary' }]);
	assert.deepEqual(table.foreignKeys, [
		{ columns: ['user_id'], table: 'users', references: ['id'], onDelete: 'cascade' }
	]);
});

test('column attributes are flattened whether they are a list or a sparse object', () => {
	// A list and a numeric-keyed object mean the same thing; both must be read.
	const fromList = parseDbTable(JSON.stringify({
		table: { name: 'tags' },
		columns: [{ column: 'label', type: 'text', attributes: ['text', 'nullable'], default: null }]
	}));
	assert.equal(fromList?.columns[0].type, 'text');
	assert.equal(fromList?.columns[0].nullable, true);

	const sparse = parseDbTable(JSON.stringify({
		table: { name: 'tags' },
		columns: [{ column: 'slug', attributes: { 0: 'varchar', 4: 'nullable', 7: 'autoincrement' }, default: null }]
	}));
	// A missing `type` falls back to the first attribute.
	assert.equal(sparse?.columns[0].type, 'varchar');
	assert.equal(sparse?.columns[0].nullable, true);
	assert.equal(sparse?.columns[0].autoIncrement, true);
});

test('unique indexes and non-null defaults are read', () => {
	const table = parseDbTable(JSON.stringify({
		table: { name: 'articles' },
		columns: [{ column: 'published', attributes: ['tinyint'], default: 0, type: 'tinyint' }],
		indexes: [{ name: 'articles_slug_unique', columns: ['slug'], attributes: ['unique'] }]
	}));
	// A scalar default is kept as text; the view prints it verbatim.
	assert.equal(table?.columns[0].default, '0');
	assert.deepEqual(table?.indexes, [{ columns: ['slug'], unique: true, primary: false, name: 'articles_slug_unique' }]);
});

test('db:table skips unusable rows and falls back to the requested table name', () => {
	assert.equal(parseDbTable('nope'), undefined);
	assert.equal(parseDbTable(JSON.stringify({ columns: [] })), undefined);
	assert.equal(parseDbTable(JSON.stringify({ columns: [] }), 'posts')?.name, 'posts');

	const mixed = parseDbTable(JSON.stringify({
		columns: [{ attributes: ['integer'] }, { column: 'kept', type: 'integer', attributes: [] }],
		indexes: [{ attributes: ['primary'] }, { name: 'i', columns: ['kept'] }],
		foreign_keys: [{ columns: [] }]
	}), 'posts');
	assert.deepEqual(mixed?.columns.map(column => column.name), ['kept']);
	assert.deepEqual(mixed?.indexes.map(index => index.name), ['i']);
	assert.deepEqual(mixed?.foreignKeys, []);
});

test('the engine default on-delete is not reported as a constraint', () => {
	const table = parseDbTable(JSON.stringify({
		table: { name: 'tags' },
		foreign_keys: [{
			columns: ['post_id'],
			foreign_table: 'posts',
			foreign_columns: ['id'],
			on_update: 'no action',
			on_delete: 'NO ACTION'
		}]
	}));
	assert.equal(table?.foreignKeys[0].onDelete, undefined);
});

test('the live schema is marked as authoritative and keeps the migration history', () => {
	const fallback = parseMigrations([{
		file: 'database/migrations/2026_01_01_000000_create_posts_table.php',
		text: createPosts
	}]);
	const info = parseDbShow(DB_SHOW);
	const table = parseDbTable(POSTS_TABLE);
	assert.ok(info);
	assert.ok(table);

	const schema = buildDatabaseSchema(info, [table], fallback);
	assert.equal(schema.source, 'database');
	assert.equal(schema.connection, 'SQLite');
	assert.equal(schema.serverVersion, '3.53.4');
	assert.equal(schema.migrationCount, 1);
	assert.deepEqual(schema.timeline.map(entry => entry.name), ['create posts table']);
	assert.deepEqual(schema.tables.map(entry => entry.name), ['posts']);
	// `createdIn` is not a database concept, so it comes from the declarations.
	assert.equal(schema.tables[0].createdIn?.file, 'database/migrations/2026_01_01_000000_create_posts_table.php');
});

test('a live schema without a migration history keeps an empty timeline', () => {
	const info = parseDbShow(DB_SHOW);
	assert.ok(info);
	const schema = buildDatabaseSchema(info, []);
	assert.equal(schema.source, 'database');
	assert.equal(schema.migrationCount, 0);
	assert.deepEqual(schema.timeline, []);
	assert.deepEqual(schema.tables, []);
});
