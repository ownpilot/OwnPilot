/**
 * Workspace CLI Command Tests
 *
 * Tests for workspace.ts — workspace management commands with interactive prompts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockInput = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());
const mockConfirm = vi.hoisted(() => vi.fn());
const mockCheckbox = vi.hoisted(() => vi.fn());

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@inquirer/prompts', () => ({
  input: mockInput,
  select: mockSelect,
  confirm: mockConfirm,
  checkbox: mockCheckbox,
}));

describe('Workspace CLI Commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let workspaceModule: typeof import('./workspace.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Re-import to get fresh module state (clears workspaces Map)
    workspaceModule = await import('./workspace.js');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('workspaceList', () => {
    it('shows empty state when no workspaces exist', async () => {
      await workspaceModule.workspaceList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });
  });

  describe('workspaceCreate', () => {
    it('creates workspace with all fields', async () => {
      mockInput
        .mockResolvedValueOnce('My Workspace')
        .mockResolvedValueOnce('A test workspace')
        .mockResolvedValueOnce('Be helpful');
      mockSelect.mockResolvedValueOnce('anthropic').mockResolvedValueOnce('claude-opus-4.5');
      mockConfirm.mockResolvedValueOnce(false);

      await workspaceModule.workspaceCreate();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('My Workspace" created'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('anthropic'));
    });

    it('creates workspace without optional description', async () => {
      mockInput
        .mockResolvedValueOnce('Minimal Workspace')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('You are a helpful AI assistant.');
      mockSelect.mockResolvedValueOnce('openai').mockResolvedValueOnce('gpt-4.1');
      mockConfirm.mockResolvedValueOnce(false);

      await workspaceModule.workspaceCreate();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Minimal Workspace" created'));
    });

    it('creates workspace with channels', async () => {
      mockInput
        .mockResolvedValueOnce('Channel Workspace')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('You are a helpful AI assistant.');
      mockSelect.mockResolvedValueOnce('openai').mockResolvedValueOnce('gpt-4.1');
      mockConfirm.mockResolvedValueOnce(true);
      mockCheckbox.mockResolvedValueOnce(['tg-1']);

      await workspaceModule.workspaceCreate();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Channel Workspace" created'));
    });

    it('creates workspace with different providers', async () => {
      const providers = [
        { provider: 'zhipu', model: 'glm-4.7' },
        { provider: 'deepseek', model: 'deepseek-v3.2' },
        { provider: 'groq', model: 'llama-4-70b' },
      ];

      for (const { provider, model } of providers) {
        // Re-import for fresh state in loop
        workspaceModule = await import('./workspace.js');
        logSpy.mockClear();

        mockInput
          .mockResolvedValueOnce(`${provider} Workspace`)
          .mockResolvedValueOnce('')
          .mockResolvedValueOnce('Test prompt');
        mockSelect.mockResolvedValueOnce(provider).mockResolvedValueOnce(model);
        mockConfirm.mockResolvedValueOnce(false);

        await workspaceModule.workspaceCreate();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(provider));
      }
    });
  });

  describe('workspaceDelete', () => {
    it('shows message when no workspaces exist', async () => {
      await workspaceModule.workspaceDelete({});

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });

    it('shows message when no workspaces exist', async () => {
      await workspaceModule.workspaceDelete({ id: 'invalid-id' });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });
  });

  describe('workspaceSwitch', () => {
    it('shows message when no workspaces exist', async () => {
      await workspaceModule.workspaceSwitch({});

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });

    it('shows message when no workspaces exist', async () => {
      await workspaceModule.workspaceSwitch({ id: 'invalid-id' });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });
  });

  describe('workspaceInfo', () => {
    it('shows message when no workspaces exist', async () => {
      await workspaceModule.workspaceInfo({});

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });

    it('shows message when no workspaces exist', async () => {
      await workspaceModule.workspaceInfo({ id: 'invalid-id' });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });
  });
});
