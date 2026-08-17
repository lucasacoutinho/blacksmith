import * as fs from 'fs';
import { join } from 'path';
import { pipe, Effect, Data } from 'effect';
import type { ProfileData, ParseProgress, SerializedProfileData } from '../types';
import { Cost, FunctionId } from '../types';

interface Parser {
  readonly parse: (
    content: string,
    onProgress: (percent: number, fnCount: number, currentFn: string) => void,
  ) => SerializedProfileData;
}

class ParserNotAvailable extends Data.TaggedError('ParserNotAvailable')<{
  readonly message: string;
}> {}

class FileReadError extends Data.TaggedError('FileReadError')<{
  readonly path: string;
  readonly cause: unknown;
}> {}

const path = (): string => {
  // In production (bundled), __dirname is dist/, parser is at dist/parser/
  // In development/tests, __dirname is src/parser/, parser is in _build/
  const prod = join(__dirname, 'parser', 'callgrind.js');
  const devl = join(__dirname, '_build', 'default', 'dist', 'callgrind.js');

  try {
    require.resolve(devl);
    return devl;
  } catch {
    return prod;
  }
};

const load = (): Effect.Effect<Parser, ParserNotAvailable> =>
  Effect.try({
    try: () => {
      const parsep = path();
      const parser = require(parsep) as Parser;
      if (typeof parser.parse !== 'function') {
        throw new Error('parse is not a function');
      }
      return parser;
    },
    catch: () =>
      new ParserNotAvailable({
        message: `Parser not available at ${path()}. Run 'npm run build:parser' first.`,
      }),
  });

const read = (file: string): Effect.Effect<string, FileReadError> =>
  Effect.tryPromise({
    try: () => fs.promises.readFile(file, 'utf8'),
    catch: (cause) => new FileReadError({ path: file, cause }),
  });

const transform = (raw: SerializedProfileData): ProfileData => {
  // Serialized FunctionIds are plain numbers and need their TypeScript brand restored.
  const functions = new Map(
    raw.functions.map(([id, fn]) => [FunctionId(id), { ...fn, id: FunctionId(id) }]),
  );

  const stats = new Map(
    raw.stats.map(([id, s]) => [
      FunctionId(id),
      {
        ...s,
        id: FunctionId(id),
        selfCost: Cost(s.selfCost),
        totalCost: Cost(s.totalCost),
        selfCosts: s.selfCosts.map(Cost),
        totalCosts: s.totalCosts.map(Cost),
        lineCosts: s.lineCosts.map((entry) => ({
          ...entry,
          costs: entry.costs.map(Cost),
        })),
        calls: Cost(s.calls),
        callers: s.callers.map(FunctionId),
        callees: s.callees.map(FunctionId),
      },
    ]),
  );

  const edges = raw.edges.map((e) => ({
    ...e,
    callerId: FunctionId(e.callerId),
    calleeId: FunctionId(e.calleeId),
    calls: Cost(e.calls),
    inclusive: Cost(e.inclusive),
    exclusive: Cost(e.exclusive),
    inclusiveCosts: e.inclusiveCosts.map(Cost),
  }));

  return {
    functions,
    edges,
    stats,
    totalCost: Cost(raw.totalCost),
    eventType: raw.eventType,
    eventTypes: raw.eventTypes,
    totalCosts: raw.totalCosts.map(Cost),
  };
};

const parseEffect = (
  filePath: string,
  onProgress?: (progress: ParseProgress) => void,
): Effect.Effect<ProfileData, ParserNotAvailable | FileReadError> =>
  pipe(
    Effect.all([load(), read(filePath)]),
    Effect.map(([parser, content]) => {
      const raw = parser.parse(content, (percent, fnCount, currentFn) =>
        onProgress?.({ percent, functionCount: fnCount, currentFunction: currentFn }),
      );
      return transform(raw);
    }),
  );

export const parse = async (
  filePath: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ProfileData> =>
  Effect.runPromise(
    pipe(
      parseEffect(filePath, onProgress),
      Effect.mapError(
        (e) => new Error(e._tag === 'FileReadError' ? `Failed to read ${e.path}` : e.message),
      ),
    ),
  );
