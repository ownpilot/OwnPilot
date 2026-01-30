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
import type { Message, ChatResponse, ApiResponse } from '../types';

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

  // AbortController persists across navigation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cancel any ongoing request
  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setStreamingContent('');
      setProgressEvents([]);
    }
  }, []);

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

      setError(null);
      setIsLoading(true);
      setStreamingContent('');
      setProgressEvents([]);

      // Get current messages for history (need fresh reference)
      let currentMessages: Message[] = [];
      setMessages((prev) => {
        currentMessages = prev;

        // If this is a retry, remove the last error message
        if (isRetry && prev.length > 0 && prev[prev.length - 1].isError) {
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
            history: currentMessages
              .filter((m) => !m.isError)
              .slice(-10)
              .map((m) => ({
                role: m.role,
                content: m.content,
              })),
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

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (controller.signal.aborted) {
              reader.cancel();
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
              if (line.startsWith('event:')) {
                // Event type - we'll get data next
                continue;
              }

              if (line.startsWith('data:')) {
                const dataStr = line.slice(5).trim();
                if (!dataStr) continue;

                try {
                  const data = JSON.parse(dataStr);

                  // Handle different event types
                  if (data.type === 'status' || data.type === 'tool_start' || data.type === 'tool_end') {
                    // Progress event
                    const progressEvent: ProgressEvent = data;
                    setProgressEvents(prev => [...prev, progressEvent]);
                  } else if (data.delta !== undefined || data.done) {
                    // Content chunk or done event
                    if (data.delta) {
                      accumulatedContent += data.delta;
                      setStreamingContent(accumulatedContent);
                    }
                    if (data.done) {
                      finalResponse = {
                        id: data.id,
                        conversationId: data.conversationId,
                        message: accumulatedContent,
                        response: accumulatedContent,
                        model: model,
                        toolCalls: data.toolCalls,
                        usage: data.usage,
                        finishReason: data.finishReason,
                        trace: data.trace,
                      };
                    }
                  } else if (data.error) {
                    throw new Error(data.error);
                  }
                } catch (parseErr) {
                  // Ignore parse errors for incomplete JSON
                  if (!(parseErr instanceof SyntaxError)) {
                    console.warn('Failed to parse SSE data:', parseErr);
                  }
                }
              }
            }
          }

          // Stream complete - add final message
          setLastFailedMessage(null);
          setStreamingContent('');
          setProgressEvents([]);

          const assistantMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: accumulatedContent || finalResponse?.response || '',
            timestamp: new Date().toISOString(),
            toolCalls: finalResponse?.toolCalls,
            provider,
            model: finalResponse?.model ?? model,
            trace: finalResponse?.trace,
          };
          setMessages((prev) => [...prev, assistantMessage]);

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
    setProvider,
    setModel,
    setAgentId,
    setWorkspaceId,
    sendMessage,
    retryLastMessage,
    clearMessages,
    cancelRequest,
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
