/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ProjectGroup =
	| 'Application' | 'HTTP' | 'Views' | 'Database'
	| 'Configuration' | 'Tests' | 'Packages' | 'Other';

export type BladeReferenceKind = 'include' | 'extends' | 'component' | 'tag' | 'route' | 'view' | 'vite';

export interface BladeReference {
	readonly kind: BladeReferenceKind;
	readonly value: string;
	readonly line: number;
	readonly index: number;
}

const GROUP_PREFIXES: ReadonlyArray<readonly [string, ProjectGroup]> = [
	['app/Http/Controllers/', 'HTTP'],
	['app/Http/Middleware/', 'HTTP'],
	['app/Http/Requests/', 'HTTP'],
	['app/Http/Resources/', 'HTTP'],
	['resources/views/components/', 'Views'],
	['resources/views/', 'Views'],
	['resources/js/', 'Views'],
	['resources/css/', 'Views'],
	['app/', 'Application'],
	['database/', 'Database'],
	['config/', 'Configuration'],
	['routes/', 'Configuration'],
	['bootstrap/', 'Configuration'],
	['tests/', 'Tests'],
	['vendor/', 'Packages'],
	['packages/', 'Packages']
];

const DIRECTIVE_PATTERN = /@(include|includeIf|includeWhen|each|extends|component)\s*\(\s*['"]([^'"]+)['"]/g;
const TAG_PATTERN = /<x-([A-Za-z0-9_.:-]+)/g;
const ROUTE_PATTERN = /\broute\s*\(\s*['"]([^'"]+)['"]/g;
const VIEW_PATTERN = /\bview\s*\(\s*['"]([^'"]+)['"]/g;
const VIEW_MAKE_PATTERN = /\bView::make\s*\(\s*['"]([^'"]+)['"]/g;
const VITE_PATTERN = /@vite\s*\(\s*\[?\s*['"]([^'"]+)['"]/g;

function normalize(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function projectGroupForPath(relativePath: string): ProjectGroup {
	const path = normalize(relativePath);
	for (const [prefix, group] of GROUP_PREFIXES) {
		if (path.startsWith(prefix)) {
			return group;
		}
	}
	return 'Other';
}

/**
 * `resources/views/users/index.blade.php` → `users.index`, which is the name
 * accepted by `view()` and `@include`.
 */
export function viewNameFromPath(relativePath: string): string | undefined {
	const path = normalize(relativePath);
	const marker = 'resources/views/';
	const markerIndex = path.indexOf(marker);
	if (markerIndex < 0) {
		return undefined;
	}

	const rest = path.slice(markerIndex + marker.length)
		.replace(/\.blade\.php$/i, '')
		.replace(/\.php$/i, '');
	return rest.length > 0 ? rest.split('/').join('.') : undefined;
}

/**
 * `resources/views/components/forms/input.blade.php` → `forms.input`, rendered
 * in Blade as `<x-forms.input />`.
 */
export function componentNameFromPath(relativePath: string): string | undefined {
	const path = normalize(relativePath);
	const marker = 'resources/views/components/';
	const markerIndex = path.indexOf(marker);
	if (markerIndex < 0) {
		return undefined;
	}

	const rest = path.slice(markerIndex + marker.length).replace(/\.blade\.php$/i, '');
	return rest.length > 0 ? rest.split('/').join('.') : undefined;
}

export function isBladePath(relativePath: string): boolean {
	return /\.blade\.php$/i.test(relativePath);
}

function collect(pattern: RegExp, text: string, kind: BladeReferenceKind, map: (value: string) => BladeReferenceKind = () => kind): BladeReference[] {
	const references: BladeReference[] = [];
	pattern.lastIndex = 0;
	let match = pattern.exec(text);
	while (match) {
		const value = match[match.length - 1];
		if (value) {
			// Point at the value itself, not the directive or tag prefix, so the
			// clickable range covers exactly the string the user can navigate from.
			references.push({
				kind: map(match[1] ?? ''),
				value,
				index: match.index + match[0].lastIndexOf(value),
				line: 0
			});
		}
		match = pattern.exec(text);
	}
	return references;
}

/**
 * Extracts static Blade/PHP references so navigation and the component graph
 * can be built without a template compiler. Dynamic arguments are ignored.
 */
export function extractReferences(text: string): BladeReference[] {
	const references = [
		...collect(DIRECTIVE_PATTERN, text, 'include', directive => {
			if (directive === 'extends') {
				return 'extends';
			}
			if (directive === 'component') {
				return 'component';
			}
			return 'include';
		}),
		...collect(TAG_PATTERN, text, 'tag'),
		...collect(ROUTE_PATTERN, text, 'route'),
		...collect(VIEW_PATTERN, text, 'view'),
		...collect(VIEW_MAKE_PATTERN, text, 'view'),
		...collect(VITE_PATTERN, text, 'vite')
	];

	let line = 1;
	let cursor = 0;
	const sorted = references.sort((a, b) => a.index - b.index);
	const result: BladeReference[] = [];
	for (const reference of sorted) {
		while (cursor < reference.index) {
			if (text.charCodeAt(cursor) === 10) {
				line++;
			}
			cursor++;
		}
		result.push({ ...reference, line });
	}

	return result;
}
