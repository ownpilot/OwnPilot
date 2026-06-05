/**
 * Personal Memory Retention
 *
 * Always-on daily hygiene for personal memories, mirroring the Claw manager's
 * retention timer for its system tables (services/claw/manager-helpers.ts).
 *
 * A full pass runs importance *decay* (ages out stale, unaccessed memories)
 * followed by *cleanup* (deletes already-dead entries: importance < 0.1 AND
 * older than the cutoff AND not accessed within it). This is pure retention —
 * no LLM calls, no conversation extraction, no semantic consolidation — so it
 * is safe to run by default without the privacy/cost concerns that keep the
 * `memory_extract` / `memory_consolidate` triggers opt-in.
 *
 * Cadence note: `cleanup` is an idempotent DELETE (re-running deletes the same
 * dead set once), so it runs on boot AND on the daily tick — short-lived /
 * frequently-restarted processes still get their storage bounded. `decay` is a
 * *compounding* UPDATE (importance *= 0.9), so it runs ONLY on the daily
 * interval tick, never on the boot pass: this bounds decay to at most once per
 * 24h of continuous uptime and keeps it independent of restart frequency (a
 * dev process that restarts 20×/day must not decay a memory 20×).
 */

import { getErrorMessage } from '@ownpilot/core';
import { getMemoryService } from '../memory-service.js';
import { getLog } from '../log.js';

const log = getLog('MemoryRetention');

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

/** Owner whose memories are maintained in single-tenant mode. */
const RETENTION_OWNER_ID = 'default';

let retentionTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Run one retention pass for the given owner. Never throws — each step is
 * isolated so a decay failure still lets cleanup run, and so the daily timer
 * keeps firing. Pass `{ decay: false }` for the boot pass to skip the
 * compounding decay step (see cadence note above).
 */
export async function runMemoryRetentionCleanup(
  userId: string = RETENTION_OWNER_ID,
  options: { decay?: boolean } = {}
): Promise<void> {
  const { decay = true } = options;
  const service = getMemoryService();

  if (decay) {
    try {
      const decayed = await service.decayMemories(userId);
      if (decayed > 0) log.info(`Decayed ${decayed} stale memories`);
    } catch (err) {
      log.warn(`Memory decay failed: ${getErrorMessage(err)}`);
    }
  }

  try {
    const cleaned = await service.cleanupMemories(userId);
    if (cleaned > 0) log.info(`Cleaned up ${cleaned} dead memories`);
  } catch (err) {
    log.warn(`Memory cleanup failed: ${getErrorMessage(err)}`);
  }
}

/**
 * Start the always-on daily retention timer. Runs an immediate cleanup-only
 * pass, then a full decay + cleanup pass once per day. Idempotent — a second
 * call while already running is a no-op.
 */
export function startMemoryRetention(userId: string = RETENTION_OWNER_ID): void {
  if (retentionTimer) return;

  // Boot pass: cleanup only (idempotent), no compounding decay.
  void runMemoryRetentionCleanup(userId, { decay: false });

  retentionTimer = setInterval(() => {
    void runMemoryRetentionCleanup(userId, { decay: true });
  }, CLEANUP_INTERVAL_MS);
  // Don't hold the process open just for this cleanup — Node should be free to
  // exit when nothing else keeps the event loop alive (matches ClawManager).
  retentionTimer.unref?.();

  log.info('Memory retention scheduler started (daily decay + cleanup)');
}

/** Stop the retention timer (graceful shutdown / test teardown). Idempotent. */
export function stopMemoryRetention(): void {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}
