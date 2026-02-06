/**
 * Inbox Page — Read-Only Conversation View
 *
 * Displays Telegram conversations (incoming user messages + outgoing assistant responses)
 * in a chat-like thread. All interaction happens through Telegram; this is a log viewer.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, Telegram, Globe, RefreshCw, Check } from '../components/icons';
import { channelsApi } from '../api';
import type { Channel, ChannelMessage } from '../api';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { MarkdownContent } from '../components/MarkdownContent';


// Helper to get channel icon
function ChannelIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case 'telegram':
      return <Telegram className={className} />;
    default:
      return <Globe className={className} />;
  }
}

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Status badge color
function getStatusColor(status: string): string {
  switch (status) {
    case 'connected':
      return 'bg-success';
    case 'connecting':
      return 'bg-warning';
    case 'error':
      return 'bg-error';
    default:
      return 'bg-text-muted';
  }
}

export function InboxPage() {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch channels from API
  const fetchChannels = useCallback(async () => {
    try {
      const data = await channelsApi.list();
      setChannels(data.channels);
    } catch {
      setError('Failed to load channels');
    }
  }, []);

  // Fetch inbox messages from API
  const fetchInbox = useCallback(async (channelType?: string) => {
    try {
      const data = await channelsApi.inbox({
        limit: 200,
        ...(channelType && { channelType }),
      });
      setMessages(data.messages);
      setUnreadCount(data.unreadCount);
    } catch {
      setError('Failed to load messages');
    }
  }, []);

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchChannels(), fetchInbox()])
      .finally(() => setIsLoading(false));
  }, [fetchChannels, fetchInbox]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const channelType = selectedChannel
        ? channels.find(c => c.id === selectedChannel)?.type
        : undefined;
      fetchInbox(channelType);
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchInbox, selectedChannel, channels]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Refresh data
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);

    const channelType = selectedChannel
      ? channels.find(c => c.id === selectedChannel)?.type
      : undefined;

    await Promise.all([fetchChannels(), fetchInbox(channelType)]);
    setIsRefreshing(false);
  }, [fetchChannels, fetchInbox, selectedChannel, channels]);

  // Filter messages by channel
  const filteredMessages = selectedChannel
    ? messages.filter((m) => m.channelId === selectedChannel)
    : messages;

  // Sort by timestamp (oldest first for conversation reading order)
  const sortedMessages = [...filteredMessages].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Mark message as read on view
  const markAsRead = useCallback(async (messageId: string) => {
    try {
      await channelsApi.markRead(messageId);
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, read: true } : m
      ));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {
      // Non-critical
    }
  }, []);

  // Mark all visible unread messages as read
  useEffect(() => {
    const unread = filteredMessages.filter(m => !m.read && m.direction === 'incoming');
    for (const m of unread) {
      markAsRead(m.id);
    }
  }, [filteredMessages, markAsRead]);

  // Calculate unread per channel
  const getChannelUnread = (channelId: string) => {
    return messages.filter(m => m.channelId === channelId && !m.read).length;
  };

  // Loading state
  if (isLoading && messages.length === 0) {
    return <LoadingSpinner message="Loading inbox..." />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-3">
          <Inbox className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Inbox
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              {unreadCount > 0 ? `${unreadCount} unread` : 'Telegram conversation log'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {error && (
            <span className="text-sm text-error">{error}</span>
          )}

          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${channels.some(c => c.status === 'connected') ? 'bg-success' : 'bg-text-muted'}`} />
            <span className="text-text-muted dark:text-dark-text-muted">
              {channels.filter(c => c.status === 'connected').length} connected
            </span>
          </div>

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
        {/* Channel Sidebar */}
        <aside className="w-64 border-r border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary overflow-y-auto">
          <div className="p-4">
            <h3 className="text-sm font-medium text-text-muted dark:text-dark-text-muted mb-3">
              Channels ({channels.length})
            </h3>

            {/* All Messages */}
            <button
              onClick={() => {
                setSelectedChannel(null);
                fetchInbox();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors mb-2 ${
                selectedChannel === null
                  ? 'bg-primary text-white'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
            >
              <Inbox className="w-5 h-5" />
              <span className="flex-1 text-left">All Messages</span>
              {unreadCount > 0 && (
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    selectedChannel === null ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                  }`}
                >
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Channel List */}
            <div className="space-y-1">
              {channels.length === 0 ? (
                <p className="text-sm text-text-muted dark:text-dark-text-muted py-2 px-3">
                  No channels connected
                </p>
              ) : (
                channels.map((channel) => {
                  const channelUnread = getChannelUnread(channel.id);
                  return (
                    <button
                      key={channel.id}
                      onClick={() => {
                        setSelectedChannel(channel.id);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                        selectedChannel === channel.id
                          ? 'bg-primary text-white'
                          : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                      }`}
                    >
                      <div className="relative flex-shrink-0">
                        <ChannelIcon type={channel.type} className="w-5 h-5" />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-bg-secondary dark:border-dark-bg-secondary ${getStatusColor(channel.status)}`}
                        />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <span className="block truncate">{channel.name}</span>
                        {channel.botInfo?.username && (
                          <span className={`text-xs truncate block ${
                            selectedChannel === channel.id ? 'text-white/70' : 'text-text-muted dark:text-dark-text-muted'
                          }`}>
                            @{channel.botInfo.username}
                          </span>
                        )}
                      </div>
                      {channelUnread > 0 && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs ${
                            selectedChannel === channel.id ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                          }`}
                        >
                          {channelUnread}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        {/* Conversation Thread */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {sortedMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted dark:text-dark-text-muted">
                <Inbox className="w-16 h-16 mb-4 opacity-20" />
                <p>No messages yet</p>
                <p className="text-sm mt-1">
                  {channels.length === 0
                    ? 'Configure Telegram in Config Center to start receiving messages'
                    : 'Messages will appear here when you chat via Telegram'}
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-w-3xl mx-auto">
                {sortedMessages.map((message) => {
                  const isOutgoing = message.direction === 'outgoing';

                  return (
                    <div
                      key={message.id}
                      className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                          isOutgoing
                            ? 'bg-primary text-white rounded-br-md'
                            : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary rounded-bl-md'
                        }`}
                      >
                        {/* Sender name for incoming */}
                        {!isOutgoing && (
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-medium ${
                              isOutgoing ? 'text-white/70' : 'text-text-muted dark:text-dark-text-muted'
                            }`}>
                              {message.sender.name}
                            </span>
                          </div>
                        )}
                        {isOutgoing && (
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-white/70">
                              Assistant
                            </span>
                          </div>
                        )}

                        {/* Message content */}
                        <MarkdownContent content={message.content} compact className="text-sm" />

                        {/* Timestamp + status */}
                        <div className={`flex items-center gap-1.5 mt-1 ${
                          isOutgoing ? 'justify-end' : 'justify-start'
                        }`}>
                          <span className={`text-[10px] ${
                            isOutgoing ? 'text-white/50' : 'text-text-muted dark:text-dark-text-muted'
                          }`}>
                            {formatTimestamp(message.timestamp)}
                          </span>
                          {isOutgoing && (
                            <Check className="w-3 h-3 text-white/50" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Read-only footer */}
          <div className="px-6 py-3 border-t border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
            <p className="text-xs text-center text-text-muted dark:text-dark-text-muted">
              Conversations happen on Telegram. This is a read-only log.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
