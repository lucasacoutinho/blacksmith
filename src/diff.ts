import type { FunctionStats, DiffEntry, DiffResult } from './types';
import type { Cost } from './cost';
import {
  ZERO_COST,
  ZERO_COST_DELTA,
  compareCostDeltas,
  costDeltaPercent,
  subtractCosts,
} from './cost';

export interface ComparisonMetric {
  readonly name: string;
  readonly profileAIndex: number;
  readonly profileBIndex: number;
}

export const resolveComparisonMetric = (
  eventTypesA: readonly string[],
  eventTypesB: readonly string[],
  activeMetricIndex: number,
): ComparisonMetric | null => {
  const name = eventTypesA[activeMetricIndex];
  if (!name) return null;

  const profileBIndex = eventTypesB.indexOf(name);
  if (profileBIndex < 0) return null;

  return { name, profileAIndex: activeMetricIndex, profileBIndex };
};

const functionKey = (fn: FunctionStats): string => `${fn.name}\0${fn.file}`;

const classifyStatus = (delta: DiffEntry['totalDelta']): DiffEntry['status'] => {
  const comparison = compareCostDeltas(delta, ZERO_COST_DELTA);
  return comparison > 0 ? 'regressed' : comparison < 0 ? 'improved' : 'unchanged';
};

export const computeDiff = (
  statsA: readonly FunctionStats[],
  statsB: readonly FunctionStats[],
  metric: ComparisonMetric,
  filenameA: string,
  filenameB: string,
  totalCostA: Cost,
  totalCostB: Cost,
): DiffResult => {
  const mapA = new Map<string, FunctionStats>();
  for (const fn of statsA) mapA.set(functionKey(fn), fn);

  const mapB = new Map<string, FunctionStats>();
  for (const fn of statsB) mapB.set(functionKey(fn), fn);

  const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
  const entries: DiffEntry[] = [];

  for (const key of allKeys) {
    const a = mapA.get(key);
    const b = mapB.get(key);

    const selfA = a ? (a.selfCosts?.[metric.profileAIndex] ?? a.selfCost) : ZERO_COST;
    const selfB = b ? (b.selfCosts?.[metric.profileBIndex] ?? b.selfCost) : ZERO_COST;
    const totalA = a ? (a.totalCosts?.[metric.profileAIndex] ?? a.totalCost) : ZERO_COST;
    const totalB = b ? (b.totalCosts?.[metric.profileBIndex] ?? b.totalCost) : ZERO_COST;

    const selfDelta = subtractCosts(selfB, selfA);
    const totalDelta = subtractCosts(totalB, totalA);

    const status: DiffEntry['status'] = !a ? 'added' : !b ? 'removed' : classifyStatus(totalDelta);

    const representative = (b ?? a)!;

    entries.push({
      key,
      name: representative.name,
      file: representative.file,
      line: representative.line,
      selfCostA: selfA,
      selfCostB: selfB,
      totalCostA: totalA,
      totalCostB: totalB,
      selfDelta,
      totalDelta,
      selfDeltaPct: costDeltaPercent(selfA, selfB),
      totalDeltaPct: costDeltaPercent(totalA, totalB),
      callsA: a?.calls ?? ZERO_COST,
      callsB: b?.calls ?? ZERO_COST,
      status,
    });
  }

  entries.sort((a, b) => compareCostDeltas(b.totalDelta, a.totalDelta));

  return {
    entries,
    totalCostA,
    totalCostB,
    totalDelta: subtractCosts(totalCostB, totalCostA),
    totalDeltaPct: costDeltaPercent(totalCostA, totalCostB),
    metricName: metric.name,
    filenameA,
    filenameB,
  };
};
