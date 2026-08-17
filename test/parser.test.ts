import { describe, it, expect } from 'vitest';
import { parse } from '../src/parser';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'path';
import { performance } from 'node:perf_hooks';
import { Cost } from '../src/types';
import { ZERO_COST, compareCosts } from '../src/cost';

const fixture = (name: string) => path.join(__dirname, 'fixtures', name);
const costs = (...values: Array<string | number | bigint>) => values.map(Cost);

const parseContent = async (content: string) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'blacksmith-parser-'));
  const profilePath = path.join(directory, 'profile.callgrind');

  try {
    await fs.writeFile(profilePath, `${content.trim()}\n`, 'utf8');
    return await parse(profilePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

describe('callgrind parser', () => {
  describe('PHP/Xdebug profiles', () => {
    const fixturePath = fixture('sample.callgrind');

    it('parses sample file correctly', async () => {
      const data = await parse(fixturePath);

      expect(data.eventType).toBe('Time');
      expect(data.totalCost).toBe(Cost(352_000));
      expect(data.functions.size).toBeGreaterThan(0);
      expect(data.edges.length).toBeGreaterThan(0);
    });

    it('extracts function names correctly', async () => {
      const data = await parse(fixturePath);

      const names = Array.from(data.functions.values()).map((f) => f.name);

      expect(names).toContain('{main}');
      expect(names).toContain('App\\Controller\\HomeController->index');
      expect(names).toContain('App\\Service\\UserService->getUsers');
      expect(names).toContain('App\\Repository\\UserRepository->findAll');
      expect(names).toContain('PDO->query');
    });

    it('computes self costs correctly', async () => {
      const data = await parse(fixturePath);

      const mainStats = Array.from(data.stats.values()).find((s) => s.name === '{main}');
      expect(mainStats).toBeDefined();
      expect(mainStats!.selfCost).toBe(Cost(500));
      expect(mainStats!.line).toBe(1);
    });

    it('tracks call counts', async () => {
      const data = await parse(fixturePath);

      const pdoStats = Array.from(data.stats.values()).find((s) => s.name === 'PDO->query');
      expect(pdoStats).toBeDefined();
      expect(pdoStats!.calls).toBe(Cost(10));
    });

    it('builds call edges', async () => {
      const data = await parse(fixturePath);

      const serviceId = Array.from(data.functions.entries()).find(([, f]) =>
        f.name.includes('UserService'),
      )?.[0];

      const repoId = Array.from(data.functions.entries()).find(([, f]) =>
        f.name.includes('UserRepository'),
      )?.[0];

      const edge = data.edges.find((e) => e.callerId === serviceId && e.calleeId === repoId);

      expect(edge).toBeDefined();
      expect(edge!.calls).toBe(Cost(10));
      expect(edge!.callsiteLine).toBeGreaterThan(0);
    });

    it('tracks per-line costs', async () => {
      const data = await parse(fixturePath);

      const mainStats = Array.from(data.stats.values()).find((s) => s.name === '{main}');

      expect(mainStats).toBeDefined();
      expect(mainStats!.lineCosts.length).toBeGreaterThan(0);
    });

    it('reports progress during parsing', async () => {
      const progressUpdates: number[] = [];

      await parse(fixturePath, (progress) => {
        progressUpdates.push(progress.percent);
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
    });
  });

  describe('Valgrind/C++ profiles', () => {
    const fixturePath = fixture('valgrind.callgrind');

    it('parses valgrind output correctly', async () => {
      const data = await parse(fixturePath);

      expect(data.eventTypes).toEqual(['Ir', 'Dr', 'Dw']);
      expect(data.totalCosts).toEqual(costs(766_500, 123_700, 60_850));
      expect(data.functions.size).toBeGreaterThan(0);
    });

    it('handles C++ template function names', async () => {
      const data = await parse(fixturePath);

      const names = Array.from(data.functions.values()).map((f) => f.name);

      expect(names).toContain('main');
      expect(names).toContain('std::vector<int>::push_back(int const&)');
      expect(names).toContain('std::sort<int*, std::less<int>>');
      expect(names).toContain('malloc');
    });

    it('tracks multiple cost metrics', async () => {
      const data = await parse(fixturePath);

      const mainStats = Array.from(data.stats.values()).find((s) => s.name === 'main');
      expect(mainStats).toBeDefined();
      expect(mainStats!.selfCosts.length).toBe(3);
      expect(mainStats!.line).toBe(16);

      const sortStats = Array.from(data.stats.values()).find((s) => s.name.startsWith('std::sort'));
      expect(sortStats).toBeDefined();
      expect(sortStats!.line).toBe(120);
    });

    it('uses the call cost position as the callsite', async () => {
      const data = await parse(fixturePath);
      const mainId = Array.from(data.functions.entries()).find(([, fn]) => fn.name === 'main')?.[0];
      const sortId = Array.from(data.functions.entries()).find(([, fn]) =>
        fn.name.startsWith('std::sort'),
      )?.[0];

      const edge = data.edges.find(
        (candidate) => candidate.callerId === mainId && candidate.calleeId === sortId,
      );

      expect(edge).toBeDefined();
      expect(edge!.callsiteLine).toBe(22);
    });
  });

  describe('Python/pyprof2calltree profiles', () => {
    const fixturePath = fixture('python.callgrind');

    it('parses python profiler output correctly', async () => {
      const data = await parse(fixturePath);

      expect(data.eventType).toBe('Time');
      expect(compareCosts(data.totalCost, ZERO_COST)).toBeGreaterThan(0);
      expect(data.functions.size).toBeGreaterThan(0);
    });

    it('handles Python module paths', async () => {
      const data = await parse(fixturePath);

      const names = Array.from(data.functions.values()).map((f) => f.name);

      expect(names).toContain('main');
      expect(names).toContain('process_data');
      expect(names).toContain('User.__init__');
      expect(names).toContain('pandas._libs.lib.maybe_convert_objects');
      expect(names).toContain('numpy.core._methods._mean');
    });

    it('tracks calls through library boundaries', async () => {
      const data = await parse(fixturePath);

      const processDataId = Array.from(data.functions.entries()).find(
        ([, f]) => f.name === 'process_data',
      )?.[0];

      const pandasId = Array.from(data.functions.entries()).find(([, f]) =>
        f.name.includes('pandas'),
      )?.[0];

      expect(processDataId).toBeDefined();
      expect(pandasId).toBeDefined();

      const edge = data.edges.find((e) => e.callerId === processDataId && e.calleeId === pandasId);
      expect(edge).toBeDefined();
    });
  });

  describe('multi-metric profiles', () => {
    const fixturePath = fixture('cachegrind.out.complex');

    it('parses multiple event types', async () => {
      const data = await parse(fixturePath);

      expect(data.eventTypes).toEqual(['Time', 'Memory']);
      expect(data.totalCosts.length).toBe(2);
    });

    it('tracks costs per metric', async () => {
      const data = await parse(fixturePath);

      const mainStats = Array.from(data.stats.values()).find((s) => s.name === '{main}');
      expect(mainStats).toBeDefined();
      expect(mainStats!.selfCosts.length).toBe(2);
      expect(mainStats!.totalCosts.length).toBe(2);
    });
  });

  describe('format regressions', () => {
    it('decodes every declared and compressed position column', async () => {
      const data = await parseContent(`
        positions:\tinstr\tline
        events:\tIr\tDr
        fl=compressed.cpp
        fn=caller
        0x1000   10\t1  2
        +4 * 3 4
        +4 +2 5 6
        +4 -1 7 8
        cfn=callee
        calls=1\t0x2000\t20
        +4 +1 30 40
        fn=callee
        0x2000 20 9 10
      `);

      const caller = Array.from(data.stats.values()).find((stats) => stats.name === 'caller');
      const edge = data.edges[0];

      expect(data.eventTypes).toEqual(['Ir', 'Dr']);
      expect(caller).toBeDefined();
      expect(caller!.line).toBe(10);
      expect(caller!.selfCosts).toEqual(costs(16, 20));
      expect(caller!.totalCosts).toEqual(costs(46, 60));
      expect(edge.callsiteLine).toBe(12);
      expect(edge.inclusiveCosts).toEqual(costs(30, 40));
    });

    it('does not carry a malformed pending call into a later function', async () => {
      const data = await parseContent(`
        events: Ir
        fl=caller.c
        fn=caller
        1 1
        cfn=callee
        calls=1 2
        +invalid 5
        fl=other.c
        fn=other
        30 7
      `);

      const other = Array.from(data.stats.values()).find((stats) => stats.name === 'other');

      expect(data.edges).toEqual([]);
      expect(other?.selfCosts).toEqual(costs(7));
    });

    it('preserves large counters through parsing, accumulation, and serialization', async () => {
      const data = await parseContent(`
        events: Ir Dr
        fl=large.c
        fn=main
        1 9007199254740993 18446744073709551615
        2 9007199254740993 1
        cfn=worker
        calls=18446744073709551615 3
        2 18446744073709551615 9007199254740993
        fn=worker
        3 1 1
        totals: 18464758472219033601 18455751272964292609
      `);

      const main = Array.from(data.stats.values()).find((stats) => stats.name === 'main');
      const edge = data.edges[0];

      expect(data.totalCosts).toEqual(costs('18464758472219033601', '18455751272964292609'));
      expect(main?.selfCosts).toEqual(costs('18014398509481986', '18446744073709551616'));
      expect(main?.totalCosts).toEqual(costs('18464758472219033601', '18455751272964292609'));
      expect(edge.calls).toBe(Cost('18446744073709551615'));
      expect(edge.inclusiveCosts).toEqual(costs('18446744073709551615', '9007199254740993'));
    });

    it('parses hexadecimal counters without narrowing them', async () => {
      const data = await parseContent(`
        events: Ir
        fl=hex.c
        fn=main
        1 0xffffffffffffffff
        totals: 0xffffffffffffffff
      `);

      const main = Array.from(data.stats.values()).find((stats) => stats.name === 'main');

      expect(data.totalCost).toBe(Cost('18446744073709551615'));
      expect(main?.selfCost).toBe(Cost('18446744073709551615'));
    });

    it('accumulates parts and aligns reordered event names', async () => {
      const data = await parseContent(`
        part: 1
        positions: line
        events: Ir Dr
        fl=parts.c
        fn=main
        1 10 100
        summary: 12 120
        part: 2
        positions: line
        events:\tDr\tIr Extra
        fl=parts.c
        fn=main
        1   200\t20 3
        summary: 240 24 4
      `);

      const main = Array.from(data.stats.values()).find((stats) => stats.name === 'main');

      expect(data.eventTypes).toEqual(['Ir', 'Dr', 'Extra']);
      expect(data.totalCosts).toEqual(costs(36, 360, 4));
      expect(main?.selfCosts).toEqual(costs(30, 300, 3));
    });

    it('retains inclusive costs when the first metric is zero', async () => {
      const data = await parseContent(`
        events: Zero Work
        fl=metrics.c
        fn=caller
        1 0 0
        cfn=callee
        calls=1 2
        1 0 10
        fn=callee
        2 0 0
        summary: 0 10
      `);

      const caller = Array.from(data.stats.values()).find((stats) => stats.name === 'caller');

      expect(caller?.selfCosts).toEqual(costs(0, 0));
      expect(caller?.totalCosts).toEqual(costs(0, 10));
    });

    it(
      'builds a 3,000-function call graph without quadratic edge scans',
      { timeout: 15_000 },
      async () => {
        const lines = ['positions: line', 'events: Ir', 'fl=synthetic.c'];

        for (let index = 0; index < 3_000; index += 1) {
          lines.push(`fn=function_${index}`, `${index + 1} 1`);
          if (index < 2_999) {
            lines.push(`cfn=function_${index + 1}`, `calls=1 ${index + 2}`, `${index + 1} 1`);
          }
        }

        const startedAt = performance.now();
        const data = await parseContent(lines.join('\n'));
        const elapsed = performance.now() - startedAt;

        expect(data.functions.size).toBe(3_000);
        expect(data.edges).toHaveLength(2_999);
        expect(elapsed).toBeLessThan(4_000);
      },
    );
  });
});
