import { useState, useCallback } from 'react';
import type { Message, ChatResponse, ApiResponse } from '../types';

interface UseChatOptions {
  provider?: string;
  model?: string;
  agentId?: string;
  workspaceId?: string;
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
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setAgentId: (agentId: string | null) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
  sendMessage: (content: string) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  clearMessages: () => void;
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

  const sendMessage = useCallback(async (content: string, isRetry = false) => {
    setError(null);
    setIsLoading(true);

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
          // Include agentId if chatting with an agent
          ...(agentId && { agentId }),
          // Include workspaceId for file operations
          ...(workspaceId && { workspaceId }),
          // Include conversation history for context (exclude error messages)
          history: messages.filter(m => !m.isError).slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data: ApiResponse<ChatResponse> = await response.json();

      if (!data.success || !data.data) {
        throw new Error(data.error?.message ?? 'Failed to get response');
      }

      // Success! Clear the failed message
      setLastFailedMessage(null);

      // Add assistant message with trace info
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
    } catch (err) {
      const errorText = err instanceof Error ? err.message : 'An error occurred';
      setError(errorText);

      // Store the failed message for retry
      setLastFailedMessage(content);

      // Add error message from assistant (marked as error for styling/retry)
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${errorText}`,
        timestamp: new Date().toISOString(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [provider, model, agentId, workspaceId, messages]);

  const retryLastMessage = useCallback(async () => {
    if (!lastFailedMessage) return;
    await sendMessage(lastFailedMessage, true);
  }, [lastFailedMessage, sendMessage]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setLastFailedMessage(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    lastFailedMessage,
    provider,
    model,
    agentId,
    workspaceId,
    setProvider,
    setModel,
    setAgentId,
    setWorkspaceId,
    sendMessage,
    retryLastMessage,
    clearMessages,
  };
}
