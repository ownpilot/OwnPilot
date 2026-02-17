/**
 * Execution Permissions Routes Tests
 *
 * Integration tests for the execution-permissions API endpoints.
 * Mocks executionPermissionsRepo, resolveApproval, and helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRepo = {
  get: vi.fn(),
  set: vi.fn(),
  reset: vi.fn(),
};

vi.mock('../db/repositories/execution-permissions.js', () => ({
  executionPermissionsRepo: mockRepo,
}));

const mockResolveApproval = vi.fn();

vi.mock('../services/execution-approval.js', () => ({
  resolveApproval: mockResolveApproval,
}));

vi.mock('./helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./helpers.js')>();
  return {
    ...actual,
    getUserId: vi.fn(() => 'test-user'),
  };
});

// Import after mocks
const { executionPermissionsRoutes } = await import('./execution-permissions.js');

// ---------------------------------------------------------------------------
// Default permission objects
// ---------------------------------------------------------------------------

const DEFAULT_PERMISSIONS = {
  enabled: false,
  mode: 'local',
  execute_javascript: 'blocked',
  execute_python: 'blocked',
  execute_shell: 'blocked',
  compile_code: 'blocked',
  package_manager: 'blocked',
};

const ENABLED_PERMISSIONS = {
  enabled: true,
  mode: 'local',
  execute_javascript: 'allowed',
  execute_python: 'prompt',
  execute_shell: 'blocked',
  compile_code: 'blocked',
  package_manager: 'blocked',
};

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/exec', executionPermissionsRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Execution Permissions Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================================================
  // GET /exec
  // ========================================================================

  describe('GET /exec', () => {
    it('returns permissions on success', async () => {
      mockRepo.get.mockResolvedValue({ ...ENABLED_PERMISSIONS });

      const res = await app.request('/exec');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.enabled).toBe(true);
      expect(json.data.mode).toBe('local');
      expect(json.data.execute_javascript).toBe('allowed');
      expect(json.data.execute_python).toBe('prompt');
      expect(json.data.execute_shell).toBe('blocked');
      expect(mockRepo.get).toHaveBeenCalledWith('test-user');
    });

    it('returns default object when repo returns defaults', async () => {
      mockRepo.get.mockResolvedValue({ ...DEFAULT_PERMISSIONS });

      const res = await app.request('/exec');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.enabled).toBe(false);
      expect(json.data.mode).toBe('local');
      expect(json.data.execute_javascript).toBe('blocked');
      expect(json.data.execute_python).toBe('blocked');
      expect(json.data.execute_shell).toBe('blocked');
      expect(json.data.compile_code).toBe('blocked');
      expect(json.data.package_manager).toBe('blocked');
    });
  });

  // ========================================================================
  // PUT /exec
  // ========================================================================

  describe('PUT /exec', () => {
    it('updates enabled flag', async () => {
      const updated = { ...DEFAULT_PERMISSIONS, enabled: true };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.enabled).toBe(true);
      expect(mockRepo.set).toHaveBeenCalledWith('test-user', { enabled: true });
    });

    it('updates mode to local', async () => {
      const updated = { ...DEFAULT_PERMISSIONS, mode: 'local' };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'local' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.mode).toBe('local');
      expect(mockRepo.set).toHaveBeenCalledWith('test-user', { mode: 'local' });
    });

    it('updates mode to docker', async () => {
      const updated = { ...DEFAULT_PERMISSIONS, mode: 'docker' };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'docker' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.mode).toBe('docker');
      expect(mockRepo.set).toHaveBeenCalledWith('test-user', { mode: 'docker' });
    });

    it('updates mode to auto', async () => {
      const updated = { ...DEFAULT_PERMISSIONS, mode: 'auto' };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'auto' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.mode).toBe('auto');
      expect(mockRepo.set).toHaveBeenCalledWith('test-user', { mode: 'auto' });
    });

    it('updates execute_javascript category permission', async () => {
      const updated = { ...DEFAULT_PERMISSIONS, execute_javascript: 'allowed' };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute_javascript: 'allowed' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.execute_javascript).toBe('allowed');
      expect(mockRepo.set).toHaveBeenCalledWith('test-user', { execute_javascript: 'allowed' });
    });

    it('updates execute_python category permission', async () => {
      const updated = { ...DEFAULT_PERMISSIONS, execute_python: 'prompt' };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute_python: 'prompt' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.execute_python).toBe('prompt');
      expect(mockRepo.set).toHaveBeenCalledWith('test-user', { execute_python: 'prompt' });
    });

    it('updates execute_shell category permission', async () => {
      const updated = { ...DEFAULT_PERMISSIONS, execute_shell: 'blocked' };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute_shell: 'blocked' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.execute_shell).toBe('blocked');
      expect(mockRepo.set).toHaveBeenCalledWith('test-user', { execute_shell: 'blocked' });
    });

    it('updates compile_code category permission', async () => {
      const updated = { ...DEFAULT_PERMISSIONS, compile_code: 'allowed' };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compile_code: 'allowed' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.compile_code).toBe('allowed');
      expect(mockRepo.set).toHaveBeenCalledWith('test-user', { compile_code: 'allowed' });
    });

    it('updates package_manager category permission', async () => {
      const updated = { ...DEFAULT_PERMISSIONS, package_manager: 'prompt' };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package_manager: 'prompt' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.package_manager).toBe('prompt');
      expect(mockRepo.set).toHaveBeenCalledWith('test-user', { package_manager: 'prompt' });
    });

    it('updates multiple fields at once', async () => {
      const updated = {
        ...DEFAULT_PERMISSIONS,
        enabled: true,
        mode: 'docker',
        execute_javascript: 'allowed',
        execute_python: 'prompt',
      };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          mode: 'docker',
          execute_javascript: 'allowed',
          execute_python: 'prompt',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.enabled).toBe(true);
      expect(json.data.mode).toBe('docker');
      expect(json.data.execute_javascript).toBe('allowed');
      expect(json.data.execute_python).toBe('prompt');

      const setCall = mockRepo.set.mock.calls[0];
      expect(setCall[0]).toBe('test-user');
      expect(setCall[1]).toMatchObject({
        enabled: true,
        mode: 'docker',
        execute_javascript: 'allowed',
        execute_python: 'prompt',
      });
    });

    it('rejects invalid mode value with 400', async () => {
      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'sandbox' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('No valid permission changes');
      expect(mockRepo.set).not.toHaveBeenCalled();
    });

    it('rejects empty body with 400', async () => {
      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('No valid permission changes');
      expect(mockRepo.set).not.toHaveBeenCalled();
    });

    it('ignores unknown category names', async () => {
      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute_rust: 'allowed', run_code: 'prompt' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('No valid permission changes');
      expect(mockRepo.set).not.toHaveBeenCalled();
    });

    it('ignores invalid permission mode values for categories', async () => {
      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute_javascript: 'yolo' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('No valid permission changes');
      expect(mockRepo.set).not.toHaveBeenCalled();
    });

    it('ignores non-boolean enabled value', async () => {
      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 'yes' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(mockRepo.set).not.toHaveBeenCalled();
    });

    it('ignores non-string mode value', async () => {
      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 123 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(mockRepo.set).not.toHaveBeenCalled();
    });

    it('accepts valid fields alongside invalid ones', async () => {
      const updated = { ...DEFAULT_PERMISSIONS, enabled: true };
      mockRepo.set.mockResolvedValue(updated);

      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          mode: 'sandbox',          // invalid mode, silently ignored
          execute_rust: 'allowed',   // unknown category, ignored
          execute_javascript: 'yolo', // invalid perm mode, ignored
        }),
      });

      // enabled: true is valid, so the request succeeds
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockRepo.set).toHaveBeenCalledWith('test-user', { enabled: true });
    });

    it('ignores non-string category values', async () => {
      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute_javascript: 42 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(mockRepo.set).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // POST /exec/reset
  // ========================================================================

  describe('POST /exec/reset', () => {
    it('resets permissions to defaults', async () => {
      mockRepo.reset.mockResolvedValue(undefined);

      const res = await app.request('/exec/reset', { method: 'POST' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.reset).toBe(true);
      expect(mockRepo.reset).toHaveBeenCalledWith('test-user');
    });
  });

  // ========================================================================
  // POST /exec/approvals/:id/resolve
  // ========================================================================

  describe('POST /exec/approvals/:id/resolve', () => {
    it('resolves approval when found (approved)', async () => {
      mockResolveApproval.mockReturnValue(true);

      const res = await app.request('/exec/approvals/approval-123/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.resolved).toBe(true);
      expect(json.data.approved).toBe(true);
      expect(mockResolveApproval).toHaveBeenCalledWith('approval-123', true);
    });

    it('resolves approval when found (rejected)', async () => {
      mockResolveApproval.mockReturnValue(true);

      const res = await app.request('/exec/approvals/approval-456/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: false }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.resolved).toBe(true);
      expect(json.data.approved).toBe(false);
      expect(mockResolveApproval).toHaveBeenCalledWith('approval-456', false);
    });

    it('returns 404 when approval not found', async () => {
      mockResolveApproval.mockReturnValue(false);

      const res = await app.request('/exec/approvals/nonexistent/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('NOT_FOUND');
      expect(json.error.message).toContain('not found');
    });

    it('returns 400 when approved is not a boolean', async () => {
      const res = await app.request('/exec/approvals/approval-789/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: 'yes' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('approved field must be a boolean');
      expect(mockResolveApproval).not.toHaveBeenCalled();
    });

    it('returns 400 when approved field is missing', async () => {
      const res = await app.request('/exec/approvals/approval-789/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('approved field must be a boolean');
      expect(mockResolveApproval).not.toHaveBeenCalled();
    });

    it('returns 400 when approved is a number', async () => {
      const res = await app.request('/exec/approvals/approval-789/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: 1 }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(mockResolveApproval).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // GET /exec/test
  // ========================================================================

  describe('GET /exec/test', () => {
    it('returns diagnostic info with all fields', async () => {
      mockRepo.get.mockResolvedValue({ ...ENABLED_PERMISSIONS });

      const res = await app.request('/exec/test');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.userId).toBe('test-user');
      expect(json.data.permissions).toBeDefined();
      expect(json.data.executionMode).toBe('local');
      expect(json.data.masterSwitch).toBe(true);
      expect(json.data.categoryResults).toBeDefined();
      expect(json.data.diagnosis).toBeDefined();
      expect(mockRepo.get).toHaveBeenCalledWith('test-user');
    });

    it('shows "Master switch is OFF" when disabled', async () => {
      mockRepo.get.mockResolvedValue({ ...DEFAULT_PERMISSIONS });

      const res = await app.request('/exec/test');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.masterSwitch).toBe(false);

      // All categories should report master switch OFF
      for (const cat of ['execute_javascript', 'execute_python', 'execute_shell', 'compile_code', 'package_manager']) {
        expect(json.data.categoryResults[cat].wouldAllow).toBe(false);
        expect(json.data.categoryResults[cat].reason).toContain('Master switch is OFF');
      }

      // Diagnosis should mention master switch
      expect(json.data.diagnosis).toContain('Master switch is OFF');
    });

    it('shows "Would show approval dialog" for prompt mode categories', async () => {
      mockRepo.get.mockResolvedValue({
        enabled: true,
        mode: 'local',
        execute_javascript: 'prompt',
        execute_python: 'prompt',
        execute_shell: 'blocked',
        compile_code: 'blocked',
        package_manager: 'blocked',
      });

      const res = await app.request('/exec/test');

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.categoryResults.execute_javascript.mode).toBe('prompt');
      expect(json.data.categoryResults.execute_javascript.wouldAllow).toBe(false);
      expect(json.data.categoryResults.execute_javascript.reason).toContain('Would show approval dialog');

      expect(json.data.categoryResults.execute_python.mode).toBe('prompt');
      expect(json.data.categoryResults.execute_python.wouldAllow).toBe(false);
      expect(json.data.categoryResults.execute_python.reason).toContain('Would show approval dialog');
    });

    it('shows "execution permitted" for allowed mode categories', async () => {
      mockRepo.get.mockResolvedValue({
        enabled: true,
        mode: 'local',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        execute_shell: 'blocked',
        compile_code: 'blocked',
        package_manager: 'blocked',
      });

      const res = await app.request('/exec/test');

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.categoryResults.execute_javascript.mode).toBe('allowed');
      expect(json.data.categoryResults.execute_javascript.wouldAllow).toBe(true);
      expect(json.data.categoryResults.execute_javascript.reason).toContain('execution permitted');

      expect(json.data.categoryResults.execute_python.mode).toBe('allowed');
      expect(json.data.categoryResults.execute_python.wouldAllow).toBe(true);
      expect(json.data.categoryResults.execute_python.reason).toContain('execution permitted');
    });

    it('shows "blocked" for blocked categories when enabled', async () => {
      mockRepo.get.mockResolvedValue({
        enabled: true,
        mode: 'local',
        execute_javascript: 'blocked',
        execute_python: 'blocked',
        execute_shell: 'blocked',
        compile_code: 'blocked',
        package_manager: 'blocked',
      });

      const res = await app.request('/exec/test');

      expect(res.status).toBe(200);
      const json = await res.json();

      for (const cat of ['execute_javascript', 'execute_python', 'execute_shell', 'compile_code', 'package_manager']) {
        expect(json.data.categoryResults[cat].mode).toBe('blocked');
        expect(json.data.categoryResults[cat].wouldAllow).toBe(false);
        expect(json.data.categoryResults[cat].reason).toContain('blocked');
      }

      // Diagnosis should suggest changing categories from blocked
      expect(json.data.diagnosis).toContain('All categories are "blocked"');
    });

    it('shows correct diagnosis when permissions look correct', async () => {
      mockRepo.get.mockResolvedValue({
        enabled: true,
        mode: 'local',
        execute_javascript: 'allowed',
        execute_python: 'blocked',
        execute_shell: 'blocked',
        compile_code: 'blocked',
        package_manager: 'blocked',
      });

      const res = await app.request('/exec/test');

      expect(res.status).toBe(200);
      const json = await res.json();

      // At least one category is not blocked, so diagnosis should say permissions look correct
      expect(json.data.diagnosis).toContain('Permissions look correct');
    });

    it('returns all five categories in results', async () => {
      mockRepo.get.mockResolvedValue({ ...ENABLED_PERMISSIONS });

      const res = await app.request('/exec/test');

      expect(res.status).toBe(200);
      const json = await res.json();
      const categories = Object.keys(json.data.categoryResults);
      expect(categories).toContain('execute_javascript');
      expect(categories).toContain('execute_python');
      expect(categories).toContain('execute_shell');
      expect(categories).toContain('compile_code');
      expect(categories).toContain('package_manager');
      expect(categories).toHaveLength(5);
    });

    it('includes mixed category results correctly', async () => {
      mockRepo.get.mockResolvedValue({
        enabled: true,
        mode: 'docker',
        execute_javascript: 'allowed',
        execute_python: 'prompt',
        execute_shell: 'blocked',
        compile_code: 'allowed',
        package_manager: 'prompt',
      });

      const res = await app.request('/exec/test');

      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.data.executionMode).toBe('docker');
      expect(json.data.masterSwitch).toBe(true);

      expect(json.data.categoryResults.execute_javascript.wouldAllow).toBe(true);
      expect(json.data.categoryResults.execute_python.wouldAllow).toBe(false);
      expect(json.data.categoryResults.execute_shell.wouldAllow).toBe(false);
      expect(json.data.categoryResults.compile_code.wouldAllow).toBe(true);
      expect(json.data.categoryResults.package_manager.wouldAllow).toBe(false);

      expect(json.data.categoryResults.execute_python.reason).toContain('approval dialog');
      expect(json.data.categoryResults.execute_shell.reason).toContain('blocked');
    });
  });

  // ========================================================================
  // Response envelope structure
  // ========================================================================

  describe('response envelope', () => {
    it('includes meta with requestId and timestamp in success response', async () => {
      mockRepo.get.mockResolvedValue({ ...DEFAULT_PERMISSIONS });

      const res = await app.request('/exec');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.meta).toBeDefined();
      expect(json.meta.requestId).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });

    it('includes meta with requestId and timestamp in error response', async () => {
      const res = await app.request('/exec', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.meta).toBeDefined();
      expect(json.meta.requestId).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });
  });
});
