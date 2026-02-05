import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CredentialStore,
  createCredentialStore,
  getCredentialStore,
  type CredentialStoreConfig,
  type StoredCredentials,
} from './credentials.js';

// ---------------------------------------------------------------------------
// Strategy: let real crypto run (webcrypto AES-256-GCM + PBKDF2) so we get
// true roundtrip confidence. Mock only the filesystem layer.
//
// We use a low iteration count (1) to keep tests fast -- PBKDF2 with 600K
// iterations would make each test take seconds.
// ---------------------------------------------------------------------------

// In-memory filesystem simulation
let fsStore: Record<string, string> = {};

const mockExistsSync = vi.fn((p: string) => p in fsStore);

const mockReadFile = vi.fn(async (p: string, _enc?: string) => {
  if (p in fsStore) return fsStore[p];
  throw new Error(`ENOENT: no such file or directory, open '${p}'`);
});

const mockWriteFile = vi.fn(async (p: string, data: string, _opts?: unknown) => {
  fsStore[p] = data;
});

const mockMkdir = vi.fn(async () => undefined);

const mockUnlink = vi.fn(async (p: string) => {
  delete fsStore[p];
});

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...(args as [string])),
}));

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...(args as [string, string?])),
  writeFile: (...args: unknown[]) => mockWriteFile(...(args as [string, string, unknown?])),
  mkdir: (...args: unknown[]) => mockMkdir(...(args as [string])),
  unlink: (...args: unknown[]) => mockUnlink(...(args as [string])),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TEST_PATH = '/tmp/ownpilot-test/credentials.enc';
const PASSWORD = 'test-password-long-enough';
const OTHER_PASSWORD = 'another-password-long-enough';

function makeStore(overrides?: CredentialStoreConfig): CredentialStore {
  return new CredentialStore({
    path: TEST_PATH,
    iterations: 1, // fast tests
    ...overrides,
  });
}

/** Initialize + unlock a store so it's ready for CRUD operations */
async function initAndUnlock(
  store?: CredentialStore,
  password = PASSWORD,
): Promise<CredentialStore> {
  const s = store ?? makeStore();
  const initRes = await s.initialize(password);
  expect(initRes.ok).toBe(true);
  const unlockRes = await s.unlock(password);
  expect(unlockRes.ok).toBe(true);
  return s;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CredentialStore', () => {
  beforeEach(() => {
    fsStore = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean env vars that loadToEnv may have set
    const envKeys = [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GOOGLE_API_KEY',
      'ZHIPU_API_KEY',
      'DEEPSEEK_API_KEY',
      'GROQ_API_KEY',
      'TOGETHER_API_KEY',
      'MISTRAL_API_KEY',
      'FIREWORKS_API_KEY',
      'PERPLEXITY_API_KEY',
      'XAI_API_KEY',
      'TELEGRAM_BOT_TOKEN',
      'JWT_SECRET',
      'ENCRYPTION_KEY',
      'MY_CUSTOM_VAR',
      'ANOTHER_VAR',
    ];
    for (const k of envKeys) {
      delete process.env[k];
    }
  });

  // =========================================================================
  // Constructor & configuration
  // =========================================================================
  describe('constructor', () => {
    it('should use the supplied path', () => {
      const store = new CredentialStore({ path: '/custom/path.enc' });
      expect(store.path).toBe('/custom/path.enc');
    });

    it('should fall back to the default home-dir path when no path given', () => {
      const store = new CredentialStore();
      expect(store.path).toContain('credentials.enc');
    });

    it('should start in a locked state', () => {
      const store = makeStore();
      expect(store.unlocked).toBe(false);
    });
  });

  // =========================================================================
  // isInitialized
  // =========================================================================
  describe('isInitialized', () => {
    it('should return false when credential file does not exist', () => {
      const store = makeStore();
      expect(store.isInitialized()).toBe(false);
      expect(mockExistsSync).toHaveBeenCalledWith(TEST_PATH);
    });

    it('should return true after initialize() succeeds', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);
      expect(store.isInitialized()).toBe(true);
    });
  });

  // =========================================================================
  // initialize
  // =========================================================================
  describe('initialize', () => {
    it('should create a credentials file on disk', async () => {
      const store = makeStore();
      const result = await store.initialize(PASSWORD);

      expect(result.ok).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(fsStore[TEST_PATH]).toBeDefined();
    });

    it('should write valid JSON with expected structure', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);

      const file = JSON.parse(fsStore[TEST_PATH]);
      expect(file.version).toBe(1);
      expect(file.salt).toEqual(expect.any(String));
      expect(file.verifier).toEqual(expect.any(String));
      expect(file.data).toEqual(expect.any(String));
    });

    it('should write file with mode 0o600', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);

      const writeCall = mockWriteFile.mock.calls[0];
      expect(writeCall[2]).toEqual(
        expect.objectContaining({ mode: 0o600 }),
      );
    });

    it('should create parent directory if it does not exist', async () => {
      // existsSync returns false for directory check too
      const store = makeStore();
      await store.initialize(PASSWORD);

      expect(mockMkdir).toHaveBeenCalled();
    });

    it('should fail when already initialized', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);

      const result = await store.initialize(PASSWORD);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/already initialized/i);
      }
    });

    it('should reject empty password', async () => {
      const store = makeStore();
      const result = await store.initialize('');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/at least 8 characters/i);
      }
    });

    it('should reject password shorter than 8 characters', async () => {
      const store = makeStore();
      const result = await store.initialize('short');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/at least 8 characters/i);
      }
    });

    it('should accept a password that is exactly 8 characters', async () => {
      const store = makeStore();
      const result = await store.initialize('12345678');
      expect(result.ok).toBe(true);
    });
  });

  // =========================================================================
  // unlock
  // =========================================================================
  describe('unlock', () => {
    it('should succeed with the correct password', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);

      const result = await store.unlock(PASSWORD);
      expect(result.ok).toBe(true);
      expect(store.unlocked).toBe(true);
    });

    it('should fail with an incorrect password', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);

      const result = await store.unlock('wrong-password-definitely');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/invalid password/i);
      }
      expect(store.unlocked).toBe(false);
    });

    it('should return NotFoundError when file does not exist', async () => {
      const store = makeStore();
      // No initialize() call
      const result = await store.unlock(PASSWORD);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/not found/i);
      }
    });

    it('should return ok immediately if already unlocked', async () => {
      const store = await initAndUnlock();

      // Second call should short-circuit
      const result = await store.unlock(PASSWORD);
      expect(result.ok).toBe(true);
      // readFile should only be called once (from first unlock) + save ops
      // The key point: it does not re-derive or re-read
    });

    it('should fail when credentials file contains invalid JSON', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);

      // Corrupt the file
      fsStore[TEST_PATH] = '<<<not json>>>';

      // Need a new store so isUnlocked is false
      const store2 = makeStore();
      const result = await store2.unlock(PASSWORD);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/invalid credentials file format/i);
      }
    });

    it('should decrypt OWNPILOT_VERIFIED verifier to validate password', async () => {
      // This is an integration check: real crypto roundtrip
      const store = makeStore();
      await store.initialize(PASSWORD);

      const store2 = makeStore();
      const result = await store2.unlock(PASSWORD);
      expect(result.ok).toBe(true);
    });
  });

  // =========================================================================
  // lock
  // =========================================================================
  describe('lock', () => {
    it('should set unlocked to false', async () => {
      const store = await initAndUnlock();
      expect(store.unlocked).toBe(true);

      store.lock();
      expect(store.unlocked).toBe(false);
    });

    it('should clear credentials from memory (getCredentials fails after lock)', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-test' });

      store.lock();

      const result = store.getCredentials();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/locked/i);
      }
    });

    it('should be idempotent (locking twice does not throw)', async () => {
      const store = await initAndUnlock();
      store.lock();
      store.lock();
      expect(store.unlocked).toBe(false);
    });
  });

  // =========================================================================
  // getCredentials
  // =========================================================================
  describe('getCredentials', () => {
    it('should return an error when store is locked', () => {
      const store = makeStore();
      const result = store.getCredentials();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/locked/i);
      }
    });

    it('should return empty credentials after fresh initialize + unlock', async () => {
      const store = await initAndUnlock();
      const result = store.getCredentials();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({});
      }
    });

    it('should return a copy, not the internal reference', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-test' });

      const r1 = store.getCredentials();
      const r2 = store.getCredentials();
      expect(r1.ok && r2.ok).toBe(true);
      if (r1.ok && r2.ok) {
        expect(r1.value).not.toBe(r2.value); // different object references
        expect(r1.value).toEqual(r2.value); // same content
      }
    });
  });

  // =========================================================================
  // setCredentials
  // =========================================================================
  describe('setCredentials', () => {
    it('should return an error when store is locked', async () => {
      const store = makeStore();
      const result = await store.setCredentials({ openaiApiKey: 'sk-123' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/locked/i);
      }
    });

    it('should store a single credential', async () => {
      const store = await initAndUnlock();
      const result = await store.setCredentials({ openaiApiKey: 'sk-test-key' });

      expect(result.ok).toBe(true);
      const creds = store.getCredentials();
      expect(creds.ok && creds.value.openaiApiKey).toBe('sk-test-key');
    });

    it('should merge with existing credentials', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-openai' });
      await store.setCredentials({ anthropicApiKey: 'sk-anthropic' });

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.openaiApiKey).toBe('sk-openai');
        expect(creds.value.anthropicApiKey).toBe('sk-anthropic');
      }
    });

    it('should overwrite an existing credential for the same key', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'old-key' });
      await store.setCredentials({ openaiApiKey: 'new-key' });

      const creds = store.getCredentials();
      expect(creds.ok && creds.value.openaiApiKey).toBe('new-key');
    });

    it('should persist to disk (encrypted)', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-secret' });

      // The raw file should NOT contain the plaintext key
      const raw = fsStore[TEST_PATH];
      expect(raw).not.toContain('sk-secret');
    });

    it('should survive a lock/unlock roundtrip', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ anthropicApiKey: 'sk-roundtrip' });

      store.lock();
      await store.unlock(PASSWORD);

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.anthropicApiKey).toBe('sk-roundtrip');
      }
    });

    it('should handle setting an empty string value', async () => {
      const store = await initAndUnlock();
      const result = await store.setCredentials({ openaiApiKey: '' });
      expect(result.ok).toBe(true);

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.openaiApiKey).toBe('');
      }
    });

    it('should store multiple credentials at once', async () => {
      const store = await initAndUnlock();
      const result = await store.setCredentials({
        openaiApiKey: 'sk-openai',
        anthropicApiKey: 'sk-anthropic',
        googleApiKey: 'gai-key',
      });

      expect(result.ok).toBe(true);
      const creds = store.getCredentials();
      if (creds.ok) {
        expect(creds.value.openaiApiKey).toBe('sk-openai');
        expect(creds.value.anthropicApiKey).toBe('sk-anthropic');
        expect(creds.value.googleApiKey).toBe('gai-key');
      }
    });

    it('should store custom credentials', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({
        custom: { MY_CUSTOM_VAR: 'custom-value', ANOTHER_VAR: 'another' },
      });

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.custom).toEqual({
          MY_CUSTOM_VAR: 'custom-value',
          ANOTHER_VAR: 'another',
        });
      }
    });

    it('should store customProviders configuration', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({
        customProviders: [
          {
            name: 'MyProvider',
            baseUrl: 'https://api.myprovider.com',
            apiKey: 'mp-key-123',
            defaultModel: 'mp-model',
          },
        ],
      });

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.customProviders).toHaveLength(1);
        expect(creds.value.customProviders![0].name).toBe('MyProvider');
      }
    });
  });

  // =========================================================================
  // Supported credential keys (all built-in provider keys)
  // =========================================================================
  describe('supported credential keys', () => {
    const providerKeys: Array<[keyof StoredCredentials, string]> = [
      ['openaiApiKey', 'sk-openai'],
      ['anthropicApiKey', 'sk-anthropic'],
      ['googleApiKey', 'gai-key'],
      ['zhipuApiKey', 'zk-key'],
      ['deepseekApiKey', 'ds-key'],
      ['groqApiKey', 'gsk-key'],
      ['togetherApiKey', 'ta-key'],
      ['mistralApiKey', 'ms-key'],
      ['fireworksApiKey', 'fw-key'],
      ['perplexityApiKey', 'pp-key'],
      ['xaiApiKey', 'xai-key'],
      ['telegramBotToken', 'bot-token'],
      ['jwtSecret', 'jwt-secret'],
      ['encryptionKey', 'enc-key'],
    ];

    it.each(providerKeys)(
      'should store and retrieve %s',
      async (key, value) => {
        const store = await initAndUnlock();
        const partial: Partial<StoredCredentials> = { [key]: value };
        await store.setCredentials(partial);

        const creds = store.getCredentials();
        expect(creds.ok).toBe(true);
        if (creds.ok) {
          expect(creds.value[key]).toBe(value);
        }
      },
    );
  });

  // =========================================================================
  // deleteCredential
  // =========================================================================
  describe('deleteCredential', () => {
    it('should return an error when store is locked', async () => {
      const store = makeStore();
      const result = await store.deleteCredential('openaiApiKey');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/locked/i);
      }
    });

    it('should remove a stored credential', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-to-delete' });

      const result = await store.deleteCredential('openaiApiKey');
      expect(result.ok).toBe(true);

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.openaiApiKey).toBeUndefined();
      }
    });

    it('should not affect other credentials when deleting one', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({
        openaiApiKey: 'sk-openai',
        anthropicApiKey: 'sk-anthropic',
      });

      await store.deleteCredential('openaiApiKey');

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.openaiApiKey).toBeUndefined();
        expect(creds.value.anthropicApiKey).toBe('sk-anthropic');
      }
    });

    it('should handle deleting a credential that was never set', async () => {
      const store = await initAndUnlock();

      // Should succeed without error even if key was never set
      const result = await store.deleteCredential('groqApiKey');
      expect(result.ok).toBe(true);
    });

    it('should handle deleting the custom record', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ custom: { FOO: 'bar' } });

      const result = await store.deleteCredential('custom');
      expect(result.ok).toBe(true);

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.custom).toBeUndefined();
      }
    });

    it('should persist deletion to disk', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-persist' });
      await store.deleteCredential('openaiApiKey');

      // Re-open with a fresh store
      const store2 = makeStore();
      await store2.unlock(PASSWORD);

      const creds = store2.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.openaiApiKey).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // changePassword
  // =========================================================================
  describe('changePassword', () => {
    it('should re-encrypt credentials with the new password', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-important' });

      const result = await store.changePassword(PASSWORD, OTHER_PASSWORD);
      expect(result.ok).toBe(true);

      // Old password should no longer work
      store.lock();
      const oldResult = await store.unlock(PASSWORD);
      expect(oldResult.ok).toBe(false);
    });

    it('should allow unlocking with the new password after change', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-migrated' });

      await store.changePassword(PASSWORD, OTHER_PASSWORD);
      store.lock();

      const unlockResult = await store.unlock(OTHER_PASSWORD);
      expect(unlockResult.ok).toBe(true);

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.openaiApiKey).toBe('sk-migrated');
      }
    });

    it('should auto-unlock with current password if store is locked', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);

      // Store is NOT unlocked -- changePassword should auto-unlock first
      const result = await store.changePassword(PASSWORD, OTHER_PASSWORD);
      expect(result.ok).toBe(true);
    });

    it('should fail if the current password is wrong', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);

      const result = await store.changePassword('wrong-password-here', OTHER_PASSWORD);
      expect(result.ok).toBe(false);
    });

    it('should reject a new password shorter than 8 characters', async () => {
      const store = await initAndUnlock();

      const result = await store.changePassword(PASSWORD, 'short');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/at least 8 characters/i);
      }
    });

    it('should reject an empty new password', async () => {
      const store = await initAndUnlock();

      const result = await store.changePassword(PASSWORD, '');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/at least 8 characters/i);
      }
    });

    it('should preserve all credentials after password change', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({
        openaiApiKey: 'sk-openai',
        anthropicApiKey: 'sk-anthropic',
        custom: { MY_VAR: 'val' },
      });

      await store.changePassword(PASSWORD, OTHER_PASSWORD);
      store.lock();
      await store.unlock(OTHER_PASSWORD);

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.openaiApiKey).toBe('sk-openai');
        expect(creds.value.anthropicApiKey).toBe('sk-anthropic');
        expect(creds.value.custom).toEqual({ MY_VAR: 'val' });
      }
    });
  });

  // =========================================================================
  // loadToEnv
  // =========================================================================
  describe('loadToEnv', () => {
    it('should return an error when store is locked', () => {
      const store = makeStore();
      const result = store.loadToEnv();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toMatch(/locked/i);
      }
    });

    it('should set process.env for stored built-in credentials', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({
        openaiApiKey: 'sk-env-openai',
        anthropicApiKey: 'sk-env-anthropic',
      });

      const result = store.loadToEnv();
      expect(result.ok).toBe(true);
      expect(process.env.OPENAI_API_KEY).toBe('sk-env-openai');
      expect(process.env.ANTHROPIC_API_KEY).toBe('sk-env-anthropic');
    });

    it('should map all supported provider keys to correct env vars', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({
        googleApiKey: 'g-key',
        zhipuApiKey: 'z-key',
        deepseekApiKey: 'ds-key',
        groqApiKey: 'gr-key',
        togetherApiKey: 'tg-key',
        mistralApiKey: 'mi-key',
        fireworksApiKey: 'fw-key',
        perplexityApiKey: 'pp-key',
        xaiApiKey: 'x-key',
        telegramBotToken: 'bot-tk',
        jwtSecret: 'jwt-s',
        encryptionKey: 'enc-k',
      });

      store.loadToEnv();

      expect(process.env.GOOGLE_API_KEY).toBe('g-key');
      expect(process.env.ZHIPU_API_KEY).toBe('z-key');
      expect(process.env.DEEPSEEK_API_KEY).toBe('ds-key');
      expect(process.env.GROQ_API_KEY).toBe('gr-key');
      expect(process.env.TOGETHER_API_KEY).toBe('tg-key');
      expect(process.env.MISTRAL_API_KEY).toBe('mi-key');
      expect(process.env.FIREWORKS_API_KEY).toBe('fw-key');
      expect(process.env.PERPLEXITY_API_KEY).toBe('pp-key');
      expect(process.env.XAI_API_KEY).toBe('x-key');
      expect(process.env.TELEGRAM_BOT_TOKEN).toBe('bot-tk');
      expect(process.env.JWT_SECRET).toBe('jwt-s');
      expect(process.env.ENCRYPTION_KEY).toBe('enc-k');
    });

    it('should not overwrite existing env vars', async () => {
      process.env.OPENAI_API_KEY = 'already-set';

      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-should-not-overwrite' });

      store.loadToEnv();
      expect(process.env.OPENAI_API_KEY).toBe('already-set');
    });

    it('should load custom credentials to env', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({
        custom: { MY_CUSTOM_VAR: 'custom-val' },
      });

      store.loadToEnv();
      expect(process.env.MY_CUSTOM_VAR).toBe('custom-val');
    });

    it('should not overwrite existing env for custom credentials', async () => {
      process.env.MY_CUSTOM_VAR = 'pre-existing';

      const store = await initAndUnlock();
      await store.setCredentials({
        custom: { MY_CUSTOM_VAR: 'should-not-replace' },
      });

      store.loadToEnv();
      expect(process.env.MY_CUSTOM_VAR).toBe('pre-existing');
    });

    it('should skip empty string values (falsy check)', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: '' });

      store.loadToEnv();
      expect(process.env.OPENAI_API_KEY).toBeUndefined();
    });

    it('should return ok even when there are no credentials', async () => {
      const store = await initAndUnlock();
      const result = store.loadToEnv();
      expect(result.ok).toBe(true);
    });
  });

  // =========================================================================
  // destroy
  // =========================================================================
  describe('destroy', () => {
    it('should delete the credential file from disk', async () => {
      const store = await initAndUnlock();
      expect(fsStore[TEST_PATH]).toBeDefined();

      const result = await store.destroy();
      expect(result.ok).toBe(true);
      expect(fsStore[TEST_PATH]).toBeUndefined();
    });

    it('should lock the store', async () => {
      const store = await initAndUnlock();
      await store.destroy();

      expect(store.unlocked).toBe(false);
    });

    it('should clear credentials from memory', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'sk-gone' });

      await store.destroy();

      const result = store.getCredentials();
      expect(result.ok).toBe(false);
    });

    it('should succeed even if file does not exist', async () => {
      const store = makeStore();
      // No file was ever created
      const result = await store.destroy();
      expect(result.ok).toBe(true);
    });

    it('should make isInitialized return false after destroy', async () => {
      const store = await initAndUnlock();
      expect(store.isInitialized()).toBe(true);

      await store.destroy();
      expect(store.isInitialized()).toBe(false);
    });
  });

  // =========================================================================
  // Operations after destroy
  // =========================================================================
  describe('operations after destroy', () => {
    it('should fail getCredentials after destroy', async () => {
      const store = await initAndUnlock();
      await store.destroy();

      const result = store.getCredentials();
      expect(result.ok).toBe(false);
    });

    it('should fail setCredentials after destroy', async () => {
      const store = await initAndUnlock();
      await store.destroy();

      const result = await store.setCredentials({ openaiApiKey: 'fail' });
      expect(result.ok).toBe(false);
    });

    it('should fail deleteCredential after destroy', async () => {
      const store = await initAndUnlock();
      await store.destroy();

      const result = await store.deleteCredential('openaiApiKey');
      expect(result.ok).toBe(false);
    });

    it('should fail loadToEnv after destroy', async () => {
      const store = await initAndUnlock();
      await store.destroy();

      const result = store.loadToEnv();
      expect(result.ok).toBe(false);
    });

    it('should allow re-initialization after destroy', async () => {
      const store = await initAndUnlock();
      await store.destroy();

      const initResult = await store.initialize(PASSWORD);
      expect(initResult.ok).toBe(true);

      const unlockResult = await store.unlock(PASSWORD);
      expect(unlockResult.ok).toBe(true);
    });
  });

  // =========================================================================
  // Security properties
  // =========================================================================
  describe('security properties', () => {
    it('should not store plaintext credentials in the file', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({
        openaiApiKey: 'sk-SUPER-SECRET-KEY-12345',
        anthropicApiKey: 'sk-ant-ANOTHER-SECRET',
      });

      const fileContent = fsStore[TEST_PATH];
      expect(fileContent).not.toContain('sk-SUPER-SECRET-KEY-12345');
      expect(fileContent).not.toContain('sk-ant-ANOTHER-SECRET');
    });

    it('should not store the password in the file', async () => {
      const store = makeStore();
      await store.initialize(PASSWORD);

      const fileContent = fsStore[TEST_PATH];
      expect(fileContent).not.toContain(PASSWORD);
    });

    it('should use AES-GCM (verified by successful decrypt roundtrip with webcrypto)', async () => {
      // Real crypto is used: if AES-GCM were not used, encrypt/decrypt
      // would fail since deriveKey creates an AES-GCM CryptoKey.
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'roundtrip-check' });

      store.lock();
      const result = await store.unlock(PASSWORD);
      expect(result.ok).toBe(true);

      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.openaiApiKey).toBe('roundtrip-check');
      }
    });

    it('should generate unique salt per initialization', async () => {
      const store1 = makeStore({ path: '/tmp/cred1.enc', iterations: 1 });
      await store1.initialize(PASSWORD);
      const file1 = JSON.parse(fsStore['/tmp/cred1.enc']);

      const store2 = makeStore({ path: '/tmp/cred2.enc', iterations: 1 });
      await store2.initialize(PASSWORD);
      const file2 = JSON.parse(fsStore['/tmp/cred2.enc']);

      expect(file1.salt).not.toBe(file2.salt);
    });

    it('should produce different ciphertext for same credentials (unique IV)', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'same-key' });
      const snapshot1 = fsStore[TEST_PATH];

      await store.setCredentials({ openaiApiKey: 'same-key' });
      const snapshot2 = fsStore[TEST_PATH];

      // data field should differ because a new IV is generated each time
      const data1 = JSON.parse(snapshot1).data;
      const data2 = JSON.parse(snapshot2).data;
      expect(data1).not.toBe(data2);
    });

    it('should write file with restricted permissions (0o600)', async () => {
      const store = await initAndUnlock();
      await store.setCredentials({ openaiApiKey: 'perms' });

      // Every writeFile call should specify mode 0o600
      for (const call of mockWriteFile.mock.calls) {
        const opts = call[2] as { mode?: number } | undefined;
        expect(opts?.mode).toBe(0o600);
      }
    });
  });

  // =========================================================================
  // Full end-to-end roundtrip
  // =========================================================================
  describe('full roundtrip', () => {
    it('should initialize -> unlock -> set -> lock -> unlock -> get', async () => {
      const store = makeStore();

      // 1. Initialize
      const initRes = await store.initialize(PASSWORD);
      expect(initRes.ok).toBe(true);

      // 2. Unlock
      const unlockRes = await store.unlock(PASSWORD);
      expect(unlockRes.ok).toBe(true);

      // 3. Set credentials
      await store.setCredentials({
        openaiApiKey: 'sk-full-test',
        anthropicApiKey: 'sk-ant-full',
        telegramBotToken: 'bot:123456',
        custom: { FOO: 'bar' },
      });

      // 4. Lock
      store.lock();
      expect(store.unlocked).toBe(false);

      // 5. Re-unlock
      const reUnlock = await store.unlock(PASSWORD);
      expect(reUnlock.ok).toBe(true);

      // 6. Verify all credentials survived
      const creds = store.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.openaiApiKey).toBe('sk-full-test');
        expect(creds.value.anthropicApiKey).toBe('sk-ant-full');
        expect(creds.value.telegramBotToken).toBe('bot:123456');
        expect(creds.value.custom).toEqual({ FOO: 'bar' });
      }
    });

    it('should work with a different store instance reading same file', async () => {
      const store1 = await initAndUnlock();
      await store1.setCredentials({ groqApiKey: 'gsk-shared' });

      // Second store reads the same file
      const store2 = makeStore();
      const unlockRes = await store2.unlock(PASSWORD);
      expect(unlockRes.ok).toBe(true);

      const creds = store2.getCredentials();
      expect(creds.ok).toBe(true);
      if (creds.ok) {
        expect(creds.value.groqApiKey).toBe('gsk-shared');
      }
    });
  });

  // =========================================================================
  // createCredentialStore factory
  // =========================================================================
  describe('createCredentialStore', () => {
    it('should return a CredentialStore instance', () => {
      const store = createCredentialStore({ path: TEST_PATH, iterations: 1 });
      expect(store).toBeInstanceOf(CredentialStore);
      expect(store.path).toBe(TEST_PATH);
    });

    it('should work with no config', () => {
      const store = createCredentialStore();
      expect(store).toBeInstanceOf(CredentialStore);
    });
  });

  // =========================================================================
  // getCredentialStore singleton
  // =========================================================================
  describe('getCredentialStore', () => {
    it('should return a CredentialStore instance', () => {
      const store = getCredentialStore();
      expect(store).toBeInstanceOf(CredentialStore);
    });

    it('should return the same instance on subsequent calls', () => {
      const store1 = getCredentialStore();
      const store2 = getCredentialStore();
      expect(store1).toBe(store2);
    });
  });
});
