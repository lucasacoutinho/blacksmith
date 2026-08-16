import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'dist/test/**/*.test.js',
  version: 'stable',
  launchArgs: ['--disable-extensions', '--disable-gpu'],
  mocha: {
    timeout: 30_000,
  },
});
