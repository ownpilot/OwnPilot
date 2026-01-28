/**
 * Request Tracing System
 *
 * Tracks all operations during a request for debugging and observability:
 * - Tool calls (name, args, result, duration)
 * - Database operations
 * - File operations
 * - Memory operations
 * - API calls
 * - Errors
 */

import { AsyncLocalStorage } from 'async_hooks';

// =============================================================================
// Types
// =============================================================================

export type TraceEventType =
  | 'tool_call'
  | 'tool_result'
  | 'db_read'
  | 'db_write'
  | 'file_read'
  | 'file_write'
  | 'memory_add'
  | 'memory_recall'
  | 'goal_update'
  | 'trigger_fire'
  | 'api_call'
  | 'model_call'
  | 'autonomy_check'
  | 'error'
  | 'info';

export interface TraceEvent {
  /** Event type */
  type: TraceEventType;
  /** Event name/description */
  name: string;
  /** Timestamp */
  timestamp: number;
  /** Duration in ms (for completed operations) */
  duration?: number;
  /** Event details */
  details?: Record<string, unknown>;
  /** Success/failure */
  success?: boolean;
  /** Error message if failed */
  error?: string;
  /** Category for grouping */
  category?: string;
}

export interface TraceContext {
  /** Request ID */
  requestId: string;
  /** User ID */
  userId?: string;
  /** Start time */
  startTime: number;
  /** Events */
  events: TraceEvent[];
  /** Is tracing enabled */
  enabled: boolean;
}

export interface TraceSummary {
  /** Request ID */
  requestId: string;
  /** Total duration */
  totalDuration: number;
  /** Event counts by type */
  eventCounts: Record<string, number>;
  /** Tool calls made */
  toolCalls: Array<{
    name: string;
    duration?: number;
    success: boolean;
    error?: string;
    arguments?: Record<string, unknown>;
    result?: string;
  }>;
  /** Database operations */
  dbOperations: Array<{
    type: 'read' | 'write';
    table?: string;
    count?: number;
  }>;
  /** Memory operations */
  memoryOps: Array<{
    type: 'add' | 'recall' | 'update';
    count?: number;
  }>;
  /** Files accessed */
  fileOps: Array<{
    type: 'read' | 'write';
    path?: string;
  }>;
  /** Model calls */
  modelCalls: Array<{
    provider?: string;
    model?: string;
    tokens?: number;
    duration?: number;
  }>;
  /** Autonomy checks */
  autonomyChecks: Array<{
    tool: string;
    approved: boolean;
    reason?: string;
  }>;
  /** Triggers fired */
  triggersFired: string[];
  /** Errors */
  errors: string[];
  /** All events (for detailed view) */
  events: TraceEvent[];
}

// =============================================================================
// Async Local Storage for Request Context
// =============================================================================

const traceStorage = new AsyncLocalStorage<TraceContext>();

// Global flag for enabling tracing
let globalTracingEnabled = true;

/**
 * Enable or disable global tracing
 */
export function setGlobalTracing(enabled: boolean): void {
  globalTracingEnabled = enabled;
}

/**
 * Check if tracing is enabled
 */
export function isTracingEnabled(): boolean {
  const ctx = traceStorage.getStore();
  return globalTracingEnabled && (ctx?.enabled ?? false);
}

// =============================================================================
// Trace Context Management
// =============================================================================

/**
 * Create a new trace context
 */
export function createTraceContext(requestId: string, userId?: string): TraceContext {
  return {
    requestId,
    userId,
    startTime: Date.now(),
    events: [],
    enabled: globalTracingEnabled,
  };
}

/**
 * Run a function with trace context
 */
export function withTraceContext<T>(
  context: TraceContext,
  fn: () => T
): T {
  return traceStorage.run(context, fn);
}

/**
 * Run an async function with trace context
 */
export async function withTraceContextAsync<T>(
  context: TraceContext,
  fn: () => Promise<T>
): Promise<T> {
  return traceStorage.run(context, fn);
}

/**
 * Get current trace context
 */
export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

// =============================================================================
// Trace Event Recording
// =============================================================================

/**
 * Add an event to the current trace
 */
export function traceEvent(event: Omit<TraceEvent, 'timestamp'>): void {
  const ctx = traceStorage.getStore();
  if (!ctx?.enabled) return;

  ctx.events.push({
    ...event,
    timestamp: Date.now(),
  });
}

/**
 * Trace a tool call start
 */
export function traceToolCallStart(name: string, args?: Record<string, unknown>): number {
  const startTime = Date.now();
  traceEvent({
    type: 'tool_call',
    name,
    details: { args },
    category: 'tool',
  });
  return startTime;
}

/**
 * Trace a tool call result
 */
export function traceToolCallEnd(
  name: string,
  startTime: number,
  success: boolean,
  result?: unknown,
  error?: string
): void {
  traceEvent({
    type: 'tool_result',
    name,
    duration: Date.now() - startTime,
    success,
    error,
    details: { result: typeof result === 'string' ? result.substring(0, 200) : result },
    category: 'tool',
  });
}

/**
 * Trace a database read
 */
export function traceDbRead(table: string, query?: string, count?: number): void {
  traceEvent({
    type: 'db_read',
    name: `Read from ${table}`,
    details: { table, query, count },
    category: 'database',
  });
}

/**
 * Trace a database write
 */
export function traceDbWrite(table: string, operation: string, count?: number): void {
  traceEvent({
    type: 'db_write',
    name: `${operation} in ${table}`,
    details: { table, operation, count },
    category: 'database',
  });
}

/**
 * Trace a memory operation
 */
export function traceMemoryOp(
  type: 'add' | 'recall' | 'update' | 'delete',
  details?: Record<string, unknown>
): void {
  traceEvent({
    type: type === 'recall' ? 'memory_recall' : 'memory_add',
    name: `Memory ${type}`,
    details,
    category: 'memory',
  });
}

/**
 * Trace a file operation
 */
export function traceFileOp(
  type: 'read' | 'write' | 'delete',
  path: string,
  size?: number
): void {
  traceEvent({
    type: type === 'read' ? 'file_read' : 'file_write',
    name: `File ${type}: ${path}`,
    details: { path, size },
    category: 'file',
  });
}

/**
 * Trace a model call
 */
export function traceModelCall(
  provider: string,
  model: string,
  startTime: number,
  tokens?: { input: number; output: number },
  error?: string
): void {
  traceEvent({
    type: 'model_call',
    name: `${provider}/${model}`,
    duration: Date.now() - startTime,
    success: !error,
    error,
    details: { provider, model, tokens },
    category: 'model',
  });
}

/**
 * Trace an autonomy check
 */
export function traceAutonomyCheck(
  toolName: string,
  approved: boolean,
  reason?: string
): void {
  traceEvent({
    type: 'autonomy_check',
    name: `Autonomy check: ${toolName}`,
    success: approved,
    details: { tool: toolName, approved, reason },
    category: 'autonomy',
  });
}

/**
 * Trace a trigger fire
 */
export function traceTriggerFire(triggerId: string, triggerName?: string): void {
  traceEvent({
    type: 'trigger_fire',
    name: `Trigger: ${triggerName ?? triggerId}`,
    details: { triggerId, triggerName },
    category: 'trigger',
  });
}

/**
 * Trace an error
 */
export function traceError(message: string, details?: Record<string, unknown>): void {
  traceEvent({
    type: 'error',
    name: message,
    success: false,
    error: message,
    details,
    category: 'error',
  });
}

/**
 * Trace an info message
 */
export function traceInfo(message: string, details?: Record<string, unknown>): void {
  traceEvent({
    type: 'info',
    name: message,
    details,
    category: 'info',
  });
}

// =============================================================================
// Trace Summary Generation
// =============================================================================

/**
 * Generate a summary from the current trace context
 */
export function getTraceSummary(): TraceSummary | null {
  const ctx = traceStorage.getStore();
  if (!ctx) return null;

  const now = Date.now();
  const events = ctx.events;

  // Count events by type
  const eventCounts: Record<string, number> = {};
  for (const event of events) {
    eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
  }

  // Extract tool calls - merge tool_call (start with args) and tool_result (end with result)
  const toolCallStarts = events.filter((e) => e.type === 'tool_call');
  const toolCallResults = events.filter((e) => e.type === 'tool_result');

  // Build a map of tool name -> arguments from tool_call events
  const argsMap = new Map<string, Record<string, unknown>>();
  for (const e of toolCallStarts) {
    if (e.details?.args) {
      argsMap.set(e.name, e.details.args as Record<string, unknown>);
    }
  }

  const toolCalls = toolCallResults.map((e) => ({
    name: e.name,
    duration: e.duration,
    success: e.success ?? true,
    error: e.error,
    arguments: argsMap.get(e.name),
    result: e.details?.result as string | undefined,
  }));

  // Extract DB operations
  const dbOperations = events
    .filter((e) => e.type === 'db_read' || e.type === 'db_write')
    .map((e) => ({
      type: (e.type === 'db_read' ? 'read' : 'write') as 'read' | 'write',
      table: e.details?.table as string | undefined,
      count: e.details?.count as number | undefined,
    }));

  // Extract memory operations
  const memoryOps = events
    .filter((e) => e.type === 'memory_add' || e.type === 'memory_recall')
    .map((e) => ({
      type: (e.name.includes('recall') ? 'recall' : e.name.includes('add') ? 'add' : 'update') as
        | 'add'
        | 'recall'
        | 'update',
      count: e.details?.count as number | undefined,
    }));

  // Extract file operations
  const fileOps = events
    .filter((e) => e.type === 'file_read' || e.type === 'file_write')
    .map((e) => ({
      type: (e.type === 'file_read' ? 'read' : 'write') as 'read' | 'write',
      path: e.details?.path as string | undefined,
    }));

  // Extract model calls
  const modelCalls = events
    .filter((e) => e.type === 'model_call')
    .map((e) => ({
      provider: e.details?.provider as string | undefined,
      model: e.details?.model as string | undefined,
      tokens: e.details?.tokens
        ? ((e.details.tokens as { input: number; output: number }).input +
            (e.details.tokens as { input: number; output: number }).output)
        : undefined,
      duration: e.duration,
    }));

  // Extract autonomy checks
  const autonomyChecks = events
    .filter((e) => e.type === 'autonomy_check')
    .map((e) => ({
      tool: e.details?.tool as string,
      approved: e.details?.approved as boolean,
      reason: e.details?.reason as string | undefined,
    }));

  // Extract triggers
  const triggersFired = events
    .filter((e) => e.type === 'trigger_fire')
    .map((e) => e.details?.triggerName as string ?? e.details?.triggerId as string);

  // Extract errors
  const errors = events.filter((e) => e.type === 'error').map((e) => e.error ?? e.name);

  return {
    requestId: ctx.requestId,
    totalDuration: now - ctx.startTime,
    eventCounts,
    toolCalls,
    dbOperations,
    memoryOps,
    fileOps,
    modelCalls,
    autonomyChecks,
    triggersFired,
    errors,
    events,
  };
}

/**
 * Format trace summary for display
 */
export function formatTraceSummary(summary: TraceSummary): string {
  const lines: string[] = [];

  lines.push(`📊 Request Trace [${summary.requestId}]`);
  lines.push(`⏱️ Total: ${summary.totalDuration}ms`);
  lines.push('');

  // Tool calls
  if (summary.toolCalls.length > 0) {
    lines.push('🔧 Tool Calls:');
    for (const tc of summary.toolCalls) {
      const status = tc.success ? '✅' : '❌';
      const duration = tc.duration ? ` (${tc.duration}ms)` : '';
      lines.push(`   ${status} ${tc.name}${duration}`);
      if (tc.error) {
        lines.push(`      Error: ${tc.error}`);
      }
    }
    lines.push('');
  }

  // Model calls
  if (summary.modelCalls.length > 0) {
    lines.push('🤖 Model Calls:');
    for (const mc of summary.modelCalls) {
      const tokens = mc.tokens ? ` [${mc.tokens} tokens]` : '';
      const duration = mc.duration ? ` (${mc.duration}ms)` : '';
      lines.push(`   ${mc.provider}/${mc.model}${tokens}${duration}`);
    }
    lines.push('');
  }

  // Autonomy checks
  if (summary.autonomyChecks.length > 0) {
    lines.push('🛡️ Autonomy Checks:');
    for (const ac of summary.autonomyChecks) {
      const status = ac.approved ? '✅' : '🚫';
      lines.push(`   ${status} ${ac.tool}${ac.reason ? `: ${ac.reason}` : ''}`);
    }
    lines.push('');
  }

  // Database operations
  if (summary.dbOperations.length > 0) {
    const reads = summary.dbOperations.filter((o) => o.type === 'read').length;
    const writes = summary.dbOperations.filter((o) => o.type === 'write').length;
    lines.push(`💾 Database: ${reads} reads, ${writes} writes`);
    lines.push('');
  }

  // Memory operations
  if (summary.memoryOps.length > 0) {
    const adds = summary.memoryOps.filter((o) => o.type === 'add').length;
    const recalls = summary.memoryOps.filter((o) => o.type === 'recall').length;
    lines.push(`🧠 Memory: ${adds} adds, ${recalls} recalls`);
    lines.push('');
  }

  // File operations
  if (summary.fileOps.length > 0) {
    lines.push('📁 Files:');
    for (const fo of summary.fileOps) {
      lines.push(`   ${fo.type === 'write' ? '✏️' : '📖'} ${fo.path}`);
    }
    lines.push('');
  }

  // Triggers
  if (summary.triggersFired.length > 0) {
    lines.push(`⚡ Triggers: ${summary.triggersFired.join(', ')}`);
    lines.push('');
  }

  // Errors
  if (summary.errors.length > 0) {
    lines.push('❌ Errors:');
    for (const err of summary.errors) {
      lines.push(`   ${err}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// =============================================================================
// Middleware Helper
// =============================================================================

/**
 * Create tracing middleware context
 */
export function createTracingMiddleware() {
  return {
    /**
     * Start tracing for a request
     */
    start(requestId: string, userId?: string): TraceContext {
      const ctx = createTraceContext(requestId, userId);
      return ctx;
    },

    /**
     * Get summary and cleanup
     */
    finish(): TraceSummary | null {
      return getTraceSummary();
    },
  };
}
