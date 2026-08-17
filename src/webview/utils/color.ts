import { pipe, Match } from 'effect';
import { COST_THRESHOLDS, COST_COLORS, type CostLevel } from '../constants';
import type { Cost } from '../../cost';
import { costRatio } from '../../cost';

const getRatioLevel = (ratio: number): CostLevel =>
  pipe(
    Match.value(ratio),
    Match.when(
      (r) => r > COST_THRESHOLDS.HOT,
      () => 'HOT' as const,
    ),
    Match.when(
      (r) => r > COST_THRESHOLDS.WARM,
      () => 'WARM' as const,
    ),
    Match.when(
      (r) => r > COST_THRESHOLDS.MEDIUM,
      () => 'MEDIUM' as const,
    ),
    Match.when(
      (r) => r > COST_THRESHOLDS.COOL,
      () => 'COOL' as const,
    ),
    Match.orElse(() => 'COLD' as const),
  );

export const getCostColor = (cost: Cost, totalCost: Cost): string =>
  COST_COLORS[getRatioLevel(costRatio(cost, totalCost))];
