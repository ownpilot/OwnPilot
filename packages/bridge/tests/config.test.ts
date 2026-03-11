import { describe, it, expect, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Config tests — env var parsing, defaults, validation
//
// Strategy: mock node:fs readFileSync so loadDotEnv() always fails (no .env
// file interference), then control process.env directly per test.
// vi.resetModules() + dynamic import lets each test load a fresh config.
// ---------------------------------------------------------------------------

// Prevent config.ts loadDotEnv() from reading .env on disk.
// loadDotEnv() wraps readFileSync in a try-catch, so throwing is safe.
vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs')>();
  return {
    ...mod,
    readFileSync: (path: unknown, ...args: unknown[]) => {
      if (typeof path === 'string' && path.endsWith('.env')) {
        throw Object.assign(new Error('ENOENT: no .env'), { code: 'ENOENT' });
      }
      // Delegate everything else to the real readFileSync
      return (mod.readFileSync as Function)(path, ...args);
    },
  };
});

const ORIGINAL_ENV = { ...process.env };

const CONFIG_KEYS = [
  'PORT', 'BRIDGE_API_KEY', 'ANTHROPIC_API_KEY', 'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL', 'MINIMAX_MODEL', 'CLAUDE_MODEL', 'CC_SPAWN_TIMEOUT_MS',
  'CLAUDE_MAX_BUDGET_USD', 'DEFAULT_PROJECT_DIR', 'IDLE_TIMEOUT_MS', 'NODE_ENV',
  'MAX_CONCURRENT_PER_PROJECT', 'MAX_SESSIONS_PER_PROJECT', 'CLAUDE_PATH',
] as const;

function setEnv(vars: Partial<Record<string, string>>): void {
  for (const k of CONFIG_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
}

async function importConfig() {
  vi.resetModules();
  const mod = await import('../src/config.ts');
  return mod.config;
}

afterEach(() => {
  // Restore original env
  for (const k of CONFIG_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v !== undefined) process.env[k] = v;
  }
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Shape / structure
// ---------------------------------------------------------------------------

describe('config shape', () => {
  it('has all expected top-level fields', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();

    expect(config).toHaveProperty('port');
    expect(config).toHaveProperty('bridgeApiKey');
    expect(config).toHaveProperty('anthropicApiKey');
    expect(config).toHaveProperty('minimaxApiKey');
    expect(config).toHaveProperty('minimaxBaseUrl');
    expect(config).toHaveProperty('minimaxModel');
    expect(config).toHaveProperty('claudeModel');
    expect(config).toHaveProperty('ccSpawnTimeoutMs');
    expect(config).toHaveProperty('claudeMaxBudgetUsd');
    expect(config).toHaveProperty('defaultProjectDir');
    expect(config).toHaveProperty('idleTimeoutMs');
    expect(config).toHaveProperty('nodeEnv');
    expect(config).toHaveProperty('maxConcurrentPerProject');
    expect(config).toHaveProperty('maxSessionsPerProject');
    expect(config).toHaveProperty('allowedTools');
    expect(config).toHaveProperty('claudePath');
    expect(config).toHaveProperty('mcpServers');
  });

  it('allowedTools is a non-empty array', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();
    expect(Array.isArray(config.allowedTools)).toBe(true);
    expect(config.allowedTools.length).toBeGreaterThan(0);
  });

  it('allowedTools includes Bash, Edit, Read, Write', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();
    expect(config.allowedTools).toContain('Bash');
    expect(config.allowedTools).toContain('Edit');
    expect(config.allowedTools).toContain('Read');
    expect(config.allowedTools).toContain('Write');
  });
});

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

describe('default values when env vars not set', () => {
  it('port defaults to 9090', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();
    expect(config.port).toBe(9090);
  });

  it('idleTimeoutMs defaults to 1_800_000 (30 min)', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();
    expect(config.idleTimeoutMs).toBe(1_800_000);
  });

  it('maxConcurrentPerProject defaults to 5', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();
    expect(config.maxConcurrentPerProject).toBe(5);
  });

  it('maxSessionsPerProject defaults to 100', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();
    expect(config.maxSessionsPerProject).toBe(100);
  });

  it('claudeMaxBudgetUsd defaults to 5', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();
    expect(config.claudeMaxBudgetUsd).toBe(5);
  });

  it('nodeEnv defaults to development', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();
    expect(config.nodeEnv).toBe('development');
  });

  it('anthropicApiKey defaults to empty string', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();
    expect(config.anthropicApiKey).toBe('');
  });

  it('minimaxApiKey defaults to empty string', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key' });
    const config = await importConfig();
    expect(config.minimaxApiKey).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Env var parsing
// ---------------------------------------------------------------------------

describe('PORT parsing', () => {
  it('reads PORT from env as integer', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key', PORT: '8080' });
    const config = await importConfig();
    expect(config.port).toBe(8080);
  });

  it('throws on non-numeric PORT', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key', PORT: 'not-a-number' });
    await expect(importConfig()).rejects.toThrow(/PORT must be an integer/);
  });
});

describe('BRIDGE_API_KEY', () => {
  it('reads bridgeApiKey from env', async () => {
    setEnv({ BRIDGE_API_KEY: 'my-secret-key' });
    const config = await importConfig();
    expect(config.bridgeApiKey).toBe('my-secret-key');
  });

  it('throws when BRIDGE_API_KEY is missing', async () => {
    setEnv({});
    await expect(importConfig()).rejects.toThrow(/BRIDGE_API_KEY/);
  });
});

describe('MAX_CONCURRENT_PER_PROJECT parsing', () => {
  it('reads MAX_CONCURRENT_PER_PROJECT from env', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key', MAX_CONCURRENT_PER_PROJECT: '3' });
    const config = await importConfig();
    expect(config.maxConcurrentPerProject).toBe(3);
  });
});

describe('IDLE_TIMEOUT_MS parsing', () => {
  it('reads IDLE_TIMEOUT_MS from env', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key', IDLE_TIMEOUT_MS: '60000' });
    const config = await importConfig();
    expect(config.idleTimeoutMs).toBe(60_000);
  });

  it('throws on non-numeric IDLE_TIMEOUT_MS', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key', IDLE_TIMEOUT_MS: 'xyz' });
    await expect(importConfig()).rejects.toThrow(/IDLE_TIMEOUT_MS must be an integer/);
  });
});

describe('CLAUDE_MAX_BUDGET_USD parsing (float)', () => {
  it('reads float value from env', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key', CLAUDE_MAX_BUDGET_USD: '2.5' });
    const config = await importConfig();
    expect(config.claudeMaxBudgetUsd).toBe(2.5);
  });

  it('throws on non-numeric CLAUDE_MAX_BUDGET_USD', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key', CLAUDE_MAX_BUDGET_USD: 'big' });
    await expect(importConfig()).rejects.toThrow(/CLAUDE_MAX_BUDGET_USD must be a number/);
  });
});

describe('string env vars', () => {
  it('reads CLAUDE_MODEL from env', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key', CLAUDE_MODEL: 'claude-custom-1' });
    const config = await importConfig();
    expect(config.claudeModel).toBe('claude-custom-1');
  });

  it('reads NODE_ENV from env', async () => {
    setEnv({ BRIDGE_API_KEY: 'test-key', NODE_ENV: 'production' });
    const config = await importConfig();
    expect(config.nodeEnv).toBe('production');
  });
});
