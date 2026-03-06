import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET_LOG_MOCK } from '../../test-helpers.js';

vi.mock('../../services/get-log.js', () => GET_LOG_MOCK);

const { HeartbeatRunner } = await import('./heartbeat-runner.js');

import type { AgentSoul, HeartbeatTask } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<HeartbeatTask> = {}): HeartbeatTask {
  return {
    id: 'task-1',
    name: 'Check trends',
    description: 'Check current trends',
    schedule: 'every',
    tools: [],
    priority: 'medium',
    stalenessHours: 0,
    ...overrides,
  };
}

function makeSoul(overrides: Partial<AgentSoul> = {}): AgentSoul {
  return {
    id: 'soul-1',
    agentId: 'agent-1',
    identity: {
      name: 'TestBot',
      emoji: '🤖',
      role: 'Tester',
      personality: 'methodical',
      voice: { tone: 'neutral', language: 'en' },
      boundaries: [],
    },
    purpose: {
      mission: 'Test things',
      goals: [],
      expertise: [],
      toolPreferences: [],
    },
    autonomy: {
      level: 2,
      allowedActions: [],
      blockedActions: [],
      requiresApproval: [],
      maxCostPerCycle: 10,
      maxCostPerDay: 100,
      maxCostPerMonth: 1000,
      pauseOnConsecutiveErrors: 5,
      pauseOnBudgetExceeded: true,
      notifyUserOnPause: false,
    },
    heartbeat: {
      enabled: true,
      interval: '*/30 * * * *',
      checklist: [makeTask()],
      selfHealingEnabled: false,
      maxDurationMs: 120_000,
    },
    relationships: { delegates: [], peers: [], channels: [] },
    evolution: {
      version: 1,
      evolutionMode: 'supervised',
      coreTraits: [],
      mutableTraits: [],
      learnings: [],
      feedbackLog: [],
    },
    bootSequence: { onStart: [], onHeartbeat: [], onMessage: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSoulRepo(soul: AgentSoul | null = makeSoul()) {
  return {
    getByAgentId: vi.fn().mockResolvedValue(soul),
    update: vi.fn().mockResolvedValue(undefined),
    createVersion: vi.fn().mockResolvedValue(undefined),
    setHeartbeatEnabled: vi.fn().mockResolvedValue(undefined),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    updateHeartbeatChecklist: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogRepo() {
  return {
    getRecent: vi.fn().mockResolvedValue([]),
    getLatest: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
  };
}

function makeBudget(ok = true) {
  return {
    checkBudget: vi.fn().mockResolvedValue(ok),
    recordSpend: vi.fn().mockResolvedValue(undefined),
  };
}

function makeEngine(overrides: Record<string, unknown> = {}) {
  return {
    processMessage: vi.fn().mockResolvedValue({
      content: 'done',
      tokenUsage: { input: 10, output: 20 },
      cost: 0.001,
    }),
    saveMemory: vi.fn().mockResolvedValue(undefined),
    sendToChannel: vi.fn().mockResolvedValue(undefined),
    createNote: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeBus() {
  return {
    send: vi.fn().mockResolvedValue('msg-1'),
    readInbox: vi.fn().mockResolvedValue([]),
    broadcast: vi.fn().mockResolvedValue({ delivered: [], failed: [] }),
    getConversation: vi.fn().mockResolvedValue([]),
    getThread: vi.fn().mockResolvedValue([]),
    getUnreadCount: vi.fn().mockResolvedValue(0),
  };
}

function makeEventBus() {
  return { emit: vi.fn() };
}

// ---------------------------------------------------------------------------
// runHeartbeat() — soul lookup
// ---------------------------------------------------------------------------

describe('HeartbeatRunner.runHeartbeat() — soul lookup', () => {
  it('returns error when soul not found', async () => {
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(null),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );
    const result = await runner.runHeartbeat('agent-1');
    expect(result.ok).toBe(false);
  });

  it('returns error when heartbeat disabled', async () => {
    const soul = makeSoul();
    soul.heartbeat.enabled = false;
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );
    const result = await runner.runHeartbeat('agent-1');
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runHeartbeat() — quiet hours
// ---------------------------------------------------------------------------

describe('HeartbeatRunner.runHeartbeat() — quiet hours', () => {
  afterEach(() => vi.useRealTimers());

  it('skips cycle with skippedReason=quiet_hours during quiet window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T03:00:00Z')); // 03:00 UTC
    const soul = makeSoul();
    soul.heartbeat.quietHours = { start: '01:00', end: '07:00', timezone: 'UTC' };
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    const result = await runner.runHeartbeat('agent-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skippedReason).toBe('quiet_hours');
      expect(result.value.tasks).toHaveLength(0);
    }
    expect(engine.processMessage).not.toHaveBeenCalled();
  });

  it('does not skip when outside quiet window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T10:00:00Z')); // 10:00 UTC — outside 01–07
    const soul = makeSoul();
    soul.heartbeat.quietHours = { start: '01:00', end: '07:00', timezone: 'UTC' };
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    const result = await runner.runHeartbeat('agent-1');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.skippedReason).toBeUndefined();
  });

  it('force=true bypasses quiet hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T03:00:00Z'));
    const soul = makeSoul();
    soul.heartbeat.quietHours = { start: '00:00', end: '23:59', timezone: 'UTC' }; // all day quiet
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    const result = await runner.runHeartbeat('agent-1', true);

    expect(result.ok).toBe(true);
    expect(engine.processMessage).toHaveBeenCalledOnce();
  });

  it('skips during midnight-spanning quiet window (evening side)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T23:30:00Z')); // 23:30 UTC
    const soul = makeSoul();
    soul.heartbeat.quietHours = { start: '22:00', end: '06:00', timezone: 'UTC' };
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    const result = await runner.runHeartbeat('agent-1');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.skippedReason).toBe('quiet_hours');
    expect(engine.processMessage).not.toHaveBeenCalled();
  });

  it('skips during midnight-spanning quiet window (morning side)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T02:00:00Z')); // 02:00 UTC
    const soul = makeSoul();
    soul.heartbeat.quietHours = { start: '22:00', end: '06:00', timezone: 'UTC' };
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    const result = await runner.runHeartbeat('agent-1');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.skippedReason).toBe('quiet_hours');
  });

  it('does not skip outside midnight-spanning quiet window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T10:00:00Z')); // 10:00 UTC — outside 22–06
    const soul = makeSoul();
    soul.heartbeat.quietHours = { start: '22:00', end: '06:00', timezone: 'UTC' };
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    const result = await runner.runHeartbeat('agent-1');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.skippedReason).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runHeartbeat() — budget
// ---------------------------------------------------------------------------

describe('HeartbeatRunner.runHeartbeat() — budget', () => {
  it('returns error when daily budget exceeded', async () => {
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(),
      makeBus(),
      makeLogRepo(),
      makeBudget(false)
    );
    const result = await runner.runHeartbeat('agent-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('budget');
  });

  it('calls setHeartbeatEnabled(false) when pauseOnBudgetExceeded=true', async () => {
    const soul = makeSoul();
    soul.autonomy.pauseOnBudgetExceeded = true;
    const repo = makeSoulRepo(soul);
    const runner = new HeartbeatRunner(
      makeEngine(),
      repo,
      makeBus(),
      makeLogRepo(),
      makeBudget(false)
    );
    await runner.runHeartbeat('agent-1');
    expect(repo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-1', false);
  });

  it('does NOT call setHeartbeatEnabled when pauseOnBudgetExceeded=false', async () => {
    const soul = makeSoul();
    soul.autonomy.pauseOnBudgetExceeded = false;
    const repo = makeSoulRepo(soul);
    const runner = new HeartbeatRunner(
      makeEngine(),
      repo,
      makeBus(),
      makeLogRepo(),
      makeBudget(false)
    );
    await runner.runHeartbeat('agent-1');
    expect(repo.setHeartbeatEnabled).not.toHaveBeenCalled();
  });

  it('notifies user via sendToChannel when notifyUserOnPause=true', async () => {
    const soul = makeSoul();
    soul.autonomy.notifyUserOnPause = true;
    soul.autonomy.pauseOnBudgetExceeded = true;
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget(false)
    );
    await runner.runHeartbeat('agent-1');
    expect(engine.sendToChannel).toHaveBeenCalledWith(
      'telegram',
      expect.stringContaining('budget')
    );
  });

  it('persists a heartbeat log entry even on budget-exceeded skip', async () => {
    const logRepo = makeLogRepo();
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(),
      makeBus(),
      logRepo,
      makeBudget(false)
    );
    await runner.runHeartbeat('agent-1');
    expect(logRepo.create).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// runHeartbeat() — happy path
// ---------------------------------------------------------------------------

describe('HeartbeatRunner.runHeartbeat() — happy path', () => {
  it('runs all "every" tasks and returns success result', async () => {
    const soul = makeSoul();
    soul.heartbeat.checklist = [
      makeTask({ id: 'task-1', name: 'T1' }),
      makeTask({ id: 'task-2', name: 'T2' }),
    ];
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    const result = await runner.runHeartbeat('agent-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasks).toHaveLength(2);
      expect(result.value.tasks.every((t) => t.status === 'success')).toBe(true);
    }
    expect(engine.processMessage).toHaveBeenCalledTimes(2);
  });

  it('batches all checklist updates in a single DB write', async () => {
    const soul = makeSoul();
    soul.heartbeat.checklist = [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })];
    const repo = makeSoulRepo(soul);
    const runner = new HeartbeatRunner(makeEngine(), repo, makeBus(), makeLogRepo(), makeBudget());
    await runner.runHeartbeat('agent-1');
    // N tasks → 1 DB write (not N)
    expect(repo.updateHeartbeatChecklist).toHaveBeenCalledOnce();
  });

  it('persists heartbeat log after run', async () => {
    const logRepo = makeLogRepo();
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(),
      makeBus(),
      logRepo,
      makeBudget()
    );
    await runner.runHeartbeat('agent-1');
    expect(logRepo.create).toHaveBeenCalledOnce();
  });

  it('emits soul.heartbeat.completed event', async () => {
    const eventBus = makeEventBus();
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(),
      makeBus(),
      makeLogRepo(),
      makeBudget(),
      eventBus
    );
    await runner.runHeartbeat('agent-1');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'soul.heartbeat.completed',
      expect.objectContaining({ agentId: 'agent-1' })
    );
  });

  it('accumulates token usage and cost across all tasks', async () => {
    const soul = makeSoul();
    soul.heartbeat.checklist = [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })];
    const engine = makeEngine();
    (engine.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'ok',
      tokenUsage: { input: 10, output: 20 },
      cost: 0.5,
    });
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    const result = await runner.runHeartbeat('agent-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalTokens.input).toBe(20);
      expect(result.value.totalTokens.output).toBe(40);
      expect(result.value.totalCost).toBeCloseTo(1.0);
    }
  });
});

// ---------------------------------------------------------------------------
// runHeartbeat() — cycle budget cap
// ---------------------------------------------------------------------------

describe('HeartbeatRunner.runHeartbeat() — cycle budget cap', () => {
  it('skips remaining tasks when per-cycle budget is exceeded', async () => {
    const soul = makeSoul();
    soul.autonomy.maxCostPerCycle = 0.001; // very tight
    soul.heartbeat.checklist = [
      makeTask({ id: 'task-1', name: 'T1' }),
      makeTask({ id: 'task-2', name: 'T2' }),
    ];
    const engine = makeEngine();
    // First call costs more than maxCostPerCycle
    (engine.processMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'ok',
      tokenUsage: { input: 5, output: 5 },
      cost: 0.002, // exceeds 0.001 cap
    });

    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    const result = await runner.runHeartbeat('agent-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // task-1 runs (cost starts at 0, which is < 0.001, so it runs)
      // After task-1: totalCost = 0.002 >= 0.001 → task-2 is skipped
      const skipped = result.value.tasks.filter((t) => t.status === 'skipped');
      expect(skipped).toHaveLength(1);
      expect(skipped[0].taskId).toBe('task-2');
    }
  });
});

// ---------------------------------------------------------------------------
// runHeartbeat() — task timeout (M2 fix)
// ---------------------------------------------------------------------------

describe('HeartbeatRunner.runHeartbeat() — task timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('returns failure result when task exceeds maxDurationMs', async () => {
    vi.useFakeTimers();
    const soul = makeSoul();
    soul.heartbeat.maxDurationMs = 1_000; // 1 second
    const engine = makeEngine();
    // processMessage never resolves
    (engine.processMessage as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    const runPromise = runner.runHeartbeat('agent-1');
    await vi.advanceTimersByTimeAsync(2_000); // fires the 1s timeout + flushes microtasks
    const result = await runPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tasks[0].status).toBe('failure');
      expect(result.value.tasks[0].error).toContain('timed out');
    }
  });
});

// ---------------------------------------------------------------------------
// runHeartbeat() — pauseOnConsecutiveErrors
// ---------------------------------------------------------------------------

describe('HeartbeatRunner.runHeartbeat() — pauseOnConsecutiveErrors', () => {
  it('pauses heartbeat and emits event when threshold is reached', async () => {
    const soul = makeSoul();
    soul.autonomy.pauseOnConsecutiveErrors = 2;
    soul.heartbeat.checklist = [
      makeTask({ id: 'task-1', consecutiveFailures: 1 }), // 1 existing → +1 this run = 2
    ];
    const engine = makeEngine();
    (engine.processMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM error'));

    const repo = makeSoulRepo(soul);
    const eventBus = makeEventBus();
    const runner = new HeartbeatRunner(
      engine,
      repo,
      makeBus(),
      makeLogRepo(),
      makeBudget(),
      eventBus
    );

    await runner.runHeartbeat('agent-1');

    expect(repo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-1', false);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'soul.heartbeat.auto_paused',
      expect.objectContaining({ agentId: 'agent-1', reason: 'consecutive_failures' })
    );
  });

  it('does not pause when failures are below threshold', async () => {
    const soul = makeSoul();
    soul.autonomy.pauseOnConsecutiveErrors = 5;
    soul.heartbeat.checklist = [
      makeTask({ id: 'task-1', consecutiveFailures: 0 }), // 0 existing → +1 this run = 1
    ];
    const engine = makeEngine();
    (engine.processMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM error'));

    const repo = makeSoulRepo(soul);
    const runner = new HeartbeatRunner(engine, repo, makeBus(), makeLogRepo(), makeBudget());

    await runner.runHeartbeat('agent-1');

    expect(repo.setHeartbeatEnabled).not.toHaveBeenCalled();
  });

  it('resets consecutive failure count to 0 on task success', async () => {
    const soul = makeSoul();
    soul.heartbeat.checklist = [makeTask({ id: 'task-1', consecutiveFailures: 3 })];
    const repo = makeSoulRepo(soul);
    const runner = new HeartbeatRunner(
      makeEngine(), // processMessage succeeds
      repo,
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    await runner.runHeartbeat('agent-1');

    const updated = (repo.updateHeartbeatChecklist as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as HeartbeatTask[];
    expect(updated[0].consecutiveFailures).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// routeOutput() — via runHeartbeat
// ---------------------------------------------------------------------------

describe('HeartbeatRunner routeOutput()', () => {
  function soulWithTask(task: HeartbeatTask): AgentSoul {
    const soul = makeSoul();
    soul.heartbeat.checklist = [task];
    return soul;
  }

  it('memory: saves output to agent memory', async () => {
    const soul = soulWithTask(makeTask({ outputTo: { type: 'memory' } }));
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );
    await runner.runHeartbeat('agent-1');
    expect(engine.saveMemory).toHaveBeenCalledWith('agent-1', 'done', 'heartbeat');
  });

  it('inbox: sends message to target agent', async () => {
    const soul = soulWithTask(makeTask({ outputTo: { type: 'inbox', agentId: 'agent-2' } }));
    const bus = makeBus();
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(soul),
      bus,
      makeLogRepo(),
      makeBudget()
    );
    await runner.runHeartbeat('agent-1');
    expect(bus.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'agent-1', to: 'agent-2', type: 'task_result' })
    );
  });

  it('inbox: skips send when agentId is missing (M3 fix)', async () => {
    // HeartbeatOutput type enforces agentId; cast to simulate misconfigured task
    const soul = soulWithTask(
      makeTask({ outputTo: { type: 'inbox', agentId: undefined as unknown as string } })
    );
    const bus = makeBus();
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(soul),
      bus,
      makeLogRepo(),
      makeBudget()
    );
    await runner.runHeartbeat('agent-1');
    expect(bus.send).not.toHaveBeenCalled();
  });

  it('channel: sends output to the correct channel and chatId', async () => {
    const soul = soulWithTask(
      makeTask({ outputTo: { type: 'channel', channel: 'telegram', chatId: '12345' } })
    );
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );
    await runner.runHeartbeat('agent-1');
    expect(engine.sendToChannel).toHaveBeenCalledWith('telegram', 'done', '12345');
  });

  it('note: creates note with the specified category', async () => {
    const soul = soulWithTask(makeTask({ outputTo: { type: 'note', category: 'research' } }));
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );
    await runner.runHeartbeat('agent-1');
    expect(engine.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'done', category: 'research' })
    );
  });

  it('note: defaults category to "heartbeat" when not specified', async () => {
    const soul = soulWithTask(makeTask({ outputTo: { type: 'note' } }));
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );
    await runner.runHeartbeat('agent-1');
    expect(engine.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'heartbeat' })
    );
  });

  it('broadcast: broadcasts to the crew', async () => {
    const soul = soulWithTask(makeTask({ outputTo: { type: 'broadcast', crewId: 'crew-1' } }));
    const bus = makeBus();
    const runner = new HeartbeatRunner(
      makeEngine(),
      makeSoulRepo(soul),
      bus,
      makeLogRepo(),
      makeBudget()
    );
    await runner.runHeartbeat('agent-1');
    expect(bus.broadcast).toHaveBeenCalledWith(
      'crew-1',
      expect.objectContaining({ from: 'agent-1', type: 'knowledge_share' })
    );
  });

  it('does not route output when task fails', async () => {
    const soul = soulWithTask(makeTask({ outputTo: { type: 'memory' } }));
    const engine = makeEngine();
    (engine.processMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM fail'));
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );
    await runner.runHeartbeat('agent-1');
    expect(engine.saveMemory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// filterTasksToRun() — via runHeartbeat
// ---------------------------------------------------------------------------

describe('HeartbeatRunner filterTasksToRun()', () => {
  afterEach(() => vi.useRealTimers());

  it('force=true runs all tasks regardless of schedule', async () => {
    vi.useFakeTimers();
    // Use local-time constructor so setHours comparisons are consistent
    vi.setSystemTime(new Date(2024, 0, 10, 10, 0, 0)); // Jan 10, 10:00 local
    const soul = makeSoul();
    // daily task already ran today — would NOT run without force
    soul.heartbeat.checklist = [
      makeTask({ id: 'task-1', schedule: 'every' }),
      makeTask({
        id: 'task-2',
        schedule: 'daily',
        dailyAt: '09:00',
        lastRunAt: new Date(2024, 0, 10, 9, 1, 0), // ran today at 09:01 local
      }),
    ];
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    await runner.runHeartbeat('agent-1', true); // force=true

    expect(engine.processMessage).toHaveBeenCalledTimes(2);
  });

  it('schedule=every always runs', async () => {
    const soul = makeSoul();
    soul.heartbeat.checklist = [makeTask({ schedule: 'every', lastRunAt: new Date() })];
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );
    await runner.runHeartbeat('agent-1');
    expect(engine.processMessage).toHaveBeenCalledOnce();
  });

  it('schedule=daily runs when past dailyAt and task has not run yet today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 10, 23, 0, 0)); // 23:00 local — past 09:00
    const soul = makeSoul();
    soul.heartbeat.checklist = [
      makeTask({ schedule: 'daily', dailyAt: '09:00', lastRunAt: undefined }),
    ];
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    await runner.runHeartbeat('agent-1');

    expect(engine.processMessage).toHaveBeenCalledOnce();
  });

  it('schedule=daily skips when task already ran today after dailyAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 10, 23, 0, 0)); // 23:00 local
    const soul = makeSoul();
    soul.heartbeat.checklist = [
      makeTask({
        schedule: 'daily',
        dailyAt: '09:00',
        lastRunAt: new Date(2024, 0, 10, 9, 1, 0), // ran at 09:01 local today
      }),
    ];
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    await runner.runHeartbeat('agent-1');

    expect(engine.processMessage).not.toHaveBeenCalled();
  });

  it('schedule=daily skips when dailyAt has not yet been reached today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 10, 8, 0, 0)); // 08:00 local — before 09:00
    const soul = makeSoul();
    soul.heartbeat.checklist = [
      makeTask({ schedule: 'daily', dailyAt: '09:00', lastRunAt: undefined }),
    ];
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    await runner.runHeartbeat('agent-1');

    expect(engine.processMessage).not.toHaveBeenCalled();
  });

  it('schedule=weekly runs on the correct weekday', async () => {
    vi.useFakeTimers();
    // 2024-01-10 = Wednesday → getDay() === 3
    vi.setSystemTime(new Date(2024, 0, 10, 10, 0, 0));
    const soul = makeSoul();
    soul.heartbeat.checklist = [
      makeTask({ schedule: 'weekly', weeklyOn: 3, lastRunAt: undefined }),
    ];
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    await runner.runHeartbeat('agent-1');

    expect(engine.processMessage).toHaveBeenCalledOnce();
  });

  it('schedule=weekly skips on the wrong weekday', async () => {
    vi.useFakeTimers();
    // 2024-01-10 = Wednesday (day 3); task is Monday (day 1)
    vi.setSystemTime(new Date(2024, 0, 10, 10, 0, 0));
    const soul = makeSoul();
    soul.heartbeat.checklist = [
      makeTask({ schedule: 'weekly', weeklyOn: 1 }), // Monday
    ];
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    await runner.runHeartbeat('agent-1');

    expect(engine.processMessage).not.toHaveBeenCalled();
  });

  it('staleness: re-runs task when lastRunAt exceeds stalenessHours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 10, 10, 0, 0));
    const soul = makeSoul();
    soul.heartbeat.checklist = [
      makeTask({
        schedule: 'condition',
        stalenessHours: 24,
        // 48 hours ago
        lastRunAt: new Date(2024, 0, 8, 10, 0, 0),
      }),
    ];
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    await runner.runHeartbeat('agent-1');

    expect(engine.processMessage).toHaveBeenCalledOnce();
  });

  it('staleness: skips task when within stalenessHours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 10, 10, 0, 0));
    const soul = makeSoul();
    soul.heartbeat.checklist = [
      makeTask({
        schedule: 'condition',
        stalenessHours: 24,
        // 6 hours ago — fresh
        lastRunAt: new Date(2024, 0, 10, 4, 0, 0),
      }),
    ];
    const engine = makeEngine();
    const runner = new HeartbeatRunner(
      engine,
      makeSoulRepo(soul),
      makeBus(),
      makeLogRepo(),
      makeBudget()
    );

    await runner.runHeartbeat('agent-1');

    expect(engine.processMessage).not.toHaveBeenCalled();
  });
});
