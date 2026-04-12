/**
 * Global Chat Store
 *
 * Provides persistent chat state across page navigation.
 * Chat continues in background when navigating away.
 * Supports SSE streaming with progress events.
 */

import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from 'react';
import type {
  Message,
  MessageAttachment,
  ChatResponse,
  ApiResponse,
  SessionInfo,
  TraceInfo,
} from '../types';
import type { ApprovalRequest } from '../api';
import { executionPermissionsApi, memoriesApi } from '../api';
import { parseSSELine } from '../utils/sse-parser';
import { STORAGE_KEYS } from '../constants/storage-keys';

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
  /** Model is currently producing thinking/reasoning content */
  isThinking: boolean;
  /** Accumulated thinking content during streaming */
  thinkingContent: string;
  /** Thinking configuration for requests */
  thinkingConfig: {
    type: 'enabled' | 'adaptive';
    budgetTokens?: number;
    effort?: 'low' | 'medium' | 'high' | 'max';
  } | null;
}

/** Serialized snapshot of a conversation's UI state (stored when switching away) */
export interface ChatSessionSnapshot {
  messages: Message[];
  sessionId: string | null;
  sessionInfo: SessionInfo | null;
  isLoading: boolean;
  error: string | null;
  lastFailedMessage: string | null;
  streamingContent: string;
  thinkingContent: string;
  isThinking: boolean;
  progressEvents: ProgressEvent[];
  suggestions: Array<{ title: string; detail: string }>;
  extractedMemories: Array<{ type: string; content: string; importance?: number }>;
  pendingApproval: ApprovalRequest | null;
}

/** Tab entry for the session tab bar */
export interface SessionTab {
  id: string;
  title: string;
  createdAt: number;
}

const MAX_SESSIONS = 10;

interface ChatStore extends ChatState {
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
  /** Load a past conversation into the chat (sets messages + sessionId). */
  loadConversation: (id: string, messages: Message[]) => void;
  cancelRequest: () => void;
  clearSuggestions: () => void;
  acceptMemory: (index: number) => void;
  rejectMemory: (index: number) => void;
  resolveApproval: (approved: boolean) => void;
  setThinkingConfig: (config: ChatState['thinkingConfig']) => void;
  // Multi-session management
  activeSessionId: string;
  sessionTabs: SessionTab[];
  createSession: () => string;
  switchSession: (id: string) => void;
  closeSession: (id: string) => void;
}

const ChatContext = createContext<ChatStore | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [provider, setProviderState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.CHAT_PROVIDER) ?? ''; } catch { return ''; }
  });
  const [model, setModelState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEYS.CHAT_MODEL) ?? ''; } catch { return ''; }
  });
  // Persist provider/model to localStorage so they survive page reloads
  const setProvider = useCallback((v: string) => {
    setProviderState(v);
    try { if (v) localStorage.setItem(STORAGE_KEYS.CHAT_PROVIDER, v); else localStorage.removeItem(STORAGE_KEYS.CHAT_PROVIDER); } catch { /* */ }
  }, []);
  const setModel = useCallback((v: string) => {
    setModelState(v);
    try { if (v) localStorage.setItem(STORAGE_KEYS.CHAT_MODEL, v); else localStorage.removeItem(STORAGE_KEYS.CHAT_MODEL); } catch { /* */ }
  }, []);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [progressEvents, setProgressEvents] = useState<ProgressEvent[]>([]);
  const [suggestions, setSuggestions] = useState<Array<{ title: string; detail: string }>>([]);
  const [extractedMemories, setExtractedMemories] = useState<
    Array<{ type: string; content: string; importance?: number }>
  >([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  // Always start with a fresh session on page load.
  // Old conversations are accessible via sidebar Recents.
  // Restoring old sessionId caused new messages to silently append to old conversations.
  const [sessionId, setSessionIdState] = useState<string | null>(() => crypto.randomUUID());
  const sessionIdRef = useRef<string | null>(null);
  // Initialize ref from restored state
  sessionIdRef.current = sessionId;
  // Wrapper: keep ref + localStorage in sync with state
  const setSessionId = (id: string | null) => {
    sessionIdRef.current = id;
    setSessionIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEYS.CHAT_SESSION_ID, id);
      else localStorage.removeItem(STORAGE_KEYS.CHAT_SESSION_ID);
    } catch { /* */ }
  };
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState('');
  const [thinkingConfig, setThinkingConfig] = useState<ChatState['thinkingConfig']>(null);

  // AbortController persists across navigation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stream generation counter — orphaned streams (from New Chat) keep reading
  // so the backend can finish + persist, but their UI updates are suppressed.
  const streamGenRef = useRef(0);

  // --- Multi-session management ---
  const sessionsRef = useRef(new Map<string, ChatSessionSnapshot>());
  const [activeSessionId, setActiveSessionId] = useState<string>(() => crypto.randomUUID());
  const [sessionTabs, setSessionTabs] = useState<SessionTab[]>([]);

  // Refs for capturing current state without stale closures
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sessionInfoRef = useRef(sessionInfo);
  sessionInfoRef.current = sessionInfo;
  const stateRefsForCapture = useRef({ isLoading, error, lastFailedMessage, streamingContent, thinkingContent, isThinking, progressEvents, suggestions, extractedMemories, pendingApproval });
  stateRefsForCapture.current = { isLoading, error, lastFailedMessage, streamingContent, thinkingContent, isThinking, progressEvents, suggestions, extractedMemories, pendingApproval };

  // Cancel any ongoing request (also rejects pending approval if any)
  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setStreamingContent('');
      setThinkingContent('');
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
    setExtractedMemories((prev) => {
      const mem = prev[index];
      if (mem) {
        memoriesApi
          .create({
            type: mem.type,
            content: mem.content,
            source: 'conversation',
            importance: mem.importance ?? 0.7,
          })
          .catch(() => {});
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const rejectMemory = useCallback((index: number) => {
    setExtractedMemories((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const resolveApproval = useCallback(
    (approved: boolean) => {
      const approval = pendingApproval;
      if (!approval) return;
      setPendingApproval(null);
      executionPermissionsApi.resolveApproval(approval.approvalId, approved).catch(() => {
        // If the resolve call fails, the backend will timeout and auto-reject
      });
    },
    [pendingApproval]
  );

  const sendMessage = useCallback(
    async (
      content: string,
      directToolsOrRetry?: string[] | boolean,
      isRetryOrAttachments?: boolean | MessageAttachment[]
    ) => {
      // Support both old signature (content, isRetry) and new (content, directTools, isRetry/attachments)
      const directTools = Array.isArray(directToolsOrRetry) ? directToolsOrRetry : undefined;
      const isRetry =
        typeof directToolsOrRetry === 'boolean'
          ? directToolsOrRetry
          : typeof isRetryOrAttachments === 'boolean'
            ? isRetryOrAttachments
            : false;
      const imageAttachments = Array.isArray(isRetryOrAttachments)
        ? isRetryOrAttachments
        : undefined;
      // Cancel any previous ongoing request before starting a new one
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Capture stream generation — if clearMessages/loadConversation increments this,
      // the stream is "orphaned": it keeps reading (so backend persists to DB) but
      // all UI state updates are suppressed.
      const gen = streamGenRef.current;
      const isCurrentStream = () => streamGenRef.current === gen;

      // Auto-accept any remaining memories from previous response
      for (const mem of extractedMemoriesRef.current) {
        memoriesApi
          .create({
            type: mem.type,
            content: mem.content,
            source: 'conversation',
            importance: mem.importance ?? 0.7,
          })
          .catch(() => {});
      }

      // Pre-set sessionId BEFORE adding user message so sidebar sees both
      // chatMessages and chatStoreSessionId in the same render batch.
      // This ensures the optimistic sidebar entry appears the INSTANT the user hits Send.
      if (!sessionIdRef.current) {
        const newId = crypto.randomUUID();
        setSessionId(newId);
      }

      setError(null);
      setIsLoading(true);
      setStreamingContent('');
      setThinkingContent('');
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
            ...(imageAttachments?.length && { attachments: imageAttachments }),
          };
          return [...prev, userMessage];
        }

        return prev;
      });

      // Instantly inject sidebar entry — fires before backend early-persist so there's no race.
      // useSidebarRecents listens for this and prepends directly to recents.conversations.
      if (!isRetry) {
        const curId = sessionIdRef.current;
        if (curId) {
          window.dispatchEvent(
            new CustomEvent('chat:optimistic-entry', { detail: { id: curId, title: content.slice(0, 80) } })
          );
        }
      }

      try {
        // Build headers — include session token for UI auth
        const chatHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        try {
          const sessionToken = localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN);
          if (sessionToken) chatHeaders['X-Session-Token'] = sessionToken;
        } catch {
          /* localStorage unavailable */
        }
        // Bridge providers: signal which runtime to use
        // Provider ID can be a name ('bridge-opencode') or a UUID (local provider).
        // Check both the ID and the display name stored in localStorage.
        const providerDisplayName = (() => {
          try {
            const names = JSON.parse(localStorage.getItem('ownpilot-provider-names') ?? '{}');
            return (names[provider] ?? provider) as string;
          } catch { return provider; }
        })();
        const bridgeName = [provider, providerDisplayName].find(n => n.startsWith('bridge-'));
        if (bridgeName) {
          chatHeaders['X-Runtime'] = bridgeName.replace('bridge-', '');
        }

        // Use ref to avoid stale closure — sessionId state may not be current in callback.
        // Safety net: if sessionId is still null (e.g. fresh page load), pre-generate one.
        // Backend accepts client-generated UUIDs and auto-creates the conversation.
        let currentSessionId = sessionIdRef.current;
        if (!currentSessionId) {
          currentSessionId = crypto.randomUUID();
          setSessionId(currentSessionId);
        }
        const response = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/v1/chat`, {
          method: 'POST',
          headers: chatHeaders,
          body: JSON.stringify({
            message: content,
            provider,
            model,
            stream: true,
            // Always send conversationId — client pre-generates if needed (safety net above)
            conversationId: currentSessionId,
            ...(agentId && { agentId }),
            ...(workspaceId && { workspaceId }),
            ...(directTools?.length && { directTools }),
            ...(thinkingConfig && { thinking: thinkingConfig }),
            ...(imageAttachments?.length && {
              attachments: imageAttachments.map((a) => ({
                type: a.type,
                data: a.data,
                mimeType: a.mimeType,
                filename: a.filename,
              })),
            }),
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
              } catch {
                /* localStorage unavailable */
              }
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
          const errorData = await response.json().catch(() => ({}));

          // Handle 401 — clear session and let AuthGuard redirect to login
          if (response.status === 401) {
            try {
              localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
            } catch {
              /* */
            }
            // Trigger a page-level auth refresh by dispatching a storage event
            window.dispatchEvent(
              new StorageEvent('storage', { key: STORAGE_KEYS.SESSION_TOKEN, newValue: null })
            );
          }

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
          let accumulatedThinking = '';
          let buffer = '';
          let finalResponse: ChatResponse | null = null;
          let routingData: TraceInfo['routing'] | undefined;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (controller.signal.aborted) break;
              // Orphaned stream — keep draining body so backend completes + persists to DB
              if (!isCurrentStream()) continue;

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
                    setProgressEvents((prev) => [...prev, event.data as unknown as ProgressEvent]);
                    break;
                  case 'delta':
                    if (event.data.thinkingDelta) {
                      accumulatedThinking += event.data.thinkingDelta;
                      setThinkingContent(accumulatedThinking);
                      setIsThinking(true);
                    }
                    if (event.data.delta) {
                      accumulatedContent += event.data.delta;
                      setStreamingContent(accumulatedContent);
                      if (isThinking) setIsThinking(false);
                    }
                    if (!event.data.thinkingDelta && !event.data.delta) {
                      setIsThinking(!!event.data.thinking);
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
                        setSessionInfo(
                          usage?.cachedTokens != null
                            ? { ...s, cachedTokens: usage.cachedTokens }
                            : s
                        );
                      }
                    }
                    break;
                  case 'routing':
                    routingData = event.data;
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
          // Orphaned stream completed — backend persisted, skip UI updates
          if (!isCurrentStream()) return;

          // Stream complete - add final message
          setLastFailedMessage(null);
          setStreamingContent('');
          setThinkingContent('');
          setProgressEvents([]);
          setIsThinking(false);

          // Use thinkingContent from done event or accumulated during stream
          const finalThinking =
            ((finalResponse as Record<string, unknown> | null)?.thinkingContent as
              | string
              | undefined) ||
            accumulatedThinking ||
            undefined;

          // Merge routing data into trace if available
          const trace = finalResponse?.trace
            ? routingData
              ? { ...finalResponse.trace, routing: routingData }
              : finalResponse.trace
            : undefined;

          const assistantMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: (accumulatedContent || finalResponse?.response || '')
              .replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>\s*/g, '')
              .replace(/<memories>[\s\S]*<\/memories>\s*/, '')
              .replace(/<suggestions>[\s\S]*<\/suggestions>\s*$/, '')
              .trimEnd(),
            timestamp: new Date().toISOString(),
            toolCalls: finalResponse?.toolCalls,
            provider,
            model: finalResponse?.model ?? model,
            trace,
            ...(finalThinking && { thinkingContent: finalThinking }),
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

          if (controller.signal.aborted || !isCurrentStream()) {
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
        // Ignore abort errors and orphaned stream errors
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        if (!isCurrentStream()) return;

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
    [provider, model, agentId, workspaceId, thinkingConfig]
  );

  const retryLastMessage = useCallback(async () => {
    if (!lastFailedMessage) return;
    await sendMessage(lastFailedMessage, true);
  }, [lastFailedMessage, sendMessage]);

  const clearMessages = useCallback(() => {
    // Orphan any running stream — it keeps reading in background so the backend
    // can finish processing and persist the response to DB. UI updates are
    // suppressed via the generation check in sendMessage.
    streamGenRef.current++;
    abortControllerRef.current = null;
    // Reject pending approval so backend doesn't hang waiting for user response
    if (pendingApproval) {
      executionPermissionsApi.resolveApproval(pendingApproval.approvalId, false).catch(() => {});
    }
    setMessages([]);
    setIsLoading(false);
    setError(null);
    setLastFailedMessage(null);
    setStreamingContent('');
    setThinkingContent('');
    setProgressEvents([]);
    setIsThinking(false);
    setSuggestions([]);
    setExtractedMemories([]);
    setPendingApproval(null);
    setSessionId(null);
    setSessionInfo(null);
  }, [pendingApproval]);

  const loadConversation = useCallback(
    (id: string, msgs: Message[]) => {
      // Orphan any running stream (same pattern as clearMessages)
      streamGenRef.current++;
      abortControllerRef.current = null;
      if (pendingApproval) {
        executionPermissionsApi.resolveApproval(pendingApproval.approvalId, false).catch(() => {});
      }
      setMessages(msgs);
      setIsLoading(false);
      setError(null);
      setLastFailedMessage(null);
      setStreamingContent('');
      setThinkingContent('');
      setProgressEvents([]);
      setIsThinking(false);
      setSuggestions([]);
      setExtractedMemories([]);
      setPendingApproval(null);
      setSessionId(id);
      setSessionInfo(null);
    },
    [pendingApproval]
  );

  // --- Multi-session methods ---

  const captureSnapshot = useCallback((): ChatSessionSnapshot => {
    const s = stateRefsForCapture.current;
    return {
      messages: messagesRef.current,
      sessionId: sessionIdRef.current,
      sessionInfo: sessionInfoRef.current,
      isLoading: s.isLoading,
      error: s.error,
      lastFailedMessage: s.lastFailedMessage,
      streamingContent: s.streamingContent,
      thinkingContent: s.thinkingContent,
      isThinking: s.isThinking,
      progressEvents: s.progressEvents,
      suggestions: s.suggestions,
      extractedMemories: s.extractedMemories,
      pendingApproval: s.pendingApproval,
    };
  }, []);

  const restoreSnapshot = useCallback((snap: ChatSessionSnapshot) => {
    setMessages(snap.messages);
    setSessionId(snap.sessionId);
    setSessionInfo(snap.sessionInfo);
    setIsLoading(snap.isLoading);
    setError(snap.error);
    setLastFailedMessage(snap.lastFailedMessage);
    setStreamingContent(snap.streamingContent);
    setThinkingContent(snap.thinkingContent);
    setIsThinking(snap.isThinking);
    setProgressEvents(snap.progressEvents);
    setSuggestions(snap.suggestions);
    setExtractedMemories(snap.extractedMemories);
    setPendingApproval(snap.pendingApproval);
  }, []);

  /** Helper: clear all per-conversation state for a fresh session */
  const clearAllState = useCallback(() => {
    streamGenRef.current++;
    abortControllerRef.current = null;
    setMessages([]);
    setIsLoading(false);
    setError(null);
    setLastFailedMessage(null);
    setStreamingContent('');
    setThinkingContent('');
    setProgressEvents([]);
    setIsThinking(false);
    setSuggestions([]);
    setExtractedMemories([]);
    setPendingApproval(null);
    setSessionId(null);
    setSessionInfo(null);
  }, []);

  /** Create a new session — saves current to map, clears UI */
  const createSession = useCallback((): string => {
    const currentId = activeSessionId;
    const snap = captureSnapshot();
    // Only save if there are actual messages (sessionId is always set now via pre-generation)
    if (snap.messages.length > 0) {
      sessionsRef.current.set(currentId, snap);
      const title = snap.messages.find(m => m.role === 'user')?.content.slice(0, 60) || 'New Chat';
      setSessionTabs(prev => {
        if (prev.find(t => t.id === currentId)) return prev;
        return [...prev, { id: currentId, title, createdAt: Date.now() }];
      });
    }
    // Reject pending approval before switching
    if (stateRefsForCapture.current.pendingApproval) {
      executionPermissionsApi.resolveApproval(stateRefsForCapture.current.pendingApproval.approvalId, false).catch(() => {});
    }
    const newId = crypto.randomUUID();
    setActiveSessionId(newId);
    clearAllState();
    // Pre-set sessionId so the first message includes conversationId in the request.
    // This follows the client-generated ID pattern (NextChat, LobeChat, big-AGI).
    // The backend accepts unknown IDs and auto-creates the conversation (FIX-1).
    setSessionId(newId);
    // Enforce max sessions — evict oldest
    if (sessionsRef.current.size > MAX_SESSIONS) {
      const entries = [...sessionsRef.current.entries()];
      const oldestKey = entries[0]?.[0];
      if (oldestKey) {
        sessionsRef.current.delete(oldestKey);
        setSessionTabs(prev => prev.filter(t => t.id !== oldestKey));
      }
    }
    return newId;
  }, [activeSessionId, captureSnapshot, clearAllState]);

  /** Switch to an existing session (from tab or sidebar) */
  const switchSession = useCallback((targetId: string) => {
    if (targetId === activeSessionId) return;
    // Save current active session
    const currentId = activeSessionId;
    const snap = captureSnapshot();
    sessionsRef.current.set(currentId, snap);
    setSessionTabs(prev => {
      if (prev.find(t => t.id === currentId)) return prev;
      const title = snap.messages.find(m => m.role === 'user')?.content.slice(0, 60) || 'New Chat';
      return [...prev, { id: currentId, title, createdAt: Date.now() }];
    });
    // Orphan current stream
    streamGenRef.current++;
    abortControllerRef.current = null;
    // Restore target from map (if cached) or set sessionId for DB load
    const target = sessionsRef.current.get(targetId);
    if (target) {
      restoreSnapshot(target);
      sessionsRef.current.delete(targetId);
    } else {
      clearAllState();
      setSessionId(targetId);
    }
    setActiveSessionId(targetId);
  }, [activeSessionId, captureSnapshot, restoreSnapshot, clearAllState]);

  /** Close a session tab */
  const closeSession = useCallback((targetId: string) => {
    sessionsRef.current.delete(targetId);
    setSessionTabs(prev => {
      const remaining = prev.filter(t => t.id !== targetId);
      if (targetId === activeSessionId) {
        if (remaining.length > 0) {
          const nearest = remaining[remaining.length - 1]!;
          queueMicrotask(() => switchSession(nearest.id));
        } else {
          queueMicrotask(() => {
            setActiveSessionId(crypto.randomUUID());
            clearAllState();
          });
        }
      }
      return remaining;
    });
  }, [activeSessionId, switchSession, clearAllState]);

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
    isThinking,
    thinkingContent,
    thinkingConfig,
    setProvider,
    setModel,
    setAgentId,
    setWorkspaceId,
    sendMessage,
    retryLastMessage,
    clearMessages,
    loadConversation,
    cancelRequest,
    clearSuggestions,
    acceptMemory,
    rejectMemory,
    resolveApproval,
    setThinkingConfig,
    activeSessionId,
    sessionTabs,
    createSession,
    switchSession,
    closeSession,
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
