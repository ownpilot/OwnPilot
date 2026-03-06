/**
 * DB Seeds index — seedDefaultAgents / runSeeds Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockAgentsRepo, mockGetDefaultAgents } = vi.hoisted(() => ({
  mockAgentsRepo: {
    getAll: vi.fn(),
    create: vi.fn(),
  },
  mockGetDefaultAgents: vi.fn(),
}));

vi.mock('../repositories/index.js', () => ({
  agentsRepo: mockAgentsRepo,
}));

vi.mock('./default-agents.js', () => ({
  getDefaultAgents: mockGetDefaultAgents,
}));

vi.mock('../../services/log.js', () => ({
  getLog: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { seedDefaultAgents, runSeeds } from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seedDefaultAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when agents already exist', async () => {
    mockAgentsRepo.getAll.mockResolvedValue([{ id: 'existing' }]);
    const result = await seedDefaultAgents();
    expect(result).toBe(0);
    expect(mockAgentsRepo.create).not.toHaveBeenCalled();
  });

  it('returns 0 when no default agents available', async () => {
    mockAgentsRepo.getAll.mockResolvedValue([]);
    mockGetDefaultAgents.mockReturnValue([]);
    const result = await seedDefaultAgents();
    expect(result).toBe(0);
    expect(mockAgentsRepo.create).not.toHaveBeenCalled();
  });

  it('seeds all default agents and returns count', async () => {
    mockAgentsRepo.getAll.mockResolvedValue([]);
    mockGetDefaultAgents.mockReturnValue([
      {
        id: 'agent-1',
        name: 'Agent 1',
        systemPrompt: 'You are Agent 1',
        provider: 'default',
        model: 'default',
        config: { maxTokens: 8192, temperature: 0.7, maxTurns: 20, maxToolCalls: 50 },
      },
      {
        id: 'agent-2',
        name: 'Agent 2',
        systemPrompt: 'You are Agent 2',
        provider: 'default',
        model: 'default',
        config: { maxTokens: 4096, temperature: 0.5, maxTurns: 10, maxToolCalls: 30 },
      },
    ]);
    mockAgentsRepo.create.mockResolvedValue({ id: 'agent-1' });

    const result = await seedDefaultAgents();
    expect(result).toBe(2);
    expect(mockAgentsRepo.create).toHaveBeenCalledTimes(2);
  });

  it('passes correct fields to create', async () => {
    const agentData = {
      id: 'agent-x',
      name: 'Agent X',
      systemPrompt: 'Prompt',
      provider: 'openai',
      model: 'gpt-4',
      config: { maxTokens: 2048, temperature: 0.9, maxTurns: 5, maxToolCalls: 10 },
    };
    mockAgentsRepo.getAll.mockResolvedValue([]);
    mockGetDefaultAgents.mockReturnValue([agentData]);
    mockAgentsRepo.create.mockResolvedValue(agentData);

    await seedDefaultAgents();

    expect(mockAgentsRepo.create).toHaveBeenCalledWith({
      id: agentData.id,
      name: agentData.name,
      systemPrompt: agentData.systemPrompt,
      provider: agentData.provider,
      model: agentData.model,
      config: agentData.config,
    });
  });

  it('continues seeding after individual agent failure', async () => {
    mockAgentsRepo.getAll.mockResolvedValue([]);
    mockGetDefaultAgents.mockReturnValue([
      { id: 'a1', name: 'A1', systemPrompt: '', provider: 'default', model: 'default', config: {} },
      { id: 'a2', name: 'A2', systemPrompt: '', provider: 'default', model: 'default', config: {} },
      { id: 'a3', name: 'A3', systemPrompt: '', provider: 'default', model: 'default', config: {} },
    ]);
    mockAgentsRepo.create
      .mockResolvedValueOnce({ id: 'a1' })
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({ id: 'a3' });

    const result = await seedDefaultAgents();
    // 2 succeeded, 1 failed
    expect(result).toBe(2);
  });
});

describe('runSeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls seedDefaultAgents', () => {
    // runSeeds fires async without await — just ensure it doesn't throw sync
    mockAgentsRepo.getAll.mockResolvedValue([{ id: 'existing' }]);
    expect(() => runSeeds()).not.toThrow();
  });
});
