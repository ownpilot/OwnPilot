import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { setUiSessionCookie, UI_SESSION_COOKIE } from './ui-session-cookie.js';

/**
 * Focused coverage for the session-cookie Secure-flag policy. The cookie must
 * be Secure when the operator opts into HTTPS (explicit flag or HTTPS_ONLY) and
 * must stay non-Secure on plain-HTTP localhost so the browser still sends it.
 */
function appThatSetsCookie() {
  const app = new Hono();
  app.get('/set', (c) => {
    setUiSessionCookie(c, 'tok-123', new Date(Date.now() + 60_000));
    return c.text('ok');
  });
  return app;
}

async function getSetCookie(): Promise<string> {
  const res = await appThatSetsCookie().request('http://localhost/set');
  return res.headers.get('set-cookie') ?? '';
}

describe('setUiSessionCookie Secure policy', () => {
  const ENV_KEYS = ['UI_SESSION_COOKIE_SECURE', 'HTTPS_ONLY', 'TRUSTED_PROXY'] as const;
  const saved: Record<string, string | undefined> = {};

  // Restore an env var to its exact prior state. Assigning `undefined` to a
  // process.env key coerces to the string "undefined" (truthy!) and would leak
  // to later test files sharing the same worker — delete instead when unset.
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) restore(key, saved[key]);
  });

  it('omits Secure on a plain-HTTP request by default', async () => {
    const cookie = await getSetCookie();
    expect(cookie).toContain(`${UI_SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });

  it('forces Secure when HTTPS_ONLY=true even on a plain-HTTP hop', async () => {
    process.env.HTTPS_ONLY = 'true';
    const cookie = await getSetCookie();
    expect(cookie).toMatch(/;\s*Secure/i);
  });

  it('forces Secure when UI_SESSION_COOKIE_SECURE=true', async () => {
    process.env.UI_SESSION_COOKIE_SECURE = 'true';
    const cookie = await getSetCookie();
    expect(cookie).toMatch(/;\s*Secure/i);
  });

  it('explicit UI_SESSION_COOKIE_SECURE=false wins over HTTPS_ONLY', async () => {
    process.env.UI_SESSION_COOKIE_SECURE = 'false';
    process.env.HTTPS_ONLY = 'true';
    const cookie = await getSetCookie();
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });
});
