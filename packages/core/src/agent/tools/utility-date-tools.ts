/**
 * Utility Date/Time Tools
 *
 * - Get current date/time with timezone support
 * - Date difference calculation
 * - Date arithmetic (add/subtract)
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';

// =============================================================================
// GET CURRENT DATETIME
// =============================================================================

export const getCurrentDateTimeTool: ToolDefinition = {
  name: 'get_current_datetime',
  brief: 'Get current date, time, timezone, and day of week',
  description: `Get the current date and time. Call this whenever the user asks "what time is it", "what day is today", or when you need to know the current time for scheduling, deadlines, or time-sensitive responses. Returns ISO, formatted, and unix timestamp.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description:
          'Timezone name (e.g., "Europe/Istanbul", "America/New_York", "UTC"). Defaults to local timezone.',
      },
      format: {
        type: 'string',
        enum: ['iso', 'locale', 'unix', 'all'],
        description:
          'Output format: iso (ISO 8601), locale (localized), unix (timestamp), all (everything). Default: all',
      },
    },
    required: [],
  },
};

export const getCurrentDateTimeExecutor: ToolExecutor = async (
  args
): Promise<ToolExecutionResult> => {
  try {
    const timezone = (args.timezone as string) || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const format = (args.format as string) || 'all';
    const now = new Date();

    const formatDate = (tz: string) => {
      try {
        return new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          weekday: 'long',
        }).format(now);
      } catch {
        return null;
      }
    };

    const localFormatted = formatDate(timezone);
    if (!localFormatted) {
      return {
        content: JSON.stringify({ error: `Invalid timezone: ${timezone}` }),
        isError: true,
      };
    }

    let result: Record<string, unknown>;

    switch (format) {
      case 'iso':
        result = { iso: now.toISOString(), timezone };
        break;
      case 'locale':
        result = { formatted: localFormatted, timezone };
        break;
      case 'unix':
        result = { unix: Math.floor(now.getTime() / 1000), unixMs: now.getTime(), timezone };
        break;
      case 'all':
      default:
        result = {
          iso: now.toISOString(),
          formatted: localFormatted,
          unix: Math.floor(now.getTime() / 1000),
          unixMs: now.getTime(),
          timezone,
          date: now.toISOString().split('T')[0],
          time: now.toISOString().split('T')[1]?.split('.')[0],
          dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone }),
          weekNumber: getWeekNumber(now),
          quarter: Math.ceil((now.getMonth() + 1) / 3),
          isWeekend: [0, 6].includes(now.getDay()),
        };
    }

    return { content: JSON.stringify(result) };
  } catch (error) {
    return {
      content: `Error getting datetime: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// =============================================================================
// DATE DIFFERENCE
// =============================================================================

export const dateDiffTool: ToolDefinition = {
  name: 'date_diff',
  brief: 'Calculate difference between two dates',
  description: `Calculate the difference between two dates. Call this when the user asks "how many days between", "how long until", "how old is", or any date comparison. Returns difference in days, hours, weeks, months, years.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      date1: {
        type: 'string',
        description: 'First date (ISO format, or natural like "2024-01-15")',
      },
      date2: {
        type: 'string',
        description: 'Second date (ISO format, or natural like "2024-03-20")',
      },
      unit: {
        type: 'string',
        enum: ['days', 'hours', 'minutes', 'seconds', 'weeks', 'months', 'years', 'all'],
        description: 'Unit for the result (default: all)',
      },
    },
    required: ['date1', 'date2'],
  },
};

export const dateDiffExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const d1 = new Date(args.date1 as string);
    const d2 = new Date(args.date2 as string);
    const unit = (args.unit as string) || 'all';

    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      return {
        content: JSON.stringify({ error: 'Invalid date format' }),
        isError: true,
      };
    }

    const diffMs = d2.getTime() - d1.getTime();
    const diffSecs = diffMs / 1000;
    const diffMins = diffSecs / 60;
    const diffHours = diffMins / 60;
    const diffDays = diffHours / 24;
    const diffWeeks = diffDays / 7;
    const diffMonths = diffDays / 30.44; // Average days per month
    const diffYears = diffDays / 365.25;

    const formatNum = (n: number) => Number(n.toFixed(2));

    if (unit === 'all') {
      return {
        content: JSON.stringify({
          from: d1.toISOString(),
          to: d2.toISOString(),
          difference: {
            years: formatNum(diffYears),
            months: formatNum(diffMonths),
            weeks: formatNum(diffWeeks),
            days: formatNum(diffDays),
            hours: formatNum(diffHours),
            minutes: formatNum(diffMins),
            seconds: formatNum(diffSecs),
          },
          isPositive: diffMs >= 0,
        }),
      };
    }

    const unitMap: Record<string, number> = {
      seconds: diffSecs,
      minutes: diffMins,
      hours: diffHours,
      days: diffDays,
      weeks: diffWeeks,
      months: diffMonths,
      years: diffYears,
    };

    return {
      content: JSON.stringify({
        from: d1.toISOString(),
        to: d2.toISOString(),
        difference: formatNum(unitMap[unit] || diffDays),
        unit,
      }),
    };
  } catch (error) {
    return {
      content: `Date diff error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

// =============================================================================
// DATE ADD/SUBTRACT
// =============================================================================

export const dateAddTool: ToolDefinition = {
  name: 'date_add',
  brief: 'Add or subtract time from a date',
  description: `Add or subtract time from a date. Call this when the user asks "what date is 30 days from now", "3 weeks ago", "next month", or needs to calculate future/past dates. Use "now" as date for current time.`,
  category: 'Utilities',
  parameters: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Starting date (ISO format or natural). Use "now" for current time.',
      },
      amount: {
        type: 'number',
        description: 'Amount to add (negative to subtract)',
      },
      unit: {
        type: 'string',
        enum: ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'],
        description: 'Time unit',
      },
    },
    required: ['date', 'amount', 'unit'],
  },
};

export const dateAddExecutor: ToolExecutor = async (args): Promise<ToolExecutionResult> => {
  try {
    const dateStr = args.date as string;
    const amount = args.amount as number;
    const unit = args.unit as string;

    const date = dateStr.toLowerCase() === 'now' ? new Date() : new Date(dateStr);

    if (isNaN(date.getTime())) {
      return {
        content: JSON.stringify({ error: 'Invalid date format' }),
        isError: true,
      };
    }

    const result = new Date(date);

    switch (unit) {
      case 'seconds':
        result.setSeconds(result.getSeconds() + amount);
        break;
      case 'minutes':
        result.setMinutes(result.getMinutes() + amount);
        break;
      case 'hours':
        result.setHours(result.getHours() + amount);
        break;
      case 'days':
        result.setDate(result.getDate() + amount);
        break;
      case 'weeks':
        result.setDate(result.getDate() + amount * 7);
        break;
      case 'months':
        result.setMonth(result.getMonth() + amount);
        break;
      case 'years':
        result.setFullYear(result.getFullYear() + amount);
        break;
    }

    return {
      content: JSON.stringify({
        original: date.toISOString(),
        result: result.toISOString(),
        resultFormatted: result.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        added: { amount, unit },
      }),
    };
  } catch (error) {
    return {
      content: `Date add error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};
