/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LogEntry } from './index/logModel.js';

export const LOG_SCHEME = 'redcode-log';

/**
 * Serves a full log entry — header, message and stack trace — as a read-only
 * document, so a trace can be selected and copied without opening the raw log
 * file. Contents are published on demand and never persisted.
 */
export class LogDocumentProvider implements vscode.TextDocumentContentProvider {
	private readonly contents = new Map<string, string>();
	private revision = 0;

	publish(fileName: string, entry: LogEntry): vscode.Uri {
		const id = String(++this.revision);
		this.contents.set(id, entry.detail);

		const label = entry.timestamp ? `${fileName} · ${entry.timestamp} ${entry.level}` : `${fileName} · ${entry.level}`;
		return vscode.Uri.from({ scheme: LOG_SCHEME, path: `/${label}`, query: id });
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.query) ?? '';
	}

	dispose(): void {
		this.contents.clear();
	}
}
