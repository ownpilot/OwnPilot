/**
 * Tests for the Pulse Prompt Builder
 */

import { describe, it, expect } from 'vitest';
import { getPulseSystemPrompt, buildPulseUserMessage } from './prompt.js';
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
    habits: { todayHabits: [], todayProgress: 0 },
    tasks: { overdue: [], dueToday: [] },
    calendar: { todayEvents: [], tomorrowEvents: [] },
    recentMemories: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('getPulseSystemPrompt', () => {
  it('returns a non-empty personality-rich prompt', () => {
    const ctx = makeContext();
    const prompt = getPulseSystemPrompt(ctx);
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain('pulse');
    expect(prompt).toContain('send_user_notification');
  });

  it('returns base prompt when directives are empty', () => {
    const ctx = makeContext();
    const base = getPulseSystemPrompt(ctx);
    expect(getPulseSystemPrompt(ctx, '')).toBe(base);
    expect(getPulseSystemPrompt(ctx, '  ')).toBe(base);
    expect(getPulseSystemPrompt(ctx, undefined)).toBe(base);
  });

  it('appends user directives when provided', () => {
    const ctx = makeContext();
    const prompt = getPulseSystemPrompt(ctx, 'Only notify for high-urgency items.');
    expect(prompt).toContain('User Directives');
    expect(prompt).toContain('Only notify for high-urgency items.');
  });

  it('includes user location when available', () => {
    const ctx = makeContext({ userLocation: 'Tallinn, Estonia' });
    const prompt = getPulseSystemPrompt(ctx);
    expect(prompt).toContain('User Location');
    expect(prompt).toContain('Tallinn, Estonia');
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
    expect(msg).toContain('Detected Signals');
    expect(msg).toContain('[WARNING] Stale Goals');
  });

  it('omits signals section when none detected', () => {
    const msg = buildPulseUserMessage(makeContext(), []);
    expect(msg).not.toContain('Detected Signals');
  });

  it('shows active goals', () => {
    const ctx = makeContext({
      goals: {
        active: [
          {
            id: 'g1',
            title: 'Learn Rust',
            progress: 30,
            updatedAt: new Date(),
            dueDate: '2026-03-01T00:00:00Z',
          },
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

  it('shows habits progress', () => {
    const ctx = makeContext({
      habits: {
        todayHabits: [
          { name: 'Reading', completed: true, streak: 3 },
          { name: 'Exercise', completed: false, streak: 0 },
        ],
        todayProgress: 50,
      },
    });
    const msg = buildPulseUserMessage(ctx, []);
    expect(msg).toContain("Today's Habits (50% done)");
    expect(msg).toContain('Reading: done (3-day streak)');
    expect(msg).toContain('Exercise: pending');
  });

  it('shows overdue and due-today tasks', () => {
    const ctx = makeContext({
      tasks: {
        overdue: [{ title: 'Fix bug', dueDate: '2026-02-20' }],
        dueToday: [{ title: 'Write docs', priority: 'high' }],
      },
    });
    const msg = buildPulseUserMessage(ctx, []);
    expect(msg).toContain('OVERDUE: Fix bug');
    expect(msg).toContain('Due today: Write docs');
  });

  it('shows calendar events', () => {
    const ctx = makeContext({
      calendar: {
        todayEvents: [{ title: 'Team sync', startTime: '14:00' }],
        tomorrowEvents: [{ title: 'Dentist', startTime: '09:00' }],
      },
    });
    const msg = buildPulseUserMessage(ctx, []);
    expect(msg).toContain('Today: Team sync at 14:00');
    expect(msg).toContain('Tomorrow: Dentist at 09:00');
  });

  it('shows recent important memories', () => {
    const ctx = makeContext({
      recentMemories: [{ content: 'User prefers dark mode', type: 'preference', importance: 0.8 }],
    });
    const msg = buildPulseUserMessage(ctx, []);
    expect(msg).toContain('Recent Important Memories');
    expect(msg).toContain('[preference] User prefers dark mode');
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
