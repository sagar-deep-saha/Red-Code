/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PhpVisibility = 'public' | 'protected' | 'private';

export interface PhpMethod {
	readonly name: string;
	readonly line: number;
	readonly visibility: PhpVisibility;
	readonly isStatic: boolean;
}

export type PhpRelationType =
	| 'hasMany' | 'hasOne' | 'belongsTo' | 'belongsToMany'
	| 'morphMany' | 'morphOne' | 'morphToMany' | 'morphTo';

export interface PhpRelation {
	readonly method: string;
	readonly type: PhpRelationType;
	readonly related: string;
	readonly line: number;
}

export interface PhpFileSymbols {
	readonly namespace: string | undefined;
	readonly className: string | undefined;
	readonly extendsClass: string | undefined;
	readonly methods: readonly PhpMethod[];
	readonly relations: readonly PhpRelation[];
	readonly imports: ReadonlyMap<string, string>;
}

interface MethodHit {
	readonly name: string;
	readonly index: number;
	readonly line: number;
	readonly visibility: PhpVisibility;
	readonly isStatic: boolean;
}

const IMPORT_PATTERN = /^use\s+(?:function\s+|const\s+)?([A-Za-z_][\w\\]*)(?:\s+as\s+([A-Za-z_]\w*))?\s*;/gm;
const NAMESPACE_PATTERN = /^[ \t]*namespace\s+([A-Za-z_][\w\\]*)\s*;/m;
const CLASS_PATTERN = /^[ \t]*(?:(?:final|abstract|readonly)\s+)*class\s+([A-Za-z_]\w*)(?:\s+extends\s+([A-Za-z_][\w\\]*))?/m;
const METHOD_PATTERN = /^[ \t]*(?:(public|protected|private)\s+)?(?:(static)\s+)?function\s+([A-Za-z_]\w*)\s*\(/gm;
const RELATION_PATTERN = /\$this->(hasMany|hasOne|belongsTo|belongsToMany|morphMany|morphOne|morphToMany|morphTo)\(\s*([A-Za-z_][\w\\]*)?/g;

function lineAt(text: string, index: number): number {
	let line = 1;
	for (let position = 0; position < index; position++) {
		if (text.charCodeAt(position) === 10) {
			line++;
		}
	}
	return line;
}

function aliasOf(qualifiedName: string): string {
	const parts = qualifiedName.split('\\');
	return parts[parts.length - 1];
}

function parseImports(text: string): Map<string, string> {
	const imports = new Map<string, string>();
	IMPORT_PATTERN.lastIndex = 0;
	let match = IMPORT_PATTERN.exec(text);
	while (match) {
		const qualifiedName = match[1];
		const alias = match[2] ?? aliasOf(qualifiedName);
		imports.set(alias, qualifiedName);
		match = IMPORT_PATTERN.exec(text);
	}
	return imports;
}

function parseMethods(text: string): MethodHit[] {
	const methods: MethodHit[] = [];
	METHOD_PATTERN.lastIndex = 0;
	let match = METHOD_PATTERN.exec(text);
	while (match) {
		const visibility = (match[1] as PhpVisibility | undefined) ?? 'public';
		methods.push({
			name: match[3],
			index: match.index,
			line: lineAt(text, match.index),
			visibility,
			isStatic: Boolean(match[2])
		});
		match = METHOD_PATTERN.exec(text);
	}
	return methods;
}

/**
 * Resolves a class reference written inside a file to a fully qualified name,
 * using the file's namespace and `use` imports. This is what turns
 * `hasMany(Post::class)` into `App\Models\Post`.
 */
export function resolveClassName(raw: string, namespace: string | undefined, imports: ReadonlyMap<string, string>): string {
	const name = raw.trim();
	if (name.startsWith('\\')) {
		return name.slice(1);
	}

	const parts = name.split('\\');
	const aliased = imports.get(parts[0]);
	if (aliased) {
		return [aliased, ...parts.slice(1)].join('\\');
	}

	if (namespace && !name.includes('\\')) {
		return `${namespace}\\${name}`;
	}

	return name;
}

function parseRelations(text: string, namespace: string | undefined, imports: ReadonlyMap<string, string>, methods: readonly MethodHit[]): PhpRelation[] {
	const relations: PhpRelation[] = [];

	for (let index = 0; index < methods.length; index++) {
		const method = methods[index];
		const start = method.index;
		const end = index + 1 < methods.length ? methods[index + 1].index : text.length;
		const block = text.slice(start, end);

		RELATION_PATTERN.lastIndex = 0;
		let match = RELATION_PATTERN.exec(block);
		while (match) {
			const type = match[1] as PhpRelationType;
			const related = match[2] ? resolveClassName(match[2], namespace, imports) : '';
			relations.push({
				method: method.name,
				type,
				related,
				line: method.line
			});
			match = RELATION_PATTERN.exec(block);
		}
	}

	return relations;
}

/**
 * Extracts the symbols Red Code needs from a PHP file: class identity, methods
 * with line numbers, and Eloquent relationship declarations.
 *
 * This is intentionally not a PHP parser. It reads declaration-level patterns,
 * which is enough for navigation; authoritative model metadata still comes from
 * `php artisan model:show --json`.
 */
export function parsePhpFile(text: string): PhpFileSymbols {
	const namespaceMatch = NAMESPACE_PATTERN.exec(text);
	const namespace = namespaceMatch ? namespaceMatch[1] : undefined;
	const classMatch = CLASS_PATTERN.exec(text);
	const imports = parseImports(text);
	const methods = parseMethods(text);

	return {
		namespace,
		className: classMatch ? classMatch[1] : undefined,
		extendsClass: classMatch?.[2] ? resolveClassName(classMatch[2], namespace, imports) : undefined,
		methods: methods.map(method => ({
			name: method.name,
			line: method.line,
			visibility: method.visibility,
			isStatic: method.isStatic
		})),
		relations: parseRelations(text, namespace, imports, methods),
		imports
	};
}
