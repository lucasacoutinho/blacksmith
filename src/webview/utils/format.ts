import { pipe, Match } from 'effect';

type Magnitude = 'B' | 'M' | 'K' | 'unit';

const getMagnitude = (cost: number): Magnitude =>
  pipe(
    Match.value(cost),
    Match.when(
      (c) => c >= 1_000_000_000,
      () => 'B' as const,
    ),
    Match.when(
      (c) => c >= 1_000_000,
      () => 'M' as const,
    ),
    Match.when(
      (c) => c >= 1_000,
      () => 'K' as const,
    ),
    Match.orElse(() => 'unit' as const),
  );

export const formatCost = (cost: number): string =>
  pipe(
    Match.value(getMagnitude(cost)),
    Match.when('B', () => `${(cost / 1_000_000_000).toFixed(1)}B`),
    Match.when('M', () => `${(cost / 1_000_000).toFixed(1)}M`),
    Match.when('K', () => `${(cost / 1_000).toFixed(1)}K`),
    Match.when('unit', () => cost.toLocaleString()),
    Match.exhaustive,
  );

export const shortenPath = (path: string): string =>
  pipe(path.split('/'), (parts) => (parts.length <= 2 ? path : `.../${parts.slice(-2).join('/')}`));

export const truncateName = (name: string, maxLen: number): string =>
  name.length <= maxLen ? name : `${name.slice(0, maxLen - 2)}..`;

export const calculatePercent = (value: number, total: number): number =>
  total > 0 ? (value / total) * 100 : 0;

export const formatPercent = (value: number, total: number, decimals = 1): string =>
  pipe(calculatePercent(value, total), (percent) => `${percent.toFixed(decimals)}%`);
