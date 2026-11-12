/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SourceLocation } from './index/graph.js';

export const OPEN_LOCATION_COMMAND = 'redCode.laravel.openLocation';

function fileUri(root: vscode.Uri, file: string): vscode.Uri {
	return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(file) ? vscode.Uri.file(file) : vscode.Uri.joinPath(root, file);
}

/**
 * Document links cannot point at a line, so they target this command instead.
 * Arguments are passed as a JSON array, which is the documented command-URI form.
 */
export function locationCommandUri(location: SourceLocation, root: vscode.Uri): vscode.Uri {
	const uri = fileUri(root, location.file).toString();
	return vscode.Uri.parse(`command:${OPEN_LOCATION_COMMAND}?${encodeURIComponent(JSON.stringify([uri, location.line, 1]))}`);
}

export async function openLocation(location: SourceLocation, root: vscode.Uri): Promise<void> {
	await openUriAt(fileUri(root, location.file), location.line, 1);
}

export async function openUriAt(uri: vscode.Uri, line: number, column = 1): Promise<void> {
	const document = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(document, { preview: true });
	const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, column - 1));
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export function registerLocationCommand(): vscode.Disposable {
	return vscode.commands.registerCommand(OPEN_LOCATION_COMMAND, async (uri: string, line = 1, column = 1) => {
		await openUriAt(vscode.Uri.parse(uri), line, column);
	});
}
