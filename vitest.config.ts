import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@sim': resolve(root, 'src/sim'),
      '@net': resolve(root, 'src/net'),
      '@host': resolve(root, 'src/host'),
      '@bots': resolve(root, 'src/bots'),
      '@client': resolve(root, 'src/client'),
      '@data': resolve(root, 'data'),
    },
  },
  test: {
    pool: 'forks',
    maxWorkers: 1,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
