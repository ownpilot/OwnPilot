import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
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
      ],
    },
    typecheck: {
      enabled: true,
    },
  },
});
