/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { parseDotEnv } from './model.js';

export const API_FOLDER = path.join('.redcode', 'api');
export const COLLECTIONS_FOLDER = path.join(API_FOLDER, 'collections');
export const ENVIRONMENTS_FOLDER = path.join(API_FOLDER, 'environments');

export interface VariableSources {
	readonly workspaceRoot: string | undefined;
	readonly environment: string;
	readonly userVariables: Readonly<Record<string, string>>;
}

async function readTextIfPresent(file: string): Promise<string | undefined> {
	try {
		return await readFile(file, 'utf8');
	} catch {
		return undefined;
	}
}

function normalizeBaseUrl(value: string): string {
	return value.replace(/\/+$/, '');
}

/**
 * Merges every variable source a request can use. Later sources win, and the selected environment
 * file is last so a local override never leaks from `.env`.
 */
export async function loadVariables(sources: VariableSources): Promise<Record<string, string>> {
	const variables: Record<string, string> = {};
	for (const [name, value] of Object.entries(sources.userVariables)) {
		variables[name] = String(value);
	}

	if (sources.workspaceRoot) {
		const dotEnv = await readTextIfPresent(path.join(sources.workspaceRoot, '.env'));
		if (dotEnv) {
			for (const [name, value] of Object.entries(parseDotEnv(dotEnv))) {
				variables[name] = value;
			}
		}
		if (variables.APP_URL) {
			variables.baseUrl = normalizeBaseUrl(variables.APP_URL);
		}

		if (sources.environment) {
			const file = path.join(sources.workspaceRoot, ENVIRONMENTS_FOLDER, `${sources.environment}.json`);
			const text = await readTextIfPresent(file);
			if (text) {
				try {
					const parsed: unknown = JSON.parse(text);
					if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
						for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
							if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
								variables[name] = String(value);
							}
						}
					}
				} catch {
					// A malformed environment file must not break the other sources; the caller reports
					// missing variables, which is enough to see that nothing was applied.
				}
			}
		}
	}

	return variables;
}

/** Environment names available for the workspace, without the `.json` extension. */
export async function listEnvironments(workspaceRoot: string | undefined): Promise<string[]> {
	if (!workspaceRoot) {
		return [];
	}
	try {
		const entries = await readdir(path.join(workspaceRoot, ENVIRONMENTS_FOLDER));
		return entries
			.filter(entry => entry.toLowerCase().endsWith('.json'))
			.map(entry => entry.slice(0, -'.json'.length))
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}
