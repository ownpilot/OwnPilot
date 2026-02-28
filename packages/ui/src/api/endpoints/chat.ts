/**
 * Chat API Endpoints
 */

import { apiClient } from '../client';
import type { StreamOptions } from '../client';
import type { Conversation, HistoryMessage, UnifiedMessage, ChannelInfo } from '../types';
import type { ContextBreakdown } from '../../types';

export interface ChatRequestBody {
  message: string;
  provider: string;
  model: string;
  stream?: boolean;
  agentId?: string;
  workspaceId?: string;
  directTools?: string[];
  includeToolList?: boolean;
  historyLength?: number;
}

export const chatApi = {
  /** Send a chat message — returns raw Response for SSE streaming */
  send: (body: ChatRequestBody, options?: StreamOptions) =>
    apiClient.stream('/chat', body, options),
  /** Reset conversation context */
  resetContext: (provider: string, model: string) =>
    apiClient.post<void>('/chat/reset-context', { provider, model }),

  // ---- Chat History ----

  /** List conversations with pagination and filters */
  listHistory: (params?: {
    limit?: number;
    offset?: number;
    search?: string;
    agentId?: string;
    archived?: boolean;
  }) =>
    apiClient.get<{
      conversations: Conversation[];
      total: number;
      limit: number;
      offset: number;
    }>('/chat/history', {
      params: params as Record<string, string | number | boolean | undefined>,
    }),

  /** Get a single conversation with all messages */
  getHistory: (id: string) =>
    apiClient.get<{
      conversation: Conversation;
      messages: HistoryMessage[];
    }>(`/chat/history/${id}`),

  /** Get unified conversation (merges AI + channel messages) */
  getUnifiedHistory: (id: string) =>
    apiClient.get<{
      conversation: Conversation & {
        source: 'web' | 'channel';
        channelPlatform?: string;
        channelSenderName?: string;
      };
      messages: UnifiedMessage[];
      channelInfo?: ChannelInfo | null;
    }>(`/chat/history/${id}/unified`),

  /** Send a reply from WebUI to a channel conversation */
  channelReply: (conversationId: string, text: string) =>
    apiClient.post<{
      sent: boolean;
      messageId: string;
      channelPluginId: string;
    }>(`/chat/history/${conversationId}/channel-reply`, { text }),

  /** Delete a conversation */
  deleteHistory: (id: string) => apiClient.delete<{ deleted: boolean }>(`/chat/history/${id}`),

  /** Archive or unarchive a conversation */
  archiveHistory: (id: string, archived: boolean) =>
    apiClient.patch<{ archived: boolean }>(`/chat/history/${id}/archive`, { archived }),

  // ---- Bulk Operations ----

  /** Bulk delete conversations by IDs */
  bulkDeleteHistory: (ids: string[]) =>
    apiClient.post<{ deleted: number }>('/chat/history/bulk-delete', { ids }),

  /** Delete all conversations */
  deleteAllHistory: () =>
    apiClient.post<{ deleted: number }>('/chat/history/bulk-delete', { all: true }),

  /** Delete conversations older than N days */
  deleteOldHistory: (olderThanDays: number) =>
    apiClient.post<{ deleted: number }>('/chat/history/bulk-delete', { olderThanDays }),

  /** Bulk archive/unarchive conversations */
  bulkArchiveHistory: (ids: string[], archived: boolean) =>
    apiClient.post<{ updated: number; archived: boolean }>('/chat/history/bulk-archive', {
      ids,
      archived,
    }),

  // ---- Context Management ----

  /** Get detailed context breakdown for current session */
  getContextDetail: (provider: string, model: string) =>
    apiClient.get<{ breakdown: ContextBreakdown | null }>('/chat/context-detail', {
      params: { provider, model } as Record<string, string>,
    }),

  /** Compact conversation context by summarizing old messages */
  compactContext: (provider: string, model: string, keepRecentMessages?: number) =>
    apiClient.post<{
      compacted: boolean;
      summary?: string;
      removedMessages: number;
      newTokenEstimate: number;
    }>('/chat/compact', { provider, model, keepRecentMessages }),
};
