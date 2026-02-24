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

  // ============================================================================
  // Helper: create a workspace and return its ID
  // ============================================================================

  async function createWorkspace(
    opts: {
      name?: string;
      description?: string;
      provider?: string;
      model?: string;
      prompt?: string;
      withChannels?: boolean;
    } = {}
  ): Promise<string> {
    const {
      name = 'Test Workspace',
      description = '',
      provider = 'openai',
      model = 'gpt-4.1',
      prompt = 'You are a helpful AI assistant.',
      withChannels = false,
    } = opts;

    mockInput
      .mockResolvedValueOnce(name)
      .mockResolvedValueOnce(description)
      .mockResolvedValueOnce(prompt);
    mockSelect.mockResolvedValueOnce(provider).mockResolvedValueOnce(model);
    if (withChannels) {
      mockConfirm.mockResolvedValueOnce(true);
      mockCheckbox.mockResolvedValueOnce(['tg-1']);
    } else {
      mockConfirm.mockResolvedValueOnce(false);
    }

    await workspaceModule.workspaceCreate();

    // Extract workspace ID from the console.log output "   ID: ws-xxxxx"
    const idCall = logSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('ID:')
    );
    const id = idCall?.[0]?.replace(/.*ID:\s*/, '').trim() ?? '';
    logSpy.mockClear();
    // Only clear mock call history, not all mocks — vi.clearAllMocks() can interfere
    // with module-level mock state needed for subsequent createWorkspace calls.
    mockInput.mockClear();
    mockSelect.mockClear();
    mockConfirm.mockClear();
    mockCheckbox.mockClear();
    return id;
  }

  describe('workspaceList', () => {
    it('shows empty state when no workspaces exist', async () => {
      await workspaceModule.workspaceList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });

    it('lists workspaces with description', async () => {
      await createWorkspace({
        name: 'Dev Workspace',
        description: 'For development',
        provider: 'anthropic',
        model: 'claude-opus-4.5',
      });

      await workspaceModule.workspaceList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dev Workspace'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('For development'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('anthropic / claude-opus-4.5'));
    });

    it('lists workspaces without description', async () => {
      await createWorkspace({ name: 'Simple Workspace', description: '' });

      await workspaceModule.workspaceList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Simple Workspace'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('openai / gpt-4.1'));
      // Description line should not appear — only name, provider, and channels lines
      const descCalls = logSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('For development')
      );
      expect(descCalls).toHaveLength(0);
    });

    it('lists workspaces with channels', async () => {
      await createWorkspace({ name: 'Ch Workspace', withChannels: true });

      await workspaceModule.workspaceList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Channels: tg-1'));
    });

    it('lists workspaces with no channels', async () => {
      await createWorkspace({ name: 'No Ch Workspace', withChannels: false });

      await workspaceModule.workspaceList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Channels: None'));
    });

    it('lists multiple workspaces', async () => {
      // Ensure different Date.now() values so IDs don't collide
      const origNow = Date.now;
      let tick = origNow();
      vi.spyOn(Date, 'now').mockImplementation(() => ++tick);

      await createWorkspace({ name: 'Workspace A', description: 'First' });
      await createWorkspace({ name: 'Workspace B', description: 'Second' });

      await workspaceModule.workspaceList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Workspace A'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Workspace B'));

      vi.spyOn(Date, 'now').mockRestore();
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

    it('shows message when no workspaces exist with id', async () => {
      await workspaceModule.workspaceDelete({ id: 'invalid-id' });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });

    it('prompts for workspace selection when no id provided', async () => {
      const wsId = await createWorkspace({ name: 'Delete Target' });
      mockSelect.mockResolvedValueOnce(wsId);
      mockConfirm.mockResolvedValueOnce(true);

      await workspaceModule.workspaceDelete({});

      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Select workspace to delete:' })
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Delete Target" deleted'));
    });

    it('shows not found when workspace id does not exist', async () => {
      await createWorkspace({ name: 'Existing' });

      await workspaceModule.workspaceDelete({ id: 'non-existent-id' });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workspace not found: non-existent-id')
      );
    });

    it('deletes workspace when confirmed', async () => {
      const wsId = await createWorkspace({ name: 'To Delete' });
      mockConfirm.mockResolvedValueOnce(true);

      await workspaceModule.workspaceDelete({ id: wsId });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('To Delete" deleted'));

      // Verify it was actually deleted by listing
      logSpy.mockClear();
      await workspaceModule.workspaceList();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });

    it('cancels deletion when not confirmed', async () => {
      const wsId = await createWorkspace({ name: 'Keep Me' });
      mockConfirm.mockResolvedValueOnce(false);

      await workspaceModule.workspaceDelete({ id: wsId });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Cancelled'));

      // Verify it still exists by listing
      logSpy.mockClear();
      await workspaceModule.workspaceList();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Keep Me'));
    });

    it('shows no workspace selected when select returns falsy', async () => {
      await createWorkspace({ name: 'Dummy' });
      mockSelect.mockResolvedValueOnce('');

      await workspaceModule.workspaceDelete({});

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspace selected'));
    });
  });

  describe('workspaceSwitch', () => {
    it('shows message when no workspaces exist', async () => {
      await workspaceModule.workspaceSwitch({});

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });

    it('shows message when no workspaces exist with id', async () => {
      await workspaceModule.workspaceSwitch({ id: 'invalid-id' });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });

    it('prompts for workspace selection when no id provided', async () => {
      const wsId = await createWorkspace({ name: 'Switch Target' });
      mockSelect.mockResolvedValueOnce(wsId);

      await workspaceModule.workspaceSwitch({});

      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Select workspace to activate:' })
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Switched to workspace "Switch Target"')
      );
    });

    it('shows not found when workspace id does not exist', async () => {
      await createWorkspace({ name: 'Existing' });

      await workspaceModule.workspaceSwitch({ id: 'bad-id' });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Workspace not found: bad-id'));
    });

    it('switches workspace successfully by id', async () => {
      const wsId = await createWorkspace({ name: 'My Active' });

      await workspaceModule.workspaceSwitch({ id: wsId });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Switched to workspace "My Active"')
      );
    });

    it('shows no workspace selected when select returns falsy', async () => {
      await createWorkspace({ name: 'Dummy' });
      mockSelect.mockResolvedValueOnce('');

      await workspaceModule.workspaceSwitch({});

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspace selected'));
    });
  });

  describe('workspaceInfo', () => {
    it('shows message when no workspaces exist', async () => {
      await workspaceModule.workspaceInfo({});

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });

    it('shows message when no workspaces exist with id', async () => {
      await workspaceModule.workspaceInfo({ id: 'invalid-id' });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspaces configured'));
    });

    it('prompts for workspace selection when no id provided', async () => {
      const wsId = await createWorkspace({ name: 'Info Target' });
      mockSelect.mockResolvedValueOnce(wsId);

      await workspaceModule.workspaceInfo({});

      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Select workspace:' })
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Workspace: Info Target'));
    });

    it('shows not found when workspace id does not exist', async () => {
      await createWorkspace({ name: 'Existing' });

      await workspaceModule.workspaceInfo({ id: 'missing-id' });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workspace not found: missing-id')
      );
    });

    it('displays workspace details with description', async () => {
      const wsId = await createWorkspace({
        name: 'Detailed WS',
        description: 'A detailed description',
        provider: 'anthropic',
        model: 'claude-sonnet-4.5',
        prompt: 'You are a specialized assistant for code review.',
      });

      await workspaceModule.workspaceInfo({ id: wsId });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Workspace: Detailed WS'));
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Description: A detailed description')
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Provider:  anthropic'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Model:     claude-sonnet-4.5'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Prompt:'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No channels associated'));
    });

    it('displays workspace details without description', async () => {
      const wsId = await createWorkspace({
        name: 'No Desc WS',
        description: '',
        provider: 'openai',
        model: 'gpt-4.1',
      });

      await workspaceModule.workspaceInfo({ id: wsId });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Workspace: No Desc WS'));
      // Description line should NOT appear
      const descCalls = logSpy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].startsWith('Description:')
      );
      expect(descCalls).toHaveLength(0);
    });

    it('displays workspace details with known channels', async () => {
      const wsId = await createWorkspace({
        name: 'Channel WS',
        withChannels: true,
      });

      await workspaceModule.workspaceInfo({ id: wsId });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Channels (1)'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Personal Bot (telegram)'));
    });

    it('displays workspace details with unknown channel id', async () => {
      // Mock checkbox to return a channel ID not in availableChannels.
      // workspaceCreate stores whatever IDs the checkbox returns, so we can
      // inject an unknown ID to exercise the "(unknown)" display branch.
      mockInput
        .mockResolvedValueOnce('Unknown Ch WS')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('You are a helpful AI assistant.');
      mockSelect.mockResolvedValueOnce('openai').mockResolvedValueOnce('gpt-4.1');
      mockConfirm.mockResolvedValueOnce(true);
      mockCheckbox.mockResolvedValueOnce(['non-existent-channel']);

      await workspaceModule.workspaceCreate();

      const idCall = logSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('ID:')
      );
      const wsId = idCall?.[0]?.replace(/.*ID:\s*/, '').trim() ?? '';
      logSpy.mockClear();
      vi.clearAllMocks();

      await workspaceModule.workspaceInfo({ id: wsId });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Channels (1)'));
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('non-existent-channel (unknown)')
      );
    });

    it('displays no channels associated when workspace has none', async () => {
      const wsId = await createWorkspace({
        name: 'Empty Channel WS',
        withChannels: false,
      });

      await workspaceModule.workspaceInfo({ id: wsId });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Channels (0)'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No channels associated'));
    });

    it('shows no workspace selected when select returns falsy', async () => {
      await createWorkspace({ name: 'Dummy' });
      mockSelect.mockResolvedValueOnce('');

      await workspaceModule.workspaceInfo({});

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No workspace selected'));
    });

    it('displays ID in workspace details', async () => {
      const wsId = await createWorkspace({ name: 'ID Test WS' });

      await workspaceModule.workspaceInfo({ id: wsId });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`ID:          ${wsId}`));
    });

    it('displays AI Configuration section', async () => {
      const wsId = await createWorkspace({
        name: 'Config WS',
        provider: 'deepseek',
        model: 'deepseek-v3.2',
        prompt: 'You are a coding assistant specializing in TypeScript.',
      });

      await workspaceModule.workspaceInfo({ id: wsId });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('AI Configuration:'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Provider:  deepseek'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Model:     deepseek-v3.2'));
      // .slice(0, 50) -> 'You are a coding assistant specializing in TypeScr'
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Prompt:    You are a coding assistant specializing in TypeScr...')
      );
    });
  });
});
