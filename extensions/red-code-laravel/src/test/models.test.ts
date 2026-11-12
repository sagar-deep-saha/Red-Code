/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IndexedClass } from '../index/graph.js';
import { defaultTableName, IndexedModel, indexedModel, isEloquentModel, linkModelTables, pluralize, snakeCase, tableForForeignKeyColumn } from '../index/models.js';

function phpClass(identity: Pick<IndexedClass, 'fqcn' | 'name' | 'file'>, overrides: Partial<IndexedClass> = {}): IndexedClass {
	return {
		namespace: 'App\\Models',
		extendsClass: 'Illuminate\\Database\\Eloquent\\Model',
		methods: [],
		relations: [],
		...identity,
		...overrides
	};
}

test('table names follow Laravel pluralisation and snake case rules', () => {
	assert.equal(snakeCase('UserProfile'), 'user_profile');
	assert.equal(snakeCase('APIClient'), 'api_client');
	assert.equal(pluralize('post'), 'posts');
	assert.equal(pluralize('category'), 'categories');
	assert.equal(pluralize('status'), 'statuses');
	assert.equal(defaultTableName('UserProfile'), 'user_profiles');
	assert.equal(tableForForeignKeyColumn('user_id'), 'users');
	assert.equal(tableForForeignKeyColumn('category_id'), 'categories');
	assert.equal(tableForForeignKeyColumn('author'), 'authors');
});

test('models are detected from the parent class or the models folder', () => {
	assert.equal(isEloquentModel(phpClass({ fqcn: 'App\\Models\\Post', name: 'Post', file: 'app/Models/Post.php' })), true);
	assert.equal(isEloquentModel(phpClass({ fqcn: 'App\\Models\\Tag', name: 'Tag', file: 'app/Models/Tag.php' }, { extendsClass: undefined })), true);
	assert.equal(isEloquentModel(phpClass({ fqcn: 'App\\Models\\User', name: 'User', file: 'app/Models/User.php' }, { extendsClass: 'Illuminate\\Foundation\\Auth\\User' })), true);
	assert.equal(isEloquentModel(phpClass({ fqcn: 'App\\Support\\Helper', name: 'Helper', file: 'app/Support/Helper.php' }, { extendsClass: 'App\\Support\\Base' })), false);
});

test('model metadata is read from declarations, not from executed code', () => {
	const cls = phpClass(
		{ fqcn: 'App\\Models\\Post', name: 'Post', file: 'app/Models/Post.php' },
		{ relations: [{ method: 'user', type: 'belongsTo', related: 'App\\Models\\User', line: 12 }] }
	);
	const text = [
		'<?php',
		'class Post extends Model',
		'{',
		"    protected $table = 'blog_posts';",
		"    protected $primaryKey = 'post_id';",
		"    protected $fillable = ['title', 'body'];",
		'    protected $timestamps = false;',
		'    use SoftDeletes;',
		'}'
	].join('\n');

	const model = indexedModel('app/Models/Post.php', text, cls);
	assert.ok(model);
	assert.equal(model.table, 'blog_posts');
	assert.equal(model.primaryKey, 'post_id');
	assert.deepEqual(model.fillable, ['title', 'body']);
	assert.equal(model.timestamps, false);
	assert.equal(model.softDeletes, true);
	assert.deepEqual(model.relations.map(relation => [relation.method, relation.type, relation.relatedName]), [
		['user', 'belongsTo', 'User']
	]);
});

test('undeclared model conventions fall back to Laravel defaults', () => {
	const cls = phpClass({ fqcn: 'App\\Models\\UserProfile', name: 'UserProfile', file: 'app/Models/UserProfile.php' });
	const model = indexedModel('app/Models/UserProfile.php', '<?php class UserProfile extends Model {}', cls);
	assert.ok(model);
	assert.equal(model.table, 'user_profiles');
	assert.equal(model.primaryKey, 'id');
	assert.deepEqual(model.fillable, []);
	assert.deepEqual(model.guarded, []);
	assert.equal(model.timestamps, true);
	assert.equal(model.softDeletes, false);
});

test('non-model classes are never indexed', () => {
	const cls = phpClass({ fqcn: 'App\\Support\\Helper', name: 'Helper', file: 'app/Support/Helper.php' }, { extendsClass: 'App\\Support\\Base' });
	assert.equal(indexedModel(cls.file, '<?php class Helper {}', cls), undefined);
});

test('relations are linked to tables once every model is known', () => {
	const user = phpClass(
		{ fqcn: 'App\\Models\\User', name: 'User', file: 'app/Models/User.php' },
		{ relations: [{ method: 'posts', type: 'hasMany', related: 'App\\Models\\Post', line: 8 }] }
	);
	const post = phpClass(
		{ fqcn: 'App\\Models\\Post', name: 'Post', file: 'app/Models/Post.php' },
		{ relations: [{ method: 'user', type: 'belongsTo', related: 'App\\Models\\User', line: 12 }, { method: 'tags', type: 'belongsToMany', related: 'App\\Models\\Tag', line: 16 }] }
	);

	const models = [
		indexedModel(user.file, '<?php class User extends Model {}', user),
		indexedModel(post.file, '<?php class Post extends Model {}', post)
	].filter((model): model is IndexedModel => Boolean(model));

	const linked = linkModelTables(models);
	const linkedUser = linked.find(model => model.name === 'User');
	const linkedPost = linked.find(model => model.name === 'Post');
	assert.equal(linkedUser?.relations[0].relatedTable, 'posts');
	assert.equal(linkedPost?.relations[0].relatedTable, 'users');
	// A relation can point outside the index; there is no table to invent.
	assert.equal(linkedPost?.relations[1].relatedTable, undefined);
});
