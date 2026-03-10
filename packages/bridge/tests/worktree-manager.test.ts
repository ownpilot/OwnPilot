import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WorktreeManager } from '../src/worktree-manager.ts';
import type { WorktreeInfo, MergeResult } from '../src/worktree-manager.ts';

// Mock child_process.execFile
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock fs for directory checks
const mockAccess = vi.fn();
const mockMkdir = vi.fn();
const mockRm = vi.fn();
vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rm: (...args: unknown[]) => mockRm(...args),
}));

// Helper: make execFile resolve with stdout
function gitResolves(stdout = '') {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      cb(null, stdout, '');
    }
  );
}

// Helper: make execFile reject
function gitRejects(message: string, code = 1) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      const err = new Error(message) as Error & { code: number };
      err.code = code;
      cb(err, '', message);
    }
  );
}

// Helper: route git commands differently
function gitRouted(routes: Record<string, string | Error>) {
  mockExecFile.mockImplementation(
    (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      const key = args.join(' ');
      for (const [pattern, result] of Object.entries(routes)) {
        if (key.includes(pattern)) {
          if (result instanceof Error) {
            cb(result, '', result.message);
          } else {
            cb(null, result, '');
          }
          return;
        }
      }
      // Default: succeed silently
      cb(null, '', '');
    }
  );
}

describe('WorktreeManager', () => {
  let wm: WorktreeManager;
  const projectDir = '/home/ayaz/test-project';

  beforeEach(() => {
    vi.clearAllMocks();
    wm = new WorktreeManager();
    mockAccess.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- create ----

  describe('create', () => {
    it('creates a worktree with auto-generated name', async () => {
      gitResolves('');
      const wt = await wm.create(projectDir);

      expect(wt.projectDir).toBe(projectDir);
      expect(wt.path).toContain('.claude/worktrees/');
      expect(wt.branch).toMatch(/^bridge\/wt-/);
      expect(wt.createdAt).toBeInstanceOf(Date);
      expect(mockExecFile).toHaveBeenCalled();
    });

    it('creates a worktree with custom name', async () => {
      gitResolves('');
      const wt = await wm.create(projectDir, { name: 'phase-4' });

      expect(wt.name).toBe('phase-4');
      expect(wt.branch).toBe('bridge/wt-phase-4');
      expect(wt.path).toContain('phase-4');
    });

    it('links worktree to conversationId', async () => {
      gitResolves('');
      const wt = await wm.create(projectDir, { conversationId: 'conv-123' });

      expect(wt.conversationId).toBe('conv-123');
    });

    it('uses specified baseBranch', async () => {
      gitResolves('');
      const wt = await wm.create(projectDir, { baseBranch: 'develop' });

      expect(wt.baseBranch).toBe('develop');
    });

    it('throws on non-git directory', async () => {
      gitRejects('fatal: not a git repository');

      await expect(wm.create(projectDir)).rejects.toThrow(/not a git repository/i);
    });

    it('throws when name is longer than 100 characters', async () => {
      await expect(wm.create(projectDir, { name: 'a'.repeat(101) })).rejects.toThrow(/too long/i);
    });

    it('throws when max worktrees exceeded', async () => {
      gitResolves('');

      // Create 5 worktrees (max)
      for (let i = 0; i < 5; i++) {
        await wm.create(projectDir, { name: `wt-${i}` });
      }

      await expect(wm.create(projectDir, { name: 'wt-6' })).rejects.toThrow(/max.*worktrees/i);
    });
  });

  // ---- list ----

  describe('list', () => {
    it('returns empty array when no worktrees', async () => {
      const result = await wm.list(projectDir);
      expect(result).toEqual([]);
    });

    it('returns created worktrees', async () => {
      gitResolves('');
      await wm.create(projectDir, { name: 'alpha' });
      await wm.create(projectDir, { name: 'beta' });

      const result = await wm.list(projectDir);
      expect(result).toHaveLength(2);
      expect(result.map(w => w.name)).toContain('alpha');
      expect(result.map(w => w.name)).toContain('beta');
    });

    it('filters by projectDir', async () => {
      gitResolves('');
      await wm.create(projectDir, { name: 'one' });
      await wm.create('/other/project', { name: 'two' });

      const result = await wm.list(projectDir);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('one');
    });
  });

  // ---- get ----

  describe('get', () => {
    it('returns null for non-existent worktree', async () => {
      const result = await wm.get(projectDir, 'nope');
      expect(result).toBeNull();
    });

    it('returns worktree info by name', async () => {
      gitResolves('');
      await wm.create(projectDir, { name: 'target' });

      const result = await wm.get(projectDir, 'target');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('target');
      expect(result!.projectDir).toBe(projectDir);
    });
  });

  // ---- remove ----

  describe('remove', () => {
    it('removes an existing worktree', async () => {
      gitResolves('');
      await wm.create(projectDir, { name: 'to-delete' });

      await wm.remove(projectDir, 'to-delete');

      const result = await wm.get(projectDir, 'to-delete');
      expect(result).toBeNull();
    });

    it('throws on non-existent worktree', async () => {
      await expect(wm.remove(projectDir, 'ghost')).rejects.toThrow(/not found/i);
    });

    it('calls git worktree remove', async () => {
      gitResolves('');
      await wm.create(projectDir, { name: 'cleanup' });

      await wm.remove(projectDir, 'cleanup');

      // Check that git worktree remove was called
      const removeCalls = mockExecFile.mock.calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('remove')
      );
      expect(removeCalls.length).toBeGreaterThan(0);
    });

    it('calls git branch -d after removal', async () => {
      gitResolves('');
      await wm.create(projectDir, { name: 'branch-clean' });

      await wm.remove(projectDir, 'branch-clean');

      // Check that git branch -d was called
      const branchCalls = mockExecFile.mock.calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('-d')
      );
      expect(branchCalls.length).toBeGreaterThan(0);
    });
  });

  // ---- mergeBack ----

  describe('mergeBack', () => {
    it('returns success on fast-forward merge', async () => {
      gitRouted({
        'worktree add': '',
        'rev-parse': 'main',
        'merge --no-edit': '',
        'merge-base --is-ancestor': '',
        'worktree remove': '',
        'branch -d': '',
      });
      await wm.create(projectDir, { name: 'ff-merge' });

      const result = await wm.mergeBack(projectDir, 'ff-merge');

      expect(result.success).toBe(true);
    });

    it('returns conflict info on merge failure', async () => {
      const mergeErr = new Error('CONFLICT (content): Merge conflict in file.ts');
      gitRouted({
        'worktree add': '',
        'rev-parse': 'main',
        'merge --no-edit': mergeErr,
        'diff --name-only --diff-filter=U': 'src/file.ts\nsrc/other.ts',
        'merge --abort': '',
      });
      await wm.create(projectDir, { name: 'conflict-merge' });

      const result = await wm.mergeBack(projectDir, 'conflict-merge');

      expect(result.success).toBe(false);
      expect(result.strategy).toBe('conflict');
      expect(result.conflictFiles).toContain('src/file.ts');
    });

    it('throws on non-existent worktree', async () => {
      await expect(wm.mergeBack(projectDir, 'nope')).rejects.toThrow(/not found/i);
    });

    it('removes worktree after successful merge when deleteAfter is true', async () => {
      gitResolves('');
      await wm.create(projectDir, { name: 'auto-clean' });

      await wm.mergeBack(projectDir, 'auto-clean', { deleteAfter: true });

      const result = await wm.get(projectDir, 'auto-clean');
      expect(result).toBeNull();
    });

    it('keeps worktree alive after conflict', async () => {
      const mergeErr = new Error('CONFLICT');
      gitRouted({
        'worktree add': '',
        'rev-parse': 'main',
        'merge --no-edit': mergeErr,
        'diff --name-only --diff-filter=U': 'file.ts',
        'merge --abort': '',
      });
      await wm.create(projectDir, { name: 'keep-alive' });

      await wm.mergeBack(projectDir, 'keep-alive', { deleteAfter: true });

      const result = await wm.get(projectDir, 'keep-alive');
      expect(result).not.toBeNull(); // Still exists despite deleteAfter
    });
  });

  // ---- pruneOrphans ----

  describe('pruneOrphans', () => {
    it('returns empty array when no worktrees', async () => {
      const pruned = await wm.pruneOrphans(projectDir);
      expect(pruned).toEqual([]);
    });

    it('calls git worktree prune', async () => {
      gitResolves('');
      await wm.pruneOrphans(projectDir);

      const pruneCalls = mockExecFile.mock.calls.filter(
        (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('prune')
      );
      expect(pruneCalls.length).toBeGreaterThan(0);
    });

    it('removes in-memory entries whose paths are gone from git', async () => {
      // Phase 1: create worktree — populate registry
      gitRouted({
        'rev-parse': 'main',
        'worktree add': '',
      });
      await wm.create(projectDir, { name: 'orphan-wt' });

      // Phase 2: pruneOrphans — git list returns only main repo, not our worktree
      const listOutput = [
        `worktree ${projectDir}`,
        'HEAD abc123',
        'branch refs/heads/main',
        '',
      ].join('\n');
      gitRouted({
        'worktree prune': '',
        'worktree list': listOutput,
      });

      const pruned = await wm.pruneOrphans(projectDir);
      expect(pruned).toEqual(['orphan-wt']);
      expect(await wm.get(projectDir, 'orphan-wt')).toBeNull();
    });

    it('keeps entries that are still in git worktree list', async () => {
      gitRouted({
        'rev-parse': 'main',
        'worktree add': '',
      });
      const wt = await wm.create(projectDir, { name: 'alive-wt' });

      // List includes both main repo and our worktree path
      const listOutput = [
        `worktree ${projectDir}`,
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        `worktree ${wt.path}`,
        'HEAD def456',
        'branch refs/heads/bridge/wt-alive-wt',
        '',
      ].join('\n');
      gitRouted({
        'worktree prune': '',
        'worktree list': listOutput,
      });

      const pruned = await wm.pruneOrphans(projectDir);
      expect(pruned).toEqual([]);
      expect(await wm.get(projectDir, 'alive-wt')).not.toBeNull();
    });

    it('returns empty and does not modify registry when git list fails', async () => {
      gitRouted({
        'rev-parse': 'main',
        'worktree add': '',
      });
      await wm.create(projectDir, { name: 'safe-wt' });

      gitRouted({
        'worktree prune': '',
        'worktree list': new Error('not a git repo'),
      });

      const pruned = await wm.pruneOrphans(projectDir);
      expect(pruned).toEqual([]);
      expect(await wm.get(projectDir, 'safe-wt')).not.toBeNull();
    });
  });

  // ---- cleanupStale ----

  describe('cleanupStale', () => {
    it('removes worktrees older than maxAgeMs', async () => {
      gitRouted({
        'rev-parse': 'main',
        'worktree add': '',
        'worktree remove': '',
        'branch -d': '',
      });
      await wm.create(projectDir, { name: 'old-wt' });

      // Backdate createdAt to 25 hours ago (older than 24h limit)
      const entry = await wm.get(projectDir, 'old-wt');
      entry!.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

      const cleaned = await wm.cleanupStale(projectDir, 24 * 60 * 60 * 1000);
      expect(cleaned).toEqual(['old-wt']);
      expect(await wm.get(projectDir, 'old-wt')).toBeNull();
    });

    it('keeps worktrees younger than maxAgeMs', async () => {
      gitResolves('');
      await wm.create(projectDir, { name: 'recent-wt' });

      // createdAt is now (just created) — well within 24h limit
      const cleaned = await wm.cleanupStale(projectDir, 24 * 60 * 60 * 1000);
      expect(cleaned).toEqual([]);
      expect(await wm.get(projectDir, 'recent-wt')).not.toBeNull();
    });
  });

  // ---- branch naming ----

  describe('branch naming', () => {
    it('generates predictable branch format', async () => {
      gitResolves('');
      const wt = await wm.create(projectDir, { name: 'my-feature' });

      expect(wt.branch).toBe('bridge/wt-my-feature');
    });

    it('sanitizes special characters in name', async () => {
      gitResolves('');
      const wt = await wm.create(projectDir, { name: 'feat/special chars!' });

      expect(wt.branch).toMatch(/^bridge\/wt-/);
      // Branch name should not contain spaces or !
      expect(wt.branch).not.toMatch(/[ !]/);
    });
  });

  // ---- concurrent safety ----

  describe('concurrent safety', () => {
    it('does not allow duplicate names in same project', async () => {
      gitResolves('');
      await wm.create(projectDir, { name: 'unique' });

      await expect(wm.create(projectDir, { name: 'unique' })).rejects.toThrow(/already exists/i);
    });

    it('allows same name in different projects', async () => {
      gitResolves('');
      const wt1 = await wm.create(projectDir, { name: 'shared' });
      const wt2 = await wm.create('/other/project', { name: 'shared' });

      expect(wt1.projectDir).not.toBe(wt2.projectDir);
    });
  });
});
