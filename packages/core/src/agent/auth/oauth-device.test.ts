/**
 * Tests for the OAuth 2.0 device-authorization primitives.
 *
 * The polling and refresh tests pin the wire shape — request body must use
 * `application/x-www-form-urlencoded` with the exact RFC 8628 / RFC 6749
 * grant types — because providers reject anything else with opaque errors.
 */

import { describe, it, expect, vi } from 'vitest';
import { startDeviceAuthorization, pollForToken, refreshAccessToken } from './oauth-device.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('startDeviceAuthorization', () => {
  it('POSTs client_id+scope as form data and parses the response', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        device_code: 'devcode-abc',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://example.com/device',
        verification_uri_complete: 'https://example.com/device?user_code=WDJB-MJHT',
        expires_in: 1800,
        interval: 7,
      })
    );

    const result = await startDeviceAuthorization({
      deviceCodeUrl: 'https://example.com/oauth/device',
      clientId: 'codex-cli',
      scope: 'completion profile',
      fetchImpl,
    });

    expect(result).toEqual({
      deviceCode: 'devcode-abc',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://example.com/device',
      verificationUriComplete: 'https://example.com/device?user_code=WDJB-MJHT',
      expiresIn: 1800,
      interval: 7,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://example.com/oauth/device');
    const initObj = init as RequestInit;
    expect(initObj.method).toBe('POST');
    expect((initObj.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );
    const body = new URLSearchParams(initObj.body as string);
    expect(body.get('client_id')).toBe('codex-cli');
    expect(body.get('scope')).toBe('completion profile');
  });

  it('defaults interval to 5 and expiresIn to 900 when omitted', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        device_code: 'd',
        user_code: 'u',
        verification_uri: 'https://example.com/d',
      })
    );

    const result = await startDeviceAuthorization({
      deviceCodeUrl: 'https://example.com/oauth/device',
      clientId: 'x',
      fetchImpl,
    });

    expect(result.interval).toBe(5);
    expect(result.expiresIn).toBe(900);
  });

  it('accepts verification_url alias (Google-style providers)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        device_code: 'd',
        user_code: 'u',
        verification_url: 'https://example.com/google-device',
      })
    );

    const result = await startDeviceAuthorization({
      deviceCodeUrl: 'https://example.com/oauth/device',
      clientId: 'x',
      fetchImpl,
    });

    expect(result.verificationUri).toBe('https://example.com/google-device');
  });

  it('forwards extraParams in the form body', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        device_code: 'd',
        user_code: 'u',
        verification_uri: 'https://example.com/d',
      })
    );

    await startDeviceAuthorization({
      deviceCodeUrl: 'https://example.com/oauth/device',
      clientId: 'x',
      extraParams: { audience: 'https://api.example.com' },
      fetchImpl,
    });

    const body = new URLSearchParams((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.get('audience')).toBe('https://api.example.com');
  });

  it('throws on non-2xx response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('bad client', { status: 401, statusText: 'Unauthorized' })
    );

    await expect(
      startDeviceAuthorization({
        deviceCodeUrl: 'https://example.com/oauth/device',
        clientId: 'x',
        fetchImpl,
      })
    ).rejects.toThrow(/401/);
  });

  it('throws on malformed body (missing required fields)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user_code: 'only' }));

    await expect(
      startDeviceAuthorization({
        deviceCodeUrl: 'https://example.com/oauth/device',
        clientId: 'x',
        fetchImpl,
      })
    ).rejects.toThrow(/Malformed/);
  });
});

describe('pollForToken', () => {
  it('returns success with parsed token on 2xx + access_token', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: 'at-xyz',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rt-xyz',
        scope: 'completion',
      })
    );

    const result = await pollForToken({
      tokenUrl: 'https://example.com/oauth/token',
      clientId: 'codex-cli',
      deviceCode: 'devcode-abc',
      fetchImpl,
    });

    expect(result).toEqual({
      status: 'success',
      token: {
        accessToken: 'at-xyz',
        tokenType: 'Bearer',
        expiresIn: 3600,
        refreshToken: 'rt-xyz',
        scope: 'completion',
      },
    });

    const body = new URLSearchParams((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    expect(body.get('device_code')).toBe('devcode-abc');
    expect(body.get('client_id')).toBe('codex-cli');
  });

  it('returns pending on authorization_pending', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'authorization_pending' }, 400));

    const result = await pollForToken({
      tokenUrl: 'https://example.com/oauth/token',
      clientId: 'x',
      deviceCode: 'd',
      fetchImpl,
    });

    expect(result).toEqual({ status: 'pending', error: 'authorization_pending' });
  });

  it('returns pending on slow_down', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'slow_down' }, 400));

    const result = await pollForToken({
      tokenUrl: 'https://example.com/oauth/token',
      clientId: 'x',
      deviceCode: 'd',
      fetchImpl,
    });

    expect(result).toEqual({ status: 'pending', error: 'slow_down' });
  });

  it('returns error on access_denied (terminal)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'access_denied', error_description: 'user said no' }, 400)
    );

    const result = await pollForToken({
      tokenUrl: 'https://example.com/oauth/token',
      clientId: 'x',
      deviceCode: 'd',
      fetchImpl,
    });

    expect(result).toEqual({
      status: 'error',
      error: 'access_denied',
      description: 'user said no',
    });
  });

  it('returns error on expired_token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'expired_token' }, 400));

    const result = await pollForToken({
      tokenUrl: 'https://example.com/oauth/token',
      clientId: 'x',
      deviceCode: 'd',
      fetchImpl,
    });

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error).toBe('expired_token');
  });

  it('returns error when response body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>oops</html>', { status: 502 }));

    const result = await pollForToken({
      tokenUrl: 'https://example.com/oauth/token',
      clientId: 'x',
      deviceCode: 'd',
      fetchImpl,
    });

    expect(result.status).toBe('error');
  });
});

describe('refreshAccessToken', () => {
  it('POSTs refresh_token grant and returns the new token', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: 'new-at',
        expires_in: 3600,
        refresh_token: 'rotated-rt',
      })
    );

    const result = await refreshAccessToken({
      tokenUrl: 'https://example.com/oauth/token',
      clientId: 'codex-cli',
      refreshToken: 'old-rt',
      fetchImpl,
    });

    expect(result.accessToken).toBe('new-at');
    expect(result.refreshToken).toBe('rotated-rt');
    expect(result.expiresIn).toBe(3600);

    const body = new URLSearchParams((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-rt');
    expect(body.get('client_id')).toBe('codex-cli');
  });

  it('throws on non-2xx response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('invalid_grant', { status: 400, statusText: 'Bad Request' })
    );

    await expect(
      refreshAccessToken({
        tokenUrl: 'https://example.com/oauth/token',
        clientId: 'x',
        refreshToken: 'bad',
        fetchImpl,
      })
    ).rejects.toThrow(/400/);
  });

  it('throws when response lacks access_token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ token_type: 'Bearer' }));

    await expect(
      refreshAccessToken({
        tokenUrl: 'https://example.com/oauth/token',
        clientId: 'x',
        refreshToken: 'rt',
        fetchImpl,
      })
    ).rejects.toThrow(/access_token/);
  });
});
