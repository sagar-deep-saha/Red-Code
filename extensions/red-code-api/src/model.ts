/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Request model and the pure parsing/normalization around it.
 *
 * Everything in this file is free of `vscode` and Node imports so it can be tested directly and
 * reused from the webview message handler without a running editor.
 */

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export type HttpMethod = typeof HTTP_METHODS[number];

export function isHttpMethod(value: unknown): value is HttpMethod {
	return typeof value === 'string' && (HTTP_METHODS as readonly string[]).includes(value.toUpperCase());
}

export interface KeyValue {
	name: string;
	value: string;
	enabled: boolean;
}

export type BodyMode = 'none' | 'json' | 'text';

export interface ApiBody {
	mode: BodyMode;
	text: string;
}

export interface ApiRequest {
	name: string;
	method: HttpMethod;
	url: string;
	params: KeyValue[];
	headers: KeyValue[];
	body: ApiBody;
}

export interface Collection {
	name: string;
	requests: ApiRequest[];
}

export interface BaseUrlProfile {
	name: string;
	url: string;
}

export interface SavedEndpoint {
	id: string;
	collection: string;
	request: ApiRequest;
}

export interface ResolvedRequest {
	method: HttpMethod;
	url: string;
	headers: Record<string, string>;
	body?: Buffer;
}

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;

export interface Substitution {
	text: string;
	missing: string[];
}

/**
 * Replaces `{{name}}` only when the variable has a value. Unknown names stay in the text and are
 * reported, so a broken request surfaces the typo instead of reaching the server.
 */
export function substitute(input: string, variables: Readonly<Record<string, string | undefined>>): Substitution {
	const missing: string[] = [];
	const text = input.replace(VARIABLE_PATTERN, (match, name: string) => {
		const value = variables[name];
		if (value === undefined) {
			if (!missing.includes(name)) {
				missing.push(name);
			}
			return match;
		}
		return value;
	});
	return { text, missing };
}

export function substituteText(input: string, variables: Readonly<Record<string, string | undefined>>): string {
	return substitute(input, variables).text;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return '';
}

/** Accepts the file format's array form and a plain `{ "Header": "value" }` object. */
export function normalizeKeyValues(value: unknown): KeyValue[] {
	if (Array.isArray(value)) {
		return value
			.map(entry => {
				const record = asRecord(entry);
				if (!record) {
					return undefined;
				}
				const name = asString(record.name ?? record.key).trim();
				if (!name) {
					return undefined;
				}
				return {
					name,
					value: asString(record.value),
					enabled: record.enabled === undefined ? true : Boolean(record.enabled)
				} satisfies KeyValue;
			})
			.filter((entry): entry is KeyValue => entry !== undefined);
	}

	const record = asRecord(value);
	if (!record) {
		return [];
	}
	return Object.entries(record).map(([name, entry]) => ({ name, value: asString(entry), enabled: true }));
}

export function normalizeBody(value: unknown): ApiBody {
	if (typeof value === 'string') {
		return { mode: value.trim().length > 0 ? 'json' : 'none', text: value };
	}
	const record = asRecord(value);
	if (!record) {
		return { mode: 'none', text: '' };
	}
	const mode = record.mode === 'json' || record.mode === 'text' || record.mode === 'none' ? record.mode : 'none';
	return { mode, text: asString(record.text ?? record.content) };
}

export function normalizeRequest(value: unknown): ApiRequest {
	const record = asRecord(value) ?? {};
	const method = isHttpMethod(record.method) ? record.method.toUpperCase() as HttpMethod : 'GET';
	const url = asString(record.url ?? record.path).trim();
	if (!url) {
		throw new Error('A request needs a URL.');
	}
	return {
		name: asString(record.name).trim() || `${method} ${url}`,
		method,
		url,
		params: normalizeKeyValues(record.params ?? record.query),
		headers: normalizeKeyValues(record.headers),
		body: normalizeBody(record.body)
	};
}

/** Reads a collection file created by this extension. Throws with a readable message otherwise. */
export function parseCollectionJson(text: string, fallbackName: string): Collection {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}

	const record = asRecord(parsed);
	if (record) {
		const requests = Array.isArray(record.requests) ? record.requests : Array.isArray(record.items) ? record.items : undefined;
		if (!requests) {
			throw new Error('Expected a "requests" array.');
		}
		return {
			name: asString(record.name).trim() || fallbackName,
			requests: requests.map(entry => normalizeRequest(entry))
		};
	}

	if (Array.isArray(parsed)) {
		return { name: fallbackName, requests: parsed.map(entry => normalizeRequest(entry)) };
	}

	throw new Error('Expected an object with a "requests" array.');
}

export function serializeCollection(collection: Collection): string {
	return `${JSON.stringify({
		name: collection.name,
		requests: collection.requests.map(request => ({
			name: request.name,
			method: request.method,
			url: request.url,
			params: request.params,
			headers: request.headers,
			body: request.body
		}))
	}, undefined, '\t')}\n`;
}

function appendQuery(url: string, params: readonly KeyValue[], variables: Readonly<Record<string, string | undefined>>): string {
	const enabled = params.filter(param => param.enabled && param.name.trim().length > 0);
	if (enabled.length === 0) {
		return url;
	}

	const hashIndex = url.indexOf('#');
	const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
	const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
	const query = enabled
		.map(param => `${encodeURIComponent(substituteText(param.name, variables))}=${encodeURIComponent(substituteText(param.value, variables))}`)
		.join('&');
	const separator = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
	return `${base}${separator}${query}${hash}`;
}

export function buildUrl(request: ApiRequest, variables: Readonly<Record<string, string | undefined>>): string {
	const url = substituteText(request.url.trim(), variables);
	if (!url) {
		throw new Error('Request URL is empty.');
	}
	if (!/^https?:\/\//i.test(url)) {
		throw new Error(`Request URL must start with http:// or https://: ${url}`);
	}
	return appendQuery(url, request.params, variables);
}

export function buildHeaders(request: ApiRequest, variables: Readonly<Record<string, string | undefined>>): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: 'application/json, text/plain, */*',
		'User-Agent': 'Red-Code-API'
	};
	if (request.body.mode === 'json') {
		headers['Content-Type'] = 'application/json';
	} else if (request.body.mode === 'text') {
		headers['Content-Type'] = 'text/plain; charset=utf-8';
	}

	for (const header of request.headers) {
		if (!header.enabled || header.name.trim().length === 0) {
			continue;
		}
		const name = substituteText(header.name, variables).trim();
		for (const existing of Object.keys(headers)) {
			if (existing.toLowerCase() === name.toLowerCase()) {
				delete headers[existing];
			}
		}
		headers[name] = substituteText(header.value, variables);
	}
	return headers;
}

export function resolveRequest(request: ApiRequest, variables: Readonly<Record<string, string | undefined>>): ResolvedRequest {
	const url = buildUrl(request, variables);
	const headers = buildHeaders(request, variables);
	const text = substituteText(request.body.text, variables);
	return {
		method: request.method,
		url,
		headers,
		body: request.body.mode === 'none' || text.length === 0 ? undefined : Buffer.from(text, 'utf8')
	};
}

export function missingVariables(request: ApiRequest, variables: Readonly<Record<string, string | undefined>>): string[] {
	const pieces = [
		request.url,
		...request.params.flatMap(param => [param.name, param.value]),
		...request.headers.flatMap(header => [header.name, header.value]),
		request.body.text
	];
	const missing = new Set<string>();
	for (const piece of pieces) {
		for (const name of substitute(piece, variables).missing) {
			missing.add(name);
		}
	}
	return [...missing];
}

/** Parses the subset of `.env` that Laravel projects actually use. */
export function parseDotEnv(text: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith('#')) {
			continue;
		}
		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line);
		if (!match) {
			continue;
		}
		const [, name, rawValue] = match;
		values[name] = unquoteValue(rawValue);
	}
	return values;
}

function unquoteValue(rawValue: string): string {
	const value = rawValue.trim();
	if (value.startsWith('"')) {
		const end = findClosingQuote(value, '"');
		return unescapeDouble(value.slice(1, end));
	}
	if (value.startsWith('\'')) {
		const end = findClosingQuote(value, '\'');
		return value.slice(1, end);
	}
	const comment = value.search(/\s#/);
	return (comment >= 0 ? value.slice(0, comment) : value).trim();
}

function findClosingQuote(value: string, quote: string): number {
	for (let index = 1; index < value.length; index++) {
		if (value[index] === '\\' && quote === '"') {
			index++;
			continue;
		}
		if (value[index] === quote) {
			return index;
		}
	}
	return value.length;
}

function unescapeDouble(value: string): string {
	return value.replace(/\\(n|r|t|"|\\)/g, (_match, code: string) => {
		switch (code) {
			case 'n': return '\n';
			case 'r': return '\r';
			case 't': return '\t';
			default: return code;
		}
	});
}

/** Splits a `.http` file into requests. `###` starts a new request and its text is the name. */
export function parseHttpFile(text: string, fallbackName: string): ApiRequest[] {
	const groups: { name: string; lines: string[] }[] = [{ name: '', lines: [] }];
	for (const line of text.split(/\r?\n/)) {
		if (line.startsWith('###')) {
			groups.push({ name: line.slice(3).trim(), lines: [] });
		} else {
			groups[groups.length - 1].lines.push(line);
		}
	}

	const requests: ApiRequest[] = [];
	for (const group of groups) {
		const lines = group.lines;
		const name = group.name;

		let index = 0;
		while (index < lines.length && (lines[index].trim().length === 0 || lines[index].trimStart().startsWith('#'))) {
			index++;
		}
		if (index >= lines.length) {
			continue;
		}

		const requestLine = lines[index].trim();
		index++;
		const requestMatch = /^([A-Za-z]+)\s+(\S+)$/.exec(requestLine);
		const urlOnly = /^(https?:\/\/\S+|\/\/\S+|\/\S*)$/i.exec(requestLine);
		if (!requestMatch && !urlOnly) {
			continue;
		}

		const method = requestMatch && isHttpMethod(requestMatch[1]) ? requestMatch[1].toUpperCase() as HttpMethod : 'GET';
		const url = requestMatch ? requestMatch[2] : requestLine;
		const headers: KeyValue[] = [];
		while (index < lines.length && lines[index].trim().length > 0) {
			const headerMatch = /^([^:#][^:]*):\s*(.*)$/.exec(lines[index].trim());
			if (headerMatch) {
				headers.push({ name: headerMatch[1].trim(), value: headerMatch[2], enabled: true });
			}
			index++;
		}
		while (index < lines.length && lines[index].trim().length === 0) {
			index++;
		}
		const bodyText = lines.slice(index).join('\n').replace(/\s+$/, '');
		const contentType = headers.find(header => header.name.toLowerCase() === 'content-type')?.value ?? '';
		const mode: BodyMode = bodyText.length === 0 ? 'none' : /json/i.test(contentType) ? 'json' : 'text';

		requests.push({
			name: name || `${method} ${url}`,
			method,
			url,
			params: [],
			headers,
			body: { mode, text: bodyText }
		});
	}
	if (requests.length === 0) {
		throw new Error(`No requests found in ${fallbackName}.`);
	}
	return requests;
}

/** `GET` and `HEAD` must not carry a body; everything else may. */
export function allowsBody(method: HttpMethod): boolean {
	return method !== 'GET' && method !== 'HEAD';
}
