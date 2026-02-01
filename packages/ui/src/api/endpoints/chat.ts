/**
 * Chat API Endpoints
 */

import { apiClient } from '../client';
import type { StreamOptions } from '../client';

export interface ChatRequestBody {
  message: string;
  provider: string;
  model: string;
  stream?: boolean;
  agentId?: string;
  workspaceId?: string;
  directTools?: string[];
  includeToolList?: boolean;
  history?: Array<{ role: string; content: string }>;
}

export const chatApi = {
  /** Send a chat message — returns raw Response for SSE streaming */
  send: (body: ChatRequestBody, options?: StreamOptions) =>
    apiClient.stream('/chat', body, options),
  /** Reset conversation context */
  resetContext: (provider: string, model: string) =>
    apiClient.post<void>('/chat/reset-context', { provider, model }),
};
