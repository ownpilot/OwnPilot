/**
 * Claw CLI Commands Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function apiOk<T>(data: T) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}
function apiErr(status = 500) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } }),
  };
}

import {
  clawList,
  clawGet,
  clawStats,
  clawStart,
  clawPause,
  clawResume,
  clawStop,
  clawDelete,
  clawSendMessage,
  clawNextIntent,
  clawSteer,
  clawResetFailures,
  clawApproveEscalation,
  clawDenyEscalation,
  clawHistory,
  clawPresets,
  clawWatch,
  formatClawEvent,
  type WebSocketLike,
} from './claw.js';

describe('Claw CLI Commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ─── Listing & detail ──────────────────────────────────────────────

  describe('clawList', () => {
    it('renders claws with state, focus, and operator-queued intent badge', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          total: 1,
          claws: [
            {
              id: 'claw-abc',
              name: 'Build agent',
              mode: 'continuous',
              depth: 0,
              session: {
                state: 'running',
                cyclesCompleted: 7,
                totalCostUsd: 0.0123,
                consecutiveErrors: 2,
                nextIntent: '[OPERATOR] switch focus to auth bug',
                tasks: [
                  { status: 'completed', title: 'Survey codebase' },
                  { status: 'in_progress', title: 'Fix flaky test', cyclesInProgress: 6 },
                ],
              },
            },
          ],
        })
      );
      await clawList();
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('Claws (1):');
      expect(out).toContain('Build agent');
      expect(out).toContain('▶ running');
      expect(out).toContain('continuous');
      expect(out).toContain('cyc=   7');
      expect(out).toContain('err×2');
      expect(out).toContain('focus: Fix flaky test');
      expect(out).toContain('⚠6c');
      expect(out).toContain('↳ op-queued: switch focus to auth bug');
    });

    it('handles the empty list cleanly', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ total: 0, claws: [] }));
      await clawList();
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('No claws configured');
    });
  });

  describe('clawGet', () => {
    it('prints JSON for the claw', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ id: 'c1', name: 'Helper' }));
      await clawGet('c1');
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('"id": "c1"');
      expect(out).toContain('"name": "Helper"');
    });

    it('errors on missing id', async () => {
      await clawGet('');
      expect(errorSpy).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('clawStats', () => {
    it('shows aggregate counts and bucket breakdowns', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          total: 5,
          running: 2,
          totalCost: 1.2345,
          totalCycles: 100,
          totalToolCalls: 250,
          byMode: { continuous: 3, interval: 2 },
          byState: { running: 2, stopped: 3 },
          byHealth: { healthy: 4, stuck: 1 },
          needsAttention: 1,
          llmConcurrency: { max: 8, active: 2, queued: 0 },
        })
      );
      await clawStats();
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('Total:           5');
      expect(out).toContain('Needs Attention: 1');
      expect(out).toContain('Total Cost:      $1.2345');
      expect(out).toContain('continuous');
      expect(out).toContain('stuck');
      expect(out).toContain('LLM concurrency: 2/8 active');
    });
  });

  describe('clawPresets', () => {
    it('lists presets', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          presets: [
            { id: 'researcher', name: 'Researcher', icon: '🔎', description: 'Survey + report' },
          ],
        })
      );
      await clawPresets();
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('Claw Presets (1)');
      expect(out).toContain('🔎 Researcher');
      expect(out).toContain('Survey + report');
    });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────

  describe('lifecycle commands', () => {
    it.each([
      ['clawStart', clawStart, '/claws/c1/start', 'POST', { state: 'running' }, 'Started'],
      ['clawPause', clawPause, '/claws/c1/pause', 'POST', { paused: true }, 'Paused'],
      ['clawResume', clawResume, '/claws/c1/resume', 'POST', { resumed: true }, 'Resumed'],
      ['clawStop', clawStop, '/claws/c1/stop', 'POST', { stopped: true }, 'Stopped'],
      ['clawDelete', clawDelete, '/claws/c1', 'DELETE', null, 'Deleted'],
    ])('%s posts to expected endpoint', async (_name, fn, path, method, body, prefix) => {
      mockFetch.mockResolvedValueOnce(apiOk(body));
      await fn('c1');
      const call = mockFetch.mock.calls[0];
      expect(String(call[0])).toContain(path);
      expect((call[1] as RequestInit).method).toBe(method);
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain(prefix);
    });
  });

  // ─── Operator interventions ─────────────────────────────────────────

  describe('clawSendMessage', () => {
    it('joins multi-word message and posts to /message', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ sent: true }));
      await clawSendMessage('c1', 'check', 'auth', 'flow');
      const call = mockFetch.mock.calls[0];
      expect(String(call[0])).toContain('/claws/c1/message');
      const init = call[1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ message: 'check auth flow' });
    });
    it('errors when missing message', async () => {
      await clawSendMessage('c1');
      expect(errorSpy).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('clawNextIntent', () => {
    it('posts joined directive to /next-intent', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ queued: true }));
      await clawNextIntent('c1', 'switch', 'to', 'auth', 'bug');
      const call = mockFetch.mock.calls[0];
      expect(String(call[0])).toContain('/claws/c1/next-intent');
      expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
        intent: 'switch to auth bug',
      });
    });
  });

  describe('clawSteer', () => {
    it('posts joined message to /steer', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ steered: true }));
      await clawSteer('c1', 'pivot', 'now');
      const call = mockFetch.mock.calls[0];
      expect(String(call[0])).toContain('/claws/c1/steer');
      expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ message: 'pivot now' });
    });
  });

  describe('clawResetFailures', () => {
    it('posts to /reset-failures', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ reset: true }));
      await clawResetFailures('c1');
      expect(String(mockFetch.mock.calls[0][0])).toContain('/claws/c1/reset-failures');
    });
  });

  describe('escalation commands', () => {
    it('clawApproveEscalation posts to /approve-escalation', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ approved: true }));
      await clawApproveEscalation('c1');
      expect(String(mockFetch.mock.calls[0][0])).toContain('/claws/c1/approve-escalation');
    });

    it('clawDenyEscalation sends reason when provided', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ denied: true }));
      await clawDenyEscalation('c1', 'unsafe', 'request');
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(JSON.parse(String(init.body))).toEqual({ reason: 'unsafe request' });
    });

    it('clawDenyEscalation sends empty body when no reason', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ denied: true }));
      await clawDenyEscalation('c1');
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(JSON.parse(String(init.body))).toEqual({});
    });
  });

  // ─── Inspection ─────────────────────────────────────────────────────

  describe('clawHistory', () => {
    it('renders cycle entries with success badges and cost', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          total: 1,
          entries: [
            {
              cycleNumber: 3,
              entryType: 'cycle',
              success: true,
              outputMessage: 'Did the thing',
              durationMs: 1234,
              costUsd: 0.0042,
              executedAt: '2026-05-28T10:00:00Z',
            },
            {
              cycleNumber: 4,
              entryType: 'cycle',
              success: false,
              outputMessage: '',
              durationMs: 500,
              executedAt: '2026-05-28T10:01:00Z',
              error: 'boom',
            },
          ],
        })
      );
      await clawHistory('c1');
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('History for c1');
      expect(out).toContain('✓ cyc3 cycle');
      expect(out).toContain('$0.0042');
      expect(out).toContain('Did the thing');
      expect(out).toContain('✗ cyc4 cycle');
      expect(out).toContain('error: boom');
    });

    it('respects custom limit query param', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ total: 0, entries: [] }));
      await clawHistory('c1', '50');
      expect(String(mockFetch.mock.calls[0][0])).toContain('limit=50');
    });
  });

  // ─── formatClawEvent ────────────────────────────────────────────────

  describe('formatClawEvent', () => {
    it('renders cycle:complete with cost and success badge', () => {
      const line = formatClawEvent('claw:cycle:complete', {
        clawId: 'claw-abc',
        cycleNumber: 7,
        success: true,
        totalCostUsd: 0.0042,
      });
      expect(line).toContain('✓ cyc-end');
      expect(line).toContain('claw-abc');
      expect(line).toContain('#7');
      expect(line).toContain('$0.0042');
    });

    it('renders plan:updated with source and non-zero counts', () => {
      const line = formatClawEvent('claw:plan:updated', {
        clawId: 'claw-abc',
        source: 'operator',
        counts: { pending: 2, completed: 1, blocked: 0 },
      });
      expect(line).toContain('⊞ plan');
      expect(line).toContain('by=operator');
      expect(line).toContain('pending=2');
      expect(line).toContain('completed=1');
      expect(line).not.toContain('blocked=0');
    });

    it('renders escalation with type and reason', () => {
      const line = formatClawEvent('claw:escalation', {
        clawId: 'claw-abc',
        type: 'approval',
        reason: 'needs deploy approval',
      });
      expect(line).toContain('⚠ escal');
      expect(line).toContain('approval');
      expect(line).toContain('needs deploy approval');
    });

    it('truncates long claw ids gracefully', () => {
      const line = formatClawEvent('claw:update', {
        clawId: 'claw-this-is-a-very-long-id-12345',
        state: 'running',
      });
      // shortCid format: first 8 chars + `…` + last 3
      expect(line).toContain('claw-thi…345');
      expect(line).toContain('→ running');
    });
  });

  // ─── clawWatch ──────────────────────────────────────────────────────

  /**
   * A minimal fake WebSocket that lets tests drive open / message / close
   * events imperatively. Tracks `send` payloads so we can assert
   * subscriptions were dispatched.
   */
  function makeFakeWs(): {
    socket: WebSocketLike;
    open: () => void;
    deliver: (data: string) => void;
    close: () => void;
    err: (msg: string) => void;
    sent: string[];
  } {
    const handlers: Record<string, Array<(evt: { data?: unknown; message?: string }) => void>> = {
      open: [],
      message: [],
      close: [],
      error: [],
    };
    const sent: string[] = [];
    const socket: WebSocketLike = {
      send: (s) => sent.push(s),
      close: () => {
        for (const h of handlers.close) h({});
      },
      addEventListener: (type, handler) => {
        handlers[type].push(handler as (evt: { data?: unknown; message?: string }) => void);
      },
    };
    return {
      socket,
      sent,
      open: () => handlers.open.forEach((h) => h({})),
      deliver: (data) => handlers.message.forEach((h) => h({ data })),
      close: () => handlers.close.forEach((h) => h({})),
      err: (msg) => handlers.error.forEach((h) => h({ message: msg })),
    };
  }

  describe('clawWatch', () => {
    it('subscribes to all claw topics on open then prints matching events', async () => {
      const fake = makeFakeWs();
      const promise = clawWatch(undefined, {
        openWebSocket: () => fake.socket,
        limit: 2,
      });
      fake.open();
      // Should have subscribed to ≥10 claw topics.
      expect(fake.sent.length).toBeGreaterThanOrEqual(10);
      const parsed = fake.sent.map((s) => JSON.parse(s) as { type: string; event: string });
      expect(parsed.every((p) => p.type === 'event:subscribe')).toBe(true);
      expect(parsed.some((p) => p.event === 'claw:cycle:complete')).toBe(true);

      fake.deliver(JSON.stringify({ event: 'claw:started', payload: { clawId: 'c1', name: 'X' } }));
      fake.deliver(
        JSON.stringify({ event: 'claw:cycle:complete', payload: { clawId: 'c1', cycleNumber: 3 } })
      );
      await promise;
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('▶ start');
      expect(out).toContain('✓ cyc-end');
      expect(out).toContain('#3');
    });

    it('filters by claw id when one is provided', async () => {
      const fake = makeFakeWs();
      const promise = clawWatch('c1', {
        openWebSocket: () => fake.socket,
        limit: 1,
      });
      fake.open();
      // Different claw — should be filtered out.
      fake.deliver(JSON.stringify({ event: 'claw:started', payload: { clawId: 'other' } }));
      // Matching claw — counts toward limit.
      fake.deliver(JSON.stringify({ event: 'claw:started', payload: { clawId: 'c1', name: 'Y' } }));
      await promise;
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('c1');
      expect(out).not.toContain('other');
    });

    it('ignores non-claw events', async () => {
      const fake = makeFakeWs();
      const promise = clawWatch(undefined, {
        openWebSocket: () => fake.socket,
        limit: 1,
      });
      fake.open();
      fake.deliver(JSON.stringify({ event: 'soul:heartbeat', payload: { agentId: 'a' } }));
      fake.deliver(
        JSON.stringify({ event: 'claw:progress', payload: { clawId: 'c1', message: 'hi' } })
      );
      await promise;
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('· progress');
      expect(out).toContain('hi');
      expect(out).not.toContain('soul:heartbeat');
    });

    it('verbose mode prints raw JSON payloads', async () => {
      const fake = makeFakeWs();
      const promise = clawWatch(undefined, {
        openWebSocket: () => fake.socket,
        limit: 1,
        verbose: true,
      });
      fake.open();
      fake.deliver(
        JSON.stringify({ event: 'claw:error', payload: { clawId: 'c1', error: 'boom' } })
      );
      await promise;
      const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(out).toContain('[claw:error]');
      expect(out).toContain('"error": "boom"');
    });

    it('rejects when the underlying socket fires error', async () => {
      const fake = makeFakeWs();
      const promise = clawWatch(undefined, { openWebSocket: () => fake.socket });
      fake.err('handshake failed');
      await expect(promise).rejects.toThrow(/handshake failed/);
    });

    it('falls back to error when global WebSocket is unavailable', async () => {
      const original = (globalThis as { WebSocket?: unknown }).WebSocket;
      try {
        (globalThis as { WebSocket?: unknown }).WebSocket = undefined;
        await expect(clawWatch(undefined)).rejects.toThrow(/requires Node 22\+/);
      } finally {
        (globalThis as { WebSocket?: unknown }).WebSocket = original;
      }
    });
  });

  // ─── Failure mode ───────────────────────────────────────────────────

  describe('API failures', () => {
    it('throws when gateway returns an error', async () => {
      mockFetch.mockResolvedValueOnce(apiErr(500));
      await expect(clawList()).rejects.toThrow(/Server error/);
    });
  });
});
