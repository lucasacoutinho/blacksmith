import { pipe } from 'effect';
import type { Cost } from '../../cost';
import { costRatio, formatCost } from '../../cost';

export { formatCost };

export const shortenPath = (path: string): string =>
  pipe(path.split('/'), (parts) => (parts.length <= 2 ? path : `.../${parts.slice(-2).join('/')}`));

export const truncateName = (name: string, maxLen: number): string =>
  name.length <= maxLen ? name : `${name.slice(0, maxLen - 2)}..`;

export const calculatePercent = (value: Cost, total: Cost): number => costRatio(value, total) * 100;

export const formatPercent = (value: Cost, total: Cost, decimals = 1): string =>
  pipe(calculatePercent(value, total), (percent) => `${percent.toFixed(decimals)}%`);
