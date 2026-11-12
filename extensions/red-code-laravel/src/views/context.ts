/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LaravelGraph, SourceLocation } from '../index/graph.js';
import { LaravelProject } from '../project.js';

/**
 * Everything a Laravel view needs from the extension. Views never talk to
 * artisan, the filesystem or settings directly: they read the graph and use
 * these callbacks.
 */
export interface LaravelViewContext {
	graph(): LaravelGraph | undefined;
	project(): LaravelProject | undefined;
	ensureIndex(): Promise<LaravelGraph | undefined>;
	refreshIndex(): Promise<void>;
	appUrl(): string;
	openLocation(location: SourceLocation): Promise<void>;
	copy(value: string, message: string): Promise<void>;
	showVendorRoutes(): boolean;
}
