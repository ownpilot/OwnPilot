/**
 * Summary & Costs API Endpoints
 */

import { apiClient } from '../client';
import type { SummaryData, CostsData } from '../../types';
import type { CostSummary, BudgetStatus, ProviderBreakdown, DailyUsage } from '../types';

export const summaryApi = {
  get: () => apiClient.get<SummaryData>('/summary'),
};

export const costsApi = {
  usage: () => apiClient.get<CostsData>('/costs/usage'),
  getSummary: (period: string) =>
    apiClient.get<{ summary: CostSummary; budget: BudgetStatus }>('/costs', {
      params: { period },
    }),
  getBreakdown: (period: string) =>
    apiClient.get<{ byProvider: ProviderBreakdown[]; daily: DailyUsage[] }>('/costs/breakdown', {
      params: { period },
    }),
  setBudget: (budget: { dailyLimit?: number; weeklyLimit?: number; monthlyLimit?: number }) =>
    apiClient.post<{ status: BudgetStatus }>('/costs/budget', budget),
};
