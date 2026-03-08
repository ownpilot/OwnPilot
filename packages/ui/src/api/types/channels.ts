// Channels and Chat History types

export interface Channel {
  id: string;
  type: string;
  name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  icon?: string;
  botInfo?: {
    username: string;
    firstName: string;
  };
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  channelType: string;
  sender: {
    id: string;
    name: string;
    avatar?: string;
  };
  content: string;
  timestamp: string;
  read: boolean;
  replied: boolean;
  direction: 'incoming' | 'outgoing';
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelUser {
  id: string;
  platform: string;
  platformUserId: string;
  platformUsername?: string;
  displayName?: string;
  isVerified: boolean;
  isBlocked: boolean;
  lastSeenAt: string;
}

export interface ChannelStats {
  totalMessages: number;
  todayMessages: number;
  weekMessages: number;
  lastActivityAt: string | null;
}

// ---- Chat History ----

export interface Conversation {
  id: string;
  title: string;
  agentId?: string;
  agentName?: string;
  provider?: string;
  model?: string;
  messageCount: number;
  isArchived: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** 'web' for UI chat, 'channel' for Telegram/Discord/etc. */
  source?: 'web' | 'channel';
  channelPlatform?: string | null;
  channelSenderName?: string | null;
}

export interface HistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  provider?: string;
  model?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  trace?: Record<string, unknown>;
  isError?: boolean;
  createdAt: string;
}

/** Unified message — used in channel conversations to merge AI + channel data. */
export interface UnifiedMessage {
  id: string;
  role: string;
  content: string;
  provider?: string | null;
  model?: string | null;
  toolCalls?: unknown[] | null;
  trace?: Record<string, unknown> | null;
  isError?: boolean;
  createdAt: string;
  source: 'channel' | 'ai' | 'web';
  direction: 'inbound' | 'outbound';
  senderName?: string;
  senderId?: string;
}

/** Channel info attached to unified conversation response. */
export interface ChannelInfo {
  platform: string;
  channelPluginId: string;
  platformChatId: string;
  senderName?: string;
  sessionId: string;
}
