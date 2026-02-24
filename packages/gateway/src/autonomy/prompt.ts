/**
 * Pulse Agent Prompt Builder
 *
 * Constructs the personality-rich system prompt and context-dense user message
 * for the pulse agent. The agent uses tools freely (including send_user_notification)
 * rather than returning rigid JSON actions.
 */

import type { PulseContext } from './context.js';
import type { Signal } from './evaluator.js';

// ============================================================================
// System Prompt
// ============================================================================

const PULSE_SYSTEM_PROMPT = `You are the living pulse of OwnPilot — your user's personal AI assistant.
You wake up periodically to check on their world and help proactively.

You have a warm, casual personality — like a thoughtful friend who pays attention.

## What you can do
- Use send_user_notification to message the user (Telegram + web)
- Use get_weather / get_weather_forecast for weather info
- Use search_web to look things up
- Use all memory, goal, task, calendar, custom data tools
- Create memories about patterns you notice

## When to reach out
- Morning (8-10): Brief greeting — weather, today's tasks/habits, anything notable
- Midday: Only for genuinely important things (deadline approaching, broken streak)
- Evening (18-20): Quick wrap-up — habit progress, tomorrow's preview
- NOT every pulse. Most pulses: just observe, learn, take quiet actions.

## Tone
- Brief and natural. No robotic reports. No bullet-point lists.
- "Hey, it's -2 in Tallinn today — bundle up!" not "WEATHER REPORT: Temperature: -2C"
- Celebrate wins: "3-day reading streak — nice!"
- Gentle nudges: "That Python project hasn't moved in a week — want to revisit it?"

## Rules
- Max 1-2 notifications per pulse. Silence is often the best action.
- Create memories about patterns you notice for future reference.
- Respect blocked actions and cooldowns shown in context.
- Do NOT create memories about the pulse itself.
- If there's nothing noteworthy, just respond with a brief internal note — no notification needed.`;

/**
 * Build the full system prompt with optional user directives.
 */
export function getPulseSystemPrompt(ctx: PulseContext, directives?: string): string {
  let prompt = PULSE_SYSTEM_PROMPT;

  if (ctx.userLocation) {
    prompt += `\n\n## User Location\nThe user is located in/near: ${ctx.userLocation}`;
  }

  if (directives?.trim()) {
    prompt += `\n\n## User Directives\nThe user has set these directives for the autonomous engine. Follow them:\n${directives}`;
  }

  return prompt;
}

// ============================================================================
// User Message Builder
// ============================================================================

/**
 * Build the user message containing current state and detected signals.
 */
export function buildPulseUserMessage(
  ctx: PulseContext,
  signals: Signal[],
  blockedActions?: string[],
  cooledDownActions?: Array<{ type: string; remainingMinutes: number }>
): string {
  const sections: string[] = [];

  // Time context
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  sections.push(
    `## Current Time`,
    `${dayNames[ctx.timeContext.dayOfWeek]} ${ctx.timeContext.hour}:00 (${ctx.timeContext.isWeekend ? 'weekend' : 'weekday'})`,
    ''
  );

  // Detected signals
  if (signals.length > 0) {
    sections.push(`## Detected Signals`);
    for (const signal of signals) {
      sections.push(`- [${signal.severity.toUpperCase()}] ${signal.label}: ${signal.description}`);
    }
    sections.push('');
  }

  // Goals
  if (ctx.goals.active.length > 0) {
    sections.push(`## Active Goals (${ctx.goals.active.length})`);
    for (const goal of ctx.goals.active.slice(0, 10)) {
      const due = goal.dueDate ? ` | Due: ${goal.dueDate.split('T')[0]}` : '';
      sections.push(`- ${goal.title} — ${goal.progress}% progress${due}`);
    }
    sections.push('');
  }

  // Stale goals
  if (ctx.goals.stale.length > 0) {
    sections.push(`## Stale Goals`);
    for (const g of ctx.goals.stale.slice(0, 5)) {
      sections.push(`- ${g.title} — ${g.daysSinceUpdate} days since last update`);
    }
    sections.push('');
  }

  // Upcoming deadlines
  if (ctx.goals.upcoming.length > 0) {
    sections.push(`## Upcoming Deadlines`);
    for (const g of ctx.goals.upcoming.slice(0, 5)) {
      sections.push(`- ${g.title} — ${g.daysUntilDue} day(s) until due`);
    }
    sections.push('');
  }

  // Habits
  if (ctx.habits.todayHabits.length > 0) {
    sections.push(`## Today's Habits (${ctx.habits.todayProgress}% done)`);
    for (const h of ctx.habits.todayHabits) {
      const status = h.completed ? 'done' : 'pending';
      const streak = h.streak > 0 ? ` (${h.streak}-day streak)` : '';
      sections.push(`- ${h.name}: ${status}${streak}`);
    }
    sections.push('');
  }

  // Tasks
  if (ctx.tasks.overdue.length > 0 || ctx.tasks.dueToday.length > 0) {
    sections.push(`## Tasks`);
    for (const t of ctx.tasks.overdue.slice(0, 5)) {
      sections.push(`- OVERDUE: ${t.title} (was due ${t.dueDate})`);
    }
    for (const t of ctx.tasks.dueToday.slice(0, 5)) {
      sections.push(`- Due today: ${t.title}`);
    }
    sections.push('');
  }

  // Calendar
  if (ctx.calendar.todayEvents.length > 0 || ctx.calendar.tomorrowEvents.length > 0) {
    sections.push(`## Calendar`);
    for (const e of ctx.calendar.todayEvents) {
      sections.push(`- Today: ${e.title} at ${e.startTime}`);
    }
    for (const e of ctx.calendar.tomorrowEvents) {
      sections.push(`- Tomorrow: ${e.title} at ${e.startTime}`);
    }
    sections.push('');
  }

  // Recent important memories
  if (ctx.recentMemories.length > 0) {
    sections.push(`## Recent Important Memories`);
    for (const m of ctx.recentMemories.slice(0, 5)) {
      sections.push(`- [${m.type}] ${m.content}`);
    }
    sections.push('');
  }

  // Memory stats
  sections.push(`## Memory Stats`);
  sections.push(
    `Total: ${ctx.memories.total} | Recent: ${ctx.memories.recentCount} | Avg importance: ${ctx.memories.avgImportance.toFixed(2)}`
  );
  sections.push('');

  // Activity
  sections.push(`## User Activity`);
  sections.push(
    ctx.activity.hasRecentActivity
      ? 'User has been active recently.'
      : `No activity for ${ctx.activity.daysSinceLastActivity} day(s).`
  );
  sections.push('');

  // System health
  if (ctx.systemHealth.pendingApprovals > 0 || ctx.systemHealth.triggerErrors > 0) {
    sections.push(`## System Health`);
    if (ctx.systemHealth.pendingApprovals > 0) {
      sections.push(`- ${ctx.systemHealth.pendingApprovals} pending approval(s)`);
    }
    if (ctx.systemHealth.triggerErrors > 0) {
      sections.push(`- ${ctx.systemHealth.triggerErrors} trigger error(s) in last 24h`);
    }
    sections.push('');
  }

  // Blocked actions
  if (blockedActions && blockedActions.length > 0) {
    sections.push(`## Blocked Actions`);
    sections.push(
      `The following action types are DISABLED and must NOT be used: ${blockedActions.join(', ')}`
    );
    sections.push('');
  }

  // Actions in cooldown
  if (cooledDownActions && cooledDownActions.length > 0) {
    sections.push(`## Actions in Cooldown`);
    for (const cd of cooledDownActions) {
      sections.push(`- ${cd.type}: available in ~${cd.remainingMinutes} min`);
    }
    sections.push('Do NOT use these action types yet.');
    sections.push('');
  }

  return sections.join('\n');
}
