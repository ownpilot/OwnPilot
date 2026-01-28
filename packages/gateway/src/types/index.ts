/**
 * Gateway types
 */

import type { AgentConfig, ToolDefinition } from '@ownpilot/core';

/**
 * API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

/**
 * API error structure
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Response metadata
 */
export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  processingTime?: number;
}

/**
 * Chat request
 */
export interface ChatRequest {
  message: string;
  conversationId?: string;
  agentId?: string;
  stream?: boolean;
  history?: Array<{ role: string; content: string }>;
}

/**
 * Request trace information for debugging
 */
export interface TraceInfo {
  /** Total duration in ms */
  duration: number;
  /** Tool calls made */
  toolCalls: Array<{
    name: string;
    success: boolean;
    duration?: number;
    error?: string;
  }>;
  /** Model/API calls made */
  modelCalls: Array<{
    provider?: string;
    model?: string;
    tokens?: number;
    duration?: number;
  }>;
  /** Autonomy checks performed */
  autonomyChecks: Array<{
    tool: string;
    approved: boolean;
    reason?: string;
  }>;
  /** Database operations */
  dbOperations: {
    reads: number;
    writes: number;
  };
  /** Memory operations */
  memoryOps: {
    adds: number;
    recalls: number;
  };
  /** Triggers that fired */
  triggersFired: string[];
  /** Errors encountered */
  errors: string[];
  /** All trace events */
  events: Array<{
    type: string;
    name: string;
    duration?: number;
    success?: boolean;
  }>;
}

/**
 * Chat response
 */
export interface ChatResponse {
  id: string;
  conversationId: string;
  message: string;
  /** Alias for message - for UI compatibility */
  response?: string;
  /** Model used for this response */
  model?: string;
  toolCalls?: ToolCallResponse[];
  usage?: UsageStats;
  finishReason: string;
  /** Debug trace information */
  trace?: TraceInfo;
}

/**
 * Tool call in response
 */
export interface ToolCallResponse {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

/**
 * Usage statistics
 */
export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Streaming chunk
 */
export interface StreamChunkResponse {
  id: string;
  conversationId: string;
  delta?: string;
  toolCalls?: Partial<ToolCallResponse>[];
  done: boolean;
  finishReason?: string;
  usage?: UsageStats;
}

/**
 * Agent creation request
 */
export interface CreateAgentRequest {
  name: string;
  systemPrompt: string;
  provider: string;
  model?: string;
  tools?: string[];
  maxTurns?: number;
  maxToolCalls?: number;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Agent update request
 */
export interface UpdateAgentRequest {
  name?: string;
  systemPrompt?: string;
  provider?: string;
  model?: string;
  tools?: string[];
  maxTurns?: number;
  maxToolCalls?: number;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Agent info response
 */
export interface AgentInfo {
  id: string;
  name: string;
  provider: string;
  model: string;
  tools: string[];
  createdAt: string;
  updatedAt?: string;
}

/**
 * Agent detail response (with full config)
 */
export interface AgentDetail extends AgentInfo {
  systemPrompt: string;
  config: {
    maxTokens: number;
    temperature: number;
    maxTurns: number;
    maxToolCalls: number;
  };
}

/**
 * Conversation info
 */
export interface ConversationInfo {
  id: string;
  agentId: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tool info response
 */
export interface ToolInfo {
  name: string;
  description: string;
  parameters: ToolDefinition['parameters'];
  category?: string;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  checks: HealthCheck[];
}

/**
 * Individual health check
 */
export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  duration?: number;
}

/**
 * Gateway configuration
 */
export interface GatewayConfig {
  port: number;
  host: string;
  corsOrigins?: string[];
  rateLimit?: RateLimitConfig;
  auth?: AuthConfig;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  /** If true, warn with headers but don't block (soft limit) */
  softLimit?: boolean;
  /** Allow burst of requests up to this amount before limiting */
  burstLimit?: number;
  /** Skip rate limiting entirely (for development) */
  disabled?: boolean;
  /** Paths to exclude from rate limiting */
  excludePaths?: string[];
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  type: 'api-key' | 'jwt' | 'none';
  apiKeys?: string[];
  jwtSecret?: string;
}

/**
 * Request context (available in handlers)
 */
export interface RequestContext {
  requestId: string;
  userId?: string;
  startTime: number;
}
