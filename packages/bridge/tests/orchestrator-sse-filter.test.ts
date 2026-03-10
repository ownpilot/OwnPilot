/**
 * Orchestrator SSE Filter — Unit Tests (07-01)
 *
 * Tests the filter predicate logic for orchestrator_id SSE filtering.
 * The shouldDeliver helper mirrors the inline logic in the SSE handler.
 *
 * Filter semantics (CRITICAL):
 *   - filterOrchestratorId set + event.orchestratorId set + DIFFER → SKIP (isolation)
 *   - filterOrchestratorId set + event.orchestratorId MISSING  → DELIVER (untagged = global)
 *   - filterOrchestratorId NOT set                             → DELIVER ALL (backwards compat)
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Filter predicate — mirrors SSE handler logic in src/api/routes.ts
// ---------------------------------------------------------------------------

/**
 * Simulate the orchestrator_id filter decision.
 * Returns true if the event should be delivered to this SSE stream.
 */
function shouldDeliver(
  filterOrchestratorId: string | null,
  event: { orchestratorId?: string },
): boolean {
  // No filter → deliver everything (backwards compatible)
  if (!filterOrchestratorId) return true;
  // Event is untagged (missing or undefined) → always deliver (global broadcast)
  if (!('orchestratorId' in event) || event.orchestratorId === undefined) return true;
  // Tagged event → deliver only if orchestrator matches
  return event.orchestratorId === filterOrchestratorId;
}

// ---------------------------------------------------------------------------
// Tests A–E
// ---------------------------------------------------------------------------

describe('orchestrator SSE filter predicate', () => {
  // A: No filter active → deliver ALL events regardless of tag
  describe('A: no filter (null)', () => {
    it('delivers tagged events when filter is null', () => {
      expect(shouldDeliver(null, { orchestratorId: 'abc' })).toBe(true);
    });

    it('delivers untagged events when filter is null', () => {
      expect(shouldDeliver(null, {})).toBe(true);
    });

    it('delivers events with undefined orchestratorId when filter is null', () => {
      expect(shouldDeliver(null, { orchestratorId: undefined })).toBe(true);
    });
  });

  // B: filter=abc, event.orchestratorId=abc → DELIVER (matching orchestrator)
  it('B: delivers event when orchestratorId matches filter', () => {
    expect(shouldDeliver('abc', { orchestratorId: 'abc' })).toBe(true);
  });

  // C: filter=abc, event.orchestratorId=xyz → SKIP (different orchestrator)
  it('C: skips event when orchestratorId differs from filter', () => {
    expect(shouldDeliver('abc', { orchestratorId: 'xyz' })).toBe(false);
  });

  // D: filter=abc, event has NO orchestratorId property → DELIVER (untagged = global)
  it('D: delivers event that has no orchestratorId property (untagged = global)', () => {
    const event = { type: 'session.output', text: 'hello' }; // no orchestratorId key
    expect(shouldDeliver('abc', event)).toBe(true);
  });

  // E: filter=abc, event.orchestratorId=undefined → DELIVER (undefined = untagged)
  it('E: delivers event when orchestratorId is explicitly undefined', () => {
    expect(shouldDeliver('abc', { orchestratorId: undefined })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe('orchestrator SSE filter — edge cases', () => {
  it('empty string filter acts as no filter (falsy)', () => {
    // empty string is falsy in JS, so treated as "no filter"
    expect(shouldDeliver('', { orchestratorId: 'xyz' })).toBe(true);
  });

  it('two different non-null orchestratorIds are isolated', () => {
    expect(shouldDeliver('orch-1', { orchestratorId: 'orch-2' })).toBe(false);
    expect(shouldDeliver('orch-2', { orchestratorId: 'orch-1' })).toBe(false);
  });

  it('same orchestratorId delivers to matching stream', () => {
    const orchestratorId = 'conv-12345';
    expect(shouldDeliver(orchestratorId, { orchestratorId })).toBe(true);
  });
});
