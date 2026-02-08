import type { FunctionStats, DiffEntry, DiffResult } from './types';

const functionKey = (fn: FunctionStats): string => `${fn.name}\0${fn.file}`;

const deltaPct = (a: number, b: number): number =>
  a === 0 ? (b === 0 ? 0 : 100) : ((b - a) / a) * 100;

const classifyStatus = (delta: number): DiffEntry['status'] =>
  delta > 0 ? 'regressed' : delta < 0 ? 'improved' : 'unchanged';

export const computeDiff = (
  statsA: readonly FunctionStats[],
  statsB: readonly FunctionStats[],
  metricIndex: number,
  metricName: string,
  filenameA: string,
  filenameB: string,
  totalCostA: number,
  totalCostB: number,
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

    const selfA = a ? (a.selfCosts?.[metricIndex] ?? a.selfCost) : 0;
    const selfB = b ? (b.selfCosts?.[metricIndex] ?? b.selfCost) : 0;
    const totalA = a ? (a.totalCosts?.[metricIndex] ?? a.totalCost) : 0;
    const totalB = b ? (b.totalCosts?.[metricIndex] ?? b.totalCost) : 0;

    const selfDelta = selfB - selfA;
    const totalDelta = totalB - totalA;

    const status: DiffEntry['status'] =
      !a ? 'added' : !b ? 'removed' : classifyStatus(totalDelta);

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
      selfDeltaPct: deltaPct(selfA, selfB),
      totalDeltaPct: deltaPct(totalA, totalB),
      callsA: a?.calls ?? 0,
      callsB: b?.calls ?? 0,
      status,
    });
  }

  entries.sort((a, b) => b.totalDelta - a.totalDelta);

  return {
    entries,
    totalCostA,
    totalCostB,
    totalDelta: totalCostB - totalCostA,
    totalDeltaPct: deltaPct(totalCostA, totalCostB),
    metricName,
    filenameA,
    filenameB,
  };
};
