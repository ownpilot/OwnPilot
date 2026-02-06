/**
 * Chat History Page
 *
 * Unified view of all conversation history — web UI and Telegram channels.
 * Lists conversations with search/filter, and shows full message threads.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { History, Search, Archive, Trash2, ChevronLeft, Telegram, Globe, Bot, User, Clock, MessageSquare, RefreshCw } from '../components/icons';
import { chatApi } from '../api';
import type { Conversation, HistoryMessage } from '../api';
import { useGateway } from '../hooks/useWebSocket';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { MarkdownContent } from '../components/MarkdownContent';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Detect conversation source from metadata or agentId */
function getSource(conv: Conversation): 'telegram' | 'web' {
  const meta = conv.metadata as Record<string, unknown> | undefined;
  if (meta?.source === 'channel' || meta?.platform === 'telegram') return 'telegram';
  if (conv.agentId?.startsWith('channel.')) return 'telegram';
  return 'web';
}

function SourceBadge({ source }: { source: 'telegram' | 'web' }) {
  if (source === 'telegram') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#229ED9]/10 text-[#229ED9]">
        <Telegram className="w-3 h-3" />
        Telegram
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
      <Globe className="w-3 h-3" />
      Web
    </span>
  );
}

export function ChatHistoryPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const { subscribe, status: wsStatus } = useGateway();
  const { confirm } = useDialog();
  const toast = useToast();

  // Keep ref in sync for WS callback
  selectedIdRef.current = selectedId;

  // Fetch conversations
  const fetchConversations = useCallback(async (searchQuery?: string) => {
    try {
      const data = await chatApi.listHistory({
        limit: 100,
        search: searchQuery || undefined,
        archived: showArchived,
      });
      setConversations(data.conversations);
    } catch {
      toast.error('Failed to load conversations');
    }
  }, [showArchived, toast]);

  // Reload currently selected conversation messages
  const refreshSelectedMessages = useCallback(async (convId: string) => {
    try {
      const data = await chatApi.getHistory(convId);
      setSelectedConv(data.conversation);
      setMessages(data.messages);
    } catch {
      // Non-critical — list already updated
    }
  }, []);

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    fetchConversations().finally(() => setIsLoading(false));
  }, [fetchConversations]);

  // Real-time: subscribe to chat:history:updated
  useEffect(() => {
    const unsub = subscribe<{ conversationId: string }>('chat:history:updated', (data) => {
      // Refresh conversation list
      fetchConversations(search || undefined);

      // If the updated conversation is currently selected, refresh messages too
      if (selectedIdRef.current === data.conversationId) {
        refreshSelectedMessages(data.conversationId);
      }
    });
    return unsub;
  }, [subscribe, fetchConversations, refreshSelectedMessages, search]);

  // Real-time: subscribe to channel:message (Telegram messages)
  useEffect(() => {
    const unsub = subscribe('channel:message', () => {
      // Channel messages trigger conversation updates — refresh list
      // (small delay to let persistence middleware finish saving)
      setTimeout(() => fetchConversations(search || undefined), 500);
    });
    return unsub;
  }, [subscribe, fetchConversations, search]);

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchConversations(search);
    }, 300);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [search, fetchConversations]);

  // Select conversation and load messages
  const selectConversation = useCallback(async (id: string) => {
    setSelectedId(id);
    setIsLoadingMessages(true);
    try {
      const data = await chatApi.getHistory(id);
      setSelectedConv(data.conversation);
      setMessages(data.messages);
    } catch {
      toast.error('Failed to load conversation');
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  // Manual refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchConversations(search || undefined);
    if (selectedIdRef.current) {
      await refreshSelectedMessages(selectedIdRef.current);
    }
    setIsRefreshing(false);
  }, [fetchConversations, refreshSelectedMessages, search]);

  // Scroll to bottom when messages load
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Archive/unarchive
  const handleArchive = useCallback(async (id: string, archived: boolean) => {
    try {
      await chatApi.archiveHistory(id, archived);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setSelectedConv(null);
        setMessages([]);
      }
      toast.success(archived ? 'Conversation archived' : 'Conversation unarchived');
    } catch {
      toast.error('Failed to update conversation');
    }
  }, [selectedId, toast]);

  // Delete
  const handleDelete = useCallback(async (id: string) => {
    const ok = await confirm({
      title: 'Delete Conversation',
      message: 'This conversation will be permanently deleted. This action cannot be undone.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await chatApi.deleteHistory(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setSelectedConv(null);
        setMessages([]);
      }
      toast.success('Conversation deleted');
    } catch {
      toast.error('Failed to delete conversation');
    }
  }, [selectedId, confirm, toast]);

  if (isLoading) {
    return <LoadingSpinner message="Loading chat history..." />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-3">
          <History className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Chat History
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
              {showArchived ? ' (archived)' : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-text-muted dark:text-dark-text-muted">
            <span className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-success' : 'bg-text-muted'}`} />
            {wsStatus === 'connected' ? 'Live' : 'Offline'}
          </div>

          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              showArchived
                ? 'bg-primary text-white'
                : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
            }`}
          >
            <Archive className="w-4 h-4" />
            Archived
          </button>

          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-5 h-5 text-text-secondary dark:text-dark-text-secondary ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Conversation List Sidebar */}
        <aside className="w-80 border-r border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-border dark:border-dark-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border text-sm text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted dark:text-dark-text-muted p-4">
                <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm">No conversations found</p>
              </div>
            ) : (
              <div className="divide-y divide-border dark:divide-dark-border">
                {conversations.map((conv) => {
                  const source = getSource(conv);
                  const isSelected = selectedId === conv.id;

                  return (
                    <button
                      key={conv.id}
                      onClick={() => selectConversation(conv.id)}
                      className={`w-full text-left px-4 py-3 transition-colors ${
                        isSelected
                          ? 'bg-primary/10'
                          : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className={`text-sm font-medium truncate flex-1 ${
                          isSelected
                            ? 'text-primary'
                            : 'text-text-primary dark:text-dark-text-primary'
                        }`}>
                          {conv.title || 'Untitled'}
                        </h4>
                        <span className="text-[10px] text-text-muted dark:text-dark-text-muted whitespace-nowrap flex-shrink-0">
                          {formatDate(conv.updatedAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1.5">
                        <SourceBadge source={source} />
                        {conv.agentName && (
                          <span className="text-[10px] text-text-muted dark:text-dark-text-muted truncate">
                            {conv.agentName}
                          </span>
                        )}
                        <span className="text-[10px] text-text-muted dark:text-dark-text-muted ml-auto flex-shrink-0">
                          {conv.messageCount} msg{conv.messageCount !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {conv.model && (
                        <div className="text-[10px] text-text-muted dark:text-dark-text-muted mt-1 truncate">
                          {conv.provider}/{conv.model}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Message Thread */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted dark:text-dark-text-muted">
              <History className="w-16 h-16 mb-4 opacity-20" />
              <p>Select a conversation to view</p>
              <p className="text-sm mt-1">
                All chat sessions from Web UI and Telegram are stored here
              </p>
            </div>
          ) : isLoadingMessages ? (
            <LoadingSpinner message="Loading messages..." />
          ) : (
            <>
              {/* Conversation Header */}
              {selectedConv && (
                <div className="flex items-center gap-3 px-6 py-3 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
                  <button
                    onClick={() => {
                      setSelectedId(null);
                      setSelectedConv(null);
                      setMessages([]);
                    }}
                    className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary lg:hidden"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary truncate">
                        {selectedConv.title || 'Untitled'}
                      </h3>
                      <SourceBadge source={getSource(selectedConv)} />
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-text-muted dark:text-dark-text-muted mt-0.5">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatFullDate(selectedConv.createdAt)}
                      </span>
                      {selectedConv.model && (
                        <span>{selectedConv.provider}/{selectedConv.model}</span>
                      )}
                      <span>{selectedConv.messageCount} messages</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleArchive(selectedConv.id, !selectedConv.isArchived)}
                      className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted"
                      title={selectedConv.isArchived ? 'Unarchive' : 'Archive'}
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(selectedConv.id)}
                      className="p-1.5 rounded-lg hover:bg-error/10 text-text-muted dark:text-dark-text-muted hover:text-error"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="space-y-4 max-w-3xl mx-auto">
                  {messages.map((msg) => {
                    const isAssistant = msg.role === 'assistant';
                    const isSystem = msg.role === 'system' || msg.role === 'tool';

                    if (isSystem) {
                      return (
                        <div key={msg.id} className="flex justify-center">
                          <div className="px-3 py-1.5 rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary text-[11px] text-text-muted dark:text-dark-text-muted max-w-[80%] truncate">
                            {msg.role === 'tool' ? `Tool: ${msg.content.slice(0, 100)}` : msg.content.slice(0, 100)}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}
                      >
                        <div className={`flex gap-2 max-w-[80%] ${isAssistant ? 'flex-row' : 'flex-row-reverse'}`}>
                          {/* Avatar */}
                          <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                            isAssistant
                              ? 'bg-primary/10 text-primary'
                              : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted'
                          }`}>
                            {isAssistant
                              ? <Bot className="w-4 h-4" />
                              : <User className="w-4 h-4" />
                            }
                          </div>

                          {/* Bubble */}
                          <div
                            className={`rounded-2xl px-4 py-2.5 ${
                              isAssistant
                                ? 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary rounded-tl-md'
                                : 'bg-primary text-white rounded-tr-md'
                            }`}
                          >
                            <MarkdownContent content={msg.content} compact className="text-sm" />

                            {/* Tool calls indicator */}
                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                              <div className={`mt-2 pt-2 border-t ${
                                isAssistant ? 'border-border/50 dark:border-dark-border/50' : 'border-white/20'
                              }`}>
                                <p className={`text-[10px] ${isAssistant ? 'text-text-muted dark:text-dark-text-muted' : 'text-white/60'}`}>
                                  Used {msg.toolCalls.length} tool{msg.toolCalls.length !== 1 ? 's' : ''}:
                                  {' '}{msg.toolCalls.map(tc => tc.name).join(', ')}
                                </p>
                              </div>
                            )}

                            {/* Timestamp */}
                            <div className={`mt-1 text-[10px] ${
                              isAssistant ? 'text-text-muted dark:text-dark-text-muted' : 'text-white/50'
                            }`}>
                              {formatDate(msg.createdAt)}
                              {msg.model && (
                                <span className="ml-2">{msg.model}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
