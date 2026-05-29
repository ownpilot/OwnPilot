/**
 * Trajectory export tests — claw_history -> ShareGPT format.
 */

import { describe, it, expect } from 'vitest';
import type { ClawHistoryEntry } from '@ownpilot/core';
import { toShareGPT } from './trajectory-export.js';

const config = { id: 'claw-1', name: 'Researcher', mission: 'Find competitor pricing' };

function entry(overrides: Partial<ClawHistoryEntry> = {}): ClawHistoryEntry {
  return {
    id: 'h1',
    clawId: 'claw-1',
    cycleNumber: 1,
    entryType: 'cycle',
    success: true,
    toolCalls: [],
    outputMessage: '',
    durationMs: 0,
    executedAt: new Date(),
    ...overrides,
  };
}

describe('toShareGPT', () => {
  it('starts with a system turn carrying the mission', () => {
    const t = toShareGPT(config, []);
    expect(t.conversations[0].from).toBe('system');
    expect(t.conversations[0].value).toContain('Find competitor pricing');
    expect(t.id).toBe('claw-1');
  });

  it('emits gpt(tool-call) + tool(result) pairs and a final gpt message per cycle', () => {
    const t = toShareGPT(config, [
      entry({
        cycleNumber: 1,
        toolCalls: [
          {
            tool: 'search_web',
            args: { q: 'prices' },
            result: 'found 3',
            success: true,
            durationMs: 5,
          },
        ],
        outputMessage: 'Logged 3 competitors',
      }),
    ]);

    const roles = t.conversations.map((c) => c.from);
    expect(roles).toEqual(['system', 'human', 'gpt', 'tool', 'gpt']);

    const toolCallTurn = t.conversations[2];
    expect(toolCallTurn.value).toContain('search_web');
    expect(t.conversations[3].value).toBe('found 3');
    expect(t.conversations[4].value).toBe('Logged 3 competitors');
  });

  it('orders cycles ascending even when entries arrive newest-first', () => {
    const t = toShareGPT(config, [
      entry({ cycleNumber: 2, outputMessage: 'second' }),
      entry({ cycleNumber: 1, outputMessage: 'first' }),
    ]);
    const humanMarkers = t.conversations.filter((c) => c.from === 'human').map((c) => c.value);
    expect(humanMarkers).toEqual(['Cycle 1', 'Cycle 2']);
  });

  it('serializes non-string tool results as JSON', () => {
    const t = toShareGPT(config, [
      entry({
        toolCalls: [{ tool: 't', args: {}, result: { a: 1 }, success: true, durationMs: 0 }],
      }),
    ]);
    expect(t.conversations.find((c) => c.from === 'tool')?.value).toBe('{"a":1}');
  });

  it('falls back to the error as the gpt turn when no output message', () => {
    const t = toShareGPT(config, [entry({ outputMessage: '', error: 'boom' })]);
    expect(t.conversations.at(-1)?.value).toContain('[error] boom');
  });
});
