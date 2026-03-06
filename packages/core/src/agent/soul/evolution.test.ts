import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoulEvolutionEngine } from './evolution.js';
import type { AgentSoul, SoulFeedback } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      maxCostPerCycle: 1,
      maxCostPerDay: 10,
      maxCostPerMonth: 100,
      pauseOnConsecutiveErrors: 5,
      pauseOnBudgetExceeded: true,
      notifyUserOnPause: false,
    },
    heartbeat: {
      enabled: true,
      interval: '*/30 * * * *',
      checklist: [],
      selfHealingEnabled: false,
      maxDurationMs: 120_000,
    },
    relationships: { delegates: [], peers: [], channels: [] },
    evolution: {
      version: 1,
      evolutionMode: 'supervised',
      coreTraits: ['honest'],
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

function makeFeedback(type: SoulFeedback['type'], content: string): SoulFeedback {
  return {
    id: 'fb-1',
    timestamp: new Date(),
    type,
    content,
    appliedToVersion: 1,
    source: 'user',
  };
}

function makeRepo(soul: AgentSoul) {
  return {
    getByAgentId: vi.fn().mockResolvedValue(soul),
    update: vi.fn().mockResolvedValue(undefined),
    createVersion: vi.fn().mockResolvedValue(undefined),
    setHeartbeatEnabled: vi.fn().mockResolvedValue(undefined),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    updateHeartbeatChecklist: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogRepo(logs: object[] = []) {
  return {
    getRecent: vi.fn().mockResolvedValue(logs),
    getLatest: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// applyFeedback()
// ---------------------------------------------------------------------------

describe('SoulEvolutionEngine.applyFeedback()', () => {
  it('throws when soul not found', async () => {
    const repo = { ...makeRepo(makeSoul()), getByAgentId: vi.fn().mockResolvedValue(null) };
    const engine = new SoulEvolutionEngine(repo, makeLogRepo());
    await expect(
      engine.applyFeedback('agent-1', makeFeedback('praise', 'well done'))
    ).rejects.toThrow('Soul not found');
  });

  it('snapshots soul BEFORE mutation (createVersion called before version++)', async () => {
    const soul = makeSoul();
    const repo = makeRepo(soul);
    const engine = new SoulEvolutionEngine(repo, makeLogRepo());

    const order: string[] = [];
    repo.createVersion.mockImplementation(() => {
      order.push('createVersion');
      return Promise.resolve();
    });
    repo.update.mockImplementation((s: AgentSoul) => {
      order.push(`update@v${s.evolution.version}`);
      return Promise.resolve();
    });

    await engine.applyFeedback('agent-1', makeFeedback('praise', 'good'));
    expect(order[0]).toBe('createVersion');
    expect(order[1]).toBe('update@v2'); // version was incremented before update
  });

  it('praise appends to learnings', async () => {
    const soul = makeSoul();
    const repo = makeRepo(soul);
    const engine = new SoulEvolutionEngine(repo, makeLogRepo());
    const result = await engine.applyFeedback('agent-1', makeFeedback('praise', 'great work'));
    expect(result.evolution.learnings).toContain('Positive: great work');
  });

  it('correction appends to boundaries AND learnings', async () => {
    const soul = makeSoul();
    const repo = makeRepo(soul);
    const engine = new SoulEvolutionEngine(repo, makeLogRepo());
    const result = await engine.applyFeedback('agent-1', makeFeedback('correction', 'no spam'));
    expect(result.identity.boundaries).toContain('no spam');
    expect(result.evolution.learnings).toContain('Correction: no spam');
  });

  it('directive appends to goals', async () => {
    const soul = makeSoul();
    const repo = makeRepo(soul);
    const engine = new SoulEvolutionEngine(repo, makeLogRepo());
    const result = await engine.applyFeedback('agent-1', makeFeedback('directive', 'post daily'));
    expect(result.purpose.goals).toContain('post daily');
  });

  it('personality_tweak appends to mutableTraits AND learnings', async () => {
    const soul = makeSoul();
    const repo = makeRepo(soul);
    const engine = new SoulEvolutionEngine(repo, makeLogRepo());
    const result = await engine.applyFeedback(
      'agent-1',
      makeFeedback('personality_tweak', 'be warmer')
    );
    expect(result.evolution.mutableTraits).toContain('be warmer');
    expect(result.evolution.learnings).toContain('Personality: be warmer');
  });

  it('increments version after each feedback', async () => {
    const soul = makeSoul();
    const repo = makeRepo(soul);
    const engine = new SoulEvolutionEngine(repo, makeLogRepo());
    const result = await engine.applyFeedback('agent-1', makeFeedback('praise', 'x'));
    expect(result.evolution.version).toBe(2);
  });

  describe('array caps (H3 fix)', () => {
    it('caps learnings at 50', async () => {
      const soul = makeSoul();
      soul.evolution.learnings = Array.from({ length: 50 }, (_, i) => `learning-${i}`);
      const repo = makeRepo(soul);
      const engine = new SoulEvolutionEngine(repo, makeLogRepo());
      const result = await engine.applyFeedback('agent-1', makeFeedback('praise', 'new'));
      expect(result.evolution.learnings.length).toBe(50);
      expect(result.evolution.learnings.at(-1)).toBe('Positive: new');
    });

    it('caps feedbackLog at 100', async () => {
      const soul = makeSoul();
      soul.evolution.feedbackLog = Array.from({ length: 100 }, (_, i) =>
        makeFeedback('praise', `fb-${i}`)
      );
      const repo = makeRepo(soul);
      const engine = new SoulEvolutionEngine(repo, makeLogRepo());
      const result = await engine.applyFeedback('agent-1', makeFeedback('praise', 'new'));
      expect(result.evolution.feedbackLog.length).toBe(100);
    });

    it('caps boundaries at 100 (H3)', async () => {
      const soul = makeSoul();
      soul.identity.boundaries = Array.from({ length: 100 }, (_, i) => `boundary-${i}`);
      const repo = makeRepo(soul);
      const engine = new SoulEvolutionEngine(repo, makeLogRepo());
      const result = await engine.applyFeedback(
        'agent-1',
        makeFeedback('correction', 'new-boundary')
      );
      expect(result.identity.boundaries.length).toBe(100);
      expect(result.identity.boundaries.at(-1)).toBe('new-boundary');
    });

    it('caps mutableTraits at 100 (H3)', async () => {
      const soul = makeSoul();
      soul.evolution.mutableTraits = Array.from({ length: 100 }, (_, i) => `trait-${i}`);
      const repo = makeRepo(soul);
      const engine = new SoulEvolutionEngine(repo, makeLogRepo());
      const result = await engine.applyFeedback(
        'agent-1',
        makeFeedback('personality_tweak', 'new-trait')
      );
      expect(result.evolution.mutableTraits.length).toBe(100);
      expect(result.evolution.mutableTraits.at(-1)).toBe('new-trait');
    });
  });
});

// ---------------------------------------------------------------------------
// selfReflect()
// ---------------------------------------------------------------------------

describe('SoulEvolutionEngine.selfReflect()', () => {
  it('returns empty suggestions when evolutionMode is manual', async () => {
    const soul = makeSoul({ evolution: { ...makeSoul().evolution, evolutionMode: 'manual' } });
    const engine = new SoulEvolutionEngine(makeRepo(soul), makeLogRepo());
    const result = await engine.selfReflect('agent-1');
    expect(result).toEqual({ suggestions: [], applied: false });
  });

  it('returns empty when no reflection engine is provided', async () => {
    const soul = makeSoul({ evolution: { ...makeSoul().evolution, evolutionMode: 'autonomous' } });
    const engine = new SoulEvolutionEngine(makeRepo(soul), makeLogRepo()); // no reflectionEngine
    const result = await engine.selfReflect('agent-1');
    expect(result).toEqual({ suggestions: [], applied: false });
  });

  it('returns empty when soul not found', async () => {
    const repo = { ...makeRepo(makeSoul()), getByAgentId: vi.fn().mockResolvedValue(null) };
    const engine = new SoulEvolutionEngine(repo, makeLogRepo());
    const result = await engine.selfReflect('agent-1');
    expect(result).toEqual({ suggestions: [], applied: false });
  });

  it('supervised mode: returns suggestions but does not apply them', async () => {
    const soul = makeSoul({ evolution: { ...makeSoul().evolution, evolutionMode: 'supervised' } });
    const repo = makeRepo(soul);
    const reflectionEngine = {
      processMessage: vi.fn().mockResolvedValue({
        content: 'I should be more concise.\nI should ask for confirmation.',
      }),
    };
    const engine = new SoulEvolutionEngine(repo, makeLogRepo(), reflectionEngine);
    const result = await engine.selfReflect('agent-1');
    expect(result.suggestions).toHaveLength(2);
    expect(result.applied).toBe(false);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('autonomous mode: applies suggestions and persists', async () => {
    const soul = makeSoul({ evolution: { ...makeSoul().evolution, evolutionMode: 'autonomous' } });
    const repo = makeRepo(soul);
    const reflectionEngine = {
      processMessage: vi
        .fn()
        .mockResolvedValue({ content: 'I should improve.\nI should do better.' }),
    };
    const engine = new SoulEvolutionEngine(repo, makeLogRepo(), reflectionEngine);
    const result = await engine.selfReflect('agent-1');
    expect(result.applied).toBe(true);
    expect(result.suggestions).toHaveLength(2);
    expect(repo.update).toHaveBeenCalledOnce();
  });

  it('autonomous mode: snapshot created BEFORE mutation (H1 fix)', async () => {
    const soul = makeSoul({ evolution: { ...makeSoul().evolution, evolutionMode: 'autonomous' } });
    const repo = makeRepo(soul);
    const reflectionEngine = {
      processMessage: vi.fn().mockResolvedValue({ content: 'I should improve.' }),
    };

    const order: string[] = [];
    let versionAtSnapshot = -1;
    repo.createVersion.mockImplementation((s: AgentSoul) => {
      order.push('createVersion');
      versionAtSnapshot = s.evolution.version;
      return Promise.resolve();
    });
    repo.update.mockImplementation((s: AgentSoul) => {
      order.push(`update@v${s.evolution.version}`);
      return Promise.resolve();
    });

    const engine = new SoulEvolutionEngine(repo, makeLogRepo(), reflectionEngine);
    await engine.selfReflect('agent-1');

    expect(order[0]).toBe('createVersion');
    // snapshot was taken at version 1 (before ++)
    expect(versionAtSnapshot).toBe(1);
    // update was called with incremented version
    expect(order[1]).toBe('update@v2');
  });

  it('autonomous mode: only lines starting with "I should" count as suggestions', async () => {
    const soul = makeSoul({ evolution: { ...makeSoul().evolution, evolutionMode: 'autonomous' } });
    const repo = makeRepo(soul);
    const reflectionEngine = {
      processMessage: vi.fn().mockResolvedValue({
        content: 'Here is my reflection:\nI should improve.\nSome other text.\nI should also do X.',
      }),
    };
    const engine = new SoulEvolutionEngine(repo, makeLogRepo(), reflectionEngine);
    const result = await engine.selfReflect('agent-1');
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions).toContain('I should improve.');
    expect(result.suggestions).toContain('I should also do X.');
  });

  it('autonomous mode: caps learnings at 50 after self-reflection', async () => {
    const soul = makeSoul({
      evolution: {
        ...makeSoul().evolution,
        evolutionMode: 'autonomous',
        learnings: Array.from({ length: 49 }, (_, i) => `l${i}`),
      },
    });
    const repo = makeRepo(soul);
    const reflectionEngine = {
      processMessage: vi
        .fn()
        .mockResolvedValue({ content: 'I should do A.\nI should do B.\nI should do C.' }),
    };
    const engine = new SoulEvolutionEngine(repo, makeLogRepo(), reflectionEngine);
    const result = await engine.selfReflect('agent-1');
    // 49 existing + 3 new = 52 → capped to 50
    const updated: AgentSoul = repo.update.mock.calls[0][0];
    expect(updated.evolution.learnings.length).toBe(50);
    expect(result.applied).toBe(true);
  });
});
