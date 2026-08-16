import { MetricIndex } from './types';
import type { FunctionId, FunctionNode, FunctionStats, ProfileData } from './types';

export interface ProfileIndices {
  readonly functionsByFile: ReadonlyMap<string, readonly FunctionNode[]>;
  readonly functionByLine: ReadonlyMap<string, ReadonlyMap<number, FunctionNode>>;
  readonly statsById: ReadonlyMap<FunctionId, FunctionStats>;
}

const buildIndices = (data: ProfileData): ProfileIndices => {
  const functionsByFile = new Map<string, FunctionNode[]>();
  const functionByLine = new Map<string, Map<number, FunctionNode>>();

  for (const fn of data.functions.values()) {
    const list = functionsByFile.get(fn.file) ?? [];
    list.push(fn);
    functionsByFile.set(fn.file, list);

    if (fn.line > 0) {
      const lineMap = functionByLine.get(fn.file) ?? new Map<number, FunctionNode>();
      if (!lineMap.has(fn.line)) {
        lineMap.set(fn.line, fn);
      }
      functionByLine.set(fn.file, lineMap);
    }
  }

  return {
    functionsByFile,
    functionByLine,
    statsById: new Map(data.stats.entries()),
  };
};

export class ProfileContext {
  private _data: ProfileData | null = null;
  private _indices: ProfileIndices | null = null;
  private _activeMetricIndex: MetricIndex = MetricIndex(0);

  setProfileData(data: ProfileData): void {
    this._data = data;
    this._indices = buildIndices(data);
  }

  clear(): void {
    this._data = null;
    this._indices = null;
  }

  setActiveMetricIndex(index: number): void {
    this._activeMetricIndex = MetricIndex(index);
  }

  get data(): ProfileData | null {
    return this._data;
  }

  get indices(): ProfileIndices | null {
    return this._indices;
  }

  get activeMetricIndex(): MetricIndex {
    return this._activeMetricIndex;
  }

  getTopFunctions(
    count: number,
    metricIndex: number,
    sortBy: 'totalCost' | 'selfCost',
  ): FunctionStats[] {
    if (!this._data || !this._indices) return [];
    const allStats = Array.from(this._indices.statsById.values());
    return allStats
      .sort((a, b) => {
        const getCost = (s: FunctionStats) =>
          sortBy === 'selfCost'
            ? (s.selfCosts?.[metricIndex] ?? s.selfCost)
            : (s.totalCosts?.[metricIndex] ?? s.totalCost);
        return getCost(b) - getCost(a);
      })
      .slice(0, count);
  }
}
