import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['test/integration/**'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
