import * as vscode from 'vscode';
import path from 'path';
import { ProfileContext } from './profile-context';
import { findHotPathIds } from './hot-path';
import type { Cost, FunctionId, FunctionStats, ProfileData } from './types';
import { ZERO_COST, compareCosts, costRatio, formatExactCost } from './cost';

const normalizePath = (value: string): string => path.normalize(value).replace(/\\/g, '/');

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const HEAT_BUCKETS = 5;

const heatColor = (ratio: number): string => {
  const alpha = 0.06 + 0.34 * clamp(ratio, 0, 1);
  return `rgba(255, 96, 64, ${alpha.toFixed(3)})`;
};

export class LineViewDecorations implements vscode.Disposable {
  private readonly inlineDecoration: vscode.TextEditorDecorationType;
  private readonly heatDecorations: readonly vscode.TextEditorDecorationType[];
  private readonly overviewDecorations: readonly vscode.TextEditorDecorationType[];
  private readonly hotPathDecoration: vscode.TextEditorDecorationType;
  private enabled = true;
  private hotPathEnabled = true;
  private hotPathStartId: FunctionId | null = null;
  private normalizedFiles = new Map<string, string>();
  private hotPathCache: {
    data: ProfileData;
    metricIndex: number;
    startId: FunctionId | null;
    ids: ReadonlySet<FunctionId>;
  } | null = null;

  constructor(private readonly profileContext: ProfileContext) {
    this.inlineDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
        margin: '0 0 0 1.5em',
      },
    });

    this.heatDecorations = Array.from({ length: HEAT_BUCKETS }, (_, index) => {
      const ratio = (index + 1) / HEAT_BUCKETS;
      return vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: heatColor(ratio),
      });
    });

    this.overviewDecorations = Array.from({ length: HEAT_BUCKETS }, (_, index) => {
      const ratio = (index + 1) / HEAT_BUCKETS;
      return vscode.window.createTextEditorDecorationType({
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        overviewRulerColor: heatColor(ratio),
        isWholeLine: true,
      });
    });

    this.hotPathDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(255, 178, 64, 0.28)',
    });
  }

  dispose(): void {
    this.inlineDecoration.dispose();
    for (const decoration of this.heatDecorations) {
      decoration.dispose();
    }
    for (const decoration of this.overviewDecorations) {
      decoration.dispose();
    }
    this.hotPathDecoration.dispose();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    if (!this.enabled) {
      this.enabled = true;
      this.refresh();
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    this.refresh();
    return this.enabled;
  }

  toggleHotPath(): boolean {
    this.hotPathEnabled = !this.hotPathEnabled;
    this.refresh();
    return this.hotPathEnabled;
  }

  setHotPathStartId(id: FunctionId | null): void {
    if (this.hotPathStartId === id) return;
    this.hotPathStartId = id;
    this.hotPathCache = null;
    this.refresh();
  }

  updateProfile(): void {
    const indices = this.profileContext.indices;
    this.normalizedFiles = new Map();
    if (this.hotPathCache?.data !== this.profileContext.data) {
      this.hotPathCache = null;
    }
    if (indices) {
      for (const key of indices.functionsByFile.keys()) {
        const normalized = normalizePath(key);
        if (!this.normalizedFiles.has(normalized)) {
          this.normalizedFiles.set(normalized, key);
        }
      }
    }
    this.refresh();
  }

  refresh(): void {
    const editors = vscode.window.visibleTextEditors;
    if (!this.enabled || !this.profileContext.data || !this.profileContext.indices) {
      for (const editor of editors) {
        this.clearEditor(editor);
      }
      return;
    }

    for (const editor of editors) {
      this.applyToEditor(editor);
    }
  }

  private clearEditor(editor: vscode.TextEditor): void {
    editor.setDecorations(this.inlineDecoration, []);
    for (const decoration of this.heatDecorations) {
      editor.setDecorations(decoration, []);
    }
    for (const decoration of this.overviewDecorations) {
      editor.setDecorations(decoration, []);
    }
    editor.setDecorations(this.hotPathDecoration, []);
  }

  private applyToEditor(editor: vscode.TextEditor): void {
    const indices = this.profileContext.indices;
    const data = this.profileContext.data;
    if (!indices || !data) {
      this.clearEditor(editor);
      return;
    }

    const fileKey = this.resolveFileKey(
      editor.document.uri.fsPath,
      Array.from(indices.functionsByFile.keys()),
    );
    if (!fileKey) {
      this.clearEditor(editor);
      return;
    }

    const lineMap = indices.functionByLine.get(fileKey);
    if (!lineMap || lineMap.size === 0) {
      this.clearEditor(editor);
      return;
    }

    const metricIndex = this.profileContext.activeMetricIndex;
    const totalCostAll = data.totalCosts?.[metricIndex] ?? data.totalCost;

    const entries: Array<{
      lineIndex: number;
      stats: FunctionStats;
      totalCost: Cost;
      selfCost: Cost;
    }> = [];

    const hotPathIds = this.hotPathEnabled
      ? this.getHotPathIds(data, metricIndex, this.hotPathStartId)
      : new Set<FunctionId>();

    let maxCost = ZERO_COST;
    for (const [line, fn] of lineMap.entries()) {
      const stats = indices.statsById.get(fn.id);
      if (!stats) continue;

      const lineIndex = line - 1;
      if (lineIndex < 0 || lineIndex >= editor.document.lineCount) continue;

      const totalCost = stats.totalCosts?.[metricIndex] ?? stats.totalCost;
      const selfCost = stats.selfCosts?.[metricIndex] ?? stats.selfCost;
      if (compareCosts(totalCost, maxCost) > 0) maxCost = totalCost;

      entries.push({ lineIndex, stats, totalCost, selfCost });
    }

    const inlineOptions: vscode.DecorationOptions[] = [];
    const heatOptions: vscode.DecorationOptions[][] = Array.from(
      { length: HEAT_BUCKETS },
      () => [],
    );
    const overviewOptions: vscode.DecorationOptions[][] = Array.from(
      { length: HEAT_BUCKETS },
      () => [],
    );
    const hotPathOptions: vscode.DecorationOptions[] = [];

    for (const entry of entries) {
      const line = editor.document.lineAt(entry.lineIndex);
      const percent = costRatio(entry.totalCost, totalCostAll) * 100;
      const label = `${formatExactCost(entry.selfCost)}/${formatExactCost(entry.totalCost)} (${percent.toFixed(1)}%) | ${formatExactCost(entry.stats.calls)} calls`;

      const intensity = costRatio(entry.totalCost, maxCost);
      const bucket = clamp(Math.floor(intensity * HEAT_BUCKETS), 0, HEAT_BUCKETS - 1);

      inlineOptions.push({
        range: new vscode.Range(line.range.end, line.range.end),
        renderOptions: {
          after: {
            contentText: ` ${label}`,
          },
        },
      });

      heatOptions[bucket].push({
        range: line.range,
      });

      overviewOptions[bucket].push({
        range: line.range,
      });

      if (hotPathIds.has(entry.stats.id)) {
        hotPathOptions.push({
          range: line.range,
          renderOptions: {
            after: {
              contentText: ' HOT',
              color: new vscode.ThemeColor('editorWarning.foreground'),
              margin: '0 0 0 0.5em',
            },
          },
        });
      }
    }

    editor.setDecorations(this.inlineDecoration, inlineOptions);
    for (const [index, decoration] of this.heatDecorations.entries()) {
      editor.setDecorations(decoration, heatOptions[index]);
    }
    for (const [index, decoration] of this.overviewDecorations.entries()) {
      editor.setDecorations(decoration, overviewOptions[index]);
    }
    editor.setDecorations(this.hotPathDecoration, hotPathOptions);
  }

  private getHotPathIds(
    data: ProfileData,
    metricIndex: number,
    startId: FunctionId | null,
  ): ReadonlySet<FunctionId> {
    if (
      this.hotPathCache?.data === data &&
      this.hotPathCache.metricIndex === metricIndex &&
      this.hotPathCache.startId === startId
    ) {
      return this.hotPathCache.ids;
    }

    const ids = findHotPathIds(data, metricIndex, startId);

    this.hotPathCache = {
      data,
      metricIndex,
      startId,
      ids,
    };
    return ids;
  }

  private resolveFileKey(filePath: string, candidates: Iterable<string>): string | null {
    if (this.normalizedFiles.size === 0) return null;
    const normalized = normalizePath(filePath);
    const direct = this.normalizedFiles.get(normalized);
    if (direct) return direct;

    const basename = path.basename(normalized);
    for (const key of candidates) {
      const normalizedKey = normalizePath(key);
      if (normalizedKey.endsWith(`/${basename}`)) {
        return key;
      }
    }

    return null;
  }
}
