import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'packages/core/vitest.config.ts',
      'packages/cli/vitest.config.ts',
      'packages/server/vitest.config.ts',
    ],
  },
});
