/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Small JSON accessors shared by the index modules. Artisan output varies
 * between Laravel versions, so every read is tolerant and never throws.
 */
export function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseJson(text: string): unknown {
	try {
		return JSON.parse(stripBom(text));
	} catch {
		return undefined;
	}
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

export function asArray(value: unknown): unknown[] | undefined {
	return Array.isArray(value) ? value : undefined;
}
