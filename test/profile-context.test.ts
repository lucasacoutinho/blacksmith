import { describe, expect, it } from 'vitest';
import { findHotPathIds } from '../src/hot-path';
import { ProfileContext } from '../src/profile-context';
import {
  Cost,
  FunctionId,
  type CallEdge,
  type FunctionStats,
  type ProfileData,
} from '../src/types';
import { ZERO_COST, addCosts } from '../src/cost';

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
  selfCost: Cost(selfCosts[0] ?? 0),
  totalCost: Cost(totalCosts[0] ?? 0),
  selfCosts: selfCosts.map(Cost),
  totalCosts: totalCosts.map(Cost),
  lineCosts: [],
  calls: Cost(1),
  callers: [],
  callees: [],
});

const makeEdge = (callerId: number, calleeId: number, costs: readonly number[]): CallEdge => ({
  callerId: FunctionId(callerId),
  calleeId: FunctionId(calleeId),
  calls: Cost(1),
  callsiteLine: 1,
  inclusive: Cost(costs[0] ?? 0),
  exclusive: ZERO_COST,
  inclusiveCosts: costs.map(Cost),
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
  totalCost: stats.reduce((total, entry) => addCosts(total, entry.totalCost), ZERO_COST),
  totalCosts: [
    stats.reduce((total, entry) => addCosts(total, entry.totalCosts[0] ?? ZERO_COST), ZERO_COST),
    stats.reduce((total, entry) => addCosts(total, entry.totalCosts[1] ?? ZERO_COST), ZERO_COST),
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
