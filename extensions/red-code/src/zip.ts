/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deflateRawSync } from 'node:zlib';

export interface ZipEntry {
	/** Path inside the archive, using `/`. */
	readonly path: string;
	readonly data: Buffer;
	readonly modified?: Date;
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
	// ZIP stores local time in two 16-bit MS-DOS fields; years start at 1980.
	const year = Math.min(2107, Math.max(1980, date.getFullYear()));
	return {
		time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f),
		date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
	};
}

function normalizeEntryPath(value: string): string {
	const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
	if (!normalized || normalized.includes('\0')) {
		throw new Error('ZIP entry paths must not be empty.');
	}
	if (/^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
		throw new Error(`ZIP entry path must stay inside the archive: ${value}`);
	}
	return normalized;
}

/**
 * Minimal ZIP writer (deflate, UTF-8 names, no ZIP64). A deployment archive is
 * a few thousand files at most, so a dependency-free writer is simpler than
 * shelling out to PowerShell or adding an npm package just for this.
 */
export function createZip(entries: readonly ZipEntry[]): Buffer {
	const seen = new Set<string>();
	const local: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = normalizeEntryPath(entry.path);
		if (seen.has(name)) {
			throw new Error(`Duplicate ZIP entry: ${name}`);
		}
		seen.add(name);

		const nameBuffer = Buffer.from(name, 'utf8');
		const deflated = deflateRawSync(entry.data, { level: 9 });
		const useDeflate = deflated.length < entry.data.length;
		const payload = useDeflate ? deflated : entry.data;
		const method = useDeflate ? 8 : 0;
		const stamp = dosDateTime(entry.modified ?? new Date());
		const checksum = crc32(entry.data);

		const header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50, 0);
		header.writeUInt16LE(20, 4); // version needed
		header.writeUInt16LE(0x0800, 6); // UTF-8 names
		header.writeUInt16LE(method, 8);
		header.writeUInt16LE(stamp.time, 10);
		header.writeUInt16LE(stamp.date, 12);
		header.writeUInt32LE(checksum, 14);
		header.writeUInt32LE(payload.length, 18);
		header.writeUInt32LE(entry.data.length, 22);
		header.writeUInt16LE(nameBuffer.length, 26);
		header.writeUInt16LE(0, 28);

		local.push(header, nameBuffer, payload);

		const directory = Buffer.alloc(46);
		directory.writeUInt32LE(0x02014b50, 0);
		directory.writeUInt16LE(0x0314, 4); // made by: UNIX, version 2.0
		directory.writeUInt16LE(20, 6); // version needed
		directory.writeUInt16LE(0x0800, 8); // UTF-8 names
		directory.writeUInt16LE(method, 10);
		directory.writeUInt16LE(stamp.time, 12);
		directory.writeUInt16LE(stamp.date, 14);
		directory.writeUInt32LE(checksum, 16);
		directory.writeUInt32LE(payload.length, 20);
		directory.writeUInt32LE(entry.data.length, 24);
		directory.writeUInt16LE(nameBuffer.length, 28);
		directory.writeUInt16LE(0, 30); // extra
		directory.writeUInt16LE(0, 32); // comment
		directory.writeUInt16LE(0, 34); // disk
		directory.writeUInt16LE(0, 36); // internal attributes
		directory.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes: -rw-r--r--
		directory.writeUInt32LE(offset, 42);

		central.push(directory, nameBuffer);
		offset += header.length + nameBuffer.length + payload.length;
	}

	const centralSize = central.reduce((total, buffer) => total + buffer.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(0, 4); // disk
	end.writeUInt16LE(0, 6); // central directory disk
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20); // comment length

	return Buffer.concat([...local, ...central, end]);
}
