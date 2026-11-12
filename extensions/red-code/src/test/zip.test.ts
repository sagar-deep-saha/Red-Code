/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { createZip } from '../zip.js';

interface ReadEntry {
	readonly path: string;
	readonly method: number;
	readonly crc: number;
	readonly compressedSize: number;
	readonly size: number;
	readonly data: Buffer;
}

function readZip(archive: Buffer): ReadEntry[] {
	const endOffset = archive.length - 22;
	assert.equal(archive.readUInt32LE(endOffset), 0x06054b50, 'end of central directory signature');
	const count = archive.readUInt16LE(endOffset + 10);
	const centralOffset = archive.readUInt32LE(endOffset + 16);

	const entries: ReadEntry[] = [];
	let cursor = centralOffset;
	for (let index = 0; index < count; index++) {
		assert.equal(archive.readUInt32LE(cursor), 0x02014b50, 'central directory signature');
		const method = archive.readUInt16LE(cursor + 10);
		const crc = archive.readUInt32LE(cursor + 16);
		const compressedSize = archive.readUInt32LE(cursor + 20);
		const size = archive.readUInt32LE(cursor + 24);
		const nameLength = archive.readUInt16LE(cursor + 28);
		const extraLength = archive.readUInt16LE(cursor + 30);
		const commentLength = archive.readUInt16LE(cursor + 32);
		const localOffset = archive.readUInt32LE(cursor + 42);
		const path = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

		assert.equal(archive.readUInt32LE(localOffset), 0x04034b50, 'local header signature');
		const localNameLength = archive.readUInt16LE(localOffset + 26);
		const localExtraLength = archive.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		const payload = archive.subarray(dataStart, dataStart + compressedSize);
		const data = method === 8 ? inflateRawSync(payload) : Buffer.from(payload);

		entries.push({ path, method, crc, compressedSize, size, data });
		cursor += 46 + nameLength + extraLength + commentLength;
	}

	assert.equal(cursor, endOffset - 0, 'central directory ends where the end record starts');
	return entries;
}

test('an archive round-trips text, binary and unicode paths', () => {
	const text = Buffer.from(`<?php\n${'// a repeated comment line\n'.repeat(200)}`, 'utf8');
	const binary = randomBytes(4096); // incompressible: forces the store method
	const archive = createZip([
		{ path: 'app/Models/Post.php', data: text, modified: new Date('2026-11-12T10:00:00Z') },
		{ path: 'public/images/ünïcode.png', data: binary, modified: new Date('2026-11-12T10:00:00Z') }
	]);

	assert.equal(archive.readUInt32LE(0), 0x04034b50);

	const entries = readZip(archive);
	assert.deepEqual(entries.map(entry => entry.path), ['app/Models/Post.php', 'public/images/ünïcode.png']);
	assert.deepEqual(entries[0].data, text);
	assert.deepEqual(entries[1].data, binary);
	assert.equal(entries[0].method, 8, 'text is deflated');
	assert.equal(entries[1].method, 0, 'random bytes are stored');
	assert.equal(entries[0].size, text.length);
	assert.equal(entries[1].size, binary.length);
});

test('an empty archive is still a valid zip', () => {
	const archive = createZip([]);
	assert.equal(archive.length, 22);
	assert.equal(readZip(archive).length, 0);
});

test('paths that would escape the archive are refused', () => {
	assert.throws(() => createZip([{ path: 'C:/Windows/System32/drivers/etc/hosts', data: Buffer.from('x') }]), /inside the archive/);
	assert.throws(() => createZip([{ path: '../secrets.php', data: Buffer.from('x') }]), /inside the archive/);
	assert.throws(() => createZip([{ path: 'a/../../b', data: Buffer.from('x') }]), /inside the archive/);
	assert.throws(() => createZip([{ path: '', data: Buffer.from('x') }]), /must not be empty/);
});

test('duplicate entries are refused instead of silently overwriting', () => {
	assert.throws(() => createZip([
		{ path: 'a.php', data: Buffer.from('1') },
		{ path: 'a.php', data: Buffer.from('2') }
	]), /Duplicate ZIP entry/);

	// Backslashes are normalised, so these are the same entry too.
	assert.throws(() => createZip([
		{ path: 'a/b.php', data: Buffer.from('1') },
		{ path: 'a\\b.php', data: Buffer.from('2') }
	]), /Duplicate ZIP entry/);
});
