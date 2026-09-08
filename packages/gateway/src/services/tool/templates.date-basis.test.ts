/**
 * date_range template — day-basis regression (round 67).
 *
 * The 'date' output format of the generate_date_range template must emit the
 * user's LOCAL calendar day ('YYYY-MM-DD'), not the UTC day: these strings
 * are scheduling/planning day keys and repo convention stores calendar days
 * locally (see ui/src/utils/formatters.ts localDayString doc). Pre-fix, the
 * template extracted days via toISOString().split('T')[0], so every emitted
 * date was off by one day for |offset| hours after local midnight (UTC+
 * zones) or before local midnight (UTC- zones).
 *
 * This file is separate from templates.test.ts (pure shape coverage) because
 * it pins the process timezone and executes template code through the real
 * dynamic-tool registry + vm sandbox — the same path production uses
 * (gateway services/custom/tool-registry.ts → executeDynamicTool).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TOOL_TEMPLATES } from './templates.js';
import { createDynamicToolRegistry } from '@ownpilot/core/tools';
import { validateToolCode } from '@ownpilot/core/sandbox';

// Pin the zone in beforeAll (runs after imports, before tests). September
// 2026: Europe/Kiev is UTC+3 (summer time). Node >= 16 honors runtime TZ
// changes; restored afterwards so this file cannot leak the pin.
const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'Europe/Kiev';
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

function getDateRangeTemplate() {
  const template = TOOL_TEMPLATES.find((t) => t.id === 'date_range');
  if (!template) throw new Error('date_range template missing from TOOL_TEMPLATES');
  return template;
}

function registerDateRangeTool() {
  const template = getDateRangeTemplate();
  const registry = createDynamicToolRegistry();
  registry.register({
    name: template.name,
    description: template.description,
    parameters: template.parameters as never,
    code: template.code,
    permissions: [],
  });
  return { registry, name: template.name };
}

const CONTEXT = {
  callId: 'templates-date-basis-test',
  conversationId: 'templates-date-basis-test',
  userId: 'templates-date-basis-test',
} as never;

async function runDateRange(args: Record<string, unknown>): Promise<{ dates: string[] }> {
  const { registry, name } = registerDateRangeTool();
  const res = await registry.execute(name, args, CONTEXT);
  if (res.isError) {
    throw new Error(`date_range tool errored: ${String(res.content)}`);
  }
  return res.content as { dates: string[] };
}

describe('generate_date_range day basis (round 67)', () => {
  it('zone assumption holds: pinned zone renders the proof instant as local 2026-09-08', () => {
    // 2026-09-07T22:00:00Z == 2026-09-08T01:00 Kiev (UTC+3). If this guard
    // fails, the environment ignored the TZ pin and the basis tests below
    // are not measuring what they claim.
    const d = new Date('2026-09-07T22:00:00Z');
    expect(d.getTimezoneOffset()).toBe(-180);
    expect(d.getDate()).toBe(8);
  });

  it('emits LOCAL calendar days for instants in the first hours of the local day', async () => {
    const { dates } = await runDateRange({
      start: '2026-09-08T01:00:00+03:00', // 2026-09-07T22:00:00Z: local day Sep 8, UTC day Sep 7
      end: '2026-09-10T01:00:00+03:00',
      step: 'days',
      stepSize: 1,
      format: 'date',
    });
    expect(dates).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
  });

  it('iso format still emits the exact instants (UTC timestamps are correct as-is)', async () => {
    const { dates } = await runDateRange({
      start: '2026-09-08T01:00:00+03:00',
      end: '2026-09-10T01:00:00+03:00',
      step: 'days',
      stepSize: 1,
      format: 'iso',
    });
    expect(dates).toEqual([
      '2026-09-07T22:00:00.000Z',
      '2026-09-08T22:00:00.000Z',
      '2026-09-09T22:00:00.000Z',
    ]);
  });

  it('midday instants (UTC day == local day) are unaffected', async () => {
    const { dates } = await runDateRange({
      start: '2026-09-08T12:00:00+03:00',
      end: '2026-09-09T12:00:00+03:00',
      step: 'days',
      stepSize: 1,
      format: 'date',
    });
    expect(dates).toEqual(['2026-09-08', '2026-09-09']);
  });

  it('start: "now" resolves to the local calendar day of the current instant', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-07T22:00:00Z')); // 2026-09-08T01:00 Kiev
      const { dates } = await runDateRange({
        start: 'now',
        end: '2026-09-08T01:00:00+03:00', // inclusive bound == now → exactly one iteration
        step: 'days',
        stepSize: 1,
        format: 'date',
      });
      expect(dates).toEqual(['2026-09-08']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('date_range template code passes the production tool-code validator', () => {
    // The instantiation route (POST /custom-tools/templates/:id/create) runs
    // this gate before a tool can be created from the template — the fix
    // must not regress it.
    const validation = validateToolCode(getDateRangeTemplate().code);
    expect(validation.valid).toBe(true);
  });
});
