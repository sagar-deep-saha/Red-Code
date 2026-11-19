/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import * as vscode from 'vscode';
import { fileAtRevision } from './git.js';

/** Read-only documents served from `git show <rev>:<path>` so diffs open in a real editor. */
export const GIT_SCHEME = 'redcode-git';
/** Sentinel revision that renders an empty document (used for a root commit's parent). */
export const EMPTY_REVISION = 'EMPTY';

interface RevisionDocument {
	root: string;
	revision: string;
	file: string;
}

export function revisionUri(root: string, revision: string, file: string): vscode.Uri {
	const normalized = file.replace(/\\/g, '/').replace(/^\/+/, '');
	return vscode.Uri.from({
		scheme: GIT_SCHEME,
		path: `/${revision}/${normalized}`,
		query: encodeURIComponent(root)
	});
}

function parse(uri: vscode.Uri): RevisionDocument | undefined {
	const parts = uri.path.split('/').filter(part => part.length > 0);
	if (parts.length < 2 || !uri.query) {
		return undefined;
	}
	const [revision, ...rest] = parts;
	return {
		root: decodeURIComponent(uri.query),
		revision,
		file: rest.join('/')
	};
}

export class GitContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
	static readonly scheme = GIT_SCHEME;

	private readonly cache = new Map<string, string>();
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.changeEmitter.event;

	dispose(): void {
		this.changeEmitter.dispose();
		this.cache.clear();
	}

	/** Drops every cached blob, so a refresh shows the new contents. */
	clear(): void {
		this.cache.clear();
	}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const document = parse(uri);
		if (!document) {
			return '';
		}
		if (document.revision === EMPTY_REVISION) {
			return '';
		}

		const key = `${document.root}\0${document.revision}\0${document.file}`;
		const cached = this.cache.get(key);
		if (cached !== undefined) {
			return cached;
		}

		try {
			const text = await fileAtRevision(document.root, document.revision, document.file);
			if (this.cache.size > 200) {
				this.cache.clear();
			}
			this.cache.set(key, text);
			return text;
		} catch {
			return '';
		}
	}
}

/** Opens `file` as it was in `revision`, read-only. */
export async function showFileAtRevision(root: string, revision: string, file: string, label: string): Promise<void> {
	const uri = revisionUri(root, revision, file);
	await vscode.window.showTextDocument(uri, {
		preview: true,
		viewColumn: vscode.ViewColumn.Active
	});
	void label;
}

/** Opens a diff editor between two revisions of one file. */
export async function showFileChanges(
	root: string,
	file: string,
	leftRevision: string,
	rightRevision: string,
	title: string
): Promise<void> {
	await vscode.commands.executeCommand(
		'vscode.diff',
		revisionUri(root, leftRevision, file),
		revisionUri(root, rightRevision, file),
		title,
		{ preview: true }
	);
}

/** Opens a multi-diff of every file between two revisions. */
export async function showAllChanges(
	root: string,
	leftRevision: string,
	rightRevision: string,
	title: string,
	files: readonly string[]
): Promise<void> {
	const resources = files.map(file => [
		revisionUri(root, leftRevision, file),
		revisionUri(root, rightRevision, file)
	]);
	if (resources.length === 0) {
		return;
	}
	await vscode.commands.executeCommand('vscode.changes', title, resources);
}

/** Diffs one committed file against the working tree. */
export async function showFileChangesWithWorking(root: string, file: string, revision: string, title: string): Promise<void> {
	await vscode.commands.executeCommand(
		'vscode.diff',
		revisionUri(root, revision, file),
		vscode.Uri.file(path.join(root, file)),
		title,
		{ preview: true }
	);
}

/** Diffs every file of a commit against the working tree. */
export async function showAllChangesWithWorking(
	root: string,
	revision: string,
	title: string,
	files: readonly string[]
): Promise<void> {
	const resources = files.map(file => [
		revisionUri(root, revision, file),
		vscode.Uri.file(path.join(root, file))
	]);
	if (resources.length === 0) {
		return;
	}
	await vscode.commands.executeCommand('vscode.changes', title, resources);
}

/** Diffs the whole working tree against HEAD; untracked files start from an empty document. */
export async function showWorkingTreeChanges(
	root: string,
	title: string,
	files: readonly { path: string; untracked: boolean }[]
): Promise<void> {
	const resources = files.map(file => [
		revisionUri(root, file.untracked ? EMPTY_REVISION : 'HEAD', file.path),
		vscode.Uri.file(path.join(root, file.path))
	]);
	if (resources.length === 0) {
		return;
	}
	await vscode.commands.executeCommand('vscode.changes', title, resources);
}
