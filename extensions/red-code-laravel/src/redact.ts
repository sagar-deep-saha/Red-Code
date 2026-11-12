/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const SECRET_ASSIGNMENT = /\b([A-Z0-9_]*(?:KEY|SECRET|PASSWORD|PASS|TOKEN)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi;

/**
 * Removes secret values from text before it reaches the Output channel.
 * Only values assigned to secret-looking names are touched; the names are kept
 * so the log still explains which variable was handled.
 */
export function redactSecrets(text: string): string {
	return text.replace(SECRET_ASSIGNMENT, '$1=***');
}
