/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IncomingMessage, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { CookieJar } from './cookies.js';
import { ResolvedRequest } from './model.js';

/** Responses larger than this are cut off; the panel says so instead of freezing the editor. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

const MAX_REDIRECTS = 5;

export interface ApiResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: Buffer;
	url: string;
	durationMs: number;
	truncated: boolean;
}

export interface SendOptions {
	timeoutMs: number;
	verifyTls: boolean;
	followRedirects: boolean;
	cookieJar: CookieJar;
}

export async function sendRequest(request: ResolvedRequest, options: SendOptions, redirects = 0): Promise<ApiResponse> {
	const started = Date.now();
	const response = await performRequest(request, options);

	const location = response.headers.location;
	if (options.followRedirects && location && isRedirect(response.status) && redirects < MAX_REDIRECTS) {
		const nextUrl = new URL(location, request.url).toString();
		const switchToGet = response.status === 303
			|| (response.status <= 302 && request.method === 'POST');
		const next: ResolvedRequest = switchToGet
			? { method: 'GET', url: nextUrl, headers: withoutBodyHeaders(request.headers) }
			: { method: request.method, url: nextUrl, headers: request.headers, body: request.body };
		return sendRequest(next, options, redirects + 1);
	}

	return { ...response, url: request.url, durationMs: Date.now() - started };
}

function isRedirect(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function withoutBodyHeaders(headers: Record<string, string>): Record<string, string> {
	const copy = { ...headers };
	for (const name of Object.keys(copy)) {
		const lower = name.toLowerCase();
		if (lower === 'content-type' || lower === 'content-length') {
			delete copy[name];
		}
	}
	return copy;
}

function performRequest(request: ResolvedRequest, options: SendOptions): Promise<Omit<ApiResponse, 'url' | 'durationMs'>> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error: Error | undefined, value?: Omit<ApiResponse, 'url' | 'durationMs'>) => {
			if (settled) {
				return;
			}
			settled = true;
			if (error) {
				reject(error);
			} else {
				resolve(value!);
			}
		};

		let url: URL;
		try {
			url = new URL(request.url);
		} catch {
			finish(new Error(`Not a valid URL: ${request.url}`));
			return;
		}

		const headers: Record<string, string> = { ...request.headers };
		const cookie = options.cookieJar.header(request.url);
		if (cookie && !Object.keys(headers).some(name => name.toLowerCase() === 'cookie')) {
			headers.Cookie = cookie;
		}
		if (request.body && !Object.keys(headers).some(name => name.toLowerCase() === 'content-length')) {
			headers['Content-Length'] = String(request.body.length);
		}
		headers['Accept-Encoding'] = 'gzip, deflate, br';

		const secure = url.protocol === 'https:';
		const onResponse = (res: IncomingMessage) => {
			options.cookieJar.store(request.url, res.headers['set-cookie']);

			const chunks: Buffer[] = [];
			let received = 0;
			let truncated = false;
			const stream = decompress(res, res.headers['content-encoding']);

			const deliver = () => finish(undefined, {
				status: res.statusCode ?? 0,
				statusText: res.statusMessage ?? '',
				headers: flattenHeaders(res.headers),
				body: Buffer.concat(chunks),
				truncated
			});

			stream.on('data', (chunk: Buffer) => {
				received += chunk.length;
				if (received > MAX_BODY_BYTES) {
					truncated = true;
					stream.destroy();
					return;
				}
				chunks.push(chunk);
			});
			stream.on('error', () => finish(new Error('Could not read the response body.')));
			stream.on('end', deliver);
			// A destroyed decompression stream may not emit `end`; keep the bytes we have.
			stream.on('close', () => {
				if (truncated) {
					deliver();
				}
			});
		};

		const req = secure
			? httpsRequest(url, { method: request.method, headers, agent: false, rejectUnauthorized: options.verifyTls }, onResponse)
			: httpRequest(url, { method: request.method, headers, agent: false }, onResponse);

		req.setTimeout(options.timeoutMs, () => {
			req.destroy(new Error(`Request timed out after ${Math.round(options.timeoutMs / 1000)} seconds.`));
		});

		req.on('error', error => finish(describeNetworkError(error, url)));
		if (request.body) {
			req.write(request.body);
		}
		req.end();
	});
}

function decompress(res: IncomingMessage, encoding: string | undefined): IncomingMessage {
	const pipe = (stream: import('node:stream').Transform): IncomingMessage => {
		res.on('error', error => stream.destroy(error));
		res.pipe(stream);
		return stream as unknown as IncomingMessage;
	};

	switch ((encoding ?? '').toLowerCase()) {
		case 'gzip':
		case 'x-gzip': return pipe(createGunzip());
		case 'deflate': return pipe(createInflate());
		case 'br': return pipe(createBrotliDecompress());
		default: return res;
	}
}

function flattenHeaders(headers: IncomingMessage['headers']): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined) {
			continue;
		}
		result[name] = Array.isArray(value) ? value.join(', ') : String(value);
	}
	return result;
}

function describeNetworkError(error: NodeJS.ErrnoException, url: URL): Error {
	const code = error.code ?? '';
	if (code === 'ECONNREFUSED') {
		return new Error(`Could not connect to ${url.host}. Is the server running?`);
	}
	if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
		return new Error(`Could not resolve ${url.hostname}.`);
	}
	if (code.startsWith('CERT_') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
		return new Error(`TLS certificate rejected (${code}). For a local server with a self-signed certificate, turn off redCode.api.verifyTls.`);
	}
	return new Error(error.message || 'Request failed.');
}
