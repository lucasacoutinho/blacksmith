import * as vscode from 'vscode';
import { pipe, Match } from 'effect';
import { parseCallgrindFile } from '../parser';
import type { ExtensionMessage, WebviewMessage, ParseProgress, DiffResult } from '../types';
import { deserializeProfileData, serializeProfileData, FunctionId } from '../types';
import { computeDiff } from '../diff';
import { ProfileCache } from '../cache';
import { ProfileContext } from '../profileContext';
import { LineViewDecorations } from '../lineView';

export class ProfileEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'blacksmith.profile';

  private readonly _extensionUri: vscode.Uri;
  private readonly _cache: ProfileCache;
  private readonly _profileContext: ProfileContext;
  private readonly _lineView: LineViewDecorations;
  private _onHotspotsChanged: (() => void) | null = null;
  private _activeWebview: vscode.Webview | null = null;
  private _activeFilename: string = '';

  constructor(context: vscode.ExtensionContext, cache: ProfileCache) {
    this._extensionUri = context.extensionUri;
    this._cache = cache;
    this._profileContext = new ProfileContext();
    this._lineView = new LineViewDecorations(this._profileContext);
  }

  get profileContext(): ProfileContext {
    return this._profileContext;
  }

  get lineView(): LineViewDecorations {
    return this._lineView;
  }

  set onHotspotsChanged(callback: (() => void) | null) {
    this._onHotspotsChanged = callback;
  }

  public static register(context: vscode.ExtensionContext, cache: ProfileCache): { disposable: vscode.Disposable; provider: ProfileEditorProvider } {
    const provider = new ProfileEditorProvider(context, cache);
    const editorRegistration = vscode.window.registerCustomEditorProvider(
      ProfileEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );

    const lineViewDisposables = provider._registerLineView();
    const disposable = vscode.Disposable.from(editorRegistration, ...lineViewDisposables);
    return { disposable, provider };
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')],
    };

    webviewPanel.webview.html = this._getHtmlForWebview(webviewPanel.webview);

    const filePath = document.uri.fsPath;
    const filename = filePath.split('/').pop() || filePath;

    this._activeWebview = webviewPanel.webview;
    this._activeFilename = filename;

    webviewPanel.onDidDispose(() => {
      if (this._activeWebview === webviewPanel.webview) {
        this._activeWebview = null;
        this._activeFilename = '';
      }
    });

    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) =>
      pipe(
        Match.value(message),
        Match.when({ type: 'ready' }, () => this._loadProfile(webviewPanel.webview, filePath, filename)),
        Match.when({ type: 'openFile' }, (m) => this._openFile(m.path, m.line)),
        Match.when({ type: 'requestData' }, () => this._loadProfile(webviewPanel.webview, filePath, filename)),
        Match.when({ type: 'setMetricIndex' }, (m) => {
          this._profileContext.setActiveMetricIndex(m.index);
          this._lineView.refresh();
          this._onHotspotsChanged?.();
        }),
        Match.when({ type: 'selectFunction' }, (m) => {
          const id = m.id === null ? null : FunctionId(m.id);
          this._lineView.setHotPathStartId(id);
        }),
        Match.when({ type: 'clearDiff' }, () => {}),
        Match.when({ type: 'export' }, (m) => this._handleExport(m.format, m.content)),
        Match.exhaustive
      )
    );
  }

  async compareProfile(): Promise<void> {
    if (!this._activeWebview) {
      vscode.window.showWarningMessage('Blacksmith: Open a profile first before comparing.');
      return;
    }

    const profileData = this._profileContext.data;
    if (!profileData) {
      vscode.window.showWarningMessage('Blacksmith: No profile data loaded to compare against.');
      return;
    }

    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        'Callgrind Files': ['callgrind', 'cachegrind', 'out'],
        'All Files': ['*'],
      },
      title: 'Select Profile to Compare With',
    });

    if (!uris?.[0]) return;

    const filePathB = uris[0].fsPath;
    const filenameB = filePathB.split('/').pop() || filePathB;

    try {
      const dataB = await parseCallgrindFile(filePathB);

      const metricIndex = this._profileContext.activeMetricIndex;
      const eventTypes = profileData.eventTypes;
      const metricName = eventTypes[metricIndex] ?? 'Time';

      const statsA = Array.from(profileData.stats.values());
      const statsB = Array.from(dataB.stats.values());

      const totalCostA = profileData.totalCosts?.[metricIndex] ?? profileData.totalCost;
      const totalCostB = dataB.totalCosts?.[metricIndex] ?? dataB.totalCost;

      const diff: DiffResult = computeDiff(
        statsA, statsB, metricIndex, metricName,
        this._activeFilename, filenameB,
        totalCostA, totalCostB,
      );

      this._postMessage(this._activeWebview, { type: 'diffData', diff });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to parse comparison profile: ${message}`);
    }
  }

  private async _loadProfile(
    webview: vscode.Webview,
    filePath: string,
    filename: string
  ): Promise<void> {
    this._postMessage(webview, { type: 'loading', filename });

    try {
      const cached = await this._cache.get(filePath);
      if (cached) {
        this._profileContext.setProfileData(deserializeProfileData(cached));
        this._lineView.updateProfile();
        this._onHotspotsChanged?.();
        this._postMessage(webview, { type: 'data', data: cached });
        return;
      }

      const data = await parseCallgrindFile(filePath, (progress: ParseProgress) => {
        this._postMessage(webview, { type: 'progress', progress });
      });

      this._profileContext.setProfileData(data);
      this._lineView.updateProfile();
      this._onHotspotsChanged?.();
      const serialized = serializeProfileData(data);
      await this._cache.set(filePath, serialized);

      this._postMessage(webview, { type: 'data', data: serialized });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this._postMessage(webview, { type: 'error', message });
      vscode.window.showErrorMessage(`Failed to parse profile: ${message}`);
    }
  }

  private _postMessage(webview: vscode.Webview, message: ExtensionMessage): void {
    webview.postMessage(message);
  }

  private _registerLineView(): vscode.Disposable[] {
    return [
      this._lineView,
      vscode.window.onDidChangeVisibleTextEditors(() => this._lineView.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this._lineView.refresh()),
      vscode.workspace.onDidCloseTextDocument(() => this._lineView.refresh()),
      vscode.commands.registerCommand('blacksmith.toggleLineView', () => {
        const enabled = this._lineView.toggle();
        const status = enabled ? 'enabled' : 'disabled';
        vscode.window.showInformationMessage(`Blacksmith: Line view ${status}`);
      }),
      vscode.commands.registerCommand('blacksmith.toggleHotPathOverlay', () => {
        const enabled = this._lineView.toggleHotPath();
        const status = enabled ? 'enabled' : 'disabled';
        vscode.window.showInformationMessage(`Blacksmith: Hot path overlay ${status}`);
      }),
    ];
  }

  private async _handleExport(format: 'csv' | 'json', content: string): Promise<void> {
    const ext = format === 'csv' ? 'csv' : 'json';
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`profile.${ext}`),
      filters: format === 'csv'
        ? { 'CSV Files': ['csv'], 'All Files': ['*'] }
        : { 'JSON Files': ['json'], 'All Files': ['*'] },
      title: `Export Profile as ${format.toUpperCase()}`,
    });

    if (uri) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
      vscode.window.showInformationMessage(`Blacksmith: Profile exported to ${uri.fsPath}`);
    }
  }

  private async _openFile(path: string, line: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(path);
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
      });

      if (line > 0) {
        const position = new vscode.Position(line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter
        );
      }
    } catch (error) {
      vscode.window.showWarningMessage(`Could not open file: ${path}`);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Blacksmith</title>
  <style>
    :root {
      --vscode-font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }

    #root {
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      padding: 8px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .header h1 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }

    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .tab {
      padding: 8px 16px;
      cursor: pointer;
      border: none;
      background: none;
      color: var(--vscode-foreground);
      opacity: 0.7;
      border-bottom: 2px solid transparent;
    }

    .tab:hover {
      opacity: 1;
    }

    .tab.active {
      opacity: 1;
      border-bottom-color: var(--vscode-focusBorder);
    }

    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }

    .content {
      flex: 1;
      overflow: hidden;
    }

    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
    }

    .loading-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--vscode-panel-border);
      border-top-color: var(--vscode-focusBorder);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .progress-bar {
      width: 200px;
      height: 4px;
      background: var(--vscode-panel-border);
      border-radius: 2px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: var(--vscode-focusBorder);
      transition: width 0.1s ease;
    }

    .error {
      color: var(--vscode-errorForeground);
      padding: 16px;
    }

    .table-container {
      height: 100%;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* Virtual table styles */
    .virtual-header {
      display: flex;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
      font-weight: 600;
    }

    .virtual-header .virtual-cell {
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
    }

    .virtual-header .virtual-cell:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .virtual-header .sorted::after {
      content: ' ▼';
    }

    .virtual-header .sorted.asc::after {
      content: ' ▲';
    }

    .virtual-row {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
    }

    .virtual-row:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .virtual-cell {
      padding: 4px 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
    }

    .virtual-cell:nth-child(1) { flex: 2; min-width: 200px; }
    .virtual-cell:nth-child(2) { flex: 1.5; min-width: 150px; }
    .virtual-cell:nth-child(3) { width: 80px; flex-shrink: 0; }
    .virtual-cell:nth-child(4) { width: 80px; flex-shrink: 0; }
    .virtual-cell:nth-child(5) { width: 70px; flex-shrink: 0; }
    .virtual-cell:nth-child(6) { width: 70px; flex-shrink: 0; }
    .virtual-cell:nth-child(7) { width: 100px; flex-shrink: 0; }

    .function-name {
      color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
      cursor: pointer;
    }

    .function-name:hover {
      text-decoration: underline;
    }

    .file-path {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      max-width: 300px;
    }

    .file-path:hover {
      text-decoration: underline;
    }

    .number {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .percent {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .bar-cell {
      width: 100px;
    }

    .bar {
      height: 12px;
      background: var(--vscode-charts-blue, #4a9cd6);
      border-radius: 2px;
    }

    .search-box {
      padding: 4px 8px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      width: 200px;
    }

    .search-box:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }

    .stats {
      font-size: 11px;
      opacity: 0.7;
    }

    .keyboard-hint {
      font-size: 14px;
      opacity: 0.5;
      cursor: help;
      margin-left: auto;
    }

    .keyboard-hint:hover {
      opacity: 1;
    }

    /* Metric selector */
    .metric-selector {
      padding: 4px 8px;
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border);
      color: var(--vscode-dropdown-foreground);
      border-radius: 4px;
      cursor: pointer;
    }

    .metric-selector:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }

    /* Call Graph styles */
    .callgraph-container {
      height: 100%;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .callgraph-nav {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }

    .callgraph-back {
      padding: 4px 12px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }

    .callgraph-back:hover:not(:disabled) {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .callgraph-back:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .callgraph-breadcrumb {
      font-size: 11px;
      opacity: 0.7;
      margin-left: auto;
    }

    .callgraph-section {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 8px;
      padding: 12px;
    }

    .callgraph-section h3 {
      margin: 0 0 8px 0;
      font-size: 12px;
      opacity: 0.8;
    }

    .callgraph-hint {
      margin: 0;
      font-size: 12px;
      opacity: 0.6;
    }

    .callgraph-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .callgraph-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 8px;
      border-radius: 4px;
    }

    .callgraph-item.clickable {
      cursor: pointer;
    }

    .callgraph-item.clickable:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .callgraph-item .function-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .callgraph-calls {
      font-size: 11px;
      opacity: 0.7;
      min-width: 40px;
      text-align: right;
    }

    .callgraph-cost {
      font-size: 11px;
      min-width: 60px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .callgraph-percent {
      font-size: 11px;
      opacity: 0.7;
      min-width: 50px;
      text-align: right;
    }

    .callgraph-empty {
      font-size: 12px;
      opacity: 0.5;
      font-style: italic;
    }

    /* SVG-based Call Graph styles */
    .callgraph-svg {
      width: 100%;
      flex: 1;
      min-height: 0;
    }

    .callgraph-edge {
      stroke: var(--vscode-charts-lines, #888);
      stroke-opacity: 0.6;
    }

    .callgraph-node {
      cursor: pointer;
    }

    .callgraph-node.clickable:hover rect {
      filter: brightness(1.2);
    }

    .callgraph-node.selected rect {
      filter: brightness(1.1);
    }

    .callgraph-node-rect {
      stroke: rgba(0, 0, 0, 0.3);
      stroke-width: 1;
      transition: filter 0.15s ease;
    }

    .callgraph-node-rect.selected {
      stroke: var(--vscode-focusBorder);
      stroke-width: 2;
    }

    .callgraph-node-name {
      fill: #fff;
      font-size: 11px;
      text-anchor: middle;
      font-weight: 600;
      pointer-events: none;
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }

    .callgraph-node-name.selected {
      fill: #fff;
    }

    .callgraph-node-cost {
      fill: rgba(255, 255, 255, 0.85);
      font-size: 10px;
      text-anchor: middle;
      pointer-events: none;
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }

    .callgraph-more {
      font-size: 11px;
      opacity: 0.6;
      margin-left: 8px;
    }

    /* Caller Map (Treemap) styles */
    .callermap-container {
      height: 100%;
      overflow: hidden;
      position: relative;
    }

    .callermap-svg {
      position: absolute;
      top: 0;
      left: 0;
    }

    .callermap-rect {
      cursor: pointer;
    }

    .callermap-rect:hover .callermap-rect-bg {
      filter: brightness(1.2);
    }

    .callermap-rect.selected .callermap-rect-bg {
      stroke: var(--vscode-focusBorder);
      stroke-width: 3;
    }

    .callermap-rect-bg {
      stroke: var(--vscode-editor-background);
      stroke-width: 1;
    }

    .callermap-text {
      fill: #fff;
      font-size: 11px;
      text-anchor: middle;
      dominant-baseline: middle;
      pointer-events: none;
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }

    /* Flame Graph styles */
    .flamegraph-container {
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .flamegraph-controls {
      padding: 8px 16px;
      display: flex;
      gap: 16px;
      align-items: center;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .flamegraph-canvas-container {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .flamegraph-canvas {
      position: absolute;
      top: 0;
      left: 0;
    }

    .flamegraph-tooltip {
      position: fixed;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 12px;
      pointer-events: none;
      z-index: 100;
      max-width: 400px;
    }

    .flamegraph-tooltip-name {
      font-weight: 600;
      color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
      margin-bottom: 4px;
      word-break: break-all;
    }

    .flamegraph-tooltip-stats {
      display: flex;
      gap: 16px;
      font-size: 11px;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }

    .virtual-row.focused {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: -2px;
    }

    /* Diff Profile styles */
    .diff-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }

    .diff-summary-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .diff-clear-btn {
      padding: 4px 12px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      flex-shrink: 0;
      margin-left: 12px;
    }

    .diff-clear-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .diff-header {
      display: flex;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
      font-weight: 600;
    }

    .diff-header .diff-cell {
      padding: 8px 8px;
      cursor: pointer;
      user-select: none;
    }

    .diff-header .diff-cell:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .diff-row {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
    }

    .diff-cell {
      padding: 4px 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
    }

    .diff-fn { flex: 2; min-width: 160px; color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
    .diff-file { flex: 1; min-width: 100px; color: var(--vscode-textLink-foreground); cursor: pointer; }
    .diff-file:hover { text-decoration: underline; }
    .diff-num { width: 75px; flex-shrink: 0; text-align: right; font-variant-numeric: tabular-nums; justify-content: flex-end; }
    .diff-status { width: 80px; flex-shrink: 0; font-size: 11px; text-transform: capitalize; }

    /* Export dropdown */
    .export-container {
      position: relative;
    }

    .export-btn {
      padding: 4px 12px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }

    .export-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .export-dropdown {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      background: var(--vscode-menu-background, var(--vscode-dropdown-background));
      border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border));
      border-radius: 4px;
      z-index: 50;
      min-width: 140px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .export-option {
      display: block;
      width: 100%;
      padding: 6px 12px;
      background: none;
      border: none;
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      font-size: 12px;
      text-align: left;
      cursor: pointer;
    }

    .export-option:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
    }

    /* Copy-to-clipboard button */
    .copy-btn {
      display: none;
      background: none;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 0 4px;
      font-size: 12px;
      opacity: 0.5;
      flex-shrink: 0;
      margin-left: 4px;
    }

    .copy-btn:hover {
      opacity: 1;
    }

    .virtual-row:hover .copy-btn {
      display: inline-flex;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
