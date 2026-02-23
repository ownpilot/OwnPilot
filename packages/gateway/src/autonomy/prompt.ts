/**
 * Pulse LLM Prompt Builder
 *
 * Constructs the system prompt and user message for the LLM call
 * during a pulse cycle. Pure functions, no dependencies.
 */

import type { PulseContext } from './context.js';
import type { Signal } from './evaluator.js';

// ============================================================================
// Action schema (what the LLM can request)
// ============================================================================

export interface PulseAction {
  type: 'create_memory' | 'update_goal_progress' | 'send_notification' | 'run_memory_cleanup' | 'skip';
  params: Record<string, unknown>;
}

export interface PulseDecision {
  reasoning: string;
  actions: PulseAction[];
  reportMessage: string;
}

// ============================================================================
// Prompt Builder
// ============================================================================

const SYSTEM_PROMPT = `You are the Autonomy Engine of a personal AI assistant called OwnPilot.
You are running an autonomous pulse — a periodic check of the user's goals, tasks, and system state.
Your role is to assess the current state and decide what proactive actions to take.

IMPORTANT: Be conservative. Only take actions when there is a clear reason to do so.
The user trusts you to manage their data responsibly.

Available action types:
- create_memory: Create a new memory (params: { content: string, type: "fact"|"preference"|"event", importance: 0.0-1.0 })
- update_goal_progress: Update goal progress (params: { goalId: string, progress: number, note: string })
- send_notification: Notify the user about something important (params: { message: string, urgency: "low"|"medium"|"high" })
- run_memory_cleanup: Clean up low-importance memories (params: { minImportance: number })
- skip: Take no action (params: {})

Rules:
- Maximum 5 actions per pulse
- Only send notifications for genuinely important items
- Do NOT create memories about the pulse itself
- Keep reportMessage brief (1-2 sentences summarizing what you found and did)
- Use "skip" if no action is warranted (still provide reasoning)

Respond with ONLY valid JSON matching this schema:
{
  "reasoning": "Brief explanation of your assessment",
  "actions": [{ "type": "...", "params": { ... } }],
  "reportMessage": "Brief summary for the user"
}`;

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
  sections.push(`## Detected Signals (${signals.length})`);
  if (signals.length === 0) {
    sections.push('No signals detected.');
  } else {
    for (const signal of signals) {
      sections.push(`- [${signal.severity.toUpperCase()}] ${signal.label}: ${signal.description}`);
    }
  }
  sections.push('');

  // Goals
  sections.push(`## Active Goals (${ctx.goals.active.length})`);
  if (ctx.goals.active.length === 0) {
    sections.push('No active goals.');
  } else {
    for (const goal of ctx.goals.active.slice(0, 10)) {
      const due = goal.dueDate ? ` | Due: ${goal.dueDate.split('T')[0]}` : '';
      sections.push(
        `- ${goal.title} — ${goal.progress}% progress${due}`
      );
    }
    if (ctx.goals.active.length > 10) {
      sections.push(`  ...and ${ctx.goals.active.length - 10} more`);
    }
  }
  sections.push('');

  // Stale goals
  if (ctx.goals.stale.length > 0) {
    sections.push(`## Stale Goals (${ctx.goals.stale.length})`);
    for (const g of ctx.goals.stale.slice(0, 5)) {
      sections.push(`- ${g.title} — ${g.daysSinceUpdate} days since last update`);
    }
    sections.push('');
  }

  // Upcoming deadlines
  if (ctx.goals.upcoming.length > 0) {
    sections.push(`## Upcoming Deadlines (${ctx.goals.upcoming.length})`);
    for (const g of ctx.goals.upcoming.slice(0, 5)) {
      sections.push(`- ${g.title} — ${g.daysUntilDue} day(s) until due`);
    }
    sections.push('');
  }

  // Memory stats
  sections.push(`## Memory Stats`);
  sections.push(`Total: ${ctx.memories.total} | Recent: ${ctx.memories.recentCount} | Avg importance: ${ctx.memories.avgImportance.toFixed(2)}`);
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
    sections.push(`The following action types are DISABLED and must NOT be used: ${blockedActions.join(', ')}`);
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

/**
 * Get the system prompt for pulse LLM calls.
 */
export function getPulseSystemPrompt(directives?: string): string {
  if (!directives?.trim()) return SYSTEM_PROMPT;
  return SYSTEM_PROMPT + `\n\n## User Directives\nThe user has set these directives for the autonomous engine. Follow them:\n${directives}`;
}

/**
 * Parse the LLM response into a PulseDecision.
 * Returns a safe default on parse failure.
 */
export function parsePulseDecision(response: string): PulseDecision {
  try {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = response.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as PulseDecision;

    // Validate structure
    if (!parsed.reasoning || !Array.isArray(parsed.actions) || !parsed.reportMessage) {
      return fallbackDecision('Invalid LLM response structure');
    }

    return parsed;
  } catch {
    return fallbackDecision('Failed to parse LLM response');
  }
}

function fallbackDecision(reason: string): PulseDecision {
  return {
    reasoning: reason,
    actions: [{ type: 'skip', params: {} }],
    reportMessage: '',
  };
}
