import { useDeferredValue, useMemo } from 'react';
import { pipe, Match, Option } from 'effect';
import { useProfileStore } from '../store';
import { buildEdgeIndex, type EdgeIndex } from '../utils/edge-index';
import type { Cost, FunctionStats, CallEdge, SerializedProfileData } from '../../types';
import { ZERO_COST, compareCosts } from '../../cost';

type ProfileState = ReturnType<typeof useProfileStore.getState>['profile'];

const extractData = (profile: ProfileState): Option.Option<SerializedProfileData> =>
  profile._tag === 'Loaded' ? Option.some(profile.data) : Option.none();

// Unified hook: computes stats array and statsMap in a single pass
export const useStatsData = (): {
  stats: readonly FunctionStats[];
  statsMap: ReadonlyMap<number, FunctionStats>;
} => {
  const profile = useProfileStore((s) => s.profile);

  return useMemo(
    () =>
      pipe(
        extractData(profile),
        Option.map((data) => {
          const stats = Array.from(new Map<number, FunctionStats>(data.stats).values());
          const statsMap: ReadonlyMap<number, FunctionStats> = new Map(stats.map((s) => [s.id, s]));
          return { stats, statsMap };
        }),
        Option.getOrElse(() => ({
          stats: [] as readonly FunctionStats[],
          statsMap: new Map() as ReadonlyMap<number, FunctionStats>,
        })),
      ),
    [profile],
  );
};

// Backwards-compatible: delegates to useStatsData
export const useStats = (): readonly FunctionStats[] => useStatsData().stats;

// Backwards-compatible: delegates to useStatsData
export const useStatsMap = (): ReadonlyMap<number, FunctionStats> => useStatsData().statsMap;

// Pre-lowered search index built once when stats change
interface SearchEntry {
  readonly stat: FunctionStats;
  readonly nameLower: string;
  readonly fileLower: string;
}

const useSearchIndex = (stats: readonly FunctionStats[]): readonly SearchEntry[] =>
  useMemo(
    () =>
      stats.map((s) => ({
        stat: s,
        nameLower: s.name.toLowerCase(),
        fileLower: s.file.toLowerCase(),
      })),
    [stats],
  );

export const useFilteredStats = (): readonly FunctionStats[] => {
  const { stats } = useStatsData();
  const searchIndex = useSearchIndex(stats);
  const search = useProfileStore((s) => s.search);
  const deferredSearch = useDeferredValue(search);
  const sortKey = useProfileStore((s) => s.sortKey);
  const sortDir = useProfileStore((s) => s.sortDir);
  const metricIdx = useProfileStore((s) => s.selectedMetricIndex);

  return useMemo(() => {
    const q = deferredSearch.toLowerCase();
    const filtered = deferredSearch
      ? searchIndex
          .filter((e) => e.nameLower.includes(q) || e.fileLower.includes(q))
          .map((e) => e.stat)
      : stats;

    const getCost = (s: FunctionStats, type: 'self' | 'total') =>
      type === 'self'
        ? (s.selfCosts?.[metricIdx] ?? s.selfCost)
        : (s.totalCosts?.[metricIdx] ?? s.totalCost);

    return [...filtered].sort((a, b) => {
      const cmp = pipe(
        Match.value(sortKey),
        Match.when('name', () => a.name.localeCompare(b.name)),
        Match.when('file', () => a.file.localeCompare(b.file)),
        Match.when('selfCost', () => compareCosts(getCost(a, 'self'), getCost(b, 'self'))),
        Match.when('totalCost', () => compareCosts(getCost(a, 'total'), getCost(b, 'total'))),
        Match.when('percent', () => compareCosts(getCost(a, 'total'), getCost(b, 'total'))),
        Match.when('calls', () => compareCosts(a.calls, b.calls)),
        Match.exhaustive,
      );
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [stats, searchIndex, deferredSearch, sortKey, sortDir, metricIdx]);
};

// Count-only hook: avoids sorting cost for Header display
export const useFilteredCount = (): number => {
  const { stats } = useStatsData();
  const searchIndex = useSearchIndex(stats);
  const search = useProfileStore((s) => s.search);
  const deferredSearch = useDeferredValue(search);

  return useMemo(() => {
    if (!deferredSearch) return stats.length;
    const q = deferredSearch.toLowerCase();
    return searchIndex.filter((e) => e.nameLower.includes(q) || e.fileLower.includes(q)).length;
  }, [stats, searchIndex, deferredSearch]);
};

export const useTotalCost = (): Cost => {
  const profile = useProfileStore((s) => s.profile);
  const metricIdx = useProfileStore((s) => s.selectedMetricIndex);

  return useMemo(
    () =>
      pipe(
        extractData(profile),
        Option.map((data) => data.totalCosts?.[metricIdx] ?? data.totalCost),
        Option.getOrElse(() => ZERO_COST),
      ),
    [profile, metricIdx],
  );
};

export const useEventTypes = (): readonly string[] => {
  const profile = useProfileStore((s) => s.profile);

  return useMemo(
    () =>
      pipe(
        extractData(profile),
        Option.map((data) => [...(data.eventTypes ?? [data.eventType])]),
        Option.getOrElse((): readonly string[] => ['Time']),
      ),
    [profile],
  );
};

export const useCurrentMetric = (): string => {
  const eventTypes = useEventTypes();
  const metricIdx = useProfileStore((s) => s.selectedMetricIndex);

  return useMemo(() => eventTypes[metricIdx] ?? 'Time', [eventTypes, metricIdx]);
};

export const useEdges = (): readonly CallEdge[] => {
  const profile = useProfileStore((s) => s.profile);

  return useMemo(
    () =>
      pipe(
        extractData(profile),
        Option.map((data) => [...data.edges]),
        Option.getOrElse((): readonly CallEdge[] => []),
      ),
    [profile],
  );
};

// Pre-built caller→callees edge index for O(1) lookups
export const useEdgeIndex = (): EdgeIndex => {
  const edges = useEdges();
  return useMemo(() => buildEdgeIndex(edges), [edges]);
};
