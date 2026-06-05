/**
 * Budget Forecaster
 *
 * Provides exhaustion forecasting based on rolling average cost per cycle.
 * Emits heartbeat.budget.warning events when budget depletion is imminent.
 */

import type { BudgetForecast, SoulAutonomy } from './types.js';
import { safeCost } from '../../utils/safe-value.js';

interface BudgetForecastOptions {
  /** Warning threshold as fraction of daily budget (default: 0.8 = 80%) */
  warningThreshold?: number;
  /** Minimum ms between warnings (default: 5 minutes) */
  minMsBetweenWarnings?: number;
}

const DEFAULT_OPTIONS: Required<BudgetForecastOptions> = {
  warningThreshold: 0.8,
  minMsBetweenWarnings: 5 * 60 * 1000,
};

const MAX_COST_HISTORY = 50;

export class BudgetForecaster {
  private cycleCosts: number[] = [];
  private lastWarningAt = 0;
  private warningIssued = false;
  private readonly opts: Required<BudgetForecastOptions>;

  constructor(
    private autonomy: SoulAutonomy,
    options: BudgetForecastOptions = {}
  ) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Record the cost of a completed cycle.
   */
  recordCycleCost(cost: number): void {
    const safe = safeCost(cost);
    this.cycleCosts.push(safe);
    if (this.cycleCosts.length > MAX_COST_HISTORY) {
      this.cycleCosts.shift();
    }
  }

  /**
   * Get average cost per cycle (USD). Returns 0 if no history.
   */
  getAvgCostPerCycle(): number {
    if (this.cycleCosts.length === 0) return 0;
    return this.cycleCosts.reduce((a, b) => a + b, 0) / this.cycleCosts.length;
  }

  /**
   * Build a full budget forecast.
   *
   * @param spentToday - Amount already spent today (from BudgetTracker)
   * @param currentCycleCost - Cost of the current cycle (included in rolling avg)
   */
  buildForecast(spentToday: number, currentCycleCost?: number): BudgetForecast {
    const dailyLimit = this.autonomy.maxCostPerDay;
    const safeSpent = safeCost(spentToday);
    const remaining = Math.max(0, dailyLimit - safeSpent);

    // Include current cycle cost in rolling average
    if (currentCycleCost !== undefined && currentCycleCost > 0) {
      this.recordCycleCost(currentCycleCost);
    }

    const avgCost = this.getAvgCostPerCycle();

    let estimatedCyclesRemaining: number | null = null;
    if (avgCost > 0 && remaining > 0) {
      estimatedCyclesRemaining = Math.floor(remaining / avgCost);
    }

    const spentFraction = dailyLimit > 0 ? safeSpent / dailyLimit : 0;
    const shouldWarn =
      spentFraction >= this.opts.warningThreshold &&
      !this.warningIssued &&
      Date.now() - this.lastWarningAt >= this.opts.minMsBetweenWarnings;

    if (shouldWarn) {
      this.warningIssued = true;
      this.lastWarningAt = Date.now();
    }

    return {
      dailyLimit,
      spentToday: safeSpent,
      remainingToday: remaining,
      avgCostPerCycle: Math.round(avgCost * 1000) / 1000,
      estimatedCyclesRemaining,
      lastWarningAt: this.lastWarningAt || null,
      warningIssued: this.warningIssued,
    };
  }

  /**
   * Reset warning state at start of new day.
   */
  resetDaily(): void {
    this.warningIssued = false;
    this.cycleCosts = [];
  }
}
