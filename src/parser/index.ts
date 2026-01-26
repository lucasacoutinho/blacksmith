import * as fs from 'fs';
import * as nodePath from 'path';
import { pipe, Effect, Data } from 'effect';
import type { ProfileData, ParseProgress, SerializedProfileData } from '../types';
import { deserializeProfileData, FunctionId } from '../types';

interface OcamlParser {
  readonly parseCallgrindContent: (
    content: string,
    onProgress: (percent: number, fnCount: number, currentFn: string) => void
  ) => SerializedProfileData;
}

class OcamlParserNotAvailable extends Data.TaggedError('OcamlParserNotAvailable')<{
  readonly message: string;
}> {}

class FileReadError extends Data.TaggedError('FileReadError')<{
  readonly path: string;
  readonly cause: unknown;
}> {}

const getOcamlParserPath = (): string => {
  // In production (bundled), __dirname is dist/, parser is at dist/parser/
  // In development/tests, __dirname is src/parser/, parser is in _build/
  const prodPath = nodePath.join(__dirname, 'parser', 'callgrind.js');
  const devPath = nodePath.join(__dirname, '_build', 'default', 'dist', 'callgrind.js');

  try {
    require.resolve(devPath);
    return devPath;
  } catch {
    return prodPath;
  }
};

const loadOcamlParser = (): Effect.Effect<OcamlParser, OcamlParserNotAvailable> =>
  Effect.try({
    try: () => {
      const parserPath = getOcamlParserPath();
      const parser = require(parserPath) as OcamlParser;
      if (typeof parser.parseCallgrindContent !== 'function') {
        throw new Error('parseCallgrindContent is not a function');
      }
      return parser;
    },
    catch: () => new OcamlParserNotAvailable({
      message: `OCaml parser not available at ${getOcamlParserPath()}. Run 'npm run build:parser' first.`
    }),
  });

const readFileContent = (filePath: string): Effect.Effect<string, FileReadError> =>
  Effect.tryPromise({
    try: () => fs.promises.readFile(filePath, 'utf8'),
    catch: (cause) => new FileReadError({ path: filePath, cause }),
  });

const transformOcamlOutput = (raw: SerializedProfileData): ProfileData => {
  // The OCaml parser outputs FunctionId as plain numbers, need to brand them
  const functions = new Map(
    raw.functions.map(([id, fn]) => [
      FunctionId(id),
      { ...fn, id: FunctionId(id) }
    ])
  );

  const stats = new Map(
    raw.stats.map(([id, s]) => [
      FunctionId(id),
      {
        ...s,
        id: FunctionId(id),
        callers: s.callers.map(FunctionId),
        callees: s.callees.map(FunctionId),
      }
    ])
  );

  const edges = raw.edges.map(e => ({
    ...e,
    callerId: FunctionId(e.callerId),
    calleeId: FunctionId(e.calleeId),
  }));

  return {
    functions,
    edges,
    stats,
    totalCost: raw.totalCost,
    eventType: raw.eventType,
    eventTypes: raw.eventTypes,
    totalCosts: raw.totalCosts,
  };
};

const parseEffect = (
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Effect.Effect<ProfileData, OcamlParserNotAvailable | FileReadError> =>
  pipe(
    Effect.all([loadOcamlParser(), readFileContent(filePath)]),
    Effect.map(([parser, content]) => {
      const raw = parser.parseCallgrindContent(content, (percent, fnCount, currentFn) =>
        onProgress?.({ percent, functionCount: fnCount, currentFunction: currentFn })
      );
      return transformOcamlOutput(raw);
    })
  );

export const parseCallgrindFile = async (
  filePath: string,
  onProgress?: (progress: ParseProgress) => void
): Promise<ProfileData> =>
  Effect.runPromise(
    pipe(
      parseEffect(filePath, onProgress),
      Effect.mapError((e) =>
        new Error(e._tag === 'FileReadError' ? `Failed to read ${e.path}` : e.message)
      )
    )
  );
