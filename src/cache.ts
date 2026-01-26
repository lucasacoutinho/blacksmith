import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Effect, pipe, Data, Brand } from 'effect';
import type { SerializedProfileData } from './types';

type FilePath = string & Brand.Brand<'FilePath'>;
type CacheKey = string & Brand.Brand<'CacheKey'>;

const FilePath = Brand.nominal<FilePath>();
const CacheKey = Brand.nominal<CacheKey>();

class FileStatError extends Data.TaggedError('FileStatError')<{
  readonly path: FilePath;
  readonly cause: unknown;
}> {}

class CacheStaleError extends Data.TaggedError('CacheStaleError')<{
  readonly path: FilePath;
}> {}

const CACHE_VERSION = 1;
const CACHE_PREFIX = `profile_cache_v${CACHE_VERSION}_`;

interface CacheEntry {
  readonly mtime: number;
  readonly size: number;
  readonly data: SerializedProfileData;
}

interface FileStat {
  readonly mtimeMs: number;
  readonly size: number;
}

const hashPath = (path: FilePath): string =>
  crypto.createHash('md5').update(path).digest('hex').slice(0, 16);

const toCacheKey = (path: FilePath): CacheKey =>
  CacheKey(CACHE_PREFIX + hashPath(path));

const isValidEntry = (entry: CacheEntry, stat: FileStat): boolean =>
  entry.mtime === stat.mtimeMs && entry.size === stat.size;

const statFile = (path: FilePath): Effect.Effect<FileStat, FileStatError> =>
  Effect.tryPromise({
    try: () => fs.promises.stat(path),
    catch: (cause) => new FileStatError({ path, cause }),
  });

const validateEntry = (
  path: FilePath,
  entry: CacheEntry,
  stat: FileStat
): Effect.Effect<SerializedProfileData, CacheStaleError> =>
  isValidEntry(entry, stat)
    ? Effect.succeed(entry.data)
    : Effect.fail(new CacheStaleError({ path }));

export class ProfileCache {
  constructor(private readonly storage: vscode.Memento) {}

  get(filePath: string): Promise<SerializedProfileData | null> {
    const path = FilePath(filePath);
    const key = toCacheKey(path);
    const entry = this.storage.get<CacheEntry>(key);

    if (!entry) return Promise.resolve(null);

    return Effect.runPromise(
      pipe(
        statFile(path),
        Effect.flatMap((stat) => validateEntry(path, entry, stat)),
        Effect.catchAll(() => Effect.succeed(null as SerializedProfileData | null))
      )
    );
  }

  set(filePath: string, data: SerializedProfileData): Promise<void> {
    const path = FilePath(filePath);
    const key = toCacheKey(path);

    const createEntry = (stat: FileStat): CacheEntry => ({
      mtime: stat.mtimeMs,
      size: stat.size,
      data,
    });

    return Effect.runPromise(
      pipe(
        statFile(path),
        Effect.map(createEntry),
        Effect.flatMap((entry) =>
          Effect.promise(() => this.storage.update(key, entry))
        ),
        Effect.catchAll(() => Effect.void)
      )
    );
  }

  async clear(): Promise<number> {
    const keys = this.storage.keys().filter((k) => k.startsWith(CACHE_PREFIX));
    await Promise.all(keys.map((k) => this.storage.update(k, undefined)));
    return keys.length;
  }

  async invalidate(filePath: string): Promise<void> {
    await this.storage.update(toCacheKey(FilePath(filePath)), undefined);
  }
}
