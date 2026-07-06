/**
 * Chat Store — Types & State Interfaces
 *
 * Separated from ChatProvider to break the 1132-line monolith into
 * focused, reviewable modules. Public API surfaces are re-exported
 * from index.ts and the original useChatStore.tsx barrel.
 */

import type {
  Message,
  MessageAttachment,
  SessionInfo,
} from '../../types';
import type { ApprovalRequest } from '../../api';
import type { AutoCompactPromptState } from '../useAutoCompact';
import type { SessionTab } from '../useChatSessions';

// ============================================================================
// Progress Events
// ============================================================================

export interface ProgressEvent {
  type: 'status' | 'tool_start' | 'tool_end' | 'tool_blocked';
  message?: string;
  tool?: {
    id: string;
    name: string;
    arguments?: Record<string, unknown>;
    reason?: string;
  };
  toolCall?: {
    id: string;
    name: string;
  };
  reason?: string;
  result?: {
    success: boolean;
    preview: string;
    durationMs: number;
    sandboxed?: boolean;
    executionMode?: 'docker' | 'local' | 'auto';
  };
  data?: Record<string, unknown>;
  timestamp: string;
}

const PROGRESS_EVENT_TYPES = new Set<ProgressEvent['type']>([
  'status',
  'tool_start',
  'tool_end',
  'tool_blocked',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProgressEventType(value: string): value is ProgressEvent['type'] {
  return PROGRESS_EVENT_TYPES.has(value as ProgressEvent['type']);
}

function toProgressTool(value: unknown): ProgressEvent['tool'] | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return undefined;
  }
  return {
    id: value.id,
    name: value.name,
    ...(isRecord(value.arguments) ? { arguments: value.arguments } : {}),
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
  };
}

function toProgressToolCall(value: unknown): ProgressEvent['toolCall'] | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return undefined;
  }
  return { id: value.id, name: value.name };
}

function toProgressResult(value: unknown): ProgressEvent['result'] | undefined {
  if (
    !isRecord(value) ||
    typeof value.success !== 'boolean' ||
    typeof value.preview !== 'string' ||
    typeof value.durationMs !== 'number'
  ) {
    return undefined;
  }

  return {
    success: value.success,
    preview: value.preview,
    durationMs: value.durationMs,
    ...(typeof value.sandboxed === 'boolean' ? { sandboxed: value.sandboxed } : {}),
    ...(value.executionMode === 'docker' ||
    value.executionMode === 'local' ||
    value.executionMode === 'auto'
      ? { executionMode: value.executionMode }
      : {}),
  };
}

export function parseProgressEvent(data: {
  type: string;
  [key: string]: unknown;
}): ProgressEvent | null {
  if (!isProgressEventType(data.type)) {
    return null;
  }

  return {
    type: data.type,
    ...(typeof data.message === 'string' ? { message: data.message } : {}),
    ...(toProgressTool(data.tool) ? { tool: toProgressTool(data.tool) } : {}),
    ...(toProgressToolCall(data.toolCall) ? { toolCall: toProgressToolCall(data.toolCall) } : {}),
    ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
    ...(toProgressResult(data.result) ? { result: toProgressResult(data.result) } : {}),
    ...(isRecord(data.data) ? { data: data.data } : {}),
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
  };
}

// ============================================================================
// Chat State
// ============================================================================

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  lastFailedMessage: string | null;
  lastFailedRequest: FailedChatRequest | null;
  provider: string;
  model: string;
  agentId: string | null;
  workspaceId: string | null;
  streamingContent: string;
  progressEvents: ProgressEvent[];
  suggestions: Array<{ title: string; detail: string }>;
  extractedMemories: Array<{ type: string; content: string; importance?: number }>;
  pendingApproval: ApprovalRequest | null;
  sessionId: string | null;
  sessionInfo: SessionInfo | null;
  isThinking: boolean;
  thinkingContent: string;
  thinkingConfig: {
    type: 'enabled' | 'adaptive';
    budgetTokens?: number;
    effort?: 'low' | 'medium' | 'high' | 'max';
  } | null;
  autoCompactPrompt: AutoCompactPromptState | null;
  isCompacting: boolean;
}

/** Serialized snapshot of a conversation's UI state (stored when switching away) */
export interface ChatSessionSnapshot {
  messages: Message[];
  sessionId: string | null;
  sessionInfo: SessionInfo | null;
  isLoading: boolean;
  error: string | null;
  lastFailedMessage: string | null;
  lastFailedRequest: FailedChatRequest | null;
  streamingContent: string;
  thinkingContent: string;
  isThinking: boolean;
  progressEvents: ProgressEvent[];
  suggestions: Array<{ title: string; detail: string }>;
  extractedMemories: Array<{ type: string; content: string; importance?: number }>;
  pendingApproval: ApprovalRequest | null;
}

export interface FailedChatRequest {
  content: string;
  directTools?: string[];
  imageAttachments?: MessageAttachment[];
}

// ============================================================================
// ChatStore — Public API
// ============================================================================

export interface ChatStore extends ChatState {
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setAgentId: (agentId: string | null) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
  sendMessage: (
    content: string,
    directTools?: string[],
    imageAttachments?: MessageAttachment[]
  ) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  clearMessages: () => void;
  loadConversation: (id: string, messages: Message[]) => void;
  cancelRequest: () => void;
  clearSuggestions: () => void;
  acceptMemory: (index: number) => void;
  rejectMemory: (index: number) => void;
  resolveApproval: (approved: boolean) => void;
  setThinkingConfig: (config: ChatState['thinkingConfig']) => void;
  compactSession: (keepRecentMessages?: number) => Promise<{
    compacted: boolean;
    removedMessages: number;
    savedTokens: number;
    reason?: string;
    summary?: string;
  }>;
  refreshSessionInfo: () => Promise<void>;
  dismissAutoCompactPrompt: () => void;
  disableAutoCompactPrompt: () => void;
  autoCompactDisabled: boolean;
  lastCompactionSummary: string | null;
  clearLastCompactionSummary: () => void;
  activeSessionId: string;
  sessionTabs: SessionTab[];
  createSession: () => string;
  switchSession: (id: string) => void;
  closeSession: (id: string) => void;
}
