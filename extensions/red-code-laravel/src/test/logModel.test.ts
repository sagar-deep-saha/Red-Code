/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	filterByLevel,
	MAX_MESSAGE_LENGTH,
	parseLogPattern,
	parseLogWindow,
	pickNewestLog,
	UNKNOWN_LEVEL
} from '../index/logModel.js';

const logText = [
	'PHP Fatal error: bootstrap failed',
	'[2026-11-11 10:00:00] local.ERROR: Something broke',
	'#0 /app/x.php(10): boom()',
	'#1 {main}',
	'',
	'[2026-11-11T10:00:01.123456] local.WARNING: Careful',
	'[2026-11-11 10:00:02] production.INFO: Started'
].join('\n');

const parsed = parseLogWindow(logText);

test('a header and its continuation lines form one entry', () => {
	assert.equal(parsed.entries.length, 4);

	const [, error, warning, info] = parsed.entries;
	assert.equal(error.timestamp, '2026-11-11 10:00:00');
	assert.equal(error.environment, 'local');
	assert.equal(error.level, 'ERROR');
	assert.equal(error.message, 'Something broke');
	assert.equal(error.lineIndex, 1);
	assert.match(error.detail, /#0 \/app\/x\.php\(10\): boom\(\)/);
	assert.match(error.detail, /#1 \{main\}/);
	assert.ok(!error.detail.endsWith('\n'), 'trailing blank continuation is trimmed');

	assert.equal(warning.timestamp, '2026-11-11T10:00:01');
	assert.equal(warning.level, 'WARNING');
	assert.equal(info.environment, 'production');
	assert.equal(info.level, 'INFO');
});

test('text before the first header is kept as a single unknown entry', () => {
	assert.equal(parsed.entries[0].level, UNKNOWN_LEVEL);
	assert.equal(parsed.entries[0].message, 'PHP Fatal error: bootstrap failed');
	assert.equal(parsed.entries[0].lineIndex, 0);
});

test('a document with no terminator is flagged as trailing partial', () => {
	assert.equal(parsed.trailingPartial, true);
	assert.equal(parseLogWindow(`${logText}\n`).trailingPartial, false);
});

test('a blank-only window produces no entries', () => {
	assert.deepEqual(parseLogWindow('\n\n').entries, []);
});

test('a sliced window drops the first fragment and starts on an entry boundary', () => {
	const window = parseLogWindow('garbage fragment without a header\n[2026-11-11 10:00:00] local.ERROR: x\n', true);
	assert.equal(window.entries.length, 1);
	assert.equal(window.entries[0].level, 'ERROR');
	assert.equal(window.trailingPartial, false);
});

test('long messages are truncated but the detail keeps the full text', () => {
	const long = 'x'.repeat(300);
	const { entries } = parseLogWindow(`[2026-11-11 10:00:00] local.ERROR: ${long}\n`);
	assert.equal(entries[0].message.length, MAX_MESSAGE_LENGTH);
	assert.ok(entries[0].detail.endsWith(long));
});

test('levels filter keeps only the selected entries', () => {
	assert.deepEqual(filterByLevel(parsed.entries, new Set(['ERROR'])).map(entry => entry.level), ['ERROR']);
	assert.deepEqual(
		filterByLevel(parsed.entries, new Set([UNKNOWN_LEVEL, 'INFO'])).map(entry => entry.level),
		[UNKNOWN_LEVEL, 'INFO']
	);
	assert.deepEqual(filterByLevel(parsed.entries, new Set()), []);
});

test('a glob pattern splits into a directory and a suffix', () => {
	assert.deepEqual(parseLogPattern('storage/logs/*.log'), { directory: 'storage/logs', match: '.log', exact: false });
	assert.deepEqual(parseLogPattern('storage\\logs\\*.log'), { directory: 'storage/logs', match: '.log', exact: false });
	assert.deepEqual(parseLogPattern('storage/logs/*'), { directory: 'storage/logs', match: '', exact: false });
	assert.deepEqual(parseLogPattern('storage/logs/laravel.log'), { directory: 'storage/logs', match: 'laravel.log', exact: true });
});

test('the newest log file is selected by modification time', () => {
	assert.equal(pickNewestLog([]), undefined);
	assert.deepEqual(
		pickNewestLog([
			{ path: 'storage/logs/laravel.log', mtime: 10 },
			{ path: 'storage/logs/laravel-2026-11-11.log', mtime: 20 }
		]),
		{ path: 'storage/logs/laravel-2026-11-11.log', mtime: 20 }
	);
});
