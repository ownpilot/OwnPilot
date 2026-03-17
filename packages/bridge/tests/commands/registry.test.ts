import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StreamChunk } from '../../src/types.ts';
import type { CommandDefinition, CommandContext } from '../../src/commands/types.ts';

// Import the modules under test AFTER potential mocks
import { commandRegistry, syntheticStream, tryInterceptCommand } from '../../src/commands/registry.ts';

// Helper: collect all chunks from an async generator
async function collectStream(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

// Helper: build a minimal CommandContext with no-op service callbacks
function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    conversationId: 'test-conv-id',
    projectDir: '/tmp/test-project',
    sessionInfo: null,
    setConfigOverrides: () => {},
    getConfigOverrides: () => ({}),
    terminate: () => {},
    setDisplayName: () => {},
    getDisplayName: () => null,
    listDiskSessions: () => [],
    getSessionJsonlPath: () => null,
    ...overrides,
  };
}

describe('CommandRegistry', () => {
  // We need to be careful: commandRegistry is a singleton shared across tests.
  // Info handlers are registered via import side effects in index.ts.
  // For registry unit tests, we test the registry mechanics directly.

  describe('register + get', () => {
    it('registers and retrieves a command', () => {
      const def: CommandDefinition = {
        name: 'test-reg-get',
        description: 'test command',
        category: 'info',
        handler: async () => ({ handled: true, response: 'ok' }),
      };
      commandRegistry.register(def);
      expect(commandRegistry.get('test-reg-get')).toBe(def);
    });

    it('returns undefined for unregistered command', () => {
      expect(commandRegistry.get('nonexistent-cmd-xyz')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for registered command', () => {
      commandRegistry.register({
        name: 'test-has-true',
        description: 'test',
        category: 'info',
        handler: async () => ({ handled: true }),
      });
      expect(commandRegistry.has('test-has-true')).toBe(true);
    });

    it('returns false for unregistered command', () => {
      expect(commandRegistry.has('nonexistent-cmd-abc')).toBe(false);
    });
  });

  describe('case-insensitive lookup', () => {
    it('registers lowercase, retrieves with uppercase', () => {
      commandRegistry.register({
        name: 'test-case',
        description: 'test',
        category: 'info',
        handler: async () => ({ handled: true }),
      });
      expect(commandRegistry.get('TEST-CASE')).toBeDefined();
      expect(commandRegistry.has('Test-Case')).toBe(true);
    });
  });

  describe('getAll', () => {
    it('returns all registered commands sorted alphabetically', () => {
      const all = commandRegistry.getAll();
      expect(all.length).toBeGreaterThan(0);
      // Verify sorted
      for (let i = 1; i < all.length; i++) {
        expect(all[i].name.localeCompare(all[i - 1].name)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('overwrite on duplicate', () => {
    it('overwrites existing command with same name', () => {
      const handler1 = vi.fn(async () => ({ handled: true, response: 'first' }));
      const handler2 = vi.fn(async () => ({ handled: true, response: 'second' }));

      commandRegistry.register({
        name: 'test-overwrite',
        description: 'first version',
        category: 'info',
        handler: handler1,
      });
      commandRegistry.register({
        name: 'test-overwrite',
        description: 'second version',
        category: 'info',
        handler: handler2,
      });

      const def = commandRegistry.get('test-overwrite');
      expect(def?.description).toBe('second version');
    });
  });
});

describe('syntheticStream', () => {
  it('yields text chunk then done chunk', async () => {
    const chunks = await collectStream(syntheticStream('hello world'));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', text: 'hello world' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('yields empty text for empty string', async () => {
    const chunks = await collectStream(syntheticStream(''));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ type: 'text', text: '' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('preserves multiline text', async () => {
    const text = 'line1\nline2\nline3';
    const chunks = await collectStream(syntheticStream(text));
    expect(chunks[0]).toEqual({ type: 'text', text });
  });
});

describe('tryInterceptCommand', () => {
  // Register test-only commands for these tests
  beforeEach(() => {
    commandRegistry.register({
      name: 'test-handled',
      description: 'always handled',
      category: 'info',
      handler: async () => ({ handled: true, response: 'test response' }),
    });

    commandRegistry.register({
      name: 'test-not-handled',
      description: 'always declines',
      category: 'delegate',
      handler: async () => ({ handled: false }),
    });

    commandRegistry.register({
      name: 'test-throws',
      description: 'always throws',
      category: 'info',
      handler: async () => { throw new Error('handler exploded'); },
    });

    commandRegistry.register({
      name: 'test-with-args',
      description: 'echoes args',
      category: 'info',
      handler: async (args) => ({ handled: true, response: `args: ${args}` }),
    });
  });

  it('returns null for non-command message', async () => {
    const result = await tryInterceptCommand('hello world', makeCtx());
    expect(result).toBeNull();
  });

  it('returns null for unknown command (fallthrough to CC)', async () => {
    const result = await tryInterceptCommand('/gsd:health', makeCtx());
    // gsd:health is not registered in the command registry → pass through
    expect(result).toBeNull();
  });

  it('returns stream for handled command', async () => {
    const result = await tryInterceptCommand('/test-handled', makeCtx());
    expect(result).not.toBeNull();
    const chunks = await collectStream(result!);
    expect(chunks[0]).toEqual({ type: 'text', text: 'test response' });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('returns null for command that declines handling', async () => {
    const result = await tryInterceptCommand('/test-not-handled', makeCtx());
    expect(result).toBeNull();
  });

  it('returns error stream when handler throws', async () => {
    const result = await tryInterceptCommand('/test-throws', makeCtx());
    expect(result).not.toBeNull();
    const chunks = await collectStream(result!);
    expect(chunks[0]).toEqual({
      type: 'text',
      text: 'Error executing /test-throws: handler exploded',
    });
    expect(chunks[1]).toEqual({ type: 'done' });
  });

  it('passes args to handler', async () => {
    const result = await tryInterceptCommand('/test-with-args foo bar', makeCtx());
    expect(result).not.toBeNull();
    const chunks = await collectStream(result!);
    expect(chunks[0]).toEqual({ type: 'text', text: 'args: foo bar' });
  });

  it('passes context to handler', async () => {
    const ctxSpy = vi.fn(async (_args: string, _ctx: CommandContext) => ({
      handled: true,
      response: 'ok',
    }));

    commandRegistry.register({
      name: 'test-ctx-pass',
      description: 'captures context',
      category: 'info',
      handler: ctxSpy,
    });

    const ctx = makeCtx({ conversationId: 'ctx-test-123', projectDir: '/my/project' });
    await tryInterceptCommand('/test-ctx-pass', ctx);

    expect(ctxSpy).toHaveBeenCalledWith('', ctx);
  });

  it('handles mid-message slash as non-command', async () => {
    const result = await tryInterceptCommand('please /help me', makeCtx());
    expect(result).toBeNull();
  });

  it('is case-insensitive for command lookup', async () => {
    const result = await tryInterceptCommand('/TEST-HANDLED', makeCtx());
    expect(result).not.toBeNull();
  });
});

// -------------------------------------------------------------------------
// Info handler smoke tests (verify registration worked)
// -------------------------------------------------------------------------
describe('info handlers (smoke)', () => {
  // Import index.ts to trigger handler registration
  beforeEach(async () => {
    await import('../../src/commands/index.ts');
  });

  it.each([
    'help', 'status', 'cost', 'context', 'usage', 'config',
    'theme', 'vim', 'login', 'logout',
  ])('/%s is registered', (name) => {
    expect(commandRegistry.has(name)).toBe(true);
  });

  it('/help returns command list', async () => {
    const result = await tryInterceptCommand('/help', makeCtx());
    expect(result).not.toBeNull();
    const chunks = await collectStream(result!);
    const text = chunks.find(c => c.type === 'text');
    expect(text).toBeDefined();
    expect((text as { type: 'text'; text: string }).text).toContain('Available bridge commands');
    expect((text as { type: 'text'; text: string }).text).toContain('/help');
  });

  it('/status returns "No active session" when no session', async () => {
    const result = await tryInterceptCommand('/status', makeCtx());
    expect(result).not.toBeNull();
    const chunks = await collectStream(result!);
    expect((chunks[0] as { type: 'text'; text: string }).text).toContain('No active session');
  });

  it('/status returns session info when session exists', async () => {
    const ctx = makeCtx({
      sessionInfo: {
        conversationId: 'test-conv',
        sessionId: 'abc-123',
        processAlive: false,
        lastActivity: new Date('2026-03-01T12:00:00Z'),
        projectDir: '/home/test',
        tokensUsed: 1500,
        budgetUsed: 0.25,
        pendingApproval: null,
      },
    });
    const result = await tryInterceptCommand('/status', ctx);
    const chunks = await collectStream(result!);
    const text = (chunks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('abc-123');
    expect(text).toContain('/home/test');
    expect(text).toContain('1,500');
  });

  it('/cost returns cost data', async () => {
    const ctx = makeCtx({
      sessionInfo: {
        conversationId: 'test-conv',
        sessionId: 'abc-123',
        processAlive: false,
        lastActivity: new Date(),
        projectDir: '/tmp',
        tokensUsed: 5000,
        budgetUsed: 1.23,
        pendingApproval: null,
      },
    });
    const result = await tryInterceptCommand('/cost', ctx);
    const chunks = await collectStream(result!);
    const text = (chunks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('5,000');
    expect(text).toContain('$1.23');
  });

  it('/theme returns noop message', async () => {
    const result = await tryInterceptCommand('/theme', makeCtx());
    const chunks = await collectStream(result!);
    const text = (chunks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('interactive terminal');
  });
});
