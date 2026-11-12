/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineAt, matchingBrace, MigrationFile, parseMigrations } from '../index/migrations.js';

test('line numbers and brace matching ignore quoted characters', () => {
	assert.equal(lineAt('a\nb\nc', 4), 3);
	assert.equal(lineAt('no newlines', 5), 1);
	assert.equal(matchingBrace('{a{b}c}', 0), 6);
	assert.equal(matchingBrace("a{ '}' }b", 1), 7);
	assert.equal(matchingBrace('{no closing brace', 0), 16);
});

const createPosts = `<?php
use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('posts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->text('body')->nullable();
            $table->boolean('published')->default(false);
            $table->timestamps();
            $table->softDeletes();
        });
    }
};
`;

const alterPosts = `<?php
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('posts', function (Blueprint $table) {
            $table->string('slug')->unique();
            $table->dropColumn('body');
        });

        Schema::dropIfExists('legacy');
    }
};
`;

const createArticles = `<?php
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('articles', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('views')->default(0);
            $table->decimal('price', 8, 2);
            $table->enum('status', ['draft', 'published']);
            $table->morphs('taggable');
            $table->rememberToken();
            $table->index(['views', 'status']);
        });
    }
};
`;

const files: MigrationFile[] = [
	{ file: 'database/migrations/2026_01_01_000000_create_posts_table.php', text: createPosts },
	{ file: 'database/migrations/2026_01_02_000000_alter_posts_table.php', text: alterPosts },
	{ file: 'database/migrations/2026_01_03_000000_create_articles_table.php', text: createArticles }
];

const schema = parseMigrations(files);

test('migrations produce a schema without a database connection', () => {
	assert.equal(schema.migrationCount, 3);
	assert.deepEqual(schema.tables.map(table => table.name).sort(), ['articles', 'legacy', 'posts']);
});

test('create, alter and drop blocks are merged in migration order', () => {
	const posts = schema.tables.find(table => table.name === 'posts');
	assert.ok(posts);
	assert.equal(posts.dropped, false);
	assert.equal(posts.createdIn?.file, 'database/migrations/2026_01_01_000000_create_posts_table.php');
	assert.equal(posts.lastChangedIn?.file, 'database/migrations/2026_01_02_000000_alter_posts_table.php');

	// `body` was dropped by the second migration.
	assert.deepEqual(posts.columns.map(column => column.name), [
		'id', 'user_id', 'title', 'published', 'created_at', 'updated_at', 'deleted_at', 'slug'
	]);

	const id = posts.columns.find(column => column.name === 'id');
	assert.equal(id?.type, 'bigint unsigned');
	assert.equal(id?.autoIncrement, true);
	assert.equal(id?.nullable, false);
	assert.equal(id?.default, undefined);

	const title = posts.columns.find(column => column.name === 'title');
	assert.equal(title?.type, 'varchar(255)');

	const published = posts.columns.find(column => column.name === 'published');
	assert.equal(published?.type, 'tinyint(1)');
	assert.equal(published?.default, 'false');

	assert.deepEqual(posts.foreignKeys, [
		{ columns: ['user_id'], table: 'users', references: ['id'], onDelete: 'cascade' }
	]);
	assert.deepEqual(
		posts.indexes.map(index => `${index.primary ? 'p' : index.unique ? 'u' : 'i'}:${[...index.columns].join(',')}`),
		['p:id', 'u:slug']
	);

	const legacy = schema.tables.find(table => table.name === 'legacy');
	assert.equal(legacy?.dropped, true);
});

test('column shorthands expand to the columns Laravel would create', () => {
	const articles = schema.tables.find(table => table.name === 'articles');
	assert.ok(articles);
	assert.deepEqual(articles.columns.map(column => column.name), [
		'id', 'views', 'price', 'status', 'taggable_type', 'taggable_id', 'remember_token'
	]);
	assert.equal(articles.columns.find(column => column.name === 'id')?.type, 'int unsigned');
	assert.equal(articles.columns.find(column => column.name === 'views')?.default, '0');
	assert.equal(articles.columns.find(column => column.name === 'price')?.type, 'decimal(8,2)');
	assert.equal(articles.columns.find(column => column.name === 'status')?.type, 'enum(draft,published)');
	assert.equal(articles.columns.find(column => column.name === 'taggable_type')?.type, 'varchar(255)');
	assert.equal(articles.columns.find(column => column.name === 'taggable_id')?.type, 'bigint unsigned');
	assert.equal(articles.columns.find(column => column.name === 'remember_token')?.type, 'varchar(100)');

	assert.deepEqual(
		articles.indexes.map(index => [...index.columns].join(',')),
		['id', 'taggable_type,taggable_id', 'views,status']
	);
});

test('parsing an empty migration list produces an empty schema', () => {
	assert.deepEqual(parseMigrations([]), { tables: [], migrationCount: 0 });
});
