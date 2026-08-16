import { describe, expect, it } from 'vitest';
import { findHotPathIds } from '../src/hot-path';
import { ProfileContext } from '../src/profile-context';
import { FunctionId, type CallEdge, type FunctionStats, type ProfileData } from '../src/types';

const makeStats = (
  id: number,
  name: string,
  totalCosts: readonly number[],
  selfCosts: readonly number[] = totalCosts,
): FunctionStats => ({
  id: FunctionId(id),
  name,
  file: `${name}.ts`,
  line: id + 1,
  selfCost: selfCosts[0] ?? 0,
  totalCost: totalCosts[0] ?? 0,
  selfCosts,
  totalCosts,
  lineCosts: [],
  calls: 1,
  callers: [],
  callees: [],
});

const makeEdge = (callerId: number, calleeId: number, costs: readonly number[]): CallEdge => ({
  callerId: FunctionId(callerId),
  calleeId: FunctionId(calleeId),
  calls: 1,
  callsiteLine: 1,
  inclusive: costs[0] ?? 0,
  exclusive: 0,
  inclusiveCosts: costs,
});

const makeProfile = (
  stats: readonly FunctionStats[],
  edges: readonly CallEdge[] = [],
): ProfileData => ({
  functions: new Map(
    stats.map((entry) => [
      entry.id,
      { id: entry.id, name: entry.name, file: entry.file, line: entry.line },
    ]),
  ),
  stats: new Map(stats.map((entry) => [entry.id, entry])),
  edges,
  totalCost: stats.reduce((total, entry) => total + entry.totalCost, 0),
  totalCosts: [
    stats.reduce((total, entry) => total + (entry.totalCosts[0] ?? 0), 0),
    stats.reduce((total, entry) => total + (entry.totalCosts[1] ?? 0), 0),
  ],
  eventType: 'Time',
  eventTypes: ['Time', 'Memory'],
});

describe('ProfileContext', () => {
  it('ranks hotspots using the selected metric and cost type', () => {
    const context = new ProfileContext();
    context.setProfileData(
      makeProfile([
        makeStats(0, 'fast', [100, 5], [80, 4]),
        makeStats(1, 'memory-heavy', [20, 400], [10, 350]),
      ]),
    );

    expect(context.getTopFunctions(1, 0, 'totalCost')[0].name).toBe('fast');
    expect(context.getTopFunctions(1, 1, 'totalCost')[0].name).toBe('memory-heavy');
    expect(context.getTopFunctions(1, 1, 'selfCost')[0].name).toBe('memory-heavy');
  });
});

describe('findHotPathIds', () => {
  it('follows the hottest edges from function id zero and stops at a cycle', () => {
    const profile = makeProfile(
      [makeStats(0, 'root', [100]), makeStats(1, 'cold', [10]), makeStats(2, 'hot', [80])],
      [makeEdge(0, 1, [10]), makeEdge(0, 2, [80]), makeEdge(2, 0, [50])],
    );

    expect([...findHotPathIds(profile, 0, FunctionId(0))]).toEqual([FunctionId(0), FunctionId(2)]);
  });

  it('starts at the most expensive function when no valid start is supplied', () => {
    const profile = makeProfile([makeStats(0, 'small', [10]), makeStats(1, 'largest', [100])]);

    expect([...findHotPathIds(profile, 0, FunctionId(99))]).toEqual([FunctionId(1)]);
  });
});
