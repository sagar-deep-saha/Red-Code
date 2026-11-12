/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LaravelGraph } from './index/graph.js';
import { BladeReference, extractReferences } from './index/views.js';
import { locationCommandUri } from './locations.js';

export interface NavigationDeps {
	graph(): LaravelGraph | undefined;
	root(): vscode.Uri | undefined;
}

function targetFor(reference: BladeReference, graph: LaravelGraph, root: vscode.Uri): { uri: vscode.Uri; tooltip: string } | undefined {
	switch (reference.kind) {
		case 'route': {
			const route = graph.routeByName(reference.value);
			if (!route) {
				return undefined;
			}
			const location = graph.routeLocation(route);
			if (!location) {
				return undefined;
			}
			const methods = route.methods.join('|');
			return {
				uri: locationCommandUri(location, root),
				tooltip: `Route ${methods} /${route.uri} → ${location.file}:${location.line}`
			};
		}
		case 'tag': {
			const component = graph.component(reference.value);
			return component
				? { uri: vscode.Uri.joinPath(root, component.file), tooltip: `Component <x-${reference.value}> → ${component.file}` }
				: undefined;
		}
		case 'vite': {
			return graph.files.has(reference.value)
				? { uri: vscode.Uri.joinPath(root, reference.value), tooltip: reference.value }
				: undefined;
		}
		case 'include':
		case 'extends':
		case 'component':
		case 'view': {
			const view = graph.view(reference.value);
			return view
				? { uri: vscode.Uri.joinPath(root, view.file), tooltip: `View ${reference.value} → ${view.file}` }
				: undefined;
		}
		default:
			return undefined;
	}
}

function languageFilter(document: vscode.TextDocument): boolean {
	if (document.languageId === 'php') {
		return true;
	}
	return /\.blade\.php$/i.test(document.uri.path);
}

/**
 * Makes Laravel references clickable in PHP and Blade:
 *
 *   route('posts.show')     → route declaration or controller method
 *   view('posts.index')     → resources/views/posts/index.blade.php
 *   @include('partials.x')  → the included view
 *   <x-alert />             → the component view
 *   @vite('resources/...')  → the asset
 *
 * Links are backed by the semantic graph, so they only exist when the target
 * really resolves.
 */
export class LaravelLinkProvider implements vscode.DocumentLinkProvider {
	constructor(private readonly deps: NavigationDeps) { }

	provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
		const graph = this.deps.graph();
		const root = this.deps.root();
		if (!graph || !root || !languageFilter(document)) {
			return [];
		}

		const text = document.getText();
		const isPhp = document.languageId === 'php';
		const references = extractReferences(text).filter(reference => {
			if (!isPhp) {
				return true;
			}
			return reference.kind === 'route' || reference.kind === 'view';
		});

		const links: vscode.DocumentLink[] = [];
		for (const reference of references) {
			const target = targetFor(reference, graph, root);
			if (!target) {
				continue;
			}
			const range = new vscode.Range(document.positionAt(reference.index), document.positionAt(reference.index + reference.value.length));
			const link = new vscode.DocumentLink(range, target.uri);
			link.tooltip = target.tooltip;
			links.push(link);
		}

		return links;
	}
}

export function registerNavigation(context: vscode.ExtensionContext, deps: NavigationDeps): void {
	const provider = new LaravelLinkProvider(deps);
	context.subscriptions.push(
		vscode.languages.registerDocumentLinkProvider({ language: 'php' }, provider),
		vscode.languages.registerDocumentLinkProvider({ pattern: '**/*.blade.php' }, provider)
	);
}
