import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import { FunctionId, type SerializedProfileData } from '../src/types';

class MockMemento {
  private data = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.data.delete(key);
    } else {
      this.data.set(key, value);
    }
  }

  keys(): readonly string[] {
    return Array.from(this.data.keys());
  }
}

const loadProfileCache = async () => {
  const mockStat = vi.spyOn(fs.promises, 'stat');
  const { ProfileCache } = await import('../src/cache');
  return { ProfileCache, mockStat };
};

describe('ProfileCache', () => {
  const testFilePath = '/test/profile.callgrind';
  const mockData: SerializedProfileData = {
    functions: [[1, { id: FunctionId(1), name: 'main', file: 'test.php', line: 1 }]],
    edges: [],
    stats: [
      [
        1,
        {
          id: FunctionId(1),
          name: 'main',
          file: 'test.php',
          line: 1,
          selfCost: 100,
          totalCost: 100,
          selfCosts: [100],
          totalCosts: [100],
          lineCosts: [],
          calls: 1,
          callers: [],
          callees: [],
        },
      ],
    ],
    totalCost: 100,
    eventType: 'Time',
    eventTypes: ['Time'],
    totalCosts: [100],
  };

  it('returns null for uncached files', async () => {
    const { ProfileCache, mockStat } = await loadProfileCache();
    mockStat.mockResolvedValue({ mtimeMs: 1000, size: 500 } as fs.Stats);

    const cache = new ProfileCache(new MockMemento() as never);
    const result = await cache.get(testFilePath);

    expect(result).toBeNull();
    mockStat.mockRestore();
  });

  it('stores and retrieves cached data', async () => {
    const { ProfileCache, mockStat } = await loadProfileCache();
    mockStat.mockResolvedValue({ mtimeMs: 1000, size: 500 } as fs.Stats);

    const cache = new ProfileCache(new MockMemento() as never);
    await cache.set(testFilePath, mockData);
    const result = await cache.get(testFilePath);

    expect(result).toEqual(mockData);
    mockStat.mockRestore();
  });

  it('invalidates cache when mtime changes', async () => {
    const { ProfileCache, mockStat } = await loadProfileCache();
    const cache = new ProfileCache(new MockMemento() as never);

    mockStat.mockResolvedValue({ mtimeMs: 1000, size: 500 } as fs.Stats);
    await cache.set(testFilePath, mockData);

    mockStat.mockResolvedValue({ mtimeMs: 2000, size: 500 } as fs.Stats);
    const result = await cache.get(testFilePath);

    expect(result).toBeNull();
    mockStat.mockRestore();
  });

  it('invalidates cache when size changes', async () => {
    const { ProfileCache, mockStat } = await loadProfileCache();
    const cache = new ProfileCache(new MockMemento() as never);

    mockStat.mockResolvedValue({ mtimeMs: 1000, size: 500 } as fs.Stats);
    await cache.set(testFilePath, mockData);

    mockStat.mockResolvedValue({ mtimeMs: 1000, size: 600 } as fs.Stats);
    const result = await cache.get(testFilePath);

    expect(result).toBeNull();
    mockStat.mockRestore();
  });

  it('clears all cached entries', async () => {
    const { ProfileCache, mockStat } = await loadProfileCache();
    mockStat.mockResolvedValue({ mtimeMs: 1000, size: 500 } as fs.Stats);

    const cache = new ProfileCache(new MockMemento() as never);
    await cache.set('/test/file1.callgrind', mockData);
    await cache.set('/test/file2.callgrind', mockData);

    const cleared = await cache.clear();
    expect(cleared).toBe(2);

    expect(await cache.get('/test/file1.callgrind')).toBeNull();
    expect(await cache.get('/test/file2.callgrind')).toBeNull();
    mockStat.mockRestore();
  });

  it('invalidates specific file cache', async () => {
    const { ProfileCache, mockStat } = await loadProfileCache();
    mockStat.mockResolvedValue({ mtimeMs: 1000, size: 500 } as fs.Stats);

    const cache = new ProfileCache(new MockMemento() as never);
    await cache.set(testFilePath, mockData);
    await cache.invalidate(testFilePath);

    const result = await cache.get(testFilePath);
    expect(result).toBeNull();
    mockStat.mockRestore();
  });
});
