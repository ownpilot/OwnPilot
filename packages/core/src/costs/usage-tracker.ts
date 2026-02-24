/**
 * Usage Tracker
 *
 * Records and analyzes API usage.
 */

import { EventEmitter } from 'node:events';
import { getLog } from '../services/get-log.js';
import { generateId } from '../services/id-utils.js';
import type {
  AIProvider,
  DailyUsage,
  ModelUsage,
  ProviderUsage,
  UsageRecord,
  UsageSummary,
} from './types.js';
import { calculateCost } from './calculator.js';

export const costLog = getLog('Costs');

/** Maximum in-memory records to keep (prevents unbounded growth) */
export const MAX_RECORDS = 10_000;

/**
 * Usage Tracker - Records and analyzes API usage
 */
export class UsageTracker extends EventEmitter {
  private records: UsageRecord[] = [];
  private initialized = false;

  /**
   * Initialize tracker (no-op, kept for backward compatibility)
   */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /**
   * Record a usage event
   */
  async record(usage: Omit<UsageRecord, 'id' | 'timestamp' | 'cost'>): Promise<UsageRecord> {
    await this.ensureInitialized();

    const cost = calculateCost(usage.provider, usage.model, usage.inputTokens, usage.outputTokens);

    const record: UsageRecord = {
      ...usage,
      id: generateId('usage'),
      timestamp: new Date().toISOString(),
      cost,
    };

    this.records.push(record);

    // Cap in-memory records to prevent unbounded growth
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }

    // Emit event for real-time tracking
    this.emit('usage', record);

    return record;
  }

  /**
   * Get usage for a time period
   */
  async getUsage(
    startDate: Date,
    endDate: Date = new Date(),
    filters?: {
      userId?: string;
      provider?: AIProvider;
      model?: string;
    }
  ): Promise<UsageRecord[]> {
    await this.ensureInitialized();

    return this.records.filter((r) => {
      const timestamp = new Date(r.timestamp);
      if (timestamp < startDate || timestamp > endDate) return false;
      if (filters?.userId && r.userId !== filters.userId) return false;
      if (filters?.provider && r.provider !== filters.provider) return false;
      if (filters?.model && r.model !== filters.model) return false;
      return true;
    });
  }

  /**
   * Get usage summary
   */
  async getSummary(
    startDate: Date,
    endDate: Date = new Date(),
    userId?: string
  ): Promise<UsageSummary> {
    const records = await this.getUsage(startDate, endDate, { userId });

    const summary: UsageSummary = {
      periodStart: startDate.toISOString(),
      periodEnd: endDate.toISOString(),
      totalRequests: records.length,
      successfulRequests: records.filter((r) => !r.error).length,
      failedRequests: records.filter((r) => r.error).length,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      averageLatencyMs: 0,
      byProvider: {} as Record<AIProvider, ProviderUsage>,
      byModel: {},
      byUser: {},
      daily: [],
    };

    // Daily buckets
    const dailyMap = new Map<string, DailyUsage>();

    // Process each record
    let totalLatency = 0;
    for (const record of records) {
      summary.totalInputTokens += record.inputTokens;
      summary.totalOutputTokens += record.outputTokens;
      summary.totalCost += record.cost;
      totalLatency += record.latencyMs;

      // By provider
      if (!summary.byProvider[record.provider]) {
        summary.byProvider[record.provider] = {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          averageLatencyMs: 0,
        };
      }
      const providerStats = summary.byProvider[record.provider];
      providerStats.requests++;
      providerStats.inputTokens += record.inputTokens;
      providerStats.outputTokens += record.outputTokens;
      providerStats.cost += record.cost;
      providerStats.averageLatencyMs += record.latencyMs;

      // By model
      if (!summary.byModel[record.model]) {
        summary.byModel[record.model] = {
          provider: record.provider,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          averageLatencyMs: 0,
        };
      }
      const modelStats = summary.byModel[record.model]!;
      modelStats.requests++;
      modelStats.inputTokens += record.inputTokens;
      modelStats.outputTokens += record.outputTokens;
      modelStats.cost += record.cost;
      modelStats.averageLatencyMs += record.latencyMs;

      // By user
      summary.byUser[record.userId] = (summary.byUser[record.userId] ?? 0) + record.cost;

      // Daily
      const dateKey = record.timestamp.split('T')[0]!;
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          requests: 0,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
        });
      }
      const daily = dailyMap.get(dateKey)!;
      daily.requests++;
      daily.cost += record.cost;
      daily.inputTokens += record.inputTokens;
      daily.outputTokens += record.outputTokens;
    }

    // Calculate averages
    if (records.length > 0) {
      summary.averageLatencyMs = totalLatency / records.length;

      for (const provider of Object.keys(summary.byProvider) as AIProvider[]) {
        const stats = summary.byProvider[provider];
        stats.averageLatencyMs = stats.averageLatencyMs / stats.requests;
      }

      for (const model of Object.keys(summary.byModel)) {
        const stats = summary.byModel[model]!;
        stats.averageLatencyMs = stats.averageLatencyMs / stats.requests;
      }
    }

    // Sort daily by date
    summary.daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return summary;
  }

  /**
   * Get today's usage
   */
  async getTodayUsage(userId?: string): Promise<UsageSummary> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.getSummary(today, new Date(), userId);
  }

  /**
   * Get this week's usage
   */
  async getWeekUsage(userId?: string): Promise<UsageSummary> {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);
    return this.getSummary(weekStart, now, userId);
  }

  /**
   * Get this month's usage
   */
  async getMonthUsage(userId?: string): Promise<UsageSummary> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.getSummary(monthStart, now, userId);
  }

  /**
   * Get most expensive requests
   */
  async getMostExpensiveRequests(limit: number = 10, startDate?: Date): Promise<UsageRecord[]> {
    await this.ensureInitialized();

    let records = this.records;
    if (startDate) {
      records = records.filter((r) => new Date(r.timestamp) >= startDate);
    }

    return records.sort((a, b) => b.cost - a.cost).slice(0, limit);
  }

  /**
   * Export usage data
   */
  async exportUsage(
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    const records = await this.getUsage(startDate, endDate);

    if (format === 'csv') {
      const headers = [
        'id',
        'timestamp',
        'userId',
        'provider',
        'model',
        'inputTokens',
        'outputTokens',
        'cost',
        'latencyMs',
        'requestType',
      ].join(',');

      const rows = records.map((r) =>
        [
          r.id,
          r.timestamp,
          r.userId,
          r.provider,
          r.model,
          r.inputTokens,
          r.outputTokens,
          r.cost.toFixed(6),
          r.latencyMs,
          r.requestType,
        ].join(',')
      );

      return [headers, ...rows].join('\n');
    }

    return JSON.stringify(records, null, 2);
  }

  // Private methods

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
