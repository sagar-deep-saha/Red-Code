/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { ApiRequest, Collection, parseCollectionJson, serializeCollection } from './model.js';
import { COLLECTIONS_FOLDER } from './variables.js';

export function collectionsDirectory(workspaceRoot: string): string {
	return path.join(workspaceRoot, COLLECTIONS_FOLDER);
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
