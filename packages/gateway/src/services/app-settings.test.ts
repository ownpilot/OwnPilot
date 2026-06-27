/**
 * Tests for the auth-resolution helpers in {@link app-settings}.
 *
 * Pinning behaviour:
 *  - `getResolvedAuth` prefers the new `provider_auth:<id>` blob when present.
 *  - Falls back to the legacy `api_key:<id>` string wrapped as
 *    `{ method: 'api_key', value }`.
 *  - Returns `undefined` when nothing is stored — call sites use that as a
 *    signal that no credential is configured.
 *  - Refuses malformed blobs (bad JSON, missing/empty `value`) and falls
 *    through to the legacy api_key path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResolvedAuth } from '@ownpilot/core/agent';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockHas = vi.fn();
const mockDelete = vi.fn();
const mockGetByPrefix = vi.fn();

vi.mock('../db/repositories/index.js', () => ({
  settingsRepo: {
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
    has: (...args: unknown[]) => mockHas(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    getByPrefix: (...args: unknown[]) => mockGetByPrefix(...args),
  },
  localProvidersRepo: {
    getProvider: vi.fn(),
    getDefault: vi.fn(),
    getProviderSync: vi.fn(),
  },
}));

vi.mock('../utils/common.js', () => ({
  sanitizeProviderName: (s: string) => s,
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  getResolvedAuth,
  setResolvedAuth,
  deleteResolvedAuth,
  getProviderOAuthOverride,
  setProviderOAuthOverride,
  deleteProviderOAuthOverride,
  AUTH_PREFIX,
  API_KEY_PREFIX,
  PROVIDER_OAUTH_CONFIG_PREFIX,
  getEffectiveAllowedDirs,
} from './app-settings.js';

describe('getResolvedAuth', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockHas.mockReset();
    mockDelete.mockReset();
  });

  it('returns the parsed blob when provider_auth:<id> is present', async () => {
    const stored: ResolvedAuth = {
      method: 'oauth2_device_code',
      value: 'access-xyz',
      refreshToken: 'refresh-xyz',
      expiresAt: 1234567890,
    };
    mockGet.mockImplementation(async (key: string) => {
      if (key === `${AUTH_PREFIX}openai`) return JSON.stringify(stored);
      return undefined;
    });

    const auth = await getResolvedAuth('openai');
    expect(auth).toEqual(stored);
  });

  it('falls back to api_key:<id> when no auth blob is stored', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === `${API_KEY_PREFIX}xai`) return 'sk-xai-legacy';
      return undefined;
    });

    const auth = await getResolvedAuth('xai');
    expect(auth).toEqual({ method: 'api_key', value: 'sk-xai-legacy' });
  });

  it('returns undefined when neither blob nor api_key is stored', async () => {
    mockGet.mockResolvedValue(undefined);

    const auth = await getResolvedAuth('unconfigured-provider');
    expect(auth).toBeUndefined();
  });

  it('falls through to api_key when stored blob is unparseable', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === `${AUTH_PREFIX}deepseek`) return '{not valid json';
      if (key === `${API_KEY_PREFIX}deepseek`) return 'sk-deepseek-real';
      return undefined;
    });

    const auth = await getResolvedAuth('deepseek');
    expect(auth).toEqual({ method: 'api_key', value: 'sk-deepseek-real' });
  });

  it('falls through to api_key when blob is missing the value field', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === `${AUTH_PREFIX}groq`) return JSON.stringify({ method: 'session_token' });
      if (key === `${API_KEY_PREFIX}groq`) return 'sk-groq-real';
      return undefined;
    });

    const auth = await getResolvedAuth('groq');
    expect(auth).toEqual({ method: 'api_key', value: 'sk-groq-real' });
  });

  it('falls through when blob value is an empty string (treated as malformed)', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === `${AUTH_PREFIX}mistral`) {
        return JSON.stringify({ method: 'session_token', value: '' });
      }
      if (key === `${API_KEY_PREFIX}mistral`) return 'sk-mistral-real';
      return undefined;
    });

    const auth = await getResolvedAuth('mistral');
    expect(auth).toEqual({ method: 'api_key', value: 'sk-mistral-real' });
  });
});

describe('setResolvedAuth', () => {
  beforeEach(() => {
    mockSet.mockReset();
  });

  it('writes the JSON-encoded blob under provider_auth:<id>', async () => {
    const auth: ResolvedAuth = {
      method: 'oauth2_pkce',
      value: 'pkce-access',
      refreshToken: 'pkce-refresh',
      expiresAt: 9999999999,
      scopes: ['profile', 'completion'],
    };

    await setResolvedAuth('codex', auth);

    expect(mockSet).toHaveBeenCalledWith(`${AUTH_PREFIX}codex`, JSON.stringify(auth));
  });
});

describe('deleteResolvedAuth', () => {
  beforeEach(() => {
    mockDelete.mockReset();
  });

  it('deletes only the provider_auth:<id> key (legacy api_key is preserved)', async () => {
    await deleteResolvedAuth('xai');

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith(`${AUTH_PREFIX}xai`);
  });
});

describe('getProviderOAuthOverride', () => {
  beforeEach(() => mockGet.mockReset());

  it('returns the parsed override when stored', async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === `${PROVIDER_OAUTH_CONFIG_PREFIX}github`) {
        return JSON.stringify({ clientId: 'my-app', scopes: ['models'] });
      }
      return undefined;
    });
    await expect(getProviderOAuthOverride('github')).resolves.toEqual({
      clientId: 'my-app',
      scopes: ['models'],
    });
  });

  it('returns undefined when nothing is stored', async () => {
    mockGet.mockResolvedValue(undefined);
    await expect(getProviderOAuthOverride('unknown')).resolves.toBeUndefined();
  });

  it('returns undefined when stored blob is unparseable (and logs)', async () => {
    mockGet.mockResolvedValue('{not json');
    await expect(getProviderOAuthOverride('github')).resolves.toBeUndefined();
  });
});

describe('setProviderOAuthOverride', () => {
  beforeEach(() => mockSet.mockReset());

  it('writes the JSON-encoded blob under provider_oauth_config:<id>', async () => {
    await setProviderOAuthOverride('github', {
      deviceCodeUrl: 'https://github.com/login/device/code',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientId: 'my-app',
      scopes: ['models'],
    });
    expect(mockSet).toHaveBeenCalledWith(
      `${PROVIDER_OAUTH_CONFIG_PREFIX}github`,
      expect.stringContaining('my-app')
    );
  });
});

describe('deleteProviderOAuthOverride', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes only the override key', async () => {
    await deleteProviderOAuthOverride('github');
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith(`${PROVIDER_OAUTH_CONFIG_PREFIX}github`);
  });
});

describe('getEffectiveAllowedDirs (CODING-AGENT-CWD)', () => {
  const prevWorkspace = process.env.WORKSPACE_DIR;
  const prevAnyDir = process.env.OWNPILOT_CODING_AGENT_ANY_DIR;

  beforeEach(() => {
    mockGet.mockReset();
    delete process.env.WORKSPACE_DIR;
    delete process.env.OWNPILOT_CODING_AGENT_ANY_DIR;
  });

  afterEach(() => {
    if (prevWorkspace === undefined) delete process.env.WORKSPACE_DIR;
    else process.env.WORKSPACE_DIR = prevWorkspace;
    if (prevAnyDir === undefined) delete process.env.OWNPILOT_CODING_AGENT_ANY_DIR;
    else process.env.OWNPILOT_CODING_AGENT_ANY_DIR = prevAnyDir;
  });

  it('returns the configured directories when the operator has set them', async () => {
    mockGet.mockResolvedValue(JSON.stringify(['/srv/projects', '/work']));
    expect(await getEffectiveAllowedDirs()).toEqual(['/srv/projects', '/work']);
  });

  it('default-denies to the workspace root when no dirs are configured', async () => {
    mockGet.mockResolvedValue(undefined);
    process.env.WORKSPACE_DIR = '/data/workspace';
    expect(await getEffectiveAllowedDirs()).toEqual(['/data/workspace']);
  });

  it('falls back to process.cwd() when WORKSPACE_DIR is unset', async () => {
    mockGet.mockResolvedValue(undefined);
    expect(await getEffectiveAllowedDirs()).toEqual([process.cwd()]);
  });

  it('returns [] (unrestricted) only when OWNPILOT_CODING_AGENT_ANY_DIR=true', async () => {
    mockGet.mockResolvedValue(undefined);
    process.env.OWNPILOT_CODING_AGENT_ANY_DIR = 'true';
    expect(await getEffectiveAllowedDirs()).toEqual([]);
  });

  it('configured dirs take precedence over the any-dir opt-in', async () => {
    mockGet.mockResolvedValue(JSON.stringify(['/work']));
    process.env.OWNPILOT_CODING_AGENT_ANY_DIR = 'true';
    expect(await getEffectiveAllowedDirs()).toEqual(['/work']);
  });
});
