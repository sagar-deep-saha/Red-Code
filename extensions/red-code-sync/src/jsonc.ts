/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Removes `//` and block comments without touching string contents. VS Code
 * allows comments in settings.json, so syncing it needs the same tolerance
 * without pulling in a full JSON5 dependency.
 */
export function stripJsonComments(text: string): string {
	let result = '';
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;
	let escaped = false;

	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		const next = text[index + 1];

		if (inLineComment) {
			if (character === '\n') {
				inLineComment = false;
				result += character;
			}
			continue;
		}

		if (inBlockComment) {
			if (character === '*' && next === '/') {
				inBlockComment = false;
				index++;
			}
			continue;
		}

		if (inString) {
			result += character;
			if (escaped) {
				escaped = false;
			} else if (character === '\\') {
				escaped = true;
			} else if (character === '"') {
				inString = false;
			}
			continue;
		}

		if (character === '"') {
			inString = true;
			result += character;
			continue;
		}

		if (character === '/' && next === '/') {
			inLineComment = true;
			index++;
			continue;
		}

		if (character === '/' && next === '*') {
			inBlockComment = true;
			index++;
			continue;
		}

		result += character;
	}

	return result;
}

/** Drops trailing commas, which `JSON.parse` rejects but VS Code accepts. */
export function removeTrailingCommas(text: string): string {
	let result = '';
	let inString = false;
	let escaped = false;

	for (let index = 0; index < text.length; index++) {
		const character = text[index];

		if (inString) {
			result += character;
			if (escaped) {
				escaped = false;
			} else if (character === '\\') {
				escaped = true;
			} else if (character === '"') {
				inString = false;
			}
			continue;
		}

		if (character === '"') {
			inString = true;
			result += character;
			continue;
		}

		if (character === ',') {
			let lookahead = index + 1;
			while (lookahead < text.length && /\s/.test(text[lookahead])) {
				lookahead++;
			}
			if (text[lookahead] === '}' || text[lookahead] === ']') {
				continue;
			}
		}

		result += character;
	}

	return result;
}

export function parseJsonc(text: string): unknown {
	try {
		const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
		return JSON.parse(removeTrailingCommas(stripJsonComments(withoutBom)));
	} catch {
		return undefined;
	}
}
