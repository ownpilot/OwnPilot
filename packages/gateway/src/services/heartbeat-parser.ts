/**
 * Heartbeat Parser
 *
 * Rule-based NL-to-cron parser for natural language schedule expressions.
 * Also parses markdown format where ## headings are schedules and body is task description.
 */

import { validateCronExpression } from '@ownpilot/core';

// ============================================================================
// Types
// ============================================================================

export interface ScheduleParseResult {
  cron: string;
  normalized: string; // Human-readable normalized form
}

export interface ParsedHeartbeatEntry {
  scheduleText: string;
  cron: string;
  taskDescription: string;
  normalized: string;
}

export interface ParseError {
  scheduleText: string;
  error: string;
}

// ============================================================================
// Constants
// ============================================================================

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const TIME_OF_DAY_DEFAULTS: Record<string, { hour: number; minute: number }> = {
  morning: { hour: 8, minute: 0 },
  afternoon: { hour: 14, minute: 0 },
  evening: { hour: 20, minute: 0 },
  night: { hour: 22, minute: 0 },
  noon: { hour: 12, minute: 0 },
  midnight: { hour: 0, minute: 0 },
};

// ============================================================================
// Time Parsing Helpers
// ============================================================================

/**
 * Extract time (HH:MM) from the end of a text.
 * Returns defaults if no time found.
 */
function extractTime(text: string, defaultHour: number, defaultMinute = 0): { hour: number; minute: number; rest: string } {
  // Match HH:MM at end (with optional "at" prefix)
  const timeMatch = text.match(/(?:\bat\s+)?(\d{1,2}):(\d{2})\s*$/i);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1]!, 10);
    const minute = parseInt(timeMatch[2]!, 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const rest = text.slice(0, timeMatch.index!).trim();
      return { hour, minute, rest };
    }
  }

  // Match bare hour like "at 8" or "8:00" already handled above
  const bareHourMatch = text.match(/\bat\s+(\d{1,2})\s*$/i);
  if (bareHourMatch) {
    const hour = parseInt(bareHourMatch[1]!, 10);
    if (hour >= 0 && hour <= 23) {
      const rest = text.slice(0, bareHourMatch.index!).trim();
      return { hour, minute: 0, rest };
    }
  }

  return { hour: defaultHour, minute: defaultMinute, rest: text };
}

/**
 * Format time as HH:MM for human-readable output.
 */
function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

// ============================================================================
// Schedule Parser
// ============================================================================

/**
 * Parse a natural language schedule into a cron expression.
 *
 * Supported patterns:
 * - "Every Morning [HH:MM]" → {MM} {HH|8} * * *
 * - "Every Night/Evening [HH:MM]" → {MM} {HH|22} * * *
 * - "Every Day [at HH:MM]" → {MM} {HH|9} * * *
 * - "Every Hour" → 0 * * * *
 * - "Every N Minutes" → * /N * * * *
 * - "Every N Hours" → 0 * /N * * *
 * - "Every <weekday> [HH:MM]" → {MM} {HH|9} * * {dow}
 * - "Weekdays [HH:MM]" → {MM} {HH|9} * * 1-5
 * - "Weekends [HH:MM]" → {MM} {HH|10} * * 0,6
 * - "Every Month [Nth] [HH:MM]" → {MM} {HH|9} {N|1} * *
 */
export function parseSchedule(text: string): ScheduleParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new HeartbeatParseError('Schedule text cannot be empty');
  }

  const lower = trimmed.toLowerCase();

  // "Every N Minutes"
  const everyMinutesMatch = lower.match(/^every\s+(\d+)\s+minutes?$/);
  if (everyMinutesMatch) {
    const n = parseInt(everyMinutesMatch[1]!, 10);
    if (n < 1 || n > 59) throw new HeartbeatParseError(`Minutes must be between 1 and 59, got ${n}`);
    const cron = `*/${n} * * * *`;
    return validateAndReturn(cron, `Every ${n} minutes`);
  }

  // "Every N Hours"
  const everyHoursMatch = lower.match(/^every\s+(\d+)\s+hours?$/);
  if (everyHoursMatch) {
    const n = parseInt(everyHoursMatch[1]!, 10);
    if (n < 1 || n > 23) throw new HeartbeatParseError(`Hours must be between 1 and 23, got ${n}`);
    const cron = `0 */${n} * * *`;
    return validateAndReturn(cron, `Every ${n} hours`);
  }

  // "Every Hour"
  if (/^every\s+hour$/i.test(lower)) {
    return validateAndReturn('0 * * * *', 'Every hour');
  }

  // "Every Minute" (mainly for testing)
  if (/^every\s+minute$/i.test(lower)) {
    return validateAndReturn('* * * * *', 'Every minute');
  }

  // "Every Morning [HH:MM]"
  const morningMatch = lower.match(/^every\s+morning/);
  if (morningMatch) {
    const { hour, minute } = extractTime(trimmed, TIME_OF_DAY_DEFAULTS.morning!.hour);
    const cron = `${minute} ${hour} * * *`;
    return validateAndReturn(cron, `Every morning at ${formatTime(hour, minute)}`);
  }

  // "Every Afternoon [HH:MM]"
  const afternoonMatch = lower.match(/^every\s+afternoon/);
  if (afternoonMatch) {
    const { hour, minute } = extractTime(trimmed, TIME_OF_DAY_DEFAULTS.afternoon!.hour);
    const cron = `${minute} ${hour} * * *`;
    return validateAndReturn(cron, `Every afternoon at ${formatTime(hour, minute)}`);
  }

  // "Every Evening [HH:MM]"
  const eveningMatch = lower.match(/^every\s+evening/);
  if (eveningMatch) {
    const { hour, minute } = extractTime(trimmed, TIME_OF_DAY_DEFAULTS.evening!.hour);
    const cron = `${minute} ${hour} * * *`;
    return validateAndReturn(cron, `Every evening at ${formatTime(hour, minute)}`);
  }

  // "Every Night [HH:MM]"
  const nightMatch = lower.match(/^every\s+night/);
  if (nightMatch) {
    const { hour, minute } = extractTime(trimmed, TIME_OF_DAY_DEFAULTS.night!.hour);
    const cron = `${minute} ${hour} * * *`;
    return validateAndReturn(cron, `Every night at ${formatTime(hour, minute)}`);
  }

  // "Every <weekday> [HH:MM]"
  for (const [dayName, dow] of Object.entries(WEEKDAY_MAP)) {
    const weekdayRegex = new RegExp(`^every\\s+${dayName}\\b`, 'i');
    if (weekdayRegex.test(lower)) {
      const { hour, minute } = extractTime(trimmed, 9);
      const cron = `${minute} ${hour} * * ${dow}`;
      const displayDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      return validateAndReturn(cron, `Every ${displayDay} at ${formatTime(hour, minute)}`);
    }
  }

  // "Weekdays [HH:MM]"
  if (/^(?:every\s+)?weekdays?\b/i.test(lower)) {
    const { hour, minute } = extractTime(trimmed, 9);
    const cron = `${minute} ${hour} * * 1-5`;
    return validateAndReturn(cron, `Weekdays at ${formatTime(hour, minute)}`);
  }

  // "Weekends [HH:MM]"
  if (/^(?:every\s+)?weekends?\b/i.test(lower)) {
    const { hour, minute } = extractTime(trimmed, 10);
    const cron = `${minute} ${hour} * * 0,6`;
    return validateAndReturn(cron, `Weekends at ${formatTime(hour, minute)}`);
  }

  // "Every Month [Nth] [HH:MM]"
  const monthMatch = lower.match(/^every\s+month(?:\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?)?/i);
  if (monthMatch) {
    const dayOfMonth = monthMatch[1] ? parseInt(monthMatch[1], 10) : 1;
    if (dayOfMonth < 1 || dayOfMonth > 31) throw new HeartbeatParseError(`Day of month must be 1-31, got ${dayOfMonth}`);
    const { hour, minute } = extractTime(trimmed, 9);
    const cron = `${minute} ${hour} ${dayOfMonth} * *`;
    return validateAndReturn(cron, `Monthly on the ${ordinal(dayOfMonth)} at ${formatTime(hour, minute)}`);
  }

  // "Every Day [at HH:MM]"
  const dailyMatch = lower.match(/^every\s+day\b/);
  if (dailyMatch) {
    const { hour, minute } = extractTime(trimmed, 9);
    const cron = `${minute} ${hour} * * *`;
    return validateAndReturn(cron, `Every day at ${formatTime(hour, minute)}`);
  }

  // "Daily [at HH:MM]"
  if (/^daily\b/i.test(lower)) {
    const { hour, minute } = extractTime(trimmed, 9);
    const cron = `${minute} ${hour} * * *`;
    return validateAndReturn(cron, `Daily at ${formatTime(hour, minute)}`);
  }

  throw new HeartbeatParseError(`Cannot parse schedule: "${trimmed}". Try formats like "Every Morning 8:00", "Every Friday 17:00", "Every Hour", "Weekdays 9:00".`);
}

// ============================================================================
// Markdown Parser
// ============================================================================

/**
 * Parse a markdown document where ## headings are schedule expressions
 * and the body text underneath is the task description.
 *
 * Example:
 * ```
 * ## Every Morning 8:00
 * Summarize my unread emails and pending tasks
 *
 * ## Every Friday 17:00
 * Generate weekly expense report
 * ```
 */
export function parseMarkdown(markdown: string): {
  entries: ParsedHeartbeatEntry[];
  errors: ParseError[];
} {
  const entries: ParsedHeartbeatEntry[] = [];
  const errors: ParseError[] = [];

  if (!markdown.trim()) {
    return { entries, errors };
  }

  // Split on ## headings
  const sections = markdown.split(/^##\s+/m).filter(Boolean);

  for (const section of sections) {
    const lines = section.split('\n');
    const scheduleText = lines[0]!.trim();
    const taskDescription = lines.slice(1).join('\n').trim();

    if (!scheduleText || !taskDescription) continue;

    try {
      const result = parseSchedule(scheduleText);
      entries.push({
        scheduleText,
        cron: result.cron,
        taskDescription,
        normalized: result.normalized,
      });
    } catch (e) {
      errors.push({
        scheduleText,
        error: e instanceof HeartbeatParseError ? e.message : String(e),
      });
    }
  }

  return { entries, errors };
}

// ============================================================================
// Helpers
// ============================================================================

function validateAndReturn(cron: string, normalized: string): ScheduleParseResult {
  const validation = validateCronExpression(cron);
  if (!validation.valid) {
    throw new HeartbeatParseError(`Generated invalid cron "${cron}": ${validation.error}`);
  }
  return { cron, normalized };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0])!;
}

// ============================================================================
// Error Type
// ============================================================================

export class HeartbeatParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeartbeatParseError';
  }
}
