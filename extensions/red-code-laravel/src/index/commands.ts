/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { asArray, asBoolean, asRecord, asString, parseJson } from './json.js';

export interface ArtisanArgument {
	readonly name: string;
	readonly required: boolean;
	readonly isArray: boolean;
	readonly description: string;
	readonly defaultValue: string | undefined;
}

export interface ArtisanOption {
	readonly name: string;
	readonly shortcut: string | undefined;
	readonly acceptsValue: boolean;
	readonly valueRequired: boolean;
	readonly isMultiple: boolean;
	readonly description: string;
	readonly defaultValue: unknown;
}

export interface ArtisanCommand {
	readonly name: string;
	readonly description: string;
	readonly namespace: string;
	readonly hidden: boolean;
	readonly arguments: readonly ArtisanArgument[];
	readonly options: readonly ArtisanOption[];
}

export interface ArtisanCatalog {
	readonly applicationName: string | undefined;
	readonly applicationVersion: string | undefined;
	readonly commands: readonly ArtisanCommand[];
}

export interface ArtisanInputs {
	readonly arguments: ReadonlyMap<string, string>;
	readonly flags: readonly string[];
	readonly values: ReadonlyMap<string, string>;
}

/**
 * Symfony's own options are noise in a generated form: they exist on every
 * command and do not describe the command's actual behaviour.
 */
const FRAMEWORK_OPTIONS: ReadonlySet<string> = new Set([
	'help', 'silent', 'quiet', 'verbose', 'version', 'ansi', 'no-ansi', 'no-interaction', 'env'
]);

/**
 * Commands that either do not do project work, or would block forever in a
 * captured process. They stay hidden from the generated list, but a user can
 * still reach them through the terminal.
 */
const NON_SELECTABLE_COMMANDS: ReadonlySet<string> = new Set([
	'_complete', 'completion', 'help', 'list', 'inspire', 'invoke-serialized-closure'
]);

const LONG_RUNNING_COMMANDS: readonly RegExp[] = [
	/^serve$/, /^queue:work$/, /^queue:listen$/, /^schedule:work$/,
	/^pail$/, /^tinker$/, /^reverb:start$/, /^horizon$/, /^db:monitor$/, /^dev$/
];

function parseArgument(value: unknown): ArtisanArgument | undefined {
	const record = asRecord(value);
	const name = asString(record?.name);
	if (!record || !name) {
		return undefined;
	}

	return {
		name,
		required: asBoolean(record.is_required) ?? false,
		isArray: asBoolean(record.is_array) ?? false,
		description: asString(record.description) ?? '',
		defaultValue: asString(record.default)
	};
}

function parseOption(value: unknown): ArtisanOption | undefined {
	const record = asRecord(value);
	const name = asString(record?.name);
	if (!record || !name) {
		return undefined;
	}

	return {
		name,
		shortcut: asString(record.shortcut) || undefined,
		acceptsValue: asBoolean(record.accept_value) ?? false,
		valueRequired: asBoolean(record.is_value_required) ?? false,
		isMultiple: asBoolean(record.is_multiple) ?? false,
		description: asString(record.description) ?? '',
		defaultValue: record.default
	};
}

function parseNamespaceMap(value: unknown): Map<string, string> {
	const map = new Map<string, string>();
	for (const entry of asArray(value) ?? []) {
		const record = asRecord(entry);
		const id = asString(record?.id);
		if (!id) {
			continue;
		}
		for (const command of asArray(record?.commands) ?? []) {
			if (typeof command === 'string') {
				map.set(command, id === '_global' ? '' : id);
			}
		}
	}
	return map;
}

/**
 * Parses `php artisan list --format=json`.
 *
 * In Laravel 13 the command definition is nested per command (`commands[].definition`),
 * not exposed as a top-level map, so the form model must be read from there.
 */
export function parseArtisanList(text: string): ArtisanCatalog | undefined {
	const parsed = asRecord(parseJson(text));
	const rawCommands = asArray(parsed?.commands);
	if (!parsed || !rawCommands) {
		return undefined;
	}

	const namespaces = parseNamespaceMap(parsed.namespaces);
	const commands: ArtisanCommand[] = [];

	for (const entry of rawCommands) {
		const record = asRecord(entry);
		const name = asString(record?.name);
		if (!record || !name) {
			continue;
		}

		const definition = asRecord(record.definition) ?? {};
		const rawArguments = asRecord(definition.arguments) ?? {};
		const rawOptions = asRecord(definition.options) ?? {};

		const namespace = namespaces.get(name) ?? (name.includes(':') ? name.split(':')[0] : '');

		commands.push({
			name,
			description: asString(record.description) ?? '',
			namespace,
			hidden: asBoolean(record.hidden) ?? false,
			arguments: Object.values(rawArguments).map(parseArgument).filter((item): item is ArtisanArgument => Boolean(item)),
			options: Object.values(rawOptions).map(parseOption).filter((item): item is ArtisanOption => Boolean(item))
		});
	}

	commands.sort((a, b) => a.name.localeCompare(b.name));
	const application = asRecord(parsed.application);

	return {
		applicationName: asString(application?.name),
		applicationVersion: asString(application?.version),
		commands
	};
}

export function isSelectableCommand(command: ArtisanCommand): boolean {
	return !command.hidden && !NON_SELECTABLE_COMMANDS.has(command.name);
}

/**
 * Options a generated form can offer. Framework plumbing and negations are
 * removed; `--force` and other real command flags stay.
 */
export function formOptions(command: ArtisanCommand): ArtisanOption[] {
	return command.options.filter(option => {
		const key = option.name.replace(/^--/, '');
		return !FRAMEWORK_OPTIONS.has(key) && !key.startsWith('no-');
	});
}

export function isValueOption(option: ArtisanOption): boolean {
	return option.acceptsValue;
}

export function optionKey(option: ArtisanOption): string {
	return option.name.replace(/^--/, '');
}

/**
 * Turns collected form values into a fixed argument array. Positional
 * arguments keep definition order, then flags, then `--name=value` pairs.
 */
export function buildArtisanArguments(command: ArtisanCommand, inputs: ArtisanInputs): string[] {
	const args: string[] = [command.name];

	for (const argument of command.arguments) {
		const raw = inputs.arguments.get(argument.name)?.trim();
		if (!raw) {
			continue;
		}
		if (argument.isArray) {
			args.push(...raw.split(',').map(part => part.trim()).filter(Boolean));
		} else {
			args.push(raw);
		}
	}

	for (const flag of inputs.flags) {
		args.push(flag.startsWith('--') ? flag : `--${flag}`);
	}

	for (const [name, value] of inputs.values) {
		if (value.length === 0) {
			continue;
		}
		args.push(`--${name.replace(/^--/, '')}=${value}`);
	}

	return args;
}

export function displayCommand(args: readonly string[]): string {
	return `php artisan ${args.join(' ')}`.trim();
}

/**
 * Commands that never exit. Running them through a captured process would hit
 * the timeout, so they are opened in a terminal instead.
 */
export function isLongRunning(command: string): boolean {
	return LONG_RUNNING_COMMANDS.some(pattern => pattern.test(command));
}
