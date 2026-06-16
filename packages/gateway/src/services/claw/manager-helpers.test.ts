/**
 * Tests for manager-helpers.ts — claw manager leaf helpers.
 *
 * Tests the three exported helpers:
 * - scaffoldClawDir: idempotent .claw/ directive file creation
 * - runRetentionCleanup: fire-and-forget retention trim
 * - ensureConversationRow: guarantee conversation row for chat tab
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCleanupOldHistory = vi.fn().mockResolvedValue(0);
const mockCleanupOldAuditLog = vi.fn().mockResolvedValue(0);

vi.mock('../../db/repositories/claws.js', () => ({
  getClawsRepository: () => ({
    cleanupOldHistory: mockCleanupOldHistory,
    cleanupOldAuditLog: mockCleanupOldAuditLog,
  }),
}));

const mockWriteFile = vi.fn();
const mockReadFile = vi.fn().mockReturnValue(null);

vi.mock('../../workspace/file-workspace.js', () => ({
  writeSessionWorkspaceFile: (...args: unknown[]) => mockWriteFile(...args),
  readSessionWorkspaceFile: (...args: unknown[]) => mockReadFile(...args),
  getOrCreateSessionWorkspace: vi.fn(),
  updateSessionWorkspaceMeta: vi.fn(),
}));

const mockGetConversation = vi.fn().mockResolvedValue(null);
const mockCreateConversation = vi.fn().mockResolvedValue({ id: 'claw-test-1' });

vi.mock('../../db/repositories/chat/index.js', () => ({
  ChatRepository: class {
    constructor() {}
    getConversation = mockGetConversation;
    createConversation = mockCreateConversation;
  },
}));

vi.mock('../log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
const { scaffoldClawDir, runRetentionCleanup, ensureConversationRow } =
  await import('./manager-helpers.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('manager-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReturnValue(null);
  });

  describe('scaffoldClawDir', () => {
    it('creates all four directive files when none exist', async () => {
      mockReadFile.mockReturnValue(null);

      await scaffoldClawDir('ws-1', {
        name: 'TestClaw',
        mission: 'Test the system',
        mode: 'continuous',
      });

      // 4 files: INSTRUCTIONS.md, TASKS.md, MEMORY.md, LOG.md
      expect(mockWriteFile).toHaveBeenCalledTimes(4);

      // Check INSTRUCTIONS.md content
      const instrCall = mockWriteFile.mock.calls.find((c) => c[1] === '.claw/INSTRUCTIONS.md');
      expect(instrCall).toBeDefined();
      const instrContent = instrCall![2] as Buffer;
      expect(instrContent.toString()).toContain('TestClaw');
      expect(instrContent.toString()).toContain('Test the system');

      // Check TASKS.md content
      const tasksCall = mockWriteFile.mock.calls.find((c) => c[1] === '.claw/TASKS.md');
      expect(tasksCall).toBeDefined();

      // Check MEMORY.md content
      const memCall = mockWriteFile.mock.calls.find((c) => c[1] === '.claw/MEMORY.md');
      expect(memCall).toBeDefined();

      // Check LOG.md content
      const logCall = mockWriteFile.mock.calls.find((c) => c[1] === '.claw/LOG.md');
      expect(logCall).toBeDefined();
    });

    it('skips files that already exist (idempotent)', async () => {
      mockReadFile.mockReturnValue('existing content');

      await scaffoldClawDir('ws-1', {
        name: 'TestClaw',
        mission: 'Test',
        mode: 'single-shot',
      });

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('handles partial existence — creates only missing files', async () => {
      mockReadFile.mockImplementation((ws: string, path: string) => {
        if (path === '.claw/INSTRUCTIONS.md') return 'existing';
        return null;
      });

      await scaffoldClawDir('ws-1', {
        name: 'TestClaw',
        mission: 'Test',
        mode: 'continuous',
      });

      // Only 3 files should be written (all except INSTRUCTIONS.md)
      expect(mockWriteFile).toHaveBeenCalledTimes(3);
      const writtenPaths = mockWriteFile.mock.calls.map((c) => c[1]);
      expect(writtenPaths).not.toContain('.claw/INSTRUCTIONS.md');
    });

    it('does not throw on write errors', async () => {
      mockWriteFile.mockImplementation(() => {
        throw new Error('disk full');
      });

      await expect(
        scaffoldClawDir('ws-1', {
          name: 'TestClaw',
          mission: 'Test',
          mode: 'continuous',
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('runRetentionCleanup', () => {
    it('calls cleanupOldHistory and cleanupOldAuditLog', () => {
      runRetentionCleanup();

      expect(mockCleanupOldHistory).toHaveBeenCalled();
      expect(mockCleanupOldAuditLog).toHaveBeenCalled();
    });

    it('is fire-and-forget (returns void synchronously)', () => {
      const result = runRetentionCleanup();
      expect(result).toBeUndefined();
    });
  });

  describe('ensureConversationRow', () => {
    it('creates a conversation when none exists', async () => {
      mockGetConversation.mockResolvedValue(null);

      await ensureConversationRow('claw-1', 'user-1', 'TestClaw');

      expect(mockGetConversation).toHaveBeenCalledWith('claw-claw-1');
      expect(mockCreateConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'claw-claw-1',
          agentName: 'claw-TestClaw',
        })
      );
    });

    it('does not create a conversation when one already exists', async () => {
      mockGetConversation.mockResolvedValue({ id: 'claw-claw-1' });

      await ensureConversationRow('claw-1', 'user-1', 'TestClaw');

      expect(mockCreateConversation).not.toHaveBeenCalled();
    });

    it('does not throw on errors', async () => {
      mockGetConversation.mockRejectedValue(new Error('DB down'));

      await expect(ensureConversationRow('claw-1', 'user-1', 'TestClaw')).resolves.toBeUndefined();
    });
  });
});
