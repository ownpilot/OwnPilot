/**
 * Tests for the Pulse Prompt Builder
 */

import { describe, it, expect } from 'vitest';
import {
  getPulseSystemPrompt,
  buildPulseUserMessage,
  parsePulseDecision,
} from './prompt.js';
import type { PulseContext } from './context.js';
import type { Signal } from './evaluator.js';

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides: Partial<PulseContext> = {}): PulseContext {
  return {
    userId: 'test-user',
    gatheredAt: new Date('2026-02-23T10:00:00Z'),
    timeContext: { hour: 10, dayOfWeek: 1, isWeekend: false },
    goals: { active: [], stale: [], upcoming: [] },
    memories: { total: 100, recentCount: 5, avgImportance: 0.5 },
    activity: { daysSinceLastActivity: 0, hasRecentActivity: true },
    systemHealth: { pendingApprovals: 0, triggerErrors: 0 },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('getPulseSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = getPulseSystemPrompt();
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain('Autonomy Engine');
    expect(prompt).toContain('create_memory');
    expect(prompt).toContain('skip');
  });

  it('returns base prompt when directives are empty', () => {
    const base = getPulseSystemPrompt();
    expect(getPulseSystemPrompt('')).toBe(base);
    expect(getPulseSystemPrompt('  ')).toBe(base);
    expect(getPulseSystemPrompt(undefined)).toBe(base);
  });

  it('appends user directives when provided', () => {
    const prompt = getPulseSystemPrompt('Only notify for high-urgency items.');
    expect(prompt).toContain('User Directives');
    expect(prompt).toContain('Only notify for high-urgency items.');
  });
});

describe('buildPulseUserMessage', () => {
  it('includes time context', () => {
    const msg = buildPulseUserMessage(makeContext(), []);
    expect(msg).toContain('Monday');
    expect(msg).toContain('weekday');
  });

  it('includes detected signals', () => {
    const signals: Signal[] = [
      { id: 'stale_goals', label: 'Stale Goals', description: '2 stale', severity: 'warning' },
    ];
    const msg = buildPulseUserMessage(makeContext(), signals);
    expect(msg).toContain('Detected Signals (1)');
    expect(msg).toContain('[WARNING] Stale Goals');
  });

  it('shows active goals', () => {
    const ctx = makeContext({
      goals: {
        active: [
          { id: 'g1', title: 'Learn Rust', progress: 30, updatedAt: new Date(), dueDate: '2026-03-01T00:00:00Z' },
        ],
        stale: [],
        upcoming: [],
      },
    });
    const msg = buildPulseUserMessage(ctx, []);
    expect(msg).toContain('Learn Rust');
    expect(msg).toContain('30%');
    expect(msg).toContain('2026-03-01');
  });

  it('shows memory stats', () => {
    const msg = buildPulseUserMessage(makeContext(), []);
    expect(msg).toContain('Total: 100');
    expect(msg).toContain('Avg importance: 0.50');
  });

  it('shows system health issues', () => {
    const ctx = makeContext({
      systemHealth: { pendingApprovals: 2, triggerErrors: 3 },
    });
    const msg = buildPulseUserMessage(ctx, []);
    expect(msg).toContain('2 pending approval');
    expect(msg).toContain('3 trigger error');
  });

  it('includes blocked actions section when provided', () => {
    const msg = buildPulseUserMessage(makeContext(), [], ['create_memory', 'run_memory_cleanup']);
    expect(msg).toContain('Blocked Actions');
    expect(msg).toContain('create_memory');
    expect(msg).toContain('run_memory_cleanup');
    expect(msg).toContain('DISABLED');
  });

  it('omits blocked actions section when list is empty', () => {
    const msg = buildPulseUserMessage(makeContext(), [], []);
    expect(msg).not.toContain('Blocked Actions');
  });

  it('omits blocked actions section when not provided', () => {
    const msg = buildPulseUserMessage(makeContext(), []);
    expect(msg).not.toContain('Blocked Actions');
  });

  it('includes cooled-down actions section when provided', () => {
    const cooledDown = [
      { type: 'create_memory', remainingMinutes: 25 },
      { type: 'run_memory_cleanup', remainingMinutes: 180 },
    ];
    const msg = buildPulseUserMessage(makeContext(), [], [], cooledDown);
    expect(msg).toContain('Actions in Cooldown');
    expect(msg).toContain('create_memory: available in ~25 min');
    expect(msg).toContain('run_memory_cleanup: available in ~180 min');
    expect(msg).toContain('Do NOT use these action types yet.');
  });

  it('omits cooled-down actions section when list is empty', () => {
    const msg = buildPulseUserMessage(makeContext(), [], [], []);
    expect(msg).not.toContain('Actions in Cooldown');
  });

  it('omits cooled-down actions section when not provided', () => {
    const msg = buildPulseUserMessage(makeContext(), []);
    expect(msg).not.toContain('Actions in Cooldown');
  });
});

describe('parsePulseDecision', () => {
  it('parses valid JSON', () => {
    const json = JSON.stringify({
      reasoning: 'All looks good.',
      actions: [{ type: 'skip', params: {} }],
      reportMessage: 'Nothing to do.',
    });
    const decision = parsePulseDecision(json);

    expect(decision.reasoning).toBe('All looks good.');
    expect(decision.actions).toHaveLength(1);
    expect(decision.reportMessage).toBe('Nothing to do.');
  });

  it('extracts JSON from markdown code block', () => {
    const wrapped = '```json\n{"reasoning":"test","actions":[],"reportMessage":"ok"}\n```';
    const decision = parsePulseDecision(wrapped);

    expect(decision.reasoning).toBe('test');
    expect(decision.reportMessage).toBe('ok');
  });

  it('returns fallback for invalid JSON', () => {
    const decision = parsePulseDecision('not json at all');

    expect(decision.reasoning).toContain('Failed to parse');
    expect(decision.actions).toHaveLength(1);
    expect(decision.actions[0]!.type).toBe('skip');
  });

  it('returns fallback for missing fields', () => {
    const decision = parsePulseDecision('{"foo": "bar"}');

    expect(decision.reasoning).toContain('Invalid');
    expect(decision.actions[0]!.type).toBe('skip');
  });
});
