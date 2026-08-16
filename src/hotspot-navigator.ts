import * as vscode from 'vscode';
import { ProfileContext } from './profile-context';
import { LineViewDecorations } from './line-view';
import type { FunctionStats } from './types';

const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const formatCost = (value: number): string => formatter.format(Math.round(value));

export class HotspotNavigator implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private hotspots: FunctionStats[] = [];
  private currentIndex = -1;

  constructor(
    private readonly profileContext: ProfileContext,
    private readonly lineView: LineViewDecorations,
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'blacksmith.listHotspots';
    this.statusBarItem.tooltip = 'Click to list hotspots';
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }

  updateHotspots(): void {
    const config = vscode.workspace.getConfiguration('blacksmith');
    const count = config.get<number>('hotspotCount', 10);
    const sortBy = config.get<'totalCost' | 'selfCost'>('hotspotSortBy', 'totalCost');
    const metricIndex = this.profileContext.activeMetricIndex;

    this.hotspots = this.profileContext.getTopFunctions(count, metricIndex, sortBy);
    this.currentIndex = -1;

    if (this.hotspots.length > 0) {
      this.statusBarItem.text = `$(flame) Hotspots: ${this.hotspots.length}`;
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  async next(): Promise<void> {
    if (this.hotspots.length === 0) return;

    this.currentIndex = (this.currentIndex + 1) % this.hotspots.length;
    await this.navigateToCurrent();
  }

  async previous(): Promise<void> {
    if (this.hotspots.length === 0) return;

    this.currentIndex = this.currentIndex <= 0 ? this.hotspots.length - 1 : this.currentIndex - 1;
    await this.navigateToCurrent();
  }

  async showQuickPick(): Promise<void> {
    if (this.hotspots.length === 0) {
      vscode.window.showInformationMessage(
        'Blacksmith: No hotspots available. Open a profile first.',
      );
      return;
    }

    const data = this.profileContext.data;
    const metricIndex = this.profileContext.activeMetricIndex;
    const totalCostAll = data?.totalCosts?.[metricIndex] ?? data?.totalCost ?? 0;

    const items = this.hotspots.map((fn, index) => {
      const cost = fn.totalCosts?.[metricIndex] ?? fn.totalCost;
      const selfCost = fn.selfCosts?.[metricIndex] ?? fn.selfCost;
      const percent = totalCostAll > 0 ? ((cost / totalCostAll) * 100).toFixed(1) : '0.0';

      return {
        label: `$(symbol-function) ${fn.name}`,
        description: `${percent}% — self: ${formatCost(selfCost)}, total: ${formatCost(cost)}`,
        detail: `${fn.file}:${fn.line}`,
        index,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a hotspot to navigate to',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      this.currentIndex = selected.index;
      await this.navigateToCurrent();
    }
  }

  private async navigateToCurrent(): Promise<void> {
    const fn = this.hotspots[this.currentIndex];
    if (!fn) return;

    if (!this.lineView.isEnabled) {
      this.lineView.enable();
    }

    this.statusBarItem.text = `$(flame) Hotspot ${this.currentIndex + 1}/${this.hotspots.length} — ${fn.name}`;

    try {
      const doc = await vscode.workspace.openTextDocument(fn.file);
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preview: true,
      });

      if (fn.line > 0) {
        const position = new vscode.Position(fn.line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );
      }
    } catch {
      vscode.window.showWarningMessage(`Could not open file: ${fn.file}`);
    }
  }
}
