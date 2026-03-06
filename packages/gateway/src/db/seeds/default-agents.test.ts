/**
 * Default Agents Loader Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('../../services/log.js', () => ({
  getLog: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadDefaultAgents', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns empty array when file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const { loadDefaultAgents } = await import('./default-agents.js');
    const result = loadDefaultAgents();
    expect(result).toEqual([]);
  });

  it('loads agents from JSON file', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: '1.0',
        agents: [
          {
            id: 'agent-1',
            name: 'Test Agent',
            category: 'assistant',
            systemPrompt: 'You are helpful.',
            config: { maxTokens: 8192, temperature: 0.7, maxTurns: 20, maxToolCalls: 50 },
          },
        ],
      })
    );
    const { loadDefaultAgents } = await import('./default-agents.js');
    const result = loadDefaultAgents();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'agent-1',
      name: 'Test Agent',
      provider: 'default',
      model: 'default',
    });
  });

  it('prepends emoji to name when emoji is defined', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: '1.0',
        agents: [
          {
            id: 'agent-emoji',
            name: 'Emoji Agent',
            emoji: '🤖',
            category: 'assistant',
            systemPrompt: 'Test',
            config: { maxTokens: 4096, temperature: 0.5, maxTurns: 10, maxToolCalls: 20 },
          },
        ],
      })
    );
    const { loadDefaultAgents } = await import('./default-agents.js');
    const result = loadDefaultAgents();
    expect(result[0]?.name).toBe('🤖 Emoji Agent');
  });

  it('includes tools and toolGroups in config', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: '1.0',
        agents: [
          {
            id: 'agent-tools',
            name: 'Tool Agent',
            category: 'assistant',
            systemPrompt: 'Test',
            tools: ['search', 'calculator'],
            toolGroups: ['web'],
            config: { maxTokens: 2048, temperature: 0.3, maxTurns: 5, maxToolCalls: 10 },
          },
        ],
      })
    );
    const { loadDefaultAgents } = await import('./default-agents.js');
    const result = loadDefaultAgents();
    expect(result[0]?.config.tools).toEqual(['search', 'calculator']);
    expect(result[0]?.config.toolGroups).toEqual(['web']);
  });

  it('returns empty array on parse error', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not-valid-json{{{');
    const { loadDefaultAgents } = await import('./default-agents.js');
    const result = loadDefaultAgents();
    expect(result).toEqual([]);
  });

  it('returns empty array on readFileSync error', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    const { loadDefaultAgents } = await import('./default-agents.js');
    const result = loadDefaultAgents();
    expect(result).toEqual([]);
  });
});

describe('getDefaultAgents', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns agents from file', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: '1.0',
        agents: [
          {
            id: 'a1',
            name: 'Agent1',
            category: 'assistant',
            systemPrompt: 'Test',
            config: { maxTokens: 4096, temperature: 0.7, maxTurns: 10, maxToolCalls: 30 },
          },
        ],
      })
    );
    const { getDefaultAgents } = await import('./default-agents.js');
    const result = getDefaultAgents();
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('a1');
  });

  it('caches result on second call', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: '1.0',
        agents: [
          {
            id: 'a1',
            name: 'A',
            category: 'c',
            systemPrompt: 's',
            config: { maxTokens: 1000, temperature: 0.5, maxTurns: 5, maxToolCalls: 10 },
          },
        ],
      })
    );
    const { getDefaultAgents } = await import('./default-agents.js');
    getDefaultAgents();
    getDefaultAgents();
    // readFileSync called only once due to caching
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('DEFAULT_AGENTS proxy', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes agents via array index access', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: '1.0',
        agents: [
          {
            id: 'proxy-1',
            name: 'Proxy Agent',
            category: 'test',
            systemPrompt: 'Test',
            config: { maxTokens: 1024, temperature: 0.7, maxTurns: 5, maxToolCalls: 10 },
          },
        ],
      })
    );
    const { DEFAULT_AGENTS } = await import('./default-agents.js');
    expect(DEFAULT_AGENTS[0]?.id).toBe('proxy-1');
  });

  it('exposes length property', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: '1.0',
        agents: [
          {
            id: 'a',
            name: 'A',
            category: 'c',
            systemPrompt: 's',
            config: { maxTokens: 1024, temperature: 0.5, maxTurns: 3, maxToolCalls: 5 },
          },
          {
            id: 'b',
            name: 'B',
            category: 'c',
            systemPrompt: 's',
            config: { maxTokens: 1024, temperature: 0.5, maxTurns: 3, maxToolCalls: 5 },
          },
        ],
      })
    );
    const { DEFAULT_AGENTS } = await import('./default-agents.js');
    expect(DEFAULT_AGENTS.length).toBe(2);
  });

  it('is iterable', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: '1.0',
        agents: [
          {
            id: 'iter-1',
            name: 'Iter Agent',
            category: 'test',
            systemPrompt: 'T',
            config: { maxTokens: 512, temperature: 0.5, maxTurns: 2, maxToolCalls: 5 },
          },
        ],
      })
    );
    const { DEFAULT_AGENTS } = await import('./default-agents.js');
    const ids = [...DEFAULT_AGENTS].map((a) => a.id);
    expect(ids).toContain('iter-1');
  });
});
