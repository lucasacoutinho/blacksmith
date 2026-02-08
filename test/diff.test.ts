import { describe, it, expect } from 'vitest';
import { computeDiff } from '../src/diff';
import { FunctionId } from '../src/types';
import type { FunctionStats } from '../src/types';

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
  selfCost,
  totalCost,
  selfCosts: [selfCost],
  totalCosts: [totalCost],
  lineCosts: [],
  calls,
  callers: [],
  callees: [],
});

describe('computeDiff', () => {
  it('computes correct deltas for functions in both profiles', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200)];
    const statsB = [makeFn(1, 'foo', '/a.php', 150, 300)];

    const result = computeDiff(statsA, statsB, 0, 'Time', 'a.callgrind', 'b.callgrind', 200, 300);

    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry.selfCostA).toBe(100);
    expect(entry.selfCostB).toBe(150);
    expect(entry.selfDelta).toBe(50);
    expect(entry.totalCostA).toBe(200);
    expect(entry.totalCostB).toBe(300);
    expect(entry.totalDelta).toBe(100);
  });

  it('marks function only in A as "removed"', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200)];
    const statsB: FunctionStats[] = [];

    const result = computeDiff(statsA, statsB, 0, 'Time', 'a', 'b', 200, 0);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].status).toBe('removed');
    expect(result.entries[0].selfCostB).toBe(0);
    expect(result.entries[0].totalCostB).toBe(0);
  });

  it('marks function only in B as "added"', () => {
    const statsA: FunctionStats[] = [];
    const statsB = [makeFn(1, 'bar', '/b.php', 50, 80)];

    const result = computeDiff(statsA, statsB, 0, 'Time', 'a', 'b', 0, 80);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].status).toBe('added');
    expect(result.entries[0].selfCostA).toBe(0);
    expect(result.entries[0].totalCostA).toBe(0);
  });

  it('marks zero delta as "unchanged"', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200)];
    const statsB = [makeFn(1, 'foo', '/a.php', 100, 200)];

    const result = computeDiff(statsA, statsB, 0, 'Time', 'a', 'b', 200, 200);

    expect(result.entries[0].status).toBe('unchanged');
    expect(result.entries[0].totalDelta).toBe(0);
  });

  it('marks negative delta (cost decreased) as "improved"', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 200, 400)];
    const statsB = [makeFn(1, 'foo', '/a.php', 100, 200)];

    const result = computeDiff(statsA, statsB, 0, 'Time', 'a', 'b', 400, 200);

    expect(result.entries[0].status).toBe('improved');
    expect(result.entries[0].totalDelta).toBe(-200);
  });

  it('marks positive delta (cost increased) as "regressed"', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200)];
    const statsB = [makeFn(1, 'foo', '/a.php', 200, 400)];

    const result = computeDiff(statsA, statsB, 0, 'Time', 'a', 'b', 200, 400);

    expect(result.entries[0].status).toBe('regressed');
    expect(result.entries[0].totalDelta).toBe(200);
  });

  it('computes percentage deltas correctly', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 200)];
    const statsB = [makeFn(1, 'foo', '/a.php', 150, 300)];

    const result = computeDiff(statsA, statsB, 0, 'Time', 'a', 'b', 200, 300);

    expect(result.entries[0].selfDeltaPct).toBe(50);
    expect(result.entries[0].totalDeltaPct).toBe(50);
  });

  it('computes total cost delta correctly', () => {
    const statsA = [makeFn(1, 'foo', '/a.php', 100, 500)];
    const statsB = [makeFn(1, 'foo', '/a.php', 100, 300)];

    const result = computeDiff(statsA, statsB, 0, 'Time', 'a', 'b', 500, 300);

    expect(result.totalCostA).toBe(500);
    expect(result.totalCostB).toBe(300);
    expect(result.totalDelta).toBe(-200);
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

    const result = computeDiff(statsA, statsB, 0, 'Time', 'a', 'b', 320, 730);

    expect(result.entries[0].name).toBe('big');
    expect(result.entries[1].name).toBe('medium');
    expect(result.entries[2].name).toBe('small');
  });

  it('matches functions by name AND file composite key', () => {
    const statsA = [
      makeFn(1, 'foo', '/a.php', 100, 200),
      makeFn(2, 'foo', '/b.php', 50, 100),
    ];
    const statsB = [
      makeFn(3, 'foo', '/a.php', 150, 300),
      makeFn(4, 'foo', '/b.php', 60, 120),
    ];

    const result = computeDiff(statsA, statsB, 0, 'Time', 'a', 'b', 300, 420);

    expect(result.entries).toHaveLength(2);
    const entryA = result.entries.find((e) => e.file === '/a.php')!;
    const entryB = result.entries.find((e) => e.file === '/b.php')!;
    expect(entryA.totalDelta).toBe(100);
    expect(entryB.totalDelta).toBe(20);
  });

  it('preserves metadata in the result', () => {
    const result = computeDiff([], [], 0, 'Ir', 'profile_a.callgrind', 'profile_b.callgrind', 0, 0);

    expect(result.metricName).toBe('Ir');
    expect(result.filenameA).toBe('profile_a.callgrind');
    expect(result.filenameB).toBe('profile_b.callgrind');
  });
});
