/**
 * MiniChat — Floating chat widget (Facebook Messenger style)
 *
 * Shares conversation state with ChatPage via useChatStore().
 * Hidden on the "/" route (ChatPage) and on mobile viewports.
 * Persists open/closed state and size to localStorage.
 * Resizable via drag handle (top-left corner) + maximize/restore toggle.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useChatStore } from '../hooks/useChatStore';
import { useIsMobile } from '../hooks/useMediaQuery';
import { ChatInput } from './ChatInput';
import { MarkdownContent } from './MarkdownContent';
import { SuggestionChips } from './SuggestionChips';
import { MessageSquare, X, ExternalLink, Maximize2, Minimize2, Plus } from './icons';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { chatApi } from '../api';
import { formatNumber } from '../utils/formatters';
import type { Message } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 500;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 300;
const MAX_WIDTH = 800;
const BOTTOM_MARGIN = 24; // bottom-6 = 1.5rem = 24px
const RIGHT_MARGIN = 24;
/** Global header height (h-12 = 48px) + gap */
const TOP_RESERVED = 60;

const SIZE_STORAGE_KEY = 'ownpilot-mini-chat-size';

interface ChatSize {
  width: number;
  height: number;
}

function loadSize(): ChatSize {
  try {
    const saved = localStorage.getItem(SIZE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as ChatSize;
      if (parsed.width >= MIN_WIDTH && parsed.height >= MIN_HEIGHT) return parsed;
    }
  } catch {
    /* ignore */
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

function saveSize(size: ChatSize) {
  try {
    localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
  } catch {
    /* ignore */
  }
}

/** Max height that keeps the widget below the app header */
function maxHeight(): number {
  return window.innerHeight - BOTTOM_MARGIN - TOP_RESERVED;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip hidden context blocks from user messages (same logic as MessageList) */
function stripHiddenBlocks(content: string): string {
  return content
    .replace(/\n---\n\[ATTACHED CONTEXT[\s\S]*$/, '')
    .replace(/\n---\n\[TOOL CATALOG[\s\S]*$/, '');
}

function getFillColor(percent: number): string {
  if (percent >= 80) return 'bg-red-500';
  if (percent >= 50) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

// ---------------------------------------------------------------------------
// MiniMessageItem — compact message bubble
// ---------------------------------------------------------------------------

function MiniMessageItem({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isError = message.isError;

  const displayContent = useMemo(() => {
    if (isUser) return stripHiddenBlocks(message.content);
    return message.content;
  }, [message.content, isUser]);

  // Tool calls summary
  const toolCount = message.toolCalls?.length ?? 0;

  if (isError) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tl-md bg-error/10 border border-error/30 text-error text-sm">
          {displayContent}
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tr-md bg-primary text-white text-sm break-words whitespace-pre-wrap">
          {displayContent}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1">
        <div className="px-3 py-2 rounded-2xl rounded-tl-md bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border text-sm text-text-primary dark:text-dark-text-primary">
          <MarkdownContent content={displayContent} compact />
        </div>
        {toolCount > 0 && (
          <p className="text-[11px] text-text-muted dark:text-dark-text-muted px-1">
            Used {toolCount} tool{toolCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreamingIndicator
// ---------------------------------------------------------------------------

function StreamingIndicator({
  streamingContent,
  isLoading,
}: {
  streamingContent: string;
  isLoading: boolean;
}) {
  if (!isLoading) return null;

  if (streamingContent) {
    // Show last ~200 chars of streaming content
    const tail =
      streamingContent.length > 200 ? '...' + streamingContent.slice(-200) : streamingContent;
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tl-md bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border text-sm text-text-primary dark:text-dark-text-primary">
          <span className="whitespace-pre-wrap break-words">{tail}</span>
          <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 animate-pulse rounded-sm" />
        </div>
      </div>
    );
  }

  // Thinking state — bouncing dots
  return (
    <div className="flex justify-start">
      <div className="px-3 py-2 rounded-2xl rounded-tl-md bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        <div className="flex items-center gap-1.5 text-text-muted dark:text-dark-text-muted">
          <span className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
          </span>
          <span className="text-xs ml-1">Thinking...</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MiniChat
// ---------------------------------------------------------------------------

export function MiniChat() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const {
    messages,
    isLoading,
    streamingContent,
    suggestions,
    sessionInfo,
    provider,
    model,
    sendMessage,
    cancelRequest,
    clearMessages,
    clearSuggestions,
  } = useChatStore();

  // Open/closed state — persisted in localStorage
  const [isOpen, setIsOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.MINI_CHAT_OPEN) === 'true';
    } catch {
      return false;
    }
  });

  // Size state — persisted in localStorage
  const [size, setSize] = useState<ChatSize>(loadSize);
  const [isMaximized, setIsMaximized] = useState(false);
  const preMaxSizeRef = useRef<ChatSize>(size);

  // Resize drag state (refs to avoid re-renders during drag)
  const isResizing = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragStartSize = useRef<ChatSize>({ width: 0, height: 0 });

  // Unread tracking
  const lastSeenCountRef = useRef(messages.length);
  const [unreadCount, setUnreadCount] = useState(0);

  // Scroll ref
  const scrollRef = useRef<HTMLDivElement>(null);

  // Persist open/closed state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.MINI_CHAT_OPEN, String(isOpen));
    } catch {
      /* localStorage unavailable */
    }
  }, [isOpen]);

  // Track unread messages when collapsed
  useEffect(() => {
    if (isOpen) {
      // Reset when opening
      lastSeenCountRef.current = messages.length;
      setUnreadCount(0);
    } else {
      // Count new assistant messages since last seen
      const newMessages = messages.slice(lastSeenCountRef.current);
      const newAssistant = newMessages.filter((m) => m.role === 'assistant' && !m.isError);
      if (newAssistant.length > 0) {
        setUnreadCount((prev) => prev + newAssistant.length);
      }
    }
  }, [messages.length, isOpen]);

  // Auto-scroll to bottom on new messages / streaming
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent, isOpen]);

  // Handle suggestion select
  const handleSuggestionSelect = useCallback(
    (suggestion: { title: string; detail: string }) => {
      clearSuggestions();
      sendMessage(suggestion.detail || suggestion.title);
    },
    [sendMessage, clearSuggestions]
  );

  // Handle expand — navigate to full ChatPage
  const handleExpand = useCallback(() => {
    setIsOpen(false);
    navigate('/');
  }, [navigate]);

  // New chat — clear frontend + reset backend context
  const handleNewChat = useCallback(() => {
    clearMessages();
    chatApi.resetContext(provider, model).catch(() => {});
  }, [clearMessages, provider, model]);

  // Maximize / restore toggle
  const handleMaximizeToggle = useCallback(() => {
    if (isMaximized) {
      setSize(preMaxSizeRef.current);
      saveSize(preMaxSizeRef.current);
      setIsMaximized(false);
    } else {
      preMaxSizeRef.current = size;
      setIsMaximized(true);
    }
  }, [isMaximized, size]);

  // Resize drag handlers
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isMaximized) setIsMaximized(false);

      isResizing.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      dragStartSize.current = { ...size };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const deltaX = dragStart.current.x - ev.clientX;
        const deltaY = dragStart.current.y - ev.clientY;

        setSize({
          width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragStartSize.current.width + deltaX)),
          height: Math.max(
            MIN_HEIGHT,
            Math.min(maxHeight(), dragStartSize.current.height + deltaY)
          ),
        });
      };

      const handleMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setSize((current) => {
          saveSize(current);
          return current;
        });
      };

      document.body.style.cursor = 'nwse-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [size, isMaximized]
  );

  // Compute effective dimensions
  const effectiveSize = isMaximized
    ? {
        width: Math.min(MAX_WIDTH, window.innerWidth - RIGHT_MARGIN * 2),
        height: maxHeight(),
      }
    : size;

  // Derived: has an active conversation
  const hasConversation = messages.length > 0;

  // Context bar info
  const messageCount = sessionInfo?.messageCount ?? messages.length;
  const contextFillPercent = sessionInfo?.contextFillPercent ?? 0;
  const estimatedTokens = sessionInfo?.estimatedTokens ?? 0;
  const maxContextTokens = sessionInfo?.maxContextTokens ?? 128_000;

  // Hidden on ChatPage and mobile
  if (location.pathname === '/' || isMobile) return null;

  // ---- Collapsed: Chat bubble ----
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary hover:bg-primary-dark text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center"
        aria-label="Open chat"
      >
        <MessageSquare className="w-6 h-6" />

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full bg-error text-white text-[10px] font-bold leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}

        {/* Active loading ring */}
        {isLoading && (
          <span className="absolute inset-0 rounded-full border-2 border-white/60 animate-ping" />
        )}

        {/* Conversation exists dot (when not loading and no unread) */}
        {hasConversation && !isLoading && unreadCount === 0 && (
          <span className="absolute top-0 right-0 w-3 h-3 rounded-full bg-success border-2 border-primary" />
        )}
      </button>
    );
  }

  // ---- Expanded: Chat window ----
  return (
    <div
      className="fixed bottom-6 right-6 z-40 flex flex-col bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-2xl animate-fade-in-up"
      style={{
        width: effectiveSize.width,
        height: Math.min(effectiveSize.height, maxHeight()),
        maxWidth: `calc(100vw - ${RIGHT_MARGIN * 2}px)`,
      }}
    >
      {/* Resize handle — top-left corner */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute -top-1 -left-1 w-4 h-4 cursor-nwse-resize z-10 group"
        title="Drag to resize"
      >
        <svg
          viewBox="0 0 16 16"
          className="w-full h-full text-border dark:text-dark-border group-hover:text-text-muted dark:group-hover:text-dark-text-muted transition-colors"
        >
          <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.5" />
          <line x1="14" y1="7" x2="7" y2="14" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-border dark:border-dark-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
            Chat
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* New Chat */}
          <button
            onClick={handleNewChat}
            className="p-1 rounded-md text-text-muted dark:text-dark-text-muted hover:text-primary dark:hover:text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="w-4 h-4" />
          </button>
          {/* Maximize / Restore */}
          <button
            onClick={handleMaximizeToggle}
            className="p-1 rounded-md text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            aria-label={isMaximized ? 'Restore size' : 'Maximize'}
            title={isMaximized ? 'Restore size' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          {/* Expand to full page */}
          <button
            onClick={handleExpand}
            className="p-1 rounded-md text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            aria-label="Expand to full chat"
            title="Expand to full chat"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          {/* Close */}
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-md text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Context bar — compact inline version */}
      {hasConversation && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border dark:border-dark-border text-[11px] text-text-muted dark:text-dark-text-muted shrink-0">
          <span>{messageCount} msgs</span>
          <div className="flex-1 h-1 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${getFillColor(contextFillPercent)}`}
              style={{ width: `${Math.min(100, contextFillPercent)}%` }}
            />
          </div>
          <span>
            {formatNumber(estimatedTokens)}/{formatNumber(maxContextTokens)}
          </span>
          <span className="font-medium">{contextFillPercent}%</span>
          {provider && (
            <>
              <span className="text-border dark:text-dark-border">|</span>
              <span className="truncate max-w-[100px]">
                {provider}
                {model ? ` / ${model}` : ''}
              </span>
            </>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 && !isLoading && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Start a conversation...
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MiniMessageItem key={msg.id} message={msg} />
        ))}
        <StreamingIndicator streamingContent={streamingContent} isLoading={isLoading} />
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="px-3 pb-1 shrink-0">
          <SuggestionChips
            suggestions={suggestions}
            onSelect={handleSuggestionSelect}
            disabled={isLoading}
          />
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-2 border-t border-border dark:border-dark-border shrink-0">
        <ChatInput
          onSend={sendMessage}
          onStop={cancelRequest}
          isLoading={isLoading}
          placeholder="Message..."
        />
      </div>
    </div>
  );
}
