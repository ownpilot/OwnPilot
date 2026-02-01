/**
 * Summary & Costs API Endpoints
 */

import { apiClient } from '../client';
import type { SummaryData, CostsData } from '../../types';

export const summaryApi = {
  get: () => apiClient.get<SummaryData>('/summary'),
};

export const costsApi = {
  usage: () => apiClient.get<CostsData>('/costs/usage'),
  getSummary: (period: string) =>
    apiClient.get<{ summary: Record<string, unknown>; budget: Record<string, unknown> }>('/costs', {
      params: { period },
    }),
  getBreakdown: (period: string) =>
    apiClient.get<{ byProvider: Record<string, unknown>[]; daily: Record<string, unknown>[] }>(
      '/costs/breakdown',
      { params: { period } },
    ),
  setBudget: (budget: {
    dailyLimit?: number;
    weeklyLimit?: number;
    monthlyLimit?: number;
  }) => apiClient.post<{ status: Record<string, unknown> }>('/costs/budget', budget),
};
