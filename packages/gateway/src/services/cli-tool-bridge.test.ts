/**
 * CLI Tool Bridge Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./log.js', () => ({
  getLog: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  buildToolPromptSection,
  formatToolResults,
  parseToolCalls,
  injectToolsIntoMessages,
  appendToolResults,
  runToolBridgeLoop,
} from './cli-tool-bridge.js';
import type { ToolDefinition, Message, ToolResult } from '@ownpilot/core';
import { ToolRegistry } from '@ownpilot/core';

// =============================================================================
// Test Data
// =============================================================================

const SAMPLE_TOOLS: ToolDefinition[] = [
  {
    name: 'core.search_web',
    description: 'Search the web for information',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
  {
    name: 'core.add_memory',
    description: 'Save something to memory',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content to save' },
        category: { type: 'string', enum: ['fact', 'preference', 'note'] },
      },
      required: ['content'],
    },
  },
];

// =============================================================================
// buildToolPromptSection
// =============================================================================

describe('buildToolPromptSection', () => {
  it('should return empty string for no tools', () => {
    expect(buildToolPromptSection([])).toBe('');
  });

  it('should include tool names and descriptions', () => {
    const section = buildToolPromptSection(SAMPLE_TOOLS);
    expect(section).toContain('core.search_web');
    expect(section).toContain('Search the web for information');
    expect(section).toContain('core.add_memory');
    expect(section).toContain('Save something to memory');
  });

  it('should include parameter details', () => {
    const section = buildToolPromptSection(SAMPLE_TOOLS);
    expect(section).toContain('query: string (required)');
    expect(section).toContain('limit: number (optional)');
    expect(section).toContain('category: string [fact, preference, note]');
  });

  it('should include tool_call format instructions', () => {
    const section = buildToolPromptSection(SAMPLE_TOOLS);
    expect(section).toContain('<tool_call>');
    expect(section).toContain('</tool_call>');
    expect(section).toContain('Available Tools');
  });

  it('should include workspace guidance when workspaceDir is provided', () => {
    const section = buildToolPromptSection(SAMPLE_TOOLS, '/home/test/.ownpilot/workspace');
    expect(section).toContain('/home/test/.ownpilot/workspace');
    expect(section).toContain('AGENTS.md');
    expect(section).toContain('.mcp.json');
    expect(section).toContain('Never call OwnPilot HTTP endpoints directly');
  });
});

// =============================================================================
// parseToolCalls
// =============================================================================

describe('parseToolCalls', () => {
  it('should parse a single tool call', () => {
    const output = `Let me search for that.
<tool_call>
{"name": "core.search_web", "arguments": {"query": "weather today"}}
</tool_call>`;

    const { toolCalls, cleanContent } = parseToolCalls(output);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('core.search_web');
    expect(toolCalls[0]!.arguments).toEqual({ query: 'weather today' });
    expect(cleanContent).toBe('Let me search for that.');
  });

  it('should parse multiple tool calls', () => {
    const output = `I'll search and save.
<tool_call>
{"name": "core.search_web", "arguments": {"query": "test"}}
</tool_call>
<tool_call>
{"name": "core.add_memory", "arguments": {"content": "important fact"}}
</tool_call>`;

    const { toolCalls, cleanContent } = parseToolCalls(output);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]!.name).toBe('core.search_web');
    expect(toolCalls[1]!.name).toBe('core.add_memory');
    expect(cleanContent).toContain("I'll search and save.");
  });

  it('should return empty array when no tool calls', () => {
    const { toolCalls, cleanContent } = parseToolCalls('Just a normal response.');
    expect(toolCalls).toHaveLength(0);
    expect(cleanContent).toBe('Just a normal response.');
  });

  it('should handle malformed JSON gracefully', () => {
    const output = `<tool_call>
{bad json here}
</tool_call>
Valid text.`;

    const { toolCalls, cleanContent } = parseToolCalls(output);
    expect(toolCalls).toHaveLength(0);
    expect(cleanContent).toContain('Valid text.');
  });

  it('should handle tool calls without arguments', () => {
    const output = `<tool_call>
{"name": "core.list_items"}
</tool_call>`;

    const { toolCalls } = parseToolCalls(output);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe('core.list_items');
    expect(toolCalls[0]!.arguments).toEqual({});
  });
});

// =============================================================================
// formatToolResults
// =============================================================================

describe('formatToolResults', () => {
  it('should return empty string for no results', () => {
    expect(formatToolResults([])).toBe('');
  });

  it('should format successful result', () => {
    const results: ToolResult[] = [
      { toolCallId: 'tc_1', content: 'Found 3 results', isError: false },
    ];
    const formatted = formatToolResults(results);
    expect(formatted).toContain('<tool_result>');
    expect(formatted).toContain('tc_1');
    expect(formatted).toContain('Found 3 results');
    expect(formatted).not.toContain('status="error"');
  });

  it('should format error result with status', () => {
    const results: ToolResult[] = [{ toolCallId: 'tc_2', content: 'Network error', isError: true }];
    const formatted = formatToolResults(results);
    expect(formatted).toContain('status="error"');
    expect(formatted).toContain('Network error');
  });

  it('should format multiple results', () => {
    const results: ToolResult[] = [
      { toolCallId: 'tc_1', content: 'Result 1' },
      { toolCallId: 'tc_2', content: 'Result 2' },
    ];
    const formatted = formatToolResults(results);
    expect(formatted).toContain('tc_1');
    expect(formatted).toContain('tc_2');
  });
});

// =============================================================================
// injectToolsIntoMessages
// =============================================================================

describe('injectToolsIntoMessages', () => {
  it('should append tools to existing system message', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ];
    const result = injectToolsIntoMessages(messages, SAMPLE_TOOLS);
    expect(result).toHaveLength(2);
    const systemMsg = result[0]!;
    expect(typeof systemMsg.content).toBe('string');
    expect(systemMsg.content as string).toContain('You are helpful.');
    expect(systemMsg.content as string).toContain('core.search_web');
  });

  it('should create system message if none exists', () => {
    const messages: Message[] = [{ role: 'user', content: 'Hello' }];
    const result = injectToolsIntoMessages(messages, SAMPLE_TOOLS);
    expect(result).toHaveLength(2);
    expect(result[0]!.role).toBe('system');
    expect(result[0]!.content as string).toContain('core.search_web');
  });

  it('should return unchanged messages for empty tools', () => {
    const messages: Message[] = [{ role: 'user', content: 'Hello' }];
    const result = injectToolsIntoMessages(messages, []);
    expect(result).toEqual(messages);
  });
});

// =============================================================================
// appendToolResults
// =============================================================================

describe('appendToolResults', () => {
  it('should append assistant response and user results message', () => {
    const messages: Message[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Search for cats' },
    ];
    const results: ToolResult[] = [{ toolCallId: 'tc_1', content: 'Found: cats are cute' }];

    const newMessages = appendToolResults(messages, 'Let me search...', results);
    expect(newMessages).toHaveLength(4);
    expect(newMessages[2]!.role).toBe('assistant');
    expect(newMessages[2]!.content).toBe('Let me search...');
    expect(newMessages[3]!.role).toBe('user');
    expect(newMessages[3]!.content as string).toContain('tool_result');
    expect(newMessages[3]!.content as string).toContain('cats are cute');
  });
});

// =============================================================================
// runToolBridgeLoop
// =============================================================================

describe('runToolBridgeLoop', () => {
  let mockRegistry: ToolRegistry;

  beforeEach(() => {
    mockRegistry = new ToolRegistry();
    // Register a mock tool
    mockRegistry.register(
      {
        name: 'core.search_web',
        description: 'Search',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      async (args) => ({
        content: `Results for: ${args.query}`,
      }),
      'core'
    );
  });

  it('should complete in one round when no tool calls', async () => {
    const completeFn = vi.fn().mockResolvedValue('Hello! I can help you.');

    const result = await runToolBridgeLoop([{ role: 'user', content: 'Hi' }], completeFn, {
      tools: mockRegistry,
      toolDefinitions: SAMPLE_TOOLS,
      conversationId: 'test-conv',
    });

    expect(result.content).toBe('Hello! I can help you.');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.rounds).toBe(1);
    expect(completeFn).toHaveBeenCalledTimes(1);
  });

  it('should execute tool calls and continue', async () => {
    const completeFn = vi
      .fn()
      // Round 1: model calls a tool
      .mockResolvedValueOnce(
        `Let me search.
<tool_call>
{"name": "core.search_web", "arguments": {"query": "cats"}}
</tool_call>`
      )
      // Round 2: model responds with final answer
      .mockResolvedValueOnce('Based on the search, cats are great pets!');

    const result = await runToolBridgeLoop(
      [{ role: 'user', content: 'Tell me about cats' }],
      completeFn,
      {
        tools: mockRegistry,
        toolDefinitions: SAMPLE_TOOLS,
        conversationId: 'test-conv',
      }
    );

    expect(result.content).toBe('Based on the search, cats are great pets!');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe('core.search_web');
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]!.content).toContain('Results for: cats');
    expect(result.rounds).toBe(2);
    expect(completeFn).toHaveBeenCalledTimes(2);
  });

  it('should stop at max rounds', async () => {
    // Always return a tool call
    const completeFn = vi.fn().mockResolvedValue(
      `<tool_call>
{"name": "core.search_web", "arguments": {"query": "loop"}}
</tool_call>`
    );

    const result = await runToolBridgeLoop(
      [{ role: 'user', content: 'Keep searching' }],
      completeFn,
      {
        tools: mockRegistry,
        toolDefinitions: SAMPLE_TOOLS,
        conversationId: 'test-conv',
        maxRounds: 3,
      }
    );

    expect(result.rounds).toBe(3);
    expect(result.toolCalls).toHaveLength(3);
    expect(completeFn).toHaveBeenCalledTimes(3);
  });

  it('should handle multiple tools in one round', async () => {
    // Register a second tool
    mockRegistry.register(
      {
        name: 'core.add_memory',
        description: 'Save memory',
        parameters: {
          type: 'object',
          properties: { content: { type: 'string' } },
          required: ['content'],
        },
      },
      async (args) => ({
        content: `Saved: ${args.content}`,
      }),
      'core'
    );

    const completeFn = vi
      .fn()
      .mockResolvedValueOnce(
        `Let me do both.
<tool_call>
{"name": "core.search_web", "arguments": {"query": "weather"}}
</tool_call>
<tool_call>
{"name": "core.add_memory", "arguments": {"content": "check weather daily"}}
</tool_call>`
      )
      .mockResolvedValueOnce('Done! Weather is sunny and I saved your reminder.');

    const result = await runToolBridgeLoop(
      [{ role: 'user', content: 'Search weather and save a reminder' }],
      completeFn,
      {
        tools: mockRegistry,
        toolDefinitions: SAMPLE_TOOLS,
        conversationId: 'test-conv',
      }
    );

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolResults).toHaveLength(2);
    expect(result.content).toContain('sunny');
    expect(result.rounds).toBe(2);
  });

  it('should pass tool results to second invocation', async () => {
    const completeFn = vi
      .fn()
      .mockResolvedValueOnce(
        `<tool_call>
{"name": "core.search_web", "arguments": {"query": "test"}}
</tool_call>`
      )
      .mockResolvedValueOnce('Final answer.');

    await runToolBridgeLoop([{ role: 'user', content: 'Search' }], completeFn, {
      tools: mockRegistry,
      toolDefinitions: SAMPLE_TOOLS,
      conversationId: 'test-conv',
    });

    // Verify second call received tool results in messages
    const secondCallMessages = completeFn.mock.calls[1]![0] as Message[];
    const lastUserMsg = secondCallMessages[secondCallMessages.length - 1]!;
    expect(lastUserMsg.role).toBe('user');
    expect(lastUserMsg.content as string).toContain('tool_result');
    expect(lastUserMsg.content as string).toContain('Results for: test');
  });

  it('should pass workspace guidance into injected and follow-up messages', async () => {
    const completeFn = vi
      .fn()
      .mockResolvedValueOnce(
        `<tool_call>
{"name": "core.search_web", "arguments": {"query": "test"}}
</tool_call>`
      )
      .mockResolvedValueOnce('Final answer.');

    await runToolBridgeLoop([{ role: 'user', content: 'Search' }], completeFn, {
      tools: mockRegistry,
      toolDefinitions: SAMPLE_TOOLS,
      conversationId: 'test-conv',
      workspaceDir: '/home/test/.ownpilot/workspace',
    });

    const firstCallMessages = completeFn.mock.calls[0]![0] as Message[];
    expect(firstCallMessages[0]!.content as string).toContain('/home/test/.ownpilot/workspace');

    const secondCallMessages = completeFn.mock.calls[1]![0] as Message[];
    const lastUserMsg = secondCallMessages[secondCallMessages.length - 1]!;
    expect(lastUserMsg.content as string).toContain('/home/test/.ownpilot/workspace');
  });

  it('should inject tool definitions into first call messages', async () => {
    const completeFn = vi.fn().mockResolvedValue('No tools needed.');

    await runToolBridgeLoop(
      [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      completeFn,
      {
        tools: mockRegistry,
        toolDefinitions: SAMPLE_TOOLS,
        conversationId: 'test-conv',
      }
    );

    // Verify tool definitions were injected
    const firstCallMessages = completeFn.mock.calls[0]![0] as Message[];
    const systemMsg = firstCallMessages[0]!;
    expect(systemMsg.role).toBe('system');
    expect(systemMsg.content as string).toContain('core.search_web');
    expect(systemMsg.content as string).toContain('Available Tools');
  });

  it('should handle tool execution errors gracefully', async () => {
    // Register a failing tool
    mockRegistry.register(
      {
        name: 'core.fail_tool',
        description: 'Always fails',
        parameters: { type: 'object', properties: {} },
      },
      async () => {
        throw new Error('Tool crashed!');
      },
      'core'
    );

    const completeFn = vi
      .fn()
      .mockResolvedValueOnce(
        `<tool_call>
{"name": "core.fail_tool", "arguments": {}}
</tool_call>`
      )
      .mockResolvedValueOnce('I see the tool failed. Let me try something else.');

    const result = await runToolBridgeLoop(
      [{ role: 'user', content: 'Do something' }],
      completeFn,
      {
        tools: mockRegistry,
        toolDefinitions: [
          {
            name: 'core.fail_tool',
            description: 'Fails',
            parameters: { type: 'object', properties: {} },
          },
        ],
        conversationId: 'test-conv',
      }
    );

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]!.isError).toBe(true);
    expect(result.content).toContain('try something else');
    expect(result.rounds).toBe(2);
  });

  it('emits round and tool lifecycle callbacks across rounds', async () => {
    const onRoundStart = vi.fn();
    const onToolCallsParsed = vi.fn();
    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();

    const completeFn = vi
      .fn()
      .mockResolvedValueOnce(
        `<tool_call>
{"name": "core.search_web", "arguments": {"query": "cats"}}
</tool_call>`
      )
      .mockResolvedValueOnce('Done.');

    await runToolBridgeLoop([{ role: 'user', content: 'Search cats' }], completeFn, {
      tools: mockRegistry,
      toolDefinitions: SAMPLE_TOOLS,
      conversationId: 'test-conv',
      onRoundStart,
      onToolCallsParsed,
      onToolStart,
      onToolEnd,
    });

    expect(onRoundStart).toHaveBeenNthCalledWith(1, 1);
    expect(onRoundStart).toHaveBeenNthCalledWith(2, 2);
    expect(onToolCallsParsed).toHaveBeenCalledWith(
      [{ name: 'core.search_web', arguments: { query: 'cats' } }],
      1
    );
    expect(onToolStart).toHaveBeenCalledWith(expect.objectContaining({ name: 'core.search_web' }), {
      query: 'cats',
    });
    expect(onToolEnd).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'core.search_web' }),
      expect.objectContaining({ content: expect.stringContaining('Results for: cats') })
    );
  });
});
