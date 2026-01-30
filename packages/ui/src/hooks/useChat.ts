import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, ChatResponse, ApiResponse } from '../types';

interface UseChatOptions {
  provider?: string;
  model?: string;
  agentId?: string;
  workspaceId?: string;
  onProgress?: (event: ProgressEvent) => void;
}

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

interface UseChatReturn {
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
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setAgentId: (agentId: string | null) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
  sendMessage: (content: string) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  clearMessages: () => void;
  cancelRequest: () => void;
}

// Default provider and model - empty until set by parent component from API
const DEFAULT_PROVIDER = '';
const DEFAULT_MODEL = '';

export function useChat(options?: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [provider, setProvider] = useState(options?.provider || DEFAULT_PROVIDER);
  const [model, setModel] = useState(options?.model || DEFAULT_MODEL);
  const [agentId, setAgentId] = useState<string | null>(options?.agentId || null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(options?.workspaceId || null);
  const [streamingContent, setStreamingContent] = useState('');
  const [progressEvents, setProgressEvents] = useState<ProgressEvent[]>([]);

  // AbortController for canceling ongoing requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

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

  const sendMessage = useCallback(async (content: string, isRetry = false) => {
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

    // Track accumulated content across streaming scope for partial error recovery
    let accumulatedStreamContent = '';

    // If this is a retry, remove the last error message (keep the user message)
    if (isRetry) {
      setMessages((prev) => {
        // Remove the last message if it's an error
        if (prev.length > 0 && prev[prev.length - 1].isError) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } else {
      // Add user message for new messages
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
    }

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
          history: messages.filter(m => !m.isError).slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: controller.signal,
      });

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
        // Keep outer scope in sync for partial error recovery
        const syncAccumulated = (c: string) => { accumulatedContent = c; accumulatedStreamContent = c; };
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
              // Event type line, data follows
              continue;
            }

            if (line.startsWith('data:')) {
              const dataStr = line.slice(5).trim();
              if (!dataStr) continue;

              try {
                const data = JSON.parse(dataStr);

                // Handle different event types based on the data structure
                if (data.type === 'status' || data.type === 'tool_start' || data.type === 'tool_end') {
                  // Progress event
                  const progressEvent: ProgressEvent = data;
                  setProgressEvents(prev => [...prev, progressEvent]);
                  options?.onProgress?.(progressEvent);
                } else if (data.delta !== undefined) {
                  // Content chunk
                  if (data.delta) {
                    syncAccumulated(accumulatedContent + data.delta);
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
                    };
                  }
                } else if (data.error) {
                  throw new Error(data.error);
                }
              } catch (parseErr) {
                // Ignore parse errors for incomplete JSON
                console.warn('Failed to parse SSE data:', parseErr);
              }
            }
          }
        }

        // Stream complete - add final message
        setLastFailedMessage(null);
        setStreamingContent('');

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: accumulatedContent || finalResponse?.response || '',
          timestamp: new Date().toISOString(),
          toolCalls: finalResponse?.toolCalls,
          provider,
          model: finalResponse?.model ?? model,
        };
        setMessages((prev) => [...prev, assistantMessage]);

      } else {
        // Non-streaming fallback (shouldn't happen with stream: true)
        const data: ApiResponse<ChatResponse> = await response.json();

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
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      const errorText = err instanceof Error ? err.message : 'An error occurred';
      setError(errorText);
      setLastFailedMessage(content);
      setStreamingContent('');

      if (accumulatedStreamContent) {
        // Partial response was already streamed — preserve it with error note
        const partialMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: accumulatedStreamContent + '\n\n---\n*Response interrupted. You can retry your message.*',
          timestamp: new Date().toISOString(),
          isError: true,
        };
        setMessages((prev) => [...prev, partialMessage]);
      } else {
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorText}`,
          timestamp: new Date().toISOString(),
          isError: true,
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setIsLoading(false);
        setProgressEvents([]);
        abortControllerRef.current = null;
      }
    }
  }, [provider, model, agentId, workspaceId, messages, options]);

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

  return {
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
}
