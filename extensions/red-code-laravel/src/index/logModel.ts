/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `[2026-11-11 10:00:00] local.ERROR: message`. Microseconds are optional and
 * both the `T` and space date separators occur in Laravel logs.
 */
const HEADER = /^\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:\.\d+)?\]\s+([A-Za-z]+)\.([A-Z]+):\s?(.*)$/;

export const UNKNOWN_LEVEL = 'UNKNOWN';
export const MAX_MESSAGE_LENGTH = 200;

export interface LogEntry {
	readonly timestamp: string;
	readonly environment: string;
	readonly level: string;
	/** First line after the level, truncated to 200 characters. */
	readonly message: string;
	/** Full entry text: the header line plus any continuation and stack trace. */
	readonly detail: string;
	/** 0-based index in the parsed window. */
	readonly lineIndex: number;
}

export interface LogWindow {
	readonly entries: readonly LogEntry[];
	/** The final entry has no terminator yet and is re-read on the next pass. */
	readonly trailingPartial: boolean;
}

/**
 * Parses a log window. `sliced` says the text is a byte tail, so its first line
 * is a fragment and is dropped to start on an entry boundary.
 */
export function parseLogWindow(text: string, sliced = false): LogWindow {
	const body = sliced ? dropPartialFirstLine(text) : text;
	const lines = body.split(/\r?\n/);

	const raw: Array<{ header: RegExpExecArray; lines: string[] }> = [];
	const preamble: string[] = [];
	for (const line of lines) {
		const header = HEADER.exec(line);
		if (header) {
			raw.push({ header, lines: [] });
		} else if (raw.length > 0) {
			raw[raw.length - 1].lines.push(line);
		} else {
			preamble.push(line);
		}
	}

	const entries: LogEntry[] = [];
	// Text before the first header is never dropped, but blank filler is not an
	// entry on its own.
	if (preamble.some(line => line.trim().length > 0)) {
		entries.push(unknownEntry(preamble, 0));
	}
	for (const item of raw) {
		const detail = [item.header[0], ...trimTrailingBlanks(item.lines)];
		entries.push({
			timestamp: item.header[1],
			environment: item.header[2],
			level: item.header[3],
			message: item.header[4].slice(0, MAX_MESSAGE_LENGTH),
			detail: detail.join('\n').replace(/\s+$/, ''),
			lineIndex: entries.length
		});
	}

	return {
		entries,
		trailingPartial: body.length > 0 && !body.endsWith('\n')
	};
}

function dropPartialFirstLine(text: string): string {
	const index = text.indexOf('\n');
	return index >= 0 ? text.slice(index + 1) : '';
}

function trimTrailingBlanks(lines: readonly string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1].trim() === '') {
		end--;
	}
	return lines.slice(0, end);
}

function unknownEntry(lines: readonly string[], lineIndex: number): LogEntry {
	const detail = trimTrailingBlanks(lines).join('\n').replace(/\s+$/, '');
	const first = lines.find(line => line.trim().length > 0) ?? '';
	return {
		timestamp: '',
		environment: '',
		level: UNKNOWN_LEVEL,
		message: first.trim().slice(0, MAX_MESSAGE_LENGTH),
		detail,
		lineIndex
	};
}
