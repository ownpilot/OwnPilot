/**
 * Global Chat Store
 *
 * Provides persistent chat state across page navigation.
 * Chat continues in background when navigating away.
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

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  lastFailedMessage: string | null;
  provider: string;
  model: string;
  agentId: string | null;
  workspaceId: string | null;
}

interface ChatStore extends ChatState {
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setAgentId: (agentId: string | null) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
  sendMessage: (content: string) => Promise<void>;
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

  // AbortController persists across navigation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cancel any ongoing request
  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string, isRetry = false) => {
      // Cancel any previous ongoing request before starting a new one
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setError(null);
      setIsLoading(true);

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
            ...(agentId && { agentId }),
            ...(workspaceId && { workspaceId }),
            // Use current messages for history
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

        const data: ApiResponse<ChatResponse> = await response.json();

        // Check again after parsing
        if (controller.signal.aborted) {
          return;
        }

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
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        const errorText = err instanceof Error ? err.message : 'An error occurred';
        setError(errorText);

        // Store the failed message for retry
        setLastFailedMessage(content);

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
