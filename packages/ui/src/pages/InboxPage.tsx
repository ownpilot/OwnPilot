/**
 * Unified Inbox Page
 *
 * Displays messages from all connected channels in a unified view
 * Connects to real channel API endpoints
 */

import { useState, useEffect, useCallback } from 'react';
import { Inbox, Telegram, Discord, Slack, Globe, RefreshCw, Send, Check, X, Plus, Loader, ChevronRight, AlertCircle, Zap } from '../components/icons';
import { channelsApi } from '../api';
import type { Channel, ChannelMessage } from '../api';


// Channel type config
interface ChannelTypeInfo {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: ChannelField[];
}

interface ChannelField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  placeholder?: string;
  required?: boolean;
  helpText?: string;
}

// Channel type configurations
const CHANNEL_TYPES: ChannelTypeInfo[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Connect a Telegram bot to receive messages',
    icon: Telegram,
    fields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        type: 'password',
        placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
        required: true,
        helpText: 'Get this from @BotFather on Telegram',
      },
      {
        key: 'allowedUsers',
        label: 'Allowed User IDs',
        type: 'text',
        placeholder: '123456789, 987654321',
        helpText: 'Comma-separated user IDs (leave empty to allow all)',
      },
      {
        key: 'allowedChats',
        label: 'Allowed Chat IDs',
        type: 'text',
        placeholder: '-100123456789',
        helpText: 'Comma-separated chat IDs (leave empty to allow all)',
      },
    ],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Connect a Discord bot to receive messages',
    icon: Discord,
    fields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        type: 'password',
        placeholder: 'Your Discord bot token',
        required: true,
        helpText: 'Get this from Discord Developer Portal',
      },
      {
        key: 'applicationId',
        label: 'Application ID',
        type: 'text',
        placeholder: '123456789012345678',
        required: true,
        helpText: 'Your Discord application ID',
      },
      {
        key: 'allowedGuilds',
        label: 'Allowed Server IDs',
        type: 'text',
        placeholder: '123456789012345678',
        helpText: 'Comma-separated server IDs (leave empty to allow all)',
      },
      {
        key: 'allowedChannels',
        label: 'Allowed Channel IDs',
        type: 'text',
        placeholder: '123456789012345678',
        helpText: 'Comma-separated channel IDs (leave empty to allow all)',
      },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Connect a Slack app to receive messages',
    icon: Slack,
    fields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        type: 'password',
        placeholder: 'xoxb-...',
        required: true,
        helpText: 'Bot User OAuth Token from Slack App',
      },
      {
        key: 'appToken',
        label: 'App Token',
        type: 'password',
        placeholder: 'xapp-...',
        helpText: 'App-Level Token for Socket Mode (recommended)',
      },
      {
        key: 'signingSecret',
        label: 'Signing Secret',
        type: 'password',
        placeholder: 'Your signing secret',
        helpText: 'Required for webhook verification if not using Socket Mode',
      },
      {
        key: 'allowedWorkspaces',
        label: 'Allowed Workspace IDs',
        type: 'text',
        placeholder: 'T01234567',
        helpText: 'Comma-separated workspace IDs (leave empty to allow all)',
      },
    ],
  },
  {
    id: 'matrix',
    name: 'Matrix',
    description: 'Connect to Matrix/Element servers',
    icon: Globe,
    fields: [
      {
        key: 'homeserverUrl',
        label: 'Homeserver URL',
        type: 'text',
        placeholder: 'https://matrix.org',
        required: true,
        helpText: 'Your Matrix homeserver URL',
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        type: 'password',
        placeholder: 'Your Matrix access token',
        required: true,
        helpText: 'Get this from Element: Settings > Help & About > Access Token',
      },
      {
        key: 'userId',
        label: 'User ID',
        type: 'text',
        placeholder: '@bot:matrix.org',
        required: true,
        helpText: 'Your Matrix user ID (@user:server.com)',
      },
      {
        key: 'allowedRooms',
        label: 'Allowed Room IDs',
        type: 'text',
        placeholder: '!roomid:matrix.org',
        helpText: 'Comma-separated room IDs (leave empty to allow all)',
      },
    ],
  },
  {
    id: 'webchat',
    name: 'Web Chat',
    description: 'Embed a chat widget on your website',
    icon: Globe,
    fields: [
      {
        key: 'allowedOrigins',
        label: 'Allowed Origins',
        type: 'text',
        placeholder: 'https://example.com, https://app.example.com',
        helpText: 'Comma-separated origins for CORS (leave empty to allow all)',
      },
      {
        key: 'sessionTimeout',
        label: 'Session Timeout (ms)',
        type: 'text',
        placeholder: '3600000',
        helpText: 'Session timeout in milliseconds (default: 1 hour)',
      },
    ],
  },
];

// Helper to get channel icon
function ChannelIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case 'telegram':
      return <Telegram className={className} />;
    case 'discord':
      return <Discord className={className} />;
    case 'slack':
      return <Slack className={className} />;
    default:
      return <Globe className={className} />;
  }
}

// Helper to format time
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
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

// Add Channel Modal Component
function AddChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<'type' | 'config'>('type');
  const [selectedType, setSelectedType] = useState<ChannelTypeInfo | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    config: Record<string, string>;
  }>({ name: '', config: {} });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectType = (type: ChannelTypeInfo) => {
    setSelectedType(type);
    setFormData({ name: '', config: {} });
    setStep('config');
  };

  const handleFieldChange = (key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }));
  };

  const handleSubmit = async () => {
    if (!selectedType) return;

    // Validate required fields
    const missingFields = selectedType.fields
      .filter((f) => f.required && !formData.config[f.key]?.trim())
      .map((f) => f.label);

    if (!formData.name.trim()) {
      setError('Please enter a channel name');
      return;
    }

    if (missingFields.length > 0) {
      setError(`Missing required fields: ${missingFields.join(', ')}`);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Process config values
      const processedConfig: Record<string, unknown> = {};

      for (const field of selectedType.fields) {
        const value = formData.config[field.key];
        if (!value) continue;

        // Handle comma-separated values for array fields
        if (
          field.key.includes('allowed') ||
          field.key.includes('Origins')
        ) {
          processedConfig[field.key] = value
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
        } else if (field.key === 'sessionTimeout') {
          processedConfig[field.key] = parseInt(value, 10);
        } else {
          processedConfig[field.key] = value;
        }
      }

      await channelsApi.create({
        id: `${selectedType.id}-${Date.now()}`,
        type: selectedType.id,
        name: formData.name,
        config: processedConfig,
      });

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border dark:border-dark-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            {step === 'config' && selectedType && (
              <button
                onClick={() => setStep('type')}
                className="p-1 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded"
              >
                <ChevronRight className="w-5 h-5 text-text-muted dark:text-dark-text-muted rotate-180" />
              </button>
            )}
            <div>
              <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                {step === 'type' ? 'Add Channel' : `Configure ${selectedType?.name}`}
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                {step === 'type'
                  ? 'Select a channel type to connect'
                  : 'Enter the required credentials'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-text-muted dark:text-dark-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'type' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {CHANNEL_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.id}
                    onClick={() => handleSelectType(type)}
                    className="p-4 border border-border dark:border-dark-border rounded-lg hover:border-primary hover:bg-primary/5 transition-colors text-left group"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className="p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary group-hover:bg-primary/10 transition-colors">
                        <Icon className="w-6 h-6 text-text-secondary dark:text-dark-text-secondary group-hover:text-primary" />
                      </div>
                      <span className="font-medium text-text-primary dark:text-dark-text-primary group-hover:text-primary">
                        {type.name}
                      </span>
                    </div>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      {type.description}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {step === 'config' && selectedType && (
            <div className="space-y-6">
              {/* Error Message */}
              {error && (
                <div className="p-4 bg-error/10 border border-error/20 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-error flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-error">{error}</p>
                </div>
              )}

              {/* Channel Name */}
              <div>
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                  Channel Name <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder={`My ${selectedType.name} Channel`}
                  className="w-full px-4 py-2 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                  A friendly name to identify this channel
                </p>
              </div>

              {/* Type-specific Fields */}
              {selectedType.fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                    {field.label}
                    {field.required && <span className="text-error"> *</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      value={formData.config[field.key] ?? ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={3}
                      className="w-full px-4 py-2 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono text-sm"
                    />
                  ) : (
                    <input
                      type={field.type}
                      value={formData.config[field.key] ?? ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full px-4 py-2 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono text-sm"
                    />
                  )}
                  {field.helpText && (
                    <p className="mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                      {field.helpText}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'config' && (
          <div className="p-6 border-t border-border dark:border-dark-border flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect Channel'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function InboxPage() {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<ChannelMessage | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [testingChannelId, setTestingChannelId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ channelId: string; success: boolean; message: string } | null>(null);

  // Send test message to a channel
  const handleTestChannel = useCallback(async (channel: Channel, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent selecting the channel

    if (channel.status !== 'connected') {
      setTestResult({
        channelId: channel.id,
        success: false,
        message: 'Channel is not connected',
      });
      setTimeout(() => setTestResult(null), 3000);
      return;
    }

    setTestingChannelId(channel.id);
    setTestResult(null);

    try {
      await channelsApi.send(channel.id, {
        content: `Test message from OwnPilot at ${new Date().toLocaleTimeString()}`,
      });

      setTestResult({
        channelId: channel.id,
        success: true,
        message: 'Test message sent!',
      });
    } catch (err) {
      setTestResult({
        channelId: channel.id,
        success: false,
        message: err instanceof Error ? err.message : 'Failed to send test',
      });
    } finally {
      setTestingChannelId(null);
      // Clear result after 3 seconds
      setTimeout(() => setTestResult(null), 3000);
    }
  }, []);

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
        limit: 100,
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

  // Sort by timestamp (newest first)
  const sortedMessages = [...filteredMessages].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Mark message as read
  const markAsRead = useCallback(async (messageId: string) => {
    try {
      await channelsApi.markRead(messageId);
      setMessages(prev => prev.map(m =>
        m.id === messageId ? { ...m, read: true } : m
      ));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {
      // Non-critical — optimistic update not reverted
    }
  }, []);

  // Handle reply
  const handleReply = useCallback(async () => {
    if (!selectedMessage || !replyContent.trim()) return;

    setIsLoading(true);

    try {
      // For Telegram, use chatId from metadata or sender ID (for private chats, sender ID == chat ID)
      const chatId = selectedMessage.metadata?.chatId ?? (
        selectedMessage.channelType === 'telegram' ? selectedMessage.sender.id : undefined
      );

      await channelsApi.send(selectedMessage.channelId, {
        content: replyContent,
        replyToId: selectedMessage.id,
        ...(chatId && { chatId }),
      });

      // Clear reply state
      setReplyContent('');
      setSelectedMessage(null);

      // Refresh messages
      await fetchInbox();
    } catch {
      setError('Failed to send reply');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMessage, replyContent, fetchInbox]);

  // Calculate unread per channel
  const getChannelUnread = (channelId: string) => {
    return messages.filter(m => m.channelId === channelId && !m.read).length;
  };

  // Loading state
  if (isLoading && messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted dark:text-dark-text-muted">
        <Loader className="w-8 h-8 mb-4 animate-spin" />
        <p>Loading inbox...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-3">
          <Inbox className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Unified Inbox
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              {unreadCount > 0 ? `${unreadCount} unread messages` : 'All caught up!'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Error message */}
          {error && (
            <span className="text-sm text-error">{error}</span>
          )}

          {/* Connection Status */}
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${channels.some(c => c.status === 'connected') ? 'bg-success' : 'bg-text-muted'}`} />
            <span className="text-text-muted dark:text-dark-text-muted">
              {channels.filter(c => c.status === 'connected').length} connected
            </span>
          </div>

          {/* Refresh Button */}
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
                  const isTesting = testingChannelId === channel.id;
                  const channelTestResult = testResult?.channelId === channel.id ? testResult : null;
                  return (
                    <div key={channel.id} className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setSelectedChannel(channel.id);
                          // Filter will be done locally, no need to refetch
                        }}
                        className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
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
                      {/* Test Button */}
                      <button
                        onClick={(e) => handleTestChannel(channel, e)}
                        disabled={isTesting}
                        title={channel.status === 'connected' ? 'Send test message' : 'Channel not connected'}
                        className={`p-1.5 rounded transition-colors flex-shrink-0 ${
                          channelTestResult?.success
                            ? 'text-success bg-success/10'
                            : channelTestResult && !channelTestResult.success
                            ? 'text-error bg-error/10'
                            : channel.status === 'connected'
                            ? 'text-text-muted hover:text-primary hover:bg-primary/10'
                            : 'text-text-muted/50 cursor-not-allowed'
                        }`}
                      >
                        {isTesting ? (
                          <Loader className="w-4 h-4 animate-spin" />
                        ) : channelTestResult?.success ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Zap className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Add Channel Button */}
            <button
              onClick={() => setShowAddModal(true)}
              className="w-full mt-4 px-3 py-2 border-2 border-dashed border-border dark:border-dark-border rounded-lg text-text-muted dark:text-dark-text-muted hover:border-primary hover:text-primary transition-colors text-sm flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Channel
            </button>
          </div>
        </aside>

        {/* Message List */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            {sortedMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted dark:text-dark-text-muted">
                <Inbox className="w-16 h-16 mb-4 opacity-20" />
                <p>No messages yet</p>
                <p className="text-sm mt-1">
                  {channels.length === 0
                    ? 'Connect a channel to start receiving messages'
                    : 'Messages will appear here when received'}
                </p>
                {channels.length === 0 && (
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="mt-4 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Your First Channel
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border dark:divide-dark-border">
                {sortedMessages.map((message) => {
                  const channel = channels.find((c) => c.id === message.channelId);
                  const isSelected = selectedMessage?.id === message.id;

                  return (
                    <div
                      key={message.id}
                      onClick={() => {
                        setSelectedMessage(isSelected ? null : message);
                        if (!message.read) {
                          markAsRead(message.id);
                        }
                      }}
                      className={`p-4 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-primary/5 dark:bg-primary/10'
                          : 'hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                      } ${!message.read ? 'bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Channel Icon / Avatar */}
                        <div className="relative flex-shrink-0">
                          {message.sender.avatar ? (
                            <img
                              src={message.sender.avatar}
                              alt={message.sender.name}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary flex items-center justify-center">
                              <ChannelIcon type={message.channelType} className="w-5 h-5 text-text-secondary dark:text-dark-text-secondary" />
                            </div>
                          )}
                          {!message.read && (
                            <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-primary border-2 border-white dark:border-dark-bg-primary" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`font-medium truncate ${!message.read ? 'text-text-primary dark:text-dark-text-primary' : 'text-text-secondary dark:text-dark-text-secondary'}`}>
                                {message.sender.name}
                              </span>
                              <span className="text-xs text-text-muted dark:text-dark-text-muted">
                                via {channel?.name ?? message.channelType}
                              </span>
                            </div>
                            <span className="text-xs text-text-muted dark:text-dark-text-muted flex-shrink-0">
                              {formatTime(message.timestamp)}
                            </span>
                          </div>

                          <p className={`mt-1 line-clamp-2 ${!message.read ? 'text-text-primary dark:text-dark-text-primary' : 'text-text-secondary dark:text-dark-text-secondary'}`}>
                            {message.content}
                          </p>

                          {/* Status */}
                          <div className="mt-2 flex items-center gap-2">
                            {message.replied && (
                              <span className="text-xs text-success flex items-center gap-1">
                                <Check className="w-3 h-3" /> Replied
                              </span>
                            )}
                            {!message.read && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                New
                              </span>
                            )}
                          </div>

                          {/* Reply Input (when selected) */}
                          {isSelected && (
                            <div className="mt-3 flex gap-2">
                              <input
                                type="text"
                                value={replyContent}
                                onChange={(e) => setReplyContent(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleReply();
                                  }
                                }}
                                placeholder="Type a reply..."
                                className="flex-1 px-3 py-2 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                              />
                              <button
                                onClick={handleReply}
                                disabled={!replyContent.trim() || isLoading}
                                className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                <Send className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setSelectedMessage(null)}
                                className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                              >
                                <X className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Channel Modal */}
      {showAddModal && (
        <AddChannelModal
          onClose={() => setShowAddModal(false)}
          onCreated={handleRefresh}
        />
      )}
    </div>
  );
}
