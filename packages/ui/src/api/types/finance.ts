// Expenses, Costs, and Dashboard types

export interface ExpenseEntry {
  id: string;
  date: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  paymentMethod?: string;
  tags?: string[];
  source: string;
  notes?: string;
}

export interface ExpenseMonthData {
  month: string;
  monthNum: string;
  total: number;
  count: number;
  byCategory: Record<string, number>;
}

export interface ExpenseCategoryInfo {
  budget?: number;
  color?: string;
}

export interface ExpenseMonthlyResponse {
  year: number;
  months: ExpenseMonthData[];
  yearTotal: number;
  expenseCount: number;
  categories: Record<string, ExpenseCategoryInfo>;
}

export interface ExpenseSummaryResponse {
  period: {
    name: string;
    startDate: string;
    endDate: string;
  };
  summary: {
    totalExpenses: number;
    grandTotal: number;
    dailyAverage: number;
    totalByCurrency: Record<string, number>;
    totalByCategory: Record<string, number>;
    topCategories: Array<{
      category: string;
      amount: number;
      percentage: number;
      color: string;
    }>;
    biggestExpenses: ExpenseEntry[];
  };
  categories: Record<string, ExpenseCategoryInfo>;
}

// ---- Costs ----

export interface CostSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalCostFormatted: string;
  averageLatencyMs: number;
  periodStart: string;
  periodEnd: string;
}

export interface BudgetPeriod {
  spent: number;
  limit?: number;
  percentage: number;
  remaining?: number;
}

export interface BudgetStatus {
  daily: BudgetPeriod;
  weekly: BudgetPeriod;
  monthly: BudgetPeriod;
  alerts: Array<{
    type: string;
    threshold: number;
    currentSpend: number;
    limit: number;
    timestamp: string;
  }>;
}

export interface ProviderBreakdown {
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  costFormatted: string;
  percentOfTotal: number;
}

export interface DailyUsage {
  date: string;
  requests: number;
  cost: number;
  costFormatted: string;
  inputTokens: number;
  outputTokens: number;
}

// ---- Dashboard ----

export interface AIBriefing {
  id: string;
  summary: string;
  priorities: string[];
  insights: string[];
  suggestedFocusAreas: string[];
  generatedAt: string;
  expiresAt: string;
  modelUsed: string;
  cached: boolean;
}

export interface DailyBriefingData {
  tasks: {
    dueToday: Array<{
      id: string;
      title: string;
      dueDate?: string;
      priority: string;
      status: string;
    }>;
    overdue: Array<{
      id: string;
      title: string;
      dueDate?: string;
      priority: string;
      status: string;
    }>;
  };
  calendar: {
    todayEvents: Array<{
      id: string;
      title: string;
      startTime: string;
      endTime?: string;
      description?: string;
    }>;
  };
  triggers: {
    scheduledToday: Array<{
      id: string;
      name: string;
      nextFire?: string;
      description?: string;
    }>;
  };
}
