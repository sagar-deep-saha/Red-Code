/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ParsedVersion {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
	readonly prerelease: string | undefined;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parses the `major.minor.patch[-prerelease]` versions used by the editor and
 * by release tags. Build metadata (`+sha`) is ignored, because two builds that
 * differ only by commit are the same release for update purposes.
 */
export function parseVersion(value: string): ParsedVersion | undefined {
	const match = VERSION_PATTERN.exec(value.trim());
	if (!match) {
		return undefined;
	}
	const major = Number.parseInt(match[1], 10);
	const minor = Number.parseInt(match[2], 10);
	const patch = Number.parseInt(match[3], 10);
	if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
		return undefined;
	}
	return { major, minor, patch, prerelease: match[4] };
}

/**
 * Semver ordering. A release sorts above its own pre-releases, so
 * `1.147.1` is newer than `1.147.1-beta.2`, and numeric identifiers sort below
 * alphanumeric ones (`beta.2` < `beta.10` < `beta.rc`).
 */
export function compareVersions(left: string, right: string): number {
	const a = parseVersion(left);
	const b = parseVersion(right);
	if (!a || !b) {
		return left.localeCompare(right);
	}

	for (const key of ['major', 'minor', 'patch'] as const) {
		if (a[key] !== b[key]) {
			return a[key] < b[key] ? -1 : 1;
		}
	}

	if (a.prerelease === b.prerelease) {
		return 0;
	}
	if (!a.prerelease) {
		return 1;
	}
	if (!b.prerelease) {
		return -1;
	}
	return comparePrerelease(a.prerelease, b.prerelease);
}

function comparePrerelease(left: string, right: string): number {
	const a = left.split('.');
	const b = right.split('.');
	const length = Math.max(a.length, b.length);

	for (let index = 0; index < length; index++) {
		const x = a[index];
		const y = b[index];
		if (x === y) {
			continue;
		}
		if (x === undefined) {
			return -1;
		}
		if (y === undefined) {
			return 1;
		}

		const xNumeric = /^\d+$/.test(x);
		const yNumeric = /^\d+$/.test(y);
		if (xNumeric && yNumeric) {
			return Number.parseInt(x, 10) < Number.parseInt(y, 10) ? -1 : 1;
		}
		if (xNumeric !== yNumeric) {
			return xNumeric ? -1 : 1;
		}
		return x < y ? -1 : 1;
	}

	return 0;
}

export function isNewer(candidate: string, current: string): boolean {
	return compareVersions(candidate, current) > 0;
}
