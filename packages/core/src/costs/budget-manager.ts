/**
 * Budget Manager
 *
 * Manages spending limits and alerts.
 */

import { EventEmitter } from 'node:events';
import type { BudgetAlert, BudgetConfig, BudgetStatus, UsageRecord } from './types.js';
import type { UsageTracker } from './usage-tracker.js';
import { costLog } from './usage-tracker.js';

/**
 * Budget Manager - Manages spending limits and alerts
 */
export class BudgetManager extends EventEmitter {
  private readonly tracker: UsageTracker;
  private config: BudgetConfig;
  private alertsSent: Set<string> = new Set();

  constructor(tracker: UsageTracker, config?: Partial<BudgetConfig>) {
    super();
    this.tracker = tracker;
    this.config = {
      alertThresholds: [50, 75, 90, 100],
      limitAction: 'warn',
      ...config,
    };

    // Listen for usage events
    this.tracker.on('usage', (record: UsageRecord) => {
      this.checkBudget(record).catch((e) => costLog.error('Budget check failed:', e));
    });
  }

  /**
   * Configure budget
   */
  configure(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current budget status
   */
  async getStatus(): Promise<BudgetStatus> {
    const daily = await this.tracker.getTodayUsage();
    const weekly = await this.tracker.getWeekUsage();
    const monthly = await this.tracker.getMonthUsage();

    const status: BudgetStatus = {
      daily: {
        spent: daily.totalCost,
        limit: this.config.dailyLimit,
        percentage: this.config.dailyLimit ? (daily.totalCost / this.config.dailyLimit) * 100 : 0,
        remaining: this.config.dailyLimit
          ? Math.max(0, this.config.dailyLimit - daily.totalCost)
          : undefined,
      },
      weekly: {
        spent: weekly.totalCost,
        limit: this.config.weeklyLimit,
        percentage: this.config.weeklyLimit
          ? (weekly.totalCost / this.config.weeklyLimit) * 100
          : 0,
        remaining: this.config.weeklyLimit
          ? Math.max(0, this.config.weeklyLimit - weekly.totalCost)
          : undefined,
      },
      monthly: {
        spent: monthly.totalCost,
        limit: this.config.monthlyLimit,
        percentage: this.config.monthlyLimit
          ? (monthly.totalCost / this.config.monthlyLimit) * 100
          : 0,
        remaining: this.config.monthlyLimit
          ? Math.max(0, this.config.monthlyLimit - monthly.totalCost)
          : undefined,
      },
      alerts: [],
    };

    // Check for active alerts
    for (const threshold of this.config.alertThresholds) {
      if (status.daily.percentage >= threshold && this.config.dailyLimit) {
        status.alerts.push({
          type: 'daily',
          threshold,
          currentSpend: status.daily.spent,
          limit: this.config.dailyLimit,
          timestamp: new Date().toISOString(),
        });
      }
      if (status.weekly.percentage >= threshold && this.config.weeklyLimit) {
        status.alerts.push({
          type: 'weekly',
          threshold,
          currentSpend: status.weekly.spent,
          limit: this.config.weeklyLimit,
          timestamp: new Date().toISOString(),
        });
      }
      if (status.monthly.percentage >= threshold && this.config.monthlyLimit) {
        status.alerts.push({
          type: 'monthly',
          threshold,
          currentSpend: status.monthly.spent,
          limit: this.config.monthlyLimit,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return status;
  }

  /**
   * Check if a request is within budget
   */
  async canSpend(estimatedCost: number): Promise<{
    allowed: boolean;
    reason?: string;
    recommendation?: string;
  }> {
    const status = await this.getStatus();

    // Check per-request limit
    if (this.config.perRequestLimit && estimatedCost > this.config.perRequestLimit) {
      return {
        allowed: this.config.limitAction === 'warn',
        reason: `Request cost ($${estimatedCost.toFixed(4)}) exceeds per-request limit ($${this.config.perRequestLimit.toFixed(4)})`,
        recommendation: this.config.fallbackModel
          ? `Consider using ${this.config.fallbackModel} instead`
          : 'Consider using a cheaper model',
      };
    }

    // Check daily limit
    if (this.config.dailyLimit) {
      const newDaily = status.daily.spent + estimatedCost;
      if (newDaily > this.config.dailyLimit) {
        return {
          allowed: this.config.limitAction === 'warn',
          reason: `Daily budget exceeded ($${newDaily.toFixed(4)} > $${this.config.dailyLimit.toFixed(4)})`,
          recommendation: 'Wait until tomorrow or increase daily limit',
        };
      }
    }

    // Check weekly limit
    if (this.config.weeklyLimit) {
      const newWeekly = status.weekly.spent + estimatedCost;
      if (newWeekly > this.config.weeklyLimit) {
        return {
          allowed: this.config.limitAction === 'warn',
          reason: `Weekly budget exceeded ($${newWeekly.toFixed(4)} > $${this.config.weeklyLimit.toFixed(4)})`,
          recommendation: 'Wait until next week or increase weekly limit',
        };
      }
    }

    // Check monthly limit
    if (this.config.monthlyLimit) {
      const newMonthly = status.monthly.spent + estimatedCost;
      if (newMonthly > this.config.monthlyLimit) {
        return {
          allowed: this.config.limitAction === 'warn',
          reason: `Monthly budget exceeded ($${newMonthly.toFixed(4)} > $${this.config.monthlyLimit.toFixed(4)})`,
          recommendation: 'Wait until next month or increase monthly limit',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check budget after usage and emit alerts
   */
  private async checkBudget(_record: UsageRecord): Promise<void> {
    const status = await this.getStatus();

    for (const alert of status.alerts) {
      const alertKey = `${alert.type}_${alert.threshold}`;

      // Only emit each alert once per day
      const today = new Date().toISOString().split('T')[0];
      const fullKey = `${alertKey}_${today}`;

      if (!this.alertsSent.has(fullKey)) {
        this.alertsSent.add(fullKey);
        this.emit('alert', alert);
      }
    }
  }
}
