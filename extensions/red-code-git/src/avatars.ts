/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

/** Creates a Gravatar URL only when the user has explicitly enabled remote avatar lookup. */
export function gravatarUrl(email: string, enabled: boolean): string | undefined {
	if (!enabled) {
		return undefined;
	}

	const normalized = email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
		return undefined;
	}

	const hash = createHash('md5').update(normalized).digest('hex');
	return `https://www.gravatar.com/avatar/${hash}?d=404&s=64`;
}
