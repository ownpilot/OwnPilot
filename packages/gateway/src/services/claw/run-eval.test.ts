import { describe, it, expect } from 'vitest';
import { evaluateClawRun, aggregateFleetEval } from './run-eval.js';
import type { ClawHistoryEntry, ClawToolCall } from '@ownpilot/core';

function call(over: Partial<ClawToolCall> = {}): ClawToolCall {
  return { tool: 'core.noop', args: {}, result: 'ok', success: true, durationMs: 5, ...over };
}

function entry(over: Partial<ClawHistoryEntry> = {}): ClawHistoryEntry {
  return {
    id: 'ch_1',
    clawId: 'claw_1',
    cycleNumber: 1,
    entryType: 'cycle',
    success: true,
    toolCalls: [],
    outputMessage: '',
    durationMs: 1000,
    executedAt: new Date(),
    ...over,
  };
}

describe('evaluateClawRun', () => {
  it('returns a null score and zeros for an empty history', () => {
    const r = evaluateClawRun([]);
    expect(r.sampleSize).toBe(0);
    expect(r.cycles.total).toBe(0);
    expect(r.toolCalls.total).toBe(0);
    expect(r.reliabilityScore).toBeNull();
  });

  it('computes cycle and tool success rates', () => {
    const r = evaluateClawRun([
      entry({
        cycleNumber: 1,
        success: true,
        toolCalls: [call(), call({ success: false, result: 'Error: boom' })],
      }),
      entry({ cycleNumber: 2, success: false, toolCalls: [call()] }),
    ]);
    expect(r.cycles.total).toBe(2);
    expect(r.cycles.succeeded).toBe(1);
    expect(r.cycles.successRate).toBe(0.5);
    expect(r.toolCalls.total).toBe(3);
    expect(r.toolCalls.failed).toBe(1);
    expect(r.toolCalls.successRate).toBeCloseTo(0.6667, 3);
    expect(r.reliabilityScore).toBeGreaterThan(0);
  });

  it('ranks tools by failure count', () => {
    const r = evaluateClawRun([
      entry({
        toolCalls: [
          call({ tool: 'core.edit_file', success: false, result: 'Error: oldText not found' }),
          call({ tool: 'core.edit_file', success: false, result: 'Error: oldText not found' }),
          call({ tool: 'core.read_file', success: true }),
        ],
      }),
    ]);
    expect(r.byTool[0].tool).toBe('core.edit_file');
    expect(r.byTool[0].failures).toBe(2);
    expect(r.byTool[0].failureRate).toBe(1);
  });

  it('detects repeated failures (probe-and-fail waste) by normalized signature', () => {
    // Same failure mode, different line numbers — must group into one repeated failure.
    const r = evaluateClawRun([
      entry({
        toolCalls: [
          call({
            tool: 'core.edit_file',
            success: false,
            result: 'Error: oldText not found near line 5',
          }),
          call({
            tool: 'core.edit_file',
            success: false,
            result: 'Error: oldText not found near line 12',
          }),
          call({
            tool: 'core.edit_file',
            success: false,
            result: 'Error: oldText not found near line 99',
          }),
        ],
      }),
    ]);
    expect(r.repeatedFailures).toHaveLength(1);
    expect(r.repeatedFailures[0].tool).toBe('core.edit_file');
    expect(r.repeatedFailures[0].count).toBe(3);
    expect(r.efficiency.wastedCalls).toBe(2); // count - 1
  });

  it('groups failure signatures globally with an example and tool list', () => {
    const r = evaluateClawRun([
      entry({
        toolCalls: [
          call({
            tool: 'core.http_request',
            success: false,
            result: '{"error":"Unexpected end of JSON input"}',
          }),
          call({
            tool: 'core.call_json_api',
            success: false,
            result: '{"error":"Unexpected end of JSON input"}',
          }),
        ],
      }),
    ]);
    expect(r.topFailures).toHaveLength(1);
    expect(r.topFailures[0].count).toBe(2);
    expect(r.topFailures[0].tools.sort()).toEqual(['core.call_json_api', 'core.http_request']);
    expect(r.topFailures[0].example).toContain('Unexpected end of JSON input');
  });

  it('penalizes wasted retries in the composite score', () => {
    const clean = evaluateClawRun([
      entry({ toolCalls: [call(), call(), call({ success: false, result: 'one-off A' })] }),
    ]);
    const wasteful = evaluateClawRun([
      entry({
        toolCalls: [
          call(),
          call({ success: false, result: 'repeat X' }),
          call({ success: false, result: 'repeat X' }),
        ],
      }),
    ]);
    // Same 2/3 tool success rate, but the wasteful run repeats a known failure.
    expect(wasteful.efficiency.wastedCalls).toBe(1);
    expect(clean.efficiency.wastedCalls).toBe(0);
    expect(wasteful.reliabilityScore!).toBeLessThan(clean.reliabilityScore!);
  });

  it('computes efficiency metrics and total cost', () => {
    const r = evaluateClawRun([
      entry({ cycleNumber: 1, durationMs: 2000, costUsd: 0.01, toolCalls: [call(), call()] }),
      entry({ cycleNumber: 2, durationMs: 4000, costUsd: 0.03, toolCalls: [call()] }),
    ]);
    expect(r.efficiency.avgToolCallsPerCycle).toBe(1.5);
    expect(r.efficiency.avgCycleDurationMs).toBe(3000);
    expect(r.efficiency.totalCostUsd).toBeCloseTo(0.04, 6);
  });

  it('excludes escalation entries from cycle stats but counts their tool calls', () => {
    const r = evaluateClawRun([
      entry({ cycleNumber: 1, entryType: 'cycle', success: true, toolCalls: [call()] }),
      entry({
        cycleNumber: 2,
        entryType: 'escalation',
        success: false,
        toolCalls: [call({ success: false, result: 'x' })],
      }),
    ]);
    expect(r.cycles.total).toBe(1);
    expect(r.toolCalls.total).toBe(2);
  });

  it('attaches the claw id when config is provided', () => {
    const r = evaluateClawRun([entry()], { id: 'claw_abc' });
    expect(r.clawId).toBe('claw_abc');
  });
});

describe('aggregateFleetEval', () => {
  const failCall = (tool: string, result: string): ClawToolCall =>
    call({ tool, success: false, result });

  it('handles an empty fleet', () => {
    const f = aggregateFleetEval([]);
    expect(f.clawsEvaluated).toBe(0);
    expect(f.fleetReliabilityScore).toBeNull();
    expect(f.fleetToolSuccessRate).toBe(0);
    expect(f.topRepeatedFailures).toEqual([]);
  });

  it('sums totals and computes a tool-call-weighted fleet score', () => {
    const a = evaluateClawRun(
      [entry({ toolCalls: [call(), call(), call(), call()] })], // 4 calls, all ok -> high score
      { id: 'a' }
    );
    const b = evaluateClawRun(
      [entry({ success: false, toolCalls: [failCall('core.x', 'boom')] })], // 1 call, fails
      { id: 'b' }
    );
    const f = aggregateFleetEval([
      { name: 'A', evaluation: a },
      { name: 'B', evaluation: b },
    ]);
    expect(f.clawsEvaluated).toBe(2);
    expect(f.totals.toolCalls).toBe(5);
    expect(f.totals.toolsFailed).toBe(1);
    expect(f.fleetToolSuccessRate).toBe(0.8);
    // Weighted by calls (4 vs 1), so the healthy claw dominates the fleet score.
    expect(f.fleetReliabilityScore).toBeGreaterThan(a.reliabilityScore! - 30);
    expect(f.fleetReliabilityScore).toBeLessThanOrEqual(a.reliabilityScore!);
  });

  it('ranks the weakest claw first and puts no-data claws last', () => {
    const strong = evaluateClawRun([entry({ toolCalls: [call(), call()] })], { id: 'strong' });
    const weak = evaluateClawRun(
      [
        entry({
          success: false,
          toolCalls: [failCall('core.y', 'err'), failCall('core.y', 'err')],
        }),
      ],
      { id: 'weak' }
    );
    const empty = evaluateClawRun([], { id: 'empty' });
    const f = aggregateFleetEval([
      { name: 'strong', evaluation: strong },
      { name: 'empty', evaluation: empty },
      { name: 'weak', evaluation: weak },
    ]);
    expect(f.perClaw[0].name).toBe('weak'); // worst score first
    expect(f.perClaw[f.perClaw.length - 1].name).toBe('empty'); // null score last
  });

  it('merges repeated failures across claws and counts affected claws', () => {
    // Same failure signature in two different claws -> systemic, claws: 2.
    const c1 = evaluateClawRun(
      [
        entry({
          toolCalls: [
            failCall('core.edit_file', 'Error: oldText not found near line 1'),
            failCall('core.edit_file', 'Error: oldText not found near line 2'),
          ],
        }),
      ],
      { id: 'c1' }
    );
    const c2 = evaluateClawRun(
      [
        entry({
          toolCalls: [
            failCall('core.edit_file', 'Error: oldText not found near line 9'),
            failCall('core.edit_file', 'Error: oldText not found near line 7'),
          ],
        }),
      ],
      { id: 'c2' }
    );
    const f = aggregateFleetEval([
      { name: 'c1', evaluation: c1 },
      { name: 'c2', evaluation: c2 },
    ]);
    expect(f.topRepeatedFailures[0].tool).toBe('core.edit_file');
    expect(f.topRepeatedFailures[0].count).toBe(4); // 2 + 2
    expect(f.topRepeatedFailures[0].claws).toBe(2); // systemic across the fleet
  });
});

describe('failure recency (lastSeen / firstSeen)', () => {
  const t1 = '2026-05-01T10:00:00.000Z';
  const t2 = '2026-05-20T10:00:00.000Z';

  it('records firstSeen/lastSeen spanning all occurrences of a signature', () => {
    const r = evaluateClawRun([
      entry({
        cycleNumber: 1,
        executedAt: new Date(t1),
        toolCalls: [call({ success: false, result: 'Error: boom 1' })],
      }),
      entry({
        cycleNumber: 2,
        executedAt: new Date(t2),
        toolCalls: [call({ success: false, result: 'Error: boom 2' })],
      }),
    ]);
    // Digits are masked, so both group into one signature.
    expect(r.topFailures).toHaveLength(1);
    expect(r.topFailures[0].firstSeen).toBe(t1);
    expect(r.topFailures[0].lastSeen).toBe(t2);
  });

  it('repeatedFailures carry the most recent occurrence', () => {
    const r = evaluateClawRun([
      entry({
        executedAt: new Date(t1),
        toolCalls: [
          call({ tool: 'core.edit_file', success: false, result: 'oldText not found' }),
          call({ tool: 'core.edit_file', success: false, result: 'oldText not found' }),
        ],
      }),
      entry({
        executedAt: new Date(t2),
        toolCalls: [call({ tool: 'core.edit_file', success: false, result: 'oldText not found' })],
      }),
    ]);
    const rf = r.repeatedFailures.find((x) => x.tool === 'core.edit_file');
    expect(rf?.count).toBe(3);
    expect(rf?.lastSeen).toBe(t2);
  });

  it('accepts ISO-string executedAt (as it arrives over the API)', () => {
    const r = evaluateClawRun([
      entry({
        executedAt: t2 as unknown as Date,
        toolCalls: [call({ success: false, result: 'err' })],
      }),
    ]);
    expect(r.topFailures[0].lastSeen).toBe(t2);
  });

  it('omits timestamps when executedAt is unparseable', () => {
    const r = evaluateClawRun([
      entry({
        executedAt: 'not-a-date' as unknown as Date,
        toolCalls: [call({ success: false, result: 'err' })],
      }),
    ]);
    expect(r.topFailures[0].lastSeen).toBeUndefined();
    expect(r.topFailures[0].firstSeen).toBeUndefined();
  });

  it('fleet topRepeatedFailures surface the latest occurrence across claws', () => {
    const c1 = evaluateClawRun(
      [
        entry({
          executedAt: new Date(t1),
          toolCalls: [
            call({ tool: 'core.edit_file', success: false, result: 'oldText not found' }),
            call({ tool: 'core.edit_file', success: false, result: 'oldText not found' }),
          ],
        }),
      ],
      { id: 'c1' }
    );
    const c2 = evaluateClawRun(
      [
        entry({
          executedAt: new Date(t2),
          toolCalls: [
            call({ tool: 'core.edit_file', success: false, result: 'oldText not found' }),
            call({ tool: 'core.edit_file', success: false, result: 'oldText not found' }),
          ],
        }),
      ],
      { id: 'c2' }
    );
    const f = aggregateFleetEval([
      { name: 'c1', evaluation: c1 },
      { name: 'c2', evaluation: c2 },
    ]);
    expect(f.topRepeatedFailures[0].lastSeen).toBe(t2);
  });
});
