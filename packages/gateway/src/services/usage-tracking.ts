/**
 * Usage tracking — gateway-wide singleton.
 *
 * Hosts the `UsageTracker` and `BudgetManager` instances plus their DB
 * persistence wiring. Extracted from `routes/costs.ts` so non-route consumers
 * (chat streaming, middleware) don't have to reach into the routes/ layer for
 * what is essentially a service-layer concern.
 *
 * Routes that own the REST surface (costs.ts, dashboard.ts) import from here,
 * just like services and middleware do.
 */

import { UsageTracker, BudgetManager } from '@ownpilot/core';
import { getLog } from './log.js';

const log = getLog('UsageTracking');

export const usageTracker = new UsageTracker();
export const budgetManager = new BudgetManager(usageTracker);

// BUDGET-002: surface budget alerts beyond a log line. Without this hook the
// `alert` event fires, the event bus sees it, and no one acts on it — the
// operator only finds out a threshold was crossed when they read logs.
// We log at warn level and try to write an audit entry so the operator gets
// a structured record. The audit import is dynamic to avoid a circular
// dep (audit/ → services/ would be bad form from services/).
budgetManager.on('alert', (alert: unknown) => {
  const a = alert as { type: string; threshold: number; currentSpend: number; limit?: number };
  const message = `Budget ${a.type} hit ${a.threshold}% (${a.currentSpend.toFixed(4)} / ${(a.limit ?? 0).toFixed(2)})`;
  log.warn(`[Budget] ${message}`);
  // Fire-and-forget audit write; failures must not break usage tracking.
  void (async () => {
    try {
      const { getAuditLogger } = await import('../audit/index.js');
      await getAuditLogger().log({
        type: 'config.change',
        severity: 'warning',
        actor: { type: 'system', id: 'budget-manager' },
        resource: { type: 'budget', id: a.type, name: `${a.type} budget` },
        outcome: 'success',
        details: { alert: a, message },
      });
    } catch {
      // Audit module may not be wired in test env — that's fine.
    }
  })();
});

// Wire DB persistence — fire-and-forget, errors are logged below.
async function wireUsageRepository(): Promise<void> {
  try {
    const { getUsageRepository } = await import('../db/repositories/costs/usage.js');
    const repo = await getUsageRepository();
    usageTracker.setRecordCallback(async (record) => {
      await repo.save(record);
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`UsageRepository unavailable, DB persistence disabled: ${msg}`);
  }
}

void wireUsageRepository();
