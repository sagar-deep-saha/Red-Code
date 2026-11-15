/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import * as vscode from 'vscode';
import { BlameLine, parseBlamePorcelain } from './blame.js';
import { blamePorcelain, GitError, repositoryRoot } from './git.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 20000;
const DEBOUNCE_MS = 300;

/** Inline `author, when · sha` after each line of the active file. */
export class BlameDecorations implements vscode.Disposable {
	private readonly decorationType = vscode.window.createTextEditorDecorationType({
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
	});
	private readonly disposables: vscode.Disposable[] = [];
	private timer: NodeJS.Timeout | undefined;
	private generation = 0;
	private enabled = false;

	constructor() {
		this.disposables.push(
			vscode.window.onDidChangeActiveTextEditor(editor => this.schedule(editor)),
			vscode.workspace.onDidChangeTextDocument(event => {
				if (event.document === vscode.window.activeTextEditor?.document) {
					this.schedule(vscode.window.activeTextEditor);
				}
			}),
			vscode.workspace.onDidSaveTextDocument(document => {
				if (document === vscode.window.activeTextEditor?.document) {
					this.schedule(vscode.window.activeTextEditor);
				}
			}),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration('redCode.git.blame.enabled')) {
					this.setEnabled(vscode.workspace.getConfiguration('redCode.git').get<boolean>('blame.enabled', false));
				}
			})
		);
	}

	dispose(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		this.generation++;
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.decorationType.dispose();
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		this.generation++;
		if (!enabled) {
			for (const editor of vscode.window.visibleTextEditors) {
				editor.setDecorations(this.decorationType, []);
			}
			return;
		}
		this.schedule(vscode.window.activeTextEditor);
	}

	private schedule(editor: vscode.TextEditor | undefined): void {
		if (!this.enabled) {
			return;
		}
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.apply(editor);
		}, DEBOUNCE_MS);
	}

	private async apply(editor: vscode.TextEditor | undefined): Promise<void> {
		const token = ++this.generation;
		if (!editor || !this.enabled) {
			return;
		}

		const document = editor.document;
		if (document.uri.scheme !== 'file'
			|| document.isDirty
			|| document.lineCount > MAX_LINES
			|| document.getText().length > MAX_BYTES) {
			editor.setDecorations(this.decorationType, []);
			return;
		}

		const root = await repositoryRoot(path.dirname(document.uri.fsPath));
		if (!root || token !== this.generation) {
			if (token === this.generation) {
				editor.setDecorations(this.decorationType, []);
			}
			return;
		}

		const relative = path.relative(root, document.uri.fsPath).split(path.sep).join('/');
		let blame: Map<number, BlameLine>;
		try {
			blame = parseBlamePorcelain(await blamePorcelain(root, relative));
		} catch (error) {
			if (token === this.generation) {
				editor.setDecorations(this.decorationType, []);
			}
			if (!(error instanceof GitError)) {
				throw error;
			}
			return;
		}

		if (token !== this.generation) {
			return;
		}

		const decorations: vscode.DecorationOptions[] = [];
		for (let line = 0; line < document.lineCount; line++) {
			const entry = blame.get(line + 1);
			if (!entry) {
				continue;
			}
			decorations.push({
				range: new vscode.Range(line, 0, line, 0),
				hoverMessage: new vscode.MarkdownString(
					`**${entry.summary || '(no summary)'}**\n\n\`${entry.short}\` · ${entry.author} · ${formatWhen(entry.authorTime)}`
				),
				renderOptions: {
					after: {
						contentText: `${truncate(entry.author, 24)}, ${formatWhen(entry.authorTime)} · ${entry.short}`,
						color: new vscode.ThemeColor('editorCodeLens.foreground'),
						margin: '0 0 0 2em'
					}
				}
			});
		}
		editor.setDecorations(this.decorationType, decorations);
	}
}

function truncate(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/** Short, stable relative time so the decoration does not need a refresh timer. */
export function formatWhen(iso: string): string {
	const time = Date.parse(iso);
	if (Number.isNaN(time)) {
		return '';
	}
	const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
	if (seconds < 60) {
		return 'just now';
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	const days = Math.round(hours / 24);
	if (days < 30) {
		return `${days}d ago`;
	}
	const months = Math.round(days / 30);
	if (months < 12) {
		return `${months}mo ago`;
	}
	return `${Math.round(months / 12)}y ago`;
}
