import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { parseClaudeStream, collectStreamText } from '../src/stream-parser.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Readable stream from NDJSON lines. */
function makeStream(lines: string[]): Readable {
  const content = lines.map((l) => (l.endsWith('\n') ? l : l + '\n')).join('');
  return Readable.from([content]);
}

/** Collect all events from an async generator into an array. */
async function collectEvents(stream: Readable) {
  const events = [];
  for await (const ev of parseClaudeStream(stream)) {
    events.push(ev);
  }
  return events;
}

// ---------------------------------------------------------------------------
// parseClaudeStream
// ---------------------------------------------------------------------------

describe('parseClaudeStream()', () => {
  it('always yields done as last event', async () => {
    const events = await collectEvents(makeStream([]));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: 'done' });
  });

  it('skips empty lines', async () => {
    const events = await collectEvents(makeStream(['', '   ', '']));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('done');
  });

  it('skips malformed JSON lines without throwing', async () => {
    const events = await collectEvents(makeStream(['not-json', '{broken', 'also bad']));
    // Only the done event
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('done');
  });

  it('parses content_block_delta text_delta → kind: text', async () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello world' },
    });
    const events = await collectEvents(makeStream([line]));
    expect(events).toHaveLength(2); // text + done
    expect(events[0]).toEqual({ kind: 'text', text: 'Hello world' });
  });

  it('skips content_block_delta with non-text delta type', async () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{}' },
    });
    const events = await collectEvents(makeStream([line]));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('done');
  });

  it('parses result subtype success → kind: result', async () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Task completed',
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const events = await collectEvents(makeStream([line]));
    const resultEv = events.find((e) => e.kind === 'result');
    expect(resultEv).toBeDefined();
    if (resultEv?.kind !== 'result') throw new Error('wrong kind');
    expect(resultEv.result).toBe('Task completed');
    expect(resultEv.subtype).toBe('success');
    expect(resultEv.usage).toEqual({ input_tokens: 10, output_tokens: 20 });
  });

  it('parses result subtype error → kind: error', async () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error',
      result: 'Something went wrong',
    });
    const events = await collectEvents(makeStream([line]));
    const errEv = events.find((e) => e.kind === 'error');
    expect(errEv).toBeDefined();
    if (errEv?.kind !== 'error') throw new Error('wrong kind');
    expect(errEv.message).toBe('Something went wrong');
  });

  it('uses default error message when result text is empty', async () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error', result: '' });
    const events = await collectEvents(makeStream([line]));
    const errEv = events.find((e) => e.kind === 'error');
    expect(errEv?.kind).toBe('error');
    if (errEv?.kind !== 'error') throw new Error('wrong kind');
    expect(errEv.message).toBeTruthy();
  });

  it('parses system event → kind: system_init with session_id', async () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'abc-123',
      tools: [],
    });
    const events = await collectEvents(makeStream([line]));
    const sysEv = events.find((e) => e.kind === 'system_init');
    expect(sysEv).toBeDefined();
    if (sysEv?.kind !== 'system_init') throw new Error('wrong kind');
    expect(sysEv.session_id).toBe('abc-123');
  });

  it('parses system event without session_id', async () => {
    const line = JSON.stringify({ type: 'system', subtype: 'init' });
    const events = await collectEvents(makeStream([line]));
    const sysEv = events.find((e) => e.kind === 'system_init');
    expect(sysEv).toBeDefined();
    if (sysEv?.kind !== 'system_init') throw new Error('wrong kind');
    expect(sysEv.session_id).toBeUndefined();
  });

  it('skips lifecycle events (message_start, message_stop, content_block_start, content_block_stop, message_delta)', async () => {
    const lifecycleLines = [
      JSON.stringify({ type: 'message_start' }),
      JSON.stringify({ type: 'content_block_start', index: 0 }),
      JSON.stringify({ type: 'content_block_stop', index: 0 }),
      JSON.stringify({ type: 'message_delta', usage: { output_tokens: 5 } }),
      JSON.stringify({ type: 'message_stop' }),
    ];
    const events = await collectEvents(makeStream(lifecycleLines));
    // Only done
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('done');
  });

  it('skips unknown event types', async () => {
    const line = JSON.stringify({ type: 'some_future_event', data: {} });
    const events = await collectEvents(makeStream([line]));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('done');
  });

  it('processes multiple JSON objects per chunk (split across lines)', async () => {
    const lines = [
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Part 1' } }),
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' Part 2' } }),
    ];
    const events = await collectEvents(makeStream(lines));
    const textEvents = events.filter((e) => e.kind === 'text');
    expect(textEvents).toHaveLength(2);
    if (textEvents[0].kind !== 'text' || textEvents[1].kind !== 'text') throw new Error('wrong kind');
    expect(textEvents[0].text).toBe('Part 1');
    expect(textEvents[1].text).toBe(' Part 2');
  });

  it('handles UTF-8 multi-byte characters in text', async () => {
    const text = '日本語テスト 🎉 émoji';
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    });
    const events = await collectEvents(makeStream([line]));
    const textEv = events.find((e) => e.kind === 'text');
    if (textEv?.kind !== 'text') throw new Error('wrong kind');
    expect(textEv.text).toBe(text);
  });

  it('handles JSON with nested quotes in text', async () => {
    const text = 'Use "quotes" in \'your\' code: { "key": "value" }';
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    });
    const events = await collectEvents(makeStream([line]));
    const textEv = events.find((e) => e.kind === 'text');
    if (textEv?.kind !== 'text') throw new Error('wrong kind');
    expect(textEv.text).toBe(text);
  });

  it('handles very long lines (> 1KB text)', async () => {
    const longText = 'a'.repeat(100_000);
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: longText },
    });
    const events = await collectEvents(makeStream([line]));
    const textEv = events.find((e) => e.kind === 'text');
    if (textEv?.kind !== 'text') throw new Error('wrong kind');
    expect(textEv.text).toHaveLength(100_000);
  });

  it('result without usage still yields kind: result', async () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'No usage here',
    });
    const events = await collectEvents(makeStream([line]));
    const resultEv = events.find((e) => e.kind === 'result');
    if (resultEv?.kind !== 'result') throw new Error('wrong kind');
    expect(resultEv.usage).toBeUndefined();
  });

  it('chunk with only newlines yields only done', async () => {
    const events = await collectEvents(makeStream(['\n', '\n\n', '\n']));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// collectStreamText
// ---------------------------------------------------------------------------

describe('collectStreamText()', () => {
  it('collects text from content_block_delta events', async () => {
    const lines = [
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } }),
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'World' } }),
    ];
    const result = await collectStreamText(makeStream(lines));
    expect(result.text).toBe('Hello World');
  });

  it('falls back to result.result when no content_block_delta', async () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Final answer',
      usage: { input_tokens: 5, output_tokens: 10 },
    });
    const result = await collectStreamText(makeStream([line]));
    expect(result.text).toBe('Final answer');
    expect(result.usage).toEqual({ input_tokens: 5, output_tokens: 10 });
  });

  it('throws when stream contains error event', async () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error', result: 'Boom' });
    await expect(collectStreamText(makeStream([line]))).rejects.toThrow('Boom');
  });

  it('returns empty string for stream with no text content', async () => {
    const result = await collectStreamText(makeStream([]));
    expect(result.text).toBe('');
    expect(result.usage).toBeUndefined();
  });
});
