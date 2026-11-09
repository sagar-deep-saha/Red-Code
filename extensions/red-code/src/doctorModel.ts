/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DoctorCheck {
	readonly label: string;
	readonly description: string;
	readonly status: 'ok' | 'warning' | 'info';
	readonly folderName?: string;
}

const PACKAGE_LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock'];

export function createWorkspaceChecks(folderName: string, presentPaths: ReadonlySet<string>): DoctorCheck[] {
	const hasPackage = presentPaths.has('package.json');
	const hasComposer = presentPaths.has('composer.json');
	const hasLockfile = PACKAGE_LOCKFILES.some(path => presentPaths.has(path));
	const hasEnv = presentPaths.has('.env');
	const checks: DoctorCheck[] = [
		{
			label: 'Git metadata',
			description: presentPaths.has('.git') ? 'Found .git' : 'No .git entry found',
			status: presentPaths.has('.git') ? 'ok' : 'info'
		},
		{
			label: 'JavaScript project',
			description: hasPackage ? 'Found package.json' : 'No package.json found',
			status: hasPackage ? 'ok' : 'info'
		},
		{
			label: 'Node dependencies',
			description: !hasPackage ? 'Not applicable without package.json' : presentPaths.has('node_modules') ? 'Found node_modules' : 'Dependencies are not installed',
			status: !hasPackage ? 'info' : presentPaths.has('node_modules') ? 'ok' : 'warning'
		},
		{
			label: 'JavaScript lockfile',
			description: !hasPackage ? 'Not applicable without package.json' : hasLockfile ? 'Found a recognized lockfile' : 'No recognized lockfile found',
			status: !hasPackage ? 'info' : hasLockfile ? 'ok' : 'warning'
		},
		{
			label: 'PHP project',
			description: hasComposer ? 'Found composer.json' : 'No composer.json found',
			status: hasComposer ? 'ok' : 'info'
		},
		{
			label: 'Composer dependencies',
			description: !hasComposer ? 'Not applicable without composer.json' : presentPaths.has('vendor') ? 'Found vendor' : 'Dependencies are not installed',
			status: !hasComposer ? 'info' : presentPaths.has('vendor') ? 'ok' : 'warning'
		},
		{
			label: 'Environment file',
			description: hasEnv ? 'Found .env; contents were not read' : 'No .env file found; contents were not read',
			status: hasEnv ? 'ok' : 'info'
		}
	];
	return checks.map(check => ({ ...check, folderName }));
}

export function sanitizeToolVersion(output: string): string {
	const firstLine = output.split(/\r?\n/, 1)[0] ?? '';
	return firstLine.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
}
