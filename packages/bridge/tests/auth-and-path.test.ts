import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';

/**
 * Unit tests for auth and path traversal validation logic.
 * These test the LOGIC extracted from routes.ts — not the HTTP layer.
 */

// ---------- Auth verification logic (extracted from routes.ts) ----------

function verifyBearerTokenLogic(
  authHeader: string | undefined,
  expectedKey: string,
): { valid: boolean; error?: string } {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing Bearer token' };
  }
  const token = authHeader.slice(7).trim();
  if (token !== expectedKey) {
    return { valid: false, error: 'Invalid API key' };
  }
  return { valid: true };
}

describe('verifyBearerToken logic', () => {
  const KEY = 'YOUR_BRIDGE_API_KEY_HERE';

  it('accepts valid Bearer token', () => {
    expect(verifyBearerTokenLogic(`Bearer ${KEY}`, KEY).valid).toBe(true);
  });

  it('rejects missing header', () => {
    const r = verifyBearerTokenLogic(undefined, KEY);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('Missing Bearer token');
  });

  it('rejects non-Bearer scheme', () => {
    const r = verifyBearerTokenLogic('Basic abc123', KEY);
    expect(r.valid).toBe(false);
  });

  it('rejects wrong token', () => {
    const r = verifyBearerTokenLogic('Bearer wrong-key', KEY);
    expect(r.valid).toBe(false);
    expect(r.error).toBe('Invalid API key');
  });

  it('handles extra whitespace in token', () => {
    expect(verifyBearerTokenLogic(`Bearer  ${KEY} `, KEY).valid).toBe(true);
  });
});

// ---------- Path traversal validation logic (extracted from routes.ts) ----------

function validateProjectDir(rawDir: string | undefined, defaultDir: string): {
  allowed: boolean;
  resolvedDir: string;
  reason?: string;
} {
  if (!rawDir) return { allowed: true, resolvedDir: defaultDir };

  const ALLOWED_PREFIXES = ['/home/ayaz/', '/tmp/'];
  const resolved = resolve(rawDir);
  const resolvedNorm = resolved.endsWith('/') ? resolved : resolved + '/';
  const isUnderHome = resolvedNorm.startsWith('/home/ayaz/');
  const firstSegment = resolvedNorm.slice('/home/ayaz/'.length).split('/')[0];
  const isHomeDotDir = isUnderHome && firstSegment.startsWith('.');
  const isAllowed =
    !isHomeDotDir &&
    ALLOWED_PREFIXES.some((prefix) => resolvedNorm.startsWith(prefix));

  return {
    allowed: isAllowed,
    resolvedDir: isAllowed ? resolved : defaultDir,
    reason: isAllowed ? undefined : 'PATH_TRAVERSAL_BLOCKED',
  };
}

describe('path traversal validation', () => {
  const DEFAULT = '/home/ayaz/';

  it('allows /home/ayaz/projects/foo', () => {
    const r = validateProjectDir('/home/ayaz/projects/foo', DEFAULT);
    expect(r.allowed).toBe(true);
  });

  it('allows /tmp/bridge-sessions/abc', () => {
    const r = validateProjectDir('/tmp/bridge-sessions/abc', DEFAULT);
    expect(r.allowed).toBe(true);
  });

  it('blocks /etc traversal', () => {
    const r = validateProjectDir('/../../../etc', DEFAULT);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('PATH_TRAVERSAL_BLOCKED');
  });

  it('blocks /home/ayaz/.ssh (dotfile)', () => {
    const r = validateProjectDir('/home/ayaz/.ssh', DEFAULT);
    expect(r.allowed).toBe(false);
  });

  it('blocks /home/ayaz/.gnupg (dotfile)', () => {
    const r = validateProjectDir('/home/ayaz/.gnupg', DEFAULT);
    expect(r.allowed).toBe(false);
  });

  it('blocks /root', () => {
    const r = validateProjectDir('/root', DEFAULT);
    expect(r.allowed).toBe(false);
  });

  it('allows /home/ayaz/ exactly (trailing slash trick)', () => {
    const r = validateProjectDir('/home/ayaz/', DEFAULT);
    expect(r.allowed).toBe(true);
  });

  it('allows /home/ayaz without trailing slash', () => {
    const r = validateProjectDir('/home/ayaz', DEFAULT);
    expect(r.allowed).toBe(true);
  });

  it('returns default when rawDir is undefined', () => {
    const r = validateProjectDir(undefined, DEFAULT);
    expect(r.allowed).toBe(true);
    expect(r.resolvedDir).toBe(DEFAULT);
  });
});

// ---------- ConversationId sanitization (FIX 2 — audit security) ----------

/**
 * Sanitize conversationId to prevent path injection.
 * Only allows alphanumeric, dash, and underscore characters.
 * This is the same logic that should be in routes.ts.
 */
function sanitizeConversationId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '');
}

describe('conversationId sanitization', () => {
  it('passes through normal UUID', () => {
    expect(sanitizeConversationId('abc-123-def-456')).toBe('abc-123-def-456');
  });

  it('passes through UUID with underscores', () => {
    expect(sanitizeConversationId('conv_test_123')).toBe('conv_test_123');
  });

  it('strips path traversal characters', () => {
    expect(sanitizeConversationId('../../etc/evil')).toBe('etcevil');
  });

  it('strips dots from path traversal attempts', () => {
    const sanitized = sanitizeConversationId('../../../etc/cron.d/evil');
    expect(sanitized).not.toContain('..');
    expect(sanitized).not.toContain('/');
  });

  it('strips spaces and special characters', () => {
    expect(sanitizeConversationId('hello world!@#$%')).toBe('helloworld');
  });

  it('handles empty string', () => {
    expect(sanitizeConversationId('')).toBe('');
  });

  it('preserves interactive- prefix', () => {
    expect(sanitizeConversationId('interactive-1709283746')).toBe('interactive-1709283746');
  });
});

// ---------- PUT config project_dir validation logic (extracted from routes.ts) ----------

/**
 * Validates that the X-Project-Dir header matches the session's projectDir.
 * Returns whether the request should proceed or be rejected.
 */
function validateConfigProjectDir(
  requestProjectDir: string | null,
  sessionProjectDir: string,
): { allowed: boolean; error?: string } {
  if (!requestProjectDir) {
    // No header — pass through
    return { allowed: true };
  }
  if (requestProjectDir !== sessionProjectDir) {
    return {
      allowed: false,
      error: `Session belongs to project ${sessionProjectDir}, not ${requestProjectDir}`,
    };
  }
  return { allowed: true };
}

describe('PUT config project_dir validation', () => {
  it('validates project_dir match for PUT config', () => {
    const r = validateConfigProjectDir('/home/ayaz/project-b', '/home/ayaz/project-a');
    expect(r.allowed).toBe(false);
    expect(r.error).toContain('project-a');
    expect(r.error).toContain('project-b');
  });

  it('allows PUT config without project_dir header', () => {
    const r = validateConfigProjectDir(null, '/home/ayaz/project-a');
    expect(r.allowed).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('allows PUT config when project_dir matches', () => {
    const r = validateConfigProjectDir('/home/ayaz/project-a', '/home/ayaz/project-a');
    expect(r.allowed).toBe(true);
    expect(r.error).toBeUndefined();
  });
});
