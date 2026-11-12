/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ArtisanRunner } from './artisan.js';
import { ArtisanCatalog, ArtisanCommand, ArtisanInputs, buildArtisanArguments, displayCommand, formOptions, isLongRunning, isSelectableCommand, isValueOption, optionKey } from './index/commands.js';
import { LaravelProject } from './project.js';

export interface ArtisanDeps {
	runner: ArtisanRunner;
	channel: vscode.OutputChannel;
	project(): LaravelProject | undefined;
	catalog(): Promise<ArtisanCatalog | undefined>;
}

interface CommandPick extends vscode.QuickPickItem {
	readonly command: ArtisanCommand;
}

export async function showArtisanPalette(deps: ArtisanDeps): Promise<void> {
	if (!vscode.workspace.isTrusted) {
		void vscode.window.showWarningMessage(vscode.l10n.t('Trust this workspace to run Artisan commands.'));
		return;
	}
	if (!deps.project()) {
		void vscode.window.showWarningMessage(vscode.l10n.t('Open a Laravel project to run Artisan commands.'));
		return;
	}

	const catalog = await deps.catalog();
	if (!catalog) {
		void vscode.window.showWarningMessage(vscode.l10n.t('Could not read the Artisan command list. See the Red Code Laravel output.'));
		return;
	}

	const items: CommandPick[] = catalog.commands
		.filter(isSelectableCommand)
		.map(command => ({
			label: command.name,
			description: command.description,
			detail: command.namespace || 'general',
			command
		}));

	const picked = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Artisan — {0}', catalog.applicationVersion ?? catalog.applicationName ?? 'Laravel'),
		placeHolder: vscode.l10n.t('Search Artisan commands'),
		matchOnDescription: true,
		matchOnDetail: true
	});

	if (picked) {
		await configureAndRun(deps, picked.command);
	}
}

export async function runNamedArtisanCommand(deps: ArtisanDeps, name: string): Promise<void> {
	if (!vscode.workspace.isTrusted) {
		void vscode.window.showWarningMessage(vscode.l10n.t('Trust this workspace to run Artisan commands.'));
		return;
	}
	const catalog = await deps.catalog();
	const command = catalog?.commands.find(candidate => candidate.name === name);
	if (!command) {
		void vscode.window.showWarningMessage(vscode.l10n.t('Artisan command not found: {0}', name));
		return;
	}
	await configureAndRun(deps, command);
}

async function collectInputs(command: ArtisanCommand): Promise<ArtisanInputs | undefined> {
	const argumentValues = new Map<string, string>();

	for (const argument of command.arguments) {
		const value = await vscode.window.showInputBox({
			title: command.name,
			prompt: argument.description || argument.name,
			placeHolder: argument.isArray ? vscode.l10n.t('{0} (comma separated)', argument.name) : argument.name,
			value: argument.defaultValue ?? '',
			ignoreFocusOut: true,
			validateInput: input => argument.required && input.trim().length === 0 ? vscode.l10n.t('This argument is required.') : undefined
		});
		if (value === undefined) {
			return undefined;
		}
		if (value.trim().length > 0) {
			argumentValues.set(argument.name, value.trim());
		}
	}

	const options = formOptions(command);
	const flags: string[] = [];
	const booleanOptions = options.filter(option => !isValueOption(option));
	if (booleanOptions.length > 0) {
		const items: vscode.QuickPickItem[] = booleanOptions.map(option => ({
			label: option.name,
			description: [option.shortcut, option.description].filter(Boolean).join(' · '),
			picked: option.defaultValue === true
		}));
		const picked = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t('{0} — flags', command.name),
			placeHolder: vscode.l10n.t('Select flags (optional)'),
			canPickMany: true
		});
		if (!picked) {
			return undefined;
		}
		flags.push(...picked.map(item => item.label));
	}

	const optionValues = new Map<string, string>();
	const valueOptions = options.filter(isValueOption);
	if (valueOptions.length > 0) {
		const items: vscode.QuickPickItem[] = valueOptions.map(option => ({
			label: option.name,
			description: option.description
		}));
		const picked = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t('{0} — options', command.name),
			placeHolder: vscode.l10n.t('Select options that take a value (optional)'),
			canPickMany: true
		});
		if (!picked) {
			return undefined;
		}

		for (const item of picked) {
			const option = valueOptions.find(candidate => candidate.name === item.label);
			if (!option) {
				continue;
			}
			const preset = typeof option.defaultValue === 'string'
				? option.defaultValue
				: Array.isArray(option.defaultValue) || option.defaultValue === null || option.defaultValue === undefined
					? ''
					: String(option.defaultValue);
			const value = await vscode.window.showInputBox({
				title: option.name,
				prompt: option.description || option.name,
				value: preset,
				ignoreFocusOut: true
			});
			if (value === undefined) {
				return undefined;
			}
			if (value.trim().length > 0) {
				optionValues.set(optionKey(option), value.trim());
			}
		}
	}

	return { arguments: argumentValues, flags, values: optionValues };
}

async function configureAndRun(deps: ArtisanDeps, command: ArtisanCommand): Promise<void> {
	const project = deps.project();
	if (!project) {
		return;
	}

	const inputs = await collectInputs(command);
	if (!inputs) {
		return;
	}

	const args = buildArtisanArguments(command, inputs);
	const missing = command.arguments.filter(argument => argument.required && !inputs.arguments.has(argument.name));
	if (missing.length > 0) {
		void vscode.window.showWarningMessage(vscode.l10n.t('Missing required argument: {0}', missing[0].name));
		return;
	}

	const preview = displayCommand(args);
	const longRunning = isLongRunning(command.name);
	const choices = longRunning
		? [vscode.l10n.t('Open in Terminal'), vscode.l10n.t('Cancel')]
		: [vscode.l10n.t('Run'), vscode.l10n.t('Open in Terminal'), vscode.l10n.t('Cancel')];

	const choice = await vscode.window.showQuickPick(choices, {
		title: preview,
		placeHolder: command.description
	});

	if (!choice || choice === vscode.l10n.t('Cancel')) {
		return;
	}

	if (choice === vscode.l10n.t('Open in Terminal') || longRunning) {
		openInTerminal(deps, project, command.name, args);
		return;
	}

	await runCaptured(deps, project, args, preview);
}

async function runCaptured(deps: ArtisanDeps, project: LaravelProject, args: readonly string[], preview: string): Promise<void> {
	const result = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: preview, cancellable: true },
		(_progress, token) => deps.runner.run(project, args, { timeoutMs: 120_000, token })
	);

	if (result.code === 0) {
		void vscode.window.showInformationMessage(vscode.l10n.t('Artisan finished in {0} ms.', String(result.durationMs)));
		return;
	}

	const message = result.timedOut
		? vscode.l10n.t('Artisan timed out after {0} ms.', String(result.durationMs))
		: vscode.l10n.t('Artisan exited with code {0}.', String(result.code));
	const action = await vscode.window.showWarningMessage(message, vscode.l10n.t('Show Output'));
	if (action) {
		deps.channel.show(true);
	}
}

function openInTerminal(deps: ArtisanDeps, project: LaravelProject, commandName: string, args: readonly string[]): void {
	if (!project.php) {
		void vscode.window.showErrorMessage(vscode.l10n.t('No php.exe was found. Set redCode.laravel.phpPath.'));
		return;
	}

	const shell = vscode.env.shell;
	const quote = (value: string) => /powershell|pwsh/i.test(shell)
		? `'${value.replace(/'/g, "''")}'`
		: `"${value.replace(/"/g, '\\"')}"`;
	const line = [project.php, project.artisan.fsPath, ...args].map(quote).join(' ');

	deps.channel.appendLine(vscode.l10n.t('terminal: {0}', line));
	const terminal = vscode.window.createTerminal({
		name: `Laravel: ${commandName}`,
		cwd: project.root.fsPath
	});
	terminal.show();
	terminal.sendText(line);
}

