/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { ApiRequest, HttpMethod, isHttpMethod } from './model.js';

export interface LaravelRoute {
	method: string;
	uri: string;
	name: string;
	action: string;
}

/**
 * `php artisan route:list --json`, used to prefill a request. The command is read-only and is run
 * with the configured PHP binary, never through a shell.
 */
export function runPhpListRoutes(folder: string, phpPath: string, timeoutMs = 30000): Promise<LaravelRoute[]> {
	const artisan = path.join(folder, 'artisan');
	if (!existsSync(artisan)) {
		return Promise.reject(new Error(`No artisan file in ${folder}.`));
	}

	return new Promise((resolve, reject) => {
		let settled = false;
		let timer: NodeJS.Timeout | undefined;
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		const child = spawn(phpPath || 'php', ['artisan', 'route:list', '--json'], {
			cwd: folder,
			windowsHide: true,
			env: process.env
		});

		const finish = (error: Error | undefined, value?: LaravelRoute[]) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
			}
			if (error) {
				reject(error);
			} else {
				resolve(value ?? []);
			}
		};

		timer = setTimeout(() => {
			child.kill();
			finish(new Error(`php artisan route:list did not finish within ${Math.round(timeoutMs / 1000)} seconds.`));
		}, timeoutMs);

		child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
		child.on('error', error => finish(new Error((error as NodeJS.ErrnoException).code === 'ENOENT'
			? `PHP was not found (${phpPath || 'php'}). Set redCode.laravel.phpPath.`
			: `Could not run PHP: ${error.message}`)));
		child.on('close', code => {
			if (code !== 0) {
				const text = Buffer.concat(stderr).toString('utf8').trim().split(/\r?\n/)[0];
				finish(new Error(text || `php artisan route:list exited with code ${code}.`));
				return;
			}
			try {
				finish(undefined, parseRouteList(Buffer.concat(stdout).toString('utf8')));
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		});
	});
}

function methodOf(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.filter(entry => typeof entry === 'string').join('|');
	}
	return '';
}

/** Laravel emits `method` as `GET|HEAD`; the first token is the verb to prefill. */
export function parseRouteList(text: string): LaravelRoute[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		const start = text.indexOf('[');
		const end = text.lastIndexOf(']');
		if (start < 0 || end <= start) {
			throw new Error('route:list did not return JSON.');
		}
		parsed = JSON.parse(text.slice(start, end + 1));
	}
	if (!Array.isArray(parsed)) {
		throw new Error('route:list did not return a list.');
	}

	return parsed
		.map(entry => {
			if (typeof entry !== 'object' || entry === null) {
				return undefined;
			}
			const record = entry as Record<string, unknown>;
			const uri = typeof record.uri === 'string' ? record.uri : '';
			if (!uri) {
				return undefined;
			}
			return {
				method: methodOf(record.method),
				uri,
				name: typeof record.name === 'string' ? record.name : '',
				action: typeof record.action === 'string' ? record.action : ''
			};
		})
		.filter((entry): entry is LaravelRoute => entry !== undefined);
}

export function requestFromRoute(route: LaravelRoute): ApiRequest {
	const first = route.method.split('|')[0].trim().toUpperCase();
	const method: HttpMethod = isHttpMethod(first) ? first as HttpMethod : 'GET';
	const path = route.uri === '/' ? '' : `/${route.uri.replace(/^\/+/, '')}`;
	return {
		name: route.name || `${method} ${path || '/'}`,
		method,
		url: `{{baseUrl}}${path}`,
		params: [],
		headers: [{ name: 'Accept', value: 'application/json', enabled: true }],
		body: { mode: 'none', text: '' }
	};
}
