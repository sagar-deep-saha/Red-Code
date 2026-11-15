import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Inno Setup draws the wizard artwork from 24-bit BMPs, one per DPI scale.
// These replace the stock blue "document" images with the Red Code glyph on
// the same white background, so the installer matches the product icon.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(path.join(repoRoot, 'resources', 'red-code-icon.svg'), 'utf8');

/** name suffix -> [width, height], matching build/win32/code.iss */
const small = [
	['100', 55, 55],
	['125', 64, 68],
	['150', 83, 80],
	['175', 92, 97],
	['200', 110, 106],
	['225', 119, 123],
	['250', 138, 140]
];

const big = [
	['100', 164, 314],
	['125', 192, 386],
	['150', 246, 459],
	['175', 273, 556],
	['200', 328, 604],
	['225', 355, 700],
	['250', 410, 797]
];

function toBmp24(width, height, rgba) {
	const rowSize = Math.ceil((width * 3) / 4) * 4;
	const pixelBytes = rowSize * height;
	const fileHeader = Buffer.alloc(14);
	fileHeader.write('BM', 0, 2, 'ascii');
	fileHeader.writeUInt32LE(14 + 40 + pixelBytes, 2);
	fileHeader.writeUInt32LE(14 + 40, 10);

	const dibHeader = Buffer.alloc(40);
	dibHeader.writeUInt32LE(40, 0);
	dibHeader.writeInt32LE(width, 4);
	dibHeader.writeInt32LE(height, 8);
	dibHeader.writeUInt16LE(1, 12);
	dibHeader.writeUInt16LE(24, 14);
	dibHeader.writeUInt32LE(0, 16);
	dibHeader.writeUInt32LE(pixelBytes, 20);
	dibHeader.writeInt32LE(2835, 24);
	dibHeader.writeInt32LE(2835, 28);

	const pixels = Buffer.alloc(pixelBytes, 0xff);
	for (let y = 0; y < height; y++) {
		const sourceRow = (height - 1 - y) * width * 4;
		const targetRow = y * rowSize;
		for (let x = 0; x < width; x++) {
			const source = sourceRow + x * 4;
			const target = targetRow + x * 3;
			pixels[target] = rgba[source + 2];
			pixels[target + 1] = rgba[source + 1];
			pixels[target + 2] = rgba[source];
		}
	}

	return Buffer.concat([fileHeader, dibHeader, pixels]);
}

const browser = await chromium.launch({ headless: true });

try {
	const page = await browser.newPage();
	const jobs = [
		...small.map(([suffix, width, height]) => ({ name: `inno-small-${suffix}.bmp`, width, height, scale: 0.74 })),
		...big.map(([suffix, width, height]) => ({ name: `inno-big-${suffix}.bmp`, width, height, scale: 0.44 }))
	];

	const renders = await page.evaluate(async ({ svgSource, jobs }) => {
		const image = new Image();
		image.src = URL.createObjectURL(new Blob([svgSource], { type: 'image/svg+xml' }));
		await image.decode();

		const result = {};
		for (const job of jobs) {
			const canvas = document.createElement('canvas');
			canvas.width = job.width;
			canvas.height = job.height;
			const context = canvas.getContext('2d');
			context.fillStyle = '#ffffff';
			context.fillRect(0, 0, job.width, job.height);

			const glyph = Math.round(Math.min(job.width, job.height) * job.scale);
			const x = Math.round((job.width - glyph) / 2);
			const y = Math.round((job.height - glyph) / 2);
			context.drawImage(image, x, y, glyph, glyph);

			const data = context.getImageData(0, 0, job.width, job.height).data;
			result[job.name] = Array.from(data);
		}
		return result;
	}, { svgSource: svg, jobs });

	for (const job of jobs) {
		const bytes = toBmp24(job.width, job.height, Uint8Array.from(renders[job.name]));
		await writeFile(path.join(repoRoot, 'resources', 'win32', job.name), bytes);
	}
} finally {
	await browser.close();
}

console.log('Generated Red Code installer wizard images from resources/red-code-icon.svg.');
