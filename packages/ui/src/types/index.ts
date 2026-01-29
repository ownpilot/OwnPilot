/**
 * UI types
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
  provider?: string;
  model?: string;
  trace?: TraceInfo;
  isError?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

/**
 * Trace information for debugging and observability
 */
export interface TraceInfo {
  duration: number;
  toolCalls: Array<{
    name: string;
    success: boolean;
    duration?: number;
    error?: string;
    arguments?: Record<string, unknown>;
    result?: string;
  }>;
  modelCalls: Array<{
    provider?: string;
    model?: string;
    tokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    duration?: number;
  }>;
  autonomyChecks: Array<{
    tool: string;
    approved: boolean;
    reason?: string;
  }>;
  dbOperations: {
    reads: number;
    writes: number;
  };
  memoryOps: {
    adds: number;
    recalls: number;
  };
  triggersFired: string[];
  errors: string[];
  events: Array<{
    type: string;
    name: string;
    duration?: number;
    success?: boolean;
  }>;
  // Enhanced debug info
  request?: {
    provider: string;
    model: string;
    endpoint: string;
    messageCount: number;
    tools?: string[];
  };
  response?: {
    status: 'success' | 'error';
    contentLength?: number;
    finishReason?: string;
    rawResponse?: unknown;
  };
  retries?: Array<{
    attempt: number;
    error: string;
    delayMs: number;
  }>;
}

export interface Agent {
  id: string;
  name: string;
  provider: string;
  model: string;
  tools: string[];
  createdAt: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId: string;
    timestamp: string;
    processingTime?: number;
  };
}

export interface ChatResponse {
  id?: string;
  message?: string;
  response: string;
  conversationId: string;
  toolCalls?: ToolCall[];
  model?: string;
  trace?: TraceInfo;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  error?: string;
}
