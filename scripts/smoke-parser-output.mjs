import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const parser = require(path.join(repositoryRoot, 'dist', 'parser', 'callgrind.js'));
const exports = Object.keys(parser);
if (exports.length !== 1 || exports[0] !== 'parse') {
  throw new Error(`Production parser exposed unexpected exports: ${exports.join(', ')}`);
}
const fixture = await readFile(
  path.join(repositoryRoot, 'test', 'fixtures', 'sample.callgrind'),
  'utf8',
);
const data = parser.parse(fixture, (_percent, _functionCount, _currentFunction) => {});

if (data.functions.length === 0 || data.edges.length === 0) {
  throw new Error('Production parser smoke test returned no functions or call edges.');
}

if (typeof data.totalCost !== 'string') {
  throw new Error('Production parser did not serialize counters as exact decimal strings.');
}

console.log(
  `Parser smoke passed with ${data.functions.length} functions and ${data.edges.length} edges.`,
);
