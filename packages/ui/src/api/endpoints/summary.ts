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
    apiClient.get<{
      byProvider: ProviderBreakdown[];
      byModel: ProviderBreakdown[];
      daily: DailyUsage[];
      totalCost: number;
    }>('/costs/breakdown', {
      params: { period },
    }),
  setBudget: (budget: { dailyLimit?: number; weeklyLimit?: number; monthlyLimit?: number }) =>
    apiClient.post<{ status: BudgetStatus }>('/costs/budget', budget),
  getSubscriptions: () =>
    apiClient.get<{
      subscriptions: Array<{
        providerId: string;
        displayName: string;
        billingType: string;
        monthlyCostUsd: number;
        planName?: string;
      }>;
      totalMonthlyUsd: number;
      counts: { subscription: number; payPerUse: number; free: number };
    }>('/costs/subscriptions'),
};
