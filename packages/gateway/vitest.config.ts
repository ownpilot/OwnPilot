import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/*.test.ts',
        'dist/**',
        '**/types.ts',
        '**/index.ts',
        '**/*.d.ts',
        '**/vitest.config.ts',
        'scripts/**',
        '**/seed-database.ts',
        '**/plans-seed.ts',
      ],
    },
    typecheck: {
      enabled: true,
    },
  },
});
