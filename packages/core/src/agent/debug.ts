/**
 * Debug Logging for AI Provider Calls
 *
 * Captures detailed request/response data for debugging AI interactions.
 */

import type { Message, ToolCall, ToolDefinition, TokenUsage } from './types.js';

/**
 * Debug log entry
 */
export interface DebugLogEntry {
  timestamp: string;
  type: 'request' | 'response' | 'tool_call' | 'tool_result' | 'error' | 'retry';
  provider?: string;
  model?: string;
  data: unknown;
  duration?: number;
}

/**
 * Request debug info
 */
export interface RequestDebugInfo {
  provider: string;
  model: string;
  endpoint: string;
  messages: Array<{
    role: string;
    contentPreview: string;
    contentLength: number;
  }>;
  tools?: string[];
  maxTokens?: number;
  temperature?: number;
  stream: boolean;
}

/**
 * Response debug info
 */
export interface ResponseDebugInfo {
  provider: string;
  model: string;
  status: 'success' | 'error';
  contentPreview?: string;
  contentLength?: number;
  toolCalls?: Array<{
    id: string;
    name: string;
    argumentsPreview: string;
  }>;
  finishReason?: string;
  usage?: TokenUsage;
  error?: string;
  rawResponse?: unknown;
  durationMs: number;
}

/**
 * Tool call debug info
 */
export interface ToolCallDebugInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  approved: boolean;
  rejectionReason?: string;
}

/**
 * Tool result debug info
 */
export interface ToolResultDebugInfo {
  toolCallId: string;
  name: string;
  success: boolean;
  resultPreview: string;
  resultLength: number;
  durationMs: number;
  error?: string;
}

/**
 * Debug log storage (in-memory, last N entries)
 */
class DebugLogStorage {
  private entries: DebugLogEntry[] = [];
  private maxEntries: number = 100;
  private enabled: boolean = true;

  setMaxEntries(max: number): void {
    this.maxEntries = max;
    this.trim();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  add(entry: Omit<DebugLogEntry, 'timestamp'>): void {
    if (!this.enabled) return;

    this.entries.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });

    this.trim();
  }

  getAll(): DebugLogEntry[] {
    return [...this.entries];
  }

  getRecent(count: number = 10): DebugLogEntry[] {
    return this.entries.slice(-count);
  }

  clear(): void {
    this.entries = [];
  }

  private trim(): void {
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }
}

// Global debug log instance
export const debugLog = new DebugLogStorage();

/**
 * Truncate string for preview
 */
function truncate(str: string, maxLength: number = 200): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + `... [${str.length - maxLength} more chars]`;
}

/**
 * Log an outgoing request
 */
export function logRequest(info: RequestDebugInfo): void {
  debugLog.add({
    type: 'request',
    provider: info.provider,
    model: info.model,
    data: info,
  });

  if (process.env.DEBUG_AI_REQUESTS === 'true') {
    console.log('\n[DEBUG] AI Request:');
    console.log(`  Provider: ${info.provider}`);
    console.log(`  Model: ${info.model}`);
    console.log(`  Endpoint: ${info.endpoint}`);
    console.log(`  Messages: ${info.messages.length}`);
    for (const msg of info.messages) {
      console.log(`    - ${msg.role}: ${truncate(msg.contentPreview, 100)} (${msg.contentLength} chars)`);
    }
    if (info.tools?.length) {
      console.log(`  Tools: ${info.tools.join(', ')}`);
    }
    console.log(`  MaxTokens: ${info.maxTokens ?? 'default'}`);
    console.log(`  Temperature: ${info.temperature ?? 'default'}`);
    console.log(`  Stream: ${info.stream}`);
  }
}

/**
 * Log an incoming response
 */
export function logResponse(info: ResponseDebugInfo): void {
  debugLog.add({
    type: 'response',
    provider: info.provider,
    model: info.model,
    data: info,
    duration: info.durationMs,
  });

  if (process.env.DEBUG_AI_REQUESTS === 'true') {
    console.log('\n[DEBUG] AI Response:');
    console.log(`  Provider: ${info.provider}`);
    console.log(`  Model: ${info.model}`);
    console.log(`  Status: ${info.status}`);
    console.log(`  Duration: ${info.durationMs}ms`);

    if (info.status === 'success') {
      if (info.contentPreview) {
        console.log(`  Content: ${truncate(info.contentPreview, 200)} (${info.contentLength} chars)`);
      }
      if (info.toolCalls?.length) {
        console.log(`  Tool Calls: ${info.toolCalls.length}`);
        for (const tc of info.toolCalls) {
          console.log(`    - ${tc.name}(${truncate(tc.argumentsPreview, 100)})`);
        }
      }
      console.log(`  Finish Reason: ${info.finishReason}`);
      if (info.usage) {
        console.log(`  Usage: ${info.usage.promptTokens} prompt, ${info.usage.completionTokens} completion, ${info.usage.totalTokens} total`);
      }
    } else {
      console.log(`  Error: ${info.error}`);
    }
  }
}

/**
 * Log a tool call
 */
export function logToolCall(info: ToolCallDebugInfo): void {
  debugLog.add({
    type: 'tool_call',
    data: info,
  });

  if (process.env.DEBUG_AI_REQUESTS === 'true') {
    console.log('\n[DEBUG] Tool Call:');
    console.log(`  ID: ${info.id}`);
    console.log(`  Name: ${info.name}`);
    console.log(`  Arguments: ${JSON.stringify(info.arguments, null, 2)}`);
    console.log(`  Approved: ${info.approved}`);
    if (!info.approved) {
      console.log(`  Rejection Reason: ${info.rejectionReason}`);
    }
  }
}

/**
 * Log a tool result
 */
export function logToolResult(info: ToolResultDebugInfo): void {
  debugLog.add({
    type: 'tool_result',
    data: info,
    duration: info.durationMs,
  });

  if (process.env.DEBUG_AI_REQUESTS === 'true') {
    console.log('\n[DEBUG] Tool Result:');
    console.log(`  Tool Call ID: ${info.toolCallId}`);
    console.log(`  Name: ${info.name}`);
    console.log(`  Success: ${info.success}`);
    console.log(`  Duration: ${info.durationMs}ms`);
    console.log(`  Result: ${truncate(info.resultPreview, 200)} (${info.resultLength} chars)`);
    if (info.error) {
      console.log(`  Error: ${info.error}`);
    }
  }
}

/**
 * Log a retry attempt
 */
export function logRetry(attempt: number, maxRetries: number, error: unknown, delayMs: number): void {
  debugLog.add({
    type: 'retry',
    data: {
      attempt,
      maxRetries,
      error: error instanceof Error ? error.message : String(error),
      delayMs,
    },
  });

  if (process.env.DEBUG_AI_REQUESTS === 'true') {
    console.log('\n[DEBUG] Retry:');
    console.log(`  Attempt: ${attempt}/${maxRetries}`);
    console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`  Delay: ${delayMs}ms`);
  }
}

/**
 * Log an error
 */
export function logError(provider: string, error: unknown, context?: string): void {
  debugLog.add({
    type: 'error',
    provider,
    data: {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context,
    },
  });

  if (process.env.DEBUG_AI_REQUESTS === 'true') {
    console.log('\n[DEBUG] Error:');
    console.log(`  Provider: ${provider}`);
    if (context) {
      console.log(`  Context: ${context}`);
    }
    console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Build request debug info from completion request
 */
export function buildRequestDebugInfo(
  provider: string,
  model: string,
  endpoint: string,
  messages: readonly Message[],
  tools?: readonly ToolDefinition[],
  maxTokens?: number,
  temperature?: number,
  stream: boolean = false
): RequestDebugInfo {
  return {
    provider,
    model,
    endpoint,
    messages: messages.map(msg => ({
      role: msg.role,
      contentPreview: typeof msg.content === 'string'
        ? truncate(msg.content, 100)
        : '[multipart content]',
      contentLength: typeof msg.content === 'string'
        ? msg.content.length
        : JSON.stringify(msg.content).length,
    })),
    tools: tools?.map(t => t.name),
    maxTokens,
    temperature,
    stream,
  };
}

/**
 * Build response debug info
 */
export function buildResponseDebugInfo(
  provider: string,
  model: string,
  durationMs: number,
  options: {
    content?: string;
    toolCalls?: readonly ToolCall[];
    finishReason?: string;
    usage?: TokenUsage;
    error?: string;
    rawResponse?: unknown;
  }
): ResponseDebugInfo {
  const { content, toolCalls, finishReason, usage, error, rawResponse } = options;

  return {
    provider,
    model,
    status: error ? 'error' : 'success',
    contentPreview: content ? truncate(content, 200) : undefined,
    contentLength: content?.length,
    toolCalls: toolCalls?.map(tc => ({
      id: tc.id,
      name: tc.name,
      argumentsPreview: truncate(tc.arguments, 100),
    })),
    finishReason,
    usage,
    error,
    rawResponse: process.env.DEBUG_RAW_RESPONSE === 'true' ? rawResponse : undefined,
    durationMs,
  };
}

/**
 * Get debug log entries for API response
 */
export function getDebugInfo(): {
  enabled: boolean;
  entries: DebugLogEntry[];
  summary: {
    requests: number;
    responses: number;
    toolCalls: number;
    errors: number;
    retries: number;
  };
} {
  const entries = debugLog.getRecent(50);

  return {
    enabled: debugLog.isEnabled(),
    entries,
    summary: {
      requests: entries.filter(e => e.type === 'request').length,
      responses: entries.filter(e => e.type === 'response').length,
      toolCalls: entries.filter(e => e.type === 'tool_call').length,
      errors: entries.filter(e => e.type === 'error').length,
      retries: entries.filter(e => e.type === 'retry').length,
    },
  };
}
