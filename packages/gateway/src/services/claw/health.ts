import type { ClawConfig, ClawHealthStatus, ClawSession } from '@ownpilot/core/services/claw';

/**
 * lastCycleError values that represent an infrastructure event (process restart
 * reconciliation) rather than a genuine cycle fault. See orphan-reconciliation.ts.
 */
const INFRA_RECOVERY_MARKERS = new Set<string>(['orphan_recovery']);

export function scoreContract(config: ClawConfig): number {
  let score = 0;
  if (config.missionContract?.successCriteria?.length) score += 35;
  if (config.missionContract?.deliverables?.length) score += 25;
  if (config.missionContract?.constraints?.length) score += 15;
  if (config.missionContract?.evidenceRequired) score += 15;
  if (config.stopCondition) score += 10;
  return Math.min(score, 100);
}

/**
 * Build the public session DTO. Single source of truth for what the UI sees.
 */
export function serializeSession(session: ClawSession | null) {
  if (!session) return null;
  return {
    state: session.state,
    cyclesCompleted: session.cyclesCompleted,
    totalToolCalls: session.totalToolCalls,
    totalCostUsd: session.totalCostUsd,
    lastCycleAt: session.lastCycleAt,
    lastCycleDurationMs: session.lastCycleDurationMs,
    lastCycleError: session.lastCycleError,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    artifacts: session.artifacts,
    pendingEscalation: session.pendingEscalation,
    tasks: session.tasks,
    consecutiveErrors: session.consecutiveErrors,
    recentFailures: session.recentFailures,
    nextIntent: session.nextIntent,
    planHistory: session.planHistory ?? [],
  };
}

export function buildHealthStatus(
  config: ClawConfig,
  session: ClawSession | null
): ClawHealthStatus {
  const contractScore = scoreContract(config);
  const signals: string[] = [];
  const recommendations: string[] = [];
  const policyWarnings: string[] = [];

  if (contractScore < 60) {
    signals.push('weak mission contract');
    recommendations.push('Add success criteria, deliverables, constraints, and a stop condition');
  }
  if (config.autonomyPolicy?.destructiveActionPolicy === 'allow') {
    policyWarnings.push('destructive actions are allowed');
    recommendations.push('Use ask or block for destructive actions unless this claw is trusted');
  }
  if (config.autonomyPolicy?.allowSelfModify) {
    policyWarnings.push('self-modification is enabled');
  }
  if (config.mode === 'event' && (config.eventFilters?.length ?? 0) === 0) {
    signals.push('event mode without filters');
    recommendations.push('Add event filters or switch to interval mode');
  }

  if (!session) {
    return {
      score: Math.max(35, Math.min(80, 65 + Math.floor((contractScore - 60) / 4))),
      status: contractScore < 60 ? 'watch' : 'idle',
      signals: signals.length ? signals : ['not running'],
      recommendations: recommendations.length ? recommendations : ['Start the claw when ready'],
      contractScore,
      policyWarnings,
    };
  }

  const isInfraRecovery =
    session.lastCycleError != null && INFRA_RECOVERY_MARKERS.has(session.lastCycleError);
  if (isInfraRecovery) {
    signals.push('recovered from restart');
  }
  if (session.state === 'failed') {
    return {
      score: 10,
      status: 'failed',
      signals: ['failed', ...signals],
      recommendations: [
        'Open history and fix the last failure before restarting',
        ...recommendations,
      ],
      contractScore,
      policyWarnings,
    };
  }
  if (session.lastCycleError && !isInfraRecovery) {
    return {
      score: 35,
      status: 'watch',
      signals: [`last error: ${session.lastCycleError}`, ...signals],
      recommendations: ['Inspect the last cycle error and adjust tools, model, or permissions'],
      contractScore,
      policyWarnings,
    };
  }
  if (session.totalCostUsd >= (session.config.limits?.totalBudgetUsd ?? Infinity)) {
    return {
      score: 25,
      status: 'expensive',
      signals: ['budget cap reached', ...signals],
      recommendations: ['Raise the budget, narrow the mission, or stop the claw'],
      contractScore,
      policyWarnings,
    };
  }
  if (session.state === 'waiting') {
    return {
      score: contractScore < 60 ? 55 : 75,
      status: contractScore < 60 ? 'watch' : 'idle',
      signals: ['waiting for event', ...signals],
      recommendations: recommendations.length ? recommendations : ['No action needed'],
      contractScore,
      policyWarnings,
    };
  }
  if (session.cyclesCompleted > 0 && session.totalToolCalls === 0) {
    return {
      score: 45,
      status: 'stuck',
      signals: ['cycles completed without tool calls', ...signals],
      recommendations: ['Review tool access, mission clarity, and model routing'],
      contractScore,
      policyWarnings,
    };
  }

  return {
    score: contractScore < 60 ? 68 : 92,
    status: contractScore < 60 ? 'watch' : 'healthy',
    signals: signals.length ? signals : ['active'],
    recommendations: recommendations.length ? recommendations : ['No action needed'],
    contractScore,
    policyWarnings,
  };
}

export function getHealthForConfig(config: ClawConfig, sessions: ClawSession[]): ClawHealthStatus {
  return buildHealthStatus(config, sessions.find((s) => s.config.id === config.id) ?? null);
}
