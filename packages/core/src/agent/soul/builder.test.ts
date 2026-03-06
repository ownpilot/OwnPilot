import { describe, it, expect } from 'vitest';
import { buildSoulPrompt, estimateSoulTokens } from './builder.js';
import type { AgentSoul, HeartbeatTask } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSoul(overrides: Partial<AgentSoul> = {}): AgentSoul {
  return {
    id: 'soul-1',
    agentId: 'agent-1',
    identity: {
      name: 'Scout',
      emoji: '🔍',
      role: 'Trend Researcher',
      personality: 'curious',
      voice: { tone: 'casual', language: 'en' },
      boundaries: ['No politics', 'No spam'],
    },
    purpose: {
      mission: 'Find the best trends',
      goals: ['Goal A', 'Goal B'],
      expertise: ['social media', 'data analysis'],
      toolPreferences: [],
    },
    autonomy: {
      level: 3,
      allowedActions: ['search_web'],
      blockedActions: ['delete_data'],
      requiresApproval: ['publish'],
      maxCostPerCycle: 0.5,
      maxCostPerDay: 5,
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

// ---------------------------------------------------------------------------
// buildSoulPrompt()
// ---------------------------------------------------------------------------

describe('buildSoulPrompt() — identity', () => {
  it('includes agent name and emoji', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).toContain('Scout');
    expect(result).toContain('🔍');
  });

  it('includes role and personality', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).toContain('Trend Researcher');
    expect(result).toContain('curious');
  });

  it('includes backstory when provided', () => {
    const soul = makeSoul();
    soul.identity.backstory = 'Was once a journalist';
    const result = buildSoulPrompt(soul, [], 0);
    expect(result).toContain('Was once a journalist');
  });

  it('includes voice quirks when provided', () => {
    const soul = makeSoul();
    soul.identity.voice.quirks = ['Uses cooking analogies'];
    const result = buildSoulPrompt(soul, [], 0);
    expect(result).toContain('Uses cooking analogies');
  });
});

describe('buildSoulPrompt() — boundaries', () => {
  it('includes boundaries in the ALWAYS RESPECT section', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).toContain('ALWAYS RESPECT');
    expect(result).toContain('No politics');
    expect(result).toContain('No spam');
  });
});

describe('buildSoulPrompt() — mission & goals', () => {
  it('includes mission and numbered goals', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).toContain('Find the best trends');
    expect(result).toContain('Goal A');
    expect(result).toContain('Goal B');
  });

  it('includes expertise areas', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).toContain('social media');
    expect(result).toContain('data analysis');
  });
});

describe('buildSoulPrompt() — autonomy', () => {
  it('includes autonomy level and allowed/blocked/approval actions', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).toContain('Autonomy Level: 3');
    expect(result).toContain('search_web');
    expect(result).toContain('delete_data');
    expect(result).toContain('publish');
  });

  it('includes daily budget', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).toContain('$5');
  });
});

describe('buildSoulPrompt() — inbox', () => {
  it('shows inbox section when pendingInbox > 0', () => {
    const result = buildSoulPrompt(makeSoul(), [], 3);
    expect(result).toContain('3');
    expect(result).toContain('unread');
  });

  it('omits inbox section when pendingInbox is 0', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).not.toContain('unread');
  });
});

describe('buildSoulPrompt() — current heartbeat task', () => {
  it('includes task name and description when provided', () => {
    const task: HeartbeatTask = {
      id: 'task-1',
      name: 'Check Twitter',
      description: 'Find trending topics',
      schedule: 'every',
      tools: ['search_web'],
      priority: 'high',
      stalenessHours: 0,
    };
    const result = buildSoulPrompt(makeSoul(), [], 0, task);
    expect(result).toContain('Check Twitter');
    expect(result).toContain('Find trending topics');
    expect(result).toContain('Current Heartbeat Task');
  });

  it('omits heartbeat task section when not provided', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).not.toContain('Current Heartbeat Task');
  });
});

describe('buildSoulPrompt() — learnings', () => {
  it('shows last 10 learnings when there are more than 10', () => {
    const soul = makeSoul();
    // learning-0 … learning-14 (15 total); slice(-10) = learning-5 … learning-14
    soul.evolution.learnings = Array.from({ length: 15 }, (_, i) => `learning-${i}`);
    const result = buildSoulPrompt(soul, [], 0);
    expect(result).toContain('learning-5'); // first of last 10
    expect(result).toContain('learning-14'); // last
    expect(result).not.toContain('learning-0'); // trimmed
    expect(result).not.toContain('learning-4'); // trimmed
  });

  it('omits learnings section when learnings array is empty', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).not.toContain('Learnings from Experience');
  });
});

describe('buildSoulPrompt() — recent memories', () => {
  it('shows at most 5 memories', () => {
    const memories = Array.from({ length: 10 }, (_, i) => ({
      content: `memory-${i}`,
      importance: i,
    }));
    const result = buildSoulPrompt(makeSoul(), memories, 0);
    expect(result).toContain('memory-0');
    expect(result).toContain('memory-4');
    expect(result).not.toContain('memory-5');
  });

  it('omits memories section when list is empty', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).not.toContain('Recent Memories');
  });
});

describe('buildSoulPrompt() — relationships', () => {
  it('includes team section when reportsTo is set', () => {
    const soul = makeSoul();
    soul.relationships.reportsTo = 'manager-agent';
    const result = buildSoulPrompt(soul, [], 0);
    expect(result).toContain('Your Team');
    expect(result).toContain('manager-agent');
  });

  it('includes peers in team section', () => {
    const soul = makeSoul();
    soul.relationships.peers = ['peer-1', 'peer-2'];
    const result = buildSoulPrompt(soul, [], 0);
    expect(result).toContain('peer-1');
    expect(result).toContain('peer-2');
  });

  it('includes delegates in team section', () => {
    const soul = makeSoul();
    soul.relationships.delegates = ['delegate-1'];
    const result = buildSoulPrompt(soul, [], 0);
    expect(result).toContain('delegate-1');
  });

  it('omits team section when no relationships are configured', () => {
    const result = buildSoulPrompt(makeSoul(), [], 0);
    expect(result).not.toContain('Your Team');
  });
});

// ---------------------------------------------------------------------------
// estimateSoulTokens()
// ---------------------------------------------------------------------------

describe('estimateSoulTokens()', () => {
  it('returns a positive number', () => {
    expect(estimateSoulTokens(makeSoul())).toBeGreaterThan(0);
  });

  it('returns more tokens for a soul with more content', () => {
    const sparse = makeSoul();
    const rich = makeSoul();
    rich.evolution.learnings = Array.from(
      { length: 10 },
      (_, i) => `learning-${i}-with-a-much-longer-description-here`
    );
    rich.purpose.goals = Array.from({ length: 5 }, (_, i) => `goal-${i}-detailed`);
    rich.identity.boundaries = Array.from({ length: 10 }, (_, i) => `boundary rule number ${i}`);
    expect(estimateSoulTokens(rich)).toBeGreaterThan(estimateSoulTokens(sparse));
  });

  it('estimate is ceil(promptLength / 4)', () => {
    const soul = makeSoul();
    const prompt = buildSoulPrompt(soul, [], 0);
    expect(estimateSoulTokens(soul)).toBe(Math.ceil(prompt.length / 4));
  });
});
