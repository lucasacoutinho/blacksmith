import { useMemo } from 'react';
import { pipe, Match, Option } from 'effect';
import { useProfileStore } from '../store';
import type { FunctionStats, CallEdge, SerializedProfileData } from '../../types';

type ProfileState = ReturnType<typeof useProfileStore.getState>['profile'];

const extractData = (profile: ProfileState): Option.Option<SerializedProfileData> =>
  profile._tag === 'Loaded' ? Option.some(profile.data) : Option.none();

export const useStats = (): readonly FunctionStats[] => {
  const profile = useProfileStore((s) => s.profile);

  return useMemo(() =>
    pipe(
      extractData(profile),
      Option.map((data) => Array.from(new Map<number, FunctionStats>(data.stats).values())),
      Option.getOrElse((): readonly FunctionStats[] => [])
    ),
    [profile]
  );
};

export const useFilteredStats = (): readonly FunctionStats[] => {
  const stats = useStats();
  const search = useProfileStore((s) => s.search);
  const sortKey = useProfileStore((s) => s.sortKey);
  const sortDir = useProfileStore((s) => s.sortDir);
  const metricIdx = useProfileStore((s) => s.selectedMetricIndex);

  return useMemo(() => {
    const q = search.toLowerCase();
    const filtered = search
      ? stats.filter((s) => s.name.toLowerCase().includes(q) || s.file.toLowerCase().includes(q))
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
        Match.when('selfCost', () => getCost(a, 'self') - getCost(b, 'self')),
        Match.when('totalCost', () => getCost(a, 'total') - getCost(b, 'total')),
        Match.when('percent', () => getCost(a, 'total') - getCost(b, 'total')),
        Match.when('calls', () => a.calls - b.calls),
        Match.exhaustive
      );
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [stats, search, sortKey, sortDir, metricIdx]);
};

export const useTotalCost = (): number => {
  const profile = useProfileStore((s) => s.profile);
  const metricIdx = useProfileStore((s) => s.selectedMetricIndex);

  return useMemo(() =>
    pipe(
      extractData(profile),
      Option.map((data) => data.totalCosts?.[metricIdx] ?? data.totalCost),
      Option.getOrElse(() => 0)
    ),
    [profile, metricIdx]
  );
};

export const useEventTypes = (): readonly string[] => {
  const profile = useProfileStore((s) => s.profile);

  return useMemo(() =>
    pipe(
      extractData(profile),
      Option.map((data) => [...(data.eventTypes ?? [data.eventType])]),
      Option.getOrElse((): readonly string[] => ['Time'])
    ),
    [profile]
  );
};

export const useCurrentMetric = (): string => {
  const eventTypes = useEventTypes();
  const metricIdx = useProfileStore((s) => s.selectedMetricIndex);

  return useMemo(() => eventTypes[metricIdx] ?? 'Time', [eventTypes, metricIdx]);
};

export const useEdges = (): readonly CallEdge[] => {
  const profile = useProfileStore((s) => s.profile);

  return useMemo(() =>
    pipe(
      extractData(profile),
      Option.map((data) => [...data.edges]),
      Option.getOrElse((): readonly CallEdge[] => [])
    ),
    [profile]
  );
};

export const useStatsMap = (): ReadonlyMap<number, FunctionStats> => {
  const stats = useStats();

  return useMemo(() => new Map(stats.map((s) => [s.id, s])), [stats]);
};
