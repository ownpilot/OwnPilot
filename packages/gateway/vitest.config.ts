import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Note: Previously, an alias collapsed @ownpilot/core/* sub-path imports
  // onto the barrel so that vi.mock('@ownpilot/core') would intercept all
  // sub-path imports. This is no longer needed — all test files now use
  // sub-path-specific vi.mock() calls (e.g. vi.mock('@ownpilot/core/services')).
  // Keeping the alias would cause multiple sub-path mocks to collide on the
  // same resolved module. See docs/ADR/vi-mock-sub-path-alignment.md.
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    // 30s, not 15s. Several suites here are import-bound rather than slow:
    // they pull in real module graphs (e.g. shutdown-cleanup dynamically
    // imports every service resetter; health.test.ts imports the app). Run
    // alone they finish in ~5s, but under full-suite parallelism across 470
    // files the aggregate import cost (~590s) means a single test's *import*
    // can exhaust a 15s budget. At 15s the suite flaked ~2 files per full run,
    // which blocks releases (release.yml runs the suite fresh, uncached) for
    // no real defect. The timeout is a load assumption, not a quality signal.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/*.test.ts',
        '**/test-setup.ts',
        '**/test-helpers.ts',
        'dist/**',
        '**/types.ts',
        '**/index.ts',
        '**/*.d.ts',
        '**/vitest.config.ts',
        'scripts/**',
        '**/seed-database.ts',
        '**/plans-seed.ts',
        'src/db/seeds/**',
        'src/services/log.ts',
        'src/app.ts',
        'src/server.ts',
        'src/channels/plugins/telegram/telegram-api.ts',
        'src/middleware/audit.ts',
        // Pure re-export barrel files — no logic to cover
        'src/routes/extensions.ts',
        'src/routes/custom-tools.ts',
        'src/routes/database.ts',
        'src/routes/model-configs.ts',
        'src/routes/workspaces.ts',
      ],
    },
    typecheck: {
      enabled: true,
    },
  },
});
