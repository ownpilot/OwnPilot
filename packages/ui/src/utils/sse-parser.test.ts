import { describe, it, expect } from 'vitest';
import { parseSSELine } from './sse-parser.js';

describe('parseSSELine', () => {
  // ── skip cases ────────────────────────────────────────────────────────────

  it('skips event type lines', () => {
    expect(parseSSELine('event: done')).toEqual({ kind: 'skip' });
  });

  it('skips lines not starting with "data:"', () => {
    expect(parseSSELine('')).toEqual({ kind: 'skip' });
    expect(parseSSELine('id: 123')).toEqual({ kind: 'skip' });
    expect(parseSSELine(': keepalive')).toEqual({ kind: 'skip' });
  });

  it('skips empty data lines', () => {
    expect(parseSSELine('data:')).toEqual({ kind: 'skip' });
    expect(parseSSELine('data:   ')).toEqual({ kind: 'skip' });
  });

  it('skips malformed JSON', () => {
    expect(parseSSELine('data: {broken')).toEqual({ kind: 'skip' });
    expect(parseSSELine('data: not-json')).toEqual({ kind: 'skip' });
  });

  // ── approval ──────────────────────────────────────────────────────────────

  it('parses approval_required events', () => {
    const line =
      'data: ' +
      JSON.stringify({
        type: 'approval_required',
        approvalId: 'appr-1',
        category: 'code_execution',
        description: 'Run script',
      });
    const result = parseSSELine(line);
    expect(result.kind).toBe('approval');
    if (result.kind === 'approval') {
      expect(result.data.approvalId).toBe('appr-1');
      expect(result.data.category).toBe('code_execution');
    }
  });

  // ── progress ──────────────────────────────────────────────────────────────

  it('parses status progress events', () => {
    const line = 'data: ' + JSON.stringify({ type: 'status', message: 'Thinking...' });
    const result = parseSSELine(line);
    expect(result.kind).toBe('progress');
    if (result.kind === 'progress') {
      expect(result.data.type).toBe('status');
    }
  });

  it('parses tool_start progress events', () => {
    const line = 'data: ' + JSON.stringify({ type: 'tool_start', tool: { name: 'search' } });
    expect(parseSSELine(line).kind).toBe('progress');
  });

  it('parses tool_end progress events', () => {
    const line =
      'data: ' +
      JSON.stringify({ type: 'tool_end', tool: { name: 'search' }, result: { success: true } });
    expect(parseSSELine(line).kind).toBe('progress');
  });

  // ── delta ─────────────────────────────────────────────────────────────────

  it('parses streaming delta chunks', () => {
    const line = 'data: ' + JSON.stringify({ delta: 'Hello', conversationId: 'conv-1' });
    const result = parseSSELine(line);
    expect(result.kind).toBe('delta');
    if (result.kind === 'delta') {
      expect(result.data.delta).toBe('Hello');
      expect(result.data.conversationId).toBe('conv-1');
    }
  });

  it('parses done:true delta (final chunk)', () => {
    const line =
      'data: ' +
      JSON.stringify({
        done: true,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });
    const result = parseSSELine(line);
    expect(result.kind).toBe('delta');
    if (result.kind === 'delta') {
      expect(result.data.done).toBe(true);
      expect(result.data.finishReason).toBe('stop');
    }
  });

  // ── error ─────────────────────────────────────────────────────────────────

  it('parses error events', () => {
    const line = 'data: ' + JSON.stringify({ error: 'Rate limit exceeded' });
    const result = parseSSELine(line);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toBe('Rate limit exceeded');
    }
  });

  // ── unknown shape ─────────────────────────────────────────────────────────

  it('skips unknown JSON shapes', () => {
    const line = 'data: ' + JSON.stringify({ foo: 'bar', baz: 42 });
    expect(parseSSELine(line)).toEqual({ kind: 'skip' });
  });
});
