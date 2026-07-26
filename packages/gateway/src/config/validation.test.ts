import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The module uses process.env directly — test by mutating the env and re-importing

function getModule() {
  // ESM modules are cached by URL — dynamic import returns the same instance
  // on repeated calls, so env changes at call-time are what matter.
  return import('../config/validation.js') as Promise<{
    assertBootConfig: () => void;
  }>;
}

describe('validateBootConfig', () => {
  const originalEnv = { ...process.env };
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset env to a valid production baseline — the validation checks
    // multiple env vars (MEMORY_SALT, POSTGRES_PASSWORD, db config, etc.)
    // that are NOT set in test and would all trigger production errors.
    // Set safe production values so only the tested dimension causes a failure.
    Object.assign(process.env, {
      NODE_ENV: 'production',
      MEMORY_SALT: 'test-non-default-salt-for-testing',
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_PORT: '25432',
      POSTGRES_DB: 'ownpilot_test',
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test-non-default-password-for-testing',
      JWT_SECRET: 'test-generated-unique-64-char-secret-abcdef1234567890-abcdef123456', // 64+ chars, no trivial pattern
    });
    // Spy on process.exit so we can assert it was (or wasn't) called
    // without actually terminating the worker process.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error(`process.exit unexpectedly called`);
    }) as unknown as (code?: number) => never);
  });

  afterEach(() => {
    // Restore original env
    Object.assign(process.env, originalEnv);
    exitSpy.mockRestore();
  });

  describe('production auth guard', () => {
    it('passes when HOST is localhost (default) with AUTH_TYPE=none', async () => {
      process.env.HOST = '127.0.0.1';
      process.env.AUTH_TYPE = 'none';
      // Should not throw or exit — localhost is safe
      const { assertBootConfig } = await getModule();
      expect(assertBootConfig).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('fails fatally when HOST is exposed and AUTH_TYPE=none in production', async () => {
      process.env.HOST = '0.0.0.0';
      process.env.AUTH_TYPE = 'none';
      process.env.NODE_ENV = 'production';

      const { assertBootConfig } = await getModule();
      expect(() => assertBootConfig()).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('passes when HOST is exposed but AUTH_TYPE=api-key and API_KEYS set', async () => {
      process.env.HOST = '0.0.0.0';
      process.env.AUTH_TYPE = 'api-key';
      process.env.API_KEYS = 'sk-test-key';

      const { assertBootConfig } = await getModule();
      expect(assertBootConfig).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('non-production', () => {
    it('allows AUTH_TYPE=none on exposed host in dev', async () => {
      process.env.HOST = '0.0.0.0';
      process.env.AUTH_TYPE = 'none';
      process.env.NODE_ENV = 'development';

      const { assertBootConfig } = await getModule();
      // Should not exit in dev — just warn
      expect(assertBootConfig).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});
