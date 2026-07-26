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

// Production safeFetch uses undici.fetch so its pinned Agent and fetch share
// the same dispatcher ABI. Route/tool tests historically stub global fetch;
// bridge undici.fetch to that stub while retaining the real Agent class.
vi.mock('undici', async (importOriginal) => {
  const original = await importOriginal<typeof import('undici')>();
  return {
    ...original,
    fetch: (input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init),
  };
});

// Pin the at-rest encryption key so any test that touches encrypted columns
// stays hermetic — without this, the first encrypt would auto-generate a
// real key file under the user's data directory.
// (data-encryption.test.ts manages this env var itself for key-resolution tests.)
process.env.OWNPILOT_ENCRYPTION_KEY ??= 'gateway-test-suite-encryption-key';
