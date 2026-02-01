/**
 * API Response Types
 *
 * Shared response shapes for endpoints used by multiple pages.
 * These correspond to the unwrapped `data` field from ApiResponse<T>.
 */

import type { ModelInfo, ProviderInfo, ProviderConfig } from './models';

/** GET /api/v1/models */
export interface ModelsData {
  models: ModelInfo[];
  configuredProviders: string[];
  availableProviders?: string[];
}

/** GET /api/v1/providers */
export interface ProvidersListData {
  providers: ProviderInfo[] | ProviderConfig[];
  total: number;
}

/** GET /api/v1/settings */
export interface SettingsData {
  configuredProviders: string[];
  localProviders?: { id: string; name: string; type: 'local' }[];
  demoMode: boolean;
  availableProviders: string[];
  defaultProvider: string | null;
  defaultModel: string | null;
}

/** GET /api/v1/providers/categories */
export interface CategoriesData {
  categories: Record<string, string[]>;
  uncategorized: string[];
}

/** GET /api/v1/summary */
export interface SummaryData {
  tasks: { total: number; pending: number; completed: number; overdue: number; dueToday: number };
  notes: { total: number; recent: number; pinned: number };
  bookmarks: { total: number; favorites: number };
  calendar: { total: number; today: number; upcoming: number };
  contacts: { total: number; favorites: number; upcomingBirthdays: number };
}

/** GET /api/v1/costs/usage */
export interface CostsData {
  daily: { totalTokens: number; totalCost: number };
  monthly: { totalTokens: number; totalCost: number };
}

/** Agent detail (extends base Agent from types/index.ts) */
export interface AgentDetail {
  id: string;
  name: string;
  provider: string;
  model: string;
  tools: string[];
  createdAt: string;
  updatedAt?: string;
  systemPrompt: string;
  config: {
    maxTokens: number;
    temperature: number;
    maxTurns: number;
    maxToolCalls: number;
    tools?: string[];
    toolGroups?: string[];
  };
}
