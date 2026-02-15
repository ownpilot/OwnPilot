/**
 * Execution Approval Service Tests
 *
 * Tests the approval request lifecycle: creation, resolution (approve/reject),
 * timeout behaviour, duplicate resolution, and ID generation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @ownpilot/core — provide a deterministic generateId
// ---------------------------------------------------------------------------

vi.mock('@ownpilot/core', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock_12345678`),
}));

import { generateId } from '@ownpilot/core';
import {
  createApprovalRequest,
  resolveApproval,
  generateApprovalId,
} from './execution-approval.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('execution-approval', () => {
  // -----------------------------------------------------------------------
  // createApprovalRequest
  // -----------------------------------------------------------------------

  describe('createApprovalRequest', () => {
    it('stores a pending approval and returns a promise', () => {
      const promise = createApprovalRequest('test-1');
      expect(promise).toBeInstanceOf(Promise);
    });

    it('resolves to false after the 120s timeout', async () => {
      const promise = createApprovalRequest('timeout-1');

      // Advance time just past the 120 000 ms timeout
      vi.advanceTimersByTime(120_000);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('does not resolve before the timeout elapses', async () => {
      const promise = createApprovalRequest('timeout-2');
      let resolved = false;

      promise.then(() => {
        resolved = true;
      });

      // Advance time to just before the timeout
      vi.advanceTimersByTime(119_999);
      // Flush microtasks so .then() would run if the promise had resolved
      await vi.advanceTimersByTimeAsync(0);

      expect(resolved).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // resolveApproval
  // -----------------------------------------------------------------------

  describe('resolveApproval', () => {
    it('resolves the promise to true when approved', async () => {
      const promise = createApprovalRequest('approve-1');

      const found = resolveApproval('approve-1', true);
      expect(found).toBe(true);

      const result = await promise;
      expect(result).toBe(true);
    });

    it('resolves the promise to false when rejected', async () => {
      const promise = createApprovalRequest('reject-1');

      const found = resolveApproval('reject-1', false);
      expect(found).toBe(true);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('returns false for a non-existent approval ID', () => {
      const found = resolveApproval('does-not-exist', true);
      expect(found).toBe(false);
    });

    it('returns false on a second resolve for the same ID', async () => {
      const promise = createApprovalRequest('double-1');

      const first = resolveApproval('double-1', true);
      expect(first).toBe(true);

      const second = resolveApproval('double-1', true);
      expect(second).toBe(false);

      // Ensure the original promise resolved with the first call's value
      const result = await promise;
      expect(result).toBe(true);
    });

    it('clears the timeout timer when resolved before timeout', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const promise = createApprovalRequest('clear-timer-1');

      resolveApproval('clear-timer-1', true);
      expect(clearTimeoutSpy).toHaveBeenCalled();

      await promise;
      clearTimeoutSpy.mockRestore();
    });

    it('does not auto-reject after timeout if already resolved', async () => {
      const promise = createApprovalRequest('resolved-before-timeout');

      resolveApproval('resolved-before-timeout', true);
      const result = await promise;
      expect(result).toBe(true);

      // Advance past the timeout — should have no effect
      vi.advanceTimersByTime(120_000);

      // The promise already resolved to true, not false
      expect(result).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // generateApprovalId
  // -----------------------------------------------------------------------

  describe('generateApprovalId', () => {
    it('returns a string starting with "approval_"', () => {
      const id = generateApprovalId();
      expect(id).toBeTypeOf('string');
      expect(id.startsWith('approval_')).toBe(true);
    });

    it('delegates to generateId from @ownpilot/core', () => {
      const mockedGenerateId = vi.mocked(generateId);
      mockedGenerateId.mockClear();

      generateApprovalId();
      expect(mockedGenerateId).toHaveBeenCalledWith('approval');
    });
  });

  // -----------------------------------------------------------------------
  // Multiple concurrent approvals
  // -----------------------------------------------------------------------

  describe('concurrent approvals', () => {
    it('manages multiple pending approvals independently', async () => {
      const promise1 = createApprovalRequest('multi-1');
      const promise2 = createApprovalRequest('multi-2');
      const promise3 = createApprovalRequest('multi-3');

      // Resolve the first as approved
      resolveApproval('multi-1', true);
      // Resolve the second as rejected
      resolveApproval('multi-2', false);
      // Let the third time out
      vi.advanceTimersByTime(120_000);

      expect(await promise1).toBe(true);
      expect(await promise2).toBe(false);
      expect(await promise3).toBe(false);
    });
  });
});
