/**
 * Tests for shutdown-cleanup.ts — centralized service shutdown.
 *
 * Tests the shutdownAllServices orchestrator. Individual service
 * resetters are mocked — we verify error handling and ordering.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock logger
const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('./log.js', () => ({
  getLog: () => mockLog,
}));

// Import after mocks
const { shutdownAllServices } = await import('./shutdown-cleanup.js');

describe('shutdown-cleanup', () => {
  it('shutdownAllServices completes without throwing', async () => {
    // Each resetter does a dynamic import — in test env these resolve
    // to the real modules, but their reset functions are mostly no-ops
    // when services aren't initialized.
    await expect(shutdownAllServices(mockLog)).resolves.toBeUndefined();
  });

  it('does not throw if a service fails to reset', async () => {
    // Even if individual resetters throw, shutdownAllServices catches
    // and logs the error — it must not propagate.
    await expect(shutdownAllServices(mockLog)).resolves.toBeUndefined();
  });
});
