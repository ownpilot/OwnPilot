import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

export const UI_SESSION_COOKIE = 'ownpilot_ui_session';

export interface UiSessionAuth {
  token?: string;
  source: 'header' | 'cookie' | 'none';
}

export interface UiSessionAuthOptions {
  allowHeader?: boolean;
}

function isSecureCookie(c: Context): boolean {
  if (process.env.UI_SESSION_COOKIE_SECURE === 'true') return true;
  if (process.env.UI_SESSION_COOKIE_SECURE === 'false') return false;
  return c.req.url.startsWith('https://') || c.req.header('X-Forwarded-Proto') === 'https';
}

export function getUiSessionToken(c: Context, options?: UiSessionAuthOptions): string | undefined {
  return getUiSessionAuth(c, options).token;
}

export function getUiSessionAuth(c: Context, options: UiSessionAuthOptions = {}): UiSessionAuth {
  if (options.allowHeader) {
    const headerToken = c.req.header('X-Session-Token');
    if (headerToken) {
      return { token: headerToken, source: 'header' };
    }
  }

  const cookieToken = getCookie(c, UI_SESSION_COOKIE);
  if (cookieToken) {
    return { token: cookieToken, source: 'cookie' };
  }

  return { source: 'none' };
}

export function setUiSessionCookie(c: Context, token: string, expiresAt: Date): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  setCookie(c, UI_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureCookie(c),
    path: '/',
    expires: expiresAt,
    maxAge,
  });
}

export function clearUiSessionCookie(c: Context): void {
  deleteCookie(c, UI_SESSION_COOKIE, {
    sameSite: 'Lax',
    secure: isSecureCookie(c),
    path: '/',
  });
}
