/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stripBom } from './json.js';

export type TestOutcome = 'passed' | 'failed' | 'errored' | 'skipped';

export interface TestResult {
	/** Test method name, e.g. `test_fixture_failure_for_result_mapping`. */
	readonly name: string;
	/** PHP class as PHPUnit reported it, e.g. `Tests\Feature\PostTest`. */
	readonly class: string;
	/** Absolute path from the report; `undefined` when PHPUnit omitted it. */
	readonly file: string | undefined;
	/** 1-based line of the test method declaration. */
	readonly line: number | undefined;
	readonly outcome: TestOutcome;
	/** Failure or error text, without the leading `Class::method` line. */
	readonly message: string | undefined;
	readonly time: number | undefined;
}

export interface DiscoveredTest {
	/** `Class::method`, the identity PHPUnit also accepts in `--filter`. */
	readonly id: string;
	readonly name: string;
	readonly class: string;
	/** Absolute path, or an empty string when the source is unknown. */
	readonly file: string;
}

/** The `Class::method` identity shared by the JUnit report, the test list and `--filter`. */
export function testIdentity(test: { readonly class: string; readonly name: string }): string {
	return `${test.class}::${test.name}`;
}

export interface XmlNode {
	readonly name: string;
	readonly attributes: Readonly<Record<string, string>>;
	readonly children: readonly XmlNode[];
	/** Concatenated character data, with entities decoded. */
	readonly text: string;
}

const ENTITIES: Readonly<Record<string, string>> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0'
};

const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;
const ATTRIBUTE = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** `Class::method` on a line of its own; PHPUnit prefixes failure text with it. */
const SELF_IDENTIFIER = /^\S+::\S+$/;

function decodeEntities(text: string): string {
	return text.replace(ENTITY, (match, body: string) => {
		if (body.startsWith('#')) {
			const hex = body[1] === 'x' || body[1] === 'X';
			const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
			if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
				return match;
			}
			return String.fromCodePoint(code);
		}
		return ENTITIES[body.toLowerCase()] ?? match;
	});
}

/** Index of the `>` that closes a tag, skipping any `>` inside a quoted attribute. */
function tagEnd(source: string, start: number): number {
	let quote = '';
	for (let index = start + 1; index < source.length; index++) {
		const character = source[index];
		if (quote) {
			if (character === quote) {
				quote = '';
			}
			continue;
		}
		if (character === '"' || character === '\'') {
			quote = character;
			continue;
		}
		if (character === '>') {
			return index;
		}
	}
	return -1;
}

interface MutableNode {
	name: string;
	attributes: Record<string, string>;
	children: XmlNode[];
	text: string;
}

function createNode(inner: string): MutableNode {
	const trimmed = inner.trim();
	const space = trimmed.search(/\s/);
	const name = space < 0 ? trimmed : trimmed.slice(0, space);
	const attributes: Record<string, string> = {};
	if (space >= 0) {
		const text = trimmed.slice(space);
		let match = ATTRIBUTE.exec(text);
		while (match) {
			attributes[match[1]] = decodeEntities(match[3] ?? match[4] ?? '');
			match = ATTRIBUTE.exec(text);
		}
	}
	return { name, attributes, children: [], text: '' };
}

/**
 * Minimal, namespace-agnostic XML reader. It only needs to survive PHPUnit's
 * well-formed output, so it tolerates the prologue, comments, DOCTYPE, CDATA and
 * self-closing tags without ever throwing on malformed input.
 */
export function parseXml(source: string): XmlNode | undefined {
	const text = stripBom(source);
	const root: MutableNode = { name: '#root', attributes: {}, children: [], text: '' };
	const stack: MutableNode[] = [root];
	let index = 0;

	while (index < text.length) {
		const open = text.indexOf('<', index);
		if (open < 0) {
			stack[stack.length - 1].text += decodeEntities(text.slice(index));
			break;
		}
		if (open > index) {
			stack[stack.length - 1].text += decodeEntities(text.slice(index, open));
		}

		if (text.startsWith('<!--', open)) {
			const end = text.indexOf('-->', open + 4);
			index = end < 0 ? text.length : end + 3;
			continue;
		}
		if (text.startsWith('<![CDATA[', open)) {
			const end = text.indexOf(']]>', open + 9);
			stack[stack.length - 1].text += end < 0 ? text.slice(open + 9) : text.slice(open + 9, end);
			index = end < 0 ? text.length : end + 3;
			continue;
		}
		if (text.startsWith('<?', open) || text.startsWith('<!', open)) {
			const closer = text.startsWith('<?', open) ? '?>' : '>';
			const end = text.indexOf(closer, open + 2);
			index = end < 0 ? text.length : end + closer.length;
			continue;
		}

		const end = tagEnd(text, open);
		if (end < 0) {
			break;
		}
		const raw = text.slice(open + 1, end);
		index = end + 1;

		if (raw.startsWith('/')) {
			const name = raw.slice(1).trim();
			for (let depth = stack.length - 1; depth > 0; depth--) {
				if (stack[depth].name === name) {
					stack.length = depth;
					break;
				}
			}
			continue;
		}

		const selfClosing = raw.endsWith('/');
		const node = createNode(selfClosing ? raw.slice(0, -1) : raw);
		if (!node.name) {
			continue;
		}
		stack[stack.length - 1].children.push(node);
		if (!selfClosing) {
			stack.push(node);
		}
	}

	return root.children[0];
}

function toNumber(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** Drops the redundant `Class::method` line PHPUnit puts in front of the message. */
function cleanMessage(text: string): string | undefined {
	const normalized = text.replace(/\r\n?/g, '\n').trim();
	if (!normalized) {
		return undefined;
	}
	const lines = normalized.split('\n');
	if (SELF_IDENTIFIER.test(lines[0])) {
		lines.shift();
	}
	return lines.join('\n').trim() || undefined;
}

function outcomeOf(node: XmlNode): { readonly outcome: TestOutcome; readonly node: XmlNode | undefined } {
	for (const child of node.children) {
		if (child.name === 'failure') {
			return { outcome: 'failed', node: child };
		}
		if (child.name === 'error') {
			return { outcome: 'errored', node: child };
		}
		if (child.name === 'skipped') {
			return { outcome: 'skipped', node: child };
		}
	}
	return { outcome: 'passed', node: undefined };
}

function toResult(node: XmlNode): TestResult {
	const { outcome, node: detail } = outcomeOf(node);
	return {
		name: node.attributes['name'] ?? '',
		class: node.attributes['class'] ?? node.attributes['classname'] ?? '',
		file: node.attributes['file'] || undefined,
		line: toNumber(node.attributes['line']),
		outcome,
		message: detail ? cleanMessage(detail.text) : undefined,
		time: toNumber(node.attributes['time'])
	};
}

function collect(node: XmlNode, out: TestResult[]): void {
	if (node.name === 'testcase') {
		out.push(toResult(node));
		return;
	}
	for (const child of node.children) {
		collect(child, out);
	}
}

/**
 * Reads a PHPUnit `--log-junit` report. Suites nest arbitrarily deep
 * (`<testsuites>` → `Unit`/`Feature` → class), so the whole tree is walked
 * rather than a single flat `<testsuite>` being assumed.
 */
export function parseJUnit(xml: string): TestResult[] {
	const root = parseXml(xml);
	if (!root) {
		return [];
	}
	const results: TestResult[] = [];
	collect(root, results);
	return results;
}

/** Reads the `--list-tests-xml` report (`<tests>` → `<testClass>` → `<testMethod>`). */
export function parseTestList(xml: string): DiscoveredTest[] {
	const root = parseXml(xml);
	if (!root) {
		return [];
	}

	const container = root.children.find(child => child.name === 'tests') ?? root;
	const discovered: DiscoveredTest[] = [];
	for (const group of container.children) {
		if (group.name !== 'testClass') {
			continue;
		}
		const file = group.attributes['file'] ?? '';
		const className = group.attributes['name'] ?? '';
		for (const method of group.children) {
			if (method.name !== 'testMethod') {
				continue;
			}
			const name = method.attributes['name'] ?? '';
			if (!name) {
				continue;
			}
			discovered.push({
				id: method.attributes['id'] || `${className}::${name}`,
				name,
				class: className,
				file
			});
		}
	}
	return discovered;
}

/**
 * Derives the class name PHPUnit would report for a test file, following the
 * Laravel convention `tests/Feature/PostTest.php` → `Tests\Feature\PostTest`.
 */
export function classFromTestPath(relativePath: string): string | undefined {
	const match = /^tests\/(.+)\.php$/.exec(relativePath.replace(/\\/g, '/'));
	if (!match) {
		return undefined;
	}
	const parts = match[1].split('/').filter(part => part.length > 0);
	if (parts.length === 0) {
		return undefined;
	}
	return ['Tests', ...parts].join('\\');
}

const TEST_METHOD = /\bfunction\s+([A-Za-z_]\w*)\s*\(/g;
const TEST_ATTRIBUTE = /#\[Test\]\s*(?:(?:public|protected|private)\s+)?function\s+([A-Za-z_]\w*)\s*\(/g;

/**
 * Discovery fallback for PHPUnit older than 9.3, which has no
 * `--list-tests-xml`: the method names come from the source itself.
 */
export function parseTestSource(source: string): string[] {
	const names = new Set<string>();
	for (const match of source.matchAll(TEST_METHOD)) {
		if (/^test/i.test(match[1])) {
			names.add(match[1]);
		}
	}
	for (const match of source.matchAll(TEST_ATTRIBUTE)) {
		names.add(match[1]);
	}
	return [...names];
}

/**
 * Builds the `--filter` argument for PHPUnit. No selection means no filter, so
 * the whole suite runs.
 */
export function buildFilter(ids: readonly string[]): string | undefined {
	const wanted = ids.filter(id => id.length > 0);
	if (wanted.length === 0) {
		return undefined;
	}
	const escaped = wanted.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	return `/(${escaped.join('|')})/`;
}
