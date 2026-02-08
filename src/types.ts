import { Brand } from 'effect';

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
  readonly calls: number;
  readonly callsiteLine: number;
  readonly inclusive: number;
  readonly exclusive: number;
  readonly inclusiveCosts: readonly number[];
}

export interface LineCost {
  readonly line: number;
  readonly costs: readonly number[];
}

export interface FunctionStats {
  readonly id: FunctionId;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly selfCost: number;
  readonly totalCost: number;
  readonly selfCosts: readonly number[];
  readonly totalCosts: readonly number[];
  readonly lineCosts: readonly LineCost[];
  readonly calls: number;
  readonly callers: readonly FunctionId[];
  readonly callees: readonly FunctionId[];
}

export interface ProfileData {
  readonly functions: ReadonlyMap<FunctionId, FunctionNode>;
  readonly edges: readonly CallEdge[];
  readonly stats: ReadonlyMap<FunctionId, FunctionStats>;
  readonly totalCost: number;
  readonly eventType: string;
  readonly eventTypes: readonly string[];
  readonly totalCosts: readonly number[];
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
  readonly selfCostA: number;
  readonly selfCostB: number;
  readonly totalCostA: number;
  readonly totalCostB: number;
  readonly selfDelta: number;
  readonly totalDelta: number;
  readonly selfDeltaPct: number;
  readonly totalDeltaPct: number;
  readonly callsA: number;
  readonly callsB: number;
  readonly status: 'unchanged' | 'improved' | 'regressed' | 'added' | 'removed';
}

export interface DiffResult {
  readonly entries: readonly DiffEntry[];
  readonly totalCostA: number;
  readonly totalCostB: number;
  readonly totalDelta: number;
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
  readonly totalCost: number;
  readonly eventType: string;
  readonly eventTypes: readonly string[];
  readonly totalCosts: readonly number[];
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
