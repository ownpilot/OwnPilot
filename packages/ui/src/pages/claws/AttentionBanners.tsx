/**
 * AttentionBanners — the two alert strips above the ClawsPage header.
 *
 * The escalation banner (a claw is asking for approval) and the attention
 * strip (reflection / stall / failure / operator-queued buckets). Both are
 * read-only summaries with one action each, so they take their data as props.
 *
 * Split out of ClawsPage.tsx; the buckets come from ./derive.
 */

import { Activity, X } from '../../components/icons';
import type { ClawConfig } from '../../api/endpoints/claws';
import type { DetailTab } from './ClawManagementPanel';

// Matches the shape ClawsPage keeps in state (fed by the WS escalation event).
interface Escalation {
  clawId: string;
  name: string;
  type: string;
  reason: string;
  requestedAt: string;
}

interface AttentionBannersProps {
  escalations: Escalation[];
  setEscalations: (list: Escalation[]) => void;
  approveEscalation: (clawId: string) => void;
  reflectClaws: ClawConfig[];
  stalledClaws: ClawConfig[];
  failedClaws: ClawConfig[];
  operatorQueuedClaws: ClawConfig[];
  openClawDetail: (claw: ClawConfig, tab?: DetailTab) => void;
}

export function AttentionBanners({
  escalations,
  setEscalations,
  approveEscalation,
  reflectClaws,
  stalledClaws,
  failedClaws,
  operatorQueuedClaws,
  openClawDetail,
}: AttentionBannersProps) {
  return (
    <>
      {/* Escalation Notification Banner */}
      {escalations.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800 px-6 py-3 flex items-center gap-3 animate-fade-in">
          <Activity className="w-4 h-4 text-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
              {escalations.length === 1
                ? '1 pending escalation'
                : `${escalations.length} pending escalations`}
            </span>
            {escalations.slice(0, 2).map((e) => (
              <span key={e.clawId} className="text-sm text-amber-600 dark:text-amber-400 ml-2">
                — {e.name}: {e.reason.slice(0, 60)}
                {e.reason.length > 60 ? '…' : ''}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {escalations.slice(0, 2).map((e) => (
              <button
                key={e.clawId}
                onClick={() => approveEscalation(e.clawId)}
                className="px-2 py-1 text-xs rounded bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors"
              >
                Approve
              </button>
            ))}
            <button
              onClick={() => setEscalations([])}
              className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5 text-amber-500" />
            </button>
          </div>
        </div>
      )}

      {/* Attention strip — surfaces the new runner dimensions (reflection,
          stalled focus, failed, operator-queued directives) so the recent
          plan/intervention work is visible at first glance. Each chip is
          a deep-link straight onto the Plan tab of the affected claw so
          one click lands the operator on the queue-intent / reset-failures
          / split-task controls. */}
      {reflectClaws.length + stalledClaws.length + failedClaws.length + operatorQueuedClaws.length >
        0 && (
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border px-6 py-2 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-text-muted dark:text-dark-text-muted font-medium">
            Needs attention:
          </span>
          {reflectClaws.length > 0 && (
            <button
              type="button"
              onClick={() => openClawDetail(reflectClaws[0]!, 'plan')}
              className="px-2 py-1 rounded-full bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 transition-colors font-medium"
              title={`Reflection required: ${reflectClaws.map((c) => c.name).join(', ')}`}
            >
              ⚠ {reflectClaws.length} reflecting
            </button>
          )}
          {stalledClaws.length > 0 && (
            <button
              type="button"
              onClick={() => openClawDetail(stalledClaws[0]!, 'plan')}
              className="px-2 py-1 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors font-medium"
              title={`Stalled focus: ${stalledClaws.map((c) => c.name).join(', ')}`}
            >
              ⏳ {stalledClaws.length} stalled
            </button>
          )}
          {failedClaws.length > 0 && (
            <button
              type="button"
              onClick={() => openClawDetail(failedClaws[0]!, 'plan')}
              className="px-2 py-1 rounded-full bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors font-medium"
              title={`Failed: ${failedClaws.map((c) => c.name).join(', ')}`}
            >
              ✗ {failedClaws.length} failed
            </button>
          )}
          {operatorQueuedClaws.length > 0 && (
            <button
              type="button"
              onClick={() => openClawDetail(operatorQueuedClaws[0]!, 'plan')}
              className="px-2 py-1 rounded-full bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors font-medium"
              title={`Operator directive queued: ${operatorQueuedClaws.map((c) => c.name).join(', ')}`}
            >
              ↳ {operatorQueuedClaws.length} op-queued
            </button>
          )}
        </div>
      )}
    </>
  );
}
