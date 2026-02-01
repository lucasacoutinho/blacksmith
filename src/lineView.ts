import * as vscode from 'vscode';
import path from 'path';
import { ProfileContext } from './profileContext';
import type { FunctionStats } from './types';

const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const normalizePath = (value: string): string => path.normalize(value).replace(/\\/g, '/');

const formatCost = (value: number): string => {
  if (!Number.isFinite(value)) return '0';
  return formatter.format(Math.round(value));
};

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
  private enabled = true;
  private normalizedFiles = new Map<string, string>();

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
  }

  dispose(): void {
    this.inlineDecoration.dispose();
    for (const decoration of this.heatDecorations) {
      decoration.dispose();
    }
    for (const decoration of this.overviewDecorations) {
      decoration.dispose();
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    this.refresh();
    return this.enabled;
  }

  updateProfile(): void {
    const indices = this.profileContext.indices;
    this.normalizedFiles = new Map();
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
  }

  private applyToEditor(editor: vscode.TextEditor): void {
    const indices = this.profileContext.indices;
    const data = this.profileContext.data;
    if (!indices || !data) {
      this.clearEditor(editor);
      return;
    }

    const fileKey = this.resolveFileKey(editor.document.uri.fsPath, indices.functionsByFile.keys());
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
      totalCost: number;
      selfCost: number;
    }> = [];

    let maxCost = 0;
    for (const [line, fn] of lineMap.entries()) {
      const stats = indices.statsById.get(fn.id);
      if (!stats) continue;

      const lineIndex = line - 1;
      if (lineIndex < 0 || lineIndex >= editor.document.lineCount) continue;

      const totalCost = stats.totalCosts?.[metricIndex] ?? stats.totalCost;
      const selfCost = stats.selfCosts?.[metricIndex] ?? stats.selfCost;
      maxCost = Math.max(maxCost, totalCost);

      entries.push({ lineIndex, stats, totalCost, selfCost });
    }

    const inlineOptions: vscode.DecorationOptions[] = [];
    const heatOptions: vscode.DecorationOptions[][] = Array.from(
      { length: HEAT_BUCKETS },
      () => []
    );
    const overviewOptions: vscode.DecorationOptions[][] = Array.from(
      { length: HEAT_BUCKETS },
      () => []
    );

    for (const entry of entries) {
      const line = editor.document.lineAt(entry.lineIndex);
      const percent = totalCostAll > 0 ? (entry.totalCost / totalCostAll) * 100 : 0;
      const label = `${formatCost(entry.selfCost)}/${formatCost(entry.totalCost)} (${percent.toFixed(1)}%) | ${entry.stats.calls} calls`;

      const intensity = maxCost > 0 ? entry.totalCost / maxCost : 0;
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
    }

    editor.setDecorations(this.inlineDecoration, inlineOptions);
    for (const [index, decoration] of this.heatDecorations.entries()) {
      editor.setDecorations(decoration, heatOptions[index]);
    }
    for (const [index, decoration] of this.overviewDecorations.entries()) {
      editor.setDecorations(decoration, overviewOptions[index]);
    }
  }

  private resolveFileKey(filePath: string, candidates: IterableIterator<string>): string | null {
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
