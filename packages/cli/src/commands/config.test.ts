/**
 * Config CLI Commands Tests
 *
 * Tests for config.ts — manages API keys and settings stored in the PostgreSQL
 * database. Covers parseKey (via public surface), configSet, configGet,
 * configDelete, configList, setup, configChangePassword, and
 * loadCredentialsToEnv.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Hoisted values referenced inside vi.mock() factories
// ============================================================================

const mockSettingsRepo = vi.hoisted(() => ({
  set: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(null),
  has: vi.fn().mockResolvedValue(false),
  delete: vi.fn().mockResolvedValue(undefined),
  getByPrefix: vi.fn().mockResolvedValue([]),
}));

const mockInitializeAdapter = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetDatabasePath = vi.hoisted(() => vi.fn(() => '/test/db/ownpilot.db'));

// readline question callback — overridden per-test when testing stdin path
const mockQuestion = vi.hoisted(() =>
  vi.fn((prompt: string, cb: (a: string) => void) => cb('test-value'))
);
const mockRlClose = vi.hoisted(() => vi.fn());
const mockRlOn = vi.hoisted(() => vi.fn().mockReturnThis());

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@ownpilot/gateway', () => ({
  initializeAdapter: mockInitializeAdapter,
  settingsRepo: mockSettingsRepo,
  getDatabasePath: mockGetDatabasePath,
}));

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: mockQuestion,
    close: mockRlClose,
    on: mockRlOn,
  })),
}));

// ============================================================================
// Import after mocks are registered
// ============================================================================

import {
  configSet,
  configGet,
  configDelete,
  configList,
  setup,
  configChangePassword,
  loadCredentialsToEnv,
} from './config.js';

// ============================================================================
// Helpers
// ============================================================================

/** Capture all console.log calls as a single joined string */
function logOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c) => c.join(' ')).join('\n');
}

/** Capture all console.error calls as a single joined string */
function errorOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c) => c.join(' ')).join('\n');
}

/** Build a settings row as returned by getByPrefix */
function apiKeyRow(provider: string, value: string) {
  return { key: `api_key:${provider}`, value };
}

// ============================================================================
// Tests
// ============================================================================

describe('Config CLI Commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  // Snapshot of env vars that tests may mutate — restored after each test
  const envSnapshot: Record<string, string | undefined> = {};
  const TRACKED_ENV_VARS = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'ZHIPU_API_KEY',
    'DEEPSEEK_API_KEY',
    'GROQ_API_KEY',
    'TOGETHER_API_KEY',
    'MISTRAL_API_KEY',
    'FIREWORKS_API_KEY',
    'PERPLEXITY_API_KEY',
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      // Throw so async callers can detect the exit without actually terminating
      throw new Error('process.exit');
    }) as ReturnType<typeof vi.spyOn>;

    // Snapshot env vars we may touch
    for (const key of TRACKED_ENV_VARS) {
      envSnapshot[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();

    // Restore env vars
    for (const key of TRACKED_ENV_VARS) {
      if (envSnapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = envSnapshot[key];
      }
    }
  });

  // ==========================================================================
  // parseKey — exercised through the public API functions
  // ==========================================================================

  describe('parseKey() — via configSet', () => {
    // Each sub-test calls configSet and inspects the dbKey passed to settingsRepo.set

    it('maps "openai-api-key" to dbKey "api_key:openai" with isApiKey: true', async () => {
      await configSet({ key: 'openai-api-key', value: 'sk-openai-123' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:openai', 'sk-openai-123');
    });

    it('maps "anthropic-api-key" to dbKey "api_key:anthropic"', async () => {
      await configSet({ key: 'anthropic-api-key', value: 'sk-ant-123' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:anthropic', 'sk-ant-123');
    });

    it('maps "zhipu-api-key" to dbKey "api_key:zhipu"', async () => {
      await configSet({ key: 'zhipu-api-key', value: 'zhipu-secret' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:zhipu', 'zhipu-secret');
    });

    it('maps "deepseek-api-key" to dbKey "api_key:deepseek"', async () => {
      await configSet({ key: 'deepseek-api-key', value: 'ds-key' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:deepseek', 'ds-key');
    });

    it('maps "groq-api-key" to dbKey "api_key:groq"', async () => {
      await configSet({ key: 'groq-api-key', value: 'groq-key' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:groq', 'groq-key');
    });

    it('maps "together-api-key" to dbKey "api_key:together"', async () => {
      await configSet({ key: 'together-api-key', value: 'together-key' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:together', 'together-key');
    });

    it('maps "mistral-api-key" to dbKey "api_key:mistral"', async () => {
      await configSet({ key: 'mistral-api-key', value: 'mistral-key' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:mistral', 'mistral-key');
    });

    it('maps "fireworks-api-key" to dbKey "api_key:fireworks"', async () => {
      await configSet({ key: 'fireworks-api-key', value: 'fw-key' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:fireworks', 'fw-key');
    });

    it('maps "perplexity-api-key" to dbKey "api_key:perplexity"', async () => {
      await configSet({ key: 'perplexity-api-key', value: 'pplx-key' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:perplexity', 'pplx-key');
    });

    it('maps "default_ai_provider" to the same dbKey, isApiKey: false', async () => {
      await configSet({ key: 'default_ai_provider', value: 'openai' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('default_ai_provider', 'openai');
    });

    it('maps "default_ai_model" to the same dbKey', async () => {
      await configSet({ key: 'default_ai_model', value: 'gpt-4o' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('default_ai_model', 'gpt-4o');
    });

    it('maps "telegram_bot_token" to the same dbKey', async () => {
      await configSet({ key: 'telegram_bot_token', value: '123:ABC' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('telegram_bot_token', '123:ABC');
    });

    it('maps "gateway_api_keys" to the same dbKey (sensitive, not apiKey)', async () => {
      await configSet({ key: 'gateway_api_keys', value: 'gw-secret-value' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('gateway_api_keys', 'gw-secret-value');
      // isApiKey is false — no env var should be set for gateway_api_keys
      expect(process.env['GATEWAY_API_KEY']).toBeUndefined();
    });

    it('maps "gateway_jwt_secret" to the same dbKey', async () => {
      await configSet({ key: 'gateway_jwt_secret', value: 'jwt-secret' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('gateway_jwt_secret', 'jwt-secret');
    });

    it('maps "gateway_auth_type" to the same dbKey', async () => {
      await configSet({ key: 'gateway_auth_type', value: 'jwt' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('gateway_auth_type', 'jwt');
    });

    it('maps "gateway_rate_limit_max" to the same dbKey', async () => {
      await configSet({ key: 'gateway_rate_limit_max', value: '100' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('gateway_rate_limit_max', '100');
    });

    it('maps "gateway_rate_limit_window_ms" to the same dbKey', async () => {
      await configSet({ key: 'gateway_rate_limit_window_ms', value: '60000' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('gateway_rate_limit_window_ms', '60000');
    });

    it('passes unknown keys through with the same dbKey, isApiKey: false', async () => {
      await configSet({ key: 'some_random_key', value: 'some-value' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('some_random_key', 'some-value');
      // Not an API key provider — no env var
      expect(process.env['SOME_RANDOM_API_KEY']).toBeUndefined();
    });

    it('treats an unknown provider format "unknown-api-key" as an unknown key, not isApiKey', async () => {
      // "unknown" is not in VALID_PROVIDERS; falls through to the unknown-key branch
      await configSet({ key: 'unknown-api-key', value: 'val' });
      // dbKey should be the raw key string, not api_key:unknown
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('unknown-api-key', 'val');
    });
  });

  // ==========================================================================
  // configSet
  // ==========================================================================

  describe('configSet()', () => {
    it('initializes the database adapter before any DB access', async () => {
      await configSet({ key: 'openai-api-key', value: 'sk-test' });
      expect(mockInitializeAdapter).toHaveBeenCalledOnce();
      // Adapter must be called before settingsRepo.set
      const initOrder = mockInitializeAdapter.mock.invocationCallOrder[0];
      const setOrder = mockSettingsRepo.set.mock.invocationCallOrder[0];
      expect(initOrder).toBeLessThan(setOrder);
    });

    it('stores value in DB with the correct dbKey', async () => {
      await configSet({ key: 'openai-api-key', value: 'sk-openai-key' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:openai', 'sk-openai-key');
    });

    it('trims whitespace from the provided value before storing', async () => {
      await configSet({ key: 'openai-api-key', value: '  sk-trimmed  ' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:openai', 'sk-trimmed');
    });

    it('sets OPENAI_API_KEY in process.env when storing openai-api-key', async () => {
      await configSet({ key: 'openai-api-key', value: 'sk-env-test' });
      expect(process.env['OPENAI_API_KEY']).toBe('sk-env-test');
    });

    it('sets ANTHROPIC_API_KEY in process.env when storing anthropic-api-key', async () => {
      await configSet({ key: 'anthropic-api-key', value: 'sk-ant-env' });
      expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-env');
    });

    it('sets GROQ_API_KEY in process.env when storing groq-api-key', async () => {
      await configSet({ key: 'groq-api-key', value: 'groq-env' });
      expect(process.env['GROQ_API_KEY']).toBe('groq-env');
    });

    it('sets MISTRAL_API_KEY in process.env when storing mistral-api-key', async () => {
      await configSet({ key: 'mistral-api-key', value: 'mistral-env' });
      expect(process.env['MISTRAL_API_KEY']).toBe('mistral-env');
    });

    it('sets FIREWORKS_API_KEY in process.env when storing fireworks-api-key', async () => {
      await configSet({ key: 'fireworks-api-key', value: 'fw-env' });
      expect(process.env['FIREWORKS_API_KEY']).toBe('fw-env');
    });

    it('sets PERPLEXITY_API_KEY in process.env when storing perplexity-api-key', async () => {
      await configSet({ key: 'perplexity-api-key', value: 'pplx-env' });
      expect(process.env['PERPLEXITY_API_KEY']).toBe('pplx-env');
    });

    it('does not set any env var for non-API-key settings', async () => {
      await configSet({ key: 'default_ai_provider', value: 'anthropic' });
      // Only specifically tracked vars are cleared in beforeEach — verify no
      // extra *_API_KEY was added by this call
      for (const k of TRACKED_ENV_VARS) {
        expect(process.env[k]).toBeUndefined();
      }
    });

    it('reads value from stdin when value option is omitted', async () => {
      mockQuestion.mockImplementationOnce((_prompt: string, cb: (a: string) => void) =>
        cb('stdin-value')
      );

      await configSet({ key: 'openai-api-key' });

      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:openai', 'stdin-value');
    });

    it('calls readLine with a prompt mentioning the key name', async () => {
      let capturedPrompt = '';
      mockQuestion.mockImplementationOnce((prompt: string, cb: (a: string) => void) => {
        capturedPrompt = prompt;
        cb('value');
      });

      await configSet({ key: 'openai-api-key' });

      expect(capturedPrompt).toContain('openai-api-key');
    });

    it('trims whitespace from stdin value', async () => {
      mockQuestion.mockImplementationOnce((_prompt: string, cb: (a: string) => void) =>
        cb('  whitespace-padded  ')
      );

      await configSet({ key: 'openai-api-key' });

      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:openai', 'whitespace-padded');
    });

    it('calls process.exit(1) when the explicit value is only whitespace', async () => {
      await expect(configSet({ key: 'openai-api-key', value: '   ' })).rejects.toThrow(
        'process.exit'
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('logs an error message when value is whitespace-only before exiting', async () => {
      await expect(configSet({ key: 'openai-api-key', value: '   ' })).rejects.toThrow(
        'process.exit'
      );
      expect(errorOutput(errorSpy)).toContain('Value cannot be empty');
    });

    it('falls back to stdin when value is an empty string (falsy), then exits if stdin is also empty', async () => {
      // value: '' is falsy → triggers readLine; readline returns '' → exit(1)
      mockQuestion.mockImplementationOnce((_prompt: string, cb: (a: string) => void) => cb(''));
      await expect(configSet({ key: 'openai-api-key', value: '' })).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('calls process.exit(1) when stdin returns empty string', async () => {
      mockQuestion.mockImplementationOnce((_prompt: string, cb: (a: string) => void) => cb(''));

      await expect(configSet({ key: 'openai-api-key' })).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('calls process.exit(1) when stdin returns only whitespace', async () => {
      mockQuestion.mockImplementationOnce((_prompt: string, cb: (a: string) => void) => cb('   '));

      await expect(configSet({ key: 'openai-api-key' })).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('logs a success message after storing the value', async () => {
      await configSet({ key: 'openai-api-key', value: 'sk-ok' });
      expect(logOutput(logSpy)).toContain('openai-api-key');
    });

    it('does not call settingsRepo.set when stdin returns empty after receiving empty value option', async () => {
      // value: '' is falsy → triggers readLine; readline returns '' → exit before set
      mockQuestion.mockImplementationOnce((_prompt: string, cb: (a: string) => void) => cb(''));
      await expect(configSet({ key: 'openai-api-key', value: '' })).rejects.toThrow('process.exit');
      expect(mockSettingsRepo.set).not.toHaveBeenCalled();
    });

    it('stores trimmed value for a non-API-key setting', async () => {
      await configSet({ key: 'default_ai_model', value: '  gpt-4o  ' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('default_ai_model', 'gpt-4o');
    });

    it('stores value for an unknown key without error', async () => {
      await configSet({ key: 'custom_setting', value: 'my-value' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('custom_setting', 'my-value');
    });

    it('propagates errors thrown by initializeAdapter', async () => {
      mockInitializeAdapter.mockRejectedValueOnce(new Error('DB init failed'));
      await expect(configSet({ key: 'openai-api-key', value: 'sk-test' })).rejects.toThrow(
        'DB init failed'
      );
    });

    it('propagates errors thrown by settingsRepo.set', async () => {
      mockSettingsRepo.set.mockRejectedValueOnce(new Error('DB write error'));
      await expect(configSet({ key: 'openai-api-key', value: 'sk-test' })).rejects.toThrow(
        'DB write error'
      );
    });
  });

  // ==========================================================================
  // configGet
  // ==========================================================================

  describe('configGet()', () => {
    it('initializes the database adapter before reading', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('gpt-4o');
      await configGet({ key: 'default_ai_model' });
      expect(mockInitializeAdapter).toHaveBeenCalledOnce();
    });

    it('reads from the DB using the correct dbKey for an API key', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('sk-abc123');
      await configGet({ key: 'openai-api-key' });
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('api_key:openai');
    });

    it('reads from the DB using the correct dbKey for a non-API setting', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('openai');
      await configGet({ key: 'default_ai_provider' });
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('default_ai_provider');
    });

    it('shows "(not set)" when the key does not exist in the DB', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce(null);
      await configGet({ key: 'openai-api-key' });
      expect(logOutput(logSpy)).toContain('(not set)');
    });

    it('shows the key name in the output even when not set', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce(null);
      await configGet({ key: 'default_ai_provider' });
      expect(logOutput(logSpy)).toContain('default_ai_provider');
    });

    // Masking: sensitive values longer than 12 chars → first 8 + "..." + last 4
    it('masks an API key value longer than 12 chars (first8...last4)', async () => {
      // 'sk-abcdef12345678' — 18 chars; first 8 = 'sk-abcde', last 4 = '5678'
      mockSettingsRepo.get.mockResolvedValueOnce('sk-abcdef12345678');
      await configGet({ key: 'openai-api-key' });
      const out = logOutput(logSpy);
      expect(out).toContain('sk-abcde...');
      expect(out).toContain('5678');
      // Should NOT show the full key verbatim
      expect(out).not.toContain('sk-abcdef12345678');
    });

    it('masks an API key value to exactly first 8 chars + "..." + last 4 chars', async () => {
      const value = 'sk-1234567890abcdef';
      mockSettingsRepo.get.mockResolvedValueOnce(value);
      await configGet({ key: 'openai-api-key' });
      const expected = value.substring(0, 8) + '...' + value.substring(value.length - 4);
      expect(logOutput(logSpy)).toContain(expected);
    });

    it('shows "********" for short sensitive values (12 chars or fewer)', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('short-key12'); // exactly 11 chars
      await configGet({ key: 'openai-api-key' });
      expect(logOutput(logSpy)).toContain('********');
    });

    it('shows "********" for a sensitive value of exactly 12 chars', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('123456789012'); // exactly 12 chars
      await configGet({ key: 'openai-api-key' });
      expect(logOutput(logSpy)).toContain('********');
    });

    it('shows full value for non-sensitive keys like default_ai_provider', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('anthropic');
      await configGet({ key: 'default_ai_provider' });
      expect(logOutput(logSpy)).toContain('anthropic');
    });

    it('shows full value for default_ai_model', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('claude-opus-4');
      await configGet({ key: 'default_ai_model' });
      expect(logOutput(logSpy)).toContain('claude-opus-4');
    });

    it('masks gateway_api_keys (sensitive non-API-key) when long', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('my-gateway-api-key-long');
      await configGet({ key: 'gateway_api_keys' });
      const out = logOutput(logSpy);
      expect(out).toContain('my-gatew...');
      expect(out).not.toContain('my-gateway-api-key-long');
    });

    it('masks gateway_jwt_secret (sensitive) when long', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('super-secret-jwt-value-here');
      await configGet({ key: 'gateway_jwt_secret' });
      const out = logOutput(logSpy);
      expect(out).toContain('super-se...');
    });

    it('masks telegram_bot_token (sensitive) when long', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('1234567890:ABCDEFGHIJ-longtoken');
      await configGet({ key: 'telegram_bot_token' });
      const out = logOutput(logSpy);
      expect(out).toContain('12345678...');
    });

    it('shows full value for gateway_auth_type (non-sensitive)', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('jwt');
      await configGet({ key: 'gateway_auth_type' });
      expect(logOutput(logSpy)).toContain('jwt');
    });

    it('shows full value for gateway_rate_limit_max (non-sensitive)', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('200');
      await configGet({ key: 'gateway_rate_limit_max' });
      expect(logOutput(logSpy)).toContain('200');
    });

    it('shows full value for unknown keys', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('my-plain-value');
      await configGet({ key: 'unknown_key' });
      expect(logOutput(logSpy)).toContain('my-plain-value');
    });

    it('shows "(not set)" for unknown keys with no DB entry', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce(null);
      await configGet({ key: 'unknown_key' });
      expect(logOutput(logSpy)).toContain('(not set)');
    });

    it('includes the key name in the output line', async () => {
      mockSettingsRepo.get.mockResolvedValueOnce('val');
      await configGet({ key: 'default_ai_model' });
      expect(logOutput(logSpy)).toContain('default_ai_model:');
    });
  });

  // ==========================================================================
  // configDelete
  // ==========================================================================

  describe('configDelete()', () => {
    it('initializes the database adapter before checking existence', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'openai-api-key' });
      expect(mockInitializeAdapter).toHaveBeenCalledOnce();
    });

    it('checks settingsRepo.has with the correct dbKey before deleting', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'openai-api-key' });
      expect(mockSettingsRepo.has).toHaveBeenCalledWith('api_key:openai');
    });

    it('deletes from DB when key exists', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'openai-api-key' });
      expect(mockSettingsRepo.delete).toHaveBeenCalledWith('api_key:openai');
    });

    it('does not call settingsRepo.delete when key does not exist', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(false);
      await configDelete({ key: 'openai-api-key' });
      expect(mockSettingsRepo.delete).not.toHaveBeenCalled();
    });

    it('shows "was not set" message when key does not exist', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(false);
      await configDelete({ key: 'openai-api-key' });
      expect(logOutput(logSpy)).toContain('was not set');
    });

    it('includes the key name in the "was not set" message', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(false);
      await configDelete({ key: 'openai-api-key' });
      expect(logOutput(logSpy)).toContain('openai-api-key');
    });

    it('removes OPENAI_API_KEY from process.env when deleting openai-api-key', async () => {
      process.env['OPENAI_API_KEY'] = 'existing-key';
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'openai-api-key' });
      expect(process.env['OPENAI_API_KEY']).toBeUndefined();
    });

    it('removes ANTHROPIC_API_KEY from process.env when deleting anthropic-api-key', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'existing-ant';
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'anthropic-api-key' });
      expect(process.env['ANTHROPIC_API_KEY']).toBeUndefined();
    });

    it('removes GROQ_API_KEY from process.env when deleting groq-api-key', async () => {
      process.env['GROQ_API_KEY'] = 'groq-existing';
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'groq-api-key' });
      expect(process.env['GROQ_API_KEY']).toBeUndefined();
    });

    it('does not touch process.env for non-API-key settings', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'default_ai_provider' });
      // None of the API key env vars should be touched
      for (const k of TRACKED_ENV_VARS) {
        expect(process.env[k]).toBeUndefined();
      }
    });

    it('logs success message after deleting', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'openai-api-key' });
      expect(logOutput(logSpy)).toContain('openai-api-key');
    });

    it('deletes from DB using the correct dbKey for a non-API setting', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'default_ai_model' });
      expect(mockSettingsRepo.delete).toHaveBeenCalledWith('default_ai_model');
    });

    it('deletes from DB using the correct dbKey for gateway_jwt_secret', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'gateway_jwt_secret' });
      expect(mockSettingsRepo.has).toHaveBeenCalledWith('gateway_jwt_secret');
      expect(mockSettingsRepo.delete).toHaveBeenCalledWith('gateway_jwt_secret');
    });

    it('handles deleting an unknown key that exists in DB', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      await configDelete({ key: 'custom_key' });
      expect(mockSettingsRepo.delete).toHaveBeenCalledWith('custom_key');
    });

    it('propagates errors from settingsRepo.has', async () => {
      mockSettingsRepo.has.mockRejectedValueOnce(new Error('DB read error'));
      await expect(configDelete({ key: 'openai-api-key' })).rejects.toThrow('DB read error');
    });

    it('propagates errors from settingsRepo.delete', async () => {
      mockSettingsRepo.has.mockResolvedValueOnce(true);
      mockSettingsRepo.delete.mockRejectedValueOnce(new Error('DB delete error'));
      await expect(configDelete({ key: 'openai-api-key' })).rejects.toThrow('DB delete error');
    });
  });

  // ==========================================================================
  // configList
  // ==========================================================================

  describe('configList()', () => {
    it('initializes the database adapter', async () => {
      await configList();
      expect(mockInitializeAdapter).toHaveBeenCalledOnce();
    });

    it('displays all 9 valid providers in the API Keys section', async () => {
      await configList();
      const out = logOutput(logSpy);
      const providers = [
        'openai',
        'anthropic',
        'zhipu',
        'deepseek',
        'groq',
        'together',
        'mistral',
        'fireworks',
        'perplexity',
      ];
      for (const p of providers) {
        expect(out).toContain(`${p}-api-key`);
      }
    });

    it('shows "Not set" status when an API key is absent', async () => {
      mockSettingsRepo.has.mockResolvedValue(false);
      await configList();
      expect(logOutput(logSpy)).toContain('Not set');
    });

    it('shows "Set" status when an API key is present', async () => {
      mockSettingsRepo.has.mockResolvedValue(true);
      await configList();
      expect(logOutput(logSpy)).toContain('Set');
    });

    it('checks settingsRepo.has with "api_key:openai" for openai provider', async () => {
      await configList();
      expect(mockSettingsRepo.has).toHaveBeenCalledWith('api_key:openai');
    });

    it('checks settingsRepo.has with "api_key:anthropic" for anthropic provider', async () => {
      await configList();
      expect(mockSettingsRepo.has).toHaveBeenCalledWith('api_key:anthropic');
    });

    it('displays "API Keys:" section header', async () => {
      await configList();
      expect(logOutput(logSpy)).toContain('API Keys');
    });

    it('displays "AI Settings:" section header', async () => {
      await configList();
      expect(logOutput(logSpy)).toContain('AI Settings');
    });

    it('displays "Channel Settings:" section header', async () => {
      await configList();
      expect(logOutput(logSpy)).toContain('Channel Settings');
    });

    it('displays "Gateway Settings:" section header', async () => {
      await configList();
      expect(logOutput(logSpy)).toContain('Gateway Settings');
    });

    it('shows default_ai_provider value when set', async () => {
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'default_ai_provider') return 'openai';
        return null;
      });
      await configList();
      expect(logOutput(logSpy)).toContain('openai');
    });

    it('shows "(not set)" for default_ai_provider when absent', async () => {
      mockSettingsRepo.get.mockResolvedValue(null);
      await configList();
      expect(logOutput(logSpy)).toContain('(not set)');
    });

    it('shows "(not set)" for default_ai_model when absent', async () => {
      mockSettingsRepo.get.mockResolvedValue(null);
      await configList();
      const out = logOutput(logSpy);
      expect(out).toContain('default_ai_model');
      expect(out).toContain('(not set)');
    });

    it('masks telegram_bot_token when set and longer than 12 chars', async () => {
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'telegram_bot_token') return '1234567890:ABCDEFGHIJKLMNO';
        return null;
      });
      await configList();
      const out = logOutput(logSpy);
      expect(out).toContain('12345678...');
      expect(out).not.toContain('ABCDEFGHIJKLMNO');
    });

    it('shows "********" for short telegram_bot_token (12 chars or fewer)', async () => {
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'telegram_bot_token') return 'shorttoken!';
        return null;
      });
      await configList();
      expect(logOutput(logSpy)).toContain('********');
    });

    it('shows "(not set)" for telegram_bot_token when absent', async () => {
      mockSettingsRepo.get.mockResolvedValue(null);
      await configList();
      const out = logOutput(logSpy);
      expect(out).toContain('telegram_bot_token');
    });

    it('masks gateway_api_keys when set and longer than 12 chars', async () => {
      // 'gw-api-key-value-long' — 21 chars; first 8 = 'gw-api-k', last 4 = 'long'
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'gateway_api_keys') return 'gw-api-key-value-long';
        return null;
      });
      await configList();
      const out = logOutput(logSpy);
      expect(out).toContain('gw-api-k...long');
      expect(out).not.toContain('gw-api-key-value-long');
    });

    it('masks gateway_jwt_secret when set and longer than 12 chars', async () => {
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'gateway_jwt_secret') return 'super-secret-jwt-here';
        return null;
      });
      await configList();
      const out = logOutput(logSpy);
      expect(out).toContain('super-se...');
    });

    it('shows full value for gateway_auth_type (non-sensitive)', async () => {
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'gateway_auth_type') return 'apikey';
        return null;
      });
      await configList();
      expect(logOutput(logSpy)).toContain('apikey');
    });

    it('shows full value for gateway_rate_limit_max (non-sensitive)', async () => {
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'gateway_rate_limit_max') return '500';
        return null;
      });
      await configList();
      expect(logOutput(logSpy)).toContain('500');
    });

    it('shows full value for gateway_rate_limit_window_ms (non-sensitive)', async () => {
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'gateway_rate_limit_window_ms') return '30000';
        return null;
      });
      await configList();
      expect(logOutput(logSpy)).toContain('30000');
    });

    it('prints the database path from getDatabasePath()', async () => {
      mockGetDatabasePath.mockReturnValueOnce('/custom/path/db.db');
      await configList();
      expect(logOutput(logSpy)).toContain('/custom/path/db.db');
    });

    it('prints a usage hint for "ownpilot config set"', async () => {
      await configList();
      expect(logOutput(logSpy)).toContain('config set');
    });

    it('calls settingsRepo.has for each of the 9 providers', async () => {
      await configList();
      expect(mockSettingsRepo.has).toHaveBeenCalledTimes(9);
    });

    it('calls settingsRepo.get for AI Settings keys', async () => {
      await configList();
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('default_ai_provider');
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('default_ai_model');
    });

    it('calls settingsRepo.get for Channel Settings keys', async () => {
      await configList();
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('telegram_bot_token');
    });

    it('calls settingsRepo.get for all Gateway Settings keys', async () => {
      await configList();
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('gateway_api_keys');
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('gateway_jwt_secret');
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('gateway_auth_type');
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('gateway_rate_limit_max');
      expect(mockSettingsRepo.get).toHaveBeenCalledWith('gateway_rate_limit_window_ms');
    });
  });

  // ==========================================================================
  // setup
  // ==========================================================================

  describe('setup()', () => {
    it('initializes the database adapter', async () => {
      await setup();
      expect(mockInitializeAdapter).toHaveBeenCalledOnce();
    });

    it('prints a success message after initialization', async () => {
      await setup();
      expect(logOutput(logSpy)).toContain('initialized');
    });

    it('prints the database location from getDatabasePath()', async () => {
      mockGetDatabasePath.mockReturnValueOnce('/tmp/test-ownpilot.db');
      await setup();
      expect(logOutput(logSpy)).toContain('/tmp/test-ownpilot.db');
    });

    it('prints next-step instructions mentioning "ownpilot config set"', async () => {
      await setup();
      expect(logOutput(logSpy)).toContain('config set');
    });

    it('mentions openai-api-key in the next steps', async () => {
      await setup();
      expect(logOutput(logSpy)).toContain('openai-api-key');
    });

    it('mentions anthropic-api-key in the next steps', async () => {
      await setup();
      expect(logOutput(logSpy)).toContain('anthropic-api-key');
    });

    it('propagates errors from initializeAdapter', async () => {
      mockInitializeAdapter.mockRejectedValueOnce(new Error('connection refused'));
      await expect(setup()).rejects.toThrow('connection refused');
    });

    it('does not call settingsRepo methods during setup', async () => {
      await setup();
      expect(mockSettingsRepo.set).not.toHaveBeenCalled();
      expect(mockSettingsRepo.get).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // configChangePassword
  // ==========================================================================

  describe('configChangePassword()', () => {
    it('prints a deprecation / removal message', async () => {
      await configChangePassword();
      expect(logOutput(logSpy)).toContain('Password');
    });

    it('mentions that settings are now in the database', async () => {
      await configChangePassword();
      const out = logOutput(logSpy);
      expect(out.toLowerCase()).toContain('database');
    });

    it('does not call initializeAdapter', async () => {
      await configChangePassword();
      expect(mockInitializeAdapter).not.toHaveBeenCalled();
    });

    it('does not access settingsRepo at all', async () => {
      await configChangePassword();
      expect(mockSettingsRepo.set).not.toHaveBeenCalled();
      expect(mockSettingsRepo.get).not.toHaveBeenCalled();
      expect(mockSettingsRepo.delete).not.toHaveBeenCalled();
      expect(mockSettingsRepo.has).not.toHaveBeenCalled();
      expect(mockSettingsRepo.getByPrefix).not.toHaveBeenCalled();
    });

    it('resolves without throwing', async () => {
      await expect(configChangePassword()).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // loadCredentialsToEnv
  // ==========================================================================

  describe('loadCredentialsToEnv()', () => {
    it('initializes the database adapter', async () => {
      await loadCredentialsToEnv();
      expect(mockInitializeAdapter).toHaveBeenCalledOnce();
    });

    it('calls settingsRepo.getByPrefix with "api_key:"', async () => {
      await loadCredentialsToEnv();
      expect(mockSettingsRepo.getByPrefix).toHaveBeenCalledWith('api_key:');
    });

    it('sets OPENAI_API_KEY in process.env when returned from DB', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        apiKeyRow('openai', 'sk-loaded-from-db'),
      ]);
      await loadCredentialsToEnv();
      expect(process.env['OPENAI_API_KEY']).toBe('sk-loaded-from-db');
    });

    it('sets ANTHROPIC_API_KEY in process.env when returned from DB', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([apiKeyRow('anthropic', 'sk-ant-loaded')]);
      await loadCredentialsToEnv();
      expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-ant-loaded');
    });

    it('sets GROQ_API_KEY in process.env when returned from DB', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([apiKeyRow('groq', 'groq-loaded')]);
      await loadCredentialsToEnv();
      expect(process.env['GROQ_API_KEY']).toBe('groq-loaded');
    });

    it('sets MISTRAL_API_KEY in process.env when returned from DB', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([apiKeyRow('mistral', 'mistral-loaded')]);
      await loadCredentialsToEnv();
      expect(process.env['MISTRAL_API_KEY']).toBe('mistral-loaded');
    });

    it('sets TOGETHER_API_KEY in process.env when returned from DB', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        apiKeyRow('together', 'together-loaded'),
      ]);
      await loadCredentialsToEnv();
      expect(process.env['TOGETHER_API_KEY']).toBe('together-loaded');
    });

    it('sets FIREWORKS_API_KEY in process.env when returned from DB', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([apiKeyRow('fireworks', 'fw-loaded')]);
      await loadCredentialsToEnv();
      expect(process.env['FIREWORKS_API_KEY']).toBe('fw-loaded');
    });

    it('sets PERPLEXITY_API_KEY in process.env when returned from DB', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([apiKeyRow('perplexity', 'pplx-loaded')]);
      await loadCredentialsToEnv();
      expect(process.env['PERPLEXITY_API_KEY']).toBe('pplx-loaded');
    });

    it('sets DEEPSEEK_API_KEY in process.env when returned from DB', async () => {
      // DEEPSEEK_API_KEY is not in TRACKED_ENV_VARS; clean up manually
      const prev = process.env['DEEPSEEK_API_KEY'];
      try {
        delete process.env['DEEPSEEK_API_KEY'];
        mockSettingsRepo.getByPrefix.mockResolvedValueOnce([apiKeyRow('deepseek', 'ds-loaded')]);
        await loadCredentialsToEnv();
        expect(process.env['DEEPSEEK_API_KEY']).toBe('ds-loaded');
      } finally {
        if (prev === undefined) {
          delete process.env['DEEPSEEK_API_KEY'];
        } else {
          process.env['DEEPSEEK_API_KEY'] = prev;
        }
      }
    });

    it('sets ZHIPU_API_KEY in process.env when returned from DB', async () => {
      const prev = process.env['ZHIPU_API_KEY'];
      try {
        delete process.env['ZHIPU_API_KEY'];
        mockSettingsRepo.getByPrefix.mockResolvedValueOnce([apiKeyRow('zhipu', 'zhipu-loaded')]);
        await loadCredentialsToEnv();
        expect(process.env['ZHIPU_API_KEY']).toBe('zhipu-loaded');
      } finally {
        if (prev === undefined) {
          delete process.env['ZHIPU_API_KEY'];
        } else {
          process.env['ZHIPU_API_KEY'] = prev;
        }
      }
    });

    it('sets multiple API keys from DB in one call', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        apiKeyRow('openai', 'sk-multi-openai'),
        apiKeyRow('anthropic', 'sk-multi-ant'),
        apiKeyRow('groq', 'groq-multi'),
      ]);
      await loadCredentialsToEnv();
      expect(process.env['OPENAI_API_KEY']).toBe('sk-multi-openai');
      expect(process.env['ANTHROPIC_API_KEY']).toBe('sk-multi-ant');
      expect(process.env['GROQ_API_KEY']).toBe('groq-multi');
    });

    it('does nothing (no env mutations) when no API keys are in DB', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([]);
      const envBefore = { ...process.env };
      await loadCredentialsToEnv();
      // Verify none of the tracked vars were altered
      for (const k of TRACKED_ENV_VARS) {
        expect(process.env[k]).toBe(envBefore[k]);
      }
    });

    it('uses uppercase provider name to form the env var name', async () => {
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        apiKeyRow('mistral', 'mistral-upper-test'),
      ]);
      await loadCredentialsToEnv();
      // The canonical uppercase key must be set (case-insensitive on Windows, case-sensitive on Unix)
      expect(process.env['MISTRAL_API_KEY']).toBe('mistral-upper-test');
    });

    it('strips the "api_key:" prefix correctly when building env var name', async () => {
      // key field from getByPrefix includes the full prefix
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        { key: 'api_key:openai', value: 'prefix-stripped-ok' },
      ]);
      await loadCredentialsToEnv();
      expect(process.env['OPENAI_API_KEY']).toBe('prefix-stripped-ok');
    });

    it('overwrites an existing env var value when DB has a newer value', async () => {
      process.env['OPENAI_API_KEY'] = 'old-value';
      mockSettingsRepo.getByPrefix.mockResolvedValueOnce([
        apiKeyRow('openai', 'new-value-from-db'),
      ]);
      await loadCredentialsToEnv();
      expect(process.env['OPENAI_API_KEY']).toBe('new-value-from-db');
    });

    it('propagates errors from initializeAdapter', async () => {
      mockInitializeAdapter.mockRejectedValueOnce(new Error('no DB'));
      await expect(loadCredentialsToEnv()).rejects.toThrow('no DB');
    });

    it('propagates errors from settingsRepo.getByPrefix', async () => {
      mockSettingsRepo.getByPrefix.mockRejectedValueOnce(new Error('prefix query failed'));
      await expect(loadCredentialsToEnv()).rejects.toThrow('prefix query failed');
    });
  });

  // ==========================================================================
  // readLine — error and close event handlers (lines 69-80)
  // ==========================================================================

  describe('readLine() — readline error and close events', () => {
    it('rejects the promise when readline emits an error event', async () => {
      // Override the mock to capture the 'error' and 'close' event handlers
      let errorHandler: ((err: Error) => void) | undefined;
      mockRlOn.mockImplementation(function (
        this: unknown,
        event: string,
        handler: (...args: unknown[]) => void
      ) {
        if (event === 'error') {
          errorHandler = handler as (err: Error) => void;
        }
        return this;
      });

      // Make question never call its callback — the error event will resolve the promise
      mockQuestion.mockImplementation(() => {
        // Simulate async error after question is asked
        setTimeout(() => {
          errorHandler?.(new Error('readline error'));
        }, 0);
      });

      // configSet without value triggers readLine
      await expect(configSet({ key: 'openai-api-key' })).rejects.toThrow('readline error');
    });

    it('resolves with empty string when readline emits close event before answering', async () => {
      // Override the mock to capture the 'close' event handler
      let closeHandler: (() => void) | undefined;
      mockRlOn.mockImplementation(function (
        this: unknown,
        event: string,
        handler: (...args: unknown[]) => void
      ) {
        if (event === 'close') {
          closeHandler = handler as () => void;
        }
        return this;
      });

      // Make question never call its callback — the close event will resolve the promise
      mockQuestion.mockImplementation(() => {
        // Simulate close after question is asked (e.g. user presses Ctrl+D)
        setTimeout(() => {
          closeHandler?.();
        }, 0);
      });

      // configSet without value triggers readLine; close resolves with '' which is empty
      // Empty value causes process.exit(1)
      await expect(configSet({ key: 'openai-api-key' })).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorOutput(errorSpy)).toContain('Value cannot be empty');
    });

    it('does not reject twice when error fires after settled via question callback', async () => {
      let errorHandler: ((err: Error) => void) | undefined;
      mockRlOn.mockImplementation(function (
        this: unknown,
        event: string,
        handler: (...args: unknown[]) => void
      ) {
        if (event === 'error') {
          errorHandler = handler as (err: Error) => void;
        }
        return this;
      });

      // question callback fires first (settling the promise), then error fires later
      mockQuestion.mockImplementation((_prompt: string, cb: (a: string) => void) => {
        cb('valid-value');
        // Fire error after already settled — should be a no-op (the settled guard)
        errorHandler?.(new Error('late error'));
      });

      // Should succeed despite the late error event
      await configSet({ key: 'openai-api-key' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:openai', 'valid-value');
    });

    it('does not resolve twice when close fires after settled via question callback', async () => {
      let closeHandler: (() => void) | undefined;
      mockRlOn.mockImplementation(function (
        this: unknown,
        event: string,
        handler: (...args: unknown[]) => void
      ) {
        if (event === 'close') {
          closeHandler = handler as () => void;
        }
        return this;
      });

      // question callback fires first (settling the promise), then close fires later
      mockQuestion.mockImplementation((_prompt: string, cb: (a: string) => void) => {
        cb('valid-value');
        // Fire close after already settled — should be a no-op
        closeHandler?.();
      });

      // Should succeed despite the late close event
      await configSet({ key: 'openai-api-key' });
      expect(mockSettingsRepo.set).toHaveBeenCalledWith('api_key:openai', 'valid-value');
    });
  });

  // ==========================================================================
  // configList — gateway settings short sensitive value masking (line 270)
  // ==========================================================================

  describe('configList() — short sensitive gateway settings masking', () => {
    it('shows "********" for short gateway_api_keys (12 chars or fewer)', async () => {
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'gateway_api_keys') return 'shortgwkey';
        return null;
      });
      await configList();
      const out = logOutput(logSpy);
      expect(out).toContain('********');
      expect(out).not.toContain('shortgwkey');
    });

    it('shows "********" for short gateway_jwt_secret (12 chars or fewer)', async () => {
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'gateway_jwt_secret') return 'short-jwt';
        return null;
      });
      await configList();
      const out = logOutput(logSpy);
      expect(out).toContain('********');
      expect(out).not.toContain('short-jwt');
    });

    it('shows "********" for gateway_api_keys of exactly 12 chars', async () => {
      mockSettingsRepo.get.mockImplementation(async (key: string) => {
        if (key === 'gateway_api_keys') return '123456789012'; // exactly 12 chars
        return null;
      });
      await configList();
      const out = logOutput(logSpy);
      expect(out).toContain('********');
    });
  });
});
