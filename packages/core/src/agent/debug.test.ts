/**
 * Tests for debug logging — DebugLogStorage, log functions, builder functions, getDebugInfo
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  debugLog,
  logRequest,
  logResponse,
  logToolCall,
  logToolResult,
  logRetry,
  logError,
  logSandboxExecution,
  buildRequestDebugInfo,
  buildResponseDebugInfo,
  calculatePayloadBreakdown,
  getDebugInfo,
} from './debug.js';
import type {
  RequestDebugInfo,
  ResponseDebugInfo,
  ToolCallDebugInfo,
  ToolResultDebugInfo,
  SandboxExecutionDebugInfo,
} from './debug.js';
import type { Message, ToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal RequestDebugInfo */
function makeRequestInfo(overrides: Partial<RequestDebugInfo> = {}): RequestDebugInfo {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    endpoint: '/v1/chat/completions',
    messages: [{ role: 'user', contentPreview: 'hello', contentLength: 5 }],
    stream: false,
    ...overrides,
  };
}

/** Minimal ResponseDebugInfo */
function makeResponseInfo(overrides: Partial<ResponseDebugInfo> = {}): ResponseDebugInfo {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    status: 'success',
    durationMs: 123,
    ...overrides,
  };
}

/** Minimal ToolCallDebugInfo */
function makeToolCallInfo(overrides: Partial<ToolCallDebugInfo> = {}): ToolCallDebugInfo {
  return {
    id: 'tc-1',
    name: 'read_file',
    arguments: { path: '/tmp/test.txt' },
    approved: true,
    ...overrides,
  };
}

/** Minimal ToolResultDebugInfo */
function makeToolResultInfo(overrides: Partial<ToolResultDebugInfo> = {}): ToolResultDebugInfo {
  return {
    toolCallId: 'tc-1',
    name: 'read_file',
    success: true,
    resultPreview: 'file contents',
    resultLength: 13,
    durationMs: 50,
    ...overrides,
  };
}

/** Minimal SandboxExecutionDebugInfo */
function makeSandboxInfo(
  overrides: Partial<SandboxExecutionDebugInfo> = {}
): SandboxExecutionDebugInfo {
  return {
    tool: 'execute_code',
    language: 'javascript',
    sandboxed: true,
    exitCode: 0,
    durationMs: 200,
    success: true,
    ...overrides,
  };
}

// Store original env so we can restore it
const originalEnv = { ...process.env };

// ---------------------------------------------------------------------------
// DebugLogStorage (via exported debugLog singleton)
// ---------------------------------------------------------------------------

describe('DebugLogStorage', () => {
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    debugLog.setMaxEntries(100);
  });

  // --- enable / disable ---

  it('should be enabled by default', () => {
    expect(debugLog.isEnabled()).toBe(true);
  });

  it('should allow disabling via setEnabled(false)', () => {
    debugLog.setEnabled(false);
    expect(debugLog.isEnabled()).toBe(false);
  });

  it('should allow re-enabling', () => {
    debugLog.setEnabled(false);
    debugLog.setEnabled(true);
    expect(debugLog.isEnabled()).toBe(true);
  });

  // --- add ---

  it('should store entries when enabled', () => {
    debugLog.add({ type: 'request', data: { foo: 1 } });
    expect(debugLog.getAll()).toHaveLength(1);
  });

  it('should not store entries when disabled', () => {
    debugLog.setEnabled(false);
    debugLog.add({ type: 'request', data: {} });
    expect(debugLog.getAll()).toHaveLength(0);
  });

  it('should add timestamp to stored entry', () => {
    debugLog.add({ type: 'error', data: 'boom' });
    const [entry] = debugLog.getAll();
    expect(entry!.timestamp).toBeDefined();
    // ISO string format check
    expect(() => new Date(entry!.timestamp)).not.toThrow();
  });

  it('should preserve type and data fields', () => {
    debugLog.add({
      type: 'tool_call',
      data: { name: 'test' },
      provider: 'anthropic',
      model: 'claude',
    });
    const [entry] = debugLog.getAll();
    expect(entry!.type).toBe('tool_call');
    expect(entry!.data).toEqual({ name: 'test' });
    expect(entry!.provider).toBe('anthropic');
    expect(entry!.model).toBe('claude');
  });

  // --- getAll ---

  it('should return all stored entries', () => {
    debugLog.add({ type: 'request', data: 1 });
    debugLog.add({ type: 'response', data: 2 });
    debugLog.add({ type: 'error', data: 3 });
    expect(debugLog.getAll()).toHaveLength(3);
  });

  it('should return a copy (not the internal array)', () => {
    debugLog.add({ type: 'request', data: {} });
    const all = debugLog.getAll();
    all.pop();
    expect(debugLog.getAll()).toHaveLength(1); // original unchanged
  });

  // --- getRecent ---

  it('should return last n entries', () => {
    for (let i = 0; i < 5; i++) {
      debugLog.add({ type: 'request', data: i });
    }
    const recent = debugLog.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.data as number).toBe(3);
    expect(recent[1]!.data as number).toBe(4);
  });

  it('should return all entries when count exceeds stored', () => {
    debugLog.add({ type: 'request', data: 'a' });
    const recent = debugLog.getRecent(100);
    expect(recent).toHaveLength(1);
  });

  it('should default to 10 when no count given', () => {
    for (let i = 0; i < 15; i++) {
      debugLog.add({ type: 'request', data: i });
    }
    expect(debugLog.getRecent()).toHaveLength(10);
  });

  // --- clear ---

  it('should remove all entries', () => {
    debugLog.add({ type: 'request', data: {} });
    debugLog.add({ type: 'response', data: {} });
    debugLog.clear();
    expect(debugLog.getAll()).toHaveLength(0);
  });

  // --- maxEntries ---

  it('should respect maxEntries limit (evicts oldest)', () => {
    debugLog.setMaxEntries(3);
    for (let i = 0; i < 5; i++) {
      debugLog.add({ type: 'request', data: i });
    }
    const all = debugLog.getAll();
    expect(all).toHaveLength(3);
    expect(all[0]!.data as number).toBe(2); // oldest 0, 1 evicted
    expect(all[2]!.data as number).toBe(4);
  });

  it('should trim existing entries when maxEntries is reduced', () => {
    for (let i = 0; i < 10; i++) {
      debugLog.add({ type: 'request', data: i });
    }
    debugLog.setMaxEntries(3);
    expect(debugLog.getAll()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Log functions — each writes to debugLog and optionally to console
// ---------------------------------------------------------------------------

describe('logRequest', () => {
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Disable console logging for most tests
    process.env.DEBUG_AI_REQUESTS = '';
    process.env.DEBUG_AGENT = '';
    process.env.DEBUG_LLM = '';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, originalEnv);
  });

  it('should add a request entry to debugLog', () => {
    logRequest(makeRequestInfo());
    const entries = debugLog.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe('request');
    expect(entries[0]!.provider).toBe('openai');
    expect(entries[0]!.model).toBe('gpt-4o');
  });

  it('should store the full info as data', () => {
    const info = makeRequestInfo({ maxTokens: 2048, temperature: 0.7 });
    logRequest(info);
    const [entry] = debugLog.getAll();
    expect(entry!.data).toEqual(info);
  });

  it('should log to console when DEBUG_AI_REQUESTS=true', () => {
    process.env.DEBUG_AI_REQUESTS = 'true';
    logRequest(makeRequestInfo());
    expect(console.log).toHaveBeenCalled();
  });

  it('should not log to console when no debug env is set', () => {
    logRequest(makeRequestInfo());
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('logResponse', () => {
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.DEBUG_AI_REQUESTS = '';
    process.env.DEBUG_AGENT = '';
    process.env.DEBUG_LLM = '';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, originalEnv);
  });

  it('should add a response entry', () => {
    logResponse(makeResponseInfo());
    const [entry] = debugLog.getAll();
    expect(entry!.type).toBe('response');
    expect(entry!.duration).toBe(123);
  });

  it('should log to console when DEBUG_AGENT=true', () => {
    process.env.DEBUG_AGENT = 'true';
    logResponse(makeResponseInfo());
    expect(console.log).toHaveBeenCalled();
  });

  it('should handle error responses', () => {
    logResponse(makeResponseInfo({ status: 'error', error: 'timeout' }));
    const [entry] = debugLog.getAll();
    expect((entry!.data as ResponseDebugInfo).status).toBe('error');
  });
});

describe('logToolCall', () => {
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.DEBUG_LLM = '';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, originalEnv);
  });

  it('should add a tool_call entry', () => {
    logToolCall(makeToolCallInfo());
    const [entry] = debugLog.getAll();
    expect(entry!.type).toBe('tool_call');
  });

  it('should store tool call data', () => {
    logToolCall(
      makeToolCallInfo({ name: 'write_file', approved: false, rejectionReason: 'unsafe' })
    );
    const [entry] = debugLog.getAll();
    const data = entry!.data as ToolCallDebugInfo;
    expect(data.name).toBe('write_file');
    expect(data.approved).toBe(false);
    expect(data.rejectionReason).toBe('unsafe');
  });

  it('should log to console when DEBUG_LLM=true', () => {
    process.env.DEBUG_LLM = 'true';
    logToolCall(makeToolCallInfo());
    expect(console.log).toHaveBeenCalled();
  });
});

describe('logToolResult', () => {
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, originalEnv);
  });

  it('should add a tool_result entry with duration', () => {
    logToolResult(makeToolResultInfo({ durationMs: 77 }));
    const [entry] = debugLog.getAll();
    expect(entry!.type).toBe('tool_result');
    expect(entry!.duration).toBe(77);
  });

  it('should store success and error fields', () => {
    logToolResult(makeToolResultInfo({ success: false, error: 'file not found' }));
    const [entry] = debugLog.getAll();
    const data = entry!.data as ToolResultDebugInfo;
    expect(data.success).toBe(false);
    expect(data.error).toBe('file not found');
  });
});

describe('logRetry', () => {
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, originalEnv);
  });

  it('should add a retry entry', () => {
    logRetry(1, 3, new Error('timeout'), 1000);
    const [entry] = debugLog.getAll();
    expect(entry!.type).toBe('retry');
  });

  it('should store attempt, maxRetries, error message, delayMs', () => {
    logRetry(2, 5, new Error('ECONNRESET'), 2000);
    const [entry] = debugLog.getAll();
    const data = entry!.data as {
      attempt: number;
      maxRetries: number;
      error: string;
      delayMs: number;
    };
    expect(data.attempt).toBe(2);
    expect(data.maxRetries).toBe(5);
    expect(data.error).toBe('ECONNRESET');
    expect(data.delayMs).toBe(2000);
  });

  it('should handle non-Error values (strings)', () => {
    logRetry(1, 3, 'string-error', 500);
    const [entry] = debugLog.getAll();
    const data = entry!.data as { error: string };
    expect(data.error).toBe('string-error');
  });

  it('should log to console in development', () => {
    process.env.NODE_ENV = 'development';
    logRetry(1, 3, new Error('oops'), 100);
    expect(console.log).toHaveBeenCalled();
  });
});

describe('logError', () => {
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, originalEnv);
  });

  it('should add an error entry', () => {
    logError('anthropic', new Error('bad request'));
    const [entry] = debugLog.getAll();
    expect(entry!.type).toBe('error');
    expect(entry!.provider).toBe('anthropic');
  });

  it('should include error message and stack', () => {
    const error = new Error('fail');
    logError('openai', error);
    const [entry] = debugLog.getAll();
    const data = entry!.data as {
      error: string;
      stack: string | undefined;
      context: string | undefined;
    };
    expect(data.error).toBe('fail');
    expect(data.stack).toBeDefined();
  });

  it('should include optional context', () => {
    logError('google', new Error('oops'), 'during completion');
    const [entry] = debugLog.getAll();
    const data = entry!.data as { context: string };
    expect(data.context).toBe('during completion');
  });

  it('should handle non-Error values', () => {
    logError('test', 'raw string error');
    const [entry] = debugLog.getAll();
    const data = entry!.data as { error: string; stack: undefined };
    expect(data.error).toBe('raw string error');
    expect(data.stack).toBeUndefined();
  });
});

describe('logSandboxExecution', () => {
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, originalEnv);
  });

  it('should add a sandbox_execution entry', () => {
    logSandboxExecution(makeSandboxInfo());
    const [entry] = debugLog.getAll();
    expect(entry!.type).toBe('sandbox_execution');
    expect(entry!.duration).toBe(200);
  });

  it('should store full sandbox info as data', () => {
    const info = makeSandboxInfo({
      language: 'python',
      sandboxed: false,
      exitCode: 1,
      success: false,
      error: 'syntax error',
      timedOut: true,
    });
    logSandboxExecution(info);
    const [entry] = debugLog.getAll();
    expect(entry!.data).toEqual(info);
  });

  it('should log to console when DEBUG_AI_REQUESTS=true', () => {
    process.env.DEBUG_AI_REQUESTS = 'true';
    logSandboxExecution(makeSandboxInfo());
    expect(console.log).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Builder functions
// ---------------------------------------------------------------------------

describe('buildRequestDebugInfo', () => {
  it('should build request info from messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello there' },
    ];
    const info = buildRequestDebugInfo('anthropic', 'claude-3-opus', '/v1/messages', messages);

    expect(info.provider).toBe('anthropic');
    expect(info.model).toBe('claude-3-opus');
    expect(info.endpoint).toBe('/v1/messages');
    expect(info.messages).toHaveLength(2);
    expect(info.messages[0]!.role).toBe('system');
    expect(info.messages[0]!.contentLength).toBe(15); // 'You are helpful'
    expect(info.messages[1]!.contentPreview).toBe('Hello there');
    expect(info.stream).toBe(false);
  });

  it('should handle multipart content (non-string)', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [{ type: 'text' as const, text: 'Describe this image' }],
      },
    ];
    const info = buildRequestDebugInfo('openai', 'gpt-4o', '/v1/chat', messages);
    expect(info.messages[0]!.contentPreview).toBe('[multipart content]');
    expect(info.messages[0]!.contentLength).toBeGreaterThan(0);
  });

  it('should map tool names', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'web_search',
        description: 'Search web',
        parameters: { type: 'object', properties: {} },
      },
    ];
    const info = buildRequestDebugInfo('openai', 'gpt-4o', '/v1/chat', [], tools);
    expect(info.tools).toEqual(['read_file', 'web_search']);
  });

  it('should include maxTokens, temperature, and stream', () => {
    const info = buildRequestDebugInfo(
      'openai',
      'gpt-4o',
      '/v1/chat',
      [],
      undefined,
      4096,
      0.5,
      true
    );
    expect(info.maxTokens).toBe(4096);
    expect(info.temperature).toBe(0.5);
    expect(info.stream).toBe(true);
  });

  it('should truncate long content previews', () => {
    const longContent = 'A'.repeat(500);
    const messages: Message[] = [{ role: 'user', content: longContent }];
    const info = buildRequestDebugInfo('openai', 'gpt-4o', '/v1/chat', messages);
    // truncate() limits to 100 chars for request content
    expect(info.messages[0]!.contentPreview.length).toBeLessThan(longContent.length);
    expect(info.messages[0]!.contentLength).toBe(500);
  });
});

describe('buildResponseDebugInfo', () => {
  it('should build success response info', () => {
    const info = buildResponseDebugInfo('openai', 'gpt-4o', 150, {
      content: 'Hello!',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    expect(info.provider).toBe('openai');
    expect(info.model).toBe('gpt-4o');
    expect(info.status).toBe('success');
    expect(info.durationMs).toBe(150);
    expect(info.contentPreview).toBe('Hello!');
    expect(info.contentLength).toBe(6);
    expect(info.finishReason).toBe('stop');
    expect(info.usage!.totalTokens).toBe(15);
  });

  it('should build error response info', () => {
    const info = buildResponseDebugInfo('anthropic', 'claude', 500, {
      error: 'rate limited',
    });
    expect(info.status).toBe('error');
    expect(info.error).toBe('rate limited');
  });

  it('should map tool calls', () => {
    const info = buildResponseDebugInfo('openai', 'gpt-4o', 100, {
      toolCalls: [{ id: 'call_123', name: 'read_file', arguments: '{"path":"/tmp"}' }],
    });
    expect(info.toolCalls).toHaveLength(1);
    expect(info.toolCalls![0]!.id).toBe('call_123');
    expect(info.toolCalls![0]!.name).toBe('read_file');
  });

  it('should not include rawResponse unless DEBUG_RAW_RESPONSE=true', () => {
    process.env.DEBUG_RAW_RESPONSE = '';
    const info = buildResponseDebugInfo('openai', 'gpt-4o', 100, {
      rawResponse: { big: 'object' },
    });
    expect(info.rawResponse).toBeUndefined();
  });

  it('should include rawResponse when DEBUG_RAW_RESPONSE=true', () => {
    const prevVal = process.env.DEBUG_RAW_RESPONSE;
    process.env.DEBUG_RAW_RESPONSE = 'true';
    const info = buildResponseDebugInfo('openai', 'gpt-4o', 100, {
      rawResponse: { big: 'object' },
    });
    expect(info.rawResponse).toEqual({ big: 'object' });
    process.env.DEBUG_RAW_RESPONSE = prevVal;
  });
});

describe('calculatePayloadBreakdown', () => {
  it('should calculate total chars', () => {
    const body = {
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    };
    const result = calculatePayloadBreakdown(body);
    expect(result!.totalChars).toBe(JSON.stringify(body).length);
  });

  it('should estimate tokens as totalChars / 4', () => {
    const body = { messages: [], tools: [] };
    const result = calculatePayloadBreakdown(body);
    expect(result!.estimatedTokens).toBe(Math.ceil(result!.totalChars / 4));
  });

  it('should extract system prompt chars', () => {
    const body = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
      tools: [],
    };
    const result = calculatePayloadBreakdown(body);
    expect(result!.systemPromptChars).toBe('You are helpful.'.length);
  });

  it('should count tools', () => {
    const body = {
      messages: [],
      tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    };
    const result = calculatePayloadBreakdown(body);
    expect(result!.toolCount).toBe(3);
  });

  it('should calculate per-tool average chars', () => {
    const body = {
      messages: [],
      tools: [{ name: 'read_file' }, { name: 'write_file' }],
    };
    const result = calculatePayloadBreakdown(body);
    expect(result!.perToolAvgChars).toBe(Math.round(result!.toolsChars / 2));
  });

  it('should return 0 perToolAvgChars when no tools', () => {
    const body = { messages: [], tools: [] };
    const result = calculatePayloadBreakdown(body);
    expect(result!.perToolAvgChars).toBe(0);
  });

  it('should handle missing messages/tools keys', () => {
    const result = calculatePayloadBreakdown({});
    expect(result!.messagesChars).toBe(JSON.stringify([]).length); // "[]"
    expect(result!.toolCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getDebugInfo
// ---------------------------------------------------------------------------

describe('getDebugInfo', () => {
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    debugLog.setMaxEntries(100);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, originalEnv);
  });

  it('should return enabled status', () => {
    const info = getDebugInfo();
    expect(info.enabled).toBe(true);

    debugLog.setEnabled(false);
    const info2 = getDebugInfo();
    expect(info2.enabled).toBe(false);
  });

  it('should return recent entries', () => {
    logRequest(makeRequestInfo());
    logResponse(makeResponseInfo());
    const info = getDebugInfo();
    expect(info.entries).toHaveLength(2);
  });

  it('should return summary with counts per type', () => {
    logRequest(makeRequestInfo());
    logRequest(makeRequestInfo());
    logResponse(makeResponseInfo());
    logToolCall(makeToolCallInfo());
    logToolResult(makeToolResultInfo());
    logRetry(1, 3, new Error('err'), 100);
    logError('test', new Error('boom'));
    logSandboxExecution(makeSandboxInfo());

    const info = getDebugInfo();
    expect(info.summary.requests).toBe(2);
    expect(info.summary.responses).toBe(1);
    expect(info.summary.toolCalls).toBe(1);
    expect(info.summary.errors).toBe(1);
    expect(info.summary.retries).toBe(1);
    expect(info.summary.sandboxExecutions).toBe(1);
  });

  it('should return zeros when empty', () => {
    const info = getDebugInfo();
    expect(info.summary.requests).toBe(0);
    expect(info.summary.responses).toBe(0);
    expect(info.summary.toolCalls).toBe(0);
    expect(info.summary.errors).toBe(0);
    expect(info.summary.retries).toBe(0);
    expect(info.summary.sandboxExecutions).toBe(0);
    expect(info.entries).toHaveLength(0);
  });

  it('should limit to 50 recent entries', () => {
    for (let i = 0; i < 60; i++) {
      debugLog.add({ type: 'request', data: i });
    }
    const info = getDebugInfo();
    expect(info.entries).toHaveLength(50);
  });
});

// ---------------------------------------------------------------------------
// Environment gating — shouldLogToConsole()
// ---------------------------------------------------------------------------

describe('environment-gated console logging', () => {
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Reset all debug flags
    process.env.DEBUG_AI_REQUESTS = '';
    process.env.DEBUG_AGENT = '';
    process.env.DEBUG_LLM = '';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, originalEnv);
  });

  it('should log when DEBUG_AI_REQUESTS=true', () => {
    process.env.DEBUG_AI_REQUESTS = 'true';
    logRequest(makeRequestInfo());
    expect(console.log).toHaveBeenCalled();
  });

  it('should log when DEBUG_AGENT=true', () => {
    process.env.DEBUG_AGENT = 'true';
    logResponse(makeResponseInfo());
    expect(console.log).toHaveBeenCalled();
  });

  it('should log when DEBUG_LLM=true', () => {
    process.env.DEBUG_LLM = 'true';
    logToolCall(makeToolCallInfo());
    expect(console.log).toHaveBeenCalled();
  });

  it('should log when NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';
    logError('test', new Error('test'));
    expect(console.log).toHaveBeenCalled();
  });

  it('should NOT log when no debug flag is set and NODE_ENV is not development', () => {
    process.env.DEBUG_AI_REQUESTS = '';
    process.env.DEBUG_AGENT = '';
    process.env.DEBUG_LLM = '';
    process.env.NODE_ENV = 'production';
    logRequest(makeRequestInfo());
    logResponse(makeResponseInfo());
    logToolCall(makeToolCallInfo());
    logToolResult(makeToolResultInfo());
    logRetry(1, 3, 'err', 100);
    logError('test', new Error('test'));
    logSandboxExecution(makeSandboxInfo());
    expect(console.log).not.toHaveBeenCalled();
  });

  it('should NOT log when env values are falsy strings', () => {
    process.env.DEBUG_AI_REQUESTS = 'false';
    process.env.NODE_ENV = 'production';
    logRequest(makeRequestInfo());
    expect(console.log).not.toHaveBeenCalled();
  });
});

// Console output branch coverage

describe('console output branches', () => {
  const origEnv2 = { ...process.env };
  beforeEach(() => {
    debugLog.clear();
    debugLog.setEnabled(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.DEBUG_AI_REQUESTS = 'true';
    process.env.DEBUG_AGENT = '';
    process.env.DEBUG_LLM = '';
    process.env.NODE_ENV = 'test';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, origEnv2);
  });

  it('logRequest logs tools list', () => {
    logRequest(makeRequestInfo({ tools: ['read_file', 'write_file'], maxTokens: 4096, temperature: 0.7 }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('Tools');
    expect(calls).toContain('read_file');
  });

  it('logRequest truncates tools list when more than 10', () => {
    const tools = Array.from({ length: 15 }, (_, i) => 'tool_' + i);
    logRequest(makeRequestInfo({ tools }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('...');
  });

  it('logRequest logs payload breakdown', () => {
    logRequest(makeRequestInfo({
      payload: { totalChars: 5000, estimatedTokens: 1250, systemPromptChars: 500, messagesChars: 3000, toolsChars: 1500, toolCount: 10, perToolAvgChars: 150 },
    }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('PAYLOAD BREAKDOWN');
    expect(calls).toContain('System Prompt');
  });

  it('logRequest logs messages with role and preview', () => {
    logRequest(makeRequestInfo({
      messages: [
        { role: 'system', contentPreview: 'You are helpful', contentLength: 15 },
        { role: 'user', contentPreview: 'Hello', contentLength: 5 },
      ],
    }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('SYSTEM');
    expect(calls).toContain('USER');
  });

  it('logResponse logs success with content and tool calls', () => {
    logResponse(makeResponseInfo({
      status: 'success',
      contentPreview: 'Hello',
      contentLength: 5,
      toolCalls: [{ id: 'call_abc12345', name: 'read_file', argumentsPreview: '{}' }],
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('Tool Calls');
    expect(calls).toContain('read_file');
    expect(calls).toContain('Tokens');
  });

  it('logResponse logs error response details', () => {
    logResponse(makeResponseInfo({ status: 'error', error: 'rate limited' }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('ERROR');
    expect(calls).toContain('rate limited');
  });

  it('logResponse logs without usage or content', () => {
    logResponse(makeResponseInfo({ status: 'success', finishReason: 'stop' }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('stop');
  });

  it('logToolCall logs rejected call with reason', () => {
    logToolCall(makeToolCallInfo({ approved: false, rejectionReason: 'unsafe operation' }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('REJECTED');
    expect(calls).toContain('unsafe operation');
  });

  it('logToolResult logs error info', () => {
    logToolResult(makeToolResultInfo({ success: false, error: 'file not found' }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('file not found');
  });

  it('logRetry logs retry details to console', () => {
    logRetry(2, 5, new Error('timeout'), 2000);
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('RETRY');
    expect(calls).toContain('timeout');
  });

  it('logError logs with context and stack', () => {
    const err = new Error('bad request');
    logError('openai', err, 'during completion');
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('Context');
    expect(calls).toContain('during completion');
    expect(calls).toContain('Stack');
  });

  it('logError logs non-Error without stack', () => {
    logError('test', 'string error');
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('string error');
  });

  it('logError logs without context', () => {
    logError('test', new Error('oops'));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('oops');
  });

  it('logSandboxExecution logs all sandbox fields including timedOut and docker', () => {
    logSandboxExecution(makeSandboxInfo({
      language: 'python',
      sandboxed: false,
      dockerImage: 'python:3.11-slim',
      command: 'python script.py',
      codePreview: 'print(42)',
      exitCode: 1,
      success: false,
      error: 'syntax error',
      timedOut: true,
    }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('INSECURE');
    expect(calls).toContain('TIMED OUT');
    expect(calls).toContain('syntax error');
    expect(calls).toContain('Docker Image');
    expect(calls).toContain('Command');
    expect(calls).toContain('Code');
  });

  it('logSandboxExecution logs shell language', () => {
    logSandboxExecution(makeSandboxInfo({ language: 'shell', sandboxed: true }));
    const calls = (console.log as any).mock.calls.flat().join(' ');
    expect(calls).toContain('SANDBOX');
    expect(calls).toContain('SHELL');
  });

  it('logResponse handles toolCall with empty id', () => {
    logResponse(makeResponseInfo({
      status: 'success',
      toolCalls: [{ id: '', name: '', argumentsPreview: '{}' }],
    }));
    expect(console.log).toHaveBeenCalled();
  });
});
