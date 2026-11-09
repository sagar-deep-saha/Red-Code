import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(path.join(repoRoot, 'resources', 'red-code-icon.svg'), 'utf8');
const sizes = [16, 24, 32, 48, 64, 70, 128, 150, 192, 256, 512, 1024];
const browser = await chromium.launch({ headless: true });

try {
	const page = await browser.newPage();
	const rendered = await page.evaluate(async ({ svgSource, dimensions }) => {
		const image = new Image();
		image.src = URL.createObjectURL(new Blob([svgSource], { type: 'image/svg+xml' }));
		await image.decode();

		const result = {};
		for (const size of dimensions) {
			const canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			const context = canvas.getContext('2d');
			context.drawImage(image, 0, 0, size, size);
			result[size] = canvas.toDataURL('image/png').split(',')[1];
		}
		return result;
	}, { svgSource: svg, dimensions: sizes });

	const pngs = new Map(Object.entries(rendered).map(([size, base64]) => [Number(size), Buffer.from(base64, 'base64')]));
	const writePng = (destination, size) => writeFile(path.join(repoRoot, destination), pngs.get(size));

	await writePng('resources/linux/code.png', 512);
	await writePng('resources/win32/code_70x70.png', 70);
	await writePng('resources/win32/code_150x150.png', 150);
	await writePng('resources/server/code-192.png', 192);
	await writePng('resources/server/code-512.png', 512);

	const icoSizes = [16, 24, 32, 48, 64, 128, 256];
	const icoHeader = Buffer.alloc(6 + icoSizes.length * 16);
	icoHeader.writeUInt16LE(0, 0);
	icoHeader.writeUInt16LE(1, 2);
	icoHeader.writeUInt16LE(icoSizes.length, 4);
	let dataOffset = icoHeader.length;
	const icoFrames = [];
	for (const [index, size] of icoSizes.entries()) {
		const png = pngs.get(size);
		const entryOffset = 6 + index * 16;
		icoHeader.writeUInt8(size === 256 ? 0 : size, entryOffset);
		icoHeader.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
		icoHeader.writeUInt8(0, entryOffset + 2);
		icoHeader.writeUInt8(0, entryOffset + 3);
		icoHeader.writeUInt16LE(1, entryOffset + 4);
		icoHeader.writeUInt16LE(32, entryOffset + 6);
		icoHeader.writeUInt32LE(png.length, entryOffset + 8);
		icoHeader.writeUInt32LE(dataOffset, entryOffset + 12);
		dataOffset += png.length;
		icoFrames.push(png);
	}
	const ico = Buffer.concat([icoHeader, ...icoFrames]);
	await writeFile(path.join(repoRoot, 'resources/win32/code.ico'), ico);
	await writeFile(path.join(repoRoot, 'resources/server/favicon.ico'), ico);

	const icnsTypes = new Map([
		[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'],
		[256, 'ic08'], [512, 'ic09'], [1024, 'ic10']
	]);
	const icnsChunks = [];
	for (const [size, type] of icnsTypes) {
		const png = pngs.get(size);
		const chunkHeader = Buffer.alloc(8);
		chunkHeader.write(type, 0, 4, 'ascii');
		chunkHeader.writeUInt32BE(png.length + chunkHeader.length, 4);
		icnsChunks.push(chunkHeader, png);
	}
	const icnsBody = Buffer.concat(icnsChunks);
	const icnsHeader = Buffer.alloc(8);
	icnsHeader.write('icns', 0, 4, 'ascii');
	icnsHeader.writeUInt32BE(icnsBody.length + icnsHeader.length, 4);
	await writeFile(path.join(repoRoot, 'resources/darwin/code.icns'), Buffer.concat([icnsHeader, icnsBody]));
} finally {
	await browser.close();
}

console.log('Generated Red Code icon assets from resources/red-code-icon.svg.');
