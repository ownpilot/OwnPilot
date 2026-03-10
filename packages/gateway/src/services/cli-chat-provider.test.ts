/**
 * CLI Chat Provider Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock binary-utils before importing the module
vi.mock('./binary-utils.js', () => ({
  isBinaryInstalled: vi.fn().mockReturnValue(true),
  getBinaryVersion: vi.fn().mockReturnValue('1.0.0'),
  createSanitizedEnv: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
  MAX_OUTPUT_SIZE: 1_048_576,
}));

vi.mock('./log.js', () => ({
  getLog: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock child_process — must use importOriginal to avoid breaking keychain.ts
const mockSpawn = vi.fn();
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args),
  };
});

import {
  CliChatProvider,
  detectCliChatProviders,
  isCliChatProvider,
  getCliBinaryFromProviderId,
  getCliChatProviderDefinition,
  createCliChatProvider,
} from './cli-chat-provider.js';
import { isBinaryInstalled } from './binary-utils.js';
import { platform } from 'node:os';
import { ToolRegistry } from '@ownpilot/core';

const IS_WIN = platform() === 'win32';

// =============================================================================
// Helpers
// =============================================================================

interface MockProcess {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
}

function createMockProcess(stdout: string, exitCode = 0): MockProcess {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const stdoutHandlers: Record<string, (...args: unknown[]) => void> = {};
  const stderrHandlers: Record<string, (...args: unknown[]) => void> = {};

  const proc: MockProcess = {
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    stdout: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        stdoutHandlers[event] = handler;
      }),
    },
    stderr: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        stderrHandlers[event] = handler;
      }),
    },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    kill: vi.fn(),
    killed: false,
  };

  // Simulate async output
  setTimeout(() => {
    if (stdoutHandlers.data) {
      stdoutHandlers.data(Buffer.from(stdout));
    }
    if (handlers.close) {
      handlers.close(exitCode);
    }
  }, 10);

  return proc;
}

// =============================================================================
// Tests
// =============================================================================

describe('CliChatProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isBinaryInstalled).mockReturnValue(true);
  });

  describe('constructor', () => {
    it('should create provider with correct type', () => {
      const provider = new CliChatProvider({ binary: 'claude' });
      expect(provider.type).toBe('anthropic');
    });

    it('should map codex to openai type', () => {
      const provider = new CliChatProvider({ binary: 'codex' });
      expect(provider.type).toBe('openai');
    });

    it('should map gemini to google type', () => {
      const provider = new CliChatProvider({ binary: 'gemini' });
      expect(provider.type).toBe('google');
    });
  });

  describe('isReady', () => {
    it('should return true when binary is installed', () => {
      const provider = new CliChatProvider({ binary: 'claude' });
      expect(provider.isReady()).toBe(true);
    });

    it('should return false when binary is not installed', () => {
      vi.mocked(isBinaryInstalled).mockReturnValue(false);
      const provider = new CliChatProvider({ binary: 'claude' });
      expect(provider.isReady()).toBe(false);
    });
  });

  describe('complete', () => {
    it('should spawn claude with correct args', async () => {
      const claudeResponse = JSON.stringify({
        type: 'result',
        result: 'Hello from Claude CLI',
      });
      mockSpawn.mockReturnValue(createMockProcess(claudeResponse));

      const provider = new CliChatProvider({ binary: 'claude' });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'claude-sonnet-4-6' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello from Claude CLI');
        expect(result.value.model).toBe('claude-sonnet-4-6');
        expect(result.value.finishReason).toBe('stop');
      }

      if (IS_WIN) {
        expect(mockSpawn).toHaveBeenCalledWith(
          expect.stringContaining('"claude"'),
          [],
          expect.objectContaining({ shell: true })
        );
      } else {
        expect(mockSpawn).toHaveBeenCalledWith(
          'claude',
          expect.arrayContaining([
            '-p',
            'Hello',
            '--output-format',
            'json',
            '--dangerously-skip-permissions',
          ]),
          expect.any(Object)
        );
      }
    });

    it('should spawn codex with correct args', async () => {
      const codexResponse = JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: 'Hello from Codex CLI',
      });
      mockSpawn.mockReturnValue(createMockProcess(codexResponse));

      const provider = new CliChatProvider({ binary: 'codex' });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'o4-mini' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello from Codex CLI');
      }

      if (IS_WIN) {
        expect(mockSpawn).toHaveBeenCalledWith(
          expect.stringContaining('"codex"'),
          [],
          expect.objectContaining({ shell: true })
        );
      } else {
        expect(mockSpawn).toHaveBeenCalledWith(
          'codex',
          expect.arrayContaining(['exec', '--json', '--full-auto']),
          expect.any(Object)
        );
      }
    });

    it('should inject shared workspace guidance into codex prompt', async () => {
      const codexResponse = JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: 'Hello from Codex CLI',
      });
      mockSpawn.mockReturnValue(createMockProcess(codexResponse));

      const provider = new CliChatProvider({
        binary: 'codex',
        cwd: '/home/test/.ownpilot/workspace',
      });
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'o4-mini' },
      });

      if (!IS_WIN) {
        const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
        const promptArg = spawnArgs.at(-1) as string;
        expect(promptArg).toContain('/home/test/.ownpilot/workspace');
        expect(promptArg).toContain('CODEX.md');
        expect(promptArg).toContain('.mcp.json');
      }
    });

    it('should parse codex event stream and return only assistant text', async () => {
      const codexResponse =
        '{"type":"thread.started","thread_id":"thread_123"}{"type":"turn.started"}\n' +
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello from Codex event stream"}}\n' +
        '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}';
      mockSpawn.mockReturnValue(createMockProcess(codexResponse));

      const provider = new CliChatProvider({ binary: 'codex' });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'o4-mini' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello from Codex event stream');
      }
    });

    it('should spawn gemini with correct args', async () => {
      const geminiResponse = JSON.stringify({
        response: 'Hello from Gemini CLI',
      });
      mockSpawn.mockReturnValue(createMockProcess(geminiResponse));

      const provider = new CliChatProvider({ binary: 'gemini' });
      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'gemini-2.5-flash' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello from Gemini CLI');
      }

      if (IS_WIN) {
        expect(mockSpawn).toHaveBeenCalledWith(
          expect.stringContaining('"gemini"'),
          [],
          expect.objectContaining({ shell: true })
        );
      } else {
        expect(mockSpawn).toHaveBeenCalledWith(
          'gemini',
          expect.arrayContaining(['-p', 'Hello', '--yolo', '--output-format', 'json']),
          expect.any(Object)
        );
      }
    });

    it('should inject shared workspace guidance into gemini prompt', async () => {
      const geminiResponse = JSON.stringify({
        response: 'Hello from Gemini CLI',
      });
      mockSpawn.mockReturnValue(createMockProcess(geminiResponse));

      const provider = new CliChatProvider({
        binary: 'gemini',
        cwd: '/home/test/.ownpilot/workspace',
      });
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'gemini-2.5-flash' },
      });

      if (!IS_WIN) {
        const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
        const promptIdx = spawnArgs.indexOf('-p');
        expect(spawnArgs[promptIdx + 1]).toContain('/home/test/.ownpilot/workspace');
        expect(spawnArgs[promptIdx + 1]).toContain('GEMINI.md');
        expect(spawnArgs[promptIdx + 1]).toContain('AGENTS.md');
      }
    });

    it('should handle non-zero exit code with stderr', async () => {
      const handlers: Record<string, (...args: unknown[]) => void> = {};
      const stderrHandlers: Record<string, (...args: unknown[]) => void> = {};

      const proc = {
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            stderrHandlers[event] = handler;
          }),
        },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          handlers[event] = handler;
        }),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockReturnValue(proc);

      const provider = new CliChatProvider({ binary: 'claude' });
      const promise = provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'claude-sonnet-4-6' },
      });

      // Simulate error
      setTimeout(() => {
        if (stderrHandlers.data) {
          stderrHandlers.data(Buffer.from('Authentication failed'));
        }
        if (handlers.close) {
          handlers.close(1);
        }
      }, 10);

      const result = await promise;
      expect(result.ok).toBe(false);
    });

    it('should convert multi-turn messages to prompt', async () => {
      const claudeResponse = JSON.stringify({
        type: 'result',
        result: 'The weather is sunny',
      });
      mockSpawn.mockReturnValue(createMockProcess(claudeResponse));

      const provider = new CliChatProvider({ binary: 'claude' });
      await provider.complete({
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'What is the weather?' },
        ],
        model: { model: 'claude-sonnet-4-6' },
      });

      // Verify the prompt includes conversation history
      // On Windows, prompt is sent via stdin; on Unix, it's in the -p arg
      let prompt: string;
      if (IS_WIN) {
        const proc = mockSpawn.mock.results[0].value as MockProcess;
        prompt = proc.stdin.write.mock.calls[0]?.[0] as string;
      } else {
        const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
        const promptIdx = spawnArgs.indexOf('-p');
        prompt = spawnArgs[promptIdx + 1] as string;
      }
      // On Windows, system prompt is inlined into stdin prompt to avoid command-line
      // length limits. On Unix, it is passed via --system-prompt.
      if (IS_WIN) {
        expect(prompt).toContain('<system_prompt>');
        expect(prompt).toContain('You are a helpful assistant.');
      } else {
        const allArgs = mockSpawn.mock.calls[0][1] as string[];
        const sysIdx = allArgs.indexOf('--system-prompt');
        expect(sysIdx).toBeGreaterThan(-1);
        expect(allArgs[sysIdx + 1]).toBe('You are a helpful assistant.');
      }
      // Conversation history and current message are in the prompt
      expect(prompt).toContain('conversation_history');
      expect(prompt).toContain('User: Hello');
      expect(prompt).toContain('Assistant: Hi there!');
      expect(prompt).toContain('What is the weather?');
    });

    it.skip('streams ToolBridge progress across rounds for gemini', async () => {
      const registry = new ToolRegistry();
      registry.register(
        {
          name: 'core.list_tasks',
          description: 'List tasks',
          parameters: { type: 'object', properties: { status: { type: 'string' } } },
        },
        async (args) => ({ content: `tasks for ${String(args.status ?? 'all')}` })
      );

      mockSpawn
        .mockReturnValueOnce(
          createMockProcess(
            '{"type":"ownpilot_tool_intent","calls":[{"name":"core.list_tasks","arguments":{"status":"pending"}}]}'
          )
        )
        .mockReturnValueOnce(
          createMockProcess('{"type":"ownpilot_final_response","content":"Pending tasks loaded."}')
        );

      const provider = new CliChatProvider({
        binary: 'gemini',
        toolBridge: {
          tools: registry,
          toolDefinitions: [
            {
              name: 'core.list_tasks',
              description: 'List tasks',
              parameters: { type: 'object', properties: { status: { type: 'string' } } },
            },
          ],
          conversationId: 'conv-1',
          userId: 'default',
          maxRounds: 3,
        },
      });

      const chunks = [] as Array<{
        content?: string;
        toolCalls?: unknown;
        done: boolean;
        metadata?: Record<string, unknown>;
      }>;
      for await (const chunk of provider.stream({
        messages: [{ role: 'user', content: 'List pending tasks' }],
        model: { model: 'gemini-2.5-flash' },
      })) {
        expect(chunk.ok).toBe(true);
        if (chunk.ok) chunks.push(chunk.value);
      }

      expect(chunks.some((c) => c.metadata?.type === 'tool_bridge_status')).toBe(true);
      expect(chunks.some((c) => c.metadata?.type === 'tool_bridge_progress')).toBe(true);
      expect(chunks.some((c) => Array.isArray(c.toolCalls) && c.toolCalls.length === 1)).toBe(true);
      expect(chunks.at(-1)?.content).toBe('Pending tasks loaded.');
      expect(chunks.at(-1)?.done).toBe(true);
    });
  });

  describe('countTokens', () => {
    it('should approximately count tokens', () => {
      const provider = new CliChatProvider({ binary: 'claude' });
      const count = provider.countTokens([
        { role: 'user', content: 'Hello world' }, // 11 chars -> ~3 tokens
      ]);
      expect(count).toBe(3);
    });
  });

  describe('getModels', () => {
    it('should return default model for claude', async () => {
      const provider = new CliChatProvider({ binary: 'claude' });
      const result = await provider.getModels();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['cli-default']);
      }
    });

    it('should return default model for codex', async () => {
      const provider = new CliChatProvider({ binary: 'codex' });
      const result = await provider.getModels();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['cli-default']);
      }
    });
  });
});

// =============================================================================
// Utility Functions
// =============================================================================

describe('CLI Chat Provider utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectCliChatProviders', () => {
    it('should detect installed providers', () => {
      vi.mocked(isBinaryInstalled).mockReturnValue(true);
      const providers = detectCliChatProviders();
      expect(providers).toHaveLength(3);
      expect(providers.map((p) => p.id)).toEqual(['cli-claude', 'cli-codex', 'cli-gemini']);
      expect(providers.every((p) => p.installed)).toBe(true);
    });

    it('should mark uninstalled providers', () => {
      vi.mocked(isBinaryInstalled).mockReturnValue(false);
      const providers = detectCliChatProviders();
      expect(providers.every((p) => !p.installed)).toBe(true);
    });
  });

  describe('isCliChatProvider', () => {
    it('should return true for CLI provider IDs', () => {
      expect(isCliChatProvider('cli-claude')).toBe(true);
      expect(isCliChatProvider('cli-codex')).toBe(true);
      expect(isCliChatProvider('cli-gemini')).toBe(true);
    });

    it('should return false for non-CLI providers', () => {
      expect(isCliChatProvider('openai')).toBe(false);
      expect(isCliChatProvider('anthropic')).toBe(false);
      expect(isCliChatProvider('google')).toBe(false);
    });
  });

  describe('getCliBinaryFromProviderId', () => {
    it('should return correct binary names', () => {
      expect(getCliBinaryFromProviderId('cli-claude')).toBe('claude');
      expect(getCliBinaryFromProviderId('cli-codex')).toBe('codex');
      expect(getCliBinaryFromProviderId('cli-gemini')).toBe('gemini');
    });

    it('should return null for unknown providers', () => {
      expect(getCliBinaryFromProviderId('openai')).toBeNull();
      expect(getCliBinaryFromProviderId('cli-unknown')).toBeNull();
    });
  });

  describe('getCliChatProviderDefinition', () => {
    it('should return definition for valid provider', () => {
      vi.mocked(isBinaryInstalled).mockReturnValue(true);
      const def = getCliChatProviderDefinition('cli-claude');
      expect(def).not.toBeNull();
      expect(def?.binary).toBe('claude');
      expect(def?.displayName).toBe('Claude (CLI)');
      expect(def?.coreProvider).toBe('anthropic');
    });

    it('should return null for invalid provider', () => {
      expect(getCliChatProviderDefinition('invalid')).toBeNull();
    });
  });

  describe('createCliChatProvider', () => {
    it('should create provider instance', () => {
      const provider = createCliChatProvider({ binary: 'claude' });
      expect(provider).toBeInstanceOf(CliChatProvider);
      expect(provider.type).toBe('anthropic');
    });
  });
});
