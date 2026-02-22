/**
 * Tests for packages/gateway/src/assistant/orchestrator.ts
 *
 * Covers:
 *   buildEnhancedSystemPrompt, checkToolCallApproval, evaluateTriggers,
 *   extractMemories, updateGoalProgress, getOrchestratorStats,
 *   and indirectly: safeJsonParse, mapToolToCategory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before module imports so vi.mock hoisting can use them
// ---------------------------------------------------------------------------

const mockMemoryService = {
  listMemories: vi.fn(),
  batchRemember: vi.fn(),
  getStats: vi.fn(),
};

const mockGoalService = {
  listGoals: vi.fn(),
  getSteps: vi.fn(),
  getActive: vi.fn(),
  completeStep: vi.fn(),
};

const mockTriggerService = {
  listTriggers: vi.fn(),
};

const mockRegistryGet = vi.fn((service: string) => {
  if (service === 'memory') return mockMemoryService;
  if (service === 'goal') return mockGoalService;
  if (service === 'trigger') return mockTriggerService;
  return {};
});

vi.mock('@ownpilot/core', () => ({
  getServiceRegistry: vi.fn(() => ({ get: mockRegistryGet })),
  Services: { Memory: 'memory', Goal: 'goal', Trigger: 'trigger' },
  getBaseName: vi.fn((name: string) => name.split('.').pop() ?? name),
}));

const mockResourceSummary = vi.fn(() => []);
vi.mock('../services/resource-registry.js', () => ({
  getResourceRegistry: vi.fn(() => ({ getSummary: mockResourceSummary })),
}));

const mockGetUserConfig = vi.fn(() => ({
  level: 2,
  dailyBudget: 10,
  dailySpend: 3,
  allowedTools: [] as string[],
  blockedTools: [] as string[],
}));

const mockGetPendingActions = vi.fn(() => [] as unknown[]);

vi.mock('../autonomy/index.js', () => ({
  getApprovalManager: vi.fn(() => ({
    getUserConfig: mockGetUserConfig,
    getPendingActions: mockGetPendingActions,
  })),
  assessRisk: vi.fn(() => ({
    level: 'low',
    requiresApproval: false,
  })),
}));

const mockFireTrigger = vi.fn(() => ({ success: true }));
const mockTriggerEmit = vi.fn();

vi.mock('../triggers/engine.js', () => ({
  getTriggerEngine: vi.fn(() => ({
    fireTrigger: mockFireTrigger,
    emit: mockTriggerEmit,
  })),
}));

const mockExtractMemoriesFromResponse = vi.fn(() => ({ memories: [] as unknown[] }));
vi.mock('../utils/memory-extraction.js', () => ({
  extractMemoriesFromResponse: mockExtractMemoriesFromResponse,
}));

vi.mock('../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks are registered
// ---------------------------------------------------------------------------

import {
  buildEnhancedSystemPrompt,
  checkToolCallApproval,
  evaluateTriggers,
  extractMemories,
  updateGoalProgress,
  getOrchestratorStats,
} from './orchestrator.js';

import { assessRisk } from '../autonomy/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = 'user-123';

function makeToolCall(name: string, args = '{}') {
  return { id: 'tc-1', name, arguments: args };
}

function makeMemory(type: string, content: string) {
  return { id: `m-${Math.random()}`, type, content, importance: 0.8 };
}

function makeGoal(
  title: string,
  progress = 50,
  opts: { dueDate?: string; description?: string } = {}
) {
  return {
    id: `g-${Math.random()}`,
    title,
    progress,
    dueDate: opts.dueDate,
    description: opts.description,
  };
}

function makeStep(title: string, status: 'pending' | 'in_progress' | 'completed' = 'pending') {
  return { id: `s-${Math.random()}`, title, status };
}

function makeTrigger(
  type: 'condition' | 'event',
  config: Record<string, unknown>,
  id = `t-${Math.random()}`
) {
  return { id, type, config };
}

// ---------------------------------------------------------------------------
// buildEnhancedSystemPrompt
// ---------------------------------------------------------------------------

describe('buildEnhancedSystemPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryService.listMemories.mockResolvedValue([]);
    mockGoalService.listGoals.mockResolvedValue([]);
    mockResourceSummary.mockReturnValue([]);
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 10,
      dailySpend: 3,
      allowedTools: [],
      blockedTools: [],
    });
  });

  // --- Section stripping ---

  it('returns base prompt unchanged when no injected sections exist', async () => {
    const base = 'You are a helpful assistant.';
    const { prompt } = await buildEnhancedSystemPrompt(base, { userId: USER_ID });
    expect(prompt.startsWith(base)).toBe(true);
  });

  it('strips previously injected User Context section', async () => {
    const base = 'You are helpful.\n---\n## User Context (from memory)\n- old memory';
    const { prompt } = await buildEnhancedSystemPrompt(base, { userId: USER_ID });
    expect(prompt).not.toContain('old memory');
    expect(prompt).toContain('You are helpful.');
  });

  it('strips previously injected Active Goals section', async () => {
    const base = 'Base.\n---\n## Active Goals\n- old goal';
    const { prompt } = await buildEnhancedSystemPrompt(base, { userId: USER_ID });
    expect(prompt).not.toContain('old goal');
    expect(prompt).toContain('Base.');
  });

  it('strips previously injected Available Data Resources section', async () => {
    const base = 'Base.\n---\n## Available Data Resources\n- old resource';
    const { prompt } = await buildEnhancedSystemPrompt(base, { userId: USER_ID });
    expect(prompt).not.toContain('old resource');
  });

  it('strips previously injected Autonomy Level section', async () => {
    const base = 'Base.\n---\n## Autonomy Level: Manual\nAsk for permission.';
    const { prompt } = await buildEnhancedSystemPrompt(base, { userId: USER_ID });
    // After stripping, the old autonomy section should be gone but a new one added
    // Verify old content ("Manual") is replaced by new autonomy section
    const occurrences = (prompt.match(/## Autonomy Level:/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(prompt.indexOf('Base.')).toBe(0);
  });

  it('strips at the earliest injected header when multiple are present', async () => {
    const base =
      'Clean.\n---\n## User Context (from memory)\nstuff\n---\n## Active Goals\nmore stuff';
    const { prompt } = await buildEnhancedSystemPrompt(base, { userId: USER_ID });
    expect(prompt).not.toContain('stuff');
    expect(prompt.startsWith('Clean.')).toBe(true);
  });

  // --- Parallel fetch ---

  it('calls listMemories and listGoals in parallel (both called once)', async () => {
    await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(mockMemoryService.listMemories).toHaveBeenCalledTimes(1);
    expect(mockGoalService.listGoals).toHaveBeenCalledTimes(1);
  });

  it('passes userId and correct params to listMemories', async () => {
    await buildEnhancedSystemPrompt('Base', { userId: USER_ID, maxMemories: 7 });
    expect(mockMemoryService.listMemories).toHaveBeenCalledWith(USER_ID, {
      limit: 7,
      orderBy: 'importance',
    });
  });

  it('defaults maxMemories to 10', async () => {
    await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(mockMemoryService.listMemories).toHaveBeenCalledWith(USER_ID, {
      limit: 10,
      orderBy: 'importance',
    });
  });

  it('defaults maxGoals to 5', async () => {
    await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(mockGoalService.listGoals).toHaveBeenCalledWith(USER_ID, {
      status: 'active',
      limit: 5,
    });
  });

  it('passes custom maxGoals to listGoals', async () => {
    await buildEnhancedSystemPrompt('Base', { userId: USER_ID, maxGoals: 3 });
    expect(mockGoalService.listGoals).toHaveBeenCalledWith(USER_ID, {
      status: 'active',
      limit: 3,
    });
  });

  // --- Memories section ---

  it('returns memoriesUsed=0 when no memories', async () => {
    const { stats } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(stats.memoriesUsed).toBe(0);
  });

  it('does not add memory section when memories array is empty', async () => {
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).not.toContain('User Context (from memory)');
  });

  it('adds memory section with fact items under Known Facts header', async () => {
    mockMemoryService.listMemories.mockResolvedValue([makeMemory('fact', 'User is a developer')]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('User Context (from memory)');
    expect(prompt).toContain('**Known Facts:**');
    expect(prompt).toContain('User is a developer');
  });

  it('adds preference items under User Preferences header', async () => {
    mockMemoryService.listMemories.mockResolvedValue([
      makeMemory('preference', 'Prefers dark mode'),
    ]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('**User Preferences:**');
    expect(prompt).toContain('Prefers dark mode');
  });

  it('adds event items under Recent Events header', async () => {
    mockMemoryService.listMemories.mockResolvedValue([makeMemory('event', 'Completed a sprint')]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('**Recent Events:**');
    expect(prompt).toContain('Completed a sprint');
  });

  it('groups memories by type correctly', async () => {
    mockMemoryService.listMemories.mockResolvedValue([
      makeMemory('fact', 'fact content'),
      makeMemory('preference', 'pref content'),
      makeMemory('event', 'event content'),
    ]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('**Known Facts:**');
    expect(prompt).toContain('**User Preferences:**');
    expect(prompt).toContain('**Recent Events:**');
    expect(prompt).toContain('fact content');
    expect(prompt).toContain('pref content');
    expect(prompt).toContain('event content');
  });

  it('omits Known Facts header when no facts', async () => {
    mockMemoryService.listMemories.mockResolvedValue([makeMemory('preference', 'only pref')]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).not.toContain('**Known Facts:**');
    expect(prompt).toContain('**User Preferences:**');
  });

  it('returns memoriesUsed equal to memories length', async () => {
    mockMemoryService.listMemories.mockResolvedValue([
      makeMemory('fact', 'a'),
      makeMemory('fact', 'b'),
    ]);
    const { stats } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(stats.memoriesUsed).toBe(2);
  });

  // --- Goals section ---

  it('returns goalsUsed=0 when no goals', async () => {
    const { stats } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(stats.goalsUsed).toBe(0);
  });

  it('does not add goals section when goals array is empty', async () => {
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).not.toContain('## Active Goals');
  });

  it('adds goal with title and progress percentage', async () => {
    const goal = makeGoal('Learn TypeScript', 42);
    mockGoalService.listGoals.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('## Active Goals');
    expect(prompt).toContain('Learn TypeScript');
    expect(prompt).toContain('42%');
  });

  it('rounds goal progress percentage', async () => {
    const goal = makeGoal('Goal', 33.7);
    mockGoalService.listGoals.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('34%');
  });

  it('includes due date when present', async () => {
    const goal = makeGoal('Goal', 50, { dueDate: '2026-03-01' });
    mockGoalService.listGoals.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('due: 2026-03-01');
  });

  it('omits due date when not present', async () => {
    const goal = makeGoal('Goal', 50);
    mockGoalService.listGoals.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).not.toContain('due:');
  });

  it('includes goal description when present', async () => {
    const goal = makeGoal('Goal', 50, { description: 'Master TS generics' });
    mockGoalService.listGoals.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Master TS generics');
  });

  it('fetches goal steps in parallel for multiple goals', async () => {
    const g1 = makeGoal('Goal 1', 10);
    const g2 = makeGoal('Goal 2', 20);
    mockGoalService.listGoals.mockResolvedValue([g1, g2]);
    mockGoalService.getSteps.mockResolvedValue([]);
    await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(mockGoalService.getSteps).toHaveBeenCalledTimes(2);
  });

  it('includes pending steps (up to 3) under Next steps', async () => {
    const goal = makeGoal('Goal', 0);
    mockGoalService.listGoals.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([
      makeStep('Step A', 'pending'),
      makeStep('Step B', 'in_progress'),
      makeStep('Step C', 'pending'),
      makeStep('Step D', 'pending'), // 4th should be truncated
    ]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Next steps:');
    expect(prompt).toContain('Step A');
    expect(prompt).toContain('Step B');
    expect(prompt).toContain('Step C');
    expect(prompt).not.toContain('Step D');
  });

  it('excludes completed steps from Next steps', async () => {
    const goal = makeGoal('Goal', 100);
    mockGoalService.listGoals.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([makeStep('Done step', 'completed')]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).not.toContain('Next steps:');
    expect(prompt).not.toContain('Done step');
  });

  it('handles getSteps rejection by falling back to empty array', async () => {
    const goal = makeGoal('Goal', 50);
    mockGoalService.listGoals.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockRejectedValue(new Error('DB down'));
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('## Active Goals');
    expect(prompt).toContain('Goal');
    expect(prompt).not.toContain('Next steps:');
  });

  it('returns goalsUsed equal to goals length', async () => {
    mockGoalService.listGoals.mockResolvedValue([makeGoal('G1', 10), makeGoal('G2', 20)]);
    mockGoalService.getSteps.mockResolvedValue([]);
    const { stats } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(stats.goalsUsed).toBe(2);
  });

  // --- Resources section ---

  it('does not add resources section when summary is empty', async () => {
    mockResourceSummary.mockReturnValue([]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).not.toContain('## Available Data Resources');
  });

  it('adds resources section with display name, name, description, capabilities', async () => {
    mockResourceSummary.mockReturnValue([
      {
        name: 'task',
        displayName: 'Tasks',
        description: 'User task manager',
        capabilities: ['create', 'read', 'list'],
      },
    ]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('## Available Data Resources');
    expect(prompt).toContain('**Tasks**');
    expect(prompt).toContain('`task`');
    expect(prompt).toContain('User task manager');
    expect(prompt).toContain('create, read, list');
  });

  it('includes multiple resources', async () => {
    mockResourceSummary.mockReturnValue([
      { name: 'task', displayName: 'Tasks', description: 'Tasks', capabilities: ['create'] },
      { name: 'note', displayName: 'Notes', description: 'Notes', capabilities: ['read'] },
    ]);
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Tasks');
    expect(prompt).toContain('Notes');
  });

  // --- Autonomy section ---

  it('always includes Autonomy Level section', async () => {
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('## Autonomy Level:');
  });

  it('uses level name "Manual" for level 0', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 0,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('## Autonomy Level: Manual');
  });

  it('uses level name "Assisted" for level 1', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 1,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('## Autonomy Level: Assisted');
  });

  it('uses level name "Supervised" for level 2', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('## Autonomy Level: Supervised');
  });

  it('uses level name "Autonomous" for level 3', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 3,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('## Autonomy Level: Autonomous');
  });

  it('uses level name "Full" for level 4', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 4,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('## Autonomy Level: Full');
  });

  it('uses "Unknown" level name for out-of-range level', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 99,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('## Autonomy Level: Unknown');
  });

  it('includes level 0 behavior text', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 0,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Ask for explicit permission before taking any action.');
  });

  it('includes level 1 behavior text', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 1,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Perform read-only operations freely');
  });

  it('includes level 2 behavior text', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Perform most operations freely');
  });

  it('includes level 3 behavior text', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 3,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Operate autonomously');
  });

  it('includes level 4 behavior text', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 4,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Full autonomy');
  });

  it('falls back to level 2 behavior text for unknown level', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 99,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Perform most operations freely');
  });

  it('shows correct daily budget remaining', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 20,
      dailySpend: 7.5,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Daily budget remaining: $12.50');
  });

  it('shows $0.00 when budget is exhausted', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 10,
      dailySpend: 10,
      allowedTools: [],
      blockedTools: [],
    });
    const { prompt } = await buildEnhancedSystemPrompt('Base', { userId: USER_ID });
    expect(prompt).toContain('Daily budget remaining: $0.00');
  });

  // --- Full integration shape ---

  it('builds a complete prompt with all sections present', async () => {
    mockMemoryService.listMemories.mockResolvedValue([makeMemory('fact', 'fact A')]);
    mockGoalService.listGoals.mockResolvedValue([makeGoal('Goal X', 25)]);
    mockGoalService.getSteps.mockResolvedValue([makeStep('Step 1')]);
    mockResourceSummary.mockReturnValue([
      { name: 'note', displayName: 'Notes', description: 'Notes', capabilities: ['read'] },
    ]);
    const { prompt, stats } = await buildEnhancedSystemPrompt('System base', { userId: USER_ID });
    expect(prompt).toContain('System base');
    expect(prompt).toContain('User Context (from memory)');
    expect(prompt).toContain('## Active Goals');
    expect(prompt).toContain('## Available Data Resources');
    expect(prompt).toContain('## Autonomy Level:');
    expect(stats.memoriesUsed).toBe(1);
    expect(stats.goalsUsed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// checkToolCallApproval
// ---------------------------------------------------------------------------

describe('checkToolCallApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 10,
      dailySpend: 3,
      allowedTools: [],
      blockedTools: [],
    });
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
  });

  // --- No approval required ---

  it('auto-approves when risk.requiresApproval is false', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    const result = await checkToolCallApproval(USER_ID, makeToolCall('fetch_url'));
    expect(result.approved).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('returns risk object in result', async () => {
    const risk = { level: 'low' as const, requiresApproval: false };
    vi.mocked(assessRisk).mockReturnValue(risk as ReturnType<typeof assessRisk>);
    const result = await checkToolCallApproval(USER_ID, makeToolCall('fetch_url'));
    expect(result.risk).toBeDefined();
  });

  // --- allowedTools ---

  it('auto-approves tool in allowedTools even if requiresApproval=true', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'high', requiresApproval: true } as ReturnType<
      typeof assessRisk
    >);
    mockGetUserConfig.mockReturnValue({
      level: 0,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: ['execute_code'],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('execute_code'));
    expect(result.approved).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('does not auto-approve tool not in allowedTools', async () => {
    vi.mocked(assessRisk).mockReturnValue({
      level: 'critical',
      requiresApproval: true,
    } as ReturnType<typeof assessRisk>);
    mockGetUserConfig.mockReturnValue({
      level: 0,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: ['other_tool'],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('make_payment'));
    expect(result.approved).toBe(false);
  });

  // --- blockedTools ---

  it('blocks tool in blockedTools with a reason', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: true } as ReturnType<
      typeof assessRisk
    >);
    mockGetUserConfig.mockReturnValue({
      level: 3,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: ['send_email'],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('send_email'));
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('blocked');
    expect(result.reason).toContain('send_email');
  });

  it('includes requiresApproval=true for blocked tool', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: true } as ReturnType<
      typeof assessRisk
    >);
    mockGetUserConfig.mockReturnValue({
      level: 3,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: ['send_email'],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('send_email'));
    expect(result.requiresApproval).toBe(true);
  });

  // --- Level >= 2 (Supervised) ---

  it('level 2 + medium risk + requiresApproval=true → auto-approve', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'medium', requiresApproval: true } as ReturnType<
      typeof assessRisk
    >);
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('fetch_url'));
    expect(result.approved).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('level 2 + low risk → auto-approve', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: true } as ReturnType<
      typeof assessRisk
    >);
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('fetch_url'));
    expect(result.approved).toBe(true);
  });

  it('level 2 + high risk → requires approval', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'high', requiresApproval: true } as ReturnType<
      typeof assessRisk
    >);
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('make_payment'));
    expect(result.approved).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('level 2 + critical risk → requires approval', async () => {
    vi.mocked(assessRisk).mockReturnValue({
      level: 'critical',
      requiresApproval: true,
    } as ReturnType<typeof assessRisk>);
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('make_payment'));
    expect(result.approved).toBe(false);
  });

  // --- Level >= 3 (Autonomous) ---

  it('level 3 + high risk → auto-approve', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'high', requiresApproval: true } as ReturnType<
      typeof assessRisk
    >);
    mockGetUserConfig.mockReturnValue({
      level: 3,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('execute_code'));
    expect(result.approved).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('level 3 + critical risk → requires approval', async () => {
    vi.mocked(assessRisk).mockReturnValue({
      level: 'critical',
      requiresApproval: true,
    } as ReturnType<typeof assessRisk>);
    mockGetUserConfig.mockReturnValue({
      level: 3,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('make_payment'));
    expect(result.approved).toBe(false);
  });

  // --- Level >= 4 (Full) ---

  it('level 4 + high risk → auto-approve', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'high', requiresApproval: true } as ReturnType<
      typeof assessRisk
    >);
    mockGetUserConfig.mockReturnValue({
      level: 4,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('execute_code'));
    expect(result.approved).toBe(true);
  });

  it('level 4 + critical risk → still requires approval', async () => {
    vi.mocked(assessRisk).mockReturnValue({
      level: 'critical',
      requiresApproval: true,
    } as ReturnType<typeof assessRisk>);
    mockGetUserConfig.mockReturnValue({
      level: 4,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('transfer_funds'));
    expect(result.approved).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  // --- Level 0 / 1 ---

  it('level 0 + any risk requiring approval → requires approval', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'medium', requiresApproval: true } as ReturnType<
      typeof assessRisk
    >);
    mockGetUserConfig.mockReturnValue({
      level: 0,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('fetch_url'));
    expect(result.approved).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it('level 1 + high risk requiring approval → requires approval', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'high', requiresApproval: true } as ReturnType<
      typeof assessRisk
    >);
    mockGetUserConfig.mockReturnValue({
      level: 1,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('send_email'));
    expect(result.approved).toBe(false);
  });

  it('approval reason includes tool name and risk level', async () => {
    vi.mocked(assessRisk).mockReturnValue({
      level: 'critical',
      requiresApproval: true,
    } as ReturnType<typeof assessRisk>);
    mockGetUserConfig.mockReturnValue({
      level: 0,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const result = await checkToolCallApproval(USER_ID, makeToolCall('make_payment'));
    expect(result.reason).toContain('make_payment');
    expect(result.reason).toContain('critical');
  });

  // --- safeJsonParse (tested via arguments parsing) ---

  it('handles malformed JSON arguments gracefully (safeJsonParse fallback)', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    const tc = makeToolCall('fetch_url', '{not valid json}');
    await expect(checkToolCallApproval(USER_ID, tc)).resolves.toMatchObject({ approved: true });
    // assessRisk was called with the fallback empty object
    expect(assessRisk).toHaveBeenCalled();
    const callArgs = vi.mocked(assessRisk).mock.calls[0]!;
    expect(callArgs[2]).toEqual({});
  });

  it('passes valid JSON arguments to assessRisk', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    const tc = makeToolCall('fetch_url', '{"url":"https://example.com"}');
    await checkToolCallApproval(USER_ID, tc);
    const callArgs = vi.mocked(assessRisk).mock.calls[0]!;
    expect(callArgs[2]).toEqual({ url: 'https://example.com' });
  });

  it('handles empty string arguments with fallback', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    const tc = { id: 'tc', name: 'fetch_url', arguments: '' };
    await expect(checkToolCallApproval(USER_ID, tc)).resolves.toMatchObject({ approved: true });
    const callArgs = vi.mocked(assessRisk).mock.calls[0]!;
    expect(callArgs[2]).toEqual({});
  });

  it('handles undefined arguments with fallback', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    const tc = { id: 'tc', name: 'fetch_url', arguments: undefined as unknown as string };
    await expect(checkToolCallApproval(USER_ID, tc)).resolves.toMatchObject({ approved: true });
  });

  // --- mapToolToCategory (tested indirectly via assessRisk first arg) ---

  it('maps create_memory to data_modification', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    await checkToolCallApproval(USER_ID, makeToolCall('create_memory'));
    expect(assessRisk).toHaveBeenCalledWith(
      'data_modification',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('maps delete_memory to data_modification', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    await checkToolCallApproval(USER_ID, makeToolCall('delete_memory'));
    expect(assessRisk).toHaveBeenCalledWith(
      'data_modification',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('maps send_email to external_communication', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    await checkToolCallApproval(USER_ID, makeToolCall('send_email'));
    expect(assessRisk).toHaveBeenCalledWith(
      'external_communication',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('maps send_notification to external_communication', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    await checkToolCallApproval(USER_ID, makeToolCall('send_notification'));
    expect(assessRisk).toHaveBeenCalledWith(
      'external_communication',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('maps fetch_url to api_call', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    await checkToolCallApproval(USER_ID, makeToolCall('fetch_url'));
    expect(assessRisk).toHaveBeenCalledWith(
      'api_call',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('maps execute_code to system_command', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    await checkToolCallApproval(USER_ID, makeToolCall('execute_code'));
    expect(assessRisk).toHaveBeenCalledWith(
      'system_command',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('maps file_write to file_operation', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    await checkToolCallApproval(USER_ID, makeToolCall('file_write'));
    expect(assessRisk).toHaveBeenCalledWith(
      'file_operation',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('maps make_payment to financial', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    await checkToolCallApproval(USER_ID, makeToolCall('make_payment'));
    expect(assessRisk).toHaveBeenCalledWith(
      'financial',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('maps unknown tool to tool_execution', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    await checkToolCallApproval(USER_ID, makeToolCall('completely_unknown_tool'));
    expect(assessRisk).toHaveBeenCalledWith(
      'tool_execution',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('resolves namespaced tool via getBaseName fallback (e.g. plugin.send_email)', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    // getBaseName mock returns last segment: 'send_email'
    await checkToolCallApproval(USER_ID, makeToolCall('plugin.abc.send_email'));
    expect(assessRisk).toHaveBeenCalledWith(
      'external_communication',
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('uses default context {} when not provided', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    await checkToolCallApproval(USER_ID, makeToolCall('fetch_url'));
    const callArgs = vi.mocked(assessRisk).mock.calls[0]!;
    // context param is 4th argument (index 3)
    expect(callArgs[3]).toEqual({});
  });

  it('forwards provided context to assessRisk', async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: 'low', requiresApproval: false } as ReturnType<
      typeof assessRisk
    >);
    const ctx = { conversationId: 'conv-1', agentId: 'agent-1' };
    await checkToolCallApproval(USER_ID, makeToolCall('fetch_url'), ctx);
    const callArgs = vi.mocked(assessRisk).mock.calls[0]!;
    expect(callArgs[3]).toEqual(ctx);
  });
});

// ---------------------------------------------------------------------------
// evaluateTriggers
// ---------------------------------------------------------------------------

describe('evaluateTriggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerService.listTriggers.mockResolvedValue([]);
    mockFireTrigger.mockResolvedValue({ success: true });
    mockTriggerEmit.mockResolvedValue(undefined);
  });

  it('returns empty arrays when no triggers', async () => {
    const result = await evaluateTriggers(USER_ID, 'hello', 'response');
    expect(result).toEqual({ triggered: [], pending: [], executed: [] });
  });

  it('always emits chat_completed event at the end', async () => {
    await evaluateTriggers(USER_ID, 'msg', 'resp');
    expect(mockTriggerEmit).toHaveBeenCalledWith('chat_completed', {
      userId: USER_ID,
      messageLength: 3,
      responseLength: 4,
    });
  });

  it('emits chat_completed with correct message and response lengths', async () => {
    await evaluateTriggers(USER_ID, 'hello world', 'great response here');
    expect(mockTriggerEmit).toHaveBeenCalledWith('chat_completed', {
      userId: USER_ID,
      messageLength: 11,
      responseLength: 'great response here'.length, // 19
    });
  });

  // --- condition trigger: message_contains ---

  it('fires condition trigger when message contains keyword', async () => {
    const trigger = makeTrigger('condition', { condition: 'message_contains: urgent' }, 't-1');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    const result = await evaluateTriggers(USER_ID, 'this is urgent help', 'ok');
    expect(result.triggered).toContain('t-1');
  });

  it('does not fire condition trigger when message does not contain keyword', async () => {
    const trigger = makeTrigger('condition', { condition: 'message_contains: urgent' }, 't-1');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    const result = await evaluateTriggers(USER_ID, 'nothing special', 'ok');
    expect(result.triggered).not.toContain('t-1');
  });

  it('message_contains keyword matching is case-insensitive', async () => {
    const trigger = makeTrigger('condition', { condition: 'message_contains: URGENT' }, 't-1');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    const result = await evaluateTriggers(USER_ID, 'this is urgent', 'ok');
    expect(result.triggered).toContain('t-1');
  });

  // --- condition trigger: response_contains ---

  it('fires condition trigger when response contains keyword', async () => {
    const trigger = makeTrigger('condition', { condition: 'response_contains: error' }, 't-2');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    const result = await evaluateTriggers(
      USER_ID,
      'what happened',
      'there was an error in the system'
    );
    expect(result.triggered).toContain('t-2');
  });

  it('does not fire response_contains when response does not match', async () => {
    const trigger = makeTrigger('condition', { condition: 'response_contains: failure' }, 't-2');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    const result = await evaluateTriggers(USER_ID, 'what happened', 'everything is fine');
    expect(result.triggered).not.toContain('t-2');
  });

  it('response_contains keyword matching is case-insensitive', async () => {
    const trigger = makeTrigger('condition', { condition: 'response_contains: ERROR' }, 't-2');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    const result = await evaluateTriggers(USER_ID, 'any', 'there was an error here');
    expect(result.triggered).toContain('t-2');
  });

  // --- event trigger: chat_completed ---

  it('fires event trigger with eventType=chat_completed', async () => {
    const trigger = makeTrigger('event', { eventType: 'chat_completed' }, 't-3');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    const result = await evaluateTriggers(USER_ID, 'msg', 'resp');
    expect(result.triggered).toContain('t-3');
  });

  it('does not fire event trigger with different eventType', async () => {
    const trigger = makeTrigger('event', { eventType: 'user_login' }, 't-3');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    const result = await evaluateTriggers(USER_ID, 'msg', 'resp');
    expect(result.triggered).not.toContain('t-3');
  });

  // --- executed vs pending ---

  it('adds to executed when fireTrigger returns success=true', async () => {
    const trigger = makeTrigger('event', { eventType: 'chat_completed' }, 't-exec');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    mockFireTrigger.mockResolvedValue({ success: true });
    const result = await evaluateTriggers(USER_ID, 'msg', 'resp');
    expect(result.executed).toContain('t-exec');
    expect(result.pending).not.toContain('t-exec');
  });

  it('adds to pending when fireTrigger returns success=false', async () => {
    const trigger = makeTrigger('event', { eventType: 'chat_completed' }, 't-fail');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    mockFireTrigger.mockResolvedValue({ success: false });
    const result = await evaluateTriggers(USER_ID, 'msg', 'resp');
    expect(result.pending).toContain('t-fail');
    expect(result.executed).not.toContain('t-fail');
  });

  it('adds to pending when fireTrigger throws', async () => {
    const trigger = makeTrigger('event', { eventType: 'chat_completed' }, 't-throw');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    mockFireTrigger.mockRejectedValue(new Error('Network error'));
    const result = await evaluateTriggers(USER_ID, 'msg', 'resp');
    expect(result.pending).toContain('t-throw');
    expect(result.executed).not.toContain('t-throw');
  });

  it('does not throw when fireTrigger throws', async () => {
    const trigger = makeTrigger('event', { eventType: 'chat_completed' }, 't-throw');
    mockTriggerService.listTriggers.mockResolvedValue([trigger]);
    mockFireTrigger.mockRejectedValue(new Error('oops'));
    await expect(evaluateTriggers(USER_ID, 'msg', 'resp')).resolves.toBeDefined();
  });

  it('handles multiple triggers independently', async () => {
    const t1 = makeTrigger('event', { eventType: 'chat_completed' }, 't-a');
    const t2 = makeTrigger('condition', { condition: 'message_contains: hello' }, 't-b');
    const t3 = makeTrigger('condition', { condition: 'message_contains: goodbye' }, 't-c');
    mockTriggerService.listTriggers.mockResolvedValue([t1, t2, t3]);
    mockFireTrigger.mockResolvedValue({ success: true });
    const result = await evaluateTriggers(USER_ID, 'hello world', 'resp');
    expect(result.triggered).toContain('t-a');
    expect(result.triggered).toContain('t-b');
    expect(result.triggered).not.toContain('t-c');
    expect(result.executed).toContain('t-a');
    expect(result.executed).toContain('t-b');
  });

  it('calls listTriggers with enabled=true', async () => {
    await evaluateTriggers(USER_ID, 'msg', 'resp');
    expect(mockTriggerService.listTriggers).toHaveBeenCalledWith(USER_ID, { enabled: true });
  });
});

// ---------------------------------------------------------------------------
// extractMemories
// ---------------------------------------------------------------------------

describe('extractMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractMemoriesFromResponse.mockReturnValue({ memories: [] });
    mockMemoryService.batchRemember.mockResolvedValue({ created: 0 });
  });

  it('returns 0 when no memories extracted', async () => {
    mockExtractMemoriesFromResponse.mockReturnValue({ memories: [] });
    const count = await extractMemories(USER_ID, 'user msg', 'response');
    expect(count).toBe(0);
  });

  it('does not call batchRemember when no memories', async () => {
    mockExtractMemoriesFromResponse.mockReturnValue({ memories: [] });
    await extractMemories(USER_ID, 'user msg', 'response');
    expect(mockMemoryService.batchRemember).not.toHaveBeenCalled();
  });

  it('calls batchRemember with correct shape for each memory', async () => {
    mockExtractMemoriesFromResponse.mockReturnValue({
      memories: [{ type: 'fact', content: 'User likes coffee', importance: 0.9 }],
    });
    mockMemoryService.batchRemember.mockResolvedValue({ created: 1 });
    await extractMemories(USER_ID, 'user msg', 'response');
    expect(mockMemoryService.batchRemember).toHaveBeenCalledWith(USER_ID, [
      { type: 'fact', content: 'User likes coffee', source: 'conversation', importance: 0.9 },
    ]);
  });

  it('defaults importance to 0.7 when not provided', async () => {
    mockExtractMemoriesFromResponse.mockReturnValue({
      memories: [{ type: 'preference', content: 'Prefers TypeScript' }],
    });
    mockMemoryService.batchRemember.mockResolvedValue({ created: 1 });
    await extractMemories(USER_ID, 'user msg', 'response');
    const callArg = mockMemoryService.batchRemember.mock.calls[0]![1];
    expect(callArg[0].importance).toBe(0.7);
  });

  it('sets source to "conversation" for all memories', async () => {
    mockExtractMemoriesFromResponse.mockReturnValue({
      memories: [
        { type: 'fact', content: 'fact 1' },
        { type: 'event', content: 'event 1', importance: 0.5 },
      ],
    });
    mockMemoryService.batchRemember.mockResolvedValue({ created: 2 });
    await extractMemories(USER_ID, 'user msg', 'response');
    const callArg = mockMemoryService.batchRemember.mock.calls[0]![1];
    expect(callArg[0].source).toBe('conversation');
    expect(callArg[1].source).toBe('conversation');
  });

  it('returns result.created count from batchRemember', async () => {
    mockExtractMemoriesFromResponse.mockReturnValue({
      memories: [
        { type: 'fact', content: 'a' },
        { type: 'fact', content: 'b' },
        { type: 'fact', content: 'c' },
      ],
    });
    mockMemoryService.batchRemember.mockResolvedValue({ created: 3 });
    const count = await extractMemories(USER_ID, 'user msg', 'response');
    expect(count).toBe(3);
  });

  it('passes response to extractMemoriesFromResponse', async () => {
    const response = 'AI said something <memories>...</memories>';
    mockExtractMemoriesFromResponse.mockReturnValue({ memories: [] });
    await extractMemories(USER_ID, 'user msg', response);
    expect(mockExtractMemoriesFromResponse).toHaveBeenCalledWith(response);
  });

  it('handles multiple memories with mixed importance values', async () => {
    mockExtractMemoriesFromResponse.mockReturnValue({
      memories: [
        { type: 'fact', content: 'explicit importance', importance: 0.95 },
        { type: 'preference', content: 'no importance' },
      ],
    });
    mockMemoryService.batchRemember.mockResolvedValue({ created: 2 });
    await extractMemories(USER_ID, 'msg', 'resp');
    const callArg = mockMemoryService.batchRemember.mock.calls[0]![1];
    expect(callArg[0].importance).toBe(0.95);
    expect(callArg[1].importance).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------
// updateGoalProgress
// ---------------------------------------------------------------------------

describe('updateGoalProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoalService.getActive.mockResolvedValue([]);
    mockGoalService.getSteps.mockResolvedValue([]);
    mockGoalService.completeStep.mockResolvedValue(undefined);
  });

  it('does nothing when no active goals', async () => {
    mockGoalService.getActive.mockResolvedValue([]);
    await updateGoalProgress(USER_ID, 'msg', 'response');
    expect(mockGoalService.completeStep).not.toHaveBeenCalled();
  });

  it('calls completeStep when step title and "completed" keyword found in response', async () => {
    const goal = { id: 'g-1', title: 'Learn TS' };
    const step = makeStep('Write tests', 'pending');
    mockGoalService.getActive.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([step]);
    const response = 'I have completed the Write tests task';
    await updateGoalProgress(USER_ID, 'msg', response);
    expect(mockGoalService.completeStep).toHaveBeenCalledWith(USER_ID, step.id);
  });

  it('calls completeStep when "done" keyword found in response', async () => {
    const goal = { id: 'g-1', title: 'Project' };
    const step = makeStep('Deploy to prod', 'pending');
    mockGoalService.getActive.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([step]);
    await updateGoalProgress(USER_ID, 'msg', 'Deploy to prod is done now');
    expect(mockGoalService.completeStep).toHaveBeenCalledWith(USER_ID, step.id);
  });

  it('calls completeStep when "finished" keyword found in response', async () => {
    const goal = { id: 'g-1', title: 'Project' };
    const step = makeStep('Write docs', 'in_progress');
    mockGoalService.getActive.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([step]);
    await updateGoalProgress(USER_ID, 'msg', 'I finished Write docs earlier today');
    expect(mockGoalService.completeStep).toHaveBeenCalledWith(USER_ID, step.id);
  });

  it('does not call completeStep when step title not mentioned in response', async () => {
    const goal = { id: 'g-1', title: 'Project' };
    const step = makeStep('Refactor auth module', 'pending');
    mockGoalService.getActive.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([step]);
    await updateGoalProgress(USER_ID, 'msg', 'I wrote some tests and it is done');
    expect(mockGoalService.completeStep).not.toHaveBeenCalled();
  });

  it('does not call completeStep when title mentioned but no completion keyword', async () => {
    const goal = { id: 'g-1', title: 'Project' };
    const step = makeStep('Deploy to prod', 'pending');
    mockGoalService.getActive.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([step]);
    await updateGoalProgress(USER_ID, 'msg', 'Deploy to prod is still in progress');
    expect(mockGoalService.completeStep).not.toHaveBeenCalled();
  });

  it('step title matching is case-insensitive', async () => {
    const goal = { id: 'g-1', title: 'Project' };
    const step = makeStep('Write Unit Tests', 'pending');
    mockGoalService.getActive.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([step]);
    await updateGoalProgress(USER_ID, 'msg', 'write unit tests is completed!');
    expect(mockGoalService.completeStep).toHaveBeenCalledWith(USER_ID, step.id);
  });

  it('ignores completed steps', async () => {
    const goal = { id: 'g-1', title: 'Project' };
    const step = makeStep('Already done step', 'completed');
    mockGoalService.getActive.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([step]);
    await updateGoalProgress(USER_ID, 'msg', 'Already done step is completed and finished');
    expect(mockGoalService.completeStep).not.toHaveBeenCalled();
  });

  it('handles multiple active goals', async () => {
    const g1 = { id: 'g-1', title: 'Goal A' };
    const g2 = { id: 'g-2', title: 'Goal B' };
    const step1 = makeStep('Step in Goal A', 'pending');
    const step2 = makeStep('Step in Goal B', 'pending');
    mockGoalService.getActive.mockResolvedValue([g1, g2]);
    mockGoalService.getSteps.mockResolvedValueOnce([step1]).mockResolvedValueOnce([step2]);
    const response = 'Step in Goal A is completed and Step in Goal B is done';
    await updateGoalProgress(USER_ID, 'msg', response);
    expect(mockGoalService.completeStep).toHaveBeenCalledTimes(2);
    expect(mockGoalService.completeStep).toHaveBeenCalledWith(USER_ID, step1.id);
    expect(mockGoalService.completeStep).toHaveBeenCalledWith(USER_ID, step2.id);
  });

  it('processes in_progress steps', async () => {
    const goal = { id: 'g-1', title: 'Project' };
    const step = makeStep('In progress step', 'in_progress');
    mockGoalService.getActive.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([step]);
    await updateGoalProgress(USER_ID, 'msg', 'In progress step is finished');
    expect(mockGoalService.completeStep).toHaveBeenCalledWith(USER_ID, step.id);
  });

  it('only completes matching steps and skips non-matching', async () => {
    const goal = { id: 'g-1', title: 'Project' };
    const stepA = makeStep('Write tests', 'pending');
    const stepB = makeStep('Deploy app', 'pending');
    mockGoalService.getActive.mockResolvedValue([goal]);
    mockGoalService.getSteps.mockResolvedValue([stepA, stepB]);
    await updateGoalProgress(USER_ID, 'msg', 'Write tests is completed!');
    expect(mockGoalService.completeStep).toHaveBeenCalledTimes(1);
    expect(mockGoalService.completeStep).toHaveBeenCalledWith(USER_ID, stepA.id);
  });
});

// ---------------------------------------------------------------------------
// getOrchestratorStats
// ---------------------------------------------------------------------------

describe('getOrchestratorStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryService.getStats.mockResolvedValue({ total: 0 });
    mockGoalService.getActive.mockResolvedValue([]);
    mockTriggerService.listTriggers.mockResolvedValue([]);
    mockGetUserConfig.mockReturnValue({
      level: 2,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    mockGetPendingActions.mockReturnValue([]);
  });

  it('returns the correct shape', async () => {
    const stats = await getOrchestratorStats(USER_ID);
    expect(stats).toMatchObject({
      totalMemories: expect.any(Number),
      activeGoals: expect.any(Number),
      activeTriggers: expect.any(Number),
      pendingApprovals: expect.any(Number),
      autonomyLevel: expect.any(Number),
    });
  });

  it('returns totalMemories from memoryStats.total', async () => {
    mockMemoryService.getStats.mockResolvedValue({ total: 42 });
    const stats = await getOrchestratorStats(USER_ID);
    expect(stats.totalMemories).toBe(42);
  });

  it('returns activeGoals as length of getActive result', async () => {
    mockGoalService.getActive.mockResolvedValue([
      { id: 'g1', title: 'Goal 1' },
      { id: 'g2', title: 'Goal 2' },
      { id: 'g3', title: 'Goal 3' },
    ]);
    const stats = await getOrchestratorStats(USER_ID);
    expect(stats.activeGoals).toBe(3);
  });

  it('returns activeTriggers as length of listTriggers result', async () => {
    mockTriggerService.listTriggers.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    const stats = await getOrchestratorStats(USER_ID);
    expect(stats.activeTriggers).toBe(2);
  });

  it('returns pendingApprovals as length of getPendingActions result', async () => {
    mockGetPendingActions.mockReturnValue([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
    const stats = await getOrchestratorStats(USER_ID);
    expect(stats.pendingApprovals).toBe(3);
  });

  it('returns autonomyLevel from user config', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 3,
      dailyBudget: 10,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const stats = await getOrchestratorStats(USER_ID);
    expect(stats.autonomyLevel).toBe(3);
  });

  it('calls getStats, getActive, listTriggers in parallel (all called once)', async () => {
    await getOrchestratorStats(USER_ID);
    expect(mockMemoryService.getStats).toHaveBeenCalledTimes(1);
    expect(mockGoalService.getActive).toHaveBeenCalledTimes(1);
    expect(mockTriggerService.listTriggers).toHaveBeenCalledTimes(1);
  });

  it('calls getStats with userId', async () => {
    await getOrchestratorStats(USER_ID);
    expect(mockMemoryService.getStats).toHaveBeenCalledWith(USER_ID);
  });

  it('calls getActive with userId', async () => {
    await getOrchestratorStats(USER_ID);
    expect(mockGoalService.getActive).toHaveBeenCalledWith(USER_ID);
  });

  it('calls listTriggers with enabled=true filter', async () => {
    await getOrchestratorStats(USER_ID);
    expect(mockTriggerService.listTriggers).toHaveBeenCalledWith(USER_ID, { enabled: true });
  });

  it('calls getPendingActions with userId', async () => {
    await getOrchestratorStats(USER_ID);
    expect(mockGetPendingActions).toHaveBeenCalledWith(USER_ID);
  });

  it('returns 0 counts when all services return empty', async () => {
    const stats = await getOrchestratorStats(USER_ID);
    expect(stats.totalMemories).toBe(0);
    expect(stats.activeGoals).toBe(0);
    expect(stats.activeTriggers).toBe(0);
    expect(stats.pendingApprovals).toBe(0);
  });

  it('returns autonomyLevel 0 for manual config', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 0,
      dailyBudget: 5,
      dailySpend: 0,
      allowedTools: [],
      blockedTools: [],
    });
    const stats = await getOrchestratorStats(USER_ID);
    expect(stats.autonomyLevel).toBe(0);
  });

  it('returns autonomyLevel 4 for full autonomy config', async () => {
    mockGetUserConfig.mockReturnValue({
      level: 4,
      dailyBudget: 100,
      dailySpend: 50,
      allowedTools: [],
      blockedTools: [],
    });
    const stats = await getOrchestratorStats(USER_ID);
    expect(stats.autonomyLevel).toBe(4);
  });
});
