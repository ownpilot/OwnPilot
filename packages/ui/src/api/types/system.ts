// System, Health, Database, Debug, and Logs types

export interface SandboxStatus {
  dockerAvailable: boolean;
  dockerVersion: string | null;
  codeExecutionEnabled: boolean;
  executionMode?: 'docker' | 'local' | 'auto';
  securityMode: 'strict' | 'relaxed' | 'local' | 'disabled';
}

export interface DatabaseStatus {
  type: 'postgres';
  connected: boolean;
  host?: string;
}

export interface BackupInfo {
  name: string;
  size: number;
  created: string;
}

export interface DatabaseStats {
  database: { size: string; sizeBytes: number };
  tables: { name: string; rowCount: number; size: string }[];
  connections: { active: number; max: number };
  version: string;
}

// ---- Debug / Logs ----

interface DebugLogEntryBase {
  timestamp: string;
  provider?: string;
  model?: string;
  duration?: number;
}

export interface ToolCallData {
  name?: string;
  id?: string;
  approved?: boolean;
  rejectionReason?: string;
  arguments?: Record<string, unknown>;
}

export interface ToolResultData {
  name?: string;
  toolCallId?: string;
  success?: boolean;
  durationMs?: number;
  resultLength?: number;
  result?: string;
  error?: string;
}

export interface DebugErrorData {
  error?: string;
  stack?: string;
  context?: string;
}

export interface RetryData {
  attempt?: number;
  maxRetries?: number;
  delayMs?: number;
  error?: string;
}

export type DebugLogEntry =
  | (DebugLogEntryBase & { type: 'tool_call'; data: ToolCallData })
  | (DebugLogEntryBase & { type: 'tool_result'; data: ToolResultData })
  | (DebugLogEntryBase & { type: 'error'; data: DebugErrorData })
  | (DebugLogEntryBase & { type: 'retry'; data: RetryData })
  | (DebugLogEntryBase & { type: 'request' | 'response'; data: Record<string, unknown> });

export interface DebugInfo {
  enabled: boolean;
  entries: DebugLogEntry[];
  summary: {
    requests: number;
    responses: number;
    toolCalls: number;
    errors: number;
    retries: number;
  };
}

export interface RequestLog {
  id: string;
  type: 'chat' | 'completion' | 'embedding' | 'tool' | 'agent' | 'other';
  conversationId: string | null;
  provider: string | null;
  model: string | null;
  statusCode: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
  createdAt: string;
}

export interface LogDetail extends RequestLog {
  userId: string;
  endpoint: string | null;
  method: string;
  requestBody: Record<string, unknown> | null;
  responseBody: Record<string, unknown> | null;
  totalTokens: number | null;
  errorStack: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface LogStats {
  totalRequests: number;
  errorCount: number;
  successCount: number;
  avgDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: Record<string, number>;
  byType: Record<string, number>;
}
