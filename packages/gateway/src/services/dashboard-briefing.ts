/**
 * Dashboard — AI Briefing Generation
 *
 * Cache, prompt building, AI generation, and fallback logic
 * for the daily briefing feature.
 */

import type { DailyBriefingData, AIBriefing } from './dashboard-types.js';
import { getLog } from './log.js';

const log = getLog('DashboardBriefing');

// ============================================================================
// Cache Implementation with Smart Invalidation
// ============================================================================

interface CacheEntry {
  briefing: AIBriefing;
  dataHash: string;
  expiresAt: number;
}

/**
 * Calculate a hash/fingerprint of the data for smart cache invalidation.
 * Changes when the underlying data changes significantly.
 */
export function calculateDataHash(data: DailyBriefingData): string {
  const hashParts = [
    `t:${data.tasks.counts.pending},${data.tasks.counts.dueToday},${data.tasks.counts.overdue}`,
    `c:${data.calendar.counts.today}`,
    `g:${data.goals.stats.activeCount},${Math.round(data.goals.stats.averageProgress)}`,
    `h:${data.habits.todayProgress.completed}/${data.habits.todayProgress.total}`,
    `tr:${data.triggers.counts.scheduledToday}`,
    `p:${data.plans.running.length},${data.plans.pendingApproval.length}`,
  ];

  return hashParts.join('|');
}

class BriefingCache {
  private cache = new Map<string, CacheEntry>();
  private readonly DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_ENTRIES = 500;

  get(userId: string, currentDataHash?: string): AIBriefing | null {
    const entry = this.cache.get(userId);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(userId);
      return null;
    }

    if (currentDataHash && entry.dataHash !== currentDataHash) {
      log.info('[BriefingCache] Data changed, invalidating cache');
      this.cache.delete(userId);
      return null;
    }

    return { ...entry.briefing, cached: true };
  }

  set(userId: string, briefing: AIBriefing, dataHash: string, ttlMs?: number): void {
    const ttl = ttlMs ?? this.DEFAULT_TTL_MS;
    this.cache.set(userId, {
      briefing,
      dataHash,
      expiresAt: Date.now() + ttl,
    });

    if (this.cache.size > this.MAX_ENTRIES) {
      this.prune();
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  getDataHash(userId: string): string | null {
    const entry = this.cache.get(userId);
    return entry?.dataHash ?? null;
  }

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const briefingCache = new BriefingCache();

// ============================================================================
// AI Briefing Generation
// ============================================================================

/**
 * Generate AI briefing from aggregated data (non-streaming).
 */
export async function generateAIBriefing(
  userId: string,
  data: DailyBriefingData,
  options?: { forceRefresh?: boolean; provider?: string; model?: string }
): Promise<AIBriefing> {
  const dataHash = calculateDataHash(data);

  if (!options?.forceRefresh) {
    const cached = briefingCache.get(userId, dataHash);
    if (cached) return cached;
  }

  const prompt = buildBriefingPrompt(data);

  const { getDefaultProvider, getDefaultModel } = await import('../routes/settings.js');
  const provider = options?.provider ?? (await getDefaultProvider()) ?? 'openai';
  const model = options?.model ?? (await getDefaultModel(provider)) ?? 'gpt-4o-mini';

  try {
    const { getOrCreateChatAgent } = await import('../routes/agents.js');
    const agent = await getOrCreateChatAgent(provider, model);
    const result = await agent.chat(prompt, { stream: false });

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const briefing = parseAIResponse(result.value.content, model);
    briefingCache.set(userId, briefing, dataHash);
    return briefing;
  } catch (error) {
    log.error('[DashboardBriefing] AI briefing generation failed:', error);
    return generateFallbackBriefing(data);
  }
}

/**
 * Generate AI briefing with streaming support.
 */
export async function generateAIBriefingStreaming(
  userId: string,
  data: DailyBriefingData,
  options: { provider: string; model?: string },
  onChunk: (chunk: string) => Promise<void>
): Promise<AIBriefing> {
  const dataHash = calculateDataHash(data);
  const prompt = buildBriefingPrompt(data);

  const { getDefaultModel } = await import('../routes/settings.js');
  const model = options.model ?? (await getDefaultModel(options.provider)) ?? 'default';

  try {
    const { getOrCreateChatAgent } = await import('../routes/agents.js');
    const agent = await getOrCreateChatAgent(options.provider, model);

    let fullContent = '';

    const result = await agent.chat(prompt, {
      stream: true,
      onChunk: (chunk) => {
        if (chunk.content) {
          fullContent += chunk.content;
          onChunk(chunk.content).catch((err) =>
            log.error('[DashboardBriefing] Chunk callback error:', err)
          );
        }
      },
    });

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const content = fullContent || result.value.content;
    const briefing = parseAIResponse(content, model);
    briefingCache.set(userId, briefing, dataHash);
    return briefing;
  } catch (error) {
    log.error('[DashboardBriefing] Streaming AI briefing failed:', error);
    return generateFallbackBriefing(data);
  }
}

/**
 * Build the prompt for AI briefing generation.
 */
export function buildBriefingPrompt(data: DailyBriefingData): string {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const tasksList =
    data.tasks.overdue
      .slice(0, 3)
      .map((t) => `  - [OVERDUE] ${t.title}`)
      .join('\n') +
    (data.tasks.overdue.length > 0 ? '\n' : '') +
    data.tasks.dueToday
      .slice(0, 5)
      .map((t) => `  - ${t.title} (${t.priority} priority)`)
      .join('\n');

  const eventsList = data.calendar.todayEvents
    .slice(0, 5)
    .map((e) => {
      const time = new Date(e.startTime).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return `  - ${time}: ${e.title}`;
    })
    .join('\n');

  const nextActionsList = data.goals.nextActions
    .slice(0, 3)
    .map((a) => `  - Next: ${a.title} (for goal)`)
    .join('\n');

  const streaksAtRiskList = data.habits.streaksAtRisk
    .slice(0, 3)
    .map((h) => `  - ${h.name} (${h.streakCurrent} day streak)`)
    .join('\n');

  return `You are a personal AI assistant generating a daily briefing for ${today}.

## Today's Data

### Tasks
- Overdue: ${data.tasks.counts.overdue} tasks
- Due Today: ${data.tasks.counts.dueToday} tasks
- Pending: ${data.tasks.counts.pending} tasks
${tasksList || '  (no tasks)'}

### Calendar
- ${data.calendar.counts.today} events today
${eventsList || '  (no events)'}

### Goals
- ${data.goals.stats.activeCount} active goals
- Average progress: ${Math.round(data.goals.stats.averageProgress)}%
- ${data.goals.stats.overdueCount} overdue goals
${nextActionsList || '  (no next actions)'}

### Habits
- Progress: ${data.habits.todayProgress.completed}/${data.habits.todayProgress.total} completed
- ${data.habits.streaksAtRisk.length} streaks at risk
${streaksAtRiskList || '  (no streaks at risk)'}

### AI Costs
- Today: $${data.costs.daily.totalCost.toFixed(2)} (${data.costs.daily.totalTokens.toLocaleString('en-US')} tokens)
- This month: $${data.costs.monthly.totalCost.toFixed(2)}

### Running Automations
- ${data.triggers.counts.scheduledToday} triggers scheduled for today
- ${data.plans.running.length} plans currently running

Generate a daily briefing with:
1. A natural language SUMMARY (2-3 sentences) of the day ahead
2. Top 3-5 PRIORITIES for today (ordered by importance)
3. 2-3 INSIGHTS or patterns you notice
4. 2-3 SUGGESTED FOCUS AREAS

Format your response as JSON:
{
  "summary": "...",
  "priorities": ["...", "..."],
  "insights": ["...", "..."],
  "suggestedFocusAreas": ["...", "..."]
}`;
}

/**
 * Parse AI response into structured briefing.
 */
export function parseAIResponse(content: string, model: string): AIBriefing {
  try {
    // Strategy 1: Extract JSON from markdown code fences
    const fenceMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    let jsonStr: string | undefined;

    if (fenceMatch) {
      jsonStr = fenceMatch[1];
    } else {
      // Strategy 2: Find the first complete top-level JSON object by brace balancing
      const startIdx = content.indexOf('{');
      if (startIdx !== -1) {
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = startIdx; i < content.length; i++) {
          const ch = content[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (ch === '\\' && inString) {
            escape = true;
            continue;
          }
          if (ch === '"' && !escape) {
            inString = !inString;
            continue;
          }
          if (inString) continue;
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              jsonStr = content.slice(startIdx, i + 1);
              break;
            }
          }
        }
      }
    }

    if (!jsonStr) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonStr);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

    return {
      id: `briefing_${Date.now()}`,
      summary: parsed.summary ?? 'No summary available.',
      priorities: Array.isArray(parsed.priorities) ? parsed.priorities : [],
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      suggestedFocusAreas: Array.isArray(parsed.suggestedFocusAreas)
        ? parsed.suggestedFocusAreas
        : [],
      generatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      modelUsed: model,
      cached: false,
    };
  } catch (error) {
    log.error('[DashboardBriefing] Failed to parse AI response:', error);
    throw error;
  }
}

/**
 * Generate fallback briefing when AI fails.
 */
export function generateFallbackBriefing(data: DailyBriefingData): AIBriefing {
  const priorities: string[] = [];

  if (data.tasks.counts.overdue > 0) {
    priorities.push(`Address ${data.tasks.counts.overdue} overdue task(s)`);
  }
  if (data.tasks.counts.dueToday > 0) {
    priorities.push(`Complete ${data.tasks.counts.dueToday} task(s) due today`);
  }
  if (data.calendar.counts.today > 0) {
    priorities.push(`Attend ${data.calendar.counts.today} scheduled event(s)`);
  }
  if (data.habits.streaksAtRisk.length > 0) {
    priorities.push(`Maintain ${data.habits.streaksAtRisk.length} habit streak(s) at risk`);
  }

  return {
    id: `briefing_fallback_${Date.now()}`,
    summary: `Today you have ${data.tasks.counts.dueToday} tasks due, ${data.calendar.counts.today} events, and ${data.habits.todayProgress.total} habits to complete.`,
    priorities,
    insights: ['AI briefing generation is currently unavailable.'],
    suggestedFocusAreas: ['Complete your most urgent tasks first.'],
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    modelUsed: 'fallback',
    cached: false,
  };
}
