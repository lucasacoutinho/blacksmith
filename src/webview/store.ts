import { useMemo } from 'react';
import { create } from 'zustand';
import { pipe, Match, Option } from 'effect';
import { postWebviewMessage } from './vscode-bridge';
import type { Cost, SerializedProfileData, FunctionStats, CallEdge, DiffResult } from '../types';
import { ZERO_COST, compareCosts } from '../cost';

export type TabId = 'flat' | 'callgraph' | 'callermap' | 'flamegraph' | 'diff';
export type SortKey = 'name' | 'file' | 'selfCost' | 'totalCost' | 'calls' | 'percent';
export type SortDir = 'asc' | 'desc';

type ProfileState =
  | { readonly _tag: 'Loading'; readonly filename: string; readonly progress: number }
  | { readonly _tag: 'Error'; readonly message: string }
  | { readonly _tag: 'Loaded'; readonly data: SerializedProfileData }
  | { readonly _tag: 'Empty' };

interface ProfileStore {
  readonly profile: ProfileState;
  readonly filename: string;
  readonly activeTab: TabId;
  readonly search: string;
  readonly sortKey: SortKey;
  readonly sortDir: SortDir;
  readonly selectedMetricIndex: number;
  readonly selectedFunctionId: number | null;
  readonly callGraphHistory: readonly number[];
  readonly diff: DiffResult | null;

  setLoading: (filename: string) => void;
  setProgress: (progress: number) => void;
  setData: (data: SerializedProfileData) => void;
  setError: (error: string) => void;
  setActiveTab: (tab: TabId) => void;
  setSearch: (search: string) => void;
  setSort: (key: SortKey) => void;
  setMetricIndex: (index: number) => void;
  selectFunction: (id: number) => void;
  goBack: () => void;
  clearSelection: () => void;
  setDiff: (diff: DiffResult) => void;
  clearDiff: () => void;
  getStats: () => readonly FunctionStats[];
  getFilteredStats: () => readonly FunctionStats[];
  getTotalCost: () => Cost;
  getEventTypes: () => readonly string[];
  getCurrentMetric: () => string;
  getEdges: () => readonly CallEdge[];
}

const extractData = (profile: ProfileState): Option.Option<SerializedProfileData> =>
  profile._tag === 'Loaded' ? Option.some(profile.data) : Option.none();

export const useProfileStore = create<ProfileStore>((set, get) => ({
  profile: { _tag: 'Empty' },
  filename: '',
  activeTab: 'flat',
  search: '',
  sortKey: 'totalCost',
  sortDir: 'desc',
  selectedMetricIndex: 0,
  selectedFunctionId: null,
  callGraphHistory: [],
  diff: null,

  setLoading: (filename) => set({ profile: { _tag: 'Loading', filename, progress: 0 }, filename }),

  setProgress: (progress) =>
    set((s) => (s.profile._tag === 'Loading' ? { profile: { ...s.profile, progress } } : s)),

  setData: (data) => {
    set({
      profile: { _tag: 'Loaded', data },
      selectedMetricIndex: 0,
      selectedFunctionId: null,
      callGraphHistory: [],
    });
    postWebviewMessage({ type: 'setMetricIndex', index: 0 });
    postWebviewMessage({ type: 'selectFunction', id: null });
  },

  setError: (message) => set({ profile: { _tag: 'Error', message } }),

  setActiveTab: (activeTab) => set({ activeTab }),
  setSearch: (search) => set({ search }),

  setSort: (key) =>
    set((s) => ({
      sortKey: key,
      sortDir: s.sortKey === key && s.sortDir === 'desc' ? 'asc' : 'desc',
    })),

  setMetricIndex: (selectedMetricIndex) => {
    set({ selectedMetricIndex });
    postWebviewMessage({ type: 'setMetricIndex', index: selectedMetricIndex });
  },

  selectFunction: (id) => {
    set((s) => ({
      selectedFunctionId: id,
      callGraphHistory:
        s.selectedFunctionId !== null
          ? [...s.callGraphHistory, s.selectedFunctionId]
          : s.callGraphHistory,
    }));
    postWebviewMessage({ type: 'selectFunction', id });
  },

  goBack: () => {
    const state = get();
    if (state.callGraphHistory.length === 0) return;

    const history = [...state.callGraphHistory];
    const selectedFunctionId = history.pop()!;
    set({ selectedFunctionId, callGraphHistory: history });
    postWebviewMessage({ type: 'selectFunction', id: selectedFunctionId });
  },

  clearSelection: () => {
    set({ search: '', selectedFunctionId: null });
    postWebviewMessage({ type: 'selectFunction', id: null });
  },

  setDiff: (diff) => set({ diff, activeTab: 'diff' }),

  clearDiff: () => set({ diff: null, activeTab: 'flat' }),

  getStats: () =>
    pipe(
      extractData(get().profile),
      Option.map((data) => Array.from(new Map<number, FunctionStats>(data.stats).values())),
      Option.getOrElse((): readonly FunctionStats[] => []),
    ),

  getFilteredStats: () => {
    const { search, sortKey, sortDir, selectedMetricIndex } = get();
    const all = get().getStats();

    const getCost = (s: FunctionStats, type: 'self' | 'total') =>
      pipe(
        Match.value(type),
        Match.when('self', () => s.selfCosts?.[selectedMetricIndex] ?? s.selfCost),
        Match.when('total', () => s.totalCosts?.[selectedMetricIndex] ?? s.totalCost),
        Match.exhaustive,
      );

    return pipe(
      search
        ? all.filter((s) => {
            const q = search.toLowerCase();
            return s.name.toLowerCase().includes(q) || s.file.toLowerCase().includes(q);
          })
        : all,
      (filtered) =>
        [...filtered].sort((a, b) => {
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
        }),
    );
  },

  getTotalCost: () =>
    pipe(
      extractData(get().profile),
      Option.map((data) => data.totalCosts?.[get().selectedMetricIndex] ?? data.totalCost),
      Option.getOrElse(() => ZERO_COST),
    ),

  getEventTypes: () =>
    pipe(
      extractData(get().profile),
      Option.map((data) => data.eventTypes ?? ['Time']),
      Option.getOrElse((): readonly string[] => ['Time']),
    ),

  getCurrentMetric: () =>
    pipe(get().getEventTypes(), (types) => types[get().selectedMetricIndex] ?? 'Time'),

  getEdges: () =>
    pipe(
      extractData(get().profile),
      Option.map((data) => data.edges),
      Option.getOrElse((): readonly CallEdge[] => []),
    ),
}));

export const useFunctionCost = () => {
  const metricIndex = useProfileStore((s) => s.selectedMetricIndex);

  return useMemo(
    () => ({
      getSelfCost: (fn: FunctionStats) => fn.selfCosts?.[metricIndex] ?? fn.selfCost,
      getTotalCost: (fn: FunctionStats) => fn.totalCosts?.[metricIndex] ?? fn.totalCost,
      getEdgeCost: (edge: CallEdge) => edge.inclusiveCosts?.[metricIndex] ?? edge.inclusive,
    }),
    [metricIndex],
  );
};
