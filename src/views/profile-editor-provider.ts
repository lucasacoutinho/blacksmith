import * as vscode from 'vscode';
import { getProfileWebviewHtml } from './profile-webview';
import { pipe, Match } from 'effect';
import { parseCallgrindFile } from '../parser';
import type { ExtensionMessage, WebviewMessage, ParseProgress, DiffResult } from '../types';
import { deserializeProfileData, serializeProfileData, FunctionId } from '../types';
import { computeDiff, resolveComparisonMetric } from '../diff';
import { ProfileCache } from '../cache';
import { ProfileContext } from '../profile-context';
import { LineViewDecorations } from '../line-view';

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

  public static register(
    context: vscode.ExtensionContext,
    cache: ProfileCache,
  ): { disposable: vscode.Disposable; provider: ProfileEditorProvider } {
    const provider = new ProfileEditorProvider(context, cache);
    const editorRegistration = vscode.window.registerCustomEditorProvider(
      ProfileEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      },
    );

    const lineViewDisposables = provider._registerLineView();
    const disposable = vscode.Disposable.from(editorRegistration, ...lineViewDisposables);
    return { disposable, provider };
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')],
    };

    webviewPanel.webview.html = getProfileWebviewHtml(webviewPanel.webview, this._extensionUri);

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
        Match.when({ type: 'ready' }, () =>
          this._loadProfile(webviewPanel.webview, filePath, filename),
        ),
        Match.when({ type: 'openFile' }, (m) => this._openFile(m.path, m.line)),
        Match.when({ type: 'requestData' }, () =>
          this._loadProfile(webviewPanel.webview, filePath, filename),
        ),
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
        Match.exhaustive,
      ),
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

      const metric = resolveComparisonMetric(
        profileData.eventTypes,
        dataB.eventTypes,
        this._profileContext.activeMetricIndex,
      );
      if (!metric) {
        const activeMetric =
          profileData.eventTypes[this._profileContext.activeMetricIndex] ?? 'unknown';
        vscode.window.showWarningMessage(
          `Blacksmith: Cannot compare profiles because "${activeMetric}" is missing from ${filenameB}.`,
        );
        return;
      }

      const statsA = Array.from(profileData.stats.values());
      const statsB = Array.from(dataB.stats.values());

      const totalCostA = profileData.totalCosts?.[metric.profileAIndex] ?? profileData.totalCost;
      const totalCostB = dataB.totalCosts?.[metric.profileBIndex] ?? dataB.totalCost;

      const diff: DiffResult = computeDiff(
        statsA,
        statsB,
        metric,
        this._activeFilename,
        filenameB,
        totalCostA,
        totalCostB,
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
    filename: string,
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
      filters:
        format === 'csv'
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
          vscode.TextEditorRevealType.InCenter,
        );
      }
    } catch {
      vscode.window.showWarningMessage(`Could not open file: ${path}`);
    }
  }
}
