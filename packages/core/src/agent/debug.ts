/**
 * Debug Logging for AI Provider Calls
 *
 * Captures detailed request/response data for debugging AI interactions.
 */

import type { Message, ToolCall, ToolDefinition, TokenUsage } from './types.js';
import { getErrorMessage } from '../services/error-utils.js';

/**
 * Debug log entry
 */
export interface DebugLogEntry {
  timestamp: string;
  type:
    | 'request'
    | 'response'
    | 'tool_call'
    | 'tool_result'
    | 'error'
    | 'retry'
    | 'sandbox_execution';
  provider?: string;
  model?: string;
  data: unknown;
  duration?: number;
}

/**
 * Sandbox execution debug info
 */
export interface SandboxExecutionDebugInfo {
  tool: string;
  language: 'javascript' | 'python' | 'shell';
  sandboxed: boolean;
  dockerImage?: string;
  command?: string;
  codePreview?: string;
  exitCode: number | null;
  durationMs: number;
  success: boolean;
  error?: string;
  memoryUsed?: string;
  timedOut?: boolean;
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
  /** Full payload size breakdown (chars) — added post-body-build */
  payload?: {
    totalChars: number;
    estimatedTokens: number;
    systemPromptChars: number;
    messagesChars: number;
    toolsChars: number;
    toolCount: number;
    perToolAvgChars: number;
  };
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
 * Check if verbose debug logging should be enabled
 */
function shouldLogToConsole(): boolean {
  return (
    process.env.DEBUG_AI_REQUESTS === 'true' ||
    process.env.DEBUG_AGENT === 'true' ||
    process.env.DEBUG_LLM === 'true' ||
    process.env.NODE_ENV === 'development'
  );
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
function truncate(str: string | undefined | null, maxLength: number = 200): string {
  if (!str) return '';
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

  if (shouldLogToConsole()) {
    console.log('\n' + '═'.repeat(80));
    console.log(`📤 LLM REQUEST - ${new Date().toISOString()}`);
    console.log('═'.repeat(80));
    console.log(`Provider: ${info.provider}`);
    console.log(`Model: ${info.model}`);
    console.log(`Endpoint: ${info.endpoint}`);
    console.log(
      `MaxTokens: ${info.maxTokens ?? 'default'} | Temperature: ${info.temperature ?? 'default'} | Stream: ${info.stream}`
    );
    console.log('─'.repeat(40));
    console.log(`Messages (${info.messages.length}):`);
    for (let i = 0; i < info.messages.length; i++) {
      const msg = info.messages[i];
      if (!msg) continue;
      console.log(
        `  [${i}] ${msg.role.toUpperCase().padEnd(10)} │ ${truncate(msg.contentPreview, 150)} (${msg.contentLength} chars)`
      );
    }
    if (info.tools?.length) {
      console.log('─'.repeat(40));
      console.log(
        `Tools (${info.tools.length}): ${info.tools.slice(0, 10).join(', ')}${info.tools.length > 10 ? '...' : ''}`
      );
    }
    if (info.payload) {
      console.log('─'.repeat(40));
      console.log(`📊 PAYLOAD BREAKDOWN:`);
      console.log(
        `  Total: ${info.payload.totalChars.toLocaleString()} chars (~${info.payload.estimatedTokens.toLocaleString()} tokens)`
      );
      console.log(`  System Prompt: ${info.payload.systemPromptChars.toLocaleString()} chars`);
      console.log(`  Messages: ${info.payload.messagesChars.toLocaleString()} chars`);
      console.log(
        `  Tools: ${info.payload.toolsChars.toLocaleString()} chars (${info.payload.toolCount} tools, avg ${info.payload.perToolAvgChars} chars/tool)`
      );
    }
    console.log('═'.repeat(80));
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

  if (shouldLogToConsole()) {
    const _statusIcon = info.status === 'success' ? '✓' : '✗';
    const statusColor = info.status === 'success' ? '🟢' : '🔴';

    console.log('\n' + '═'.repeat(80));
    console.log(
      `📥 LLM RESPONSE - ${statusColor} ${info.status.toUpperCase()} - ${info.durationMs}ms`
    );
    console.log('═'.repeat(80));
    console.log(`Provider: ${info.provider} | Model: ${info.model}`);
    console.log(`Finish Reason: ${info.finishReason ?? 'N/A'}`);

    if (info.usage) {
      console.log(
        `Tokens: ${info.usage.promptTokens} in → ${info.usage.completionTokens} out → ${info.usage.totalTokens} total`
      );
    }

    if (info.status === 'success') {
      console.log('─'.repeat(40));
      if (info.contentPreview) {
        console.log(`Content (${info.contentLength ?? 0} chars):`);
        console.log(`  ${truncate(info.contentPreview, 500)}`);
      }
      if (info.toolCalls?.length) {
        console.log('─'.repeat(40));
        console.log(`🔧 Tool Calls (${info.toolCalls.length}):`);
        for (const tc of info.toolCalls) {
          const idSuffix = tc.id ? tc.id.slice(-8) : 'unknown';
          console.log(`  [${idSuffix}] ${tc.name ?? 'unknown'}`);
          console.log(`    Args: ${truncate(tc.argumentsPreview ?? '{}', 200)}`);
        }
      }
    } else {
      console.log('─'.repeat(40));
      console.log(`❌ ERROR: ${info.error}`);
    }
    console.log('═'.repeat(80));
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

  if (shouldLogToConsole()) {
    const statusIcon = info.approved ? '✓' : '✗';
    console.log(`\n🔧 TOOL CALL ${statusIcon} ${info.name}`);
    console.log(`  ID: ${info.id}`);
    console.log(`  Args: ${JSON.stringify(info.arguments)}`);
    if (!info.approved) {
      console.log(`  ❌ REJECTED: ${info.rejectionReason}`);
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

  if (shouldLogToConsole()) {
    const _statusIcon = info.success ? '✓' : '✗';
    const statusColor = info.success ? '🟢' : '🔴';
    console.log(`\n⚡ TOOL RESULT ${statusColor} ${info.name} (${info.durationMs}ms)`);
    console.log(`  ID: ${info.toolCallId}`);
    console.log(`  Result (${info.resultLength} chars): ${truncate(info.resultPreview, 300)}`);
    if (info.error) {
      console.log(`  ❌ Error: ${info.error}`);
    }
  }
}

/**
 * Log a retry attempt
 */
export function logRetry(
  attempt: number,
  maxRetries: number,
  error: unknown,
  delayMs: number
): void {
  debugLog.add({
    type: 'retry',
    data: {
      attempt,
      maxRetries,
      error: getErrorMessage(error),
      delayMs,
    },
  });

  if (shouldLogToConsole()) {
    console.log(`\n🔄 RETRY ${attempt}/${maxRetries} (waiting ${delayMs}ms)`);
    console.log(`  Error: ${getErrorMessage(error)}`);
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
      error: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
      context,
    },
  });

  if (shouldLogToConsole()) {
    console.log('\n' + '!'.repeat(80));
    console.log(`❌ ERROR - ${provider}`);
    console.log('!'.repeat(80));
    if (context) {
      console.log(`Context: ${context}`);
    }
    console.log(`Error: ${getErrorMessage(error)}`);
    if (error instanceof Error && error.stack) {
      console.log(`Stack: ${error.stack.split('\n').slice(1, 4).join('\n')}`);
    }
    console.log('!'.repeat(80));
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
    messages: messages.map((msg) => ({
      role: msg.role,
      contentPreview:
        typeof msg.content === 'string' ? truncate(msg.content, 100) : '[multipart content]',
      contentLength:
        typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length,
    })),
    tools: tools?.map((t) => t.name),
    maxTokens,
    temperature,
    stream,
  };
}

/**
 * Calculate payload size breakdown from the actual API request body.
 * Call this after body is constructed and attach to RequestDebugInfo.
 */
export function calculatePayloadBreakdown(
  body: Record<string, unknown>
): RequestDebugInfo['payload'] {
  const messagesJson = JSON.stringify(body.messages ?? []);
  const toolsJson = JSON.stringify(body.tools ?? []);
  const systemMsg = Array.isArray(body.messages)
    ? (body.messages as Array<{ role?: string; content?: string }>).find((m) => m.role === 'system')
    : undefined;
  const systemPromptChars = systemMsg?.content?.length ?? 0;
  const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
  const totalChars = JSON.stringify(body).length;

  return {
    totalChars,
    estimatedTokens: Math.ceil(totalChars / 4), // rough estimate: ~4 chars/token
    systemPromptChars,
    messagesChars: messagesJson.length,
    toolsChars: toolsJson.length,
    toolCount,
    perToolAvgChars: toolCount > 0 ? Math.round(toolsJson.length / toolCount) : 0,
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
    toolCalls: toolCalls?.map((tc) => ({
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
 * Log a sandbox execution
 */
export function logSandboxExecution(info: SandboxExecutionDebugInfo): void {
  debugLog.add({
    type: 'sandbox_execution',
    data: info,
    duration: info.durationMs,
  });

  if (shouldLogToConsole()) {
    const sandboxIcon = info.sandboxed ? '🐳' : '⚠️';
    const statusIcon = info.success ? '✅' : '❌';
    const langEmoji =
      info.language === 'python' ? '🐍' : info.language === 'javascript' ? '📜' : '💻';

    console.log('\n' + '═'.repeat(80));
    console.log(`${sandboxIcon} SANDBOX EXECUTION - ${langEmoji} ${info.language.toUpperCase()}`);
    console.log('═'.repeat(80));
    console.log(`Tool: ${info.tool}`);
    console.log(`Sandboxed: ${info.sandboxed ? '✅ YES (Docker)' : '❌ NO (INSECURE)'}`);
    if (info.dockerImage) {
      console.log(`Docker Image: ${info.dockerImage}`);
    }
    if (info.command) {
      console.log(`Command: ${truncate(info.command, 100)}`);
    }
    if (info.codePreview) {
      console.log(`Code: ${truncate(info.codePreview, 200)}`);
    }
    console.log('─'.repeat(40));
    console.log(`Status: ${statusIcon} ${info.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Exit Code: ${info.exitCode ?? 'N/A'}`);
    console.log(`Duration: ${info.durationMs}ms`);
    if (info.timedOut) {
      console.log(`⏱️ TIMED OUT`);
    }
    if (info.error) {
      console.log(`Error: ${info.error}`);
    }
    console.log('═'.repeat(80));
  }
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
    sandboxExecutions: number;
  };
} {
  const entries = debugLog.getRecent(50);

  return {
    enabled: debugLog.isEnabled(),
    entries,
    summary: {
      requests: entries.filter((e) => e.type === 'request').length,
      responses: entries.filter((e) => e.type === 'response').length,
      toolCalls: entries.filter((e) => e.type === 'tool_call').length,
      errors: entries.filter((e) => e.type === 'error').length,
      retries: entries.filter((e) => e.type === 'retry').length,
      sandboxExecutions: entries.filter((e) => e.type === 'sandbox_execution').length,
    },
  };
}
