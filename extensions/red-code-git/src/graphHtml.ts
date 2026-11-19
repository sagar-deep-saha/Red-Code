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
	:root { color-scheme: light dark; --w-graph: 86px; --cols: 86px minmax(220px, 1fr) 160px 140px 104px 104px; }
	* { box-sizing: border-box; }
	html, body { height: 100%; }
	body { margin: 0; display: flex; flex-direction: column; overflow: hidden; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
	button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
	svg { display: block; }

	header { display: flex; flex: 0 0 auto; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
	.repo-icon { display: grid; width: 26px; height: 26px; flex: none; place-items: center; border-radius: 6px; color: var(--vscode-charts-blue, #61afef); background: var(--vscode-toolbar-hoverBackground); }
	.repo-context { display: flex; min-width: 0; align-items: center; gap: 8px; }
	.repo-context h1 { margin: 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 32vw; }
	.chip { display: inline-flex; max-width: 240px; align-items: center; gap: 5px; padding: 2px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 11px; color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); font-size: 11px; white-space: nowrap; }
	.chip:hover { background: var(--vscode-button-secondaryHoverBackground); }
	.chip .name { overflow: hidden; text-overflow: ellipsis; }
	.chip .caret { color: var(--vscode-descriptionForeground); font-size: 9px; }
	.dirty { padding: 1px 7px; border-radius: 9px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 10px; }
	.spacer { flex: 1; }
	.search-wrap { display: flex; width: min(38vw, 420px); min-width: 190px; align-items: center; gap: 6px; padding: 0 6px 0 8px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; background: var(--vscode-input-background); }
	.search-wrap:focus-within { border-color: var(--vscode-focusBorder); }
	.search-wrap > svg { width: 14px; height: 14px; flex: none; fill: none; stroke: var(--vscode-descriptionForeground); stroke-width: 1.7; }
	.search-wrap input { width: 100%; min-width: 0; padding: 4px 0; border: 0; outline: 0; color: var(--vscode-input-foreground); background: transparent; font: inherit; }
	.search-wrap input::placeholder { color: var(--vscode-input-placeholderForeground); }
	.search-wrap .count { flex: none; color: var(--vscode-descriptionForeground); font-size: 10px; white-space: nowrap; }
	.icon-btn { display: grid; width: 24px; height: 22px; flex: none; place-items: center; border-radius: 3px; color: var(--vscode-foreground); }
	.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
	.icon-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; }
	.toolbar { display: flex; flex: none; align-items: center; gap: 4px; }
	.tb { display: inline-flex; height: 26px; align-items: center; gap: 6px; padding: 0 8px; border: 1px solid transparent; border-radius: 4px; color: var(--vscode-foreground); background: transparent; font-size: 12px; white-space: nowrap; }
	.tb:hover { background: var(--vscode-toolbar-hoverBackground); }
	.tb svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; }
	.tb.active { border-color: var(--vscode-focusBorder); }
	.badge-count { padding: 0 5px; border-radius: 8px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 10px; }

	#main { flex: 1; display: flex; min-height: 0; }
	#graphPane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	#working { display: grid; flex: none; grid-template-columns: var(--cols); height: 34px; align-items: center; gap: 0; padding: 0 8px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); cursor: pointer; }
	#working:hover { background: var(--vscode-list-hoverBackground); }
	#working .msg { display: flex; min-width: 0; align-items: center; gap: 8px; font-weight: 600; }
	#working .msg .hint { font-weight: 400; font-size: 11px; }
	#minimap { display: flex; flex: none; height: 42px; align-items: center; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
	#minimap svg { width: 100%; height: 34px; }
	#minimap.hidden { display: none; }
	#columns { display: grid; flex: none; grid-template-columns: var(--cols); height: 26px; align-items: center; padding: 0 8px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; letter-spacing: .04em; user-select: none; }
	#columns .col { position: relative; display: flex; height: 100%; align-items: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	#columns .col .grip { position: absolute; top: 0; right: -3px; width: 6px; height: 100%; cursor: col-resize; }
	#columns .col .grip:hover { background: var(--vscode-focusBorder); }
	#list { position: relative; flex: 1; overflow: auto; }
	#spacer { position: relative; }
	.row { position: absolute; left: 0; right: 0; display: grid; grid-template-columns: var(--cols); height: 34px; align-items: center; gap: 0; padding: 0 8px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent); cursor: pointer; }
	.row:hover { background: var(--vscode-list-hoverBackground); }
	.row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
	.row.dim { opacity: .55; }
	.row.selected .meta, .row.selected .hint { color: inherit; opacity: .85; }
	.cell { display: flex; min-width: 0; align-items: center; gap: 6px; overflow: hidden; }
	.cell.graph { overflow: hidden; }
	.refs { display: inline-flex; min-width: 0; gap: 4px; overflow: hidden; }
	.ref { display: inline-flex; max-width: 132px; align-items: center; gap: 3px; padding: 0 6px; border: 1px solid; border-radius: 3px; font-size: 10px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.ref .glyph { font-size: 9px; opacity: .9; }
	.ref.branch { color: var(--vscode-charts-blue, #61afef); border-color: var(--vscode-charts-blue, #61afef); background: var(--vscode-charts-blue, #61afef); background: color-mix(in srgb, var(--vscode-charts-blue, #61afef) 12%, transparent); }
	.ref.remote { color: var(--vscode-charts-purple, #c678dd); border-color: var(--vscode-charts-purple, #c678dd); background: color-mix(in srgb, var(--vscode-charts-purple, #c678dd) 12%, transparent); }
	.ref.tag { color: var(--vscode-charts-yellow, #e5c07b); border-color: var(--vscode-charts-yellow, #e5c07b); background: color-mix(in srgb, var(--vscode-charts-yellow, #e5c07b) 12%, transparent); }
	.ref.head { color: var(--vscode-charts-green, #98c379); border-color: var(--vscode-charts-green, #98c379); background: color-mix(in srgb, var(--vscode-charts-green, #98c379) 12%, transparent); }
	.ref.working { color: var(--vscode-descriptionForeground); border-color: var(--vscode-panel-border); border-style: dashed; background: transparent; }
	.message { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
	.message .subject { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.message .subject .merge { color: var(--vscode-charts-purple, #c678dd); font-size: 10px; margin-right: 4px; }
	.avatar { position: relative; display: grid; width: 20px; height: 20px; flex: 0 0 20px; place-items: center; overflow: hidden; border-radius: 50%; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 8px; font-weight: 600; }
	.avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
	.sha { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); }
	.changes { display: flex; align-items: center; gap: 5px; font-size: 11px; font-family: var(--vscode-editor-font-family); }
	.changes .add { color: var(--vscode-charts-green, #98c379); }
	.changes .del { color: var(--vscode-charts-red, #e06c75); }
	.changes .none { color: var(--vscode-descriptionForeground); }
	.statbar { display: flex; width: 100%; max-width: 92px; height: 6px; gap: 2px; overflow: hidden; border-radius: 2px; }
	.statbar .a { background: var(--vscode-charts-green, #98c379); }
	.statbar .d { background: var(--vscode-charts-red, #e06c75); }
	.squares { display: flex; gap: 2px; }
	.squares i { width: 7px; height: 7px; border-radius: 1px; background: var(--vscode-panel-border); }
	.squares i.a { background: var(--vscode-charts-green, #98c379); }
	.squares i.d { background: var(--vscode-charts-red, #e06c75); }
	.row-actions { position: absolute; right: 8px; top: 0; bottom: 0; display: none; align-items: center; gap: 2px; padding-left: 18px; background: linear-gradient(to right, transparent, var(--vscode-list-hoverBackground) 18px); }
	.row:hover .row-actions { display: flex; }
	.row.selected .row-actions { background: linear-gradient(to right, transparent, var(--vscode-list-activeSelectionBackground) 18px); }
	.row-actions button { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 3px; }
	.row-actions button:hover { background: var(--vscode-toolbar-hoverBackground); }
	.row-actions svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; }
	#footer { display: flex; flex: none; justify-content: center; padding: 7px 12px; border-top: 1px solid var(--vscode-panel-border); }
	#footer button { padding: 4px 14px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font-size: 12px; }
	#footer button:hover { background: var(--vscode-button-secondaryHoverBackground); }
	#footer.hidden { display: none; }

	#splitter { width: 4px; flex: none; cursor: col-resize; background: transparent; }
	#splitter:hover { background: var(--vscode-focusBorder); }
	#details { width: 360px; min-width: 240px; flex: none; overflow: auto; padding: 10px 12px 16px; border-left: 1px solid var(--vscode-panel-border); }
	#details .empty { color: var(--vscode-descriptionForeground); font-size: 12px; padding-top: 6px; }
	#details h2 { margin: 2px 0 6px; font-size: 14px; font-weight: 600; word-break: break-word; }
	#details .sha-line { display: flex; align-items: center; gap: 6px; }
	#details .sha-line code { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); user-select: text; overflow: hidden; text-overflow: ellipsis; }
	#details .actions { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0 12px; }
	#details .actions button { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); border-radius: 3px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font-size: 11px; }
	#details .actions button:hover { background: var(--vscode-button-secondaryHoverBackground); }
	#details .actions svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.6; }
	#details dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; margin: 0 0 12px; font-size: 11px; }
	#details dt { color: var(--vscode-descriptionForeground); }
	#details dd { display: flex; min-width: 0; align-items: center; gap: 6px; margin: 0; overflow: hidden; word-break: break-word; }
	#details dd .avatar { width: 16px; height: 16px; flex-basis: 16px; font-size: 7px; }
	#details pre.message { margin: 0 0 12px; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: pre-wrap; }
	#details .files-head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 11px; color: var(--vscode-descriptionForeground); }
	#details .file { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 11px; cursor: pointer; }
	#details .file:hover { background: var(--vscode-list-hoverBackground); }
	#details .file .status { width: 14px; flex: none; text-align: center; font-weight: 700; }
	#details .file .path { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; direction: rtl; text-align: left; }
	#details .file .add { color: var(--vscode-charts-green, #98c379); }
	#details .file .del { color: var(--vscode-charts-red, #e06c75); }
	#details .file .open { opacity: 0; }
	#details .file:hover .open { opacity: 1; }

	#popover { position: fixed; z-index: 20; min-width: 208px; padding: 6px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--vscode-foreground)); box-shadow: 0 4px 14px rgba(0, 0, 0, .35); font-size: 12px; }
	#popover.hidden { display: none; }
	#popover .group { padding: 4px 8px 2px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; letter-spacing: .04em; }
	#popover label.item, #popover button.item { display: flex; width: 100%; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 3px; text-align: left; font-size: 12px; }
	#popover label.item:hover, #popover button.item:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-menu-selectionForeground, inherit); }
	#popover label.item input { margin: 0; }
	#popover .sep { height: 1px; margin: 4px 6px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); }
	#popover .row2 { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 8px; }
	#popover select { padding: 2px 4px; border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border)); border-radius: 3px; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); font: inherit; font-size: 11px; }
	#menu { position: fixed; z-index: 30; min-width: 220px; padding: 4px; border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); border-radius: 5px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); color: var(--vscode-menu-foreground, var(--vscode-foreground)); box-shadow: 0 4px 14px rgba(0, 0, 0, .35); font-size: 12px; }
	#menu.hidden { display: none; }
	#menu button { display: flex; width: 100%; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 3px; text-align: left; }
	#menu button:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); }
	#menu .sep { height: 1px; margin: 4px 6px; background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border)); }
	#toast { position: fixed; right: 16px; bottom: 16px; z-index: 40; max-width: 60vw; padding: 8px 12px; border: 1px solid var(--vscode-notifications-border); border-radius: 3px; color: var(--vscode-notifications-foreground); background: var(--vscode-notifications-background); opacity: 0; transition: opacity .15s; pointer-events: none; }
	#toast.visible { opacity: 1; }
	.error { color: var(--vscode-errorForeground, #f85149); }
	@media (max-width: 980px) { #details { width: 290px; } .repo-context h1 { max-width: 18vw; } }
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
			<div class="cell" data-col="refs"><span class="ref working"><span class="glyph">◆</span>Working Changes</span></div>
			<div class="cell message" data-col="message"><span class="subject">Working Changes</span><span class="hint" id="workingHint"></span></div>
			<div class="cell" data-col="author"><span class="hint">You</span></div>
			<div class="cell" data-col="committer"><span class="hint">Uncommitted</span></div>
			<div class="cell" data-col="date"><span class="hint">now</span></div>
			<div class="cell" data-col="sha"><span class="hint">—</span></div>
			<div class="cell changes" data-col="changes"><span class="none" id="workingCount"></span></div>
		</div>
		<div id="minimap"><svg id="minimapSvg" viewBox="0 0 1000 34" preserveAspectRatio="none" role="img" aria-label="Commit history minimap"></svg></div>
		<div id="columns">
			<span class="col" data-col="graph"><span>GRAPH</span></span>
			<span class="col" data-col="refs"><span>BRANCH / TAG</span><span class="grip" data-resize="refs"></span></span>
			<span class="col" data-col="message"><span>COMMIT MESSAGE</span></span>
			<span class="col" data-col="author"><span>AUTHOR</span><span class="grip" data-resize="author"></span></span>
			<span class="col" data-col="committer"><span>COMMITTER</span><span class="grip" data-resize="committer"></span></span>
			<span class="col" data-col="date"><span>DATE</span><span class="grip" data-resize="date"></span></span>
			<span class="col" data-col="sha"><span>SHA</span><span class="grip" data-resize="sha"></span></span>
			<span class="col" data-col="changes"><span>CHANGES</span><span class="grip" data-resize="changes"></span></span>
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
	const PALETTE = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#d19a66', '#7f848e'];
	const ROW = 34;
	const LANE = 14;
	const COLUMNS = ['refs', 'author', 'committer', 'date', 'sha', 'changes'];
	const DEFAULTS = { refs: true, author: true, committer: true, date: true, sha: false, changes: true, minimap: true, dimMerges: true, details: true, changeMode: 'bar', widths: { refs: 150, author: 160, committer: 140, date: 104, sha: 84, changes: 104 } };

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
	let matchCount = 0;
	let renderQueued = false;
	let searchTimer = 0;
	let toastTimer = 0;

	function loadUi() {
		const saved = vscode.getState();
		const ui = JSON.parse(JSON.stringify(DEFAULTS));
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

	function applyLayout() {
		const root = document.documentElement.style;
		const detailsWidth = ui.details ? (el.details.getBoundingClientRect().width || 360) : 0;
		const available = Math.max(360, window.innerWidth - detailsWidth - (ui.details ? 4 : 0) - 24);
		const messageMin = 180;
		const graph = Math.max(64, graphLanes * LANE + 12);
		let otherFixed = 0;
		for (const key of COLUMNS) {
			if (ui[key]) { otherFixed += ui.widths[key]; }
		}
		const scale = otherFixed + graph + messageMin > available
			? Math.max(0.5, (available - graph - messageMin) / Math.max(1, otherFixed))
			: 1;

		root.setProperty('--w-graph', graph + 'px');
		for (const key of COLUMNS) {
			root.setProperty('--w-' + key, Math.max(44, Math.round(ui.widths[key] * scale)) + 'px');
		}

		const parts = ['var(--w-graph)'];
		if (ui.refs) { parts.push('var(--w-refs)'); }
		parts.push('minmax(' + messageMin + 'px, 1fr)');
		if (ui.author) { parts.push('var(--w-author)'); }
		if (ui.committer) { parts.push('var(--w-committer)'); }
		if (ui.date) { parts.push('var(--w-date)'); }
		if (ui.sha) { parts.push('var(--w-sha)'); }
		if (ui.changes) { parts.push('var(--w-changes)'); }
		root.setProperty('--cols', parts.join(' '));

		document.querySelectorAll('[data-col]').forEach(node => {
			const key = node.getAttribute('data-col');
			if (key === 'graph' || key === 'message') { return; }
			node.style.display = ui[key] ? '' : 'none';
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

	function laneX(lane) { return lane * LANE + 8; }

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
		const width = lanes * LANE + 12;
		const svg = svgNode('svg', { width: width, height: ROW, viewBox: '0 0 ' + width + ' ' + ROW });
		const midY = ROW / 2;

		for (let index = 0; index < row.before.length; index++) {
			const sha = row.before[index];
			if (!sha || sha === row.sha) { continue; }
			if (row.after[index] === sha) {
				svg.appendChild(svgNode('line', {
					x1: laneX(index), y1: 0, x2: laneX(index), y2: ROW,
					stroke: color(index), 'stroke-width': '2'
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
					stroke: color(index), 'stroke-width': '2'
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

		const halo = svgNode('circle', {
			cx: laneX(row.lane), cy: midY, r: 5.5,
			fill: 'var(--vscode-editor-background)'
		});
		svg.appendChild(halo);
		svg.appendChild(svgNode('circle', {
			cx: laneX(row.lane), cy: midY, r: 4,
			fill: color(row.lane), stroke: 'var(--vscode-editor-background)', 'stroke-width': '1'
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

	function refElement(ref, row) {
		const badge = document.createElement('span');
		badge.className = 'ref ' + ref.kind;
		badge.title = ref.text + ' — click to filter the graph';
		const glyph = document.createElement('span');
		glyph.className = 'glyph';
		glyph.textContent = ref.kind === 'tag' ? '⌂' : ref.kind === 'remote' ? '☁' : '⑂';
		badge.append(glyph, document.createTextNode(ref.text));
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

	function refsCell(row) {
		const cell = document.createElement('div');
		cell.className = 'cell refs';
		cell.setAttribute('data-col', 'refs');
		const wrap = document.createElement('span');
		wrap.className = 'refs';
		for (const ref of row.refs.slice(0, 3)) {
			wrap.appendChild(refElement(ref, row));
		}
		cell.appendChild(wrap);
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

	function buildRow(row, index) {
		const element = document.createElement('div');
		element.className = 'row' + (selected === row.sha ? ' selected' : '') + (row.dim && ui.dimMerges ? ' dim' : '');
		element.style.top = (index * ROW) + 'px';
		element.setAttribute('role', 'option');
		element.setAttribute('aria-selected', selected === row.sha ? 'true' : 'false');

		const graph = document.createElement('div');
		graph.className = 'cell graph';
		graph.setAttribute('data-col', 'graph');
		graph.appendChild(buildGraph(row));
		element.appendChild(graph);

		if (ui.refs) {
			element.appendChild(refsCell(row));
		}

		const message = document.createElement('div');
		message.className = 'cell message';
		message.setAttribute('data-col', 'message');
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
		message.appendChild(subject);
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

		if (ui.changes) {
			const changes = document.createElement('div');
			changes.className = 'cell';
			changes.setAttribute('data-col', 'changes');
			changes.appendChild(changesElement(row.stats));
			element.appendChild(changes);
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
	window.addEventListener('resize', () => applyLayout());
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
