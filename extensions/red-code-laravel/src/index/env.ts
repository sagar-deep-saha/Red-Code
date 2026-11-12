/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const SECRET_SUFFIX = /(?:^|_)(?:KEY|SECRET|PASSWORD|PASS|TOKEN|CREDENTIALS?)$/i;

/**
 * A key is secret if it *ends* with a credential word: `APP_KEY`,
 * `DB_PASSWORD`, `AWS_SECRET_ACCESS_KEY`, `STRIPE_SECRET`, `API_TOKEN`.
 * Non-credential settings such as `PASSWORD_HASH_ROUNDS` are not redacted.
 */
export function isSecretKey(key: string): boolean {
	return SECRET_SUFFIX.test(key);
}

/**
 * Reads one value from a dotenv file. Quoted values keep their inner content;
 * comments and `export` prefixes are handled. Returns `undefined` when the key
 * is not present, so callers can distinguish "missing" from "empty".
 */
export function parseEnvValue(text: string, key: string): string | undefined {
	const lines = text.split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}
		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (!match || match[1] !== key) {
			continue;
		}

		let value = match[2].trim();
		const quoted = /^(['"])(.*)\1$/.exec(value);
		if (quoted) {
			value = quoted[2];
		} else {
			const comment = value.indexOf(' #');
			if (comment >= 0) {
				value = value.slice(0, comment).trim();
			}
		}
		return value;
	}

	return undefined;
}

/**
 * Normalizes an application URL for browser and cURL use. `localhost` is the
 * value Laravel reports from `about`, so a missing scheme gets `http://`.
 * Without any configured URL, `artisan serve`'s default is used.
 */
export function normalizeBaseUrl(value: string | undefined): string {
	const trimmed = (value ?? '').trim();
	if (!trimmed) {
		return 'http://localhost:8000';
	}
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
	return withScheme.replace(/\/+$/, '');
}
