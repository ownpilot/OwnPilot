import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET_LOG_MOCK } from '../../test-helpers.js';

vi.mock('../../services/get-log.js', () => GET_LOG_MOCK);

const { AgentCommunicationBus } = await import('./communication-bus.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(from = 'agent-a', to = 'agent-b') {
  return {
    from,
    to,
    type: 'task_delegation' as const,
    subject: 'Test',
    content: 'Hello',
    priority: 'normal' as const,
    requiresResponse: false,
  };
}

function makeRepo(overrides: Partial<ConstructorParameters<typeof AgentCommunicationBus>[0]> = {}) {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    findForAgent: vi.fn().mockResolvedValue([]),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    getCrewMembers: vi.fn().mockResolvedValue([]),
    findConversation: vi.fn().mockResolvedValue([]),
    findByThread: vi.fn().mockResolvedValue([]),
    countUnread: vi.fn().mockResolvedValue(0),
    countToday: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeEventBus() {
  return { emit: vi.fn() };
}

// ---------------------------------------------------------------------------
// send()
// ---------------------------------------------------------------------------

describe('AgentCommunicationBus.send()', () => {
  let repo: ReturnType<typeof makeRepo>;
  let bus: InstanceType<typeof AgentCommunicationBus>;

  beforeEach(() => {
    repo = makeRepo();
    bus = new AgentCommunicationBus(repo, makeEventBus());
  });

  afterEach(() => bus.dispose());

  it('persists message to repo and returns a UUID', async () => {
    const id = await bus.send(makeMessage());
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(repo.create).toHaveBeenCalledOnce();
    const stored = repo.create.mock.calls[0][0];
    expect(stored.status).toBe('sent');
    expect(stored.from).toBe('agent-a');
    expect(stored.to).toBe('agent-b');
  });

  it('emits soul.message.sent event with correct fields', async () => {
    const eventBus = makeEventBus();
    const b = new AgentCommunicationBus(repo, eventBus);
    await b.send(makeMessage('sender', 'receiver'));
    expect(eventBus.emit).toHaveBeenCalledWith(
      'soul.message.sent',
      expect.objectContaining({
        from: 'sender',
        to: 'receiver',
      })
    );
    b.dispose();
  });

  it('sets createdAt to a Date instance', async () => {
    await bus.send(makeMessage());
    const stored = repo.create.mock.calls[0][0];
    expect(stored.createdAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe('AgentCommunicationBus rate limiting', () => {
  afterEach(() => vi.useRealTimers());

  it('allows up to maxMessagesPerMinute messages', async () => {
    vi.useFakeTimers();
    const repo = makeRepo();
    const bus = new AgentCommunicationBus(repo, makeEventBus(), 3);

    await bus.send(makeMessage());
    await bus.send(makeMessage());
    await bus.send(makeMessage());

    expect(repo.create).toHaveBeenCalledTimes(3);
    bus.dispose();
  });

  it('throws RateLimitError on message N+1', async () => {
    vi.useFakeTimers();
    const bus = new AgentCommunicationBus(makeRepo(), makeEventBus(), 2);
    await bus.send(makeMessage());
    await bus.send(makeMessage());
    await expect(bus.send(makeMessage())).rejects.toThrow(/Rate limit exceeded/);
    bus.dispose();
  });

  it('resets after the time window expires', async () => {
    vi.useFakeTimers();
    const repo = makeRepo();
    const bus = new AgentCommunicationBus(repo, makeEventBus(), 1);

    await bus.send(makeMessage());
    await expect(bus.send(makeMessage())).rejects.toThrow(/Rate limit/);

    // Advance past 1-minute window
    vi.advanceTimersByTime(61_000);

    await bus.send(makeMessage()); // should succeed
    expect(repo.create).toHaveBeenCalledTimes(2);
    bus.dispose();
  });

  it('getRateLimitStatus returns null for unknown agent', () => {
    const bus = new AgentCommunicationBus(makeRepo(), makeEventBus());
    expect(bus.getRateLimitStatus('unknown')).toBeNull();
    bus.dispose();
  });

  it('getRateLimitStatus tracks count and remaining correctly', async () => {
    vi.useFakeTimers();
    const bus = new AgentCommunicationBus(makeRepo(), makeEventBus(), 5);
    await bus.send(makeMessage('agent-x', 'agent-y'));
    await bus.send(makeMessage('agent-x', 'agent-y'));

    const status = bus.getRateLimitStatus('agent-x');
    expect(status).not.toBeNull();
    expect(status!.count).toBe(2);
    expect(status!.remaining).toBe(3);
    bus.dispose();
  });

  it('resetRateLimit clears the limit for an agent', async () => {
    vi.useFakeTimers();
    const repo = makeRepo();
    const bus = new AgentCommunicationBus(repo, makeEventBus(), 1);
    await bus.send(makeMessage());
    await expect(bus.send(makeMessage())).rejects.toThrow();

    bus.resetRateLimit('agent-a');
    await bus.send(makeMessage()); // succeeds after reset
    expect(repo.create).toHaveBeenCalledTimes(2);
    bus.dispose();
  });

  it('different agents have independent rate limit windows', async () => {
    vi.useFakeTimers();
    const repo = makeRepo();
    const bus = new AgentCommunicationBus(repo, makeEventBus(), 1);
    await bus.send(makeMessage('agent-a', 'x'));
    await expect(bus.send(makeMessage('agent-a', 'x'))).rejects.toThrow();
    // agent-b has its own fresh window
    await bus.send(makeMessage('agent-b', 'x'));
    expect(repo.create).toHaveBeenCalledTimes(2);
    bus.dispose();
  });
});

// ---------------------------------------------------------------------------
// readInbox()
// ---------------------------------------------------------------------------

describe('AgentCommunicationBus.readInbox()', () => {
  it('marks messages as read after fetching', async () => {
    const msgs = [
      { id: 'msg-1', from: 'a', to: 'b', status: 'sent', createdAt: new Date() } as never,
      { id: 'msg-2', from: 'a', to: 'b', status: 'sent', createdAt: new Date() } as never,
    ];
    const repo = makeRepo({ findForAgent: vi.fn().mockResolvedValue(msgs) });
    const bus = new AgentCommunicationBus(repo, makeEventBus());

    const result = await bus.readInbox('agent-b');
    expect(result).toHaveLength(2);
    expect(repo.markAsRead).toHaveBeenCalledWith(['msg-1', 'msg-2']);
    bus.dispose();
  });

  it('does not call markAsRead when inbox is empty', async () => {
    const repo = makeRepo({ findForAgent: vi.fn().mockResolvedValue([]) });
    const bus = new AgentCommunicationBus(repo, makeEventBus());

    await bus.readInbox('agent-b');
    expect(repo.markAsRead).not.toHaveBeenCalled();
    bus.dispose();
  });

  it('defaults to unreadOnly=true and limit=20', async () => {
    const repo = makeRepo();
    const bus = new AgentCommunicationBus(repo, makeEventBus());
    await bus.readInbox('agent-b');
    expect(repo.findForAgent).toHaveBeenCalledWith('agent-b', {
      unreadOnly: true,
      limit: 20,
      types: undefined,
      fromAgent: undefined,
    });
    bus.dispose();
  });
});

// ---------------------------------------------------------------------------
// broadcast()
// ---------------------------------------------------------------------------

describe('AgentCommunicationBus.broadcast()', () => {
  it('sends to all members except sender and returns delivered list', async () => {
    const repo = makeRepo({
      getCrewMembers: vi.fn().mockResolvedValue(['agent-a', 'agent-b', 'agent-c']),
    });
    const bus = new AgentCommunicationBus(repo, makeEventBus(), 100);
    const msg = { ...makeMessage('agent-a'), crewId: 'crew-1' };
     
    const { to: _to, ...broadcastMsg } = msg;
    const result = await bus.broadcast('crew-1', broadcastMsg);

    expect(repo.create).toHaveBeenCalledTimes(2); // b and c, not a
    expect(result.delivered).toEqual(expect.arrayContaining(['agent-b', 'agent-c']));
    expect(result.failed).toHaveLength(0);
    bus.dispose();
  });

  it('records failed members when send throws', async () => {
    const repo = makeRepo({
      getCrewMembers: vi.fn().mockResolvedValue(['agent-a', 'agent-b', 'agent-c']),
      create: vi
        .fn()
        .mockResolvedValueOnce(undefined) // agent-b ok
        .mockRejectedValueOnce(new Error('DB error')), // agent-c fails
    });
    const bus = new AgentCommunicationBus(repo, makeEventBus(), 100);
    const msg = makeMessage('agent-a');
     
    const { to: _to, ...broadcastMsg } = msg;
    const result = await bus.broadcast('crew-1', broadcastMsg);

    expect(result.delivered).toContain('agent-b');
    expect(result.failed).toContain('agent-c');
    bus.dispose();
  });

  it('returns empty delivered/failed when crew has no other members', async () => {
    const repo = makeRepo({
      getCrewMembers: vi.fn().mockResolvedValue(['agent-a']),
    });
    const bus = new AgentCommunicationBus(repo, makeEventBus());
    const msg = makeMessage('agent-a');
     
    const { to: _to, ...broadcastMsg } = msg;
    const result = await bus.broadcast('crew-1', broadcastMsg);
    expect(result.delivered).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    bus.dispose();
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe('AgentCommunicationBus.dispose()', () => {
  it('clears rate limit state on dispose', async () => {
    vi.useFakeTimers();
    const bus = new AgentCommunicationBus(makeRepo(), makeEventBus(), 1);
    await bus.send(makeMessage());
    bus.dispose();
    expect(bus.getRateLimitStatus('agent-a')).toBeNull();
    vi.useRealTimers();
  });

  it('can be called multiple times safely', () => {
    const bus = new AgentCommunicationBus(makeRepo(), makeEventBus());
    expect(() => {
      bus.dispose();
      bus.dispose();
    }).not.toThrow();
  });
});
