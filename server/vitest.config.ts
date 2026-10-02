import { defineConfig } from 'vitest/config';
import { testEnv } from './test/env.js';

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: ['./test/global-setup.ts'],
    include: ['test/**/*.test.ts'],
    // The test files share one database and Redis instance, so they run one at a time.
    fileParallelism: false,
  },
});
