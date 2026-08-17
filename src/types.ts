import { Brand } from 'effect';
import type { Cost, CostDelta } from './cost';

export { Cost } from './cost';
export type { CostDelta } from './cost';

export type FunctionId = number & Brand.Brand<'FunctionId'>;
export const FunctionId = Brand.nominal<FunctionId>();

export type MetricIndex = number & Brand.Brand<'MetricIndex'>;
export const MetricIndex = Brand.nominal<MetricIndex>();

export interface FunctionNode {
  readonly id: FunctionId;
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

export interface CallEdge {
  readonly callerId: FunctionId;
  readonly calleeId: FunctionId;
  readonly calls: Cost;
  readonly callsiteLine: number;
  readonly inclusive: Cost;
  readonly exclusive: Cost;
  readonly inclusiveCosts: readonly Cost[];
}

export interface LineCost {
  readonly line: number;
  readonly costs: readonly Cost[];
}

export interface FunctionStats {
  readonly id: FunctionId;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly selfCost: Cost;
  readonly totalCost: Cost;
  readonly selfCosts: readonly Cost[];
  readonly totalCosts: readonly Cost[];
  readonly lineCosts: readonly LineCost[];
  readonly calls: Cost;
  readonly callers: readonly FunctionId[];
  readonly callees: readonly FunctionId[];
}

export interface ProfileData {
  readonly functions: ReadonlyMap<FunctionId, FunctionNode>;
  readonly edges: readonly CallEdge[];
  readonly stats: ReadonlyMap<FunctionId, FunctionStats>;
  readonly totalCost: Cost;
  readonly eventType: string;
  readonly eventTypes: readonly string[];
  readonly totalCosts: readonly Cost[];
}

export interface ParseProgress {
  readonly percent: number;
  readonly functionCount: number;
  readonly currentFunction?: string;
}

export interface DiffEntry {
  readonly key: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly selfCostA: Cost;
  readonly selfCostB: Cost;
  readonly totalCostA: Cost;
  readonly totalCostB: Cost;
  readonly selfDelta: CostDelta;
  readonly totalDelta: CostDelta;
  readonly selfDeltaPct: number;
  readonly totalDeltaPct: number;
  readonly callsA: Cost;
  readonly callsB: Cost;
  readonly status: 'unchanged' | 'improved' | 'regressed' | 'added' | 'removed';
}

export interface DiffResult {
  readonly entries: readonly DiffEntry[];
  readonly totalCostA: Cost;
  readonly totalCostB: Cost;
  readonly totalDelta: CostDelta;
  readonly totalDeltaPct: number;
  readonly metricName: string;
  readonly filenameA: string;
  readonly filenameB: string;
}

export type ExtensionMessage =
  | { readonly type: 'loading'; readonly filename: string }
  | { readonly type: 'progress'; readonly progress: ParseProgress }
  | { readonly type: 'data'; readonly data: SerializedProfileData }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'diffData'; readonly diff: DiffResult };

export type WebviewMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'openFile'; readonly path: string; readonly line: number }
  | { readonly type: 'requestData' }
  | { readonly type: 'setMetricIndex'; readonly index: number }
  | { readonly type: 'selectFunction'; readonly id: number | null }
  | { readonly type: 'clearDiff' }
  | { readonly type: 'export'; readonly format: 'csv' | 'json'; readonly content: string };

export interface SerializedProfileData {
  readonly functions: ReadonlyArray<readonly [number, FunctionNode]>;
  readonly edges: readonly CallEdge[];
  readonly stats: ReadonlyArray<readonly [number, FunctionStats]>;
  readonly totalCost: Cost;
  readonly eventType: string;
  readonly eventTypes: readonly string[];
  readonly totalCosts: readonly Cost[];
}

export const serializeProfileData = (data: ProfileData): SerializedProfileData => ({
  functions: Array.from(data.functions.entries()),
  edges: data.edges,
  stats: Array.from(data.stats.entries()),
  totalCost: data.totalCost,
  eventType: data.eventType,
  eventTypes: data.eventTypes,
  totalCosts: data.totalCosts,
});

export const deserializeProfileData = (data: SerializedProfileData): ProfileData => ({
  functions: new Map(data.functions.map(([k, v]) => [FunctionId(k), v])),
  edges: data.edges,
  stats: new Map(data.stats.map(([k, v]) => [FunctionId(k), v])),
  totalCost: data.totalCost,
  eventType: data.eventType,
  eventTypes: data.eventTypes,
  totalCosts: data.totalCosts,
});
