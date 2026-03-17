/**
 * Tests for project_stats_changed SSE events (MON-04)
 *
 * Verifies that ClaudeManager emits 'project.stats_changed' events on the
 * eventBus singleton when sessions are created or terminated.
 *
 * Strategy: Use vi.spyOn(eventBus, 'emit') to intercept emissions without
 * mocking the full eventBus. This tests real ClaudeManager behavior with
 * the real eventBus.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeManager } from '../src/claude-manager.ts';
import { eventBus } from '../src/event-bus.ts';
import type { ProjectStatsChangedEvent } from '../src/event-bus.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_DIR = '/home/ayaz/stats-test-project';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClaudeManager project.stats_changed events (MON-04)', () => {
  let manager: ClaudeManager;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    manager = new ClaudeManager();
    emitSpy = vi.spyOn(eventBus, 'emit');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test A: eventBus.emit called with 'project.stats_changed' after ensureSession
  // -------------------------------------------------------------------------
  it('Test A: eventBus emits project.stats_changed after ensureSession() creates a session', async () => {
    await manager.getOrCreate('conv-ssa-1', { projectDir: PROJECT_DIR });

    const calls = emitSpy.mock.calls.filter(
      ([event]) => event === 'project.stats_changed',
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Test B: eventBus.emit called with 'project.stats_changed' after terminate()
  // -------------------------------------------------------------------------
  it('Test B: eventBus emits project.stats_changed after terminate() removes a session', async () => {
    await manager.getOrCreate('conv-ssa-2', { projectDir: PROJECT_DIR });
    emitSpy.mockClear(); // clear calls from session creation

    manager.terminate('conv-ssa-2');

    const calls = emitSpy.mock.calls.filter(
      ([event]) => event === 'project.stats_changed',
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // Test C: reason='session_created' on ensureSession, reason='session_terminated' on terminate
  // -------------------------------------------------------------------------
  it('Test C: reason=session_created on ensureSession, reason=session_terminated on terminate', async () => {
    // ensureSession call
    await manager.getOrCreate('conv-ssa-3', { projectDir: PROJECT_DIR });

    const createCalls = emitSpy.mock.calls.filter(
      ([event]) => event === 'project.stats_changed',
    );
    expect(createCalls.length).toBeGreaterThanOrEqual(1);
    const createPayload = createCalls[0][1] as ProjectStatsChangedEvent;
    expect(createPayload.reason).toBe('session_created');

    // terminate call
    emitSpy.mockClear();
    manager.terminate('conv-ssa-3');

    const terminateCalls = emitSpy.mock.calls.filter(
      ([event]) => event === 'project.stats_changed',
    );
    expect(terminateCalls.length).toBeGreaterThanOrEqual(1);
    const terminatePayload = terminateCalls[0][1] as ProjectStatsChangedEvent;
    expect(terminatePayload.reason).toBe('session_terminated');
  });

  // -------------------------------------------------------------------------
  // Test D: projectDir field matches the session's project directory
  // -------------------------------------------------------------------------
  it('Test D: projectDir in event payload matches the session project directory', async () => {
    const customDir = '/home/ayaz/custom-project-dir';
    await manager.getOrCreate('conv-ssa-4', { projectDir: customDir });

    const calls = emitSpy.mock.calls.filter(
      ([event]) => event === 'project.stats_changed',
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const payload = calls[0][1] as ProjectStatsChangedEvent;
    expect(payload.projectDir).toBe(customDir);
  });

  // -------------------------------------------------------------------------
  // Test E: event payload has required shape fields
  // -------------------------------------------------------------------------
  it('Test E: event payload has type, projectDir, active, paused, total, reason, timestamp fields', async () => {
    await manager.getOrCreate('conv-ssa-5', { projectDir: PROJECT_DIR });

    const calls = emitSpy.mock.calls.filter(
      ([event]) => event === 'project.stats_changed',
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const payload = calls[0][1] as ProjectStatsChangedEvent;

    expect(payload.type).toBe('project.stats_changed');
    expect(typeof payload.projectDir).toBe('string');
    expect(typeof payload.active).toBe('number');
    expect(typeof payload.paused).toBe('number');
    expect(typeof payload.total).toBe('number');
    expect(typeof payload.reason).toBe('string');
    expect(typeof payload.timestamp).toBe('string');
  });
});
