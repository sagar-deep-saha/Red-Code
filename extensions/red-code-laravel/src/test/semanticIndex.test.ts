/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePhpFile, resolveClassName } from '../index/phpSymbols.js';
import { groupRoutes, parseRouteList, routeGroupName, splitMethods } from '../index/routes.js';
import { componentNameFromPath, extractReferences, projectGroupForPath, viewNameFromPath } from '../index/views.js';

const routeJson = JSON.stringify([
	{
		domain: null,
		method: 'GET|HEAD',
		uri: 'posts/{post}',
		name: 'posts.show',
		action: 'App\\Http\\Controllers\\PostController@show',
		middleware: ['web'],
		path: null
	},
	{
		domain: null,
		method: 'POST',
		uri: 'posts',
		name: 'posts.store',
		action: 'App\\Http\\Controllers\\PostController@store',
		middleware: ['web']
	},
	{
		domain: null,
		method: 'GET|HEAD',
		uri: 'storage/{path}',
		name: 'storage.local',
		action: 'Closure',
		middleware: [],
		path: 'vendor/laravel/framework/src/Illuminate/Filesystem/FilesystemServiceProvider.php:111'
	},
	{
		domain: null,
		method: 'PUT',
		uri: 'api/users/{user}',
		name: 'api.users.update',
		action: 'App\\Http\\Controllers\\Api\\UserController@update',
		middleware: ['api', 'auth:sanctum']
	},
	{
		domain: null,
		method: 'GET|HEAD',
		uri: 'dashboard',
		name: 'dashboard',
		action: 'Closure',
		middleware: ['web', 'auth'],
		path: 'routes/web.php:9'
	}
]);

test('routes are parsed with method ordering, action splitting and optional path', () => {
	const routes = parseRouteList(routeJson);
	assert.ok(routes);
	assert.equal(routes.length, 5);

	const show = routes.find(route => route.name === 'posts.show');
	assert.deepEqual(show?.methods, ['GET', 'HEAD']);
	assert.equal(show?.controllerClass, 'App\\Http\\Controllers\\PostController');
	assert.equal(show?.controllerMethod, 'show');
	assert.equal(show?.sourcePath, undefined);
	assert.equal(show?.isVendor, false);

	const dashboard = routes.find(route => route.name === 'dashboard');
	assert.equal(dashboard?.isClosure, true);
	assert.equal(dashboard?.sourcePath, 'routes/web.php:9');
});

test('vendor routes are derived from source path or framework action namespace', () => {
	const routes = parseRouteList(routeJson) ?? [];
	const storage = routes.find(route => route.name === 'storage.local');
	assert.equal(storage?.isVendor, true);
	assert.equal(storage?.isClosure, true);
});

test('routes are grouped by middleware and vendor routes are hidden by default', () => {
	const routes = parseRouteList(routeJson) ?? [];
	const grouped = groupRoutes(routes);
	assert.deepEqual(grouped.map(group => group.name), ['web', 'api']);
	assert.equal(grouped[0].routes.some(route => route.name === 'storage.local'), false);

	const withVendor = groupRoutes(routes, true);
	assert.equal(withVendor.flatMap(group => group.routes).some(route => route.name === 'storage.local'), true);
});

test('route helpers are total on empty or unknown input', () => {
	assert.equal(parseRouteList('not json'), undefined);
	assert.equal(parseRouteList('{}'), undefined);
	assert.deepEqual(splitMethods('get|head|GET'), ['GET', 'HEAD']);
	assert.equal(routeGroupName([]), 'web');
	assert.equal(routeGroupName(['auth', 'api']), 'api');
	assert.deepEqual(groupRoutes([]), []);
});

const postModel = `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Factories\\HasFactory;
use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class Post extends Model
{
    use HasFactory;

    protected $fillable = ['user_id', 'title'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function comments(): \\Illuminate\\Database\\Eloquent\\Relations\\HasMany
    {
        return $this->hasMany(Comment::class);
    }

    private static function hidden(): bool
    {
        return true;
    }
}
`;

const userModel = `<?php

namespace App\\Models;

use Database\\Factories\\UserFactory;
use Illuminate\\Foundation\\Auth\\User as Authenticatable;

#[\\Illuminate\\Database\\Eloquent\\Attributes\\Fillable(['name', 'email'])]
class User extends Authenticatable
{
    public function posts(): \\Illuminate\\Database\\Eloquent\\Relations\\HasMany
    {
        return $this->hasMany(Post::class);
    }
}
`;

test('PHP symbols expose class identity, methods and imports', () => {
	const symbols = parsePhpFile(postModel);
	assert.equal(symbols.namespace, 'App\\Models');
	assert.equal(symbols.className, 'Post');
	assert.equal(symbols.extendsClass, 'Illuminate\\Database\\Eloquent\\Model');

	const methodNames = symbols.methods.map(method => method.name);
	assert.deepEqual(methodNames, ['user', 'comments', 'hidden']);
	assert.equal(symbols.methods[0].line, 15);
	assert.equal(symbols.methods[2].visibility, 'private');
	assert.equal(symbols.methods[2].isStatic, true);
});

test('Eloquent relationships resolve through imports to fully qualified models', () => {
	const symbols = parsePhpFile(postModel);
	assert.deepEqual(symbols.relations, [
		{ method: 'user', type: 'belongsTo', related: 'App\\Models\\User', line: 15 },
		{ method: 'comments', type: 'hasMany', related: 'App\\Models\\Comment', line: 20 }
	]);
});

test('class attributes and class aliases do not break symbol parsing', () => {
	const symbols = parsePhpFile(userModel);
	assert.equal(symbols.className, 'User');
	assert.equal(symbols.extendsClass, 'Illuminate\\Foundation\\Auth\\User');
	const relations = symbols.relations;
	assert.deepEqual(relations.map(relation => [relation.type, relation.related]), [
		['hasMany', 'App\\Models\\Post']
	]);
});

test('class names resolve through aliases, absolute names and the current namespace', () => {
	const imports = new Map([['Post', 'App\\Models\\Post']]);
	assert.equal(resolveClassName('Post', 'App\\Models', imports), 'App\\Models\\Post');
	assert.equal(resolveClassName('\\App\\Support\\Thing', 'App\\Models', imports), 'App\\Support\\Thing');
	assert.equal(resolveClassName('Other', 'App\\Models', imports), 'App\\Models\\Other');
	assert.equal(resolveClassName('Vendor\\Pkg\\Type', 'App\\Models', imports), 'Vendor\\Pkg\\Type');
});

test('view and component paths map to Blade names', () => {
	assert.equal(viewNameFromPath('resources/views/users/index.blade.php'), 'users.index');
	assert.equal(viewNameFromPath('resources\\views\\layouts\\app.blade.php'), 'layouts.app');
	assert.equal(viewNameFromPath('app/Http/Controllers/UserController.php'), undefined);

	assert.equal(componentNameFromPath('resources/views/components/alert.blade.php'), 'alert');
	assert.equal(componentNameFromPath('resources/views/components/forms/input.blade.php'), 'forms.input');
	assert.equal(componentNameFromPath('resources/views/users/index.blade.php'), undefined);
});

test('Laravel paths map to project explorer groups', () => {
	assert.equal(projectGroupForPath('app/Http/Controllers/UserController.php'), 'HTTP');
	assert.equal(projectGroupForPath('app/Http/Requests/StoreUserRequest.php'), 'HTTP');
	assert.equal(projectGroupForPath('app/Models/User.php'), 'Application');
	assert.equal(projectGroupForPath('app/Services/UserService.php'), 'Application');
	assert.equal(projectGroupForPath('resources/views/users/index.blade.php'), 'Views');
	assert.equal(projectGroupForPath('database/migrations/2026_01_01_create_users_table.php'), 'Database');
	assert.equal(projectGroupForPath('config/app.php'), 'Configuration');
	assert.equal(projectGroupForPath('routes/web.php'), 'Configuration');
	assert.equal(projectGroupForPath('tests/Feature/PostTest.php'), 'Tests');
	assert.equal(projectGroupForPath('vendor/laravel/framework/composer.json'), 'Packages');
	assert.equal(projectGroupForPath('README.md'), 'Other');
});

test('Blade references are extracted with kinds and line numbers', () => {
	const blade = [
		"@extends('layouts.app')",
		"@include('partials.header')",
		'<x-alert type="info">Hi</x-alert>',
		"<x-forms.input name=\"email\" />",
		"<a href=\"{{ route('posts.index') }}\">Posts</a>",
		"@vite(['resources/css/app.css'])",
		"{{ view('posts.show') }}",
		"{{ View::make('posts.index') }}"
	].join('\n');

	const references = extractReferences(blade);
	const pairs = references.map(reference => `${reference.kind}:${reference.value}:${reference.line}`);
	assert.deepEqual(pairs, [
		'extends:layouts.app:1',
		'include:partials.header:2',
		'tag:alert:3',
		'tag:forms.input:4',
		'route:posts.index:5',
		'vite:resources/css/app.css:6',
		'view:posts.show:7',
		'view:posts.index:8'
	]);

	// Link ranges must cover the value, not the directive or tag prefix.
	for (const reference of references) {
		assert.equal(blade.slice(reference.index, reference.index + reference.value.length), reference.value);
	}
});
