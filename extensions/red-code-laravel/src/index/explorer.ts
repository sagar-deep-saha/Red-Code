/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProjectGroup } from './views.js';

export interface ExplorerFile {
	readonly relativePath: string;
	readonly label: string;
}

export interface ExplorerSection {
	readonly name: string;
	readonly files: readonly ExplorerFile[];
}

export interface ExplorerGroup {
	readonly name: ProjectGroup;
	readonly sections: readonly ExplorerSection[];
}

const GROUP_ORDER: readonly ProjectGroup[] = [
	'Application', 'HTTP', 'Views', 'Database', 'Configuration', 'Tests', 'Packages'
];

const SECTION_ORDER: Partial<Record<ProjectGroup, readonly string[]>> = {
	Application: [
		'Models', 'Services', 'Repositories', 'Policies', 'Jobs', 'Events', 'Listeners',
		'Notifications', 'Providers', 'Console', 'Exceptions', 'Support'
	],
	HTTP: ['Controllers', 'Requests', 'Middleware', 'Resources'],
	Views: ['components', 'layouts', 'partials'],
	Database: ['migrations', 'factories', 'seeders'],
	Tests: ['Feature', 'Unit'],
	Configuration: ['Project', 'routes', 'config', 'bootstrap'],
	Packages: []
};

const PROJECT_FILES: ReadonlySet<string> = new Set([
	'artisan', 'composer.json', 'composer.lock', 'package.json', 'package-lock.json',
	'pnpm-lock.yaml', 'yarn.lock', 'vite.config.js', 'vite.config.ts', 'phpunit.xml',
	'phpunit.xml.dist', 'tailwind.config.js', 'tailwind.config.ts', 'postcss.config.js',
	'tsconfig.json', 'jsconfig.json', '.env', '.env.example', '.gitignore', '.editorconfig',
	'README.md', 'AGENTS.md'
]);

function normalize(value: string): string {
	return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

interface Classification {
	readonly group: ProjectGroup;
	readonly section: string;
	readonly label: string;
}

/**
 * Maps a project file to an explorer group and section. This is the generated
 * Laravel tree: nothing is hard-coded per project, and files that do not belong
 * to a recognised Laravel role are left to the normal Explorer.
 */
export function classifyExplorerFile(relativePath: string): Classification | undefined {
	const path = normalize(relativePath);

	if (path.startsWith('app/Http/')) {
		const rest = path.slice('app/Http/'.length);
		const parts = rest.split('/');
		return parts.length > 1
			? { group: 'HTTP', section: parts[0], label: parts.slice(1).join('/') }
			: { group: 'HTTP', section: 'HTTP', label: rest };
	}

	if (path.startsWith('app/')) {
		const rest = path.slice('app/'.length);
		const parts = rest.split('/');
		return parts.length > 1
			? { group: 'Application', section: parts[0], label: parts.slice(1).join('/') }
			: { group: 'Application', section: 'Application', label: rest };
	}

	if (path.startsWith('resources/views/')) {
		const rest = path.slice('resources/views/'.length);
		if (!rest) {
			return undefined;
		}
		const parts = rest.split('/');
		return parts.length > 1
			? { group: 'Views', section: parts[0], label: parts.slice(1).join('/') }
			: { group: 'Views', section: 'views', label: rest };
	}

	if (path.startsWith('database/')) {
		const rest = path.slice('database/'.length);
		const parts = rest.split('/');
		return parts.length > 1
			? { group: 'Database', section: parts[0], label: parts.slice(1).join('/') }
			: { group: 'Database', section: 'Database', label: rest };
	}

	if (path.startsWith('tests/')) {
		const rest = path.slice('tests/'.length);
		const parts = rest.split('/');
		return parts.length > 1
			? { group: 'Tests', section: parts[0], label: parts.slice(1).join('/') }
			: { group: 'Tests', section: 'Tests', label: rest };
	}

	for (const directory of ['config', 'routes', 'bootstrap']) {
		if (path.startsWith(`${directory}/`)) {
			const rest = path.slice(directory.length + 1);
			const parts = rest.split('/');
			return parts.length > 1
				? { group: 'Configuration', section: `${directory}/${parts[0]}`, label: parts.slice(1).join('/') }
				: { group: 'Configuration', section: directory, label: rest };
		}
	}

	if (PROJECT_FILES.has(path)) {
		return { group: 'Configuration', section: 'Project', label: path };
	}

	if (path.startsWith('packages/')) {
		const rest = path.slice('packages/'.length);
		const parts = rest.split('/');
		return parts.length > 1
			? { group: 'Packages', section: parts[0], label: parts.slice(1).join('/') }
			: undefined;
	}

	return undefined;
}

function sectionRank(group: ProjectGroup, section: string): number {
	const order = SECTION_ORDER[group] ?? [];
	const index = order.indexOf(section);
	return index === -1 ? order.length : index;
}

/**
 * Builds the Laravel project tree from scanned files. Empty groups and sections
 * are omitted so the tree only contains things that exist.
 */
export function buildExplorer(files: readonly string[]): ExplorerGroup[] {
	const groups = new Map<ProjectGroup, Map<string, ExplorerFile[]>>();

	for (const file of files) {
		const classification = classifyExplorerFile(file);
		if (!classification) {
			continue;
		}
		let sections = groups.get(classification.group);
		if (!sections) {
			sections = new Map<string, ExplorerFile[]>();
			groups.set(classification.group, sections);
		}
		let entries = sections.get(classification.section);
		if (!entries) {
			entries = [];
			sections.set(classification.section, entries);
		}
		entries.push({ relativePath: normalize(file), label: classification.label });
	}

	const result: ExplorerGroup[] = [];
	for (const group of GROUP_ORDER) {
		const sections = groups.get(group);
		if (!sections) {
			continue;
		}

		const sectionList: ExplorerSection[] = [...sections.entries()]
			.sort(([a], [b]) => sectionRank(group, a) - sectionRank(group, b) || a.localeCompare(b))
			.map(([name, entries]) => ({
				name,
				files: entries.slice().sort((a, b) => a.label.localeCompare(b.label))
			}));

		if (sectionList.length > 0) {
			result.push({ name: group, sections: sectionList });
		}
	}

	return result;
}
