import { describe, it, expect } from 'vitest';
import { computeDiff, resolveComparisonMetric, type ComparisonMetric } from '../src/diff';
import { Cost, FunctionId } from '../src/types';
import type { FunctionStats } from '../src/types';
import { ZERO_COST, subtractCosts } from '../src/cost';

const delta = (value: number) =>
  value >= 0 ? subtractCosts(Cost(value), ZERO_COST) : subtractCosts(ZERO_COST, Cost(-value));

const makeFn = (
  id: number,
  name: string,
  file: string,
  selfCost: number,
  totalCost: number,
  calls = 1,
): FunctionStats => ({
  id: FunctionId(id),
  name,
  file,
  line: 1,
  selfCost: Cost(selfCost),
  totalCost: Cost(totalCost),
  selfCosts: [Cost(selfCost)],
  totalCosts: [Cost(totalCost)],
  lineCosts: [],
  calls: Cost(calls),
  callers: [],
  callees: [],
});

const timeMetric: ComparisonMetric = {
  name: 'Time',
  profileAIndex: 0,
  profileBIndex: 0,
};

describe('computeDiff', () => {
  it('computes correct deltas for functions in both profiles', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200)];
    const statsB = [makeFn(1, 'foo', '/a.php', 150, 300)];

    const result = computeDiff(
      statsA,
      statsB,
      timeMetric,
      'a.callgrind',
      'b.callgrind',
      Cost(200),
      Cost(300),
    );

    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry.selfCostA).toBe(Cost(100));
    expect(entry.selfCostB).toBe(Cost(150));
    expect(entry.selfDelta).toBe(delta(50));
    expect(entry.totalCostA).toBe(Cost(200));
    expect(entry.totalCostB).toBe(Cost(300));
    expect(entry.totalDelta).toBe(delta(100));
  });

  it('marks function only in A as "removed"', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200)];
    const statsB: FunctionStats[] = [];

    const result = computeDiff(statsA, statsB, timeMetric, 'a', 'b', Cost(200), ZERO_COST);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].status).toBe('removed');
    expect(result.entries[0].selfCostB).toBe(ZERO_COST);
    expect(result.entries[0].totalCostB).toBe(ZERO_COST);
  });

  it('marks function only in B as "added"', () => {
    const statsA: FunctionStats[] = [];
    const statsB = [makeFn(1, 'bar', '/b.php', 50, 80)];

    const result = computeDiff(statsA, statsB, timeMetric, 'a', 'b', ZERO_COST, Cost(80));

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].status).toBe('added');
    expect(result.entries[0].selfCostA).toBe(ZERO_COST);
    expect(result.entries[0].totalCostA).toBe(ZERO_COST);
  });

  it('marks zero delta as "unchanged"', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200)];
    const statsB = [makeFn(1, 'foo', '/a.php', 100, 200)];

    const result = computeDiff(statsA, statsB, timeMetric, 'a', 'b', Cost(200), Cost(200));

    expect(result.entries[0].status).toBe('unchanged');
    expect(result.entries[0].totalDelta).toBe(delta(0));
  });

  it('marks negative delta (cost decreased) as "improved"', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 200, 400)];
    const statsB = [makeFn(1, 'foo', '/a.php', 100, 200)];

    const result = computeDiff(statsA, statsB, timeMetric, 'a', 'b', Cost(400), Cost(200));

    expect(result.entries[0].status).toBe('improved');
    expect(result.entries[0].totalDelta).toBe(delta(-200));
  });

  it('marks positive delta (cost increased) as "regressed"', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200)];
    const statsB = [makeFn(1, 'foo', '/a.php', 200, 400)];

    const result = computeDiff(statsA, statsB, timeMetric, 'a', 'b', Cost(200), Cost(400));

    expect(result.entries[0].status).toBe('regressed');
    expect(result.entries[0].totalDelta).toBe(delta(200));
  });

  it('computes percentage deltas correctly', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200)];
    const statsB = [makeFn(1, 'foo', '/a.php', 150, 300)];

    const result = computeDiff(statsA, statsB, timeMetric, 'a', 'b', Cost(200), Cost(300));

    expect(result.entries[0].selfDeltaPct).toBe(50);
    expect(result.entries[0].totalDeltaPct).toBe(50);
  });

  it('computes total cost delta correctly', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 500)];
    const statsB = [makeFn(1, 'foo', '/a.php', 100, 300)];

    const result = computeDiff(statsA, statsB, timeMetric, 'a', 'b', Cost(500), Cost(300));

    expect(result.totalCostA).toBe(Cost(500));
    expect(result.totalCostB).toBe(Cost(300));
    expect(result.totalDelta).toBe(delta(-200));
    expect(result.totalDeltaPct).toBe(-40);
  });

  it('sorts entries by biggest regression first', () => {
    const statsA = [
      makeFn(1, 'small', '/a.php', 10, 20),
      makeFn(2, 'big', '/a.php', 100, 200),
      makeFn(3, 'medium', '/a.php', 50, 100),
    ];
    const statsB = [
      makeFn(1, 'small', '/a.php', 15, 30),
      makeFn(2, 'big', '/a.php', 200, 500),
      makeFn(3, 'medium', '/a.php', 80, 200),
    ];

    const result = computeDiff(statsA, statsB, timeMetric, 'a', 'b', Cost(320), Cost(730));

    expect(result.entries[0].name).toBe('big');
    expect(result.entries[1].name).toBe('medium');
    expect(result.entries[2].name).toBe('small');
  });

  it('matches functions by name AND file composite key', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200), makeFn(2, 'foo', '/b.php', 50, 100)];
    const statsB = [makeFn(3, 'foo', '/a.php', 150, 300), makeFn(4, 'foo', '/b.php', 60, 120)];

    const result = computeDiff(statsA, statsB, timeMetric, 'a', 'b', Cost(300), Cost(420));

    expect(result.entries).toHaveLength(2);
    const entryA = result.entries.find((e) => e.file === '/a.php')!;
    const entryB = result.entries.find((e) => e.file === '/b.php')!;
    expect(entryA.totalDelta).toBe(delta(100));
    expect(entryB.totalDelta).toBe(delta(20));
  });

  it('preserves metadata in the result', () => {
    const result = computeDiff(
      [],
      [],
      { ...timeMetric, name: 'Ir' },
      'profile_a.callgrind',
      'profile_b.callgrind',
      ZERO_COST,
      ZERO_COST,
    );

    expect(result.metricName).toBe('Ir');
    expect(result.filenameA).toBe('profile_a.callgrind');
    expect(result.filenameB).toBe('profile_b.callgrind');
  });

  it('uses each profile metric index when event order differs', () => {
    const statsA = [
      {
        ...makeFn(1, 'foo', '/a.php', 10, 20),
        selfCosts: [Cost(10), Cost(100)],
        totalCosts: [Cost(20), Cost(200)],
      },
    ];
    const statsB = [
      {
        ...makeFn(1, 'foo', '/a.php', 15, 30),
        selfCosts: [Cost(150), Cost(15)],
        totalCosts: [Cost(300), Cost(30)],
      },
    ];
    const metric = resolveComparisonMetric(['Time', 'Memory'], ['Memory', 'Time'], 0);

    expect(metric).toEqual({ name: 'Time', profileAIndex: 0, profileBIndex: 1 });
    const result = computeDiff(statsA, statsB, metric!, 'a', 'b', Cost(20), Cost(30));
    expect(result.entries[0]).toMatchObject({
      selfCostA: Cost(10),
      selfCostB: Cost(15),
      totalCostA: Cost(20),
      totalCostB: Cost(30),
    });
  });

  it('rejects a comparison when the active metric is absent', () => {
    expect(resolveComparisonMetric(['Time', 'Memory'], ['Memory'], 0)).toBeNull();
    expect(resolveComparisonMetric(['Time'], ['Time'], 2)).toBeNull();
  });
});
