import { describe, it, expect, beforeEach } from 'vitest';
import { BridgeEventBus } from '../src/event-bus.ts';
import type {
  SessionOutputEvent,
  SessionBlockingEvent,
  SessionPhaseCompleteEvent,
  SessionErrorEvent,
  SessionDoneEvent,
  BridgeEvent,
  BufferedEvent,
} from '../src/event-bus.ts';
import { replayBuffer } from '../src/event-replay-buffer.ts';

describe('BridgeEventBus', () => {
  let bus: BridgeEventBus;

  beforeEach(() => {
    bus = new BridgeEventBus();
  });

  // ---- session.output ----

  it('emits and receives session.output events', () => {
    const received: SessionOutputEvent[] = [];
    bus.on('session.output', (e) => received.push(e));

    const event: SessionOutputEvent = {
      type: 'session.output',
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      projectDir: '/home/ayaz/test-project',
      text: 'Working on it...',
      timestamp: new Date().toISOString(),
    };
    bus.emit('session.output', event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  // ---- session.blocking ----

  it('emits and receives session.blocking events', () => {
    const received: SessionBlockingEvent[] = [];
    bus.on('session.blocking', (e) => received.push(e));

    const event: SessionBlockingEvent = {
      type: 'session.blocking',
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      projectDir: '/home/ayaz/test-project',
      pattern: 'QUESTION',
      text: 'Which database should I use?',
      respondUrl: 'http://localhost:9090/v1/sessions/sess-1/respond',
      timestamp: new Date().toISOString(),
    };
    bus.emit('session.blocking', event);

    expect(received).toHaveLength(1);
    expect(received[0].pattern).toBe('QUESTION');
    expect(received[0].respondUrl).toContain('/respond');
  });

  it('handles TASK_BLOCKED pattern', () => {
    const received: SessionBlockingEvent[] = [];
    bus.on('session.blocking', (e) => received.push(e));

    bus.emit('session.blocking', {
      type: 'session.blocking',
      conversationId: 'conv-2',
      sessionId: 'sess-2',
      projectDir: '/home/ayaz/test-project',
      pattern: 'TASK_BLOCKED',
      text: 'Missing API credentials',
      respondUrl: 'http://localhost:9090/v1/sessions/sess-2/respond',
      timestamp: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].pattern).toBe('TASK_BLOCKED');
  });

  // ---- session.phase_complete ----

  it('emits and receives session.phase_complete events', () => {
    const received: SessionPhaseCompleteEvent[] = [];
    bus.on('session.phase_complete', (e) => received.push(e));

    bus.emit('session.phase_complete', {
      type: 'session.phase_complete',
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      projectDir: '/home/ayaz/test-project',
      pattern: 'PHASE_COMPLETE',
      text: 'Phase 3 complete',
      timestamp: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('Phase 3 complete');
  });

  // ---- session.error ----

  it('emits and receives session.error events', () => {
    const received: SessionErrorEvent[] = [];
    bus.on('session.error', (e) => received.push(e));

    bus.emit('session.error', {
      type: 'session.error',
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      projectDir: '/home/ayaz/test-project',
      error: 'CC spawn failed: ENOENT',
      timestamp: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].error).toContain('ENOENT');
  });

  // ---- session.done ----

  it('emits and receives session.done events with usage', () => {
    const received: SessionDoneEvent[] = [];
    bus.on('session.done', (e) => received.push(e));

    bus.emit('session.done', {
      type: 'session.done',
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      projectDir: '/home/ayaz/test-project',
      usage: { input_tokens: 500, output_tokens: 200 },
      timestamp: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].usage).toEqual({ input_tokens: 500, output_tokens: 200 });
  });

  it('emits session.done without usage', () => {
    const received: SessionDoneEvent[] = [];
    bus.on('session.done', (e) => received.push(e));

    bus.emit('session.done', {
      type: 'session.done',
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      projectDir: '/home/ayaz/test-project',
      timestamp: new Date().toISOString(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].usage).toBeUndefined();
  });

  // ---- Wildcard (onAny) ----

  it('onAny receives all event types', () => {
    const received: BridgeEvent[] = [];
    bus.onAny((e) => received.push(e));

    bus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c', sessionId: 's', projectDir: '/home/ayaz/test-project', text: 'hi', timestamp: '',
    });
    bus.emit('session.error', {
      type: 'session.error',
      conversationId: 'c', sessionId: 's', projectDir: '/home/ayaz/test-project', error: 'err', timestamp: '',
    });
    bus.emit('session.done', {
      type: 'session.done',
      conversationId: 'c', sessionId: 's', projectDir: '/home/ayaz/test-project', timestamp: '',
    });

    expect(received).toHaveLength(3);
    expect(received.map((e) => e.type)).toEqual([
      'session.output',
      'session.error',
      'session.done',
    ]);
  });

  // ---- Unsubscribe ----

  it('off removes specific listener', () => {
    const received: SessionOutputEvent[] = [];
    const listener = (e: SessionOutputEvent) => received.push(e);
    bus.on('session.output', listener);
    bus.off('session.output', listener);

    bus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c', sessionId: 's', projectDir: '/home/ayaz/test-project', text: 'hi', timestamp: '',
    });

    expect(received).toHaveLength(0);
  });

  it('offAny removes wildcard listener', () => {
    const received: BridgeEvent[] = [];
    const listener = (e: BridgeEvent) => received.push(e);
    bus.onAny(listener);
    bus.offAny(listener);

    bus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c', sessionId: 's', projectDir: '/home/ayaz/test-project', text: 'hi', timestamp: '',
    });

    expect(received).toHaveLength(0);
  });

  // ---- Multiple listeners ----

  it('supports multiple listeners on same event', () => {
    let count1 = 0;
    let count2 = 0;
    bus.on('session.output', () => count1++);
    bus.on('session.output', () => count2++);

    bus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c', sessionId: 's', projectDir: '/home/ayaz/test-project', text: 'x', timestamp: '',
    });

    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  // ---- listenerCount ----

  it('reports correct listener counts', () => {
    expect(bus.listenerCount('session.output')).toBe(0);

    bus.on('session.output', () => {});
    bus.on('session.output', () => {});
    expect(bus.listenerCount('session.output')).toBe(2);

    bus.onAny(() => {});
    expect(bus.listenerCount('*')).toBe(1);
  });

  // ---- removeAllListeners ----

  it('removeAllListeners clears everything', () => {
    bus.on('session.output', () => {});
    bus.on('session.error', () => {});
    bus.onAny(() => {});

    bus.removeAllListeners();

    expect(bus.listenerCount('session.output')).toBe(0);
    expect(bus.listenerCount('session.error')).toBe(0);
    expect(bus.listenerCount('*')).toBe(0);
  });

  // ---- Isolation between event types ----

  it('listeners only receive their subscribed event type', () => {
    const outputEvents: SessionOutputEvent[] = [];
    const errorEvents: SessionErrorEvent[] = [];

    bus.on('session.output', (e) => outputEvents.push(e));
    bus.on('session.error', (e) => errorEvents.push(e));

    bus.emit('session.output', {
      type: 'session.output',
      conversationId: 'c', sessionId: 's', projectDir: '/home/ayaz/test-project', text: 'hello', timestamp: '',
    });

    expect(outputEvents).toHaveLength(1);
    expect(errorEvents).toHaveLength(0);
  });
});

// ---- Event IDs (Task 1 — 08-01) ----

describe('BridgeEventBus — Event IDs', () => {
  it('assigns incrementing numeric IDs to emitted events', () => {
    const bus = new BridgeEventBus();
    const received: BridgeEvent[] = [];
    bus.onAny((e) => received.push(e));

    bus.emit('session.output', { type: 'session.output', conversationId: 'c', sessionId: 's', text: 'hi', timestamp: '' });
    bus.emit('session.error', { type: 'session.error', conversationId: 'c', sessionId: 's', error: 'err', timestamp: '' });
    bus.emit('session.done', { type: 'session.done', conversationId: 'c', sessionId: 's', timestamp: '' });

    expect((received[0] as BufferedEvent).id).toBe(1);
    expect((received[1] as BufferedEvent).id).toBe(2);
    expect((received[2] as BufferedEvent).id).toBe(3);
  });

  it('IDs are unique and sequential across different event types', () => {
    const bus = new BridgeEventBus();
    const ids: number[] = [];
    bus.onAny((e) => ids.push((e as BufferedEvent).id));

    for (let i = 0; i < 5; i++) {
      bus.emit('session.done', { type: 'session.done', conversationId: 'c', sessionId: 's', timestamp: '' });
    }

    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });

  it('each BridgeEventBus instance has its own independent counter', () => {
    const bus1 = new BridgeEventBus();
    const bus2 = new BridgeEventBus();
    const received1: BridgeEvent[] = [];
    const received2: BridgeEvent[] = [];
    bus1.onAny((e) => received1.push(e));
    bus2.onAny((e) => received2.push(e));

    bus1.emit('session.done', { type: 'session.done', conversationId: 'c', sessionId: 's', timestamp: '' });
    bus1.emit('session.done', { type: 'session.done', conversationId: 'c', sessionId: 's', timestamp: '' });
    bus2.emit('session.done', { type: 'session.done', conversationId: 'c', sessionId: 's', timestamp: '' });

    expect((received1[0] as BufferedEvent).id).toBe(1);
    expect((received1[1] as BufferedEvent).id).toBe(2);
    expect((received2[0] as BufferedEvent).id).toBe(1); // own counter starts at 1
  });

  it('BufferedEvent type requires id to be a number (not optional)', () => {
    // Compile-time check: BufferedEvent.id is number (not number|undefined)
    const event: BufferedEvent = {
      type: 'session.done',
      conversationId: 'c',
      sessionId: 's',
      timestamp: '',
      id: 42,
    };
    expect(event.id).toBe(42);
  });

  it('emit() pushes events to replayBuffer even when no SSE client is connected', () => {
    const sizeBefore = replayBuffer.size;
    const bus = new BridgeEventBus();

    bus.emit('session.done', {
      type: 'session.done',
      conversationId: 'conv-replay-test',
      sessionId: 'sess-replay-test',
      timestamp: new Date().toISOString(),
    });

    expect(replayBuffer.size).toBe(sizeBefore + 1);
    const events = replayBuffer.since(0);
    const pushed = events.find(e => e.type === 'session.done' && (e as SessionDoneEvent).conversationId === 'conv-replay-test');
    expect(pushed).toBeDefined();
    expect(typeof pushed!.id).toBe('number');
  });
});
