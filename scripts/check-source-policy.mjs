import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const ignoredDirectories = new Set([
  '.git',
  '.opam-switch',
  '.vscode-test',
  '_build',
  'dist',
  'node_modules',
]);
const sourceExtensions = new Set(['.cts', '.mts', '.ts', '.tsx']);
const kebabCase = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pascalCase = /^[A-Z][A-Za-z0-9]*$/;
const allowedSuffixes = new Set(['d', 'spec', 'test']);
const prohibitedHook = /\buseEffect\b/;

const files = [];

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(absolutePath);
      } else if (sourceExtensions.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }),
  );
};

const errors = [];
await collectFiles(root);
files.sort();

await Promise.all(
  files.map(async (absolutePath) => {
    const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/');
    const extension = path.extname(absolutePath);
    const nameParts = path.basename(absolutePath, extension).split('.');
    const baseName = nameParts.shift();
    const hasValidSuffixes = nameParts.every((part) => allowedSuffixes.has(part));
    const isComponent = extension === '.tsx' && relativePath.includes('/components/');
    const hasValidName =
      hasValidSuffixes &&
      baseName !== undefined &&
      (isComponent ? pascalCase.test(baseName) : kebabCase.test(baseName));

    if (!hasValidName) {
      const expected = isComponent ? 'PascalCase.tsx' : 'kebab-case.ts or kebab-case.tsx';
      errors.push(`${relativePath}: expected ${expected}`);
    }

    const source = await readFile(absolutePath, 'utf8');
    if (prohibitedHook.test(source)) {
      errors.push(`${relativePath}: useEffect is prohibited`);
    }
  }),
);
errors.sort();

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Source policy passed for ${files.length} TypeScript files.`);
}
