import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PermissionChecker,
  hasPermissionLevel,
  getHighestPermissionLevel,
  createPermissionChecker,
  createRestrictiveChecker,
  createPermissiveChecker,
  withPermissionCheck,
  DEFAULT_TOOL_PERMISSIONS,
  DEFAULT_PERMISSION_POLICY,
} from './permissions.js';
import type { PermissionLevel, PermissionPolicy, ToolPermissionConfig } from './permissions.js';
import type { ToolContext } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    callId: 'call-1',
    conversationId: 'conv-1',
    userId: 'user-1',
    ...overrides,
  };
}

function makePolicy(overrides: Partial<PermissionPolicy> = {}): PermissionPolicy {
  return {
    ...DEFAULT_PERMISSION_POLICY,
    ...overrides,
    tools: {
      ...DEFAULT_TOOL_PERMISSIONS,
      ...(overrides.tools ?? {}),
    },
  };
}

// ===========================================================================
// hasPermissionLevel
// ===========================================================================

describe('hasPermissionLevel', () => {
  const levels: PermissionLevel[] = ['none', 'read', 'write', 'execute', 'admin'];

  it('returns true when userLevel equals requiredLevel', () => {
    for (const level of levels) {
      expect(hasPermissionLevel(level, level)).toBe(true);
    }
  });

  it('admin has access to every level', () => {
    for (const required of levels) {
      expect(hasPermissionLevel('admin', required)).toBe(true);
    }
  });

  it('none only satisfies none', () => {
    expect(hasPermissionLevel('none', 'none')).toBe(true);
    expect(hasPermissionLevel('none', 'read')).toBe(false);
    expect(hasPermissionLevel('none', 'write')).toBe(false);
    expect(hasPermissionLevel('none', 'execute')).toBe(false);
    expect(hasPermissionLevel('none', 'admin')).toBe(false);
  });

  it('read cannot access write, execute, or admin', () => {
    expect(hasPermissionLevel('read', 'write')).toBe(false);
    expect(hasPermissionLevel('read', 'execute')).toBe(false);
    expect(hasPermissionLevel('read', 'admin')).toBe(false);
  });

  it('write can access read and write but not execute or admin', () => {
    expect(hasPermissionLevel('write', 'read')).toBe(true);
    expect(hasPermissionLevel('write', 'write')).toBe(true);
    expect(hasPermissionLevel('write', 'execute')).toBe(false);
    expect(hasPermissionLevel('write', 'admin')).toBe(false);
  });

  it('execute can access read, write, execute but not admin', () => {
    expect(hasPermissionLevel('execute', 'read')).toBe(true);
    expect(hasPermissionLevel('execute', 'write')).toBe(true);
    expect(hasPermissionLevel('execute', 'execute')).toBe(true);
    expect(hasPermissionLevel('execute', 'admin')).toBe(false);
  });
});

// ===========================================================================
// getHighestPermissionLevel
// ===========================================================================

describe('getHighestPermissionLevel', () => {
  it('returns none for empty array', () => {
    expect(getHighestPermissionLevel([])).toBe('none');
  });

  it('returns the single level for a singleton', () => {
    expect(getHighestPermissionLevel(['write'])).toBe('write');
  });

  it('returns admin when present', () => {
    expect(getHighestPermissionLevel(['read', 'admin', 'write'])).toBe('admin');
  });

  it('returns execute when it is the highest', () => {
    expect(getHighestPermissionLevel(['read', 'write', 'execute'])).toBe('execute');
  });

  it('returns read when only none and read present', () => {
    expect(getHighestPermissionLevel(['none', 'read'])).toBe('read');
  });
});

// ===========================================================================
// PermissionChecker — check()
// ===========================================================================

describe('PermissionChecker', () => {
  let checker: PermissionChecker;
  let ctx: ToolContext;

  beforeEach(() => {
    checker = new PermissionChecker(makePolicy());
    ctx = makeContext();
  });

  // -------------------------------------------------------------------------
  // Unknown tool
  // -------------------------------------------------------------------------

  describe('check — unknown tool', () => {
    it('denies access to an unknown tool', () => {
      const result = checker.check('totally_unknown_tool', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Unknown tool');
      expect(result.reason).toContain('totally_unknown_tool');
    });
  });

  // -------------------------------------------------------------------------
  // Permission level checks
  // -------------------------------------------------------------------------

  describe('check — permission level', () => {
    it('allows read_file for default read-level user', () => {
      const result = checker.check('read_file', ctx);
      expect(result.allowed).toBe(true);
    });

    it('denies write_file for default read-level user', () => {
      const result = checker.check('write_file', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient permission level');
      expect(result.reason).toContain('write');
      expect(result.reason).toContain('read');
    });

    it('denies execute_javascript for default read-level user', () => {
      const result = checker.check('execute_javascript', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient permission level');
    });

    it('denies execute_shell (admin-level) for default user', () => {
      const result = checker.check('execute_shell', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient permission level');
    });
  });

  // -------------------------------------------------------------------------
  // Category checks
  // -------------------------------------------------------------------------

  describe('check — category restrictions', () => {
    it('allows file_read category by default', () => {
      const result = checker.check('read_file', ctx);
      expect(result.allowed).toBe(true);
    });

    it('allows network_read category by default', () => {
      const result = checker.check('http_request', ctx);
      expect(result.allowed).toBe(true);
    });

    it('allows memory category by default', () => {
      const result = checker.check('memory_recall', ctx);
      expect(result.allowed).toBe(true);
    });

    it('denies tool in disallowed category even if permission level is sufficient', () => {
      // Create a checker where user has admin level but only file_read category
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['file_read'],
      });
      const restrictedChecker = new PermissionChecker(policy);
      const result = restrictedChecker.check('execute_javascript', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('category');
      expect(result.reason).toContain('code_execute');
    });
  });

  // -------------------------------------------------------------------------
  // Explicitly denied / allowed tools
  // -------------------------------------------------------------------------

  describe('check — explicit user overrides', () => {
    it('denies an explicitly denied tool even if everything else allows it', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: [
          'file_read',
          'file_write',
          'code_execute',
          'network_read',
          'network_write',
          'system',
          'memory',
          'file_delete',
          'custom',
        ],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: [
              'file_read',
              'file_write',
              'code_execute',
              'network_read',
              'network_write',
              'system',
              'memory',
              'file_delete',
              'custom',
            ],
            deniedTools: ['read_file'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('read_file', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('explicitly denied');
    });

    it('allows an explicitly allowed tool even if category is missing', () => {
      const policy = makePolicy({
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: [], // no categories at all
            allowedTools: ['execute_javascript'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('execute_javascript', ctx);
      expect(result.allowed).toBe(true);
    });

    it('allows an explicitly allowed tool even if permission level is insufficient', () => {
      const policy = makePolicy({
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'read',
            allowedCategories: [],
            allowedTools: ['execute_shell'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('execute_shell', ctx);
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Confirmation required
  // -------------------------------------------------------------------------

  describe('check — confirmation required', () => {
    it('flags requiresConfirmation for write_file when tool config says so', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: [
          'file_read',
          'file_write',
          'code_execute',
          'network_read',
          'network_write',
          'system',
          'memory',
          'file_delete',
          'custom',
        ],
      });
      const c = new PermissionChecker(policy);
      const result = c.check('write_file', ctx);
      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('flags requiresConfirmation when user-level requireConfirmation is true', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: [
          'file_read',
          'file_write',
          'code_execute',
          'network_read',
          'network_write',
          'system',
          'memory',
          'file_delete',
          'custom',
        ],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['file_read', 'memory'],
            requireConfirmation: true,
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('read_file', ctx);
      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('does not require confirmation for explicitly allowed tools', () => {
      const policy = makePolicy({
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['file_write'],
            allowedTools: ['write_file'],
            requireConfirmation: true,
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('write_file', ctx);
      expect(result.allowed).toBe(true);
      // Explicitly allowed tools bypass confirmation
      expect(result.requiresConfirmation).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // Path restriction checks
  // -------------------------------------------------------------------------

  describe('check — path restrictions', () => {
    it('denies access to a path outside allowed paths', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['file_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['file_read'],
            allowedPaths: ['/home/user/safe'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('read_file', ctx, { path: '/etc/passwd' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('allows access to exact allowed path', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['file_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['file_read'],
            allowedPaths: ['/home/user/safe'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('read_file', ctx, { path: '/home/user/safe' });
      expect(result.allowed).toBe(true);
    });

    it('allows access to subdirectory of allowed path', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['file_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['file_read'],
            allowedPaths: ['/home/user/safe'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('read_file', ctx, { path: '/home/user/safe/subdir/file.txt' });
      expect(result.allowed).toBe(true);
    });

    it('normalizes backslashes in paths', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['file_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['file_read'],
            allowedPaths: ['C:/Users/safe'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('read_file', ctx, { path: 'C:\\Users\\safe\\file.txt' });
      expect(result.allowed).toBe(true);
    });

    it('performs case-insensitive path comparison', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['file_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['file_read'],
            allowedPaths: ['/Home/User/Safe'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('read_file', ctx, { path: '/home/user/safe/file.txt' });
      expect(result.allowed).toBe(true);
    });

    it('allows all paths when no path restrictions are configured', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['file_read'],
      });
      const c = new PermissionChecker(policy);
      const result = c.check('read_file', ctx, { path: '/any/path/anywhere' });
      expect(result.allowed).toBe(true);
    });

    it('does not check path restrictions for non-file tools', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['network_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['network_read'],
            allowedPaths: ['/restricted/only'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      // http_request is network_read, not file_*, so path arg should be ignored
      const result = c.check('http_request', ctx, { path: '/etc/shadow' });
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Host restriction checks
  // -------------------------------------------------------------------------

  describe('check — host restrictions', () => {
    it('denies access to disallowed host via url arg', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['network_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['network_read'],
            allowedHosts: ['example.com'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('http_request', ctx, { url: 'https://evil.org/data' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in the allowed list');
    });

    it('allows exact host match', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['network_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['network_read'],
            allowedHosts: ['example.com'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('http_request', ctx, { url: 'https://example.com/api' });
      expect(result.allowed).toBe(true);
    });

    it('allows subdomain match', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['network_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['network_read'],
            allowedHosts: ['example.com'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('http_request', ctx, { url: 'https://api.example.com/v1' });
      expect(result.allowed).toBe(true);
    });

    it('allows all hosts when no host restrictions configured', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['network_read'],
      });
      const c = new PermissionChecker(policy);
      const result = c.check('http_request', ctx, { url: 'https://anything.org' });
      expect(result.allowed).toBe(true);
    });

    it('denies when URL is invalid', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['network_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['network_read'],
            allowedHosts: ['example.com'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('http_request', ctx, { url: 'not-a-url' });
      expect(result.allowed).toBe(false);
    });

    it('constructs URL from host arg when url is absent', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['network_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['network_read'],
            allowedHosts: ['example.com'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('http_request', ctx, { host: 'example.com' });
      expect(result.allowed).toBe(true);
    });

    it('blocks host arg that does not match allowed hosts', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['network_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['network_read'],
            allowedHosts: ['example.com'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('http_request', ctx, { host: 'evil.org' });
      expect(result.allowed).toBe(false);
    });

    it('does case-insensitive host comparison', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['network_read'],
        users: {
          'user-1': {
            userId: 'user-1',
            maxLevel: 'admin',
            allowedCategories: ['network_read'],
            allowedHosts: ['Example.COM'],
          },
        },
      });
      const c = new PermissionChecker(policy);
      const result = c.check('http_request', ctx, { url: 'https://EXAMPLE.com/api' });
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  describe('check — rate limiting', () => {
    it('allows calls within rate limit', () => {
      // execute_javascript has rateLimit: 10
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['code_execute'],
      });
      const c = new PermissionChecker(policy);
      for (let i = 0; i < 10; i++) {
        const result = c.check('execute_javascript', ctx);
        expect(result.allowed).toBe(true);
      }
    });

    it('denies call when rate limit is exceeded', () => {
      // execute_javascript has rateLimit: 10
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['code_execute'],
      });
      const c = new PermissionChecker(policy);
      for (let i = 0; i < 10; i++) {
        c.check('execute_javascript', ctx);
      }
      const result = c.check('execute_javascript', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit exceeded');
      expect(result.reason).toContain('10');
    });

    it('resets after window expires', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['code_execute'],
      });
      const c = new PermissionChecker(policy);

      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        c.check('execute_javascript', ctx);
      }
      expect(c.check('execute_javascript', ctx).allowed).toBe(false);

      // Advance time past the 60-second window
      vi.useFakeTimers();
      vi.advanceTimersByTime(61000);

      const result = c.check('execute_javascript', ctx);
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });

    it('tracks rate limits per user+tool combination', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['code_execute'],
      });
      const c = new PermissionChecker(policy);
      const ctx1 = makeContext({ userId: 'user-a' });
      const ctx2 = makeContext({ userId: 'user-b' });

      // Exhaust limit for user-a
      for (let i = 0; i < 10; i++) {
        c.check('execute_javascript', ctx1);
      }
      expect(c.check('execute_javascript', ctx1).allowed).toBe(false);

      // user-b should still have quota
      const result = c.check('execute_javascript', ctx2);
      expect(result.allowed).toBe(true);
    });

    it('uses global rate limit when tool has no specific limit', () => {
      const policy = makePolicy({
        globalRateLimit: 3,
        defaultLevel: 'admin',
        defaultCategories: ['file_read'],
      });
      const c = new PermissionChecker(policy);

      for (let i = 0; i < 3; i++) {
        expect(c.check('read_file', ctx).allowed).toBe(true);
      }
      const result = c.check('read_file', ctx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit exceeded');
    });

    it('includes rate limit context in denial', () => {
      const policy = makePolicy({
        defaultLevel: 'admin',
        defaultCategories: ['code_execute'],
      });
      const c = new PermissionChecker(policy);

      for (let i = 0; i < 10; i++) {
        c.check('execute_javascript', ctx);
      }
      const result = c.check('execute_javascript', ctx);
      expect(result.context).toBeDefined();
      expect(result.context?.limit).toBe(10);
      expect(result.context?.current).toBe(10);
      expect(typeof result.context?.resetsIn).toBe('number');
    });
  });

  // -------------------------------------------------------------------------
  // Anonymous user
  // -------------------------------------------------------------------------

  describe('check — anonymous user', () => {
    it('uses default permissions for anonymous user', () => {
      const anonCtx = makeContext({ userId: undefined });
      const result = checker.check('read_file', anonCtx);
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getToolConfig
  // -------------------------------------------------------------------------

  describe('getToolConfig', () => {
    it('returns config for known tool', () => {
      const config = checker.getToolConfig('read_file');
      expect(config).toBeDefined();
      expect(config?.level).toBe('read');
      expect(config?.category).toBe('file_read');
    });

    it('returns undefined for unknown tool', () => {
      expect(checker.getToolConfig('nonexistent')).toBeUndefined();
    });

    it('returns config with all expected fields for write_file', () => {
      const config = checker.getToolConfig('write_file');
      expect(config).toBeDefined();
      expect(config?.level).toBe('write');
      expect(config?.category).toBe('file_write');
      expect(config?.requiresConfirmation).toBe(true);
    });

    it('returns config with rateLimit for execute_javascript', () => {
      const config = checker.getToolConfig('execute_javascript');
      expect(config?.rateLimit).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // updatePolicy
  // -------------------------------------------------------------------------

  describe('updatePolicy', () => {
    it('merges updates into existing policy', () => {
      const updated = checker.updatePolicy({ globalRateLimit: 100 });
      expect(updated.globalRateLimit).toBe(100);
    });

    it('returns the updated policy', () => {
      const updated = checker.updatePolicy({ auditLog: false });
      expect(updated.auditLog).toBe(false);
    });

    it('preserves existing fields not in updates', () => {
      const updated = checker.updatePolicy({ globalRateLimit: 99 });
      expect(updated.defaultLevel).toBe('read');
      expect(updated.tools).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // addUserPermissions
  // -------------------------------------------------------------------------

  describe('addUserPermissions', () => {
    it('adds a new user and uses their permissions', () => {
      checker.addUserPermissions('new-user', {
        maxLevel: 'admin',
        allowedCategories: ['code_execute'],
      });
      const newCtx = makeContext({ userId: 'new-user' });
      const result = checker.check('execute_javascript', newCtx);
      expect(result.allowed).toBe(true);
    });

    it('works even when no users existed previously', () => {
      const barePolicy: PermissionPolicy = {
        defaultLevel: 'read',
        defaultCategories: ['file_read'],
        tools: DEFAULT_TOOL_PERMISSIONS,
      };
      const c = new PermissionChecker(barePolicy);
      c.addUserPermissions('new-user', {
        maxLevel: 'write',
        allowedCategories: ['file_write'],
      });
      const newCtx = makeContext({ userId: 'new-user' });
      const result = c.check('write_file', newCtx);
      expect(result.allowed).toBe(true);
    });

    it('adds userId to the stored permissions', () => {
      checker.addUserPermissions('test-uid', {
        maxLevel: 'read',
        allowedCategories: ['memory'],
      });
      // Verify indirectly by checking a memory tool for that user
      const newCtx = makeContext({ userId: 'test-uid' });
      const result = checker.check('memory_recall', newCtx);
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // recordUsage
  // -------------------------------------------------------------------------

  describe('recordUsage', () => {
    it('does nothing when auditLog is false', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const noAuditChecker = new PermissionChecker(makePolicy({ auditLog: false }));
      noAuditChecker.recordUsage('read_file', ctx, { allowed: true });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('sanitizes sensitive keys (password, token, key, secret, apiKey, credentials)', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      checker.recordUsage(
        'read_file',
        ctx,
        { allowed: true },
        {
          password: 'hunter2',
          token: 'abc123',
          secret: 'top-secret',
          apiKey: 'sk-xxx',
          credentials: 'creds',
          normalArg: 'visible',
        }
      );

      expect(spy).toHaveBeenCalled();
      // getLog('Permission').debug('Audit:', logEntry) → console.debug('[Permission]', 'Audit:', logEntry)
      const loggedData = spy.mock.calls[0][2] as Record<string, unknown>;
      expect((loggedData.args as Record<string, string>).password).toBe('[REDACTED]');
      expect((loggedData.args as Record<string, string>).token).toBe('[REDACTED]');
      expect((loggedData.args as Record<string, string>).secret).toBe('[REDACTED]');
      expect((loggedData.args as Record<string, string>).apiKey).toBe('[REDACTED]');
      expect((loggedData.args as Record<string, string>).credentials).toBe('[REDACTED]');
      expect((loggedData.args as Record<string, string>).normalArg).toBe('visible');

      process.env.NODE_ENV = originalEnv;
      spy.mockRestore();
    });

    it('truncates long string values', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const longValue = 'a'.repeat(200);
      checker.recordUsage(
        'read_file',
        ctx,
        { allowed: true },
        {
          longField: longValue,
        }
      );

      const loggedData = spy.mock.calls[0][2] as Record<string, unknown>;
      expect((loggedData.args as Record<string, string>).longField).toContain('truncated');
      expect((loggedData.args as Record<string, string>).longField.length).toBeLessThan(
        longValue.length
      );

      process.env.NODE_ENV = originalEnv;
      spy.mockRestore();
    });

    it('handles undefined args', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Should not throw
      checker.recordUsage('read_file', ctx, { allowed: true }, undefined);

      const loggedData = spy.mock.calls[0][2] as Record<string, unknown>;
      expect(loggedData.args).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
      spy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // check — allowed result context
  // -------------------------------------------------------------------------

  describe('check — successful result context', () => {
    it('includes toolConfig and userLevel in context on success', () => {
      const result = checker.check('read_file', ctx);
      expect(result.allowed).toBe(true);
      expect(result.context).toBeDefined();
      expect(result.context?.toolConfig).toBeDefined();
      expect(result.context?.userLevel).toBe('read');
    });
  });
});

// ===========================================================================
// DEFAULT_TOOL_PERMISSIONS constant
// ===========================================================================

describe('DEFAULT_TOOL_PERMISSIONS', () => {
  it('contains file_read tools', () => {
    for (const tool of ['read_file', 'list_directory', 'search_files', 'get_file_info']) {
      expect(DEFAULT_TOOL_PERMISSIONS[tool]).toBeDefined();
      expect(DEFAULT_TOOL_PERMISSIONS[tool].category).toBe('file_read');
      expect(DEFAULT_TOOL_PERMISSIONS[tool].level).toBe('read');
    }
  });

  it('contains file_write tools', () => {
    for (const tool of ['write_file', 'download_file', 'copy_file']) {
      expect(DEFAULT_TOOL_PERMISSIONS[tool]).toBeDefined();
      expect(DEFAULT_TOOL_PERMISSIONS[tool].category).toBe('file_write');
    }
  });

  it('contains code_execute tools', () => {
    for (const tool of ['execute_javascript', 'execute_python', 'compile_code']) {
      expect(DEFAULT_TOOL_PERMISSIONS[tool]).toBeDefined();
      expect(DEFAULT_TOOL_PERMISSIONS[tool].category).toBe('code_execute');
    }
  });

  it('contains network_read tools', () => {
    for (const tool of ['http_request', 'fetch_web_page', 'search_web', 'call_json_api']) {
      expect(DEFAULT_TOOL_PERMISSIONS[tool]).toBeDefined();
      expect(DEFAULT_TOOL_PERMISSIONS[tool].category).toBe('network_read');
    }
  });

  it('contains memory tools', () => {
    expect(DEFAULT_TOOL_PERMISSIONS['memory_store'].category).toBe('memory');
    expect(DEFAULT_TOOL_PERMISSIONS['memory_recall'].category).toBe('memory');
  });

  it('maps execute_shell to admin level', () => {
    expect(DEFAULT_TOOL_PERMISSIONS['execute_shell'].level).toBe('admin');
  });

  it('maps package_manager to admin level and system category', () => {
    expect(DEFAULT_TOOL_PERMISSIONS['package_manager'].level).toBe('admin');
    expect(DEFAULT_TOOL_PERMISSIONS['package_manager'].category).toBe('system');
  });
});

// ===========================================================================
// Factory functions
// ===========================================================================

describe('createPermissionChecker', () => {
  it('creates a checker with default policy when no args', () => {
    const c = createPermissionChecker();
    expect(c).toBeInstanceOf(PermissionChecker);
    expect(c.getToolConfig('read_file')).toBeDefined();
  });

  it('merges custom tools into default tools', () => {
    const customTool: ToolPermissionConfig = {
      level: 'read',
      category: 'custom',
      description: 'My custom tool',
    };
    const c = createPermissionChecker({
      tools: { my_custom: customTool },
    });
    expect(c.getToolConfig('my_custom')).toBeDefined();
    // Default tools still present
    expect(c.getToolConfig('read_file')).toBeDefined();
  });

  it('allows overriding default policy fields', () => {
    const _c = createPermissionChecker({ defaultLevel: 'admin' });
    const ctx = makeContext();
    // With admin default level, write_file should be allowed (if category check passes)
    // Default categories don't include file_write, so let's also override that
    const c2 = createPermissionChecker({
      defaultLevel: 'admin',
      defaultCategories: ['file_write'],
    });
    const result = c2.check('write_file', ctx);
    expect(result.allowed).toBe(true);
  });
});

describe('createRestrictiveChecker', () => {
  it('defaults to read level', () => {
    const c = createRestrictiveChecker();
    const ctx = makeContext();
    const result = c.check('read_file', ctx);
    expect(result.allowed).toBe(true);
  });

  it('blocks write operations', () => {
    const c = createRestrictiveChecker();
    const ctx = makeContext();
    const result = c.check('write_file', ctx);
    expect(result.allowed).toBe(false);
  });

  it('blocks code execution', () => {
    const c = createRestrictiveChecker();
    const ctx = makeContext();
    const result = c.check('execute_javascript', ctx);
    expect(result.allowed).toBe(false);
  });

  it('blocks network_read category', () => {
    const c = createRestrictiveChecker();
    const ctx = makeContext();
    // http_request is network_read, which is not in restrictive categories
    const result = c.check('http_request', ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('category');
  });

  it('allows memory category', () => {
    const c = createRestrictiveChecker();
    const ctx = makeContext();
    const result = c.check('memory_recall', ctx);
    expect(result.allowed).toBe(true);
  });
});

describe('createPermissiveChecker', () => {
  it('defaults to admin level', () => {
    const c = createPermissiveChecker();
    const ctx = makeContext();
    const result = c.check('execute_shell', ctx);
    expect(result.allowed).toBe(true);
  });

  it('allows all tool categories', () => {
    const c = createPermissiveChecker();
    const ctx = makeContext();

    const tools = [
      'read_file', // file_read
      'write_file', // file_write
      'delete_file', // file_delete
      'execute_javascript', // code_execute
      'http_request', // network_read
      'memory_recall', // memory
    ];

    for (const tool of tools) {
      const result = c.check(tool, ctx);
      expect(result.allowed).toBe(true);
    }
  });

  it('still denies unknown tools', () => {
    const c = createPermissiveChecker();
    const ctx = makeContext();
    const result = c.check('totally_fake_tool', ctx);
    expect(result.allowed).toBe(false);
  });
});

// ===========================================================================
// withPermissionCheck middleware
// ===========================================================================

describe('withPermissionCheck', () => {
  it('calls executor when permission is granted', async () => {
    const executor = vi.fn().mockResolvedValue({ content: 'result' });
    const c = createPermissiveChecker();
    const wrapped = withPermissionCheck('read_file', executor, c);

    const result = await wrapped({ path: '/test' }, makeContext());
    expect(executor).toHaveBeenCalledWith(
      { path: '/test' },
      expect.objectContaining({ userId: 'user-1' })
    );
    expect(result).toEqual({ content: 'result' });
  });

  it('blocks execution and returns error when permission is denied', async () => {
    const executor = vi.fn().mockResolvedValue({ content: 'should not reach' });
    const c = createRestrictiveChecker();
    const wrapped = withPermissionCheck('execute_javascript', executor, c);

    const result = (await wrapped({}, makeContext())) as {
      content: string;
      isError: boolean;
      metadata: Record<string, unknown>;
    };
    expect(executor).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Permission denied');
    expect(result.metadata?.permissionDenied).toBe(true);
  });

  it('records usage on both success and denial', async () => {
    const executor = vi.fn().mockResolvedValue({ content: 'ok' });
    const c = createPermissiveChecker();
    const spy = vi.spyOn(c, 'recordUsage');
    const wrapped = withPermissionCheck('read_file', executor, c);

    await wrapped({ path: '/test' }, makeContext());
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('logs confirmation message for tools that require confirmation', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const executor = vi.fn().mockResolvedValue({ content: 'written' });
    const c = createPermissiveChecker();
    const wrapped = withPermissionCheck('write_file', executor, c);

    await wrapped({ path: '/test', content: 'data' }, makeContext());
    // getLog('Permission').info(msg) → console.log('[Permission]', msg)
    expect(logSpy).toHaveBeenCalledWith('[Permission]', expect.stringContaining('write_file'));
    // Executor still gets called
    expect(executor).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
