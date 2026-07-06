/**
 * ChatProvider — Global Chat State Provider
 *
 * Manages chat messages, SSE streaming, conversation loading,
 * session management, and auto-compact prompting.
 */

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { Message, MessageAttachment, SessionInfo, ChatResponse, ApiResponse, TraceInfo } from '../../types';
import type { ApprovalRequest } from '../../api';
import { executionPermissionsApi, memoriesApi, chatApi } from '../../api';
import { parseSSELine } from '../../utils/sse-parser';
import { STORAGE_KEYS } from '../../constants/storage-keys';
import { dispatchSessionChanged } from '../../utils/session-events';
import { stripChatInternalTags } from '../../utils/chat-content';
import { ignoreError } from '../../utils/ignore-error';
import { useAutoCompact } from '../useAutoCompact';
import { useChatSessions } from '../useChatSessions';
import {
  type ChatStore,
  type ChatState,
  type ChatSessionSnapshot,
  type FailedChatRequest,
  type ProgressEvent,
  parseProgressEvent,
} from './types';

export const ChatContext = createContext<ChatStore | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [lastFailedRequest, setLastFailedRequest] = useState<FailedChatRequest | null>(null);
  const [provider, setProviderState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.CHAT_PROVIDER) ?? '';
    } catch {
      return '';
    }
  });
  const [model, setModelState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.CHAT_MODEL) ?? '';
    } catch {
      return '';
    }
  });
  // Persist provider/model to localStorage so they survive page reloads
  const setProvider = useCallback((v: string) => {
    setProviderState(v);
    try {
      if (v) localStorage.setItem(STORAGE_KEYS.CHAT_PROVIDER, v);
      else localStorage.removeItem(STORAGE_KEYS.CHAT_PROVIDER);
    } catch {
      /* */
    }
  }, []);
  const setModel = useCallback((v: string) => {
    setModelState(v);
    try {
      if (v) localStorage.setItem(STORAGE_KEYS.CHAT_MODEL, v);
      else localStorage.removeItem(STORAGE_KEYS.CHAT_MODEL);
    } catch {
      /* */
    }
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
  const [sessionId, setSessionIdState] = useState<string | null>(() => crypto.randomUUID());
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  const setSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setSessionIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEYS.CHAT_SESSION_ID, id);
      else localStorage.removeItem(STORAGE_KEYS.CHAT_SESSION_ID);
    } catch {
      /* */
    }
  }, []);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);

  // Auto-compact concern
  const {
    isCompacting,
    autoCompactPrompt,
    autoCompactDisabled,
    lastCompactionSummary,
    applySessionInfo,
    dismissAutoCompactPrompt,
    disableAutoCompactPrompt,
    clearLastCompactionSummary,
    resetAutoCompactPrompt,
    compactSession,
  } = useAutoCompact({ provider, model, setSessionInfo });

  const [isThinking, setIsThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState('');
  const [thinkingConfig, setThinkingConfig] = useState<ChatState['thinkingConfig']>(null);

  // AbortController persists across navigation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stream generation counter — orphaned streams keep reading but suppress UI updates
  const streamGenRef = useRef(0);

  // Refs for capturing current state without stale closures
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sessionInfoRef = useRef(sessionInfo);
  sessionInfoRef.current = sessionInfo;
  const stateRefsForCapture = useRef({
    isLoading,
    error,
    lastFailedMessage,
    lastFailedRequest,
    streamingContent,
    thinkingContent,
    isThinking,
    progressEvents,
    suggestions,
    extractedMemories,
    pendingApproval,
  });
  stateRefsForCapture.current = {
    isLoading,
    error,
    lastFailedMessage,
    lastFailedRequest,
    streamingContent,
    thinkingContent,
    isThinking,
    progressEvents,
    suggestions,
    extractedMemories,
    pendingApproval,
  };

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
    if (pendingApproval) {
      ignoreError(
        executionPermissionsApi.resolveApproval(pendingApproval.approvalId, false),
        'resolveApproval:reset'
      );
      setPendingApproval(null);
    }
  }, [pendingApproval]);

  const clearSuggestions = useCallback(() => setSuggestions([]), []);

  const extractedMemoriesRef = useRef(extractedMemories);
  extractedMemoriesRef.current = extractedMemories;

  const acceptMemory = useCallback((index: number) => {
    setExtractedMemories((prev) => {
      const mem = prev[index];
      if (mem) {
        ignoreError(
          memoriesApi.create({
            type: mem.type,
            content: mem.content,
            source: 'conversation',
            importance: mem.importance ?? 0.7,
          }),
          'memoriesApi.create'
        );
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
      ignoreError(
        executionPermissionsApi.resolveApproval(approval.approvalId, approved),
        'resolveApproval:respond'
      );
    },
    [pendingApproval]
  );

  const sendMessage = useCallback(
    async (
      content: string,
      directToolsOrRetry?: string[] | boolean,
      isRetryOrAttachments?: boolean | MessageAttachment[],
      retryAttachments?: MessageAttachment[]
    ) => {
      const directTools = Array.isArray(directToolsOrRetry) ? directToolsOrRetry : undefined;
      const isRetry =
        typeof directToolsOrRetry === 'boolean'
          ? directToolsOrRetry
          : typeof isRetryOrAttachments === 'boolean'
            ? isRetryOrAttachments
            : false;
      const imageAttachments = Array.isArray(isRetryOrAttachments)
        ? isRetryOrAttachments
        : retryAttachments;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const gen = streamGenRef.current;
      const isCurrentStream = () => streamGenRef.current === gen;

      for (const mem of extractedMemoriesRef.current) {
        ignoreError(
          memoriesApi.create({
            type: mem.type,
            content: mem.content,
            source: 'conversation',
            importance: mem.importance ?? 0.7,
          }),
          'memoriesApi.create'
        );
      }

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

      let currentMessages: Message[] = [];
      setMessages((prev) => {
        currentMessages = prev;
        if (isRetry && prev.length > 0 && prev[prev.length - 1]!.isError) {
          return prev.slice(0, -1);
        }
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

      if (!isRetry) {
        const curId = sessionIdRef.current;
        if (curId) {
          window.dispatchEvent(
            new CustomEvent('chat:optimistic-entry', {
              detail: { id: curId, title: content.slice(0, 80) },
            })
          );
        }
      }

      try {
        const chatHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        const providerDisplayName = (() => {
          try {
            const names = JSON.parse(localStorage.getItem('ownpilot-provider-names') ?? '{}');
            return (names[provider] ?? provider) as string;
          } catch {
            return provider;
          }
        })();
        const bridgeName = [provider, providerDisplayName].find((n) => n.startsWith('bridge-'));
        if (bridgeName) {
          chatHeaders['X-Runtime'] = bridgeName.replace('bridge-', '');
        }

        let currentSessionId = sessionIdRef.current;
        if (!currentSessionId) {
          currentSessionId = crypto.randomUUID();
          setSessionId(currentSessionId);
        }
        const response = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/v1/chat`, {
          method: 'POST',
          headers: chatHeaders,
          credentials: import.meta.env.VITE_API_BASE ? 'include' : 'same-origin',
          body: JSON.stringify({
            message: content,
            provider,
            model,
            stream: true,
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
            ...(currentMessages.length === 0 && !isRetry && { includeToolList: true }),
            historyLength: currentMessages.filter((m) => !m.isError).length,
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

        if (controller.signal.aborted) return;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          if (response.status === 401) {
            dispatchSessionChanged(false);
          }
          throw new Error(errorData.error?.message || `HTTP error ${response.status}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType?.includes('text/event-stream')) {
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
              if (!isCurrentStream()) continue;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

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
                  case 'progress': {
                    const progressEvent = parseProgressEvent(event.data);
                    if (progressEvent) {
                      setProgressEvents((prev) => [...prev, progressEvent]);
                    }
                    break;
                  }
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
                        thinkingContent: event.data.thinkingContent,
                      };
                      if (event.data.session) {
                        const s = event.data.session as SessionInfo;
                        const usage = event.data.usage as { cachedTokens?: number } | undefined;
                        setSessionId(s.sessionId);
                        applySessionInfo(
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
            ignoreError(reader.cancel(), 'reader.cancel');
          }

          if (controller.signal.aborted) return;
          if (!isCurrentStream()) return;

          setLastFailedMessage(null);
          setLastFailedRequest(null);
          setStreamingContent('');
          setThinkingContent('');
          setProgressEvents([]);
          setIsThinking(false);

          const finalThinking =
            ((finalResponse as Record<string, unknown> | null)?.thinkingContent as
              | string
              | undefined) ||
            accumulatedThinking ||
            undefined;

          const trace = finalResponse?.trace
            ? routingData
              ? { ...finalResponse.trace, routing: routingData }
              : finalResponse.trace
            : undefined;

          const assistantMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: stripChatInternalTags(accumulatedContent || finalResponse?.response || ''),
            timestamp: new Date().toISOString(),
            toolCalls: finalResponse?.toolCalls,
            provider,
            model: finalResponse?.model ?? model,
            trace,
            ...(finalThinking && { thinkingContent: finalThinking }),
          };
          setMessages((prev) => [...prev, assistantMessage]);

          if (finalResponse?.suggestions?.length) {
            setSuggestions(finalResponse.suggestions);
          }
          if (finalResponse?.memories?.length) {
            setExtractedMemories(finalResponse.memories);
          }
        } else {
          const data: ApiResponse<ChatResponse> = await response.json();
          if (controller.signal.aborted || !isCurrentStream()) return;
          if (!data.success || !data.data) {
            throw new Error(data.error?.message ?? 'Failed to get response');
          }
          setLastFailedMessage(null);
          setLastFailedRequest(null);
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
          if (data.data.session) {
            setSessionId(data.data.session.sessionId);
            applySessionInfo(data.data.session);
          }
          if (data.data.suggestions?.length) {
            setSuggestions(data.data.suggestions);
          }
          if (data.data.memories?.length) {
            setExtractedMemories(data.data.memories);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (!isCurrentStream()) return;

        const errorText = err instanceof Error ? err.message : 'An error occurred';
        setError(errorText);
        setLastFailedMessage(content);
        setLastFailedRequest({
          content,
          ...(directTools?.length && { directTools: [...directTools] }),
          ...(imageAttachments?.length && {
            imageAttachments: imageAttachments.map((attachment) => ({ ...attachment })),
          }),
        });
        setStreamingContent('');
        setProgressEvents([]);

        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorText}`,
          timestamp: new Date().toISOString(),
          isError: true,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        if (abortControllerRef.current === controller) {
          setIsLoading(false);
          setStreamingContent('');
          setProgressEvents([]);
          abortControllerRef.current = null;
        }
      }
    },
    [provider, model, agentId, workspaceId, thinkingConfig, applySessionInfo]
  );

  const retryLastMessage = useCallback(async () => {
    const request =
      lastFailedRequest ?? (lastFailedMessage ? { content: lastFailedMessage } : null);
    if (!request) return;
    await sendMessage(request.content, request.directTools, true, request.imageAttachments);
  }, [lastFailedMessage, lastFailedRequest, sendMessage]);

  const clearMessages = useCallback(() => {
    streamGenRef.current++;
    abortControllerRef.current = null;
    if (pendingApproval) {
      ignoreError(
        executionPermissionsApi.resolveApproval(pendingApproval.approvalId, false),
        'resolveApproval:cancel'
      );
    }
    setMessages([]);
    setIsLoading(false);
    setError(null);
    setLastFailedMessage(null);
    setLastFailedRequest(null);
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
      streamGenRef.current++;
      abortControllerRef.current = null;
      if (pendingApproval) {
        ignoreError(
          executionPermissionsApi.resolveApproval(pendingApproval.approvalId, false),
          'resolveApproval:abort'
        );
      }
      setMessages(msgs);
      setIsLoading(false);
      setError(null);
      setLastFailedMessage(null);
      setLastFailedRequest(null);
      setStreamingContent('');
      setThinkingContent('');
      setProgressEvents([]);
      setIsThinking(false);
      setSuggestions([]);
      setExtractedMemories([]);
      setPendingApproval(null);
      setSessionId(id);
      setSessionInfo(null);
      resetAutoCompactPrompt();
      ignoreError(
        chatApi.getContextDetail(provider, model).then((r) => {
          const b = r.breakdown;
          if (!b) return;
          const total = (b.systemPromptTokens ?? 0) + (b.messageHistoryTokens ?? 0);
          const max = b.maxContextTokens ?? 128_000;
          applySessionInfo({
            sessionId: id,
            messageCount: b.messageCount ?? msgs.length,
            estimatedTokens: total,
            maxContextTokens: max,
            contextFillPercent: max > 0 ? Math.min(100, Math.round((total / max) * 100)) : 0,
          });
        }),
        'chatApi.getContextDetail:loadConversation'
      );
    },
    [pendingApproval, provider, model, applySessionInfo, resetAutoCompactPrompt]
  );

  const refreshSessionInfo = useCallback(async () => {
    if (!provider || !model) return;
    try {
      const r = await chatApi.getContextDetail(provider, model);
      const b = r.breakdown;
      if (!b) return;
      const total = (b.systemPromptTokens ?? 0) + (b.messageHistoryTokens ?? 0);
      const max = b.maxContextTokens ?? 128_000;
      applySessionInfo({
        sessionId: sessionIdRef.current ?? 'unknown',
        messageCount: b.messageCount ?? 0,
        estimatedTokens: total,
        maxContextTokens: max,
        contextFillPercent: max > 0 ? Math.min(100, Math.round((total / max) * 100)) : 0,
      });
    } catch {
      /* ignore */
    }
  }, [provider, model, applySessionInfo]);

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
      lastFailedRequest: s.lastFailedRequest,
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
    setLastFailedRequest(snap.lastFailedRequest ?? null);
    setStreamingContent(snap.streamingContent);
    setThinkingContent(snap.thinkingContent);
    setIsThinking(snap.isThinking);
    setProgressEvents(snap.progressEvents);
    setSuggestions(snap.suggestions);
    setExtractedMemories(snap.extractedMemories);
    setPendingApproval(snap.pendingApproval);
  }, []);

  const orphanStream = useCallback(() => {
    streamGenRef.current++;
    abortControllerRef.current = null;
  }, []);

  const clearAllState = useCallback(() => {
    orphanStream();
    setMessages([]);
    setIsLoading(false);
    setError(null);
    setLastFailedMessage(null);
    setLastFailedRequest(null);
    setStreamingContent('');
    setThinkingContent('');
    setProgressEvents([]);
    setIsThinking(false);
    setSuggestions([]);
    setExtractedMemories([]);
    setPendingApproval(null);
    setSessionId(null);
    setSessionInfo(null);
  }, [orphanStream]);

  const rejectPendingApproval = useCallback(() => {
    const approval = stateRefsForCapture.current.pendingApproval;
    if (approval) {
      ignoreError(
        executionPermissionsApi.resolveApproval(approval.approvalId, false),
        'resolveApproval:cleanup'
      );
    }
  }, []);

  const { activeSessionId, sessionTabs, createSession, switchSession, closeSession } =
    useChatSessions<ChatSessionSnapshot>({
      capture: captureSnapshot,
      restore: restoreSnapshot,
      clear: clearAllState,
      orphanStream,
      setSessionId,
      rejectPendingApproval,
    });

  const value: ChatStore = {
    messages,
    isLoading,
    error,
    lastFailedMessage,
    lastFailedRequest,
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
    isCompacting,
    autoCompactPrompt,
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
    compactSession,
    refreshSessionInfo,
    dismissAutoCompactPrompt,
    disableAutoCompactPrompt,
    autoCompactDisabled,
    lastCompactionSummary,
    clearLastCompactionSummary,
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
