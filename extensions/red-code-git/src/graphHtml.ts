/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Renders the Commit Graph webview. The HTML is static: every row, branch and
 * detail arrives through `postMessage`, so the emitted inline script must stay
 * valid JavaScript. Keep regexes free of escaped soliduses, because this string
 * is a template literal and `\/` collapses to `/`.
 */
export function renderGraphHtml(webview: vscode.Webview, scriptNonce: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; img-src ${webview.cspSource} https://www.gravatar.com https://*.gravatar.com https://avatars.githubusercontent.com https://*.githubusercontent.com data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	:root {
		color-scheme: light dark;
		--row-h: 24px;
		--lane: 10px;
		--w-graph: 32px;
		--w-refs: 176px;
		--w-author: 136px;
		--w-committer: 120px;
		--w-changes: 56px;
		--w-date: 84px;
		--w-sha: 76px;
		--cols: 32px 176px minmax(120px, 1fr) 136px 56px 84px 76px 120px;
		--fg: var(--vscode-foreground);
		--muted: var(--vscode-descriptionForeground);
		--line: var(--vscode-panel-border, rgba(128, 128, 128, .28));
		--hover: var(--vscode-list-hoverBackground, rgba(128, 128, 128, .12));
		--sel: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-activeSelectionBackground));
		--accent: #ff2d20;
		--green: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-charts-green, #3fb950));
		--red: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-charts-red, #f85149));
		--track: color-mix(in srgb, var(--fg) 14%, transparent);
	}
	* { box-sizing: border-box; }
	html, body { height: 100%; }
	body { margin: 0; display: flex; flex-direction: column; overflow: hidden; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--vscode-editor-background); }
	button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
	svg { display: block; }

	header { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; height: 34px; padding: 0 8px; border-bottom: 1px solid var(--line); background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
	.repo-icon { display: grid; width: 18px; height: 18px; flex: none; place-items: center; color: var(--muted); }
	.repo-context { display: flex; min-width: 0; align-items: center; gap: 6px; }
	.repo-context h1 { margin: 0; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 30vw; }
	.chip { display: inline-flex; height: 20px; max-width: 220px; align-items: center; gap: 4px; padding: 0 6px; border: 1px solid var(--line); border-radius: 3px; color: var(--fg); background: transparent; font-size: 11px; white-space: nowrap; }
	.chip:hover { background: var(--hover); }
	.chip svg { width: 11px; height: 11px; flex: none; fill: none; stroke: currentColor; }
	.chip .name { overflow: hidden; text-overflow: ellipsis; }
	.chip .caret { color: var(--muted); font-size: 8px; }
	.dirty { padding: 0 5px; border-radius: 3px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 10px; line-height: 16px; }
	.spacer { flex: 1; }
	.search-wrap { display: flex; width: min(34vw, 340px); min-width: 140px; height: 24px; align-items: center; gap: 4px; padding: 0 4px 0 6px; border: 1px solid var(--vscode-input-border, var(--line)); border-radius: 3px; background: var(--vscode-input-background); }
	.search-wrap:focus-within { border-color: var(--vscode-focusBorder); }
	.search-wrap > svg { width: 13px; height: 13px; flex: none; fill: none; stroke: var(--muted); stroke-width: 1.7; }
	.search-wrap input { width: 100%; min-width: 0; padding: 2px 0; border: 0; outline: 0; color: var(--vscode-input-foreground); background: transparent; font: inherit; font-size: 12px; }
	.search-wrap input::placeholder { color: var(--vscode-input-placeholderForeground); }
	.search-wrap .count { flex: none; color: var(--muted); font-size: 10px; white-space: nowrap; }
	.icon-btn { display: grid; width: 20px; height: 20px; flex: none; place-items: center; border-radius: 3px; color: var(--muted); }
	.icon-btn:hover { background: var(--hover); color: var(--fg); }
	.icon-btn svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.6; }
	.toolbar { display: flex; flex: none; align-items: center; gap: 2px; }
	.tb { display: inline-flex; height: 24px; align-items: center; gap: 5px; padding: 0 6px; border: 1px solid transparent; border-radius: 3px; color: var(--muted); background: transparent; font-size: 11px; white-space: nowrap; }
	.tb:hover { background: var(--hover); color: var(--fg); }
	.tb svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; }
	.tb.active { border-color: var(--vscode-focusBorder); }
	.badge-count { padding: 0 4px; border-radius: 3px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 10px; }

	#main { position: relative; flex: 1; display: flex; min-height: 0; }
	#graphPane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	#working { display: grid; flex: none; grid-template-columns: var(--cols); height: var(--row-h); align-items: center; gap: 0; padding: 0 8px; border-bottom: 1px solid var(--line); background: var(--vscode-sideBar-background, var(--vscode-editor-background)); cursor: pointer; font-size: 12px; }
	#working:hover { background: var(--hover); }
	#working .msg { display: flex; min-width: 0; align-items: center; gap: 6px; font-weight: 600; }
	#working .cell.message { flex-direction: row; align-items: center; gap: 6px; }
	#working .msg .subject { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	#working .msg .hint { font-weight: 400; color: var(--muted); font-size: 10px; }
	#minimap { display: flex; flex: none; height: 38px; align-items: center; padding: 4px 8px; border-bottom: 1px solid var(--line); }
	#minimap svg { width: 100%; height: 30px; }
	#minimap.hidden { display: none; }
	#columns { display: grid; flex: none; grid-template-columns: var(--cols); height: 24px; align-items: center; padding: 0 8px; border-bottom: 1px solid var(--line); background: var(--vscode-editor-background); color: var(--muted); font-size: 11px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; user-select: none; }
	#columns .col { position: relative; display: flex; height: 100%; align-items: center; overflow: hidden; padding-right: 8px; white-space: nowrap; text-overflow: ellipsis; }
	#columns .col .grip { position: absolute; top: 0; right: -3px; width: 6px; height: 100%; cursor: col-resize; }
	#columns .col .grip:hover { background: var(--vscode-focusBorder); }
	#columns .col > svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.5; }
	#list { position: relative; flex: 1; overflow: auto; }
	#spacer { position: relative; }
	.row { position: absolute; left: 0; right: 0; display: grid; grid-template-columns: var(--cols); height: var(--row-h); align-items: center; gap: 0; padding: 0 8px; cursor: pointer; }
	.row:hover { background: var(--hover); }
	.row.selected { background: var(--sel); }
	.row.dim { opacity: .55; }
	.cell { display: flex; min-width: 0; align-items: center; gap: 6px; overflow: hidden; }
	.cell.graph { overflow: visible; }
	.refs { display: inline-flex; min-width: 0; align-items: center; gap: 4px; overflow: hidden; }
	.ref { display: inline-flex; height: 18px; max-width: 100%; min-width: 0; align-items: center; gap: 4px; padding: 0 6px; border-radius: 3px; color: var(--muted); background: color-mix(in srgb, var(--fg) 7%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 16%, transparent); font-size: 10px; line-height: 1; white-space: nowrap; overflow: hidden; }
	.ref:hover { color: var(--fg); background: color-mix(in srgb, var(--fg) 14%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 34%, transparent); }
	.ref svg { width: 11px; height: 11px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; }
	.ref .label { overflow: hidden; text-overflow: ellipsis; }
	.ref.branch svg { color: var(--vscode-charts-blue, #3794ff); }
	.ref.remote svg { color: var(--vscode-charts-purple, #b180d7); }
	.ref.tag svg { color: var(--vscode-charts-yellow, #cca700); }
	.ref.head { color: #fff; background: var(--accent); box-shadow: inset 0 0 0 1px #0000; }
	.ref.head:hover { background: #ff4636; color: #fff; }
	.ref.head svg { color: #fff; }
	.ref.working { color: var(--muted); border: 0; background: transparent; box-shadow: inset 0 0 0 1px var(--line); font-style: italic; }
	.ref.more { color: var(--muted); background: transparent; box-shadow: none; padding: 0 3px; }
	.message { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; justify-content: center; gap: 1px; }
	.message .subject { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; line-height: 1.35; color: var(--fg); }
	.message .subject .merge { color: var(--muted); font-size: 10px; margin-right: 4px; }
	.row.selected .message .subject { color: inherit; }
	.avatar { position: relative; display: grid; width: 18px; height: 18px; flex: 0 0 18px; place-items: center; overflow: hidden; border-radius: 50%; color: var(--fg); background: color-mix(in srgb, var(--fg) 16%, transparent); font-size: 7px; font-weight: 600; }
	.avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 11px; }
	.meta { color: var(--muted); font-size: 11px; }
	.sha { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--muted); }
	.changes { display: flex; width: 100%; align-items: center; gap: 4px; font-size: 10px; font-family: var(--vscode-editor-font-family); font-variant-numeric: tabular-nums; }
	.changes .add { color: var(--green); }
	.changes .del { color: var(--red); }
	.changes .none { color: var(--muted); }
	.statbar { display: flex; width: 100%; height: 9px; gap: 1px; overflow: hidden; border-radius: 3px; background: var(--track); }
	.statbar .a { background: var(--green); }
	.statbar .d { background: var(--red); }
	.squares { display: flex; gap: 2px; }
	.squares i { width: 6px; height: 6px; border-radius: 1px; background: var(--track); }
	.squares i.a { background: var(--green); }
	.squares i.d { background: var(--red); }
	.row-actions { position: absolute; right: 8px; top: 0; bottom: 0; display: none; align-items: center; gap: 1px; padding-left: 20px; background: linear-gradient(to right, transparent, var(--hover) 20px); }
	.row:hover .row-actions { display: flex; }
	.row.selected .row-actions { background: linear-gradient(to right, transparent, var(--sel) 20px); }
	.row-actions button { display: grid; width: 20px; height: 20px; place-items: center; border-radius: 3px; color: var(--muted); }
	.row-actions button:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--fg); }
	.row-actions svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.6; }
	#footer { display: flex; flex: none; justify-content: center; padding: 6px 12px; border-top: 1px solid var(--line); }
	#footer button { height: 24px; padding: 0 12px; border: 1px solid var(--line); border-radius: 3px; color: var(--fg); background: var(--vscode-button-secondaryBackground); font-size: 11px; }
	#footer button:hover { background: var(--vscode-button-secondaryHoverBackground); }
	#footer.hidden { display: none; }

	/* GitLens-style list layout: two-line commits when the host view is narrow. */
	body.list #columns { display: none; }
	body.list .row { display: flex; align-items: center; padding: 0 8px; }
	body.list .row .cell.graph { flex: 0 0 auto; }
	.list-content { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; justify-content: center; gap: 2px; overflow: hidden; }
	.list-line1 { display: flex; min-width: 0; align-items: center; gap: 6px; }
	.list-line1 .subject { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; line-height: 16px; color: var(--fg); }
	.list-line2 { display: flex; min-width: 0; align-items: center; gap: 8px; color: var(--muted); font-size: 10px; line-height: 14px; }
	.list-line2 .refs { flex: 0 1 auto; }
	.list-line2 .sha { flex: none; font-size: 10px; }
	.list-line2 .author { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.list-line2 .date { flex: none; margin-left: auto; font-size: 10px; }
	.list-line2 .changes { width: auto; flex: none; }
	body.list #working { display: flex; padding: 0 8px; }
	body.list #working .cell.graph { flex: 0 0 auto; }
	body.list .row-actions { background: linear-gradient(to right, transparent, var(--hover) 20px); }

	#splitter { width: 4px; flex: none; cursor: col-resize; background: transparent; }
	#splitter:hover { background: var(--vscode-focusBorder); }
	#details { width: 360px; min-width: 260px; flex: none; overflow: auto; padding: 10px 12px 16px; border-left: 1px solid var(--line); background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
	#details .empty { color: var(--muted); font-size: 12px; padding-top: 6px; }
	#details h2 { margin: 2px 0 6px; font-size: 13px; font-weight: 600; word-break: break-word; }
	#details .sha-line { display: flex; align-items: center; gap: 6px; }
	#details .sha-line code { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--muted); user-select: text; overflow: hidden; text-overflow: ellipsis; }
	#details .actions { display: flex; flex-wrap: wrap; gap: 4px; margin: 10px 0 12px; }
	#details .actions button { display: inline-flex; height: 22px; align-items: center; gap: 4px; padding: 0 7px; border: 1px solid var(--line); border-radius: 3px; color: var(--fg); background: transparent; font-size: 11px; }
	#details .actions button:hover { background: var(--hover); }
	#details .actions svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.6; }
	#details dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; margin: 0 0 12px; font-size: 11px; }
	#details dt { color: var(--muted); }
	#details dd { display: flex; min-width: 0; align-items: center; gap: 6px; margin: 0; overflow: hidden; word-break: break-word; }
	#details dd .avatar { width: 16px; height: 16px; flex-basis: 16px; font-size: 7px; }
	#details pre.message { margin: 0 0 12px; padding: 8px; border: 1px solid var(--line); border-radius: 3px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: pre-wrap; }
	#details .files-head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--line); font-size: 11px; color: var(--muted); }
	#details .file { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 11px; cursor: pointer; }
	#details .file:hover { background: var(--hover); }
	#details .file .status { width: 14px; flex: none; text-align: center; font-weight: 700; }
	#details .file .path { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; direction: rtl; text-align: left; }
	#details .file .add { color: var(--green); }
	#details .file .del { color: var(--red); }
	#details .file .open { opacity: 0; }
	#details .file:hover .open { opacity: 1; }

	#popover { position: fixed; z-index: 20; min-width: 208px; padding: 5px; border: 1px solid var(--vscode-widget-border, var(--line)); border-radius: 4px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--fg)); box-shadow: 0 4px 14px rgba(0, 0, 0, .35); font-size: 12px; }
	#popover.hidden { display: none; }
	#popover .group { padding: 4px 8px 2px; color: var(--muted); font-size: 10px; font-weight: 600; letter-spacing: .04em; }
	#popover label.item, #popover button.item { display: flex; width: 100%; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 3px; text-align: left; font-size: 12px; }
	#popover label.item:hover, #popover button.item:hover { background: var(--vscode-menu-selectionBackground, var(--hover)); color: var(--vscode-menu-selectionForeground, inherit); }
	#popover label.item input { margin: 0; }
	#popover .sep { height: 1px; margin: 4px 6px; background: var(--vscode-menu-separatorBackground, var(--line)); }
	#popover .row2 { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 8px; }
	#popover select { padding: 2px 4px; border: 1px solid var(--vscode-dropdown-border, var(--line)); border-radius: 3px; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); font: inherit; font-size: 11px; }
	#menu { position: fixed; z-index: 30; min-width: 220px; padding: 4px; border: 1px solid var(--vscode-menu-border, var(--line)); border-radius: 4px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--fg)); box-shadow: 0 4px 14px rgba(0, 0, 0, .35); font-size: 12px; }
	#menu.hidden { display: none; }
	#menu button { display: flex; width: 100%; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 3px; text-align: left; }
	#menu button:hover { background: var(--vscode-menu-selectionBackground, var(--hover)); }
	#menu .sep { height: 1px; margin: 4px 6px; background: var(--vscode-menu-separatorBackground, var(--line)); }
	#toast { position: fixed; right: 16px; bottom: 16px; z-index: 40; max-width: 60vw; padding: 8px 12px; border: 1px solid var(--vscode-notifications-border); border-radius: 3px; color: var(--vscode-notifications-foreground); background: var(--vscode-notifications-background); opacity: 0; transition: opacity .15s; pointer-events: none; }
	#toast.visible { opacity: 1; }
	.error { color: var(--vscode-errorForeground, #f85149); }
	@media (max-width: 980px) { #details { width: 290px; } .repo-context h1 { max-width: 18vw; } }
	/* The activity bar view is narrow: details become an overlay instead of stealing the list width. */
	@media (max-width: 700px) {
		header { gap: 4px; }
		#details { position: absolute; top: 0; right: 0; bottom: 0; z-index: 6; width: min(340px, 100%); border-left: 1px solid var(--line); background: var(--vscode-sideBar-background); box-shadow: -8px 0 20px rgba(0, 0, 0, .35); }
		#splitter { display: none !important; }
		.repo-context h1 { max-width: none; }
		.search-wrap { width: auto; flex: 1; min-width: 110px; }
	}
	@media (max-width: 560px) {
		.repo-context h1, .repo-icon { display: none; }
		#filterLabel, .search-wrap .count, #prevMatch, #nextMatch, #searchOptions { display: none; }
		.chip { max-width: 120px; }
		.search-wrap { min-width: 72px; padding: 0 6px; }
	}
</style>
</head>
<body>
<header>
	<span class="repo-icon" aria-hidden="true">
		<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="4.5" r="2"/><circle cx="6" cy="15.5" r="2"/><circle cx="14" cy="8.5" r="2"/><path d="M6 6.5v7"/><path d="M8 8.5h4"/></svg>
	</span>
	<div class="repo-context">
		<h1 id="repoName">Commit Graph</h1>
		<button id="branchChip" class="chip" title="Filter the graph by branch or tag">
			<svg viewBox="0 0 20 20" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 3v9a3 3 0 0 0 3 3h7"/><circle cx="5" cy="15" r="2"/><circle cx="15" cy="15" r="2"/></svg>
			<span class="name" id="branchName">HEAD</span>
			<span class="caret">▼</span>
		</button>
		<span class="dirty" id="dirty" style="display:none"></span>
	</div>
	<span class="spacer"></span>
	<div class="search-wrap">
		<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.5 12.5 4 4"/></svg>
		<input id="search" type="search" spellcheck="false" placeholder="Search commits (Ctrl+F)" aria-label="Search commits">
		<span class="count" id="searchCount"></span>
		<button id="prevMatch" class="icon-btn" title="Previous match (Shift+F3)" aria-label="Previous match"><svg viewBox="0 0 20 20"><path d="m5 12 5-5 5 5"/></svg></button>
		<button id="nextMatch" class="icon-btn" title="Next match (F3)" aria-label="Next match"><svg viewBox="0 0 20 20"><path d="m5 8 5 5 5-5"/></svg></button>
		<button id="searchOptions" class="icon-btn" title="Search options" aria-label="Search options"><svg viewBox="0 0 20 20"><circle cx="4" cy="10" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="16" cy="10" r="1"/></svg></button>
	</div>
	<div class="toolbar">
		<button id="filterBtn" class="tb" title="Filter branches and tags">
			<svg viewBox="0 0 20 20"><path d="M3 5h14l-5 6v5l-4 2v-7L3 5Z"/></svg>
			<span id="filterLabel">All branches</span>
		</button>
		<button id="detailsBtn" class="tb" title="Toggle the details panel (Alt+D)" aria-label="Toggle details panel">
			<svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M12 3.5v13"/></svg>
		</button>
		<button id="columnsBtn" class="tb" title="Columns and layout">
			<svg viewBox="0 0 20 20"><rect x="2.5" y="4" width="15" height="12" rx="1.5"/><path d="M8 4v12M13 4v12"/></svg>
		</button>
		<button id="refreshBtn" class="tb" title="Refresh (reload the graph)">
			<svg viewBox="0 0 20 20"><path d="M16 8a6.5 6.5 0 0 0-11-3L3 7"/><path d="M3 3v4h4M4 12a6.5 6.5 0 0 0 11 3l2-2"/><path d="M17 17v-4h-4"/></svg>
		</button>
	</div>
</header>
<div id="main">
	<div id="graphPane">
		<div id="working" role="button" tabindex="0">
			<div class="cell graph" data-col="graph">
				<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="var(--vscode-descriptionForeground)" stroke-width="1.6" stroke-dasharray="3 2"/></svg>
			</div>
			<div class="cell" data-col="refs"><span class="ref working">Working Changes</span></div>
			<div class="cell message" data-col="message"><span class="subject">Working Changes</span><span class="hint" id="workingHint"></span></div>
			<div class="cell" data-col="author"><span class="hint">You</span></div>
			<div class="cell changes" data-col="changes"><span class="none" id="workingCount"></span></div>
			<div class="cell" data-col="date"><span class="hint">now</span></div>
			<div class="cell" data-col="sha"><span class="hint">—</span></div>
			<div class="cell" data-col="committer"><span class="hint">Uncommitted</span></div>
		</div>
		<div id="minimap" class="hidden"><svg id="minimapSvg" viewBox="0 0 1000 34" preserveAspectRatio="none" role="img" aria-label="Commit history minimap"></svg></div>
		<div id="columns">
			<span class="col" data-col="graph" title="Graph"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="6" r="1.5"/><path d="M4 4.5v7M12 7.5v.3a2.7 2.7 0 0 1-2.7 2.7H7.4"/></svg></span>
			<span class="col" data-col="refs"><span>BRANCHES / TAGS</span><span class="grip" data-resize="refs"></span></span>
			<span class="col" data-col="message"><span>MESSAGE</span></span>
			<span class="col" data-col="author"><span>AUTHOR</span><span class="grip" data-resize="author"></span></span>
			<span class="col" data-col="changes" title="Changes"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13V8M6.3 13V4M9.7 13V9M13 13V6"/></svg><span class="grip" data-resize="changes"></span></span>
			<span class="col" data-col="date"><span>DATE</span><span class="grip" data-resize="date"></span></span>
			<span class="col" data-col="sha"><span>SHA</span><span class="grip" data-resize="sha"></span></span>
			<span class="col" data-col="committer"><span>COMMITTER</span><span class="grip" data-resize="committer"></span></span>
		</div>
		<div id="list" tabindex="0"><div id="spacer"></div></div>
		<div id="footer" class="hidden"><button id="more">Load more</button></div>
	</div>
	<div id="splitter" role="separator" aria-label="Resize details panel"></div>
	<div id="details"><div class="empty">Select a commit to see its details.</div></div>
</div>
<div id="popover" class="hidden"></div>
<div id="menu" class="hidden"></div>
<div id="toast"></div>
<script nonce="${scriptNonce}">
(function () {
	const vscode = acquireVsCodeApi();
	const SVG_NS = 'http://www.w3.org/2000/svg';
	const PALETTE = ['#4e9cf5', '#e5534b', '#57ab5a', '#c69026', '#986ee2', '#39c5cf', '#e0823d', '#768390'];
	const ROW_TABLE = 24;
	const ROW_LIST = 44;
	const LANE = 10;
	const COLUMNS = ['refs', 'author', 'committer', 'changes', 'date', 'sha'];
	const DEFAULTS = { refs: true, author: true, committer: false, date: true, sha: true, changes: true, minimap: false, dimMerges: false, details: true, changeMode: 'bar', widths: { refs: 176, author: 136, committer: 120, changes: 56, date: 84, sha: 76 } };

	const ui = loadUi();
	const el = {
		list: document.getElementById('list'),
		spacer: document.getElementById('spacer'),
		details: document.getElementById('details'),
		search: document.getElementById('search'),
		searchCount: document.getElementById('searchCount'),
		more: document.getElementById('more'),
		footer: document.getElementById('footer'),
		repo: document.getElementById('repoName'),
		branch: document.getElementById('branchName'),
		dirty: document.getElementById('dirty'),
		working: document.getElementById('working'),
		workingHint: document.getElementById('workingHint'),
		workingCount: document.getElementById('workingCount'),
		minimap: document.getElementById('minimap'),
		minimapSvg: document.getElementById('minimapSvg'),
		filterLabel: document.getElementById('filterLabel'),
		popover: document.getElementById('popover'),
		menu: document.getElementById('menu'),
		toast: document.getElementById('toast')
	};

	let rows = [];
	let visible = [];
	let selected = null;
	let details = null;
	let working = [];
	let branches = { current: '', local: [], remote: [], tags: [] };
	let graphLanes = 1;
	let ROW = ROW_TABLE;
	let listMode = window.innerWidth < 520;
	let matchCount = 0;
	let renderQueued = false;
	let searchTimer = 0;
	let toastTimer = 0;

	function loadUi() {
		const saved = vscode.getState();
		const ui = JSON.parse(JSON.stringify(DEFAULTS));
		// A narrow activity bar view starts list-first; details stay one Alt+D away.
		if (window.innerWidth <= 700) {
			ui.details = false;
		}
		if (saved && saved.ui) {
			for (const key of Object.keys(DEFAULTS)) {
				if (saved.ui[key] !== undefined) {
					if (key === 'widths') {
						Object.assign(ui.widths, saved.ui.widths);
					} else {
						ui[key] = saved.ui[key];
					}
				}
			}
		}
		return ui;
	}

	function saveUi() {
		const state = vscode.getState() || {};
		state.ui = ui;
		vscode.setState(state);
	}

	function color(index) { return PALETTE[index % PALETTE.length]; }

	function workingGraph() {
		const svg = svgNode('svg', { width: 20, height: Math.max(18, ROW), viewBox: '0 0 20 ' + Math.max(18, ROW), 'aria-hidden': 'true' });
		svg.appendChild(svgNode('circle', {
			cx: 10, cy: Math.max(18, ROW) / 2, r: 4.5,
			fill: 'none', stroke: 'var(--vscode-descriptionForeground)', 'stroke-width': '1.5', 'stroke-dasharray': '2.5 2'
		}));
		return svg;
	}

	function renderWorkingRow() {
		const node = el.working;
		node.replaceChildren();
		const graph = document.createElement('div');
		graph.className = 'cell graph';
		graph.setAttribute('data-col', 'graph');
		graph.appendChild(workingGraph());
		node.appendChild(graph);

		const countText = working.length ? working.length + ' file' + (working.length === 1 ? '' : 's') : 'clean';
		const hintText = working.length ? working.length + ' uncommitted file' + (working.length === 1 ? '' : 's') : 'Working tree clean';

		if (listMode) {
			const content = document.createElement('div');
			content.className = 'list-content';
			const line1 = document.createElement('div');
			line1.className = 'list-line1';
			const subject = document.createElement('span');
			subject.className = 'subject';
			subject.textContent = 'Working Changes';
			const count = document.createElement('span');
			count.id = 'workingCount';
			count.className = 'date';
			count.style.marginLeft = 'auto';
			count.style.fontSize = '10px';
			count.textContent = countText;
			line1.append(subject, count);
			content.appendChild(line1);

			const line2 = document.createElement('div');
			line2.className = 'list-line2';
			const pill = document.createElement('span');
			pill.className = 'ref head';
			pill.textContent = branches.current || 'HEAD';
			const hint = document.createElement('span');
			hint.id = 'workingHint';
			hint.className = 'date';
			hint.textContent = hintText;
			line2.append(pill, hint);
			content.appendChild(line2);
			node.appendChild(content);
		} else {
			const refs = document.createElement('div');
			refs.className = 'cell';
			refs.setAttribute('data-col', 'refs');
			const pill = document.createElement('span');
			pill.className = 'ref head';
			pill.textContent = branches.current || 'HEAD';
			refs.appendChild(pill);
			node.appendChild(refs);

			const message = document.createElement('div');
			message.className = 'cell message';
			message.setAttribute('data-col', 'message');
			const subject = document.createElement('span');
			subject.className = 'subject';
			subject.textContent = 'Working Changes';
			const hint = document.createElement('span');
			hint.id = 'workingHint';
			hint.className = 'hint';
			hint.textContent = hintText;
			message.append(subject, hint);
			node.appendChild(message);

			const author = document.createElement('div');
			author.className = 'cell';
			author.setAttribute('data-col', 'author');
			const you = document.createElement('span');
			you.className = 'meta';
			you.textContent = 'You';
			author.appendChild(you);
			node.appendChild(author);

			const changes = document.createElement('div');
			changes.className = 'cell';
			changes.setAttribute('data-col', 'changes');
			const count = document.createElement('span');
			count.id = 'workingCount';
			count.className = 'none';
			count.textContent = countText;
			changes.appendChild(count);
			node.appendChild(changes);

			const date = document.createElement('div');
			date.className = 'cell';
			date.setAttribute('data-col', 'date');
			const now = document.createElement('span');
			now.className = 'meta';
			now.textContent = 'now';
			date.appendChild(now);
			node.appendChild(date);

			const sha = document.createElement('div');
			sha.className = 'cell';
			sha.setAttribute('data-col', 'sha');
			const dash = document.createElement('span');
			dash.className = 'sha';
			dash.textContent = '—';
			sha.appendChild(dash);
			node.appendChild(sha);

			const committer = document.createElement('div');
			committer.className = 'cell';
			committer.setAttribute('data-col', 'committer');
			const uncommitted = document.createElement('span');
			uncommitted.className = 'meta';
			uncommitted.textContent = 'Uncommitted';
			committer.appendChild(uncommitted);
			node.appendChild(committer);
		}

		el.workingHint = node.querySelector('#workingHint');
		el.workingCount = node.querySelector('#workingCount');
	}

	function applyLayout() {
		const root = document.documentElement.style;
		listMode = window.innerWidth < 520;
		ROW = listMode ? ROW_LIST : ROW_TABLE;
		document.body.classList.toggle('list', listMode);
		root.setProperty('--row-h', ROW + 'px');
		const compact = window.innerWidth <= 700;
		const detailsWidth = ui.details && !compact ? (el.details.getBoundingClientRect().width || 360) : 0;
		const available = Math.max(compact ? 240 : 360, window.innerWidth - detailsWidth - (ui.details && !compact ? 4 : 0) - 16);
		const messageMin = listMode ? 90 : 160;
		const graph = Math.max(26, 16 + graphLanes * LANE);
		const shown = key => !!ui[key];
		let fixed = 0;
		for (const key of COLUMNS) {
			if (shown(key)) { fixed += ui.widths[key]; }
		}
		const scale = fixed + graph + messageMin > available
			? Math.max(0.45, (available - graph - messageMin) / Math.max(1, fixed))
			: 1;

		root.setProperty('--w-graph', graph + 'px');
		for (const key of COLUMNS) {
			root.setProperty('--w-' + key, Math.max(40, Math.round(ui.widths[key] * scale)) + 'px');
		}

		const parts = ['var(--w-graph)'];
		if (!listMode) {
			if (shown('refs')) { parts.push('var(--w-refs)'); }
			parts.push('minmax(' + messageMin + 'px, 1fr)');
			if (shown('author')) { parts.push('var(--w-author)'); }
			if (shown('changes')) { parts.push('var(--w-changes)'); }
			if (shown('date')) { parts.push('var(--w-date)'); }
			if (shown('sha')) { parts.push('var(--w-sha)'); }
			if (shown('committer')) { parts.push('var(--w-committer)'); }
		}
		root.setProperty('--cols', parts.join(' '));

		renderWorkingRow();
		document.querySelectorAll('[data-col]').forEach(node => {
			const key = node.getAttribute('data-col');
			if (key === 'graph' || key === 'message') { return; }
			node.style.display = listMode || shown(key) ? '' : 'none';
		});
		el.minimap.classList.toggle('hidden', !ui.minimap);
		el.details.style.display = ui.details ? '' : 'none';
		document.getElementById('splitter').style.display = ui.details ? '' : 'none';
	}

	function svgNode(name, attributes) {
		const node = document.createElementNS(SVG_NS, name);
		for (const key of Object.keys(attributes)) {
			node.setAttribute(key, attributes[key]);
		}
		return node;
	}

	function laneX(lane) { return 8 + lane * LANE + LANE / 2; }

	function curve(svg, x1, x2, y1, y2, stroke, opacity) {
		const path = svgNode('path', {
			d: 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + (y1 + (y2 - y1) * 0.55) + ', ' + x2 + ' ' + (y1 + (y2 - y1) * 0.45) + ', ' + x2 + ' ' + y2,
			fill: 'none',
			stroke: stroke,
			'stroke-width': '2',
			'stroke-linecap': 'round'
		});
		if (opacity) { path.setAttribute('opacity', opacity); }
		svg.appendChild(path);
		return path;
	}

	function buildGraph(row) {
		const lanes = Math.max(row.before.length, row.after.length, row.lane + 1, 1);
		const width = lanes * LANE + 16;
		const svg = svgNode('svg', { width: width, height: ROW, viewBox: '0 0 ' + width + ' ' + ROW });
		const midY = ROW / 2;

		for (let index = 0; index < row.before.length; index++) {
			const sha = row.before[index];
			if (!sha || sha === row.sha) { continue; }
			if (row.after[index] === sha) {
				svg.appendChild(svgNode('line', {
					x1: laneX(index), y1: 0, x2: laneX(index), y2: ROW,
					stroke: color(index), 'stroke-width': '1.6'
				}));
			} else {
				curve(svg, laneX(index), laneX(index), 0, midY, color(index));
			}
		}

		for (let index = 0; index < row.before.length; index++) {
			if (row.before[index] !== row.sha) { continue; }
			if (index === row.lane) {
				svg.appendChild(svgNode('line', {
					x1: laneX(index), y1: 0, x2: laneX(index), y2: midY,
					stroke: color(index), 'stroke-width': '1.6'
				}));
			} else {
				curve(svg, laneX(index), laneX(row.lane), 0, midY, color(index));
			}
		}

		for (let index = 0; index < row.after.length; index++) {
			const sha = row.after[index];
			if (!sha || row.before.indexOf(sha) === index) { continue; }
			curve(svg, laneX(row.lane), laneX(index), midY, ROW, color(index));
		}

		svg.appendChild(svgNode('circle', {
			cx: laneX(row.lane), cy: midY, r: 6,
			fill: 'var(--vscode-editor-background)'
		}));
		svg.appendChild(svgNode('circle', {
			cx: laneX(row.lane), cy: midY, r: 4.5,
			fill: color(row.lane), stroke: 'var(--vscode-editor-background)', 'stroke-width': '1.5'
		}));
		return svg;
	}

	function initials(name) {
		return (name || '?').trim().split(/[\\s]+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || '?';
	}

	function avatarElement(name, url, small) {
		const avatar = document.createElement('span');
		avatar.className = 'avatar';
		avatar.textContent = initials(name);
		avatar.title = name;
		if (url) {
			const image = document.createElement('img');
			image.src = url;
			image.alt = '';
			image.referrerPolicy = 'no-referrer';
			image.addEventListener('error', () => image.remove(), { once: true });
			avatar.appendChild(image);
		}
		return avatar;
	}

	function changesElement(stats) {
		const wrapper = document.createElement('span');
		wrapper.className = 'changes';
		if (!stats || !stats.files) {
			const none = document.createElement('span');
			none.className = 'none';
			none.textContent = '—';
			wrapper.appendChild(none);
			return wrapper;
		}

		if (ui.changeMode === 'bar' || ui.changeMode === 'bipolar') {
			const total = Math.max(1, stats.additions + stats.deletions);
			const bar = document.createElement('span');
			bar.className = 'statbar';
			const add = document.createElement('span');
			add.className = 'a';
			add.style.width = Math.round((stats.additions / total) * 100) + '%';
			const del = document.createElement('span');
			del.className = 'd';
			del.style.width = Math.round((stats.deletions / total) * 100) + '%';
			bar.append(add, del);
			bar.title = '+' + stats.additions + ' −' + stats.deletions;
			wrapper.appendChild(bar);
		} else if (ui.changeMode === 'squares') {
			const total = stats.additions + stats.deletions;
			const ratio = total === 0 ? 0 : stats.additions / total;
			const squares = document.createElement('span');
			squares.className = 'squares';
			for (let index = 0; index < 5; index++) {
				const square = document.createElement('i');
				square.className = index < Math.round(ratio * 5) ? 'a' : 'd';
				squares.appendChild(square);
			}
			wrapper.appendChild(squares);
		}
		const add = document.createElement('span');
		add.className = 'add';
		add.textContent = '+' + stats.additions;
		const del = document.createElement('span');
		del.className = 'del';
		del.textContent = '−' + stats.deletions;
		if (ui.changeMode === 'numbers') {
			wrapper.append(add, del);
		}
		return wrapper;
	}

	function refIcon(kind) {
		const svg = svgNode('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' });
		const add = (name, attributes) => svg.appendChild(svgNode(name, attributes));
		if (kind === 'remote') {
			add('path', { d: 'M4.3 12.4h7.2a2.6 2.6 0 0 0 .3-5.2 3.6 3.6 0 0 0-6.9-.7 2.9 2.9 0 0 0-.6 5.9z' });
		} else if (kind === 'tag') {
			add('path', { d: 'M2.6 8.3V3.6c0-.6.4-1 1-1h4.7c.3 0 .5.1.7.3l4.2 4.2c.4.4.4 1 0 1.4l-4.1 4.1c-.4.4-1 .4-1.4 0L2.9 9a1 1 0 0 1-.3-.7z' });
			add('circle', { cx: '5.4', cy: '5.4', r: '.9' });
		} else {
			add('circle', { cx: '4.5', cy: '2.8', r: '1.5' });
			add('circle', { cx: '4.5', cy: '13.2', r: '1.5' });
			add('circle', { cx: '11.5', cy: '5.5', r: '1.5' });
			add('path', { d: 'M4.5 4.3v7.4M11.5 7v.4a3 3 0 0 1-3 3H7.2' });
		}
		return svg;
	}

	function refElement(ref, row) {
		const badge = document.createElement('span');
		badge.className = 'ref ' + ref.kind;
		badge.title = ref.text + ' — click to filter the graph';
		badge.appendChild(refIcon(ref.kind));
		const label = document.createElement('span');
		label.className = 'label';
		label.textContent = ref.text;
		badge.appendChild(label);
		badge.addEventListener('click', event => {
			event.stopPropagation();
			vscode.postMessage({ type: 'setRev', rev: ref.text });
		});
		badge.addEventListener('contextmenu', event => {
			event.preventDefault();
			event.stopPropagation();
			vscode.postMessage({ type: 'setRev', rev: ref.text });
		});
		return badge;
	}

	function refsList(row, limit) {
		const wrap = document.createElement('span');
		wrap.className = 'refs';
		const shown = row.refs.slice(0, limit);
		for (const ref of shown) {
			wrap.appendChild(refElement(ref, row));
		}
		if (row.refs.length > shown.length) {
			const more = document.createElement('span');
			more.className = 'ref more';
			more.textContent = '+' + (row.refs.length - shown.length);
			more.title = row.refs.map(ref => ref.text).join(', ');
			wrap.appendChild(more);
		}
		return wrap;
	}

	function refsCell(row) {
		const cell = document.createElement('div');
		cell.className = 'cell refs';
		cell.setAttribute('data-col', 'refs');
		cell.appendChild(refsList(row, 2));
		return cell;
	}

	function icon(name) {
		const svg = svgNode('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' });
		const paths = {
			copy: ['M7 7h9v9H7z', 'M13 7V4H4v9h3'],
			diff: ['M4 3v9a3 3 0 0 0 3 3h9', 'M13 3v9', 'M11 5l2-2 2 2'],
			more: ['M4 10h.01', 'M10 10h.01', 'M16 10h.01'],
			open: ['M8 4H4v12h12v-4', 'M12 3h5v5', 'M17 3l-7 7']
		};
		for (const d of paths[name]) {
			svg.appendChild(svgNode('path', { d: d, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' }));
		}
		return svg;
	}

	function actionButton(name, title, onClick) {
		const button = document.createElement('button');
		button.title = title;
		button.setAttribute('aria-label', title);
		button.appendChild(icon(name));
		button.addEventListener('click', event => {
			event.stopPropagation();
			onClick();
		});
		return button;
	}

	function subjectNode(row) {
		const subject = document.createElement('span');
		subject.className = 'subject';
		if (row.merge) {
			const merge = document.createElement('span');
			merge.className = 'merge';
			merge.textContent = '⑃';
			merge.title = 'Merge commit';
			subject.appendChild(merge);
		}
		subject.appendChild(document.createTextNode(row.subject || '(no subject)'));
		return subject;
	}

	function graphCell(row) {
		const graph = document.createElement('div');
		graph.className = 'cell graph';
		graph.setAttribute('data-col', 'graph');
		graph.appendChild(buildGraph(row));
		return graph;
	}

	function buildRow(row, index) {
		const element = document.createElement('div');
		element.className = 'row' + (listMode ? ' list' : '') + (selected === row.sha ? ' selected' : '') + (row.dim && ui.dimMerges ? ' dim' : '');
		element.style.top = (index * ROW) + 'px';
		element.style.height = ROW + 'px';
		element.setAttribute('role', 'option');
		element.setAttribute('aria-selected', selected === row.sha ? 'true' : 'false');
		element.appendChild(graphCell(row));

		if (listMode) {
			const content = document.createElement('div');
			content.className = 'list-content';

			const line1 = document.createElement('div');
			line1.className = 'list-line1';
			line1.appendChild(subjectNode(row));
			content.appendChild(line1);

			const line2 = document.createElement('div');
			line2.className = 'list-line2';
			if (ui.refs && row.refs.length) {
				line2.appendChild(refsList(row, 2));
			}
			const short = document.createElement('span');
			short.className = 'sha';
			short.textContent = row.short;
			short.title = row.sha;
			const author = document.createElement('span');
			author.className = 'author';
			author.textContent = row.author;
			author.title = row.author + ' <' + row.email + '>';
			const date = document.createElement('span');
			date.className = 'date';
			date.textContent = row.relative;
			date.title = row.date;
			line2.append(short, author, date);
			content.appendChild(line2);
			element.appendChild(content);
		} else {
			if (ui.refs) {
				element.appendChild(refsCell(row));
			}

			const message = document.createElement('div');
			message.className = 'cell message';
			message.setAttribute('data-col', 'message');
			message.appendChild(subjectNode(row));
			element.appendChild(message);

			if (ui.author) {
				const author = document.createElement('div');
				author.className = 'cell';
				author.setAttribute('data-col', 'author');
				author.title = row.author + ' <' + row.email + '>';
				author.appendChild(avatarElement(row.author, row.avatarUrl));
				const name = document.createElement('span');
				name.className = 'name';
				name.textContent = row.author;
				author.appendChild(name);
				element.appendChild(author);
			}

			if (ui.changes) {
				const changes = document.createElement('div');
				changes.className = 'cell';
				changes.setAttribute('data-col', 'changes');
				changes.appendChild(changesElement(row.stats));
				element.appendChild(changes);
			}

			if (ui.date) {
				const date = document.createElement('div');
				date.className = 'cell';
				date.setAttribute('data-col', 'date');
				const value = document.createElement('span');
				value.className = 'meta';
				value.textContent = row.relative;
				value.title = row.date;
				date.appendChild(value);
				element.appendChild(date);
			}

			if (ui.sha) {
				const sha = document.createElement('div');
				sha.className = 'cell';
				sha.setAttribute('data-col', 'sha');
				const value = document.createElement('span');
				value.className = 'sha';
				value.textContent = row.short;
				value.title = row.sha;
				sha.appendChild(value);
				element.appendChild(sha);
			}

			if (ui.committer) {
				const committer = document.createElement('div');
				committer.className = 'cell';
				committer.setAttribute('data-col', 'committer');
				const name = document.createElement('span');
				name.className = 'name meta';
				name.textContent = row.committer;
				name.title = row.committer + ' <' + row.committerEmail + '>';
				committer.appendChild(name);
				element.appendChild(committer);
			}
		}

		const actions = document.createElement('div');
		actions.className = 'row-actions';
		actions.append(
			actionButton('copy', 'Copy commit SHA', () => copy(row.sha, 'Copied ' + row.short)),
			actionButton('diff', 'Open commit changes', () => vscode.postMessage({ type: 'openAllChanges', sha: row.sha })),
			actionButton('more', 'More actions', () => openMenu(row, actions))
		);
		element.appendChild(actions);

		element.addEventListener('click', () => select(row, true));
		element.addEventListener('dblclick', () => vscode.postMessage({ type: 'openAllChanges', sha: row.sha }));
		element.addEventListener('contextmenu', event => {
			event.preventDefault();
			openMenu(row, element, event.clientX, event.clientY);
		});
		return element;
	}

	function render() {
		renderQueued = false;
		applyLayout();
		el.spacer.style.height = (visible.length * ROW) + 'px';
		el.list.querySelectorAll('.row, .empty').forEach(node => node.remove());

		if (visible.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'empty';
			empty.style.padding = '18px';
			empty.style.color = 'var(--vscode-descriptionForeground)';
			empty.textContent = rows.length === 0 ? 'No commits in this repository yet.' : 'No commit matches the filter.';
			el.spacer.appendChild(empty);
			return;
		}

		const start = Math.max(0, Math.floor(el.list.scrollTop / ROW) - 6);
		const end = Math.min(visible.length, Math.ceil((el.list.scrollTop + el.list.clientHeight) / ROW) + 6);
		for (let index = start; index < end; index++) {
			el.spacer.appendChild(buildRow(visible[index], index));
		}
	}

	function queueRender() {
		if (renderQueued) { return; }
		renderQueued = true;
		requestAnimationFrame(render);
	}

	function select(row, scroll) {
		selected = row.sha;
		render();
		vscode.postMessage({ type: 'selectCommit', sha: row.sha });
		if (scroll === false) { return; }
	}

	function copy(text, label) {
		vscode.postMessage({ type: 'copy', text: text, label: label });
	}

	function toast(message) {
		el.toast.textContent = message;
		el.toast.classList.add('visible');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => el.toast.classList.remove('visible'), 1800);
	}

	function openMenu(row, anchor, x, y) {
		const rect = anchor.getBoundingClientRect();
		el.menu.replaceChildren();
		const add = (label, action) => {
			const button = document.createElement('button');
			button.textContent = label;
			button.addEventListener('click', () => {
				hideMenu();
				action();
			});
			el.menu.appendChild(button);
		};
		add('Copy Commit SHA', () => copy(row.sha, 'Copied ' + row.short));
		add('Copy Commit Message', () => copy(row.subject, 'Copied the commit message'));
		el.menu.appendChild(document.createElement('div')).className = 'sep';
		add('Open Commit Changes', () => vscode.postMessage({ type: 'openAllChanges', sha: row.sha }));
		add('Compare with Working Tree', () => vscode.postMessage({ type: 'compareWithWorking', sha: row.sha }));
		el.menu.appendChild(document.createElement('div')).className = 'sep';
		add('Show Details', () => select(row));
		add('Refresh', () => vscode.postMessage({ type: 'refresh' }));

		const left = x === undefined ? rect.right - 220 : x;
		const top = y === undefined ? rect.bottom + 2 : y;
		el.menu.style.left = Math.max(6, left) + 'px';
		el.menu.style.top = Math.min(window.innerHeight - 200, top) + 'px';
		el.menu.classList.remove('hidden');
	}

	function hideMenu() {
		el.menu.classList.add('hidden');
	}

	function closePopover() {
		el.popover.classList.add('hidden');
		el.popover.replaceChildren();
	}

	function openPopover(anchor, build) {
		if (!el.popover.classList.contains('hidden') && el.popover.dataset.anchor === anchor.id) {
			closePopover();
			return;
		}
		el.popover.replaceChildren();
		el.popover.dataset.anchor = anchor.id;
		build(el.popover);
		el.popover.classList.remove('hidden');
		const rect = anchor.getBoundingClientRect();
		const width = el.popover.offsetWidth;
		el.popover.style.left = Math.max(6, Math.min(window.innerWidth - width - 8, rect.right - width)) + 'px';
		el.popover.style.top = (rect.bottom + 4) + 'px';
	}

	function checkboxItem(container, label, checked, onChange) {
		const wrap = document.createElement('label');
		wrap.className = 'item';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = checked;
		input.addEventListener('change', () => onChange(input.checked));
		wrap.append(input, document.createTextNode(label));
		container.appendChild(wrap);
		return input;
	}

	function radioItem(container, label, checked, onChange) {
		const wrap = document.createElement('label');
		wrap.className = 'item';
		const input = document.createElement('input');
		input.type = 'radio';
		input.name = 'scope';
		input.checked = checked;
		input.addEventListener('change', () => onChange());
		wrap.append(input, document.createTextNode(label));
		container.appendChild(wrap);
		return input;
	}

	function groupLabel(container, text) {
		const label = document.createElement('div');
		label.className = 'group';
		label.textContent = text;
		container.appendChild(label);
	}

	function filterText() {
		switch (scope) {
			case 'current': return 'Current branch';
			case 'local': return 'Local branches';
			case 'remote': return 'Remote branches';
			case 'tags': return 'Tags';
			default: return rev ? rev : 'All branches';
		}
	}

	let scope = 'all';
	let rev = '';

	function buildFilterPopover(container) {
		groupLabel(container, 'SHOW COMMITS FROM');
		const options = [
			['all', 'All branches'],
			['current', 'Current branch'],
			['local', 'Local branches'],
			['remote', 'Remote branches'],
			['tags', 'Tags']
		];
		for (const option of options) {
			radioItem(container, option[1], scope === option[0] && !rev, () => {
				scope = option[0];
				rev = '';
				el.filterLabel.textContent = filterText();
				vscode.postMessage({ type: 'setScope', scope: scope });
				closePopover();
			});
		}
		container.appendChild(document.createElement('div')).className = 'sep';
		groupLabel(container, 'GRAPH OPTIONS');
		checkboxItem(container, 'Show minimap', ui.minimap, value => {
			ui.minimap = value;
			saveUi();
			applyLayout();
			drawMinimap();
		});
		checkboxItem(container, 'Dim commits outside the current branch', ui.dimMerges, value => {
			ui.dimMerges = value;
			saveUi();
			render();
		});
	}

	function buildColumnsPopover(container) {
		groupLabel(container, 'COLUMNS');
		const labels = { refs: 'Branch / Tag', author: 'Author', committer: 'Committer', date: 'Date', sha: 'SHA', changes: 'Changes' };
		for (const key of COLUMNS) {
			checkboxItem(container, labels[key], ui[key], value => {
				ui[key] = value;
				saveUi();
				applyLayout();
				render();
			});
		}
		container.appendChild(document.createElement('div')).className = 'sep';
		const row = document.createElement('div');
		row.className = 'row2';
		const label = document.createElement('span');
		label.textContent = 'Changes style';
		const select = document.createElement('select');
		for (const mode of [['bar', 'Bar'], ['numbers', 'Numbers'], ['squares', 'Squares']]) {
			const option = document.createElement('option');
			option.value = mode[0];
			option.textContent = mode[1];
			option.selected = ui.changeMode === mode[0];
			select.appendChild(option);
		}
		select.addEventListener('change', () => {
			ui.changeMode = select.value;
			saveUi();
			render();
		});
		row.append(label, select);
		container.appendChild(row);
		container.appendChild(document.createElement('div')).className = 'sep';
		const reset = document.createElement('button');
		reset.className = 'item';
		reset.textContent = 'Reset layout';
		reset.addEventListener('click', () => {
			const fresh = JSON.parse(JSON.stringify(DEFAULTS));
			for (const key of Object.keys(fresh)) { ui[key] = fresh[key]; }
			saveUi();
			applyLayout();
			closePopover();
			render();
		});
		container.appendChild(reset);
	}

	function buildBranchPopover(container) {
		groupLabel(container, 'FILTER HISTORY');
		const all = document.createElement('button');
		all.className = 'item';
		all.textContent = 'All branches';
		all.addEventListener('click', () => {
			rev = '';
			scope = 'all';
			el.filterLabel.textContent = filterText();
			vscode.postMessage({ type: 'setScope', scope: 'all' });
			closePopover();
		});
		container.appendChild(all);

		const sections = [
			['LOCAL', branches.local],
			['REMOTE', branches.remote],
			['TAGS', branches.tags]
		];
		for (const section of sections) {
			if (!section[1] || section[1].length === 0) { continue; }
			container.appendChild(document.createElement('div')).className = 'sep';
			groupLabel(container, section[0]);
			for (const name of section[1]) {
				const button = document.createElement('button');
				button.className = 'item';
				button.textContent = name;
				button.style.paddingLeft = '16px';
				if (name === branches.current) { button.style.fontWeight = '600'; }
				button.addEventListener('click', () => {
					rev = name;
					el.filterLabel.textContent = filterText();
					vscode.postMessage({ type: 'setRev', rev: name });
					closePopover();
				});
				container.appendChild(button);
			}
		}
	}

	/* ---------- details ---------- */

	function detailAction(label, iconName, onClick) {
		const button = document.createElement('button');
		button.appendChild(icon(iconName));
		button.appendChild(document.createTextNode(label));
		button.addEventListener('click', onClick);
		return button;
	}

	function addDefinition(list, label, valueNode) {
		const dt = document.createElement('dt');
		dt.textContent = label;
		const dd = document.createElement('dd');
		if (typeof valueNode === 'string') {
			dd.textContent = valueNode;
		} else {
			dd.appendChild(valueNode);
		}
		list.append(dt, dd);
	}

	function showCommit(payload) {
		const commit = payload.details;
		details = commit;
		el.details.replaceChildren();

		const title = document.createElement('h2');
		title.textContent = commit.subject || '(no subject)';
		el.details.appendChild(title);

		const shaLine = document.createElement('div');
		shaLine.className = 'sha-line';
		const code = document.createElement('code');
		code.textContent = commit.sha;
		shaLine.appendChild(code);
		el.details.appendChild(shaLine);

		const actions = document.createElement('div');
		actions.className = 'actions';
		actions.append(
			detailAction('Open Changes', 'diff', () => vscode.postMessage({ type: 'openAllChanges', sha: commit.sha })),
			detailAction('Compare Working', 'open', () => vscode.postMessage({ type: 'compareWithWorking', sha: commit.sha })),
			detailAction('Copy SHA', 'copy', () => copy(commit.sha, 'Copied ' + commit.short))
		);
		el.details.appendChild(actions);

		const dl = document.createElement('dl');
		const author = document.createElement('span');
		author.appendChild(avatarElement(commit.author, payload.authorAvatar, true));
		author.appendChild(document.createTextNode(commit.author + ' <' + commit.email + '>'));
		author.title = commit.date;
		addDefinition(dl, 'Author', author);
		const committer = document.createElement('span');
		committer.appendChild(avatarElement(commit.committer, payload.committerAvatar, true));
		committer.appendChild(document.createTextNode(commit.committer + ' <' + commit.committerEmail + '>'));
		committer.title = commit.committerDate;
		addDefinition(dl, 'Committer', committer);
		addDefinition(dl, 'Parents', commit.parents.length ? commit.parents.map(parent => parent.slice(0, 7)).join(', ') : '(root commit)');
		if (commit.refs.length) {
			const refs = document.createElement('span');
			refs.className = 'refs';
			for (const text of commit.refs) {
				const ref = document.createElement('span');
				ref.className = 'ref branch';
				ref.textContent = text;
				refs.appendChild(ref);
			}
			addDefinition(dl, 'Refs', refs);
		}
		el.details.appendChild(dl);

		if (commit.body) {
			const message = document.createElement('pre');
			message.className = 'message';
			message.textContent = commit.body;
			el.details.appendChild(message);
		}

		const stats = payload.stats || { files: payload.files.length, additions: 0, deletions: 0 };
		const head = document.createElement('div');
		head.className = 'files-head';
		const summary = document.createElement('span');
		summary.textContent = stats.files + ' file' + (stats.files === 1 ? '' : 's') + ' changed';
		head.appendChild(summary);
		const add = document.createElement('span');
		add.className = 'add';
		add.textContent = '+' + stats.additions;
		const del = document.createElement('span');
		del.className = 'del';
		del.textContent = '−' + stats.deletions;
		head.append(add, del);
		el.details.appendChild(head);

		const parent = commit.parents.length ? commit.parents[0] : 'EMPTY';
		for (const file of payload.files) {
			el.details.appendChild(fileRow(file, () => vscode.postMessage({ type: 'openFileChanges', sha: commit.sha, path: file.path }), () => vscode.postMessage({ type: 'openFile', sha: commit.sha, path: file.path }), parent));
		}
		el.details.scrollTop = 0;
	}

	function fileRow(file, onOpenChanges, onOpenFile, parent) {
		const element = document.createElement('div');
		element.className = 'file';
		element.title = file.path + ' — click for changes';
		const status = document.createElement('span');
		status.className = 'status';
		status.textContent = statusGlyph(file.status);
		status.style.color = statusColor(file.status);
		const path = document.createElement('span');
		path.className = 'path';
		path.textContent = file.path;
		element.append(status, path);
		if (file.additions !== undefined) {
			const add = document.createElement('span');
			add.className = 'add';
			add.textContent = '+' + file.additions;
			const del = document.createElement('span');
			del.className = 'del';
			del.textContent = '−' + file.deletions;
			element.append(add, del);
		}
		const open = document.createElement('button');
		open.className = 'open icon-btn';
		open.title = 'Open file at this revision';
		open.appendChild(icon('open'));
		open.addEventListener('click', event => {
			event.stopPropagation();
			onOpenFile();
		});
		element.appendChild(open);
		element.addEventListener('click', onOpenChanges);
		return element;
	}

	function statusGlyph(status) {
		switch ((status || 'M').charAt(0)) {
			case 'A': return 'A';
			case 'D': return 'D';
			case 'R': return 'R';
			case '?': return 'U';
			default: return 'M';
		}
	}

	function statusColor(status) {
		if ((status || '').charAt(0) === 'D') { return 'var(--vscode-charts-red, #e06c75)'; }
		if ((status || '').indexOf('?') !== -1 || (status || '').charAt(0) === 'A') { return 'var(--vscode-charts-green, #98c379)'; }
		return 'var(--vscode-charts-yellow, #e5c07b)';
	}

	function showWorking() {
		el.details.replaceChildren();
		const title = document.createElement('h2');
		title.textContent = 'Working Changes';
		el.details.appendChild(title);
		const hint = document.createElement('div');
		hint.className = 'meta';
		hint.textContent = working.length + ' uncommitted file' + (working.length === 1 ? '' : 's');
		hint.style.marginBottom = '10px';
		el.details.appendChild(hint);
		const actions = document.createElement('div');
		actions.className = 'actions';
		actions.append(
			detailAction('Open Changes', 'diff', () => vscode.postMessage({ type: 'openWorkingChanges' })),
			detailAction('Refresh', 'copy', () => vscode.postMessage({ type: 'refresh' }))
		);
		el.details.appendChild(actions);
		for (const file of working) {
			el.details.appendChild(fileRow(
				file,
				() => vscode.postMessage({ type: 'openWorkingFileChanges', path: file.path, status: file.status }),
				() => vscode.postMessage({ type: 'openWorkingFile', path: file.path })
			));
		}
	}

	function showError(message) {
		el.details.replaceChildren();
		const error = document.createElement('div');
		error.className = 'error';
		error.textContent = message;
		el.details.appendChild(error);
	}

	/* ---------- minimap ---------- */

	function drawMinimap() {
		if (!ui.minimap) { return; }
		const svg = el.minimapSvg;
		svg.replaceChildren();
		if (rows.length === 0) { return; }
		const width = 1000;
		const step = rows.length > 1 ? width / (rows.length - 1) : 0;
		const lanes = Math.max(1, graphLanes);
		const laneStep = 24 / lanes;

		rows.forEach((row, index) => {
			const x = index * step;
			const y = 4 + row.lane * laneStep;
			svg.appendChild(svgNode('line', {
				x1: x, y1: y, x2: x, y2: y + laneStep * 0.9,
				stroke: color(row.lane), 'stroke-width': '1.4', opacity: '0.85'
			}));
		});

		rows.forEach((row, index) => {
			if (!row.refs || row.refs.length === 0) { return; }
			const kind = row.refs[0].kind;
			const x = index * step;
			svg.appendChild(svgNode('rect', {
				x: Math.max(0, x - 1.5), y: kind === 'tag' ? 29 : 0, width: 3, height: 4,
				fill: kind === 'tag' ? 'var(--vscode-charts-yellow, #e5c07b)' : kind === 'head' ? 'var(--vscode-charts-green, #98c379)' : kind === 'remote' ? 'var(--vscode-charts-purple, #c678dd)' : 'var(--vscode-charts-blue, #61afef)'
			}));
		});
	}

	el.minimapSvg.addEventListener('click', event => {
		if (visible.length === 0) { return; }
		const rect = el.minimapSvg.getBoundingClientRect();
		const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		el.list.scrollTop = ratio * visible.length * ROW - el.list.clientHeight / 2;
		queueRender();
	});

	/* ---------- events ---------- */

	el.list.addEventListener('scroll', queueRender);
	window.addEventListener('resize', () => {
		const previous = listMode;
		applyLayout();
		if (previous !== listMode) { render(); }
	});
	el.more.addEventListener('click', () => vscode.postMessage({ type: 'loadMore' }));
	document.getElementById('refreshBtn').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
	document.getElementById('filterBtn').addEventListener('click', event => openPopover(event.currentTarget, buildFilterPopover));
	document.getElementById('columnsBtn').addEventListener('click', event => openPopover(event.currentTarget, buildColumnsPopover));
	document.getElementById('detailsBtn').addEventListener('click', () => {
		ui.details = !ui.details;
		saveUi();
		applyLayout();
		render();
	});
	document.getElementById('branchChip').addEventListener('click', event => openPopover(event.currentTarget, buildBranchPopover));
	document.getElementById('searchOptions').addEventListener('click', event => {
		openPopover(event.currentTarget, container => {
			groupLabel(container, 'SEARCH OPTIONS');
			checkboxItem(container, 'Match case', !!searchOptions.matchCase, value => { searchOptions.matchCase = value; postSearch(); });
			checkboxItem(container, 'Whole word', !!searchOptions.wholeWord, value => { searchOptions.wholeWord = value; postSearch(); });
			checkboxItem(container, 'Regular expression', !!searchOptions.regex, value => { searchOptions.regex = value; postSearch(); });
			checkboxItem(container, 'Match all (AND)', !!searchOptions.matchAll, value => { searchOptions.matchAll = value; postSearch(); });
		});
	});

	const searchOptions = { matchCase: false, wholeWord: false, regex: false, matchAll: false };

	function postSearch() {
		vscode.postMessage({ type: 'search', query: el.search.value.trim(), options: searchOptions });
	}

	el.search.addEventListener('input', () => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(postSearch, 120);
	});

	function stepMatch(delta) {
		if (visible.length === 0) { return; }
		let index = visible.findIndex(row => row.sha === selected);
		if (index === -1) {
			index = delta > 0 ? 0 : visible.length - 1;
		} else {
			index = (index + delta + visible.length) % visible.length;
		}
		const row = visible[index];
		select(row);
		el.list.scrollTop = Math.max(0, index * ROW - el.list.clientHeight / 2);
		queueRender();
	}

	document.getElementById('nextMatch').addEventListener('click', () => stepMatch(1));
	document.getElementById('prevMatch').addEventListener('click', () => stepMatch(-1));

	document.addEventListener('keydown', event => {
		const inField = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			el.search.focus();
			el.search.select();
			return;
		}
		if (event.key === 'F3') {
			event.preventDefault();
			stepMatch(event.shiftKey ? -1 : 1);
			return;
		}
		if (event.key === 'Escape') {
			closePopover();
			hideMenu();
			return;
		}
		if (inField) { return; }
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') { return; }
		if (visible.length === 0) { return; }
		event.preventDefault();
		let index = visible.findIndex(row => row.sha === selected);
		index = event.key === 'ArrowDown' ? Math.min(visible.length - 1, index + 1) : Math.max(0, index - 1);
		if (index < 0) { index = 0; }
		select(visible[index]);
		el.list.scrollTop = Math.max(0, index * ROW - el.list.clientHeight / 2);
		queueRender();
	});

	document.addEventListener('mousedown', event => {
		if (!el.popover.contains(event.target) && !event.target.closest('.tb, .chip, .icon-btn')) {
			closePopover();
		}
		if (!el.menu.contains(event.target)) {
			hideMenu();
		}
	});

	el.working.addEventListener('click', () => {
		selected = null;
		render();
		showWorking();
	});
	el.working.addEventListener('keydown', event => {
		if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showWorking(); }
	});

	/* Column resizing */
	let resizing = null;
	document.querySelectorAll('[data-resize]').forEach(grip => {
		grip.addEventListener('mousedown', event => {
			event.preventDefault();
			event.stopPropagation();
			const key = grip.getAttribute('data-resize');
			resizing = { key: key, startX: event.clientX, startWidth: ui.widths[key] };
			document.body.style.cursor = 'col-resize';
		});
	});
	document.addEventListener('mousemove', event => {
		if (!resizing) { return; }
		const width = Math.max(60, resizing.startWidth + (event.clientX - resizing.startX));
		ui.widths[resizing.key] = width;
		applyLayout();
	});
	document.addEventListener('mouseup', () => {
		if (!resizing) { return; }
		resizing = null;
		document.body.style.cursor = '';
		saveUi();
		render();
	});

	/* Details panel splitter */
	let split = null;
	const splitter = document.getElementById('splitter');
	splitter.addEventListener('mousedown', event => {
		event.preventDefault();
		split = { startX: event.clientX, width: el.details.getBoundingClientRect().width };
		document.body.style.cursor = 'col-resize';
	});
	document.addEventListener('mousemove', event => {
		if (!split) { return; }
		const width = Math.max(240, Math.min(window.innerWidth - 420, split.width - (event.clientX - split.startX)));
		el.details.style.width = width + 'px';
		applyLayout();
	});
	document.addEventListener('mouseup', () => {
		if (!split) { return; }
		split = null;
		document.body.style.cursor = '';
		const state = vscode.getState() || {};
		state.detailsWidth = el.details.style.width;
		vscode.setState(state);
	});

	/* ---------- host messages ---------- */

	window.addEventListener('message', event => {
		const message = event.data;
		switch (message.type) {
			case 'commits': {
				rows = message.rows;
				graphLanes = message.lanes || 1;
				branches = message.branches || branches;
				working = message.working || [];
				scope = message.scope || 'all';
				rev = message.rev || '';
				el.repo.textContent = message.repoLabel || 'Commit Graph';
				el.branch.textContent = message.branch || 'HEAD';
				el.dirty.style.display = message.dirtyFiles ? '' : 'none';
				el.dirty.textContent = message.dirtyFiles + ' changed';
				el.dirty.title = message.dirtyFiles + ' changed file' + (message.dirtyFiles === 1 ? '' : 's');
				el.filterLabel.textContent = filterText();
				applyLayout();
				drawMinimap();
				visible = message.rows;
				matchCount = message.matchCount === undefined ? rows.length : message.matchCount;
				el.searchCount.textContent = message.query ? (matchCount === 0 ? 'no results' : '1 of ' + matchCount) : '';
				el.footer.classList.toggle('hidden', !message.hasMore);
				el.workingCount.textContent = working.length ? working.length + ' files' : 'clean';
				el.workingHint.textContent = working.length ? working.length + ' uncommitted file' + (working.length === 1 ? '' : 's') : 'Working tree clean';
				render();
				break;
			}
			case 'filtered': {
				visible = message.rows;
				matchCount = message.matchCount;
				el.searchCount.textContent = message.query ? (matchCount === 0 ? 'no results' : '1 of ' + matchCount) : '';
				if (message.hasMore !== undefined) {
					el.footer.classList.toggle('hidden', !message.hasMore);
				}
				if (message.query && matchCount > 0) {
					const first = visible.find(row => row.sha === selected);
					if (!first) { selected = null; }
				}
				render();
				break;
			}
			case 'commit':
				showCommit(message);
				break;
			case 'toast':
				toast(message.message);
				break;
			case 'error':
				showError(message.message);
				break;
		}
	});

	/* restore the details pane width */
	const restored = vscode.getState();
	if (restored && restored.detailsWidth) {
		el.details.style.width = restored.detailsWidth;
	}
	applyLayout();
	vscode.postMessage({ type: 'ready' });
}());
</script>
</body>
</html>`;
}
