/**
 * Sidebar Chat Store
 *
 * Dedicated chat state for the StatsPanel CompactChat component.
 * Independent from the global ChatProvider — sidebar conversations
 * are namespaced with "sidebar-" prefixed conversationIds and scoped
 * to the current page context (path + type).
 */

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { parseSSELine } from '../utils/sse-parser';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { usePageCopilotContext } from './usePageCopilotContext';

export interface SidebarMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  timestamp: string;
}

interface SidebarChatState {
  messages: SidebarMessage[];
  input: string;
  isStreaming: boolean;
  streamingContent: string;
  conversationId: string | null;
  contextPath: string | null;
  contextType: string | null;
  provider: string;
  model: string;
}

interface SidebarChatActions {
  sendMessage: (content: string) => Promise<void>;
  setContext: (path: string | null, type: string | null) => void;
  setInput: (input: string) => void;
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  cancelStream: () => void;
  clearMessages: () => void;
}

type SidebarChatStore = SidebarChatState & SidebarChatActions;

const SidebarChatContext = createContext<SidebarChatStore | null>(null);

export function SidebarChatProvider({ children }: { children: ReactNode }) {
  const { config, contextData } = usePageCopilotContext();

  const [messages, setMessages] = useState<SidebarMessage[]>([]);
  const [input, setInputState] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [conversationId, setConversationIdState] = useState<string | null>(null);
  const [contextPath, setContextPathState] = useState<string | null>(null);
  const [contextType, setContextTypeState] = useState<string | null>(null);
  const [provider, setProviderState] = useState<string>(() => {
    try {
      return localStorage.getItem('ownpilot-default-provider') ?? '';
    } catch {
      return '';
    }
  });
  const [model, setModelState] = useState<string>(() => {
    try {
      return localStorage.getItem('ownpilot-default-model') ?? '';
    } catch {
      return '';
    }
  });

  // Refs for latest-value access inside callbacks without stale closures
  const abortControllerRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const messagesRef = useRef<SidebarMessage[]>([]);
  const contextPathRef = useRef<string | null>(null);
  const contextTypeRef = useRef<string | null>(null);
  const providerRef = useRef(provider);
  const modelRef = useRef(model);
  const contextDataRef = useRef(contextData);
  const configRef = useRef(config);

  // Keep refs in sync with state on every render
  conversationIdRef.current = conversationId;
  messagesRef.current = messages;
  contextPathRef.current = contextPath;
  contextTypeRef.current = contextType;
  providerRef.current = provider;
  modelRef.current = model;
  contextDataRef.current = contextData;
  configRef.current = config;

  // Abort on unmount to prevent state updates on unmounted component
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Auto-select provider based on page's preferBridge flag
  useEffect(() => {
    if (!config) return;

    if (config.preferBridge) {
      try {
        const providerNames = JSON.parse(
          localStorage.getItem('ownpilot-provider-names') ?? '{}'
        ) as Record<string, unknown>;
        const bridgeEntry = Object.entries(providerNames).find(
          ([_id, name]) => typeof name === 'string' && name.startsWith('bridge-')
        );
        if (bridgeEntry) {
          setProviderState(bridgeEntry[0]);
          providerRef.current = bridgeEntry[0];
        }
      } catch {
        /* ignore */
      }
    } else {
      try {
        const defaultProvider = localStorage.getItem('ownpilot-default-provider') ?? '';
        if (defaultProvider) {
          setProviderState(defaultProvider);
          providerRef.current = defaultProvider;
        }
      } catch {
        /* ignore */
      }
    }
  }, [config?.preferBridge]);

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamingContent('');
    }
  }, []);

  /**
   * setContext — called by CompactChat whenever the page context changes.
   * When path or type differs from current, resets all conversation state
   * so the sidebar chat starts fresh for the new context.
   */
  const setContext = useCallback((path: string | null, type: string | null) => {
    if (contextPathRef.current === path && contextTypeRef.current === type) return;
    // Abort any in-flight stream
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    // Reset conversation state for the new context
    setContextPathState(path);
    setContextTypeState(type);
    setMessages([]);
    setConversationIdState(null);
    setIsStreaming(false);
    setStreamingContent('');
  }, []);

  const setInput = useCallback((value: string) => setInputState(value), []);
  const setProvider = useCallback((p: string) => setProviderState(p), []);
  const setModel = useCallback((m: string) => setModelState(m), []);

  const clearMessages = useCallback(() => {
    cancelStream();
    setMessages([]);
    setConversationIdState(null);
    setStreamingContent('');
  }, [cancelStream]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    // Abort any previous in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Optimistically add user message
    const userMsg: SidebarMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setStreamingContent('');

    // Resolve or generate a sidebar-namespaced conversationId
    let currentConvId = conversationIdRef.current;
    if (!currentConvId) {
      currentConvId = `sidebar-${contextTypeRef.current || 'default'}-${Date.now()}`;
      setConversationIdState(currentConvId);
      conversationIdRef.current = currentConvId;
    }

    try {
      // Build request headers
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      try {
        const token = localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN);
        if (token) headers['X-Session-Token'] = token;
      } catch {
        /* localStorage unavailable in test environments */
      }

      // Bridge providers: signal which runtime to use.
      // Provider may be a UUID (local provider) or a name ('bridge-opencode').
      // Check both the raw ID and the display name from localStorage cache —
      // same pattern as useChatStore.tsx:270-279.
      const currentProvider = providerRef.current;
      const providerDisplayName = (() => {
        try {
          const names = JSON.parse(localStorage.getItem('ownpilot-provider-names') ?? '{}');
          return (names[currentProvider] ?? currentProvider) as string;
        } catch { return currentProvider; }
      })();
      const bridgeName = [currentProvider, providerDisplayName].find(n => n.startsWith('bridge-'));
      if (bridgeName) {
        headers['X-Runtime'] = bridgeName.replace('bridge-', '');
      }

      const currentContextPath = contextPathRef.current;
      if (currentContextPath) {
        headers['X-Project-Dir'] = currentContextPath;
      }

      const historyLength = messagesRef.current.filter((m) => !m.isError).length;

      const currentConfig = configRef.current;
      const pageContextBody = currentConfig
        ? {
            pageType: currentConfig.pageType,
            path: contextPathRef.current ?? undefined,
            contextData: contextDataRef.current ?? undefined,
            systemPromptHint: currentConfig.systemPromptHint ?? undefined,
          }
        : undefined;

      const response = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/v1/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: content,
          provider: currentProvider,
          model: modelRef.current,
          stream: true,
          conversationId: currentConvId,
          historyLength,
          ...(pageContextBody && { pageContext: pageContextBody }),
        }),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorData.error?.message ?? `HTTP error ${response.status}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('text/event-stream')) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let accumulatedContent = '';
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (controller.signal.aborted) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const event = parseSSELine(line);
              if (event.kind === 'delta') {
                if (event.data.delta) {
                  accumulatedContent += event.data.delta;
                  setStreamingContent(accumulatedContent);
                }
                if (event.data.done && event.data.conversationId) {
                  setConversationIdState(event.data.conversationId);
                  conversationIdRef.current = event.data.conversationId;
                }
              } else if (event.kind === 'error') {
                throw new Error(event.message);
              }
            }
          }
        } finally {
          reader.cancel().catch(() => {});
        }

        if (controller.signal.aborted) return;

        setStreamingContent('');
        const assistantMsg: SidebarMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: accumulatedContent
            .replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>\s*/g, '')
            .replace(/<memories>[\s\S]*<\/memories>\s*/, '')
            .replace(/<suggestions>[\s\S]*<\/suggestions>\s*$/, '')
            .trimEnd(),
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        // Non-streaming fallback
        const data = (await response.json()) as { data?: { response?: string } };
        if (controller.signal.aborted) return;
        const assistantMsg: SidebarMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.data?.response ?? '',
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;

      const errorText = err instanceof Error ? err.message : 'An error occurred';
      setStreamingContent('');
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Sorry, I encountered an error: ${errorText}`,
          isError: true,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      if (abortControllerRef.current === controller) {
        setIsStreaming(false);
        setStreamingContent('');
        abortControllerRef.current = null;
      }
    }
  }, []); // Uses refs for all mutable state — no stale closure risk

  const value: SidebarChatStore = {
    messages,
    input,
    isStreaming,
    streamingContent,
    conversationId,
    contextPath,
    contextType,
    provider,
    model,
    sendMessage,
    setContext,
    setInput,
    setProvider,
    setModel,
    cancelStream,
    clearMessages,
  };

  return <SidebarChatContext.Provider value={value}>{children}</SidebarChatContext.Provider>;
}

export function useSidebarChat(): SidebarChatStore {
  const context = useContext(SidebarChatContext);
  if (!context) {
    throw new Error('useSidebarChat must be used within a SidebarChatProvider');
  }
  return context;
}
