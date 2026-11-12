/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface RouteEntry {
	readonly methods: readonly string[];
	readonly uri: string;
	readonly name: string | undefined;
	readonly action: string;
	readonly middleware: readonly string[];
	readonly sourcePath: string | undefined;
	readonly isClosure: boolean;
	readonly isVendor: boolean;
	readonly controllerClass: string | undefined;
	readonly controllerMethod: string | undefined;
}

export interface RouteGroup {
	readonly name: string;
	readonly routes: readonly RouteEntry[];
}

const FRAMEWORK_NAMESPACES = /^(?:Illuminate|Laravel|Symfony|Monolog|Psr|Composer)\\/;
const METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'ANY'];
const GROUP_ORDER = ['web', 'api', 'console'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tryParse(text: string): unknown {
	try {
		return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch {
		return undefined;
	}
}

function methodRank(method: string): number {
	const index = METHOD_ORDER.indexOf(method);
	return index === -1 ? METHOD_ORDER.length : index;
}

export function splitMethods(value: string): string[] {
	const methods = [...new Set(value.split('|').map(part => part.trim().toUpperCase()).filter(Boolean))];
	return methods.sort((a, b) => methodRank(a) - methodRank(b) || a.localeCompare(b));
}

function parseAction(action: string): { controllerClass: string | undefined; controllerMethod: string | undefined } {
	if (action.length === 0 || action === 'Closure') {
		return { controllerClass: undefined, controllerMethod: undefined };
	}

	const separator = action.indexOf('@');
	if (separator > 0) {
		return {
			controllerClass: action.slice(0, separator),
			controllerMethod: action.slice(separator + 1)
		};
	}

	return { controllerClass: action, controllerMethod: undefined };
}

function compareRoutes(a: RouteEntry, b: RouteEntry): number {
	const groupDiff = groupRank(routeGroupName(a.middleware)) - groupRank(routeGroupName(b.middleware));
	if (groupDiff !== 0) {
		return groupDiff;
	}
	const uriDiff = a.uri.localeCompare(b.uri);
	if (uriDiff !== 0) {
		return uriDiff;
	}
	return methodRank(a.methods[0] ?? '') - methodRank(b.methods[0] ?? '');
}

function groupRank(name: string): number {
	const index = GROUP_ORDER.indexOf(name);
	return index === -1 ? GROUP_ORDER.length : index;
}

export function routeGroupName(middleware: readonly string[]): string {
	for (const entry of middleware) {
		if (GROUP_ORDER.includes(entry)) {
			return entry;
		}
	}
	return middleware[0] ?? 'web';
}

/**
 * Parses `php artisan route:list --json`. Tolerates both a bare array and an
 * object with `routes`, because the wrapper differs between versions.
 *
 * Laravel 13 has no `vendor` boolean and omits `path` for `Route::resource`
 * routes, so both vendor detection and source navigation are derived.
 */
export function parseRouteList(text: string): RouteEntry[] | undefined {
	const parsed = tryParse(text);
	const list = Array.isArray(parsed)
		? parsed
		: isRecord(parsed) && Array.isArray(parsed.routes) ? parsed.routes : undefined;
	if (!list) {
		return undefined;
	}

	const entries: RouteEntry[] = [];
	for (const item of list) {
		if (!isRecord(item) || typeof item.uri !== 'string') {
			continue;
		}

		const action = typeof item.action === 'string' ? item.action : 'Closure';
		const sourcePath = typeof item.path === 'string' && item.path.length > 0 ? item.path : undefined;
		const { controllerClass, controllerMethod } = parseAction(action);
		const middleware = Array.isArray(item.middleware)
			? item.middleware.filter((entry): entry is string => typeof entry === 'string')
			: [];

		entries.push({
			methods: splitMethods(typeof item.method === 'string' ? item.method : ''),
			uri: item.uri,
			name: typeof item.name === 'string' && item.name.length > 0 ? item.name : undefined,
			action,
			middleware,
			sourcePath,
			isClosure: action === 'Closure',
			isVendor: Boolean(sourcePath?.startsWith('vendor/')) || FRAMEWORK_NAMESPACES.test(action),
			controllerClass,
			controllerMethod
		});
	}

	return entries.sort(compareRoutes);
}

/**
 * Groups routes by middleware group for the tree view. Vendor routes are
 * hidden unless explicitly requested.
 */
export function groupRoutes(routes: readonly RouteEntry[], includeVendor = false): RouteGroup[] {
	const groups = new Map<string, RouteEntry[]>();
	for (const route of routes) {
		if (!includeVendor && route.isVendor) {
			continue;
		}
		const name = routeGroupName(route.middleware);
		const existing = groups.get(name);
		if (existing) {
			existing.push(route);
		} else {
			groups.set(name, [route]);
		}
	}

	return [...groups.entries()]
		.sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))
		.map(([name, entries]) => ({ name, routes: entries }));
}

export function displayUri(uri: string): string {
	const trimmed = uri.trim();
	if (!trimmed || trimmed === '/') {
		return '/';
	}
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Replaces route parameters with a sample value so a URL is directly usable by
 * cURL or a browser. `/posts/{post}` → `/posts/1`.
 */
export function toConcreteUri(uri: string): string {
	return displayUri(uri).replace(/\{[^}]+\}/g, '1');
}

export function requestMethod(route: RouteEntry): string {
	return route.methods.find(method => method !== 'HEAD') ?? 'GET';
}

export function buildCurlCommand(method: string, url: string): string {
	return `curl -X ${method} "${url}"`;
}
