import type { FunctionId, ProfileData } from './types';
import type { Cost } from './cost';
import { compareCosts } from './cost';

export const findHotPathIds = (
  data: ProfileData,
  metricIndex: number,
  requestedStartId: FunctionId | null,
): ReadonlySet<FunctionId> => {
  const edgesByCaller = new Map<FunctionId, { calleeId: FunctionId; cost: Cost }[]>();
  for (const edge of data.edges) {
    const cost = edge.inclusiveCosts[metricIndex] ?? edge.inclusive;
    const outgoing = edgesByCaller.get(edge.callerId) ?? [];
    outgoing.push({ calleeId: edge.calleeId, cost });
    edgesByCaller.set(edge.callerId, outgoing);
  }

  let startId = requestedStartId;
  if (startId !== null && !data.stats.has(startId)) startId = null;

  if (startId === null) {
    let mostExpensive: { id: FunctionId; cost: Cost } | null = null;
    for (const stats of data.stats.values()) {
      const cost = stats.totalCosts[metricIndex] ?? stats.totalCost;
      if (mostExpensive === null || compareCosts(cost, mostExpensive.cost) > 0) {
        mostExpensive = { id: stats.id, cost };
      }
    }
    startId = mostExpensive?.id ?? null;
  }

  const ids = new Set<FunctionId>();
  let current = startId;
  while (current !== null && !ids.has(current)) {
    ids.add(current);
    const outgoing = edgesByCaller.get(current);
    if (!outgoing || outgoing.length === 0) break;

    let hottestEdge = outgoing[0];
    for (const edge of outgoing) {
      if (compareCosts(edge.cost, hottestEdge.cost) > 0) hottestEdge = edge;
    }
    current = hottestEdge.calleeId;
  }

  return ids;
};
