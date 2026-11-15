/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * In-memory cookie jar for one Red Code session.
 *
 * Cookies are keyed by host name only: this is a request tool, not a browser, and a Laravel app on
 * `localhost:8000` is the same app when it is reached through another port. Nothing is persisted.
 */
export class CookieJar {
	private readonly byHost = new Map<string, Map<string, string>>();

	get size(): number {
		let total = 0;
		for (const cookies of this.byHost.values()) {
			total += cookies.size;
		}
		return total;
	}

	/** The `Cookie` header value for a URL, or `undefined` when this host has no cookies. */
	header(url: string): string | undefined {
		const host = hostOf(url);
		const cookies = host ? this.byHost.get(host) : undefined;
		if (!cookies || cookies.size === 0) {
			return undefined;
		}
		return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
	}

	get(url: string, name: string): string | undefined {
		const host = hostOf(url);
		return host ? this.byHost.get(host)?.get(name) : undefined;
	}

	store(url: string, setCookie: readonly string[] | string | undefined): void {
		const host = hostOf(url);
		if (!host || !setCookie) {
			return;
		}
		const values = typeof setCookie === 'string' ? [setCookie] : setCookie;
		for (const value of values) {
			this.storeOne(host, value);
		}
	}

	private storeOne(host: string, raw: string): void {
		const parts = raw.split(';').map(part => part.trim());
		const [pair, ...attributes] = parts;
		const separator = pair.indexOf('=');
		if (separator <= 0) {
			return;
		}
		const name = pair.slice(0, separator).trim();
		const value = pair.slice(separator + 1).trim();
		if (!name) {
			return;
		}

		let expired = false;
		for (const attribute of attributes) {
			const [key, attributeValue = ''] = attribute.split('=').map(part => part.trim());
			const lower = key.toLowerCase();
			if (lower === 'max-age' && Number(attributeValue) <= 0) {
				expired = true;
			} else if (lower === 'expires') {
				const time = Date.parse(attributeValue);
				if (!Number.isNaN(time) && time <= Date.now()) {
					expired = true;
				}
			}
		}

		const cookies = this.byHost.get(host) ?? new Map<string, string>();
		if (expired) {
			cookies.delete(name);
		} else {
			cookies.set(name, value);
		}
		if (cookies.size === 0) {
			this.byHost.delete(host);
		} else {
			this.byHost.set(host, cookies);
		}
	}

	clear(): void {
		this.byHost.clear();
	}
}

function hostOf(url: string): string | undefined {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

/** `XSRF-TOKEN` is URL-encoded by Laravel; the header needs the decoded token. */
export function decodeCookieValue(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
