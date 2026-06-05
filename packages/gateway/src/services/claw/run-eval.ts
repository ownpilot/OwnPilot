/**
 * Claw Run Evaluation.
 *
 * Turns a claw's execution history (claw_history) into objective reliability
 * metrics so "can this claw do its job reliably?" becomes a number rather than a
 * hope. Consumes the same `ClawHistoryEntry[]` the ShareGPT trajectory export
 * uses, so it works on any past or running claw with no extra instrumentation.
 *
 * The headline signal is `repeatedFailures`: the same tool failing the same way
 * more than once is the probe-and-fail waste pattern (e.g. an edit whose oldText
 * never matches, retried blindly) — the highest-leverage thing to fix because it
 * burns cycles without progress. Pure and dependency-free for unit testing.
 */

import type { ClawConfig, ClawHistoryEntry, ClawToolCall } from '@ownpilot/core';

interface ToolReliability {
  tool: string;
  calls: number;
  failures: number;
  failureRate: number; // 0-1
}

interface FailureSignature {
  /** Normalized error prefix used to group similar failures. */
  signature: string;
  count: number;
  /** Distinct tools that produced this failure signature. */
  tools: string[];
  /** One verbatim example for context. */
  example: string;
  /** ISO timestamp of the most recent occurrence — lets a fixed failure age out. */
  lastSeen?: string;
  /** ISO timestamp of the earliest occurrence. */
  firstSeen?: string;
}

interface RepeatedFailure {
  tool: string;
  signature: string;
  count: number;
  /** ISO timestamp of the most recent occurrence. A fix shows up as this going
   *  stale while new cycles accumulate clean — the flywheel's "is it fixed?" signal. */
  lastSeen?: string;
}

interface ClawRunEval {
  clawId?: string;
  sampleSize: number; // number of cycle entries evaluated
  cycles: { total: number; succeeded: number; failed: number; successRate: number };
  toolCalls: { total: number; succeeded: number; failed: number; successRate: number };
  byTool: ToolReliability[];
  topFailures: FailureSignature[];
  /** Same tool + same failure signature seen 2+ times: wasted retries. */
  repeatedFailures: RepeatedFailure[];
  efficiency: {
    avgToolCallsPerCycle: number;
    avgCycleDurationMs: number;
    totalCostUsd: number;
    /** Tool calls that repeated a known failure (sum of count-1 per group). */
    wastedCalls: number;
  };
  /** 0-100 composite, or null when there are no tool calls to score. */
  reliabilityScore: number | null;
}

const MAX_TOP_FAILURES = 8;

/**
 * Normalize an error string so superficially-different failures group together:
 * lowercase, collapse whitespace, mask digits and quoted literals (paths, ids,
 * line numbers), and clip. "...near line 5" and "...near line 12" become one.
 */
function normalizeSignature(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/["'`][^"'`]*["'`]/g, '"…"') // quoted literals (paths, names)
    .replace(/\b\d+\b/g, '#') // numbers (line/byte/ids)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/** Coerce a tool result of any shape into a string for failure grouping. */
function resultText(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Coerce a Date | ISO string | epoch into epoch ms, or undefined when unparseable. */
function toEpoch(value: unknown): number | undefined {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? undefined : t;
  }
  if (typeof value === 'number') return Number.isNaN(value) ? undefined : value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

/**
 * Evaluate a claw's run history. Entries may arrive in any order; only `cycle`
 * entries contribute to cycle stats, but tool calls from all entries count.
 */
export function evaluateClawRun(
  entries: ClawHistoryEntry[],
  config?: Pick<ClawConfig, 'id'>
): ClawRunEval {
  const cycleEntries = entries.filter((e) => e.entryType === 'cycle');
  const cyclesTotal = cycleEntries.length;
  const cyclesSucceeded = cycleEntries.filter((e) => e.success).length;

  const allCalls: ClawToolCall[] = entries.flatMap((e) => e.toolCalls ?? []);
  const callsTotal = allCalls.length;
  const callsFailed = allCalls.filter((c) => !c.success).length;
  const callsSucceeded = callsTotal - callsFailed;

  // Per-tool reliability.
  const toolMap = new Map<string, { calls: number; failures: number }>();
  for (const call of allCalls) {
    const t = toolMap.get(call.tool) ?? { calls: 0, failures: 0 };
    t.calls += 1;
    if (!call.success) t.failures += 1;
    toolMap.set(call.tool, t);
  }
  const byTool: ToolReliability[] = [...toolMap.entries()]
    .map(([tool, s]) => ({
      tool,
      calls: s.calls,
      failures: s.failures,
      failureRate: s.calls > 0 ? round(s.failures / s.calls) : 0,
    }))
    .sort((a, b) => b.failures - a.failures || b.calls - a.calls);

  // Failure signatures (global) and repeated failures (per tool+signature).
  // Iterate per-entry (not the flattened call list) so each failure keeps the
  // timestamp of the cycle it happened in — the recency signal that lets a fixed
  // failure age out instead of looking live forever.
  const sigMap = new Map<
    string,
    { count: number; tools: Set<string>; example: string; first: number; last: number }
  >();
  const repeatMap = new Map<
    string,
    { tool: string; signature: string; count: number; last: number }
  >();
  for (const entry of entries) {
    const ts = toEpoch(entry.executedAt);
    for (const call of entry.toolCalls ?? []) {
      if (call.success) continue;
      const raw = resultText(call.result) || 'unknown error';
      const sig = normalizeSignature(raw);
      if (!sig) continue;

      const g = sigMap.get(sig) ?? {
        count: 0,
        tools: new Set<string>(),
        example: raw.slice(0, 200),
        first: ts ?? Infinity,
        last: ts ?? -Infinity,
      };
      g.count += 1;
      g.tools.add(call.tool);
      if (ts !== undefined) {
        g.first = Math.min(g.first, ts);
        g.last = Math.max(g.last, ts);
      }
      sigMap.set(sig, g);

      const key = `${call.tool}::${sig}`;
      const r = repeatMap.get(key) ?? {
        tool: call.tool,
        signature: sig,
        count: 0,
        last: ts ?? -Infinity,
      };
      r.count += 1;
      if (ts !== undefined) r.last = Math.max(r.last, ts);
      repeatMap.set(key, r);
    }
  }

  const topFailures: FailureSignature[] = [...sigMap.entries()]
    .map(([signature, g]) => ({
      signature,
      count: g.count,
      tools: [...g.tools],
      example: g.example,
      ...(Number.isFinite(g.last) ? { lastSeen: new Date(g.last).toISOString() } : {}),
      ...(Number.isFinite(g.first) ? { firstSeen: new Date(g.first).toISOString() } : {}),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TOP_FAILURES);

  const repeatedFailures: RepeatedFailure[] = [...repeatMap.values()]
    .filter((r) => r.count >= 2)
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      tool: r.tool,
      signature: r.signature,
      count: r.count,
      ...(Number.isFinite(r.last) ? { lastSeen: new Date(r.last).toISOString() } : {}),
    }));

  const wastedCalls = repeatedFailures.reduce((sum, r) => sum + (r.count - 1), 0);

  const totalCost = entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  const cycleDurations = cycleEntries.map((e) => e.durationMs ?? 0);
  const avgCycleDurationMs =
    cycleDurations.length > 0
      ? Math.round(cycleDurations.reduce((a, b) => a + b, 0) / cycleDurations.length)
      : 0;

  const toolSuccessRate = callsTotal > 0 ? callsSucceeded / callsTotal : 0;
  const cycleSuccessRate = cyclesTotal > 0 ? cyclesSucceeded / cyclesTotal : 0;
  const wasteRatio = callsTotal > 0 ? wastedCalls / callsTotal : 0;

  // Composite: tool reliability dominates, cycle success next, a small penalty
  // for wasted retries. Null when there are no tool calls to judge.
  const reliabilityScore =
    callsTotal === 0
      ? null
      : Math.round(
          100 * (0.55 * toolSuccessRate + 0.35 * cycleSuccessRate + 0.1 * (1 - wasteRatio))
        );

  return {
    clawId: config?.id,
    sampleSize: cyclesTotal,
    cycles: {
      total: cyclesTotal,
      succeeded: cyclesSucceeded,
      failed: cyclesTotal - cyclesSucceeded,
      successRate: round(cycleSuccessRate),
    },
    toolCalls: {
      total: callsTotal,
      succeeded: callsSucceeded,
      failed: callsFailed,
      successRate: round(toolSuccessRate),
    },
    byTool,
    topFailures,
    repeatedFailures,
    efficiency: {
      avgToolCallsPerCycle: cyclesTotal > 0 ? round(callsTotal / cyclesTotal, 2) : 0,
      avgCycleDurationMs,
      totalCostUsd: round(totalCost, 6),
      wastedCalls,
    },
    reliabilityScore,
  };
}

// ============================================================================
// Fleet aggregation
// ============================================================================

interface FleetClawSummary {
  clawId: string;
  name: string;
  reliabilityScore: number | null;
  toolSuccessRate: number;
  cycles: number;
  wastedCalls: number;
}

interface FleetRepeatedFailure {
  tool: string;
  signature: string;
  count: number;
  /** How many distinct claws hit this failure — high = systemic, fix once. */
  claws: number;
  /** ISO timestamp of the most recent occurrence across the fleet. */
  lastSeen?: string;
}

interface FleetEval {
  clawsEvaluated: number;
  totals: { cycles: number; toolCalls: number; toolsFailed: number; wastedCalls: number };
  fleetToolSuccessRate: number;
  /** Tool-call-weighted mean of per-claw scores; null when the fleet has no tool calls. */
  fleetReliabilityScore: number | null;
  /** Per-claw summaries, worst score first (nulls last) — triage order. */
  perClaw: FleetClawSummary[];
  /** Repeated failures merged across the whole fleet, most frequent first.
   *  The top entry is the single highest-leverage fix for the army. */
  topRepeatedFailures: FleetRepeatedFailure[];
}

const MAX_FLEET_FAILURES = 12;

/**
 * Aggregate per-claw evaluations into one fleet-health view. The headline is
 * `topRepeatedFailures`: a failure hit by many claws is systemic — fixing it
 * once lifts the whole army — so it is ranked by total occurrences and annotated
 * with how many distinct claws it affects.
 */
export function aggregateFleetEval(
  evals: Array<{ name: string; evaluation: ClawRunEval }>
): FleetEval {
  let cycles = 0;
  let toolCalls = 0;
  let toolsFailed = 0;
  let wastedCalls = 0;
  let weightedScoreSum = 0;
  let scoredCalls = 0;

  const perClaw: FleetClawSummary[] = [];
  // tool+signature -> { count, claws:Set }
  const failMap = new Map<
    string,
    { tool: string; signature: string; count: number; claws: Set<string>; last: number }
  >();

  for (const { name, evaluation } of evals) {
    cycles += evaluation.cycles.total;
    toolCalls += evaluation.toolCalls.total;
    toolsFailed += evaluation.toolCalls.failed;
    wastedCalls += evaluation.efficiency.wastedCalls;

    if (evaluation.reliabilityScore !== null && evaluation.toolCalls.total > 0) {
      weightedScoreSum += evaluation.reliabilityScore * evaluation.toolCalls.total;
      scoredCalls += evaluation.toolCalls.total;
    }

    perClaw.push({
      clawId: evaluation.clawId ?? '',
      name,
      reliabilityScore: evaluation.reliabilityScore,
      toolSuccessRate: evaluation.toolCalls.successRate,
      cycles: evaluation.cycles.total,
      wastedCalls: evaluation.efficiency.wastedCalls,
    });

    const clawKey = evaluation.clawId ?? name;
    for (const rf of evaluation.repeatedFailures) {
      const key = `${rf.tool}::${rf.signature}`;
      const rfLast = rf.lastSeen ? Date.parse(rf.lastSeen) : NaN;
      const g = failMap.get(key) ?? {
        tool: rf.tool,
        signature: rf.signature,
        count: 0,
        claws: new Set<string>(),
        last: -Infinity,
      };
      g.count += rf.count;
      g.claws.add(clawKey);
      if (!Number.isNaN(rfLast)) g.last = Math.max(g.last, rfLast);
      failMap.set(key, g);
    }
  }

  // Worst score first so operators triage the weakest claws; nulls (no data) last.
  perClaw.sort((a, b) => {
    if (a.reliabilityScore === null) return b.reliabilityScore === null ? 0 : 1;
    if (b.reliabilityScore === null) return -1;
    return a.reliabilityScore - b.reliabilityScore;
  });

  const topRepeatedFailures: FleetRepeatedFailure[] = [...failMap.values()]
    .map((g) => ({
      tool: g.tool,
      signature: g.signature,
      count: g.count,
      claws: g.claws.size,
      ...(Number.isFinite(g.last) ? { lastSeen: new Date(g.last).toISOString() } : {}),
    }))
    .sort((a, b) => b.count - a.count || b.claws - a.claws)
    .slice(0, MAX_FLEET_FAILURES);

  return {
    clawsEvaluated: evals.length,
    totals: { cycles, toolCalls, toolsFailed, wastedCalls },
    fleetToolSuccessRate: toolCalls > 0 ? round((toolCalls - toolsFailed) / toolCalls) : 0,
    fleetReliabilityScore: scoredCalls > 0 ? Math.round(weightedScoreSum / scoredCalls) : null,
    perClaw,
    topRepeatedFailures,
  };
}
