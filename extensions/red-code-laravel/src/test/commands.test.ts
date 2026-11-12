/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildArtisanArguments,
	displayCommand,
	formOptions,
	isLongRunning,
	isSelectableCommand,
	parseArtisanList
} from '../index/commands.js';

/**
 * Mirrors the Laravel 13 `list --format=json` contract verified against the
 * fixture: definition lives inside each command, and framework options are
 * repeated on every command.
 */
const list = JSON.stringify({
	application: { name: 'Laravel Framework', version: '13.42.0' },
	namespaces: [
		{ id: '_global', commands: ['migrate'] },
		{ id: 'make', commands: ['make:model'] }
	],
	commands: [
		{
			name: 'make:model',
			description: 'Create a new Eloquent model class',
			hidden: false,
			definition: {
				arguments: {
					name: { name: 'name', is_required: true, is_array: false, description: 'The name of the model', default: null }
				},
				options: {
					all: { name: '--all', shortcut: '-a', accept_value: false, is_value_required: false, is_multiple: false, description: 'Generate everything', default: false },
					migration: { name: '--migration', shortcut: '-m', accept_value: false, is_value_required: false, is_multiple: false, description: 'Create a migration', default: false },
					path: { name: '--path', shortcut: '', accept_value: true, is_value_required: false, is_multiple: false, description: 'Custom path', default: null },
					help: { name: '--help', shortcut: '-h', accept_value: false, is_value_required: false, is_multiple: false, description: 'Help', default: false },
					'no-interaction': { name: '--no-interaction', shortcut: '-n', accept_value: false, is_value_required: false, is_multiple: false, description: 'No interaction', default: false }
				}
			}
		},
		{
			name: 'migrate',
			description: 'Run the database migrations',
			hidden: false,
			definition: { arguments: {}, options: { force: { name: '--force', shortcut: '', accept_value: false, is_value_required: false, is_multiple: false, description: 'Force in production', default: false } } }
		},
		{
			name: '_complete',
			description: 'Internal completion',
			hidden: true,
			definition: { arguments: {}, options: {} }
		}
	]
});

test('Laravel 13 command list is parsed with per-command definitions', () => {
	const catalog = parseArtisanList(list);
	assert.ok(catalog);
	assert.equal(catalog.applicationVersion, '13.42.0');
	assert.deepEqual(catalog.commands.map(command => command.name), ['_complete', 'make:model', 'migrate']);

	const makeModel = catalog.commands.find(command => command.name === 'make:model');
	assert.ok(makeModel);
	assert.equal(makeModel.namespace, 'make');
	assert.equal(makeModel.arguments.length, 1);
	assert.equal(makeModel.arguments[0].name, 'name');
	assert.equal(makeModel.arguments[0].required, true);

	const migrate = catalog.commands.find(command => command.name === 'migrate');
	assert.equal(migrate?.namespace, '');
});

test('malformed command lists are rejected rather than half-parsed', () => {
	assert.equal(parseArtisanList('not json'), undefined);
	assert.equal(parseArtisanList('{}'), undefined);
	assert.equal(parseArtisanList(JSON.stringify({ commands: 'nope' })), undefined);
});

test('framework options are removed from generated forms but real flags remain', () => {
	const catalog = parseArtisanList(list);
	const makeModel = catalog?.commands.find(command => command.name === 'make:model');
	assert.ok(makeModel);

	const keys = formOptions(makeModel).map(option => option.name);
	assert.deepEqual(keys, ['--all', '--migration', '--path']);
	assert.equal(keys.includes('--help'), false);
	assert.equal(keys.includes('--no-interaction'), false);
});

test('hidden and internal commands are not offered in the palette', () => {
	const catalog = parseArtisanList(list);
	assert.ok(catalog);
	assert.equal(isSelectableCommand(catalog.commands[0]), false);
	assert.equal(isSelectableCommand(catalog.commands[1]), true);
});

test('form values become an ordered argument array', () => {
	const catalog = parseArtisanList(list);
	const makeModel = catalog?.commands.find(command => command.name === 'make:model');
	assert.ok(makeModel);

	const args = buildArtisanArguments(makeModel, {
		arguments: new Map([
			['name', 'Post'],
			['ignored', 'x']
		]),
		flags: ['--all', 'migration'],
		values: new Map([['path', 'app/Models']])
	});

	assert.deepEqual(args, ['make:model', 'Post', '--all', '--migration', '--path=app/Models']);
	assert.equal(displayCommand(args), 'php artisan make:model Post --all --migration --path=app/Models');
});

test('array arguments split on commas and empty values are dropped', () => {
	const catalog = parseArtisanList(JSON.stringify({
		application: { name: 'Laravel Framework' },
		commands: [{
			name: 'make:migration',
			description: '',
			hidden: false,
			definition: {
				arguments: { name: { name: 'name', is_required: true, is_array: false, description: '', default: null } },
				options: { path: { name: '--path', shortcut: '', accept_value: true, is_value_required: false, is_multiple: true, description: '', default: [] } }
			}
		}]
	}));
	const command = catalog?.commands[0];
	assert.ok(command);

	const args = buildArtisanArguments(command, {
		arguments: new Map([['name', 'create_posts_table']]),
		flags: [],
		values: new Map([['path', '']])
	});
	assert.deepEqual(args, ['make:migration', 'create_posts_table']);
});

test('long-running commands are surfaced so they open in a terminal', () => {
	assert.equal(isLongRunning('serve'), true);
	assert.equal(isLongRunning('queue:work'), true);
	assert.equal(isLongRunning('schedule:work'), true);
	assert.equal(isLongRunning('migrate'), false);
	assert.equal(isLongRunning('make:model'), false);
});
