import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['TRUSTED_PROXY', 'TRUSTED_PROXY_IPS'] as const;

function request(url: string, headers: Record<string, string> = {}) {
  return {
    url,
    header: (name: string) => headers[name.toLowerCase()],
  };
}

async function loadIsSecureRequest() {
  vi.resetModules();
  return (await import('./trusted-proxy.js')).isSecureRequest;
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  vi.resetModules();
});

describe('isSecureRequest', () => {
  it('recognizes HTTPS from the request URL', async () => {
    const isSecureRequest = await loadIsSecureRequest();
    expect(isSecureRequest(request('https://ownpilot.local/path'))).toBe(true);
  });

  it('ignores forwarded scheme headers when proxy trust is disabled', async () => {
    const isSecureRequest = await loadIsSecureRequest();
    expect(
      isSecureRequest(
        request('http://ownpilot.local/path', {
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe(false);
  });

  it('ignores forwarded scheme headers when the trusted proxy allowlist is missing', async () => {
    process.env.TRUSTED_PROXY = 'true';
    const isSecureRequest = await loadIsSecureRequest();
    expect(
      isSecureRequest(
        request('http://ownpilot.local/path', {
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe(false);
  });

  it('accepts forwarded HTTPS only with a configured trusted proxy', async () => {
    process.env.TRUSTED_PROXY = 'true';
    process.env.TRUSTED_PROXY_IPS = '127.0.0.1';
    const isSecureRequest = await loadIsSecureRequest();
    expect(
      isSecureRequest(
        request('http://ownpilot.local/path', {
          'x-forwarded-proto': 'HTTPS',
        })
      )
    ).toBe(true);
  });

  it('preserves trusted X-Forwarded-Scheme compatibility', async () => {
    process.env.TRUSTED_PROXY = 'true';
    process.env.TRUSTED_PROXY_IPS = '127.0.0.1';
    const isSecureRequest = await loadIsSecureRequest();
    expect(
      isSecureRequest(
        request('http://ownpilot.local/path', {
          'x-forwarded-scheme': 'https',
        })
      )
    ).toBe(true);
  });
});
