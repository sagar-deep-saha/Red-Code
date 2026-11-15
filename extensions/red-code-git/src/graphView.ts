/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';
import * as vscode from 'vscode';
import { commitDetails, commitFiles, commitPatch, GitError, logCommits, statusSummary } from './git.js';
import { computeGraph, GraphRow, refLabel } from './graph.js';
import { formatDate } from './log.js';

const PATCH_DISPLAY_LIMIT = 300000;
const LANE_WIDTH = 14;
const ROW_HEIGHT = 44;

export interface GraphPanelDeps {
	/** Resolved repository root, or `undefined` when the workspace has no git repository. */
	root(): string | undefined;
	pageSize(): number;
}

interface GraphMessage {
	type: string;
	sha?: string;
	path?: string;
}

function nonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let index = 0; index < 32; index++) {
		value += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return value;
}

export class GraphPanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private readonly disposables: vscode.Disposable[] = [];
	private limit = 300;
	private rows: GraphRow[] = [];
	private repoLabel = '';
	private branch = '';
	private hasMore = false;

	constructor(private readonly deps: GraphPanelDeps) { }

	dispose(): void {
		this.panel?.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	async open(): Promise<void> {
		const root = this.deps.root();
		if (!root) {
			void vscode.window.showInformationMessage('Red Code Git: open a folder inside a git repository first.');
			return;
		}

		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel('redCode.git.graph', 'Git Graph', vscode.ViewColumn.Active, {
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: []
			});
			this.panel.webview.html = this.html(this.panel.webview);
			this.panel.onDidDispose(() => {
				this.panel = undefined;
			}, undefined, this.disposables);
			this.panel.webview.onDidReceiveMessage(message => void this.onMessage(message as GraphMessage), undefined, this.disposables);
		} else {
			this.panel.reveal(vscode.ViewColumn.Active);
		}

		this.limit = this.deps.pageSize();
		await this.reload();
	}

	async refresh(): Promise<void> {
		if (!this.panel) {
			return;
		}
		await this.reload();
	}

	private async reload(): Promise<void> {
		const root = this.deps.root();
		if (!root || !this.panel) {
			return;
		}

		try {
			const [status, commits] = await Promise.all([
				statusSummary(root),
				logCommits(root, { all: true, limit: this.limit })
			]);
			this.branch = status.branch;
			this.repoLabel = path.basename(root);
			this.rows = computeGraph(commits);
			this.hasMore = commits.length >= this.limit;
			this.panel.title = `Git Graph — ${this.repoLabel}`;
			await this.post({
				type: 'commits',
				rows: this.rows.map(row => ({
					sha: row.commit.sha,
					short: row.commit.short,
					subject: row.commit.subject,
					author: row.commit.author,
					date: row.commit.date,
					refs: row.commit.refs.map(ref => ({ text: ref, ...refLabel(ref) })),
					lane: row.lane,
					before: row.before,
					after: row.after
				})),
				hasMore: this.hasMore,
				repoLabel: this.repoLabel,
				branch: this.branch,
				dirtyFiles: status.dirtyFiles
			});
		} catch (error) {
			await this.fail(error);
		}
	}

	private async onMessage(message: GraphMessage): Promise<void> {
		const root = this.deps.root();
		if (!root) {
			return;
		}

		if (message.type === 'ready' || message.type === 'refresh') {
			await this.reload();
			return;
		}

		if (message.type === 'loadMore') {
			if (!this.hasMore) {
				return;
			}
			this.limit += this.deps.pageSize();
			await this.reload();
			return;
		}

		if (message.type === 'selectCommit' && message.sha) {
			try {
				const [details, files] = await Promise.all([
					commitDetails(root, message.sha),
					commitFiles(root, message.sha)
				]);
				if (details) {
					await this.post({ type: 'commit', details, files, dateText: formatDate(details.date) });
				}
			} catch (error) {
				await this.fail(error);
			}
			return;
		}

		if (message.type === 'showFile' && message.sha && message.path) {
			try {
				const text = await commitPatch(root, message.sha, message.path);
				const truncated = text.length > PATCH_DISPLAY_LIMIT;
				await this.post({
					type: 'patch',
					sha: message.sha,
					path: message.path,
					text: truncated ? text.slice(0, PATCH_DISPLAY_LIMIT) : text,
					truncated
				});
			} catch (error) {
				await this.fail(error);
			}
		}
	}

	private async fail(error: unknown): Promise<void> {
		const message = error instanceof GitError || error instanceof Error ? error.message : String(error);
		await this.post({ type: 'error', message });
	}

	private post(payload: unknown): Thenable<boolean> {
		return this.panel ? this.panel.webview.postMessage(payload) : Promise.resolve(false);
	}

	private html(webview: vscode.Webview): string {
		const scriptNonce = nonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; img-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	:root { color-scheme: light dark; }
	html, body { height: 100%; }
	body { margin: 0; display: flex; flex-direction: column; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); overflow: hidden; }
	header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
	header h1 { font-size: 13px; font-weight: 600; margin: 0; }
	header .branch { color: var(--vscode-descriptionForeground); font-size: 12px; }
	header input { flex: 1; max-width: 320px; margin-left: auto; font-family: inherit; font-size: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 4px 6px; }
	header button { font-family: inherit; font-size: inherit; padding: 4px 10px; border: none; border-radius: 2px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
	header button:hover { background: var(--vscode-button-secondaryHoverBackground); }
	main { flex: 1; display: flex; min-height: 0; }
	#graphPane { width: 58%; min-width: 320px; display: flex; flex-direction: column; border-right: 1px solid var(--vscode-panel-border); }
	#list { flex: 1; overflow: auto; position: relative; }
	#spacer { position: relative; }
	.row { position: absolute; left: 0; right: 0; height: ${ROW_HEIGHT}px; display: flex; align-items: center; gap: 10px; padding: 0 12px 0 4px; box-sizing: border-box; cursor: pointer; border-bottom: 1px solid transparent; }
	.row:hover { background: var(--vscode-list-hoverBackground); }
	.row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
	.row svg { flex: none; display: block; }
	.row .info { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
	.row .subject { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.row .meta { font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.row.selected .meta { color: inherit; opacity: .85; }
	.refs { display: inline-flex; gap: 4px; margin-right: 6px; vertical-align: middle; }
	.ref { font-size: 10px; padding: 0 5px; border-radius: 8px; border: 1px solid var(--vscode-badge-background); color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); white-space: nowrap; }
	.ref.tag { background: transparent; color: var(--vscode-charts-yellow, #d19a66); border-color: var(--vscode-charts-yellow, #d19a66); }
	.ref.remote { background: transparent; color: var(--vscode-charts-blue, #61afef); border-color: var(--vscode-charts-blue, #61afef); }
	.ref.head { background: transparent; color: var(--vscode-charts-green, #98c379); border-color: var(--vscode-charts-green, #98c379); }
	#footer { padding: 6px 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; justify-content: center; }
	#footer button { font-family: inherit; font-size: 12px; padding: 3px 12px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
	#details { flex: 1; overflow: auto; padding: 12px 14px; min-width: 280px; }
	#details h2 { font-size: 14px; margin: 0 0 6px; }
	#details .sha { font-family: var(--vscode-editor-font-family); font-size: 12px; color: var(--vscode-descriptionForeground); user-select: text; }
	#details dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font-size: 12px; margin: 12px 0; }
	#details dt { color: var(--vscode-descriptionForeground); }
	#details dd { margin: 0; word-break: break-word; }
	#details pre.message { white-space: pre-wrap; font-family: var(--vscode-editor-font-family); font-size: 12px; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); border-radius: 2px; padding: 8px; margin: 0 0 12px; }
	#details .files { border-top: 1px solid var(--vscode-panel-border); padding-top: 8px; }
	#details .file { display: flex; gap: 8px; align-items: center; padding: 3px 4px; font-family: var(--vscode-editor-font-family); font-size: 12px; cursor: pointer; border-radius: 2px; }
	#details .file:hover { background: var(--vscode-list-hoverBackground); }
	#details .file .path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
	#details .file .add { color: var(--vscode-charts-green, #98c379); }
	#details .file .del { color: var(--vscode-charts-red, #e06c75); }
	#patch { margin-top: 12px; }
	#patchHeader { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
	pre.diff { font-family: var(--vscode-editor-font-family); font-size: 12px; margin: 0; padding: 6px 8px; overflow: auto; max-height: 40vh; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); border-radius: 2px; }
	pre.diff .add { color: var(--vscode-diffEditor-insertedTextBackground, #98c379); display: block; }
	pre.diff .del { color: var(--vscode-diffEditor-removedTextBackground, #e06c75); display: block; }
	pre.diff .hunk { color: var(--vscode-charts-blue, #61afef); display: block; }
	pre.diff .line { display: block; }
	.hint { color: var(--vscode-descriptionForeground); }
	.error { color: var(--vscode-errorForeground, #f85149); }
	#empty { padding: 16px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<header>
	<h1 id="title">Git Graph</h1>
	<span class="branch" id="branch"></span>
	<input id="search" type="search" placeholder="Filter by subject, author or sha">
	<button id="refresh">Refresh</button>
</header>
<main>
	<div id="graphPane">
		<div id="list"><div id="spacer"></div></div>
		<div id="footer"><button id="more" style="display:none">Load more</button></div>
	</div>
	<div id="details"><div id="empty">Select a commit to see its details.</div></div>
</main>
<script nonce="${scriptNonce}">
(function () {
	const vscode = acquireVsCodeApi();
	const palette = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#7f848e'];
	const list = document.getElementById('list');
	const spacer = document.getElementById('spacer');
	const details = document.getElementById('details');
	const search = document.getElementById('search');
	const more = document.getElementById('more');
	const SVG_NS = 'http://www.w3.org/2000/svg';
	let rows = [];
	let visible = [];
	let selected = null;
	let renderQueued = false;

	function color(index) { return palette[index % palette.length]; }

	function svgLine(svg, x1, y1, x2, y2, stroke) {
		const line = document.createElementNS(SVG_NS, 'line');
		line.setAttribute('x1', x1); line.setAttribute('y1', y1);
		line.setAttribute('x2', x2); line.setAttribute('y2', y2);
		line.setAttribute('stroke', stroke);
		line.setAttribute('stroke-width', '2');
		line.setAttribute('stroke-linecap', 'round');
		svg.appendChild(line);
	}

	function buildGraph(row) {
		const lanes = Math.max(row.before.length, row.after.length, row.lane + 1, 1);
		const width = lanes * ${LANE_WIDTH} + 8;
		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('width', width);
		svg.setAttribute('height', ${ROW_HEIGHT});
		const midY = ${ROW_HEIGHT} / 2;
		const x = lane => lane * ${LANE_WIDTH} + 7;

		for (let i = 0; i < row.before.length; i++) {
			if (row.before[i] && row.before[i] !== row.sha) {
				svgLine(svg, x(i), 0, x(i), (row.after[i] === row.before[i]) ? ${ROW_HEIGHT} : midY, color(i));
			}
		}
		for (let i = 0; i < row.before.length; i++) {
			if (row.before[i] === row.sha) {
				svgLine(svg, x(i), 0, x(row.lane), midY, color(i));
			}
		}
		for (let j = 0; j < row.after.length; j++) {
			if (!row.after[j]) { continue; }
			const incoming = row.before.indexOf(row.after[j]);
			if (incoming === j) {
				continue; // this lane continues below the row and is already drawn
			}
			svgLine(svg, x(row.lane), midY, x(j), ${ROW_HEIGHT}, color(j));
		}
		const dot = document.createElementNS(SVG_NS, 'circle');
		dot.setAttribute('cx', x(row.lane)); dot.setAttribute('cy', midY); dot.setAttribute('r', '4');
		dot.setAttribute('fill', color(row.lane));
		dot.setAttribute('stroke', 'var(--vscode-editor-background)');
		dot.setAttribute('stroke-width', '1');
		svg.appendChild(dot);
		return svg;
	}

	function refsElement(row) {
		if (!row.refs || row.refs.length === 0) { return null; }
		const wrapper = document.createElement('span');
		wrapper.className = 'refs';
		for (const ref of row.refs) {
			const badge = document.createElement('span');
			badge.className = 'ref ' + ref.kind;
			badge.textContent = ref.text;
			wrapper.appendChild(badge);
		}
		return wrapper;
	}

	function buildRow(row) {
		const element = document.createElement('div');
		element.className = 'row' + (selected === row.sha ? ' selected' : '');
		element.appendChild(buildGraph(row));
		const info = document.createElement('div');
		info.className = 'info';
		const subject = document.createElement('span');
		subject.className = 'subject';
		const refs = refsElement(row);
		if (refs) { subject.appendChild(refs); }
		subject.appendChild(document.createTextNode(row.subject));
		const meta = document.createElement('span');
		meta.className = 'meta';
		meta.textContent = row.short + ' · ' + row.author + ' · ' + row.date;
		info.append(subject, meta);
		element.appendChild(info);
		element.addEventListener('click', () => selectRow(row));
		return element;
	}

	function selectRow(row) {
		selected = row.sha;
		render();
		vscode.postMessage({ type: 'selectCommit', sha: row.sha });
	}

	function render() {
		renderQueued = false;
		const totalHeight = visible.length * ${ROW_HEIGHT};
		spacer.style.height = totalHeight + 'px';
		list.querySelectorAll('.row, #empty').forEach(element => element.remove());
		if (visible.length === 0) {
			const empty = document.createElement('div');
			empty.id = 'empty';
			empty.textContent = rows.length === 0 ? 'No commits in this repository yet.' : 'No commit matches the filter.';
			spacer.appendChild(empty);
			return;
		}
		const start = Math.max(0, Math.floor(list.scrollTop / ${ROW_HEIGHT}) - 5);
		const end = Math.min(visible.length, Math.ceil((list.scrollTop + list.clientHeight) / ${ROW_HEIGHT}) + 5);
		for (let index = start; index < end; index++) {
			const element = buildRow(visible[index]);
			element.style.top = (index * ${ROW_HEIGHT}) + 'px';
			spacer.appendChild(element);
		}
	}

	function queueRender() {
		if (renderQueued) { return; }
		renderQueued = true;
		requestAnimationFrame(render);
	}

	function applyFilter() {
		const query = search.value.trim().toLowerCase();
		visible = query.length === 0
			? rows
			: rows.filter(row => (row.subject + ' ' + row.author + ' ' + row.short).toLowerCase().includes(query));
		selected = null;
		render();
	}

	function fileRow(file, sha) {
		const element = document.createElement('div');
		element.className = 'file';
		const pathElement = document.createElement('span');
		pathElement.className = 'path';
		pathElement.textContent = file.path;
		pathElement.title = file.path;
		const add = document.createElement('span');
		add.className = 'add';
		add.textContent = '+' + file.additions;
		const del = document.createElement('span');
		del.className = 'del';
		del.textContent = '−' + file.deletions;
		element.append(pathElement, add, del);
		element.addEventListener('click', () => vscode.postMessage({ type: 'showFile', sha: sha, path: file.path }));
		return element;
	}

	function showCommit(commit, files) {
		const pane = document.getElementById('details');
		pane.replaceChildren();
		const title = document.createElement('h2');
		title.textContent = commit.subject || '(no subject)';
		const sha = document.createElement('div');
		sha.className = 'sha';
		sha.textContent = commit.sha;
		const dl = document.createElement('dl');
		const addPair = (label, value) => {
			const dt = document.createElement('dt');
			dt.textContent = label;
			const dd = document.createElement('dd');
			dd.textContent = value;
			dl.append(dt, dd);
		};
		addPair('Author', commit.author + ' <' + commit.email + '>');
		addPair('Date', commit.date);
		addPair('Parents', commit.parents.length ? commit.parents.join(' ') : '(root commit)');
		if (commit.refs && commit.refs.length) { addPair('Refs', commit.refs.join(', ')); }
		pane.append(title, sha, dl);

		if (commit.body) {
			const message = document.createElement('pre');
			message.className = 'message';
			message.textContent = commit.body;
			pane.appendChild(message);
		}

		const container = document.createElement('div');
		container.className = 'files';
		const heading = document.createElement('div');
		heading.className = 'hint';
		heading.textContent = files.length + ' changed file' + (files.length === 1 ? '' : 's');
		container.appendChild(heading);
		for (const file of files) {
			container.appendChild(fileRow(file, commit.sha));
		}
		pane.appendChild(container);
		pane.scrollTop = 0;
	}

	function showPatch(message) {
		const existing = document.getElementById('patch');
		if (existing) { existing.remove(); }
		const container = document.createElement('div');
		container.id = 'patch';
		const header = document.createElement('div');
		header.id = 'patchHeader';
		const label = document.createElement('span');
		label.textContent = message.path;
		header.appendChild(label);
		if (message.truncated) {
			const note = document.createElement('span');
			note.className = 'error';
			note.textContent = 'diff truncated at 300 KB';
			header.appendChild(note);
		}
		const pre = document.createElement('pre');
		pre.className = 'diff';
		const lines = message.text.split('\\n');
		for (const line of lines) {
			const span = document.createElement('span');
			span.className = line.startsWith('@@') ? 'hunk' : line.startsWith('+++') || line.startsWith('---') ? 'line' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'line';
			span.textContent = line.length === 0 ? ' ' : line;
			pre.appendChild(span);
		}
		container.append(header, pre);
		details.appendChild(container);
		container.scrollIntoView({ block: 'nearest' });
	}

	list.addEventListener('scroll', queueRender);
	search.addEventListener('input', applyFilter);
	document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
	more.addEventListener('click', () => vscode.postMessage({ type: 'loadMore' }));
	document.addEventListener('keydown', event => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') { return; }
		if (visible.length === 0) { return; }
		event.preventDefault();
		let index = visible.findIndex(row => row.sha === selected);
		index = event.key === 'ArrowDown' ? Math.min(visible.length - 1, index + 1) : Math.max(0, index - 1);
		const row = visible[index];
		selectRow(row);
		list.scrollTop = Math.max(0, index * ${ROW_HEIGHT} - list.clientHeight / 2);
	});

	window.addEventListener('message', event => {
		const message = event.data;
		if (message.type === 'commits') {
			rows = message.rows;
			document.getElementById('title').textContent = message.repoLabel;
			document.getElementById('branch').textContent = message.branch + (message.dirtyFiles ? ' · ' + message.dirtyFiles + ' changed' : '');
			more.style.display = message.hasMore ? '' : 'none';
			const active = selected;
			applyFilter();
			if (active) {
				const still = visible.find(row => row.sha === active);
				if (still) {
					selected = active;
					render();
				}
			}
		} else if (message.type === 'commit') {
			showCommit(message.details, message.files);
		} else if (message.type === 'patch') {
			showPatch(message);
		} else if (message.type === 'error') {
			const element = document.createElement('div');
			element.className = 'error';
			element.textContent = message.message;
			details.replaceChildren(element);
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
</script>
</body>
</html>`;
	}
}
