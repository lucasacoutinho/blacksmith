import { describe, it, expect } from 'vitest';
import { parseCallgrindFile } from '../src/parser';
import * as path from 'path';

const fixture = (name: string) => path.join(__dirname, 'fixtures', name);

describe('callgrind parser', () => {
  describe('PHP/Xdebug profiles', () => {
    const fixturePath = fixture('sample.callgrind');

    it('parses sample file correctly', async () => {
      const data = await parseCallgrindFile(fixturePath);

      expect(data.eventType).toBe('Time');
      expect(data.totalCost).toBeGreaterThan(0);
      expect(data.functions.size).toBeGreaterThan(0);
      expect(data.edges.length).toBeGreaterThan(0);
    });

    it('extracts function names correctly', async () => {
      const data = await parseCallgrindFile(fixturePath);

      const names = Array.from(data.functions.values()).map((f) => f.name);

      expect(names).toContain('{main}');
      expect(names).toContain('App\\Controller\\HomeController->index');
      expect(names).toContain('App\\Service\\UserService->getUsers');
      expect(names).toContain('App\\Repository\\UserRepository->findAll');
      expect(names).toContain('PDO->query');
    });

    it('computes self costs correctly', async () => {
      const data = await parseCallgrindFile(fixturePath);

      const mainStats = Array.from(data.stats.values()).find(
        (s) => s.name === '{main}'
      );
      expect(mainStats).toBeDefined();
      expect(mainStats!.selfCost).toBe(500);
    });

    it('tracks call counts', async () => {
      const data = await parseCallgrindFile(fixturePath);

      const pdoStats = Array.from(data.stats.values()).find(
        (s) => s.name === 'PDO->query'
      );
      expect(pdoStats).toBeDefined();
      expect(pdoStats!.calls).toBe(10);
    });

    it('builds call edges', async () => {
      const data = await parseCallgrindFile(fixturePath);

      const serviceId = Array.from(data.functions.entries()).find(
        ([, f]) => f.name.includes('UserService')
      )?.[0];

      const repoId = Array.from(data.functions.entries()).find(
        ([, f]) => f.name.includes('UserRepository')
      )?.[0];

      const edge = data.edges.find(
        (e) => e.callerId === serviceId && e.calleeId === repoId
      );

      expect(edge).toBeDefined();
      expect(edge!.calls).toBe(10);
    });

    it('reports progress during parsing', async () => {
      const progressUpdates: number[] = [];

      await parseCallgrindFile(fixturePath, (progress) => {
        progressUpdates.push(progress.percent);
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
    });
  });

  describe('Valgrind/C++ profiles', () => {
    const fixturePath = fixture('valgrind.callgrind');

    it('parses valgrind output correctly', async () => {
      const data = await parseCallgrindFile(fixturePath);

      expect(data.eventTypes).toEqual(['Ir', 'Dr', 'Dw']);
      expect(data.totalCost).toBeGreaterThan(0);
      expect(data.functions.size).toBeGreaterThan(0);
    });

    it('handles C++ template function names', async () => {
      const data = await parseCallgrindFile(fixturePath);

      const names = Array.from(data.functions.values()).map((f) => f.name);

      expect(names).toContain('main');
      expect(names).toContain('std::vector<int>::push_back(int const&)');
      expect(names).toContain('std::sort<int*, std::less<int>>');
      expect(names).toContain('malloc');
    });

    it('tracks multiple cost metrics', async () => {
      const data = await parseCallgrindFile(fixturePath);

      const mainStats = Array.from(data.stats.values()).find(
        (s) => s.name === 'main'
      );
      expect(mainStats).toBeDefined();
      expect(mainStats!.selfCosts.length).toBe(3);
    });
  });

  describe('Python/pyprof2calltree profiles', () => {
    const fixturePath = fixture('python.callgrind');

    it('parses python profiler output correctly', async () => {
      const data = await parseCallgrindFile(fixturePath);

      expect(data.eventType).toBe('Time');
      expect(data.totalCost).toBeGreaterThan(0);
      expect(data.functions.size).toBeGreaterThan(0);
    });

    it('handles Python module paths', async () => {
      const data = await parseCallgrindFile(fixturePath);

      const names = Array.from(data.functions.values()).map((f) => f.name);

      expect(names).toContain('main');
      expect(names).toContain('process_data');
      expect(names).toContain('User.__init__');
      expect(names).toContain('pandas._libs.lib.maybe_convert_objects');
      expect(names).toContain('numpy.core._methods._mean');
    });

    it('tracks calls through library boundaries', async () => {
      const data = await parseCallgrindFile(fixturePath);

      const processDataId = Array.from(data.functions.entries()).find(
        ([, f]) => f.name === 'process_data'
      )?.[0];

      const pandasId = Array.from(data.functions.entries()).find(
        ([, f]) => f.name.includes('pandas')
      )?.[0];

      expect(processDataId).toBeDefined();
      expect(pandasId).toBeDefined();

      const edge = data.edges.find(
        (e) => e.callerId === processDataId && e.calleeId === pandasId
      );
      expect(edge).toBeDefined();
    });
  });

  describe('multi-metric profiles', () => {
    const fixturePath = fixture('cachegrind.out.complex');

    it('parses multiple event types', async () => {
      const data = await parseCallgrindFile(fixturePath);

      expect(data.eventTypes).toEqual(['Time', 'Memory']);
      expect(data.totalCosts.length).toBe(2);
    });

    it('tracks costs per metric', async () => {
      const data = await parseCallgrindFile(fixturePath);

      const mainStats = Array.from(data.stats.values()).find(
        (s) => s.name === '{main}'
      );
      expect(mainStats).toBeDefined();
      expect(mainStats!.selfCosts.length).toBe(2);
      expect(mainStats!.totalCosts.length).toBe(2);
    });
  });
});
