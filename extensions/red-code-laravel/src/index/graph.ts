/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PhpMethod, PhpRelation } from './phpSymbols.js';
import { RouteEntry } from './routes.js';
import { BladeReference } from './views.js';

export interface IndexedClass {
	readonly fqcn: string;
	readonly name: string;
	readonly namespace: string | undefined;
	readonly file: string;
	readonly extendsClass: string | undefined;
	readonly methods: readonly PhpMethod[];
	readonly relations: readonly PhpRelation[];
}

export interface IndexedView {
	readonly name: string;
	/** Blade tag name (`forms.input`) when this view is a component. */
	readonly componentName: string | undefined;
	readonly file: string;
	readonly isComponent: boolean;
	readonly references: readonly BladeReference[];
}

export interface SourceLocation {
	readonly file: string;
	readonly line: number;
}

export interface GraphCounts {
	readonly routes: number;
	readonly controllers: number;
	readonly models: number;
	readonly views: number;
	readonly components: number;
	readonly migrations: number;
	readonly tests: number;
}

export interface GraphInput {
	readonly routes: readonly RouteEntry[];
	readonly classes: readonly IndexedClass[];
	readonly views: readonly IndexedView[];
	readonly files?: readonly string[];
}

/**
 * `route:list` reports source paths as `routes/web.php:12`. That is the only
 * place the line is encoded, so it is parsed once here.
 */
export function parseSourcePath(sourcePath: string | undefined): SourceLocation | undefined {
	if (!sourcePath) {
		return undefined;
	}
	const separator = sourcePath.lastIndexOf(':');
	if (separator <= 0) {
		return undefined;
	}
	const line = Number.parseInt(sourcePath.slice(separator + 1), 10);
	if (!Number.isFinite(line) || line < 1) {
		return undefined;
	}
	return { file: sourcePath.slice(0, separator).replace(/\\/g, '/'), line };
}

/**
 * The single graph every view reads. It is deliberately immutable: rebuild it
 * and replace it, never mutate it, so a rendered tree can never see a
 * half-updated index.
 */
export class LaravelGraph {
	readonly routes: readonly RouteEntry[];
	readonly classes: ReadonlyMap<string, IndexedClass>;
	readonly views: ReadonlyMap<string, IndexedView>;
	readonly components: ReadonlyMap<string, IndexedView>;
	readonly files: ReadonlySet<string>;

	private readonly classesByFile = new Map<string, IndexedClass>();
	private readonly routesByClass = new Map<string, RouteEntry[]>();
	private readonly componentUsage = new Map<string, IndexedView[]>();

	constructor(input: GraphInput) {
		this.routes = input.routes;
		this.files = new Set(input.files ?? []);

		const classes = new Map<string, IndexedClass>();
		for (const cls of input.classes) {
			classes.set(cls.fqcn, cls);
			this.classesByFile.set(cls.file, cls);
		}
		this.classes = classes;

		const views = new Map<string, IndexedView>();
		const components = new Map<string, IndexedView>();
		for (const view of input.views) {
			views.set(view.name, view);
			if (view.isComponent) {
				components.set(view.componentName ?? view.name, view);
			}
		}
		this.views = views;
		this.components = components;

		for (const route of this.routes) {
			const cls = this.classForRoute(route);
			if (!cls) {
				continue;
			}
			const existing = this.routesByClass.get(cls.fqcn);
			if (existing) {
				existing.push(route);
			} else {
				this.routesByClass.set(cls.fqcn, [route]);
			}
		}

		for (const view of input.views) {
			for (const reference of view.references) {
				const referenceName = componentReferenceName(reference);
				if (!referenceName) {
					continue;
				}
				const component = this.components.get(referenceName);
				if (!component) {
					continue;
				}
				const key = component.componentName ?? component.name;
				const existing = this.componentUsage.get(key);
				if (existing) {
					existing.push(view);
				} else {
					this.componentUsage.set(key, [view]);
				}
			}
		}
	}

	class(fqcn: string | undefined): IndexedClass | undefined {
		return fqcn ? this.classes.get(fqcn) : undefined;
	}

	classByFile(file: string): IndexedClass | undefined {
		return this.classesByFile.get(file.replace(/\\/g, '/'));
	}

	classForRoute(route: RouteEntry): IndexedClass | undefined {
		return this.class(route.controllerClass);
	}

	routesForClass(fqcn: string): readonly RouteEntry[] {
		return this.routesByClass.get(fqcn) ?? [];
	}

	view(name: string | undefined): IndexedView | undefined {
		return name ? this.views.get(name) : undefined;
	}

	component(name: string | undefined): IndexedView | undefined {
		return name ? this.components.get(name) : undefined;
	}

	usedBy(componentName: string): readonly IndexedView[] {
		return this.componentUsage.get(componentName) ?? [];
	}

	classLocation(cls: IndexedClass | undefined): SourceLocation | undefined {
		return cls ? { file: cls.file, line: 1 } : undefined;
	}

	methodLocation(fqcn: string | undefined, methodName: string | undefined): SourceLocation | undefined {
		const cls = this.class(fqcn);
		if (!cls || !methodName) {
			return undefined;
		}
		const method = cls.methods.find(candidate => candidate.name === methodName);
		return method ? { file: cls.file, line: method.line } : undefined;
	}

	/**
	 * Best available jump target for a route: the route declaration when Laravel
	 * exposes it, otherwise the controller method it dispatches to.
	 */
	routeLocation(route: RouteEntry): SourceLocation | undefined {
		const source = parseSourcePath(route.sourcePath);
		if (source) {
			return source;
		}
		return this.methodLocation(route.controllerClass, route.controllerMethod)
			?? this.classLocation(this.class(route.controllerClass));
	}

	routeByName(name: string): RouteEntry | undefined {
		return this.routes.find(route => route.name === name);
	}

	relationTarget(relation: PhpRelation): IndexedClass | undefined {
		return this.class(relation.related);
	}

	isController(cls: IndexedClass): boolean {
		return /^app\/http\/controllers\//i.test(cls.file) && cls.name.endsWith('Controller');
	}

	isModel(cls: IndexedClass): boolean {
		return cls.extendsClass === 'Illuminate\\Database\\Eloquent\\Model'
			|| cls.extendsClass === 'Illuminate\\Foundation\\Auth\\User'
			|| /^app\/models\//i.test(cls.file);
	}

	counts(): GraphCounts {
		let controllers = 0;
		let models = 0;
		for (const cls of this.classes.values()) {
			if (this.isController(cls)) {
				controllers++;
			}
			if (this.isModel(cls)) {
				models++;
			}
		}

		let migrations = 0;
		let tests = 0;
		for (const file of this.files) {
			if (/^database\/migrations\/.+\.php$/i.test(file)) {
				migrations++;
			}
			if (/^tests\/.+\.php$/i.test(file)) {
				tests++;
			}
		}

		return {
			routes: this.routes.filter(route => !route.isVendor).length,
			controllers,
			models,
			views: [...this.views.values()].filter(view => !view.isComponent).length,
			components: this.components.size,
			migrations,
			tests
		};
	}
}

/**
 * `<x-alert />` yields the tag name, while `@component('components.alert')`
 * yields the view name. Both point at the same component, so the `components.`
 * prefix is stripped before the lookup. Anything else is not a component edge.
 */
function componentReferenceName(reference: BladeReference): string | undefined {
	if (reference.kind === 'tag') {
		return reference.value;
	}
	if (reference.kind === 'component') {
		return reference.value.replace(/^components\./i, '');
	}
	return undefined;
}

export function buildGraph(input: GraphInput): LaravelGraph {
	return new LaravelGraph(input);
}
