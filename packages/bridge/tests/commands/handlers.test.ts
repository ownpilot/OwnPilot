import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StreamChunk } from '../../src/types.ts';
import type { CommandContext } from '../../src/commands/types.ts';
import { commandRegistry, tryInterceptCommand } from '../../src/commands/index.ts';

// Helper: collect stream chunks
async function collectStream(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

// Helper: get text from stream
async function getText(gen: AsyncGenerator<StreamChunk>): Promise<string> {
  const chunks = await collectStream(gen);
  const text = chunks.find(c => c.type === 'text') as { type: 'text'; text: string } | undefined;
  return text?.text ?? '';
}

// Helper: build CommandContext with mocked services
function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    conversationId: 'test-conv',
    projectDir: '/tmp/test',
    sessionInfo: null,
    setConfigOverrides: vi.fn(),
    getConfigOverrides: vi.fn(() => ({})),
    terminate: vi.fn(),
    setDisplayName: vi.fn(),
    getDisplayName: vi.fn(() => null),
    listDiskSessions: vi.fn(() => []),
    getSessionJsonlPath: vi.fn(() => null),
    ...overrides,
  };
}

// ============================================================================
// Session handlers
// ============================================================================
describe('session handlers', () => {
  describe('/rename', () => {
    it('is registered', () => { expect(commandRegistry.has('rename')).toBe(true); });

    it('sets display name', async () => {
      const setDisplayName = vi.fn();
      const ctx = makeCtx({ setDisplayName });
      const stream = await tryInterceptCommand('/rename my-session', ctx);
      const text = await getText(stream!);
      expect(text).toContain('my-session');
      expect(setDisplayName).toHaveBeenCalledWith('my-session');
    });

    it('shows current name when no args', async () => {
      const ctx = makeCtx({ getDisplayName: vi.fn(() => 'existing-name') });
      const text = await getText((await tryInterceptCommand('/rename', ctx))!);
      expect(text).toContain('existing-name');
    });

    it('shows usage when no name and none set', async () => {
      const text = await getText((await tryInterceptCommand('/rename', makeCtx()))!);
      expect(text).toContain('Usage');
    });
  });

  describe('/clear', () => {
    it('is registered', () => { expect(commandRegistry.has('clear')).toBe(true); });

    it('terminates session', async () => {
      const terminate = vi.fn();
      const ctx = makeCtx({
        terminate,
        sessionInfo: {
          conversationId: 'c', sessionId: 's', processAlive: false,
          lastActivity: new Date(), projectDir: '/tmp', tokensUsed: 0, budgetUsed: 0, pendingApproval: null,
        },
      });
      const text = await getText((await tryInterceptCommand('/clear', ctx))!);
      expect(terminate).toHaveBeenCalled();
      expect(text).toContain('cleared');
    });

    it('returns message when no session', async () => {
      const text = await getText((await tryInterceptCommand('/clear', makeCtx()))!);
      expect(text).toContain('No active session');
    });
  });

  describe('/resume', () => {
    it('is registered', () => { expect(commandRegistry.has('resume')).toBe(true); });

    it('lists disk sessions', async () => {
      const ctx = makeCtx({
        listDiskSessions: vi.fn(() => [
          { sessionId: 'abc-123', sizeBytes: 4096, lastModified: '2026-03-01T12:00:00Z', hasSubagents: false, isTracked: true },
          { sessionId: 'def-456', sizeBytes: 8192, lastModified: '2026-03-01T11:00:00Z', hasSubagents: true, isTracked: false },
        ]),
      });
      const text = await getText((await tryInterceptCommand('/resume', ctx))!);
      expect(text).toContain('abc-123');
      expect(text).toContain('def-456');
      expect(text).toContain('[active]');
    });

    it('returns message when no sessions', async () => {
      const text = await getText((await tryInterceptCommand('/resume', makeCtx()))!);
      expect(text).toContain('No sessions found');
    });
  });

  describe('/export', () => {
    it('is registered', () => { expect(commandRegistry.has('export')).toBe(true); });

    it('returns message when no session', async () => {
      const text = await getText((await tryInterceptCommand('/export', makeCtx()))!);
      expect(text).toContain('No active session');
    });
  });
});

// ============================================================================
// Config handlers
// ============================================================================
describe('config handlers', () => {
  describe('/model', () => {
    it('is registered', () => { expect(commandRegistry.has('model')).toBe(true); });

    it('sets model with alias', async () => {
      const setConfigOverrides = vi.fn();
      const ctx = makeCtx({ setConfigOverrides });
      const text = await getText((await tryInterceptCommand('/model opus', ctx))!);
      expect(setConfigOverrides).toHaveBeenCalledWith({ model: 'claude-opus-4-6' });
      expect(text).toContain('claude-opus-4-6');
    });

    it('sets model with full name', async () => {
      const setConfigOverrides = vi.fn();
      const ctx = makeCtx({ setConfigOverrides });
      await tryInterceptCommand('/model claude-sonnet-4-6', ctx);
      expect(setConfigOverrides).toHaveBeenCalledWith({ model: 'claude-sonnet-4-6' });
    });

    it('shows aliases when no args', async () => {
      const text = await getText((await tryInterceptCommand('/model', makeCtx()))!);
      expect(text).toContain('opus');
      expect(text).toContain('sonnet');
      expect(text).toContain('haiku');
    });

    it.each([
      ['opus', 'claude-opus-4-6'],
      ['sonnet', 'claude-sonnet-4-6'],
      ['haiku', 'claude-haiku-4-5-20251001'],
    ])('alias "%s" maps to "%s"', async (alias, expected) => {
      const setConfigOverrides = vi.fn();
      await tryInterceptCommand(`/model ${alias}`, makeCtx({ setConfigOverrides }));
      expect(setConfigOverrides).toHaveBeenCalledWith({ model: expected });
    });
  });

  describe('/effort', () => {
    it('is registered', () => { expect(commandRegistry.has('effort')).toBe(true); });

    it.each(['low', 'medium', 'high'])('accepts "%s"', async (level) => {
      const setConfigOverrides = vi.fn();
      await tryInterceptCommand(`/effort ${level}`, makeCtx({ setConfigOverrides }));
      expect(setConfigOverrides).toHaveBeenCalledWith({ effort: level });
    });

    it('rejects invalid level', async () => {
      const setConfigOverrides = vi.fn();
      await tryInterceptCommand('/effort invalid', makeCtx({ setConfigOverrides }));
      expect(setConfigOverrides).not.toHaveBeenCalled();
    });

    it('shows usage when no args', async () => {
      const text = await getText((await tryInterceptCommand('/effort', makeCtx()))!);
      expect(text).toContain('Usage');
    });
  });

  describe('/add-dir', () => {
    it('is registered', () => { expect(commandRegistry.has('add-dir')).toBe(true); });

    it('adds existing directory', async () => {
      const setConfigOverrides = vi.fn();
      const ctx = makeCtx({ setConfigOverrides });
      const text = await getText((await tryInterceptCommand('/add-dir /tmp', ctx))!);
      expect(setConfigOverrides).toHaveBeenCalledWith({ additionalDirs: ['/tmp'] });
      expect(text).toContain('/tmp');
    });

    it('rejects nonexistent directory', async () => {
      const text = await getText((await tryInterceptCommand('/add-dir /nonexistent-abc-xyz', makeCtx()))!);
      expect(text).toContain('not found');
    });

    it('prevents duplicate add', async () => {
      const setConfigOverrides = vi.fn();
      const ctx = makeCtx({
        setConfigOverrides,
        getConfigOverrides: vi.fn(() => ({ additionalDirs: ['/tmp'] })),
      });
      const text = await getText((await tryInterceptCommand('/add-dir /tmp', ctx))!);
      expect(setConfigOverrides).not.toHaveBeenCalled();
      expect(text).toContain('already added');
    });
  });

  describe('/plan', () => {
    it('is registered', () => { expect(commandRegistry.has('plan')).toBe(true); });

    it('enables plan mode', async () => {
      const setConfigOverrides = vi.fn();
      await tryInterceptCommand('/plan', makeCtx({ setConfigOverrides }));
      expect(setConfigOverrides).toHaveBeenCalledWith({ permissionMode: 'plan' });
    });

    it('toggles off when already plan', async () => {
      const setConfigOverrides = vi.fn();
      const ctx = makeCtx({
        setConfigOverrides,
        getConfigOverrides: vi.fn(() => ({ permissionMode: 'plan' })),
      });
      await tryInterceptCommand('/plan', ctx);
      expect(setConfigOverrides).toHaveBeenCalledWith({ permissionMode: undefined });
    });
  });

  describe('/fast', () => {
    it('is registered', () => { expect(commandRegistry.has('fast')).toBe(true); });

    it('toggles on by default', async () => {
      const setConfigOverrides = vi.fn();
      await tryInterceptCommand('/fast', makeCtx({ setConfigOverrides }));
      expect(setConfigOverrides).toHaveBeenCalledWith({ fast: true });
    });

    it('enables with "on"', async () => {
      const setConfigOverrides = vi.fn();
      const text = await getText((await tryInterceptCommand('/fast on', makeCtx({ setConfigOverrides })))!);
      expect(setConfigOverrides).toHaveBeenCalledWith({ fast: true });
      expect(text).toContain('enabled');
    });

    it('disables with "off"', async () => {
      const setConfigOverrides = vi.fn();
      const text = await getText((await tryInterceptCommand('/fast off', makeCtx({ setConfigOverrides })))!);
      expect(setConfigOverrides).toHaveBeenCalledWith({ fast: false });
      expect(text).toContain('disabled');
    });

    it('toggles off when already on', async () => {
      const setConfigOverrides = vi.fn();
      const ctx = makeCtx({
        setConfigOverrides,
        getConfigOverrides: vi.fn(() => ({ fast: true })),
      });
      await tryInterceptCommand('/fast', ctx);
      expect(setConfigOverrides).toHaveBeenCalledWith({ fast: false });
    });
  });
});

// ============================================================================
// Utility handlers
// ============================================================================
describe('utility handlers', () => {
  describe('/diff', () => {
    it('is registered', () => { expect(commandRegistry.has('diff')).toBe(true); });

    it('runs git diff in a git repo', async () => {
      // openclaw-bridge is a git repo, so /diff should succeed
      const ctx = makeCtx({ projectDir: '/home/ayaz/openclaw-bridge' });
      const stream = await tryInterceptCommand('/diff', ctx);
      expect(stream).not.toBeNull();
      const text = await getText(stream!);
      // Should return either diff output or "No changes"
      expect(text.length).toBeGreaterThan(0);
    });

    it('passes args to git diff', async () => {
      const ctx = makeCtx({ projectDir: '/home/ayaz/openclaw-bridge' });
      const stream = await tryInterceptCommand('/diff --stat', ctx);
      const text = await getText(stream!);
      expect(text.length).toBeGreaterThan(0);
    });

    it('handles non-git directory', async () => {
      const ctx = makeCtx({ projectDir: '/tmp' });
      const stream = await tryInterceptCommand('/diff', ctx);
      const text = await getText(stream!);
      expect(text.toLowerCase()).toContain('not a git repository');
    });
  });

  describe('/doctor', () => {
    it('is registered', () => { expect(commandRegistry.has('doctor')).toBe(true); });

    it('returns terminal-only message', async () => {
      const text = await getText((await tryInterceptCommand('/doctor', makeCtx()))!);
      expect(text).toContain('interactive terminal');
    });
  });

  describe('/compact', () => {
    it('is registered', () => { expect(commandRegistry.has('compact')).toBe(true); });

    it('returns noop message with guidance', async () => {
      const stream = await tryInterceptCommand('/compact', makeCtx());
      expect(stream).not.toBeNull();
      const text = await getText(stream!);
      expect(text).toContain('interactive mode');
      expect(text).toContain('natural language');
    });
  });
});

// ============================================================================
// Fallthrough: unknown commands pass to CC
// ============================================================================
describe('fallthrough', () => {
  it('/gsd:health is not intercepted', async () => {
    expect(await tryInterceptCommand('/gsd:health', makeCtx())).toBeNull();
  });

  it('/unknown-command is not intercepted', async () => {
    expect(await tryInterceptCommand('/totally-unknown', makeCtx())).toBeNull();
  });

  it('regular text is not intercepted', async () => {
    expect(await tryInterceptCommand('hello world', makeCtx())).toBeNull();
  });
});
