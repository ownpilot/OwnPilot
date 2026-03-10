/**
 * Tests for OpenCode NDJSON stream parser.
 * TDD RED phase: written before implementation.
 */

import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { parseOpenCodeStream, type OpenCodeEvent } from '../src/opencode-stream-parser.ts';

// Helper: create Readable from NDJSON lines
function makeStream(lines: string[]): Readable {
  return Readable.from(lines.join('\n'));
}

// Helper: collect all events
async function collectEvents(stream: Readable): Promise<OpenCodeEvent[]> {
  const events: OpenCodeEvent[] = [];
  for await (const ev of parseOpenCodeStream(stream)) {
    events.push(ev);
  }
  return events;
}

// ─── session_id extraction ────────────────────────────────────────────────────

describe('parseOpenCodeStream — session_id', () => {
  it('extracts sessionID from first event', async () => {
    const lines = [
      '{"type":"step_start","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_abc123","part":{"id":"p1","sessionID":"ses_abc123","messageID":"msg_1","type":"step_start"}}',
    ];
    const events = await collectEvents(makeStream(lines));
    const sessionEv = events.find((e) => e.kind === 'session_id');
    expect(sessionEv).toBeDefined();
    expect((sessionEv as { kind: 'session_id'; sessionId: string }).sessionId).toBe('ses_abc123');
  });

  it('only emits session_id event once even with multiple events having same sessionID', async () => {
    const lines = [
      '{"type":"step_start","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_xyz","part":{"type":"step_start"}}',
      '{"type":"text","timestamp":"2026-03-04T10:00:01Z","sessionID":"ses_xyz","part":{"type":"text","text":"hello"}}',
    ];
    const events = await collectEvents(makeStream(lines));
    const sessionEvents = events.filter((e) => e.kind === 'session_id');
    expect(sessionEvents).toHaveLength(1);
  });
});

// ─── text events ──────────────────────────────────────────────────────────────

describe('parseOpenCodeStream — text', () => {
  it('yields text events from type=text lines', async () => {
    const lines = [
      '{"type":"text","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_1","part":{"type":"text","text":"Hello world"}}',
    ];
    const events = await collectEvents(makeStream(lines));
    const textEvents = events.filter((e) => e.kind === 'text');
    expect(textEvents).toHaveLength(1);
    expect((textEvents[0] as { kind: 'text'; text: string }).text).toBe('Hello world');
  });

  it('accumulates multiple text events', async () => {
    const lines = [
      '{"type":"text","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_1","part":{"type":"text","text":"Hello "}}',
      '{"type":"text","timestamp":"2026-03-04T10:00:01Z","sessionID":"ses_1","part":{"type":"text","text":"world"}}',
    ];
    const events = await collectEvents(makeStream(lines));
    const textEvents = events.filter((e) => e.kind === 'text');
    expect(textEvents).toHaveLength(2);
    const combined = textEvents.map((e) => (e as { kind: 'text'; text: string }).text).join('');
    expect(combined).toBe('Hello world');
  });

  it('skips text event when part.text is empty', async () => {
    const lines = [
      '{"type":"text","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_1","part":{"type":"text","text":""}}',
    ];
    const events = await collectEvents(makeStream(lines));
    const textEvents = events.filter((e) => e.kind === 'text');
    expect(textEvents).toHaveLength(0);
  });
});

// ─── tool_use events ──────────────────────────────────────────────────────────

describe('parseOpenCodeStream — tool_use', () => {
  it('yields tool_use events', async () => {
    const lines = [
      '{"type":"tool_use","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_1","part":{"type":"tool_use","tool":"bash","input":{"command":"ls"}}}',
    ];
    const events = await collectEvents(makeStream(lines));
    const toolEvents = events.filter((e) => e.kind === 'tool_use');
    expect(toolEvents).toHaveLength(1);
    expect((toolEvents[0] as { kind: 'tool_use'; tool: string }).tool).toBe('bash');
  });
});

// ─── step_finish events ───────────────────────────────────────────────────────

describe('parseOpenCodeStream — step_finish', () => {
  it('yields step_finish events', async () => {
    const lines = [
      '{"type":"step_finish","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_1","part":{"type":"step_finish"}}',
    ];
    const events = await collectEvents(makeStream(lines));
    const finishEvents = events.filter((e) => e.kind === 'step_finish');
    expect(finishEvents).toHaveLength(1);
  });
});

// ─── done event ───────────────────────────────────────────────────────────────

describe('parseOpenCodeStream — done', () => {
  it('yields done event when stream ends', async () => {
    const lines = [
      '{"type":"step_start","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_1","part":{"type":"step_start"}}',
      '{"type":"step_finish","timestamp":"2026-03-04T10:00:01Z","sessionID":"ses_1","part":{"type":"step_finish"}}',
    ];
    const events = await collectEvents(makeStream(lines));
    const doneEvents = events.filter((e) => e.kind === 'done');
    expect(doneEvents).toHaveLength(1);
  });

  it('yields done even on empty stream', async () => {
    const events = await collectEvents(makeStream(['']));
    const doneEvents = events.filter((e) => e.kind === 'done');
    expect(doneEvents).toHaveLength(1);
  });
});

// ─── malformed lines ──────────────────────────────────────────────────────────

describe('parseOpenCodeStream — robustness', () => {
  it('skips non-JSON lines gracefully', async () => {
    const lines = [
      'not-json',
      '{"type":"text","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_1","part":{"type":"text","text":"ok"}}',
    ];
    const events = await collectEvents(makeStream(lines));
    const textEvents = events.filter((e) => e.kind === 'text');
    expect(textEvents).toHaveLength(1);
    expect((textEvents[0] as { kind: 'text'; text: string }).text).toBe('ok');
  });

  it('skips blank lines', async () => {
    const lines = [
      '',
      '   ',
      '{"type":"step_finish","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_1","part":{"type":"step_finish"}}',
    ];
    const events = await collectEvents(makeStream(lines));
    expect(events.some((e) => e.kind === 'done')).toBe(true);
  });

  it('handles unknown event types without error', async () => {
    const lines = [
      '{"type":"unknown_future_type","sessionID":"ses_1","part":{}}',
    ];
    // Should not throw
    const events = await collectEvents(makeStream(lines));
    expect(events.some((e) => e.kind === 'done')).toBe(true);
  });
});

// ─── full flow ────────────────────────────────────────────────────────────────

describe('parseOpenCodeStream — full flow', () => {
  it('handles a realistic multi-event sequence', async () => {
    const lines = [
      '{"type":"step_start","timestamp":"2026-03-04T10:00:00Z","sessionID":"ses_345a94f","part":{"type":"step_start"}}',
      '{"type":"text","timestamp":"2026-03-04T10:00:01Z","sessionID":"ses_345a94f","part":{"type":"text","text":"The answer is "}}',
      '{"type":"text","timestamp":"2026-03-04T10:00:02Z","sessionID":"ses_345a94f","part":{"type":"text","text":"42."}}',
      '{"type":"step_finish","timestamp":"2026-03-04T10:00:03Z","sessionID":"ses_345a94f","part":{"type":"step_finish"}}',
    ];
    const events = await collectEvents(makeStream(lines));

    // session_id emitted once
    expect(events.filter((e) => e.kind === 'session_id')).toHaveLength(1);
    expect((events.find((e) => e.kind === 'session_id') as { kind: 'session_id'; sessionId: string }).sessionId).toBe('ses_345a94f');

    // text chunks
    const textChunks = events.filter((e) => e.kind === 'text').map((e) => (e as { kind: 'text'; text: string }).text);
    expect(textChunks.join('')).toBe('The answer is 42.');

    // step_finish
    expect(events.filter((e) => e.kind === 'step_finish')).toHaveLength(1);

    // done at end
    expect(events[events.length - 1]?.kind).toBe('done');
  });
});
