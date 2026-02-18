/**
 * Global Chat Store
 *
 * Provides persistent chat state across page navigation.
 * Chat continues in background when navigating away.
 * Supports SSE streaming with progress events.
 */

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { Message, ChatResponse, ApiResponse, SessionInfo } from '../types';
import type { ApprovalRequest } from '../api';
import { executionPermissionsApi, memoriesApi } from '../api';
import { parseSSELine } from '../utils/sse-parser';

// Progress event types from the stream
export interface ProgressEvent {
  type: 'status' | 'tool_start' | 'tool_end';
  message?: string;
  tool?: {
    id: string;
    name: string;
    arguments?: Record<string, unknown>;
  };
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

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  lastFailedMessage: string | null;
  provider: string;
  model: string;
  agentId: string | null;
  workspaceId: string | null;
  streamingContent: string;
  progressEvents: ProgressEvent[];
  /** Follow-up suggestions from the latest AI response */
  suggestions: Array<{ title: string; detail: string }>;
  /** AI-extracted memories pending user acceptance */
  extractedMemories: Array<{ type: string; content: string; importance?: number }>;
  /** Pending approval request from SSE (real-time code execution approval) */
  pendingApproval: ApprovalRequest | null;
  /** Current session ID */
  sessionId: string | null;
  /** Current session context info (tokens, fill %, etc.) */
  sessionInfo: SessionInfo | null;
}

interface ChatStore extends ChatState {
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setAgentId: (agentId: string | null) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
  sendMessage: (content: string, directTools?: string[]) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  clearMessages: () => void;
  cancelRequest: () => void;
  clearSuggestions: () => void;
  acceptMemory: (index: number) => void;
  rejectMemory: (index: number) => void;
  resolveApproval: (approved: boolean) => void;
}

const ChatContext = createContext<ChatStore | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [progressEvents, setProgressEvents] = useState<ProgressEvent[]>([]);
  const [suggestions, setSuggestions] = useState<Array<{ title: string; detail: string }>>([]);
  const [extractedMemories, setExtractedMemories] = useState<Array<{ type: string; content: string; importance?: number }>>([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);

  // AbortController persists across navigation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cancel any ongoing request (also rejects pending approval if any)
  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setStreamingContent('');
      setProgressEvents([]);
    }
    // Reject any pending execution approval so the backend doesn't hang
    if (pendingApproval) {
      executionPermissionsApi.resolveApproval(pendingApproval.approvalId, false).catch(() => {});
      setPendingApproval(null);
    }
  }, [pendingApproval]);

  const clearSuggestions = useCallback(() => setSuggestions([]), []);

  // Ref for auto-accept logic — keeps fresh reference without re-renders
  const extractedMemoriesRef = useRef(extractedMemories);
  extractedMemoriesRef.current = extractedMemories;

  const acceptMemory = useCallback((index: number) => {
    setExtractedMemories(prev => {
      const mem = prev[index];
      if (mem) {
        memoriesApi.create({
          type: mem.type,
          content: mem.content,
          source: 'conversation',
          importance: mem.importance ?? 0.7,
        }).catch(() => {});
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const rejectMemory = useCallback((index: number) => {
    setExtractedMemories(prev => prev.filter((_, i) => i !== index));
  }, []);

  const resolveApproval = useCallback((approved: boolean) => {
    const approval = pendingApproval;
    if (!approval) return;
    setPendingApproval(null);
    executionPermissionsApi.resolveApproval(approval.approvalId, approved).catch(() => {
      // If the resolve call fails, the backend will timeout and auto-reject
    });
  }, [pendingApproval]);

  const sendMessage = useCallback(
    async (content: string, directToolsOrRetry?: string[] | boolean, isRetryArg?: boolean) => {
      // Support both old signature (content, isRetry) and new (content, directTools, isRetry)
      const directTools = Array.isArray(directToolsOrRetry) ? directToolsOrRetry : undefined;
      const isRetry = typeof directToolsOrRetry === 'boolean' ? directToolsOrRetry : (isRetryArg ?? false);
      // Cancel any previous ongoing request before starting a new one
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Auto-accept any remaining memories from previous response
      for (const mem of extractedMemoriesRef.current) {
        memoriesApi.create({
          type: mem.type,
          content: mem.content,
          source: 'conversation',
          importance: mem.importance ?? 0.7,
        }).catch(() => {});
      }

      setError(null);
      setIsLoading(true);
      setStreamingContent('');
      setProgressEvents([]);
      setSuggestions([]);
      setExtractedMemories([]);

      // Get current messages for history (need fresh reference)
      let currentMessages: Message[] = [];
      setMessages((prev) => {
        currentMessages = prev;

        // If this is a retry, remove the last error message
        if (isRetry && prev.length > 0 && prev[prev.length - 1]!.isError) {
          return prev.slice(0, -1);
        }

        // Add user message for new messages
        if (!isRetry) {
          const userMessage: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content,
            timestamp: new Date().toISOString(),
          };
          return [...prev, userMessage];
        }

        return prev;
      });

      try {
        const response = await fetch('/api/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            provider,
            model,
            stream: true, // Enable streaming!
            ...(agentId && { agentId }),
            ...(workspaceId && { workspaceId }),
            ...(directTools?.length && { directTools }),
            // Send tool catalog only on the first message of a new chat
            ...(currentMessages.length === 0 && !isRetry && { includeToolList: true }),
            // Agent maintains its own conversation memory — only send count for logging
            historyLength: currentMessages.filter((m) => !m.isError).length,
            // Per-request tool call limit from chat settings panel
            ...(() => {
              try {
                const raw = localStorage.getItem('ownpilot_maxToolCalls');
                if (raw !== null) {
                  const n = parseInt(raw, 10);
                  if (!isNaN(n) && n >= 0 && n !== 200) return { maxToolCalls: n };
                }
              } catch { /* localStorage unavailable */ }
              return {};
            })(),
          }),
          signal: controller.signal,
        });

        // Check if request was aborted
        if (controller.signal.aborted) {
          return;
        }

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error?.message || `HTTP error ${response.status}`);
        }

        // Check if streaming response
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('text/event-stream')) {
          // Handle SSE stream
          const reader = response.body?.getReader();
          if (!reader) throw new Error('No response body');

          const decoder = new TextDecoder();
          let accumulatedContent = '';
          let buffer = '';
          let finalResponse: ChatResponse | null = null;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (controller.signal.aborted) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || ''; // Keep incomplete line in buffer

              for (const line of lines) {
                const event = parseSSELine(line);
                switch (event.kind) {
                  case 'approval':
                    setPendingApproval({
                      approvalId: event.data.approvalId,
                      category: event.data.category,
                      description: event.data.description,
                      code: event.data.code,
                      riskAnalysis: event.data.riskAnalysis as ApprovalRequest['riskAnalysis'],
                    });
                    break;
                  case 'progress':
                    setProgressEvents(prev => [...prev, event.data as unknown as ProgressEvent]);
                    break;
                  case 'delta':
                    if (event.data.delta) {
                      accumulatedContent += event.data.delta;
                      setStreamingContent(accumulatedContent);
                    }
                    if (event.data.done) {
                      finalResponse = {
                        id: event.data.id,
                        conversationId: event.data.conversationId ?? '',
                        message: accumulatedContent,
                        response: accumulatedContent,
                        model: model,
                        toolCalls: event.data.toolCalls as ChatResponse['toolCalls'],
                        usage: event.data.usage as ChatResponse['usage'],
                        finishReason: event.data.finishReason,
                        trace: event.data.trace as ChatResponse['trace'],
                        session: event.data.session as ChatResponse['session'],
                        suggestions: event.data.suggestions as ChatResponse['suggestions'],
                        memories: event.data.memories as ChatResponse['memories'],
                      };
                      // Update session context info (merge cachedTokens from usage)
                      if (event.data.session) {
                        const s = event.data.session as SessionInfo;
                        const usage = event.data.usage as { cachedTokens?: number } | undefined;
                        setSessionId(s.sessionId);
                        setSessionInfo(usage?.cachedTokens != null ? { ...s, cachedTokens: usage.cachedTokens } : s);
                      }
                    }
                    break;
                  case 'error':
                    throw new Error(event.message);
                }
              }
            }
          } finally {
            // Always release the reader — prevents dangling HTTP connections
            reader.cancel().catch(() => {});
          }

          if (controller.signal.aborted) return;

          // Stream complete - add final message
          setLastFailedMessage(null);
          setStreamingContent('');
          setProgressEvents([]);

          const assistantMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: (accumulatedContent || finalResponse?.response || '').replace(/<memories>[\s\S]*<\/memories>\s*/, '').replace(/<suggestions>[\s\S]*<\/suggestions>\s*$/, '').trimEnd(),
            timestamp: new Date().toISOString(),
            toolCalls: finalResponse?.toolCalls,
            provider,
            model: finalResponse?.model ?? model,
            trace: finalResponse?.trace,
          };
          setMessages((prev) => [...prev, assistantMessage]);

          // Set follow-up suggestions from the response
          if (finalResponse?.suggestions?.length) {
            setSuggestions(finalResponse.suggestions);
          }

          // Set extracted memories for user accept/reject
          if (finalResponse?.memories?.length) {
            setExtractedMemories(finalResponse.memories);
          }

        } else {
          // Non-streaming fallback
          const data: ApiResponse<ChatResponse> = await response.json();

          if (controller.signal.aborted) {
            return;
          }

          if (!data.success || !data.data) {
            throw new Error(data.error?.message ?? 'Failed to get response');
          }

          setLastFailedMessage(null);

          const assistantMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: data.data.response,
            timestamp: new Date().toISOString(),
            toolCalls: data.data.toolCalls,
            provider,
            model: data.data.model ?? model,
            trace: data.data.trace,
          };
          setMessages((prev) => [...prev, assistantMessage]);

          // Update session context info
          if (data.data.session) {
            setSessionId(data.data.session.sessionId);
            setSessionInfo(data.data.session);
          }

          // Set follow-up suggestions from the response
          if (data.data.suggestions?.length) {
            setSuggestions(data.data.suggestions);
          }

          // Set extracted memories for user accept/reject
          if (data.data.memories?.length) {
            setExtractedMemories(data.data.memories);
          }
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        const errorText = err instanceof Error ? err.message : 'An error occurred';
        setError(errorText);

        // Store the failed message for retry
        setLastFailedMessage(content);
        setStreamingContent('');
        setProgressEvents([]);

        // Add error message
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorText}`,
          timestamp: new Date().toISOString(),
          isError: true,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        // Only clear loading state if this controller is still the current one
        if (abortControllerRef.current === controller) {
          setIsLoading(false);
          setStreamingContent('');
          setProgressEvents([]);
          // NOTE: Do NOT clear pendingApproval here — the approval dialog has its own
          // 120s timeout, and resolveApproval() / clearMessages() handle cleanup.
          // Clearing here would dismiss the dialog before the user can respond.
          abortControllerRef.current = null;
        }
      }
    },
    [provider, model, agentId, workspaceId]
  );

  const retryLastMessage = useCallback(async () => {
    if (!lastFailedMessage) return;
    await sendMessage(lastFailedMessage, true);
  }, [lastFailedMessage, sendMessage]);

  const clearMessages = useCallback(() => {
    cancelRequest();
    setMessages([]);
    setError(null);
    setLastFailedMessage(null);
    setStreamingContent('');
    setProgressEvents([]);
    setSuggestions([]);
    setExtractedMemories([]);
    setPendingApproval(null);
    setSessionId(null);
    setSessionInfo(null);
  }, [cancelRequest]);

  const value: ChatStore = {
    messages,
    isLoading,
    error,
    lastFailedMessage,
    provider,
    model,
    agentId,
    workspaceId,
    streamingContent,
    progressEvents,
    suggestions,
    extractedMemories,
    pendingApproval,
    sessionId,
    sessionInfo,
    setProvider,
    setModel,
    setAgentId,
    setWorkspaceId,
    sendMessage,
    retryLastMessage,
    clearMessages,
    cancelRequest,
    clearSuggestions,
    acceptMemory,
    rejectMemory,
    resolveApproval,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatStore(): ChatStore {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatStore must be used within a ChatProvider');
  }
  return context;
}
