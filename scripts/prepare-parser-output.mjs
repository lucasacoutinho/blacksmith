import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(repositoryRoot, 'dist', 'parser');

await rm(destination, { recursive: true, force: true, maxRetries: 3 });
await mkdir(destination, { recursive: true });
