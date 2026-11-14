import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'Shared/src/**/*.test.ts',
      'Backend/src/**/*.test.ts',
      'qa/**/*.test.ts',
      'Research/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 60_000,
  },
});
