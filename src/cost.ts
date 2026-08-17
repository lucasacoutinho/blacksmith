import { Brand } from 'effect';

export type Cost = string & Brand.Brand<'Cost'>;
export type CostDelta = string & Brand.Brand<'CostDelta'>;

type CostInput = string | number | bigint;

const decimalCost = /^\d+$/;

export const Cost = (value: CostInput): Cost => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`Cost numbers must be non-negative safe integers, received ${value}`);
    }
  } else if (typeof value === 'bigint' && value < 0n) {
    throw new RangeError(`Costs cannot be negative, received ${value}`);
  } else if (typeof value === 'string' && !decimalCost.test(value)) {
    throw new TypeError(`Costs must contain only decimal digits, received ${value}`);
  }

  return BigInt(value).toString() as Cost;
};

const CostDelta = (value: bigint): CostDelta => value.toString() as CostDelta;

export const ZERO_COST = Cost(0);
export const ONE_COST = Cost(1);
export const ZERO_COST_DELTA = CostDelta(0n);

export const compareCosts = (left: Cost, right: Cost): number => {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
};

export const compareCostDeltas = (left: CostDelta, right: CostDelta): number => {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
};

export const addCosts = (left: Cost, right: Cost): Cost => Cost(BigInt(left) + BigInt(right));

export const subtractCosts = (minuend: Cost, subtrahend: Cost): CostDelta =>
  CostDelta(BigInt(minuend) - BigInt(subtrahend));

export const costRatio = (value: Cost, total: Cost): number => {
  const denominator = BigInt(total);
  if (denominator === 0n) return 0;

  const scale = 1_000_000_000n;
  const scaledRatio = (BigInt(value) * scale) / denominator;
  return Number(scaledRatio) / Number(scale);
};

export const costDeltaPercent = (before: Cost, after: Cost): number => {
  const beforeValue = BigInt(before);
  const afterValue = BigInt(after);
  if (beforeValue === 0n) return afterValue === 0n ? 0 : 100;

  const scale = 1_000_000n;
  const scaledPercent = ((afterValue - beforeValue) * 100n * scale) / beforeValue;
  return Number(scaledPercent) / Number(scale);
};

export const isZeroCost = (value: Cost): boolean => value === ZERO_COST;

export const isPositiveCostDelta = (value: CostDelta): boolean => BigInt(value) > 0n;
export const isNegativeCostDelta = (value: CostDelta): boolean => BigInt(value) < 0n;

const formatScaled = (value: bigint, divisor: bigint, suffix: string): string => {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const roundedTenths = (absolute * 10n + divisor / 2n) / divisor;
  const whole = roundedTenths / 10n;
  const decimal = roundedTenths % 10n;
  const sign = negative ? '-' : '';
  return `${sign}${whole}.${decimal}${suffix}`;
};

export const formatCost = (cost: Cost | CostDelta): string => {
  const value = BigInt(cost);
  const absolute = value < 0n ? -value : value;

  if (absolute >= 1_000_000_000n) return formatScaled(value, 1_000_000_000n, 'B');
  if (absolute >= 1_000_000n) return formatScaled(value, 1_000_000n, 'M');
  if (absolute >= 1_000n) return formatScaled(value, 1_000n, 'K');
  return value.toLocaleString('en-US');
};

export const formatExactCost = (cost: Cost): string => BigInt(cost).toLocaleString('en-US');
