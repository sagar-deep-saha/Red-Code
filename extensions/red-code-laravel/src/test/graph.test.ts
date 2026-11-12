/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph, IndexedClass, IndexedView, parseSourcePath } from '../index/graph.js';
import { buildCurlCommand, displayUri, parseRouteList, requestMethod, toConcreteUri } from '../index/routes.js';

const controller: IndexedClass = {
	fqcn: 'App\\Http\\Controllers\\PostController',
	name: 'PostController',
	namespace: 'App\\Http\\Controllers',
	file: 'app/Http/Controllers/PostController.php',
	extendsClass: 'App\\Http\\Controllers\\Controller',
	methods: [
		{ name: 'index', line: 13, visibility: 'public', isStatic: false },
		{ name: 'show', line: 39, visibility: 'public', isStatic: false }
	],
	relations: []
};

const user: IndexedClass = {
	fqcn: 'App\\Models\\User',
	name: 'User',
	namespace: 'App\\Models',
	file: 'app/Models/User.php',
	extendsClass: 'Illuminate\\Foundation\\Auth\\User',
	methods: [{ name: 'posts', line: 24, visibility: 'public', isStatic: false }],
	relations: [{ method: 'posts', type: 'hasMany', related: 'App\\Models\\Post', line: 24 }]
};

const post: IndexedClass = {
	fqcn: 'App\\Models\\Post',
	name: 'Post',
	namespace: 'App\\Models',
	file: 'app/Models/Post.php',
	extendsClass: 'Illuminate\\Database\\Eloquent\\Model',
	methods: [{ name: 'user', line: 16, visibility: 'public', isStatic: false }],
	relations: [{ method: 'user', type: 'belongsTo', related: 'App\\Models\\User', line: 16 }]
};

const alert: IndexedView = {
	name: 'components.alert',
	componentName: 'alert',
	file: 'resources/views/components/alert.blade.php',
	isComponent: true,
	references: []
};

const indexView: IndexedView = {
	name: 'posts.index',
	componentName: undefined,
	file: 'resources/views/posts/index.blade.php',
	isComponent: false,
	references: [{ kind: 'tag', value: 'alert', line: 16, index: 0 }]
};

const layout: IndexedView = {
	name: 'layouts.app',
	componentName: undefined,
	file: 'resources/views/layouts/app.blade.php',
	isComponent: false,
	references: [{ kind: 'tag', value: 'alert', line: 13, index: 0 }]
};

const routes = parseRouteList(JSON.stringify([
	{
		method: 'GET|HEAD',
		uri: 'posts/{post}',
		name: 'posts.show',
		action: 'App\\Http\\Controllers\\PostController@show',
		middleware: ['web']
	},
	{
		method: 'GET|HEAD',
		uri: 'posts',
		name: 'posts.index',
		action: 'App\\Http\\Controllers\\PostController@index',
		middleware: ['web']
	},
	{
		method: 'GET|HEAD',
		uri: 'dashboard',
		name: 'dashboard',
		action: 'Closure',
		middleware: ['web', 'auth'],
		path: 'routes/web.php:9'
	},
	{
		method: 'GET|HEAD',
		uri: 'storage/{path}',
		name: 'storage.local',
		action: 'Closure',
		middleware: [],
		path: 'vendor/laravel/framework/src/Illuminate/Filesystem/FilesystemServiceProvider.php:111'
	}
])) ?? [];

const graph = buildGraph({
	routes,
	classes: [controller, user, post],
	views: [alert, indexView, layout],
	files: [
		'app/Http/Controllers/PostController.php',
		'app/Models/User.php',
		'app/Models/Post.php',
		'resources/views/components/alert.blade.php',
		'resources/views/posts/index.blade.php',
		'database/migrations/2026_01_01_create_posts_table.php',
		'tests/Feature/PostTest.php',
		'tests/Unit/ExampleTest.php'
	]
});

test('source paths are parsed with the last colon so Windows drives survive', () => {
	assert.deepEqual(parseSourcePath('routes/web.php:9'), { file: 'routes/web.php', line: 9 });
	assert.deepEqual(parseSourcePath('C:\\app\\routes\\web.php:12'), { file: 'C:/app/routes/web.php', line: 12 });
	assert.equal(parseSourcePath(undefined), undefined);
	assert.equal(parseSourcePath('routes/web.php'), undefined);
	assert.equal(parseSourcePath('routes/web.php:not-a-line'), undefined);
});

test('routes resolve to declarations when available and to controller methods otherwise', () => {
	const dashboard = graph.routeByName('dashboard');
	assert.ok(dashboard);
	assert.deepEqual(graph.routeLocation(dashboard), { file: 'routes/web.php', line: 9 });

	const show = graph.routeByName('posts.show');
	assert.ok(show);
	assert.deepEqual(graph.routeLocation(show), { file: 'app/Http/Controllers/PostController.php', line: 39 });

	assert.equal(graph.routeByName('missing'), undefined);
});

test('classes and reverse route edges are queryable', () => {
	assert.equal(graph.classByFile('app/Http/Controllers/PostController.php')?.name, 'PostController');
	assert.equal(graph.classByFile('app/Models/User.php')?.name, 'User');

	const controllerRoutes = graph.routesForClass(controller.fqcn);
	assert.deepEqual(controllerRoutes.map(route => route.name).sort(), ['posts.index', 'posts.show']);

	assert.deepEqual(graph.routesForClass(user.fqcn), []);
});

test('relations resolve to indexed models and never invent targets', () => {
	const posts = user.relations[0];
	assert.equal(graph.relationTarget(posts)?.name, 'Post');

	const orphan: IndexedClass = {
		...user,
		fqcn: 'App\\Models\\Orphan',
		relations: [{ method: 'things', type: 'hasMany', related: 'App\\Models\\Missing', line: 1 }]
	};
	const orphanGraph = buildGraph({ routes: [], classes: [orphan], views: [], files: [] });
	assert.equal(orphanGraph.relationTarget(orphan.relations[0]), undefined);
});

test('component usage is derived from Blade tags in non-component views', () => {
	assert.deepEqual(graph.usedBy('alert').map(view => view.name).sort(), ['layouts.app', 'posts.index']);
	assert.deepEqual(graph.usedBy('missing'), []);
});

test('model and controller detection does not depend on folder naming alone', () => {
	assert.equal(graph.isController(controller), true);
	assert.equal(graph.isModel(user), true);
	assert.equal(graph.isModel(post), true);
	assert.equal(graph.isController(user), false);
});

test('counts exclude vendor routes and separate views from components', () => {
	assert.deepEqual(graph.counts(), {
		routes: 3,
		controllers: 1,
		models: 2,
		views: 2,
		components: 1,
		migrations: 1,
		tests: 2
	});
});

test('route URLs are concrete and cURL commands are stable', () => {
	assert.equal(displayUri('posts'), '/posts');
	assert.equal(displayUri('/posts'), '/posts');
	assert.equal(displayUri('/'), '/');
	assert.equal(toConcreteUri('posts/{post}'), '/posts/1');
	assert.equal(toConcreteUri('posts/{post}/edit'), '/posts/1/edit');

	const show = graph.routeByName('posts.show');
	assert.ok(show);
	assert.equal(requestMethod(show), 'GET');
	assert.equal(buildCurlCommand('GET', 'http://localhost:8000/posts/1'), 'curl -X GET "http://localhost:8000/posts/1"');

	const update = parseRouteList(JSON.stringify([
		{ method: 'PUT|PATCH', uri: 'posts/{post}', action: 'App\\Http\\Controllers\\PostController@update', middleware: ['web'] }
	]))?.[0];
	assert.ok(update);
	assert.equal(requestMethod(update), 'PUT');
});
