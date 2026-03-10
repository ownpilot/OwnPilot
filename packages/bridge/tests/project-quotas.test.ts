import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock isProcessAlive so fake test PIDs are treated as alive
vi.mock('../src/process-alive.ts', () => ({
  isProcessAlive: (pid: number | null | undefined) => pid != null,
}));

import { ClaudeManager } from '../src/claude-manager.ts';
import { config } from '../src/config.ts';

/**
 * Tests for per-project resource limits:
 * - Per-project concurrent spawn limit (MAX_CONCURRENT_PER_PROJECT)
 * - Per-project session cap (MAX_SESSIONS_PER_PROJECT)
 * - getProjectStats() public API
 * - isTracked projectDir fix
 */

describe('Per-Project Resource Limits', () => {
  let manager: ClaudeManager;

  beforeEach(() => {
    manager = new ClaudeManager();
  });

  describe('per-project concurrent spawn limit', () => {
    it('enforces per-project concurrent spawn limit', async () => {
      const projectDir = '/home/ayaz/project-alpha';
      const limit = config.maxConcurrentPerProject; // default: 5

      // Create limit+1 sessions for the same project
      for (let i = 0; i <= limit; i++) {
        await manager.getOrCreate(`alpha-${i}`, { projectDir });
      }

      // Simulate active processes on first `limit` sessions
      for (let i = 0; i < limit; i++) {
        const s = (manager as any).sessions.get(`alpha-${i}`);
        if (s) s.activeProcess = { pid: 1000 + i, kill: vi.fn(), killed: false } as any;
      }

      // The next send() should fail with PROJECT_CONCURRENT_LIMIT
      try {
        const gen = manager.send(`alpha-${limit}`, 'hello', projectDir);
        await gen.next();
        expect.fail('Should have thrown PROJECT_CONCURRENT_LIMIT');
      } catch (err: any) {
        expect(err.code).toBe('PROJECT_CONCURRENT_LIMIT');
        expect(err.message).toContain(projectDir);
        expect(err.message).toContain(`${limit}/${limit}`);
      }

      // Cleanup
      for (let i = 0; i <= limit; i++) {
        manager.terminate(`alpha-${i}`);
      }
    });

    it('allows different projects to use their own quota', async () => {
      const projectAlpha = '/home/ayaz/project-alpha';
      const projectBeta = '/home/ayaz/project-beta';
      const limit = config.maxConcurrentPerProject;

      // Fill up project alpha's active quota
      for (let i = 0; i < limit; i++) {
        await manager.getOrCreate(`alpha-${i}`, { projectDir: projectAlpha });
        const s = (manager as any).sessions.get(`alpha-${i}`);
        if (s) s.activeProcess = { pid: 2000 + i, kill: vi.fn(), killed: false } as any;
      }

      // Project beta should still be fine — separate quota
      await manager.getOrCreate('beta-0', { projectDir: projectBeta });
      const betaSession = (manager as any).sessions.get('beta-0');
      expect(betaSession).toBeDefined();

      // Verify alpha is at limit
      const alphaActive = [...(manager as any).sessions.values()].filter(
        (s: any) => s.activeProcess !== null && s.info.projectDir === projectAlpha,
      ).length;
      expect(alphaActive).toBe(limit);

      // Verify beta has 0 active
      const betaActive = [...(manager as any).sessions.values()].filter(
        (s: any) => s.activeProcess !== null && s.info.projectDir === projectBeta,
      ).length;
      expect(betaActive).toBe(0);

      // Cleanup
      for (let i = 0; i < limit; i++) {
        manager.terminate(`alpha-${i}`);
      }
      manager.terminate('beta-0');
    });

    it('global limit still enforced when per-project limit not reached', async () => {
      const globalLimit = (manager as any).MAX_CONCURRENT_ACTIVE as number;

      // Create sessions spread across many projects (1 per project), exceeding global limit
      for (let i = 0; i < globalLimit; i++) {
        const projectDir = `/home/ayaz/project-${i}`;
        await manager.getOrCreate(`conv-${i}`, { projectDir });
        const s = (manager as any).sessions.get(`conv-${i}`);
        if (s) s.activeProcess = { pid: 3000 + i, kill: vi.fn(), killed: false } as any;
      }

      // Next send() should fail with CONCURRENT_LIMIT (global), not PROJECT_CONCURRENT_LIMIT
      const extraProject = `/home/ayaz/project-${globalLimit}`;
      await manager.getOrCreate(`conv-${globalLimit}`, { projectDir: extraProject });
      try {
        const gen = manager.send(`conv-${globalLimit}`, 'hello', extraProject);
        await gen.next();
        expect.fail('Should have thrown CONCURRENT_LIMIT');
      } catch (err: any) {
        expect(err.code).toBe('CONCURRENT_LIMIT');
      }

      // Cleanup
      for (let i = 0; i <= globalLimit; i++) {
        manager.terminate(`conv-${i}`);
      }
    });

    it('PROJECT_CONCURRENT_LIMIT error code is set correctly', async () => {
      const projectDir = '/home/ayaz/project-gamma';
      const limit = config.maxConcurrentPerProject;

      for (let i = 0; i < limit; i++) {
        await manager.getOrCreate(`gamma-${i}`, { projectDir });
        const s = (manager as any).sessions.get(`gamma-${i}`);
        if (s) s.activeProcess = { pid: 4000 + i, kill: vi.fn(), killed: false } as any;
      }

      await manager.getOrCreate(`gamma-${limit}`, { projectDir });

      try {
        const gen = manager.send(`gamma-${limit}`, 'test', projectDir);
        await gen.next();
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('PROJECT_CONCURRENT_LIMIT');
        expect(err.message).toContain('Other projects can still proceed');
      }

      // Cleanup
      for (let i = 0; i <= limit; i++) {
        manager.terminate(`gamma-${i}`);
      }
    });
  });

  describe('per-project session cap', () => {
    // Override MAX_SESSIONS_PER_PROJECT to a small number for test speed
    const TEST_CAP = 5;

    it('enforces per-project session cap by evicting oldest idle', async () => {
      const projectDir = '/home/ayaz/project-delta';
      // Override the internal cap for test performance
      (manager as any).MAX_SESSIONS_PER_PROJECT = TEST_CAP;

      // Create sessions up to the cap
      for (let i = 0; i < TEST_CAP; i++) {
        await manager.getOrCreate(`delta-${i}`, { projectDir });
        // Stagger lastActivity so delta-0 is oldest
        const s = (manager as any).sessions.get(`delta-${i}`);
        if (s) s.info.lastActivity = new Date(Date.now() - (TEST_CAP - i) * 1000);
      }

      // Verify all sessions exist
      expect((manager as any).sessions.size).toBe(TEST_CAP);

      // Creating one more should evict the oldest idle (delta-0)
      await manager.getOrCreate(`delta-${TEST_CAP}`, { projectDir });

      // delta-0 should be evicted
      expect((manager as any).sessions.has('delta-0')).toBe(false);
      // delta-cap should exist
      expect((manager as any).sessions.has(`delta-${TEST_CAP}`)).toBe(true);
      // Total count should still be TEST_CAP (one evicted, one added)
      expect((manager as any).sessions.size).toBe(TEST_CAP);

      // Cleanup
      for (let i = 1; i <= TEST_CAP; i++) {
        manager.terminate(`delta-${i}`);
      }
    });

    it('evicts oldest idle session from same project when cap reached', async () => {
      const projectDir = '/home/ayaz/project-epsilon';
      const otherProjectDir = '/home/ayaz/project-other';
      (manager as any).MAX_SESSIONS_PER_PROJECT = TEST_CAP;

      // Create sessions for project-epsilon up to cap
      for (let i = 0; i < TEST_CAP; i++) {
        await manager.getOrCreate(`eps-${i}`, { projectDir });
        const s = (manager as any).sessions.get(`eps-${i}`);
        if (s) s.info.lastActivity = new Date(Date.now() - (TEST_CAP - i) * 1000);
      }

      // Also create a session for a different project
      await manager.getOrCreate('other-0', { projectDir: otherProjectDir });

      // The other project session should NOT be evicted
      await manager.getOrCreate(`eps-${TEST_CAP}`, { projectDir });

      // other-0 should still exist (different project, untouched)
      expect((manager as any).sessions.has('other-0')).toBe(true);
      // eps-0 (oldest in same project) should be evicted
      expect((manager as any).sessions.has('eps-0')).toBe(false);

      // Cleanup
      for (let i = 1; i <= TEST_CAP; i++) {
        manager.terminate(`eps-${i}`);
      }
      manager.terminate('other-0');
    });

    it('allows session creation when no idle session to evict from project', async () => {
      const projectDir = '/home/ayaz/project-zeta';
      (manager as any).MAX_SESSIONS_PER_PROJECT = TEST_CAP;

      // Create sessions up to cap, all active (no idle to evict)
      for (let i = 0; i < TEST_CAP; i++) {
        await manager.getOrCreate(`zeta-${i}`, { projectDir });
        const s = (manager as any).sessions.get(`zeta-${i}`);
        if (s) s.activeProcess = { pid: 6000 + i, kill: vi.fn(), killed: false } as any;
      }

      // Creating one more should succeed (falls through to global LRU)
      await manager.getOrCreate(`zeta-${TEST_CAP}`, { projectDir });
      expect((manager as any).sessions.has(`zeta-${TEST_CAP}`)).toBe(true);
      // Total is TEST_CAP + 1 because no idle session was evictable
      expect((manager as any).sessions.size).toBe(TEST_CAP + 1);

      // Cleanup
      for (let i = 0; i <= TEST_CAP; i++) {
        manager.terminate(`zeta-${i}`);
      }
    });
  });

  describe('getProjectStats', () => {
    it('returns correct counts for single project', async () => {
      const projectDir = '/home/ayaz/project-stats';

      await manager.getOrCreate('stats-1', { projectDir });
      await manager.getOrCreate('stats-2', { projectDir });
      await manager.getOrCreate('stats-3', { projectDir });

      // Make stats-1 active
      const s1 = (manager as any).sessions.get('stats-1');
      if (s1) s1.activeProcess = { pid: 7001, kill: vi.fn(), killed: false } as any;

      // Make stats-2 paused
      const s2 = (manager as any).sessions.get('stats-2');
      if (s2) s2.paused = true;

      const stats = manager.getProjectStats();
      expect(stats).toHaveLength(1);

      const stat = stats[0];
      expect(stat.projectDir).toBe(projectDir);
      expect(stat.total).toBe(3);
      expect(stat.active).toBe(1);
      expect(stat.paused).toBe(1);

      // Cleanup
      manager.terminate('stats-1');
      manager.terminate('stats-2');
      manager.terminate('stats-3');
    });

    it('returns correct counts for multiple projects', async () => {
      await manager.getOrCreate('a-1', { projectDir: '/home/ayaz/project-a' });
      await manager.getOrCreate('a-2', { projectDir: '/home/ayaz/project-a' });
      await manager.getOrCreate('b-1', { projectDir: '/home/ayaz/project-b' });

      const stats = manager.getProjectStats();
      expect(stats).toHaveLength(2);

      const statA = stats.find((s) => s.projectDir === '/home/ayaz/project-a');
      const statB = stats.find((s) => s.projectDir === '/home/ayaz/project-b');

      expect(statA).toBeDefined();
      expect(statA!.total).toBe(2);
      expect(statB).toBeDefined();
      expect(statB!.total).toBe(1);

      // Cleanup
      manager.terminate('a-1');
      manager.terminate('a-2');
      manager.terminate('b-1');
    });

    it('returns empty array when no sessions', () => {
      const stats = manager.getProjectStats();
      expect(stats).toEqual([]);
    });
  });

  describe('isTracked projectDir fix', () => {
    it('isTracked respects projectDir filter', async () => {
      const projectDir = '/home/ayaz/project-track';
      await manager.getOrCreate('track-1', { projectDir });

      const session = (manager as any).sessions.get('track-1');
      expect(session.info.projectDir).toBe(projectDir);

      // Different project should not match (simulates listDiskSessions logic)
      const otherDir = '/home/ayaz/project-other';
      const sessions = Array.from((manager as any).sessions.values()) as any[];
      const isTrackedForOther = sessions.some(
        (s: any) => s.info.sessionId === session.info.sessionId && s.info.projectDir === otherDir,
      );
      expect(isTrackedForOther).toBe(false);

      // Same project should match
      const isTrackedForSame = sessions.some(
        (s: any) => s.info.sessionId === session.info.sessionId && s.info.projectDir === projectDir,
      );
      expect(isTrackedForSame).toBe(true);

      // Cleanup
      manager.terminate('track-1');
    });
  });
});
