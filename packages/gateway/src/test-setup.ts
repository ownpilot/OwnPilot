/**
 * Global Test Setup — runs before every test file in gateway.
 *
 * Provides the most commonly duplicated mock (getLog) so individual
 * test files no longer need to repeat it.
 *
 * IMPORTANT: Tests that need to ASSERT on log method calls (e.g.,
 * `expect(mockLog.error).toHaveBeenCalledWith(...)`) should declare
 * their own `vi.mock` for the log module — the local mock will
 * override this global one for that file.
 */

import { vi } from 'vitest';

vi.mock('./services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
