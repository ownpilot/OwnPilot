/**
 * Tests for AgentRouter, getAgentRouter, createAgentRouter, agentConfigToInfo
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must be declared before imports)
// ---------------------------------------------------------------------------

vi.mock('../services/get-log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import {
  AgentRouter,
  getAgentRouter,
  createAgentRouter,
  agentConfigToInfo,
  type AgentInfo,
  type RouterLLMProvider,
  type RoutingContext,
  type AgentRoutingResult as _AgentRoutingResult,
  type AgentRouterConfig as _AgentRouterConfig,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'A test agent for unit tests',
    capabilities: ['testing', 'mocking'],
    triggers: {
      keywords: ['test', 'mock'],
      description: 'Use when testing',
    },
    ...overrides,
  };
}

function makeLLMProvider(): RouterLLMProvider {
  return {
    complete: vi.fn(),
  };
}

function makeContext(overrides: Partial<RoutingContext> = {}): RoutingContext {
  return {
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DEFAULT_CONFIG values (verified via behavior)', () => {
  it('defaultAgentId defaults to general-assistant (verified via fallback result)', async () => {
    const router = new AgentRouter();
    const result = await router.route('totally unmatched query XYZ_UNIQUE_123');
    expect(result.agentId).toBe('general-assistant');
  });

  it('minConfidence defaults to 0.4 (single keyword score 0.3 falls back)', async () => {
    // 1 keyword match = 0.3 score < default minConfidence (0.4) => fallback
    const router = new AgentRouter();
    router.registerAgent(
      makeAgent({
        id: 'threshold-test',
        name: 'Threshold Test',
        capabilities: [],
        triggers: { keywords: ['unique_word_xyz'] },
      })
    );
    const result = await router.route('unique_word_xyz', {});
    expect(result.agentId).toBe('general-assistant');
  });

  it('enableReasoning defaults to true (does not throw on route)', async () => {
    // If enableReasoning were false and broke something, route would fail
    const router = new AgentRouter();
    const result = await router.route('test query');
    expect(result).toBeDefined();
    expect(result.reasoning).toBeDefined();
  });
});

// =============================================================================
// Constructor
// =============================================================================

describe('AgentRouter - constructor', () => {
  it('creates an instance without arguments', () => {
    const router = new AgentRouter();
    expect(router).toBeInstanceOf(AgentRouter);
  });

  it('creates an instance with empty config', () => {
    const router = new AgentRouter({});
    expect(router).toBeInstanceOf(AgentRouter);
  });

  it('defaults to defaultAgentId from DEFAULT_CONFIG', async () => {
    const router = new AgentRouter();
    const result = await router.route('no match here', {});
    expect(result.agentId).toBe('general-assistant');
  });

  it('uses custom defaultAgentId when provided', async () => {
    const router = new AgentRouter({ defaultAgentId: 'my-default-agent' });
    const result = await router.route('no match here', {});
    expect(result.agentId).toBe('my-default-agent');
  });

  it('merges custom config with defaults (only overrides specified keys)', async () => {
    const router = new AgentRouter({ defaultAgentId: 'custom-default' });
    // minConfidence should still be 0.4 (default)
    // register an agent that scores just above 0.4
    router.registerAgent(
      makeAgent({ id: 'coded', name: 'coded', capabilities: [], triggers: { keywords: ['hello'] } })
    );
    const result = await router.route('hello world', {});
    // 0.3 for keyword match < 0.4 minConfidence => falls back
    expect(result.agentId).toBe('custom-default');
  });

  it('uses custom minConfidence when provided', async () => {
    const router = new AgentRouter({ minConfidence: 0.2 });
    router.registerAgent(
      makeAgent({ id: 'low', name: 'low', capabilities: [], triggers: { keywords: ['hello'] } })
    );
    const result = await router.route('hello world', {});
    // 0.3 >= 0.2 => should match
    expect(result.agentId).toBe('low');
    expect(result.confidence).toBeCloseTo(0.3);
  });
});

// =============================================================================
// Agent Registration
// =============================================================================

describe('AgentRouter - registerAgent', () => {
  let router: AgentRouter;

  beforeEach(() => {
    router = new AgentRouter();
  });

  it('stores an agent by ID', () => {
    const agent = makeAgent({ id: 'agent-x' });
    router.registerAgent(agent);
    const agents = router.getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]!.id).toBe('agent-x');
  });

  it('overwrites an existing agent with the same ID', () => {
    router.registerAgent(makeAgent({ id: 'agent-x', name: 'Original' }));
    router.registerAgent(makeAgent({ id: 'agent-x', name: 'Updated' }));
    const agents = router.getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe('Updated');
  });

  it('stores multiple agents with different IDs', () => {
    router.registerAgent(makeAgent({ id: 'a1' }));
    router.registerAgent(makeAgent({ id: 'a2' }));
    router.registerAgent(makeAgent({ id: 'a3' }));
    expect(router.getAgents()).toHaveLength(3);
  });
});

describe('AgentRouter - registerAgents', () => {
  let router: AgentRouter;

  beforeEach(() => {
    router = new AgentRouter();
  });

  it('registers multiple agents at once', () => {
    router.registerAgents([
      makeAgent({ id: 'a1' }),
      makeAgent({ id: 'a2' }),
      makeAgent({ id: 'a3' }),
    ]);
    expect(router.getAgents()).toHaveLength(3);
  });

  it('registers an empty array without error', () => {
    router.registerAgents([]);
    expect(router.getAgents()).toHaveLength(0);
  });

  it('stores each agent with its correct ID', () => {
    router.registerAgents([
      makeAgent({ id: 'alpha', name: 'Alpha' }),
      makeAgent({ id: 'beta', name: 'Beta' }),
    ]);
    const ids = router
      .getAgents()
      .map((a) => a.id)
      .sort();
    expect(ids).toEqual(['alpha', 'beta']);
  });
});

describe('AgentRouter - unregisterAgent', () => {
  let router: AgentRouter;

  beforeEach(() => {
    router = new AgentRouter();
  });

  it('returns true when agent exists and is removed', () => {
    router.registerAgent(makeAgent({ id: 'target' }));
    const result = router.unregisterAgent('target');
    expect(result).toBe(true);
  });

  it('removes the agent from the store', () => {
    router.registerAgent(makeAgent({ id: 'target' }));
    router.unregisterAgent('target');
    expect(router.getAgents()).toHaveLength(0);
  });

  it('returns false when agent does not exist', () => {
    const result = router.unregisterAgent('non-existent');
    expect(result).toBe(false);
  });

  it('only removes the specified agent', () => {
    router.registerAgents([
      makeAgent({ id: 'a1' }),
      makeAgent({ id: 'a2' }),
      makeAgent({ id: 'a3' }),
    ]);
    router.unregisterAgent('a2');
    const ids = router
      .getAgents()
      .map((a) => a.id)
      .sort();
    expect(ids).toEqual(['a1', 'a3']);
  });

  it('returns false when called twice on the same ID', () => {
    router.registerAgent(makeAgent({ id: 'once' }));
    router.unregisterAgent('once');
    const result = router.unregisterAgent('once');
    expect(result).toBe(false);
  });
});

describe('AgentRouter - getAgents', () => {
  let router: AgentRouter;

  beforeEach(() => {
    router = new AgentRouter();
  });

  it('returns empty array when no agents registered', () => {
    expect(router.getAgents()).toEqual([]);
  });

  it('returns all registered agents as an array', () => {
    router.registerAgents([makeAgent({ id: 'a1' }), makeAgent({ id: 'a2' })]);
    expect(router.getAgents()).toHaveLength(2);
  });

  it('returns the complete agent objects', () => {
    const agent = makeAgent({ id: 'full', name: 'Full Agent', description: 'Full description' });
    router.registerAgent(agent);
    const result = router.getAgents();
    expect(result[0]).toEqual(agent);
  });
});

describe('AgentRouter - setLLMProvider', () => {
  it('sets the LLM provider for subsequent route calls', () => {
    const router = new AgentRouter();
    const llm = makeLLMProvider();
    router.setLLMProvider(llm);
    // Verified indirectly: route will call LLM complete
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('can be replaced with a different provider', async () => {
    const router = new AgentRouter();
    const llm1 = makeLLMProvider();
    const llm2 = makeLLMProvider();

    router.setLLMProvider(llm1);
    router.setLLMProvider(llm2);

    router.registerAgent(makeAgent({ id: 'agent-1', name: 'Agent One' }));

    (llm2.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'agent-1', confidence: 0.9, reasoning: 'Best match' })
    );

    await router.route('test message', {});
    expect(llm2.complete).toHaveBeenCalled();
    expect(llm1.complete).not.toHaveBeenCalled();
  });
});

// =============================================================================
// route() dispatch
// =============================================================================

describe('AgentRouter - route() dispatch', () => {
  it('calls routeWithRules (no LLM) when no provider set', async () => {
    const router = new AgentRouter();
    // Without LLM, route should still resolve (via rules)
    const result = await router.route('some message', {});
    expect(result).toBeDefined();
    expect(result.agentId).toBe('general-assistant');
  });

  it('calls routeWithLLM when LLM provider is set', async () => {
    const router = new AgentRouter();
    const llm = makeLLMProvider();
    router.setLLMProvider(llm);

    router.registerAgent(makeAgent({ id: 'target' }));

    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'target', confidence: 0.9, reasoning: 'Great match' })
    );

    await router.route('test message', {});
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('uses default empty context when none provided', async () => {
    const router = new AgentRouter();
    // Should not throw
    const result = await router.route('hello');
    expect(result).toBeDefined();
  });
});

// =============================================================================
// routeWithRules (no LLM)
// =============================================================================

describe('AgentRouter - routeWithRules', () => {
  let router: AgentRouter;

  beforeEach(() => {
    router = new AgentRouter();
    // No LLM provider => always uses rule-based routing
  });

  it('returns fallback when no agents registered', async () => {
    const result = await router.route('any message', {});
    expect(result.agentId).toBe('general-assistant');
    expect(result.confidence).toBe(0.5);
  });

  it('returns fallback when no agents score above minConfidence', async () => {
    // Agent with no matching keywords or capabilities
    router.registerAgent(
      makeAgent({
        id: 'unrelated',
        name: 'Unrelated Agent',
        description: 'Does unrelated things',
        capabilities: ['xyz', 'abc'],
        triggers: { keywords: ['xyz', 'abc'] },
      })
    );
    const result = await router.route('hello world nothing matches here', {});
    expect(result.agentId).toBe('general-assistant');
    expect(result.confidence).toBe(0.5);
  });

  // Keyword matching (+0.3 per keyword)
  it('adds +0.3 per matching keyword', async () => {
    // Use minConfidence:0.2 so that a single keyword hit (0.3) passes the threshold
    const lowRouter = new AgentRouter({ minConfidence: 0.2 });
    lowRouter.registerAgent(
      makeAgent({
        id: 'kw-agent',
        name: 'KW Agent',
        capabilities: [],
        triggers: { keywords: ['weather'] },
      })
    );
    const result = await lowRouter.route('what is the weather today?', {});
    expect(result.agentId).toBe('kw-agent');
    expect(result.confidence).toBeCloseTo(0.3);
  });

  it('accumulates +0.3 for each matching keyword', async () => {
    router.registerAgent(
      makeAgent({
        id: 'multi-kw',
        name: 'Multi KW',
        capabilities: [],
        triggers: { keywords: ['python', 'code', 'script'] },
      })
    );
    const result = await router.route('python code script', {});
    expect(result.agentId).toBe('multi-kw');
    // 3 keywords * 0.3 = 0.9
    expect(result.confidence).toBeCloseTo(0.9);
  });

  it('keyword matching is case-insensitive', async () => {
    router.registerAgent(
      makeAgent({
        id: 'case-agent',
        name: 'Case Agent',
        capabilities: [],
        triggers: { keywords: ['Python', 'CODE'] },
      })
    );
    const result = await router.route('i love python and code', {});
    expect(result.agentId).toBe('case-agent');
    expect(result.confidence).toBeCloseTo(0.6);
  });

  // Capability matching (+0.2 per capability)
  it('adds +0.2 per matching capability', async () => {
    // Use minConfidence:0.1 so that a single capability hit (0.2) passes the threshold
    const lowRouter = new AgentRouter({ minConfidence: 0.1 });
    lowRouter.registerAgent(
      makeAgent({
        id: 'cap-agent',
        name: 'Cap Agent',
        capabilities: ['translation'],
        triggers: { keywords: [] },
      })
    );
    const result = await lowRouter.route('I need translation help', {});
    expect(result.agentId).toBe('cap-agent');
    expect(result.confidence).toBeCloseTo(0.2);
  });

  it('accumulates +0.2 for each matching capability', async () => {
    router.registerAgent(
      makeAgent({
        id: 'multi-cap',
        name: 'Multi Cap',
        capabilities: ['math', 'science', 'history'],
        triggers: {},
      })
    );
    const result = await router.route('I need math and science and history help', {});
    expect(result.agentId).toBe('multi-cap');
    // 3 capabilities * 0.2 = 0.6
    expect(result.confidence).toBeCloseTo(0.6);
  });

  it('capability matching is case-insensitive', async () => {
    router.registerAgent(
      makeAgent({
        id: 'cap-case',
        name: 'Cap Case',
        capabilities: ['Translation', 'MATH'],
        triggers: {},
      })
    );
    const result = await router.route('i need translation and math', {});
    expect(result.agentId).toBe('cap-case');
    expect(result.confidence).toBeCloseTo(0.4);
  });

  // Name matching (+0.4)
  it('adds +0.4 when agent name appears in message', async () => {
    router.registerAgent(
      makeAgent({
        id: 'named',
        name: 'Sherlock',
        capabilities: [],
        triggers: {},
      })
    );
    const result = await router.route('I want to talk to Sherlock', {});
    expect(result.agentId).toBe('named');
    expect(result.confidence).toBeCloseTo(0.4);
  });

  it('name matching is case-insensitive', async () => {
    router.registerAgent(
      makeAgent({
        id: 'named-case',
        name: 'Watson',
        capabilities: [],
        triggers: {},
      })
    );
    const result = await router.route('let me ask watson about this', {});
    expect(result.agentId).toBe('named-case');
    expect(result.confidence).toBeCloseTo(0.4);
  });

  // Previous agent boost (+0.1)
  it('adds +0.1 for previousAgentId match', async () => {
    router.registerAgent(
      makeAgent({
        id: 'prev',
        name: 'Prev Agent',
        capabilities: [],
        triggers: { keywords: ['weather'] },
      })
    );
    const result = await router.route(
      'what is the weather',
      makeContext({ previousAgentId: 'prev' })
    );
    // 0.3 (keyword) + 0.1 (previous) = 0.4
    expect(result.agentId).toBe('prev');
    expect(result.confidence).toBeCloseTo(0.4);
  });

  it('does not add boost when previousAgentId does not match', async () => {
    // Use low minConfidence so the single keyword match (0.3) still wins, showing no boost added
    const lowRouter = new AgentRouter({ minConfidence: 0.2 });
    lowRouter.registerAgent(
      makeAgent({
        id: 'target',
        name: 'Target',
        capabilities: [],
        triggers: { keywords: ['weather'] },
      })
    );
    const result = await lowRouter.route(
      'what is the weather',
      makeContext({ previousAgentId: 'other-agent' })
    );
    // Only keyword match: 0.3 (no previous boost since IDs don't match)
    expect(result.agentId).toBe('target');
    expect(result.confidence).toBeCloseTo(0.3);
  });

  // Score cap at 1.0
  it('caps score at 1.0 via Math.min', async () => {
    router.registerAgent(
      makeAgent({
        id: 'high-scorer',
        name: 'High Scorer',
        capabilities: ['math', 'science', 'history', 'art', 'music'],
        triggers: { keywords: ['math', 'science'] },
      })
    );
    // keywords: math(0.3) + science(0.3) = 0.6
    // capabilities: math(0.2) + science(0.2) + history(0.2) + art(0.2) + music(0.2) = 1.0
    // total would be 1.6 but capped at 1.0
    const result = await router.route('I need math science history art music High Scorer', {});
    expect(result.confidence).toBeLessThanOrEqual(1.0);
    expect(result.confidence).toBe(1.0);
  });

  // Sorting
  it('returns highest scoring agent as top match', async () => {
    router.registerAgent(
      makeAgent({
        id: 'low',
        name: 'Low Scorer',
        capabilities: [],
        triggers: { keywords: ['coding'] },
      })
    );
    router.registerAgent(
      makeAgent({
        id: 'high',
        name: 'High Scorer',
        capabilities: [],
        triggers: { keywords: ['coding', 'programming', 'development'] },
      })
    );
    const result = await router.route('coding programming development', {});
    expect(result.agentId).toBe('high');
  });

  // Alternatives
  it('includes up to 3 alternatives from runners-up', async () => {
    router.registerAgents([
      makeAgent({
        id: 'a1',
        name: 'A1',
        capabilities: [],
        triggers: { keywords: ['coding', 'programming', 'development'] },
      }),
      makeAgent({
        id: 'a2',
        name: 'A2',
        capabilities: [],
        triggers: { keywords: ['coding', 'programming'] },
      }),
      makeAgent({ id: 'a3', name: 'A3', capabilities: [], triggers: { keywords: ['coding'] } }),
      makeAgent({ id: 'a4', name: 'A4', capabilities: [], triggers: { keywords: ['coding'] } }),
    ]);
    const result = await router.route('coding programming development', {});
    expect(result.agentId).toBe('a1');
    expect(result.alternatives).toBeDefined();
    expect(result.alternatives!.length).toBeLessThanOrEqual(3);
  });

  it('alternatives contain agentId and confidence fields', async () => {
    router.registerAgents([
      makeAgent({
        id: 'a1',
        name: 'A1',
        capabilities: [],
        triggers: { keywords: ['coding', 'programming'] },
      }),
      makeAgent({ id: 'a2', name: 'A2', capabilities: [], triggers: { keywords: ['coding'] } }),
    ]);
    const result = await router.route('coding programming', {});
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives![0]).toHaveProperty('agentId');
    expect(result.alternatives![0]).toHaveProperty('confidence');
  });

  it('alternatives are sliced to first 3 runners-up (indices 1-3)', async () => {
    // 5 agents: winner + 4 runners-up => alternatives should have max 3
    router.registerAgents([
      makeAgent({
        id: 'w',
        name: 'W',
        capabilities: [],
        triggers: { keywords: ['a', 'b', 'c', 'd'] },
      }),
      makeAgent({
        id: 'r1',
        name: 'R1',
        capabilities: [],
        triggers: { keywords: ['a', 'b', 'c'] },
      }),
      makeAgent({ id: 'r2', name: 'R2', capabilities: [], triggers: { keywords: ['a', 'b'] } }),
      makeAgent({ id: 'r3', name: 'R3', capabilities: [], triggers: { keywords: ['a'] } }),
      makeAgent({ id: 'r4', name: 'R4', capabilities: [], triggers: { keywords: ['a'] } }),
    ]);
    const result = await router.route('a b c d', {});
    expect(result.agentId).toBe('w');
    expect(result.alternatives!.length).toBeLessThanOrEqual(3);
  });

  // Only agents with score > 0 are included
  it('only includes agents with score > 0 in results', async () => {
    // Use low minConfidence so keyword match (0.3) passes
    const lowRouter = new AgentRouter({ minConfidence: 0.2 });
    lowRouter.registerAgents([
      makeAgent({
        id: 'match',
        name: 'Match',
        capabilities: [],
        triggers: { keywords: ['python'] },
      }),
      makeAgent({
        id: 'nomatch',
        name: 'No Match',
        capabilities: [],
        triggers: { keywords: ['ruby'] },
      }),
    ]);
    const result = await lowRouter.route('python is great', {});
    expect(result.agentId).toBe('match');
    // alternatives should not include 'nomatch' (score=0)
    const altIds = result.alternatives?.map((a) => a.agentId) ?? [];
    expect(altIds).not.toContain('nomatch');
  });

  // minConfidence threshold
  it('falls back to default when top match is below minConfidence', async () => {
    // Default minConfidence = 0.4
    // A single keyword match gives score 0.3 which is below 0.4
    router.registerAgent(
      makeAgent({
        id: 'below-threshold',
        name: 'Below Threshold',
        capabilities: [],
        triggers: { keywords: ['hello'] },
      })
    );
    const result = await router.route('hello there', {});
    expect(result.agentId).toBe('general-assistant');
    expect(result.confidence).toBe(0.5);
  });

  it('uses the top match when score equals minConfidence exactly', async () => {
    // 2 keywords * 0.3 = 0.6 which is >= 0.4
    // But let's set minConfidence=0.6 to test exact boundary
    const exactRouter = new AgentRouter({ minConfidence: 0.6 });
    exactRouter.registerAgent(
      makeAgent({
        id: 'exact',
        name: 'Exact',
        capabilities: [],
        triggers: { keywords: ['word1', 'word2'] },
      })
    );
    const result = await exactRouter.route('word1 word2', {});
    // 0.6 >= 0.6 => should match
    expect(result.agentId).toBe('exact');
    expect(result.confidence).toBeCloseTo(0.6);
  });

  // Reasoning message
  it('includes rule-based reasoning text', async () => {
    // Need score >= 0.4 to trigger rule-based match (not fallback)
    // keyword 'code' => 0.3, capability 'coding' => 0.2, total 0.5 >= 0.4
    router.registerAgent(
      makeAgent({
        id: 'matched',
        name: 'Matched',
        capabilities: ['coding'],
        triggers: { keywords: ['code'] },
      })
    );
    const result = await router.route('I need to write code with coding skills', {});
    expect(result.agentId).toBe('matched');
    expect(result.reasoning).toBe('Rule-based matching (LLM not available)');
  });

  // Combined scoring
  it('combines keywords and capabilities into total score', async () => {
    router.registerAgent(
      makeAgent({
        id: 'combo',
        name: 'Combo',
        capabilities: ['math'],
        triggers: { keywords: ['calculate'] },
      })
    );
    const result = await router.route('please calculate some math for me', {});
    // keyword: 0.3 + capability: 0.2 = 0.5
    expect(result.agentId).toBe('combo');
    expect(result.confidence).toBeCloseTo(0.5);
  });

  it('no triggers object does not crash', async () => {
    // Use low minConfidence to let capability match (0.2) pass
    const lowRouter = new AgentRouter({ minConfidence: 0.1 });
    lowRouter.registerAgent(
      makeAgent({
        id: 'no-triggers',
        name: 'No Triggers',
        capabilities: ['helpful'],
        triggers: undefined,
      })
    );
    const result = await lowRouter.route('I need helpful assistance', {});
    expect(result.agentId).toBe('no-triggers');
    expect(result.confidence).toBeCloseTo(0.2);
  });

  it('empty triggers.keywords does not crash', async () => {
    // Use low minConfidence so capability match (0.2) passes threshold
    const lowRouter = new AgentRouter({ minConfidence: 0.1 });
    lowRouter.registerAgent(
      makeAgent({
        id: 'empty-kw',
        name: 'Empty KW',
        capabilities: ['coding'],
        triggers: { keywords: [] },
      })
    );
    const result = await lowRouter.route('I need coding help', {});
    expect(result.agentId).toBe('empty-kw');
    expect(result.confidence).toBeCloseTo(0.2);
  });

  it('empty capabilities array does not crash', async () => {
    // Use low minConfidence so keyword match (0.3) passes threshold
    const lowRouter = new AgentRouter({ minConfidence: 0.2 });
    lowRouter.registerAgent(
      makeAgent({
        id: 'empty-caps',
        name: 'Empty Caps',
        capabilities: [],
        triggers: { keywords: ['data'] },
      })
    );
    const result = await lowRouter.route('data analysis', {});
    expect(result.agentId).toBe('empty-caps');
  });
});

// =============================================================================
// routeWithLLM
// =============================================================================

describe('AgentRouter - routeWithLLM', () => {
  let router: AgentRouter;
  let llm: RouterLLMProvider;

  beforeEach(() => {
    router = new AgentRouter();
    llm = makeLLMProvider();
    router.setLLMProvider(llm);
    router.registerAgent(makeAgent({ id: 'agent-a', name: 'Agent A' }));
    router.registerAgent(makeAgent({ id: 'agent-b', name: 'Agent B' }));
  });

  it('calls llm.complete with system and user messages', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'agent-a', confidence: 0.9, reasoning: 'Best fit' })
    );

    await router.route('I need help', {});

    const messages = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<{
      role: string;
      content: string;
    }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
  });

  it('system prompt includes agent list', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'agent-a', confidence: 0.9, reasoning: 'Good' })
    );

    await router.route('test', {});

    const systemContent = (
      (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<{
        role: string;
        content: string;
      }>
    )[0]!.content;
    expect(systemContent).toContain('agent-a');
    expect(systemContent).toContain('agent-b');
  });

  it('user prompt includes the user message', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'agent-a', confidence: 0.9, reasoning: 'Good' })
    );

    await router.route('My specific question', {});

    const userContent = (
      (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<{
        role: string;
        content: string;
      }>
    )[1]!.content;
    expect(userContent).toContain('My specific question');
  });

  it('returns parsed agentId, confidence, and reasoning from valid JSON response', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'agent-a', confidence: 0.85, reasoning: 'Perfect match' })
    );

    const result = await router.route('some query', {});
    expect(result.agentId).toBe('agent-a');
    expect(result.confidence).toBe(0.85);
    expect(result.reasoning).toBe('Perfect match');
  });

  it('parses JSON embedded in extra text (extracts first {...} match)', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'Here is my selection:\n{"agentId": "agent-b", "confidence": 0.75, "reasoning": "Good choice"}\nEnd of response.'
    );

    const result = await router.route('query', {});
    expect(result.agentId).toBe('agent-b');
    expect(result.confidence).toBe(0.75);
    expect(result.reasoning).toBe('Good choice');
  });

  it('parses JSON preceded by prose explanation', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'Based on analysis of the request and the available agents, I recommend:\n{"agentId": "agent-a", "confidence": 0.92, "reasoning": "Specialist agent"}'
    );

    const result = await router.route('query', {});
    expect(result.agentId).toBe('agent-a');
    expect(result.confidence).toBe(0.92);
  });

  it('returns fallback when LLM response has no JSON', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce('I cannot decide.');

    const result = await router.route('query', {});
    expect(result.agentId).toBe('general-assistant');
    expect(result.confidence).toBe(0.5);
    expect(result.reasoning).toContain('Could not parse LLM response');
  });

  it('returns fallback when LLM response is empty string', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce('');

    const result = await router.route('query', {});
    expect(result.agentId).toBe('general-assistant');
    expect(result.confidence).toBe(0.5);
  });

  it('returns fallback when parsed agentId does not exist in registered agents', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'non-existent-agent', confidence: 0.9, reasoning: 'Found it' })
    );

    const result = await router.route('query', {});
    expect(result.agentId).toBe('general-assistant');
    expect(result.confidence).toBe(0.5);
    expect(result.reasoning).toContain('Agent not found in response');
  });

  it('uses defaultAgentId and modified reasoning when confidence < minConfidence', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'agent-a', confidence: 0.2, reasoning: 'Weak match' })
    );

    const result = await router.route('query', {});
    // confidence 0.2 < minConfidence 0.4
    expect(result.agentId).toBe('general-assistant');
    expect(result.reasoning).toContain('Low confidence (0.2)');
    expect(result.reasoning).toContain('Falling back to default');
    expect(result.reasoning).toContain('Weak match');
  });

  it('preserves original confidence value in low-confidence response', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'agent-a', confidence: 0.1, reasoning: 'Very weak' })
    );

    const result = await router.route('query', {});
    // The original confidence is preserved in the spread
    expect(result.confidence).toBe(0.1);
  });

  it('falls back to routeWithRules when LLM throws', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    // Register agent with keywords matching the query so rules can pick it up
    router.registerAgent(
      makeAgent({
        id: 'rules-match',
        name: 'Rules Match',
        capabilities: [],
        triggers: { keywords: ['special', 'query', 'word'] },
      })
    );

    const result = await router.route('special query word', {});
    // Rules: 3 keywords * 0.3 = 0.9 >= 0.4 minConfidence => should match via rules
    expect(result.agentId).toBe('rules-match');
    expect(result.reasoning).toBe('Rule-based matching (LLM not available)');
  });

  it('falls back to routeWithRules when LLM throws non-Error', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce('string error');

    const result = await router.route('no matching keywords here', {});
    // Rules won't find a match => fallback
    expect(result.agentId).toBe('general-assistant');
    expect(result.confidence).toBe(0.5);
  });

  it('returns valid result when confidence equals minConfidence exactly', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'agent-a', confidence: 0.4, reasoning: 'Exact threshold' })
    );

    const result = await router.route('query', {});
    // 0.4 >= 0.4 => not below threshold => return as-is
    expect(result.agentId).toBe('agent-a');
    expect(result.confidence).toBe(0.4);
  });

  it('handles malformed JSON inside braces (fallback)', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'Here is: {invalid json content here}'
    );

    // JSON.parse will throw, LLM catch block => falls back to routeWithRules => then fallback
    const result = await router.route('query', {});
    expect(result.agentId).toBe('general-assistant');
  });

  it('handles JSON with nested objects (still matches first brace group)', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      '{"agentId": "agent-a", "confidence": 0.88, "reasoning": "Complex {nested} reason"}'
    );

    const result = await router.route('query', {});
    expect(result.agentId).toBe('agent-a');
    expect(result.confidence).toBe(0.88);
  });
});

// =============================================================================
// buildAgentListPrompt (tested indirectly via LLM route)
// =============================================================================

describe('AgentRouter - buildAgentListPrompt (via LLM prompt)', () => {
  let router: AgentRouter;
  let llm: RouterLLMProvider;

  beforeEach(() => {
    router = new AgentRouter();
    llm = makeLLMProvider();
    router.setLLMProvider(llm);
  });

  function getSystemPrompt(): string {
    const calls = (llm.complete as ReturnType<typeof vi.fn>).mock.calls;
    return (calls[0]![0] as Array<{ role: string; content: string }>)[0]!.content;
  }

  it('includes agent id and name as heading', async () => {
    router.registerAgent(
      makeAgent({ id: 'my-agent', name: 'My Agent', capabilities: ['coding'], triggers: {} })
    );
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'my-agent', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', {});
    expect(getSystemPrompt()).toContain('### my-agent: My Agent');
  });

  it('includes description', async () => {
    router.registerAgent(
      makeAgent({
        id: 'x',
        name: 'X',
        description: 'Special description here',
        capabilities: [],
        triggers: {},
      })
    );
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'x', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', {});
    expect(getSystemPrompt()).toContain('Description: Special description here');
  });

  it('includes capabilities joined by comma', async () => {
    router.registerAgent(
      makeAgent({ id: 'x', name: 'X', capabilities: ['math', 'science', 'art'], triggers: {} })
    );
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'x', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', {});
    expect(getSystemPrompt()).toContain('Capabilities: math, science, art');
  });

  it('includes Keywords line when keywords are present', async () => {
    router.registerAgent(
      makeAgent({ id: 'x', name: 'X', capabilities: [], triggers: { keywords: ['foo', 'bar'] } })
    );
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'x', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', {});
    expect(getSystemPrompt()).toContain('Keywords: foo, bar');
  });

  it('omits Keywords line when keywords array is empty', async () => {
    router.registerAgent(
      makeAgent({ id: 'x', name: 'X', capabilities: [], triggers: { keywords: [] } })
    );
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'x', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', {});
    expect(getSystemPrompt()).not.toContain('Keywords:');
  });

  it('omits Keywords line when triggers has no keywords', async () => {
    router.registerAgent(makeAgent({ id: 'x', name: 'X', capabilities: [], triggers: {} }));
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'x', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', {});
    expect(getSystemPrompt()).not.toContain('Keywords:');
  });

  it('includes When to use line when trigger description present', async () => {
    router.registerAgent(
      makeAgent({
        id: 'x',
        name: 'X',
        capabilities: [],
        triggers: { description: 'Use for advanced tasks' },
      })
    );
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'x', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', {});
    expect(getSystemPrompt()).toContain('When to use: Use for advanced tasks');
  });

  it('omits When to use line when trigger description absent', async () => {
    router.registerAgent(
      makeAgent({ id: 'x', name: 'X', capabilities: [], triggers: { keywords: ['test'] } })
    );
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'x', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', {});
    expect(getSystemPrompt()).not.toContain('When to use:');
  });

  it('includes all agents in the prompt', async () => {
    router.registerAgents([
      makeAgent({ id: 'alpha', name: 'Alpha', capabilities: [], triggers: {} }),
      makeAgent({ id: 'beta', name: 'Beta', capabilities: [], triggers: {} }),
    ]);
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'alpha', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', {});
    const prompt = getSystemPrompt();
    expect(prompt).toContain('alpha');
    expect(prompt).toContain('beta');
  });

  it('system prompt contains default agent ID in instructions', async () => {
    const customRouter = new AgentRouter({ defaultAgentId: 'fallback-agent' });
    customRouter.setLLMProvider(llm);
    customRouter.registerAgent(makeAgent({ id: 'x', name: 'X', capabilities: [], triggers: {} }));
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'x', confidence: 0.9, reasoning: 'ok' })
    );

    await customRouter.route('test', {});
    const prompt = getSystemPrompt();
    expect(prompt).toContain('fallback-agent');
  });
});

// =============================================================================
// buildContextPrompt (tested indirectly via LLM route)
// =============================================================================

describe('AgentRouter - buildContextPrompt (via LLM user prompt)', () => {
  let router: AgentRouter;
  let llm: RouterLLMProvider;

  beforeEach(() => {
    router = new AgentRouter();
    llm = makeLLMProvider();
    router.setLLMProvider(llm);
    router.registerAgent(
      makeAgent({ id: 'target', name: 'Target', capabilities: [], triggers: {} })
    );
  });

  function getUserPrompt(): string {
    const calls = (llm.complete as ReturnType<typeof vi.fn>).mock.calls;
    return (calls[0]![0] as Array<{ role: string; content: string }>)[1]!.content;
  }

  it('returns empty context string when context has no fields', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'target', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test message', {});
    const userPrompt = getUserPrompt();
    // Should start with newline + user message (no context prefix)
    expect(userPrompt).not.toContain('Context:');
  });

  it('includes channel in context when provided', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'target', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', makeContext({ channel: 'telegram' }));
    expect(getUserPrompt()).toContain('Channel: telegram');
    expect(getUserPrompt()).toContain('Context:');
  });

  it('includes previousAgentId in context when provided', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'target', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', makeContext({ previousAgentId: 'prev-agent' }));
    expect(getUserPrompt()).toContain('Previous agent: prev-agent');
  });

  it('includes recent conversation when conversationHistory is provided', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'target', confidence: 0.9, reasoning: 'ok' })
    );

    const history = [
      { role: 'user' as const, content: 'Earlier question' },
      { role: 'assistant' as const, content: 'Earlier answer' },
    ];

    await router.route('test', makeContext({ conversationHistory: history }));
    const prompt = getUserPrompt();
    expect(prompt).toContain('Recent conversation:');
    expect(prompt).toContain('user:');
    expect(prompt).toContain('assistant:');
  });

  it('truncates conversation content to 100 chars with ellipsis', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'target', confidence: 0.9, reasoning: 'ok' })
    );

    const longContent = 'x'.repeat(200);
    const history = [{ role: 'user' as const, content: longContent }];

    await router.route('test', makeContext({ conversationHistory: history }));
    const prompt = getUserPrompt();
    // Content sliced to 100 chars + '...'
    expect(prompt).toContain('x'.repeat(100) + '...');
    expect(prompt).not.toContain('x'.repeat(101));
  });

  it('only includes last 3 messages from conversation history', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'target', confidence: 0.9, reasoning: 'ok' })
    );

    const history = [
      { role: 'user' as const, content: 'Message 1 older' },
      { role: 'assistant' as const, content: 'Reply 1 older' },
      { role: 'user' as const, content: 'Message 2' },
      { role: 'assistant' as const, content: 'Reply 2' },
      { role: 'user' as const, content: 'Message 3 recent' },
    ];

    await router.route('test', makeContext({ conversationHistory: history }));
    const prompt = getUserPrompt();
    // Should include last 3: Message 2, Reply 2, Message 3 recent
    expect(prompt).toContain('Message 2');
    expect(prompt).toContain('Reply 2');
    expect(prompt).toContain('Message 3 recent');
    // Should NOT include older ones
    expect(prompt).not.toContain('Message 1 older');
    expect(prompt).not.toContain('Reply 1 older');
  });

  it('does not include conversation section when history is empty', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'target', confidence: 0.9, reasoning: 'ok' })
    );

    await router.route('test', makeContext({ conversationHistory: [] }));
    expect(getUserPrompt()).not.toContain('Recent conversation:');
  });

  it('includes all context fields when all present', async () => {
    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'target', confidence: 0.9, reasoning: 'ok' })
    );

    const history = [{ role: 'user' as const, content: 'Prior message' }];
    await router.route(
      'test',
      makeContext({
        channel: 'web',
        previousAgentId: 'old-agent',
        conversationHistory: history,
      })
    );

    const prompt = getUserPrompt();
    expect(prompt).toContain('Channel: web');
    expect(prompt).toContain('Previous agent: old-agent');
    expect(prompt).toContain('Recent conversation:');
  });
});

// =============================================================================
// fallbackResult
// =============================================================================

describe('AgentRouter - fallbackResult', () => {
  it('returns defaultAgentId in fallback', async () => {
    const router = new AgentRouter();
    const result = await router.route('no match', {});
    expect(result.agentId).toBe('general-assistant');
  });

  it('returns confidence of 0.5 in fallback', async () => {
    const router = new AgentRouter();
    const result = await router.route('no match', {});
    expect(result.confidence).toBe(0.5);
  });

  it('includes reason in reasoning for no-match fallback', async () => {
    const router = new AgentRouter();
    const result = await router.route('no match', {});
    expect(result.reasoning).toContain('No matching agent found');
  });

  it('includes "Using default agent." prefix in reasoning', async () => {
    const router = new AgentRouter();
    const result = await router.route('no match', {});
    expect(result.reasoning).toContain('Using default agent.');
  });

  it('uses custom defaultAgentId in fallback', async () => {
    const router = new AgentRouter({ defaultAgentId: 'my-fallback' });
    const result = await router.route('no match', {});
    expect(result.agentId).toBe('my-fallback');
  });

  it('LLM parse failure fallback includes correct reason', async () => {
    const router = new AgentRouter();
    const llm = makeLLMProvider();
    router.setLLMProvider(llm);
    router.registerAgent(makeAgent({ id: 'x', name: 'X', capabilities: [], triggers: {} }));

    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce('not json');
    const result = await router.route('test', {});
    expect(result.reasoning).toContain('Could not parse LLM response');
  });

  it('agent-not-found fallback includes correct reason', async () => {
    const router = new AgentRouter();
    const llm = makeLLMProvider();
    router.setLLMProvider(llm);
    router.registerAgent(
      makeAgent({ id: 'exists', name: 'Exists', capabilities: [], triggers: {} })
    );

    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'ghost', confidence: 0.9, reasoning: 'Sure' })
    );
    const result = await router.route('test', {});
    expect(result.reasoning).toContain('Agent not found in response');
  });
});

// =============================================================================
// agentConfigToInfo
// =============================================================================

describe('agentConfigToInfo', () => {
  it('passes through id and name', () => {
    const info = agentConfigToInfo({ id: 'my-agent', name: 'My Agent' });
    expect(info.id).toBe('my-agent');
    expect(info.name).toBe('My Agent');
  });

  it('passes through triggers', () => {
    const triggers = { keywords: ['foo', 'bar'], description: 'When to use' };
    const info = agentConfigToInfo({ id: 'x', name: 'X', triggers });
    expect(info.triggers).toEqual(triggers);
  });

  it('uses name.toLowerCase() as capability when no systemPrompt', () => {
    const info = agentConfigToInfo({ id: 'x', name: 'WeatherBot' });
    expect(info.capabilities).toEqual(['weatherbot']);
  });

  it('description is config.name when no systemPrompt', () => {
    const info = agentConfigToInfo({ id: 'x', name: 'My Agent' });
    expect(info.description).toBe('My Agent');
  });

  it('description is systemPrompt sliced to 200 chars', () => {
    const longPrompt = 'You are a helpful assistant. '.repeat(20); // >200 chars
    const info = agentConfigToInfo({ id: 'x', name: 'X', systemPrompt: longPrompt });
    expect(info.description).toBe(longPrompt.slice(0, 200));
    expect(info.description.length).toBe(200);
  });

  it('description is full systemPrompt when under 200 chars', () => {
    const shortPrompt = 'You are a helper.';
    const info = agentConfigToInfo({ id: 'x', name: 'X', systemPrompt: shortPrompt });
    expect(info.description).toBe(shortPrompt);
  });

  // Capability extraction: "can help with X"
  it('extracts capabilities from "can help with X" pattern', () => {
    const info = agentConfigToInfo({
      id: 'x',
      name: 'X',
      systemPrompt: 'I can help with math and science.',
    });
    expect(info.capabilities.length).toBeGreaterThan(0);
    // At least one capability should be extracted
    expect(info.capabilities.join(' ')).toContain('math and science');
  });

  it('extracts capabilities from "capabilities: X" pattern', () => {
    const info = agentConfigToInfo({
      id: 'x',
      name: 'X',
      systemPrompt: 'capabilities: data analysis and reporting',
    });
    expect(info.capabilities.length).toBeGreaterThan(0);
    expect(info.capabilities.join(' ')).toContain('data analysis');
  });

  it('extracts capabilities from "expertise in X" pattern', () => {
    const info = agentConfigToInfo({
      id: 'x',
      name: 'X',
      systemPrompt: 'I have expertise in Python programming.',
    });
    expect(info.capabilities.length).toBeGreaterThan(0);
    expect(info.capabilities.join(' ')).toContain('Python programming');
  });

  it('filters out capabilities >= 100 chars', () => {
    const longCap = 'x'.repeat(100);
    const info = agentConfigToInfo({
      id: 'x',
      name: 'FallbackAgent',
      systemPrompt: `can help with ${longCap}`,
    });
    // All extracted capabilities >= 100 chars filtered out => falls back to name.toLowerCase()
    const allShort = info.capabilities.every((c) => c.length < 100);
    expect(allShort).toBe(true);
  });

  it('falls back to name.toLowerCase() when all extracted capabilities are filtered by length', () => {
    const veryLongCap = 'z'.repeat(100);
    const info = agentConfigToInfo({
      id: 'x',
      name: 'MyFallback',
      systemPrompt: `can help with ${veryLongCap}`,
    });
    expect(info.capabilities).toEqual(['myfallback']);
  });

  it('handles multiple patterns in same systemPrompt', () => {
    const info = agentConfigToInfo({
      id: 'x',
      name: 'X',
      systemPrompt:
        'I can help with cooking. I have expertise in nutrition. capabilities: meal planning',
    });
    // Multiple matches expected
    expect(info.capabilities.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to [name.toLowerCase()] when systemPrompt is provided but has no matches', () => {
    const info = agentConfigToInfo({
      id: 'x',
      name: 'SpecialAgent',
      systemPrompt: 'You are a friendly AI. Just chat with users.',
    });
    // No capability patterns found => fallback
    expect(info.capabilities).toEqual(['specialagent']);
  });

  it('handles undefined systemPrompt gracefully', () => {
    const info = agentConfigToInfo({ id: 'x', name: 'NoPrompt', systemPrompt: undefined });
    expect(info.capabilities).toEqual(['noprompt']);
    expect(info.description).toBe('NoPrompt');
  });

  it('handles empty systemPrompt string', () => {
    const info = agentConfigToInfo({ id: 'x', name: 'EmptyPrompt', systemPrompt: '' });
    // Empty string => no patterns matched => name fallback
    expect(info.capabilities).toEqual(['emptyprompt']);
    // systemPrompt?.slice(0, 200) on empty string is '', which is falsy... actually '' is falsy
    // '' || config.name => config.name
    expect(info.description).toBe('EmptyPrompt');
  });

  it('returns AgentInfo with all required fields', () => {
    const info = agentConfigToInfo({ id: 'x', name: 'X' });
    expect(info).toHaveProperty('id');
    expect(info).toHaveProperty('name');
    expect(info).toHaveProperty('description');
    expect(info).toHaveProperty('capabilities');
    expect(Array.isArray(info.capabilities)).toBe(true);
  });

  it('handles systemPrompt with "can help with" but short result', () => {
    const info = agentConfigToInfo({
      id: 'x',
      name: 'Helper',
      systemPrompt: 'I can help with coding tasks.',
    });
    // Should extract "coding tasks."
    expect(info.capabilities.length).toBeGreaterThan(0);
    const allShort = info.capabilities.every((c) => c.length < 100);
    expect(allShort).toBe(true);
  });

  it('case-insensitive capability extraction (gi flag)', () => {
    const info = agentConfigToInfo({
      id: 'x',
      name: 'X',
      systemPrompt: 'CAN HELP WITH machine learning. EXPERTISE IN neural networks.',
    });
    expect(info.capabilities.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Factory Functions
// =============================================================================

describe('getAgentRouter', () => {
  it('returns an AgentRouter instance', () => {
    const router = getAgentRouter();
    expect(router).toBeInstanceOf(AgentRouter);
  });

  it('returns the same instance on repeated calls (singleton)', () => {
    const r1 = getAgentRouter();
    const r2 = getAgentRouter();
    expect(r1).toBe(r2);
  });

  it('singleton persists registered agents across calls', () => {
    const r1 = getAgentRouter();
    // Note: This test depends on the singleton having no agents from prior state
    // Register via singleton reference
    const agentsBefore = r1.getAgents().length;
    r1.registerAgent(makeAgent({ id: 'singleton-test-agent' }));
    const r2 = getAgentRouter();
    // r2 is same instance — should see the registered agent
    expect(r2.getAgents().length).toBe(agentsBefore + 1);
    // Cleanup: unregister to avoid polluting other tests
    r1.unregisterAgent('singleton-test-agent');
  });
});

describe('createAgentRouter', () => {
  it('creates a new AgentRouter instance', () => {
    const router = createAgentRouter();
    expect(router).toBeInstanceOf(AgentRouter);
  });

  it('creates a new instance each time (not singleton)', () => {
    const r1 = createAgentRouter();
    const r2 = createAgentRouter();
    expect(r1).not.toBe(r2);
  });

  it('accepts custom config', () => {
    const router = createAgentRouter({ defaultAgentId: 'custom', minConfidence: 0.6 });
    expect(router).toBeInstanceOf(AgentRouter);
  });

  it('custom config is applied correctly', async () => {
    const router = createAgentRouter({ defaultAgentId: 'my-custom-default' });
    const result = await router.route('no match for anything');
    expect(result.agentId).toBe('my-custom-default');
  });

  it('creates instance different from singleton', () => {
    const singleton = getAgentRouter();
    const created = createAgentRouter();
    expect(created).not.toBe(singleton);
  });

  it('created instances are independent (separate agent registries)', () => {
    const r1 = createAgentRouter();
    const r2 = createAgentRouter();
    r1.registerAgent(makeAgent({ id: 'only-in-r1' }));
    expect(r1.getAgents()).toHaveLength(1);
    expect(r2.getAgents()).toHaveLength(0);
  });

  it('no-argument call uses default config', async () => {
    const router = createAgentRouter();
    const result = await router.route('no match');
    expect(result.agentId).toBe('general-assistant');
  });
});

// =============================================================================
// Integration - combined scoring scenarios
// =============================================================================

describe('AgentRouter - integration scenarios', () => {
  it('name + keyword + capability all contribute to score', async () => {
    const router = new AgentRouter({ minConfidence: 0.4 });
    router.registerAgent(
      makeAgent({
        id: 'math-agent',
        name: 'MathBot',
        capabilities: ['algebra'],
        triggers: { keywords: ['calculate'] },
      })
    );

    // 'calculate' keyword: +0.3
    // 'algebra' capability: +0.2
    // 'MathBot' name in message: +0.4
    // Total: 0.9
    const result = await router.route('Can MathBot calculate some algebra for me?', {});
    expect(result.agentId).toBe('math-agent');
    expect(result.confidence).toBeCloseTo(0.9);
  });

  it('previous agent boost tips score above threshold', async () => {
    const router = new AgentRouter({ minConfidence: 0.4 });
    router.registerAgent(
      makeAgent({
        id: 'prev-agent',
        name: 'Previous',
        capabilities: [],
        triggers: { keywords: ['status'] },
      })
    );

    // keyword 'status': 0.3 < 0.4 but with previous boost: 0.4 >= 0.4
    const result = await router.route(
      'give me a status update',
      makeContext({ previousAgentId: 'prev-agent' })
    );
    expect(result.agentId).toBe('prev-agent');
    expect(result.confidence).toBeCloseTo(0.4);
  });

  it('selects highest scoring agent from multiple registered', async () => {
    const router = new AgentRouter({ minConfidence: 0.3 });
    router.registerAgents([
      makeAgent({
        id: 'code-agent',
        name: 'Coder',
        capabilities: ['coding', 'programming'],
        triggers: { keywords: ['code', 'python'] },
      }),
      makeAgent({
        id: 'chat-agent',
        name: 'Chatter',
        capabilities: ['chat'],
        triggers: { keywords: ['hello', 'hi'] },
      }),
      makeAgent({
        id: 'math-agent',
        name: 'Mathematician',
        capabilities: ['math'],
        triggers: { keywords: ['calculate', 'equation'] },
      }),
    ]);

    const result = await router.route('I need help with python code', {});
    expect(result.agentId).toBe('code-agent');
  });

  it('LLM fallback to rules when LLM fails - rules succeed', async () => {
    const router = new AgentRouter({ minConfidence: 0.3 });
    const llm = makeLLMProvider();
    router.setLLMProvider(llm);
    router.registerAgent(
      makeAgent({
        id: 'rules-agent',
        name: 'Rules Agent',
        capabilities: [],
        triggers: { keywords: ['fallback', 'rules'] },
      })
    );

    (llm.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Timeout'));

    const result = await router.route('use fallback and rules', {});
    expect(result.agentId).toBe('rules-agent');
    expect(result.confidence).toBeCloseTo(0.6);
  });

  it('empty agents with LLM always returns fallback', async () => {
    const router = new AgentRouter();
    const llm = makeLLMProvider();
    router.setLLMProvider(llm);

    (llm.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({ agentId: 'non-existent', confidence: 0.9, reasoning: 'Good' })
    );

    const result = await router.route('any query', {});
    expect(result.agentId).toBe('general-assistant');
  });
});
