import { defineConfig } from 'vitest/config';

/** Live AWS calls are slow and rate-limited; the unit suite's default would flake on them. */
const INTEGRATION_TIMEOUT_MS = 60_000;

export default defineConfig({
  test: {
    // Two projects rather than one suite with skips. `bun run test` must be safe to run anywhere
    // — no credentials, no network — while the integration project is free to fail hard the
    // moment its configuration is missing.
    projects: [
      {
        test: {
          name: 'unit',
          root: import.meta.dirname,
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          root: import.meta.dirname,
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: INTEGRATION_TIMEOUT_MS,
          hookTimeout: INTEGRATION_TIMEOUT_MS,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'tests/support/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
