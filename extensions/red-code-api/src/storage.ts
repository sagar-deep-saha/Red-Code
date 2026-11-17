/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ApiRequest, BaseUrlProfile, Collection, parseCollectionJson, serializeCollection } from './model.js';
import { BASE_URLS_FILE, COLLECTIONS_FOLDER } from './variables.js';

export function collectionsDirectory(workspaceRoot: string): string {
	return path.join(workspaceRoot, COLLECTIONS_FOLDER);
}

export function baseUrlsFile(workspaceRoot: string): string {
	return path.join(workspaceRoot, BASE_URLS_FILE);
}

export interface CollectionSummary {
	name: string;
	file: string;
}

/** Every collection file in the workspace, sorted by the name shown in the tree. */
export async function listCollections(workspaceRoot: string): Promise<CollectionSummary[]> {
	let entries: string[];
	try {
		entries = await readdir(collectionsDirectory(workspaceRoot));
	} catch {
		return [];
	}
	return entries
		.filter(entry => entry.toLowerCase().endsWith('.json'))
		.sort((a, b) => a.localeCompare(b))
		.map(entry => ({ name: path.basename(entry, '.json'), file: path.join(collectionsDirectory(workspaceRoot), entry) }));
}

export async function readBaseUrlProfiles(workspaceRoot: string | undefined): Promise<BaseUrlProfile[]> {
	if (!workspaceRoot) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(await readFile(baseUrlsFile(workspaceRoot), 'utf8'));
		if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { profiles?: unknown }).profiles)) {
			return [];
		}
		return (parsed as { profiles: unknown[] }).profiles.flatMap(value => {
			if (typeof value !== 'object' || value === null) {
				return [];
			}
			const profile = value as { name?: unknown; url?: unknown };
			if (typeof profile.name !== 'string' || typeof profile.url !== 'string') {
				return [];
			}
			try {
				const url = new URL(profile.url.trim());
				if (url.protocol !== 'http:' && url.protocol !== 'https:') {
					return [];
				}
				return [{ name: profile.name.trim(), url: url.toString().replace(/\/+$/, '') }];
			} catch {
				return [];
			}
		}).filter(profile => profile.name.length > 0);
	} catch {
		return [];
	}
}

async function writeBaseUrlProfiles(workspaceRoot: string, profiles: readonly BaseUrlProfile[]): Promise<void> {
	const file = baseUrlsFile(workspaceRoot);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify({ profiles }, undefined, '\t')}\n`, 'utf8');
}

export async function saveBaseUrlProfile(workspaceRoot: string | undefined, name: string, value: string): Promise<void> {
	if (!workspaceRoot) {
		throw new Error('Open a folder first to save base URL profiles in the workspace.');
	}
	const cleanName = name.trim();
	if (!cleanName) {
		throw new Error('A base URL profile needs a name.');
	}
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error('Enter a complete base URL, including http:// or https://.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Base URLs must use http:// or https://.');
	}

	const profiles = await readBaseUrlProfiles(workspaceRoot);
	const profile = { name: cleanName, url: url.toString().replace(/\/+$/, '') };
	const existing = profiles.findIndex(entry => entry.name.toLowerCase() === cleanName.toLowerCase());
	if (existing >= 0) {
		profiles[existing] = profile;
	} else {
		profiles.push(profile);
	}
	await writeBaseUrlProfiles(workspaceRoot, profiles);
}

export async function deleteBaseUrlProfile(workspaceRoot: string | undefined, name: string): Promise<boolean> {
	if (!workspaceRoot) {
		return false;
	}
	const profiles = await readBaseUrlProfiles(workspaceRoot);
	const remaining = profiles.filter(profile => profile.name !== name);
	if (remaining.length === profiles.length) {
		return false;
	}
	await writeBaseUrlProfiles(workspaceRoot, remaining);
	return true;
}

/** Keeps a user-supplied collection name a single, safe file name. */
export function collectionFileName(name: string): string {
	const cleaned = name
		.trim()
		.replace(/[\\/:*?"<>|\0]/g, '-')
		.replace(/\s+/g, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase();
	return `${cleaned || 'collection'}.json`;
}

export async function readCollectionFile(file: string): Promise<Collection> {
	const text = await readFile(file, 'utf8');
	return parseCollectionJson(text, path.basename(file, '.json'));
}

export async function writeCollectionFile(file: string, collection: Collection): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, serializeCollection(collection), 'utf8');
}

export async function createCollection(workspaceRoot: string, name: string): Promise<string> {
	const file = path.join(collectionsDirectory(workspaceRoot), collectionFileName(name));
	await mkdir(path.dirname(file), { recursive: true });
	try {
		await writeFile(file, serializeCollection({ name: name.trim(), requests: [] }), { encoding: 'utf8', flag: 'wx' });
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
			throw new Error(`Collection "${name.trim()}" already exists.`);
		}
		throw error;
	}
	return file;
}

/** Adds a request to `collectionName`, creating the collection file when it does not exist yet. */
export async function addRequest(workspaceRoot: string, collectionName: string, request: ApiRequest): Promise<string> {
	const file = path.join(collectionsDirectory(workspaceRoot), collectionFileName(collectionName));
	let collection: Collection;
	try {
		collection = await readCollectionFile(file);
	} catch {
		collection = { name: collectionName, requests: [] };
	}

	const existing = collection.requests.findIndex(entry => entry.name === request.name);
	if (existing >= 0) {
		collection.requests[existing] = request;
	} else {
		collection.requests.push(request);
	}
	await writeCollectionFile(file, collection);
	return file;
}

/** Adds (or replaces by name) a request in an existing collection file. */
export async function saveRequestToFile(file: string, request: ApiRequest): Promise<void> {
	let collection: Collection;
	try {
		collection = await readCollectionFile(file);
	} catch {
		collection = { name: path.basename(file, '.json'), requests: [] };
	}
	const existing = collection.requests.findIndex(entry => entry.name === request.name);
	if (existing >= 0) {
		collection.requests[existing] = request;
	} else {
		collection.requests.push(request);
	}
	await writeCollectionFile(file, collection);
}

export async function renameRequest(file: string, oldName: string, newName: string): Promise<ApiRequest | undefined> {
	const collection = await readCollectionFile(file);
	const request = collection.requests.find(entry => entry.name === oldName);
	if (!request) {
		return undefined;
	}
	request.name = newName;
	await writeCollectionFile(file, collection);
	return request;
}

export async function deleteRequest(file: string, name: string): Promise<boolean> {
	const collection = await readCollectionFile(file);
	const before = collection.requests.length;
	collection.requests = collection.requests.filter(entry => entry.name !== name);
	if (collection.requests.length === before) {
		return false;
	}
	await writeCollectionFile(file, collection);
	return true;
}

export async function deleteCollectionFile(file: string): Promise<void> {
	await unlink(file);
}
