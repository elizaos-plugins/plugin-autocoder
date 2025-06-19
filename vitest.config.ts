import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test-key/**',
      'data',
      'test-single-plugin',
      '**/e2e/**',
      '**/test-data/**',
      '**/test-helpers/**',
      '**/resources/templates/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@elizaos/core': path.resolve(__dirname, '../core/src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
