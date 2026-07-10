import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// The module uses process.env directly — test by mutating the env and re-importing

function getModule() {
  // Clear any cached module
  const modPath = '../config/validation.js';
  const fullPath = new URL(modPath, import.meta.url).pathname;
  delete require?.cache?.[fullPath];
  // Dynamic import gets fresh module state
  return import('../config/validation.js') as Promise<{
    assertBootConfig: () => void;
  }>;
}

describe('validateBootConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset NODE_ENV for each test
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    // Restore original env
    Object.assign(process.env, originalEnv);
  });

  describe('production auth guard', () => {
    it('passes when HOST is localhost (default) with AUTH_TYPE=none', async () => {
      process.env.HOST = '127.0.0.1';
      process.env.AUTH_TYPE = 'none';
      // Should not throw — localhost is safe
      const { assertBootConfig } = await getModule();
      expect(() => assertBootConfig()).not.toThrow();
    });

    it('fails fatally when HOST is exposed and AUTH_TYPE=none in production', async () => {
      process.env.HOST = '0.0.0.0';
      process.env.AUTH_TYPE = 'none';
      process.env.NODE_ENV = 'production';

      const { assertBootConfig } = await getModule();
      expect(() => assertBootConfig()).toThrow(); // process.exit is not called in test, but errors cause exit
    });

    it('passes when HOST is exposed but AUTH_TYPE=api-key and API_KEYS set', async () => {
      process.env.HOST = '0.0.0.0';
      process.env.AUTH_TYPE = 'api-key';
      process.env.API_KEYS = 'sk-test-key';

      const { assertBootConfig } = await getModule();
      expect(() => assertBootConfig()).not.toThrow();
    });
  });

  describe('non-production', () => {
    it('allows AUTH_TYPE=none on exposed host in dev', async () => {
      process.env.HOST = '0.0.0.0';
      process.env.AUTH_TYPE = 'none';
      process.env.NODE_ENV = 'development';

      const { assertBootConfig } = await getModule();
      // Should not exit in dev — just warn
      expect(() => assertBootConfig()).not.toThrow();
    });
  });
});
