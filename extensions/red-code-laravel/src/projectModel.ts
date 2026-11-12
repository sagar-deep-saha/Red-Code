/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';

export interface ComposerProjectInfo {
	readonly isLaravel: boolean;
	readonly phpConstraint: string | undefined;
	readonly frameworkConstraint: string | undefined;
}

export interface LaravelRuntimeInfo {
	readonly laravelVersion: string | undefined;
	readonly phpVersion: string | undefined;
	readonly composerVersion: string | undefined;
	readonly environment: string | undefined;
	readonly debugMode: boolean;
	readonly databaseDriver: string | undefined;
	readonly cacheDriver: string | undefined;
	readonly queueDriver: string | undefined;
}

function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(stripBom(text));
	} catch {
		return undefined;
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/**
 * Reads the parts of composer.json that matter for project detection.
 * Returns `undefined` when the file is not a JSON object at all.
 */
export function parseComposerJson(text: string): ComposerProjectInfo | undefined {
	const parsed = asRecord(parseJson(text));
	if (!parsed) {
		return undefined;
	}

	const require = asRecord(parsed.require) ?? {};
	const framework = require['laravel/framework'];
	const php = require['php'];

	return {
		isLaravel: typeof framework === 'string',
		frameworkConstraint: asString(framework),
		phpConstraint: asString(php)
	};
}

/**
 * Reads the installed framework version from composer.lock. The lock file is
 * authoritative: the constraint in composer.json is a range, the lock is real.
 */
export function parseLaravelVersionFromLock(text: string): string | undefined {
	const lock = asRecord(parseJson(text));
	if (!lock) {
		return undefined;
	}

	for (const section of ['packages', 'packages-dev']) {
		const packages = lock[section];
		if (!Array.isArray(packages)) {
			continue;
		}
		for (const entry of packages) {
			const record = asRecord(entry);
			if (record?.name === 'laravel/framework') {
				const version = asString(record.version);
				if (version) {
					return version;
				}
			}
		}
	}

	return undefined;
}

/**
 * Normalizes `php artisan about --json`. Missing sections stay `undefined`
 * instead of failing the whole report, because the schema varies by version.
 */
export function parseAboutJson(text: string): LaravelRuntimeInfo | undefined {
	const about = asRecord(parseJson(text));
	if (!about) {
		return undefined;
	}

	const environment = asRecord(about.environment) ?? {};
	const drivers = asRecord(about.drivers) ?? {};

	return {
		laravelVersion: asString(environment.laravel_version),
		phpVersion: asString(environment.php_version),
		composerVersion: asString(environment.composer_version),
		environment: asString(environment.environment),
		debugMode: environment.debug_mode === true,
		databaseDriver: asString(drivers.database),
		cacheDriver: asString(drivers.cache),
		queueDriver: asString(drivers.queue)
	};
}

/**
 * Herd's `php.bat` in `.config/herd/bin` is a one-line wrapper that names the
 * PHP version the user selected for the CLI, for example:
 *
 *     @echo off
 *     "C:\Users\me\.config\herd\bin\php83\php.exe" %*
 *
 * Reading that file (never executing it) lets the extension use the same PHP
 * Herd uses for the site, instead of guessing the newest installed version.
 */
export function parseHerdPhpShim(text: string): string | undefined {
	const match = /"?([A-Za-z]:[\\/][^\r\n"]*?php\.exe)"?/i.exec(text);
	return match ? match[1] : undefined;
}

/**
 * Ordered PHP candidates. Herd is checked before PATH because Herd versions are
 * the ones Laravel developers actually target, and because `php.bat` on PATH
 * cannot be launched with execFile.
 *
 * Only `.exe` and absolute binaries are returned: batch files are never valid.
 */
export function phpCandidates(homeDir: string, platform: NodeJS.Platform): string[] {
	if (platform === 'win32') {
		return [
			path.join(homeDir, '.config', 'herd', 'bin', 'php85', 'php.exe'),
			path.join(homeDir, '.config', 'herd', 'bin', 'php84', 'php.exe'),
			path.join(homeDir, '.config', 'herd', 'bin', 'php83', 'php.exe'),
			'php.exe'
		];
	}

	return ['/opt/homebrew/bin/php', '/usr/local/bin/php', '/usr/bin/php', 'php'];
}

/**
 * Keeps a single, short line of stdout for version-style probes and rejects
 * multi-line or oversized output.
 */
export function formatVersionOutput(stdout: string): string | undefined {
	const line = stdout.split(/\r?\n/).map(part => part.trim()).find(part => part.length > 0);
	return line && line.length <= 64 ? line : undefined;
}
