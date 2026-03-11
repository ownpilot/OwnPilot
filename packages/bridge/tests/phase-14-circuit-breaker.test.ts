import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';

// Mock isProcessAlive so fake test PIDs are treated as alive
vi.mock('../src/process-alive.ts', () => ({
  isProcessAlive: (pid: number | null | undefined) => pid != null,
}));

import { ClaudeManager } from '../src/claude-manager.ts';
import {
  globalCb,
  projectCbRegistry,
  SlidingWindowCircuitBreaker,
  CircuitBreakerRegistry,
} from '../src/circuit-breaker.ts';

/**
 * Phase 14 integration tests — 3-Tier Circuit Breaker
 *
 * Tests that ClaudeManager properly:
 * - Checks the global CB (tier-3) before spawning
 * - Checks the per-project CB (tier-2) before spawning
 * - Returns correct error codes (GLOBAL_CIRCUIT_OPEN, PROJECT_CIRCUIT_OPEN)
 * - Isolates project CBs from each other
 */

describe('Phase 14 — 3-Tier Circuit Breaker Integration', () => {
  let manager: ClaudeManager;

  beforeEach(() => {
    manager = new ClaudeManager();
    // Reset singletons to clean state before each test
    globalCb.reset();
    projectCbRegistry.resetAll();
  });

  afterEach(() => {
    globalCb.reset();
    projectCbRegistry.resetAll();
  });

  // -------------------------------------------------------------------------
  // Tier-3: Global circuit breaker
  // -------------------------------------------------------------------------

  describe('Tier-3: Global circuit breaker', () => {
    it('throws GLOBAL_CIRCUIT_OPEN when global CB is open', async () => {
      // globalCb: failureThreshold=10, windowSize=20, requires 10 failures AND window.length>=3
      for (let i = 0; i < 10; i++) globalCb.recordFailure();
      expect(globalCb.getState()).toBe('open');

      await manager.getOrCreate('conv-global-1', { projectDir: '/home/ayaz/test' });

      try {
        const gen = manager.send('conv-global-1', 'hello', '/home/ayaz/test');
        await gen.next();
        expect.fail('Should have thrown GLOBAL_CIRCUIT_OPEN');
      } catch (err: any) {
        expect(err.code).toBe('GLOBAL_CIRCUIT_OPEN');
        expect(err.message).toContain('Global circuit breaker OPEN');
      }
    });

    it('allows spawning when global CB is closed', () => {
      // Global CB is reset, should be closed
      expect(globalCb.getState()).toBe('closed');
      expect(globalCb.canExecute()).toBe(true);
    });

    it('globalCb.reset() re-enables spawning after it was open', () => {
      for (let i = 0; i < 10; i++) globalCb.recordFailure();
      expect(globalCb.getState()).toBe('open');
      globalCb.reset();
      expect(globalCb.getState()).toBe('closed');
      expect(globalCb.canExecute()).toBe(true);
    });

    it('global CB open does not change per-project CB state', () => {
      for (let i = 0; i < 10; i++) globalCb.recordFailure();
      expect(globalCb.getState()).toBe('open');
      // An unrelated project CB should remain closed
      const projectCb = projectCbRegistry.get('/home/ayaz/clean-project');
      expect(projectCb.getState()).toBe('closed');
    });
  });

  // -------------------------------------------------------------------------
  // Tier-2: Per-project circuit breaker
  // -------------------------------------------------------------------------

  describe('Tier-2: Per-project circuit breaker', () => {
    it('throws PROJECT_CIRCUIT_OPEN when project CB is open', async () => {
      const projectDir = '/home/ayaz/broken-project';
      // Default project CB: failureThreshold=5, windowSize=10, min 3 calls
      const projectCb = projectCbRegistry.get(projectDir);
      for (let i = 0; i < 5; i++) projectCb.recordFailure();
      expect(projectCb.getState()).toBe('open');

      await manager.getOrCreate('conv-proj-1', { projectDir });

      try {
        const gen = manager.send('conv-proj-1', 'hello', projectDir);
        await gen.next();
        expect.fail('Should have thrown PROJECT_CIRCUIT_OPEN');
      } catch (err: any) {
        expect(err.code).toBe('PROJECT_CIRCUIT_OPEN');
        expect(err.message).toContain('Project circuit breaker OPEN');
        expect(err.message).toContain(projectDir);
      }
    });

    it('different projects have independent CBs', () => {
      const projectA = '/home/ayaz/project-a';
      const projectB = '/home/ayaz/project-b';

      // Open project A's CB
      const cbA = projectCbRegistry.get(projectA);
      for (let i = 0; i < 5; i++) cbA.recordFailure();
      expect(cbA.getState()).toBe('open');

      // Project B's CB should be untouched
      const cbB = projectCbRegistry.get(projectB);
      expect(cbB.getState()).toBe('closed');
      expect(cbB.canExecute()).toBe(true);
    });

    it('projectCbRegistry.reset() re-enables a specific project', () => {
      const projectDir = '/home/ayaz/test-project';
      const projectCb = projectCbRegistry.get(projectDir);
      for (let i = 0; i < 5; i++) projectCb.recordFailure();
      expect(projectCb.getState()).toBe('open');

      projectCbRegistry.reset(projectDir);
      expect(projectCb.getState()).toBe('closed');
      expect(projectCb.canExecute()).toBe(true);
    });

    it('projectCbRegistry.resetAll() re-enables all projects', () => {
      const projectA = '/home/ayaz/project-a';
      const projectB = '/home/ayaz/project-b';

      const cbA = projectCbRegistry.get(projectA);
      const cbB = projectCbRegistry.get(projectB);
      for (let i = 0; i < 5; i++) { cbA.recordFailure(); cbB.recordFailure(); }
      expect(cbA.getState()).toBe('open');
      expect(cbB.getState()).toBe('open');

      projectCbRegistry.resetAll();
      expect(cbA.getState()).toBe('closed');
      expect(cbB.getState()).toBe('closed');
    });

    it('registry.get() returns the same CB instance for the same projectDir', () => {
      const cbFirst = projectCbRegistry.get('/home/ayaz/same-project');
      const cbSecond = projectCbRegistry.get('/home/ayaz/same-project');
      expect(cbFirst).toBe(cbSecond);
    });
  });

  // -------------------------------------------------------------------------
  // Exported singletons
  // -------------------------------------------------------------------------

  describe('exported singletons', () => {
    it('globalCb is a SlidingWindowCircuitBreaker', () => {
      expect(globalCb).toBeInstanceOf(SlidingWindowCircuitBreaker);
    });

    it('projectCbRegistry is a CircuitBreakerRegistry', () => {
      expect(projectCbRegistry).toBeInstanceOf(CircuitBreakerRegistry);
    });
  });
});
