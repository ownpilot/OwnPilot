/**
 * Background Agent Tools Tests
 *
 * Tests for all 4 background-agent LLM-callable tools:
 * - spawn_background_agent
 * - list_background_agents
 * - stop_background_agent
 * - send_message_to_agent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  createAgent: vi.fn(),
  startAgent: vi.fn(),
  listAgents: vi.fn(),
  listSessions: vi.fn(),
  stopAgent: vi.fn(),
  sendMessage: vi.fn(),
};

vi.mock('../services/background-agent-service.js', () => ({
  getBackgroundAgentService: () => mockService,
}));

vi.mock('@ownpilot/core', async () => {
  const actual = await vi.importActual<typeof import('@ownpilot/core')>('@ownpilot/core');
  return {
    ...actual,
    getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  };
});

const { executeBackgroundAgentTool, BACKGROUND_AGENT_TOOLS } =
  await import('./background-agent-tools.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bg-1',
    userId: 'user-1',
    name: 'Goal Monitor',
    mission: 'Monitor user goals and report progress every cycle.',
    mode: 'interval',
    allowedTools: [],
    limits: { maxCycles: 100, maxToolCallsPerCycle: 20, cycleTimeoutMs: 60000 },
    intervalMs: 300000,
    autoStart: false,
    createdBy: 'ai',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    config: makeConfig(),
    state: 'running',
    cyclesCompleted: 3,
    totalToolCalls: 12,
    lastCycleAt: new Date('2026-03-05T10:00:00Z'),
    lastCycleError: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

describe('BACKGROUND_AGENT_TOOLS', () => {
  it('exports 4 tool definitions', () => {
    expect(BACKGROUND_AGENT_TOOLS).toHaveLength(4);
  });

  it('all tools have category Background Agents', () => {
    for (const tool of BACKGROUND_AGENT_TOOLS) {
      expect(tool.category).toBe('Background Agents');
    }
  });

  it('all tools are workflow-usable', () => {
    for (const tool of BACKGROUND_AGENT_TOOLS) {
      expect(tool.workflowUsable).toBe(true);
    }
  });

  it('exports expected tool names', () => {
    const names = BACKGROUND_AGENT_TOOLS.map((t) => t.name);
    expect(names).toContain('spawn_background_agent');
    expect(names).toContain('list_background_agents');
    expect(names).toContain('stop_background_agent');
    expect(names).toContain('send_message_to_agent');
  });
});

// ---------------------------------------------------------------------------
// executeBackgroundAgentTool
// ---------------------------------------------------------------------------

describe('executeBackgroundAgentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // spawn_background_agent
  // -------------------------------------------------------------------------

  describe('spawn_background_agent', () => {
    it('creates and starts an agent, returning its info', async () => {
      const config = makeConfig({ id: 'bg-42', name: 'Email Drafter', mode: 'interval' });
      const session = makeSession({ config, state: 'running' });
      mockService.createAgent.mockResolvedValue(config);
      mockService.startAgent.mockResolvedValue(session);

      const result = await executeBackgroundAgentTool(
        'spawn_background_agent',
        { name: 'Email Drafter', mission: 'Draft emails daily' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({
          agentId: 'bg-42',
          name: 'Email Drafter',
          mode: 'interval',
          state: 'running',
        })
      );
      expect(mockService.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          name: 'Email Drafter',
          mission: 'Draft emails daily',
          mode: 'interval',
          createdBy: 'ai',
          autoStart: false,
        })
      );
      expect(mockService.startAgent).toHaveBeenCalledWith('bg-42', 'user-1');
    });

    it('converts interval_minutes to intervalMs', async () => {
      const config = makeConfig({ intervalMs: 600000 });
      const session = makeSession({ config, state: 'running' });
      mockService.createAgent.mockResolvedValue(config);
      mockService.startAgent.mockResolvedValue(session);

      await executeBackgroundAgentTool(
        'spawn_background_agent',
        { name: 'Monitor', mission: 'Watch metrics', interval_minutes: 10 },
        'user-1'
      );

      expect(mockService.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({ intervalMs: 600000 })
      );
    });

    it('passes optional fields: allowed_tools, stop_condition, provider, model', async () => {
      const config = makeConfig();
      const session = makeSession({ config, state: 'running' });
      mockService.createAgent.mockResolvedValue(config);
      mockService.startAgent.mockResolvedValue(session);

      await executeBackgroundAgentTool(
        'spawn_background_agent',
        {
          name: 'Restricted Agent',
          mission: 'Limited scope',
          mode: 'continuous',
          allowed_tools: ['read_memory', 'write_memory'],
          stop_condition: 'max_cycles:50',
          provider: 'anthropic',
          model: 'claude-haiku-3-5-20251022',
        },
        'user-1'
      );

      expect(mockService.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'continuous',
          allowedTools: ['read_memory', 'write_memory'],
          stopCondition: 'max_cycles:50',
          provider: 'anthropic',
          model: 'claude-haiku-3-5-20251022',
        })
      );
    });

    it('uses "default" as userId when not provided', async () => {
      const config = makeConfig({ userId: 'default' });
      const session = makeSession({ config, state: 'running' });
      mockService.createAgent.mockResolvedValue(config);
      mockService.startAgent.mockResolvedValue(session);

      await executeBackgroundAgentTool('spawn_background_agent', {
        name: 'Auto Agent',
        mission: 'Run automatically',
      });

      expect(mockService.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'default' })
      );
    });

    it('returns error when name is missing', async () => {
      const result = await executeBackgroundAgentTool(
        'spawn_background_agent',
        { mission: 'Do work' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('name and mission are required');
    });

    it('returns error when mission is missing', async () => {
      const result = await executeBackgroundAgentTool(
        'spawn_background_agent',
        { name: 'Monitor' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('name and mission are required');
    });

    it('returns error when service throws', async () => {
      mockService.createAgent.mockRejectedValue(new Error('DB unavailable'));

      const result = await executeBackgroundAgentTool(
        'spawn_background_agent',
        { name: 'Monitor', mission: 'Do work' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB unavailable');
    });

    it('includes message with interval info in result', async () => {
      const config = makeConfig({ name: 'Periodic Agent', mode: 'interval' });
      const session = makeSession({ config, state: 'running' });
      mockService.createAgent.mockResolvedValue(config);
      mockService.startAgent.mockResolvedValue(session);

      const result = await executeBackgroundAgentTool(
        'spawn_background_agent',
        { name: 'Periodic Agent', mission: 'Check periodically', interval_minutes: 15 },
        'user-1'
      );

      const res = result.result as { message: string };
      expect(res.message).toContain('15 minutes');
    });
  });

  // -------------------------------------------------------------------------
  // list_background_agents
  // -------------------------------------------------------------------------

  describe('list_background_agents', () => {
    it('returns all agents with their session state', async () => {
      const config1 = makeConfig({ id: 'bg-1', name: 'Agent One' });
      const config2 = makeConfig({ id: 'bg-2', name: 'Agent Two' });
      const session1 = makeSession({ config: config1, state: 'running', cyclesCompleted: 5 });

      mockService.listAgents.mockResolvedValue([config1, config2]);
      mockService.listSessions.mockReturnValue([session1]);

      const result = await executeBackgroundAgentTool('list_background_agents', {}, 'user-1');

      expect(result.success).toBe(true);
      const res = result.result as { count: number; agents: Array<Record<string, unknown>> };
      expect(res.count).toBe(2);
      expect(res.agents).toHaveLength(2);

      // Agent with session
      expect(res.agents[0]).toEqual(
        expect.objectContaining({
          id: 'bg-1',
          name: 'Agent One',
          state: 'running',
          cyclesCompleted: 5,
        })
      );

      // Agent without session defaults to stopped
      expect(res.agents[1]).toEqual(
        expect.objectContaining({
          id: 'bg-2',
          name: 'Agent Two',
          state: 'stopped',
          cyclesCompleted: 0,
          totalToolCalls: 0,
        })
      );
    });

    it('truncates long mission text to 100 characters', async () => {
      const longMission = 'M'.repeat(200);
      const config = makeConfig({ mission: longMission });
      mockService.listAgents.mockResolvedValue([config]);
      mockService.listSessions.mockReturnValue([]);

      const result = await executeBackgroundAgentTool('list_background_agents', {}, 'user-1');

      const res = result.result as { agents: Array<{ mission: string }> };
      expect(res.agents[0].mission.length).toBeLessThanOrEqual(103); // 100 + "..."
      expect(res.agents[0].mission).toContain('...');
    });

    it('returns empty list when no agents', async () => {
      mockService.listAgents.mockResolvedValue([]);
      mockService.listSessions.mockReturnValue([]);

      const result = await executeBackgroundAgentTool('list_background_agents', {}, 'user-1');

      expect(result.success).toBe(true);
      const res = result.result as { count: number; agents: unknown[] };
      expect(res.count).toBe(0);
      expect(res.agents).toHaveLength(0);
    });

    it('uses "default" as userId when not provided', async () => {
      mockService.listAgents.mockResolvedValue([]);
      mockService.listSessions.mockReturnValue([]);

      await executeBackgroundAgentTool('list_background_agents', {});

      expect(mockService.listAgents).toHaveBeenCalledWith('default');
      expect(mockService.listSessions).toHaveBeenCalledWith('default');
    });

    it('returns error when service throws', async () => {
      mockService.listAgents.mockRejectedValue(new Error('Query failed'));

      const result = await executeBackgroundAgentTool('list_background_agents', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Query failed');
    });

    it('includes lastCycleAt as ISO string when present', async () => {
      const config = makeConfig({ id: 'bg-1' });
      const lastCycleAt = new Date('2026-03-05T12:00:00Z');
      const session = makeSession({ config, lastCycleAt });
      mockService.listAgents.mockResolvedValue([config]);
      mockService.listSessions.mockReturnValue([session]);

      const result = await executeBackgroundAgentTool('list_background_agents', {}, 'user-1');

      const res = result.result as { agents: Array<{ lastCycleAt: string | null }> };
      expect(res.agents[0].lastCycleAt).toBe('2026-03-05T12:00:00.000Z');
    });
  });

  // -------------------------------------------------------------------------
  // stop_background_agent
  // -------------------------------------------------------------------------

  describe('stop_background_agent', () => {
    it('stops a running agent successfully', async () => {
      mockService.stopAgent.mockResolvedValue(true);

      const result = await executeBackgroundAgentTool(
        'stop_background_agent',
        { agent_id: 'bg-1' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('bg-1'),
        })
      );
      expect(mockService.stopAgent).toHaveBeenCalledWith('bg-1', 'user-1');
    });

    it('returns error when agent not found or not running', async () => {
      mockService.stopAgent.mockResolvedValue(false);

      const result = await executeBackgroundAgentTool(
        'stop_background_agent',
        { agent_id: 'bg-999' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('bg-999');
      expect(result.error).toContain('not running or not found');
    });

    it('returns error when agent_id is missing', async () => {
      const result = await executeBackgroundAgentTool('stop_background_agent', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('agent_id is required');
    });

    it('returns error when service throws', async () => {
      mockService.stopAgent.mockRejectedValue(new Error('Stop failed'));

      const result = await executeBackgroundAgentTool(
        'stop_background_agent',
        { agent_id: 'bg-1' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stop failed');
    });

    it('uses "default" as userId when not provided', async () => {
      mockService.stopAgent.mockResolvedValue(true);

      await executeBackgroundAgentTool('stop_background_agent', { agent_id: 'bg-1' });

      expect(mockService.stopAgent).toHaveBeenCalledWith('bg-1', 'default');
    });
  });

  // -------------------------------------------------------------------------
  // send_message_to_agent
  // -------------------------------------------------------------------------

  describe('send_message_to_agent', () => {
    it('sends a message to a running agent', async () => {
      mockService.sendMessage.mockResolvedValue(undefined);

      const result = await executeBackgroundAgentTool(
        'send_message_to_agent',
        { agent_id: 'bg-1', message: 'Please stop monitoring goal G-5.' },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('bg-1'),
        })
      );
      expect(mockService.sendMessage).toHaveBeenCalledWith(
        'bg-1',
        'user-1',
        'Please stop monitoring goal G-5.'
      );
    });

    it('returns error when agent_id is missing', async () => {
      const result = await executeBackgroundAgentTool(
        'send_message_to_agent',
        { message: 'Hello' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('agent_id and message are required');
    });

    it('returns error when message is missing', async () => {
      const result = await executeBackgroundAgentTool(
        'send_message_to_agent',
        { agent_id: 'bg-1' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('agent_id and message are required');
    });

    it('returns error when service throws (agent not running)', async () => {
      mockService.sendMessage.mockRejectedValue(new Error('Agent bg-1 is not running'));

      const result = await executeBackgroundAgentTool(
        'send_message_to_agent',
        { agent_id: 'bg-1', message: 'Update' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent bg-1 is not running');
    });

    it('uses "default" as userId when not provided', async () => {
      mockService.sendMessage.mockResolvedValue(undefined);

      await executeBackgroundAgentTool('send_message_to_agent', {
        agent_id: 'bg-1',
        message: 'Hi',
      });

      expect(mockService.sendMessage).toHaveBeenCalledWith('bg-1', 'default', 'Hi');
    });

    it('result message mentions next cycle', async () => {
      mockService.sendMessage.mockResolvedValue(undefined);

      const result = await executeBackgroundAgentTool(
        'send_message_to_agent',
        { agent_id: 'bg-1', message: 'Update config' },
        'user-1'
      );

      const res = result.result as { message: string };
      expect(res.message).toContain('next cycle');
    });
  });

  // -------------------------------------------------------------------------
  // Unknown tool
  // -------------------------------------------------------------------------

  describe('unknown tool', () => {
    it('returns error for an unknown tool name', async () => {
      const result = await executeBackgroundAgentTool('unknown_tool', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });

    it('includes the tool name in the error message', async () => {
      const result = await executeBackgroundAgentTool('bogus_tool', {}, 'user-1');

      expect(result.error).toContain('bogus_tool');
    });
  });
});
