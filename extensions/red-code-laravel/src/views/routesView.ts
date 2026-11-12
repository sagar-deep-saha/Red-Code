/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SourceLocation } from '../index/graph.js';
import { displayUri, groupRoutes, RouteEntry } from '../index/routes.js';
import { LaravelViewContext } from './context.js';

export class RouteGroupNode extends vscode.TreeItem {
	readonly kind = 'group';

	constructor(readonly groupName: string, readonly routes: readonly RouteEntry[]) {
		super(groupName, vscode.TreeItemCollapsibleState.Expanded);
		this.description = `${routes.length}`;
		this.contextValue = 'routeGroup';
		this.iconPath = new vscode.ThemeIcon('list-unordered');
	}
}

export class RouteNode extends vscode.TreeItem {
	readonly kind = 'route';

	constructor(readonly route: RouteEntry, context: LaravelViewContext) {
		super(displayUri(route.uri), hasDetails(route) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		this.description = [route.methods.join('|'), route.name].filter(Boolean).join('  ');
		this.contextValue = 'route';
		this.iconPath = new vscode.ThemeIcon('globe');

		const location = context.graph()?.routeLocation(route);
		if (location) {
			this.command = commandFor(location, context);
		}

		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**${route.methods.join('|')} ${displayUri(route.uri)}**\n\n`);
		tooltip.appendMarkdown(`Action: \`${route.action}\`\n\n`);
		if (route.middleware.length > 0) {
			tooltip.appendMarkdown(`Middleware: \`${route.middleware.join('`, `')}\`\n\n`);
		}
		if (route.sourcePath) {
			tooltip.appendMarkdown(`Defined at \`${route.sourcePath}\``);
		} else {
			tooltip.appendMarkdown('Defined by a resource/controller route (no source line exposed by artisan).');
		}
		this.tooltip = tooltip;
	}
}

export class RouteDetailNode extends vscode.TreeItem {
	readonly kind = 'detail';

	constructor(label: string, description: string, location?: SourceLocation, context?: LaravelViewContext) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.contextValue = 'routeDetail';
		if (location && context) {
			this.command = commandFor(location, context);
			this.tooltip = `${location.file}:${location.line}`;
		}
	}
}

export function commandFor(location: SourceLocation, context: LaravelViewContext): vscode.Command {
	const project = context.project();
	const absolute = /^(?:[A-Za-z]:[\\/]|[\\/])/.test(location.file);
	const uri = absolute
		? vscode.Uri.file(location.file).toString()
		: project ? vscode.Uri.joinPath(project.root, location.file).toString() : location.file;
	return {
		command: 'redCode.laravel.openLocation',
		title: 'Open',
		arguments: [uri, location.line, 1]
	};
}

function hasDetails(route: RouteEntry): boolean {
	return Boolean(route.controllerClass) || route.middleware.length > 0 || Boolean(route.sourcePath) || route.isClosure;
}

function detailChildren(route: RouteEntry, context: LaravelViewContext): RouteDetailNode[] {
	const graph = context.graph();
	const children: RouteDetailNode[] = [];

	if (route.controllerClass) {
		const graphClass = graph?.class(route.controllerClass);
		const methodLocation = graph?.methodLocation(route.controllerClass, route.controllerMethod);
		const className = route.controllerClass.split('\\').at(-1) ?? route.controllerClass;
		children.push(new RouteDetailNode(
			'Controller',
			`${className}@${route.controllerMethod ?? '?'}`,
			methodLocation ?? graph?.classLocation(graphClass),
			context
		));
	}

	for (const middleware of route.middleware) {
		children.push(new RouteDetailNode('Middleware', middleware));
	}

	if (route.sourcePath) {
		const separator = route.sourcePath.lastIndexOf(':');
		const file = separator > 0 ? route.sourcePath.slice(0, separator) : route.sourcePath;
		const line = separator > 0 ? Number.parseInt(route.sourcePath.slice(separator + 1), 10) : 1;
		children.push(new RouteDetailNode('Definition', route.sourcePath, { file, line: Number.isFinite(line) ? line : 1 }, context));
	}

	if (route.isClosure) {
		children.push(new RouteDetailNode('Handler', 'Closure'));
	}

	return children;
}

export class RoutesTreeProvider implements vscode.TreeDataProvider<RouteGroupNode | RouteNode | RouteDetailNode> {
	private readonly changeEmitter = new vscode.EventEmitter<RouteGroupNode | RouteNode | RouteDetailNode | undefined | void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly context: LaravelViewContext) { }

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(element: RouteGroupNode | RouteNode | RouteDetailNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: RouteGroupNode | RouteNode | RouteDetailNode): Promise<Array<RouteGroupNode | RouteNode | RouteDetailNode>> {
		if (!element) {
			const graph = await this.context.ensureIndex();
			if (!graph) {
				return [];
			}
			return groupRoutes(graph.routes, this.context.showVendorRoutes())
				.map(group => new RouteGroupNode(group.name, group.routes));
		}

		if (element instanceof RouteGroupNode) {
			return element.routes.map(route => new RouteNode(route, this.context));
		}

		if (element instanceof RouteNode) {
			return detailChildren(element.route, this.context);
		}

		return [];
	}
}
