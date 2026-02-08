import type { CallEdge } from '../../types';

export type EdgeIndex = ReadonlyMap<number, readonly CallEdge[]>;

export const buildEdgeIndex = (edges: readonly CallEdge[]): EdgeIndex => {
  const map = new Map<number, CallEdge[]>();
  for (const edge of edges) {
    const list = map.get(edge.callerId);
    if (list) {
      list.push(edge);
    } else {
      map.set(edge.callerId, [edge]);
    }
  }
  return map;
};
