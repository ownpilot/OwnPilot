/**
 * Tests for the OAuth device-code auth routes.
 *
 * Focus: the validateBody/ValidationError handling for the 4 JSON-accepting
 * endpoints. After the R3 refactor each endpoint routes parse + schema errors
 * through a single `try/catch (err)` block — these tests pin that contract:
 *
 *   1. Invalid JSON body         → 400 INVALID_INPUT  ("Invalid JSON body")
 *   2. Schema validation failure → 400 VALIDATION_ERROR (Zod issues)
 *   3. Valid body + mock success → 200 + business data
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import authRoutes from './auth.js';
import {
  startDeviceFlow,
  pollPendingDeviceFlow,
  signOutProvider,
  getProviderOAuthConfig,
} from '../services/auth/oauth-flow.js';
import {
  getResolvedAuth,
  getProviderOAuthOverride,
  setProviderOAuthOverride,
  deleteProviderOAuthOverride,
} from '../services/app-settings.js';
import { getAvailableProviders } from '@ownpilot/core';
import { uiSessionMiddleware } from '../middleware/ui-session.js';

// Bypass session middleware — auth route tests don't care about session state.
vi.mock('../middleware/ui-session.js', () => ({
  uiSessionMiddleware: vi.fn(async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock('../services/auth/oauth-flow.js', () => ({
  startDeviceFlow: vi.fn(),
  pollPendingDeviceFlow: vi.fn(),
  signOutProvider: vi.fn(),
  getProviderOAuthConfig: vi.fn(),
}));

vi.mock('../services/app-settings.js', () => ({
  getResolvedAuth: vi.fn(),
  getProviderOAuthOverride: vi.fn(),
  setProviderOAuthOverride: vi.fn(),
  deleteProviderOAuthOverride: vi.fn(),
}));

vi.mock('@ownpilot/core', () => ({
  getAvailableProviders: vi.fn(() => []),
}));

const mockStart = vi.mocked(startDeviceFlow);
const mockPoll = vi.mocked(pollPendingDeviceFlow);
const mockSignOut = vi.mocked(signOutProvider);
const mockGetConfig = vi.mocked(getProviderOAuthConfig);
const mockGetAuth = vi.mocked(getResolvedAuth);
const mockGetOverride = vi.mocked(getProviderOAuthOverride);
const mockSetOverride = vi.mocked(setProviderOAuthOverride);
const _mockDeleteOverride = vi.mocked(deleteProviderOAuthOverride);

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply per-test mock implementations cleared above.
  mockGetConfig.mockResolvedValue(null);
  mockGetAuth.mockResolvedValue(null);
  mockGetOverride.mockResolvedValue(null);
});

// ── POST /auth/oauth/device/start ─────────────────────────────────

describe('POST /auth/oauth/device/start', () => {
  const post = (body: unknown) =>
    authRoutes.request('/oauth/device/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('returns 200 with device code on valid body', async () => {
    mockStart.mockResolvedValue({
      userCode: 'ABCD-1234',
      verificationUri: 'https://example.com/dev',
      verificationUriComplete: 'https://example.com/dev?code=ABCD',
      deviceCode: 'secret',
      expiresIn: 600,
      interval: 5,
    });

    const res = await post({ provider: 'openai' });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.userCode).toBe('ABCD-1234');
    expect(json.data.verificationUri).toBe('https://example.com/dev');
    // device_code must never leak to the client
    expect(json.data.deviceCode).toBeUndefined();
  });

  it('returns 400 INVALID_INPUT for malformed JSON', async () => {
    const res = await post('{not valid json');
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('INVALID_INPUT');
    expect(json.error.message).toBe('Invalid JSON body');
  });

  it('returns 400 VALIDATION_ERROR for missing provider field', async () => {
    const res = await post({});
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR for empty provider string', async () => {
    const res = await post({ provider: '' });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for provider that fails sanitizeProviderName', async () => {
    // Invalid chars that sanitizeProviderName strips to ''
    const res = await post({ provider: '!!!' });
    expect(res.status).toBe(400);
  });
});

// ── POST /auth/oauth/device/poll ──────────────────────────────────

describe('POST /auth/oauth/device/poll', () => {
  const post = (body: unknown) =>
    authRoutes.request('/oauth/device/poll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('returns success status when flow completes', async () => {
    mockPoll.mockResolvedValue({
      status: 'success',
      auth: { method: 'oauth', hasExpiry: true, expiresAt: 999 },
    });

    const res = await post({ provider: 'openai' });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.status).toBe('success');
    expect(json.data.method).toBe('oauth');
  });

  it('returns pending status with intervalSec', async () => {
    mockPoll.mockResolvedValue({ status: 'pending', intervalSec: 5 });

    const res = await post({ provider: 'openai' });
    const json = await res.json();
    expect(json.data.status).toBe('pending');
    expect(json.data.intervalSec).toBe(5);
  });

  it('returns 400 VALIDATION_ERROR for missing provider', async () => {
    const res = await post({});
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── POST /auth/signout ────────────────────────────────────────────

describe('POST /auth/signout', () => {
  const post = (body: unknown) =>
    authRoutes.request('/signout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('returns 200 with signedOut:true on success', async () => {
    mockSignOut.mockResolvedValue(undefined);

    const res = await post({ provider: 'openai' });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.signedOut).toBe(true);
    // sanitizeProviderName uppercases the provider id before passing to the service
    expect(mockSignOut).toHaveBeenCalledWith('OPENAI');
  });

  it('returns 400 VALIDATION_ERROR for missing provider', async () => {
    const res = await post({});
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── PUT /auth/config/:provider ────────────────────────────────────

describe('PUT /auth/config/:provider', () => {
  const put = (provider: string, body: unknown) =>
    authRoutes.request(`/config/${provider}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('stores override when at least one field is set', async () => {
    mockSetOverride.mockResolvedValue(undefined);

    const res = await put('openai', { clientId: 'my-client-id' });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.override).toEqual({ clientId: 'my-client-id' });
    expect(mockSetOverride).toHaveBeenCalledWith('OPENAI', { clientId: 'my-client-id' });
  });

  it('rejects empty body — use DELETE instead', async () => {
    const res = await put('openai', {});
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('INVALID_INPUT');
    expect(json.error.message).toMatch(/At least one field/);
  });

  it('rejects malformed JSON', async () => {
    const res = await put('openai', '{not json');
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('INVALID_INPUT');
  });

  it('rejects invalid URL in deviceCodeUrl', async () => {
    const res = await put('openai', { deviceCodeUrl: 'not-a-url' });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── GET /auth/providers (no body — sanity smoke test) ────────────

describe('GET /auth/providers', () => {
  it('returns empty providers list when none configured', async () => {
    (getAvailableProviders as unknown as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const res = await authRoutes.request('/providers');
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.providers).toEqual([]);
  });
});

// Touch uiSessionMiddleware to keep the import live in the test
// (the mock above is the active replacement; this just silences noUnusedLocals).
void uiSessionMiddleware;
