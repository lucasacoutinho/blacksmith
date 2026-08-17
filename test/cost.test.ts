import { describe, expect, it } from 'vitest';
import {
  Cost,
  ZERO_COST,
  addCosts,
  compareCosts,
  costDeltaPercent,
  costRatio,
  formatCost,
  subtractCosts,
} from '../src/cost';

describe('Cost', () => {
  it('keeps unsigned 64-bit counters and larger sums exact', () => {
    const maximumUnsigned64 = Cost('18446744073709551615');
    const sum = addCosts(maximumUnsigned64, Cost('9007199254740993'));

    expect(maximumUnsigned64).toBe('18446744073709551615');
    expect(sum).toBe('18455751272964292608');
    expect(compareCosts(sum, maximumUnsigned64)).toBeGreaterThan(0);
  });

  it('rejects unsafe JavaScript number inputs', () => {
    expect(() => Cost(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => Cost(-1)).toThrow(RangeError);
    expect(() => Cost('1.5')).toThrow(TypeError);
  });

  it('computes ratios and signed differences without converting stored costs to numbers', () => {
    const before = Cost('9007199254740993');
    const after = Cost('18014398509481986');

    expect(costRatio(before, after)).toBe(0.5);
    expect(subtractCosts(after, before)).toBe('9007199254740993');
    expect(costDeltaPercent(before, after)).toBe(100);
    expect(costRatio(ZERO_COST, ZERO_COST)).toBe(0);
  });

  it('formats exact costs and signed deltas', () => {
    expect(formatCost(Cost(999))).toBe('999');
    expect(formatCost(Cost(1_500))).toBe('1.5K');
    expect(formatCost(subtractCosts(Cost(1_000), Cost(2_500)))).toBe('-1.5K');
  });
});
