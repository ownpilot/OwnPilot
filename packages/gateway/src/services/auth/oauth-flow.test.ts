/**
 * Tests for the gateway OAuth flow service.
 *
 * Mocks the core OAuth primitives + app-settings, then drives the start /
 * poll / refresh paths to assert the right blobs land in the settings
 * store and that auto-refresh swaps tokens transparently.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStart = vi.fn();
const mockPoll = vi.fn();
const mockRefresh = vi.fn();
const mockIsExpired = vi.fn();
const mockGetProviderConfig = vi.fn();

const mockGetResolvedAuth = vi.fn();
const mockSetResolvedAuth = vi.fn();
const mockDeleteResolvedAuth = vi.fn();
const mockGetProviderOAuthOverride = vi.fn();

vi.mock('@ownpilot/core', () => ({
  startDeviceAuthorization: (...args: unknown[]) => mockStart(...args),
  pollForToken: (...args: unknown[]) => mockPoll(...args),
  refreshAccessToken: (...args: unknown[]) => mockRefresh(...args),
  isAuthExpired: (...args: unknown[]) => mockIsExpired(...args),
  getProviderConfig: (...args: unknown[]) => mockGetProviderConfig(...args),
}));

vi.mock('../app-settings.js', () => ({
  getResolvedAuth: (...args: unknown[]) => mockGetResolvedAuth(...args),
  setResolvedAuth: (...args: unknown[]) => mockSetResolvedAuth(...args),
  deleteResolvedAuth: (...args: unknown[]) => mockDeleteResolvedAuth(...args),
  getProviderOAuthOverride: (...args: unknown[]) => mockGetProviderOAuthOverride(...args),
}));

vi.mock('../log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  startDeviceFlow,
  pollPendingDeviceFlow,
  resolveAuthForRequest,
  signOutProvider,
  getProviderOAuthConfig,
  _clearPendingDeviceFlowsForTest,
} from './oauth-flow.js';

const OAUTH_CONFIG = {
  deviceCodeUrl: 'https://example.com/oauth/device',
  tokenUrl: 'https://example.com/oauth/token',
  clientId: 'codex-cli',
  scopes: ['completion', 'profile'],
};

function providerWithOAuth() {
  return {
    auth: {
      default: 'oauth2_device_code',
      supported: ['oauth2_device_code'],
      oauth: OAUTH_CONFIG,
    },
  };
}

beforeEach(() => {
  mockStart.mockReset();
  mockPoll.mockReset();
  mockRefresh.mockReset();
  mockIsExpired.mockReset();
  mockGetProviderConfig.mockReset();
  mockGetResolvedAuth.mockReset();
  mockSetResolvedAuth.mockReset();
  mockDeleteResolvedAuth.mockReset();
  mockGetProviderOAuthOverride.mockReset();
  mockGetProviderOAuthOverride.mockResolvedValue(undefined);
  _clearPendingDeviceFlowsForTest();
});

describe('getProviderOAuthConfig', () => {
  it('returns oauth config when provider supports a device-code method', async () => {
    mockGetProviderConfig.mockReturnValue(providerWithOAuth());
    await expect(getProviderOAuthConfig('codex')).resolves.toEqual(OAUTH_CONFIG);
  });

  it('returns null when provider has no oauth block and no override', async () => {
    mockGetProviderConfig.mockReturnValue({ auth: { default: 'api_key', supported: ['api_key'] } });
    await expect(getProviderOAuthConfig('openai')).resolves.toBeNull();
  });

  it('returns null when provider has oauth block but does not list a device/pkce method', async () => {
    mockGetProviderConfig.mockReturnValue({
      auth: {
        default: 'api_key',
        supported: ['api_key'],
        oauth: OAUTH_CONFIG,
      },
    });
    await expect(getProviderOAuthConfig('something')).resolves.toBeNull();
  });

  it('overlays an override on top of catalog (override fields win)', async () => {
    mockGetProviderConfig.mockReturnValue(providerWithOAuth());
    mockGetProviderOAuthOverride.mockResolvedValue({ clientId: 'my-own-client' });
    const merged = await getProviderOAuthConfig('codex');
    expect(merged).toEqual({
      ...OAUTH_CONFIG,
      clientId: 'my-own-client',
    });
  });

  it('override alone opts a non-catalog provider into OAuth when all three fields are supplied', async () => {
    mockGetProviderConfig.mockReturnValue(undefined); // catalog has no entry at all
    mockGetProviderOAuthOverride.mockResolvedValue({
      deviceCodeUrl: 'https://my-corp/oauth/device',
      tokenUrl: 'https://my-corp/oauth/token',
      clientId: 'my-corp-app',
      scopes: ['llm'],
    });
    const result = await getProviderOAuthConfig('mystery-provider');
    expect(result).toEqual({
      deviceCodeUrl: 'https://my-corp/oauth/device',
      authorizationUrl: undefined,
      tokenUrl: 'https://my-corp/oauth/token',
      clientId: 'my-corp-app',
      scopes: ['llm'],
    });
  });

  it('refuses an override that does not supply the three required endpoint fields if the catalog does not opt in', async () => {
    mockGetProviderConfig.mockReturnValue({ auth: { default: 'api_key', supported: ['api_key'] } });
    mockGetProviderOAuthOverride.mockResolvedValue({ clientId: 'only-clientid' });
    await expect(getProviderOAuthConfig('openai')).resolves.toBeNull();
  });
});

describe('startDeviceFlow', () => {
  it('calls startDeviceAuthorization with the catalog config and registers pending state', async () => {
    mockGetProviderConfig.mockReturnValue(providerWithOAuth());
    mockStart.mockResolvedValue({
      deviceCode: 'dev-1',
      userCode: 'AB12',
      verificationUri: 'https://example.com/dev',
      expiresIn: 300,
      interval: 5,
    });

    const result = await startDeviceFlow('codex');

    expect(mockStart).toHaveBeenCalledWith({
      deviceCodeUrl: OAUTH_CONFIG.deviceCodeUrl,
      clientId: OAUTH_CONFIG.clientId,
      scope: 'completion profile',
    });
    expect(result.userCode).toBe('AB12');
  });

  it('throws when provider config is missing or non-OAuth', async () => {
    mockGetProviderConfig.mockReturnValue(undefined);
    await expect(startDeviceFlow('openai')).rejects.toThrow(/not configured for OAuth/);
  });
});

describe('pollPendingDeviceFlow', () => {
  it('returns error when no pending flow exists for the provider', async () => {
    const result = await pollPendingDeviceFlow('unknown');
    expect(result.status).toBe('error');
  });

  it('returns pending and bumps interval on slow_down', async () => {
    mockGetProviderConfig.mockReturnValue(providerWithOAuth());
    mockStart.mockResolvedValue({
      deviceCode: 'dev-1',
      userCode: 'AB12',
      verificationUri: 'https://example.com/dev',
      expiresIn: 300,
      interval: 5,
    });
    await startDeviceFlow('codex');

    mockPoll.mockResolvedValue({ status: 'pending', error: 'slow_down' });
    const r1 = await pollPendingDeviceFlow('codex');
    expect(r1).toEqual({ status: 'pending', intervalSec: 10 });

    mockPoll.mockResolvedValue({ status: 'pending', error: 'authorization_pending' });
    const r2 = await pollPendingDeviceFlow('codex');
    expect(r2).toEqual({ status: 'pending', intervalSec: 10 });
  });

  it('returns success, persists ResolvedAuth, and clears pending state', async () => {
    mockGetProviderConfig.mockReturnValue(providerWithOAuth());
    mockStart.mockResolvedValue({
      deviceCode: 'dev-1',
      userCode: 'AB12',
      verificationUri: 'https://example.com/dev',
      expiresIn: 300,
      interval: 5,
    });
    await startDeviceFlow('codex');

    mockPoll.mockResolvedValue({
      status: 'success',
      token: {
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        expiresIn: 3600,
        scope: 'completion profile',
      },
    });

    const result = await pollPendingDeviceFlow('codex');

    expect(result.status).toBe('success');
    expect(mockSetResolvedAuth).toHaveBeenCalledWith(
      'codex',
      expect.objectContaining({
        method: 'oauth2_device_code',
        value: 'at-1',
        refreshToken: 'rt-1',
        scopes: ['completion', 'profile'],
      })
    );

    // Pending state cleared — second poll returns error
    mockPoll.mockResolvedValue({ status: 'success', token: { accessToken: 'irrelevant' } });
    const second = await pollPendingDeviceFlow('codex');
    expect(second.status).toBe('error');
  });

  it('returns denied when token endpoint reports access_denied', async () => {
    mockGetProviderConfig.mockReturnValue(providerWithOAuth());
    mockStart.mockResolvedValue({
      deviceCode: 'dev-1',
      userCode: 'AB12',
      verificationUri: 'https://example.com/dev',
      expiresIn: 300,
      interval: 5,
    });
    await startDeviceFlow('codex');

    mockPoll.mockResolvedValue({
      status: 'error',
      error: 'access_denied',
      description: 'user said no',
    });

    const result = await pollPendingDeviceFlow('codex');
    expect(result).toEqual({ status: 'denied', reason: 'user said no' });
  });
});

describe('resolveAuthForRequest', () => {
  it('returns the stored auth unchanged when not an oauth method', async () => {
    mockGetResolvedAuth.mockResolvedValue({ method: 'api_key', value: 'sk-test' });
    const auth = await resolveAuthForRequest('openai');
    expect(auth).toEqual({ method: 'api_key', value: 'sk-test' });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('returns the stored auth when oauth token is not expired', async () => {
    mockGetResolvedAuth.mockResolvedValue({
      method: 'oauth2_device_code',
      value: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 600_000,
    });
    mockIsExpired.mockReturnValue(false);
    const auth = await resolveAuthForRequest('codex');
    expect(auth?.value).toBe('at');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes expired oauth token and writes the rotated value back', async () => {
    mockGetResolvedAuth.mockResolvedValue({
      method: 'oauth2_device_code',
      value: 'old-at',
      refreshToken: 'old-rt',
      expiresAt: Date.now() - 1000,
    });
    mockIsExpired.mockReturnValue(true);
    mockGetProviderConfig.mockReturnValue(providerWithOAuth());
    mockRefresh.mockResolvedValue({
      accessToken: 'new-at',
      refreshToken: 'new-rt',
      expiresIn: 3600,
    });

    const auth = await resolveAuthForRequest('codex');

    expect(mockRefresh).toHaveBeenCalledWith({
      tokenUrl: OAUTH_CONFIG.tokenUrl,
      clientId: OAUTH_CONFIG.clientId,
      refreshToken: 'old-rt',
    });
    expect(auth?.value).toBe('new-at');
    expect(mockSetResolvedAuth).toHaveBeenCalledWith(
      'codex',
      expect.objectContaining({
        method: 'oauth2_device_code',
        value: 'new-at',
        refreshToken: 'new-rt',
      })
    );
  });

  it('keeps the old refresh token when provider does not rotate', async () => {
    mockGetResolvedAuth.mockResolvedValue({
      method: 'oauth2_pkce',
      value: 'old-at',
      refreshToken: 'keep-this-rt',
      expiresAt: Date.now() - 1000,
    });
    mockIsExpired.mockReturnValue(true);
    mockGetProviderConfig.mockReturnValue(providerWithOAuth());
    mockRefresh.mockResolvedValue({ accessToken: 'fresh-at', expiresIn: 3600 });

    const auth = await resolveAuthForRequest('codex');
    expect(auth?.refreshToken).toBe('keep-this-rt');
  });

  it('returns stale token (no throw) when refresh fails — provider blip survival', async () => {
    mockGetResolvedAuth.mockResolvedValue({
      method: 'oauth2_device_code',
      value: 'stale-at',
      refreshToken: 'rt',
      expiresAt: Date.now() - 1000,
    });
    mockIsExpired.mockReturnValue(true);
    mockGetProviderConfig.mockReturnValue(providerWithOAuth());
    mockRefresh.mockRejectedValue(new Error('token endpoint down'));

    const auth = await resolveAuthForRequest('codex');
    expect(auth?.value).toBe('stale-at');
    expect(mockSetResolvedAuth).not.toHaveBeenCalled();
  });

  it('returns undefined when nothing is stored', async () => {
    mockGetResolvedAuth.mockResolvedValue(undefined);
    const auth = await resolveAuthForRequest('unknown');
    expect(auth).toBeUndefined();
  });

  it('returns the stored auth when refresh token is missing (cannot refresh)', async () => {
    mockGetResolvedAuth.mockResolvedValue({
      method: 'oauth2_pkce',
      value: 'at',
      expiresAt: Date.now() - 1000,
    });
    mockIsExpired.mockReturnValue(true);
    const auth = await resolveAuthForRequest('codex');
    expect(auth?.value).toBe('at');
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe('signOutProvider', () => {
  it('deletes the stored auth and clears any pending flow', async () => {
    mockGetProviderConfig.mockReturnValue(providerWithOAuth());
    mockStart.mockResolvedValue({
      deviceCode: 'd',
      userCode: 'u',
      verificationUri: 'https://example.com',
      expiresIn: 300,
      interval: 5,
    });
    await startDeviceFlow('codex');
    await signOutProvider('codex');

    expect(mockDeleteResolvedAuth).toHaveBeenCalledWith('codex');

    // Subsequent poll should report no pending flow
    const result = await pollPendingDeviceFlow('codex');
    expect(result.status).toBe('error');
  });
});
