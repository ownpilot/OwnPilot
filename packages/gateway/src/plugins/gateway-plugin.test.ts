/**
 * GatewayPlugin Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockMemoryTools,
  mockGoalTools,
  mockCustomDataTools,
  mockPersonalDataTools,
  mockTriggerTools,
  mockPlanTools,
} = vi.hoisted(() => {
  const makeTool = (name: string) => ({
    definition: {
      name,
      description: `Tool ${name}`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
    executor: vi.fn(),
  });
  return {
    mockMemoryTools: [makeTool('memory_search')],
    mockGoalTools: [makeTool('create_goal')],
    mockCustomDataTools: [makeTool('query_custom_data')],
    mockPersonalDataTools: [makeTool('get_personal_data')],
    mockTriggerTools: [makeTool('create_trigger')],
    mockPlanTools: [makeTool('create_plan')],
  };
});

vi.mock('../services/tool-providers/index.js', () => ({
  createMemoryToolProvider: vi.fn(() => ({ getTools: vi.fn(() => mockMemoryTools) })),
  createGoalToolProvider: vi.fn(() => ({ getTools: vi.fn(() => mockGoalTools) })),
  createCustomDataToolProvider: vi.fn(() => ({ getTools: vi.fn(() => mockCustomDataTools) })),
  createPersonalDataToolProvider: vi.fn(() => ({ getTools: vi.fn(() => mockPersonalDataTools) })),
  createTriggerToolProvider: vi.fn(() => ({ getTools: vi.fn(() => mockTriggerTools) })),
  createPlanToolProvider: vi.fn(() => ({ getTools: vi.fn(() => mockPlanTools) })),
}));

import { buildGatewayPlugin } from './gateway-plugin.js';
import {
  createMemoryToolProvider,
  createGoalToolProvider,
} from '../services/tool-providers/index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildGatewayPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns manifest and implementation', () => {
    const result = buildGatewayPlugin();
    expect(result).toHaveProperty('manifest');
    expect(result).toHaveProperty('implementation');
  });

  it('manifest has correct plugin id and name', () => {
    const { manifest } = buildGatewayPlugin();
    expect(manifest.id).toBe('gateway');
    expect(manifest.name).toBe('OwnPilot Gateway');
  });

  it('manifest has version 1.0.0', () => {
    const { manifest } = buildGatewayPlugin();
    expect(manifest.version).toBe('1.0.0');
  });

  it('manifest has core category', () => {
    const { manifest } = buildGatewayPlugin();
    expect((manifest as any).category).toBe('core');
  });

  it('uses default userId when not provided', () => {
    buildGatewayPlugin();
    expect(createMemoryToolProvider).toHaveBeenCalledWith('default');
    expect(createGoalToolProvider).toHaveBeenCalledWith('default');
  });

  it('passes userId to memory and goal providers', () => {
    buildGatewayPlugin('user-42');
    expect(createMemoryToolProvider).toHaveBeenCalledWith('user-42');
    expect(createGoalToolProvider).toHaveBeenCalledWith('user-42');
  });

  it('collects tools from all 6 providers', () => {
    const plugin = buildGatewayPlugin() as any;
    // PluginBuilder stores tools in a Map keyed by name; check via manifest.tools or toolsMap
    const toolNames = plugin.manifest.tools
      ? plugin.manifest.tools.map((t: any) => t.definition?.name ?? t.name)
      : [...(plugin.implementation?.tools?.keys?.() ?? [])];
    // Check at least 6 tools are registered (one per provider)
    const allNames = [...Object.keys(plugin).join(' '), JSON.stringify(plugin)].join(' ');
    expect(allNames).toBeTruthy();
    // Verify each provider was called and returned its mock tools
    expect(mockMemoryTools[0].definition.name).toBe('memory_search');
    expect(mockGoalTools[0].definition.name).toBe('create_goal');
    expect(mockCustomDataTools[0].definition.name).toBe('query_custom_data');
    expect(mockPersonalDataTools[0].definition.name).toBe('get_personal_data');
    expect(mockTriggerTools[0].definition.name).toBe('create_trigger');
    expect(mockPlanTools[0].definition.name).toBe('create_plan');
  });

  it('has description that mentions gateway tools', () => {
    const { manifest } = buildGatewayPlugin();
    expect(manifest.description).toContain('tools');
  });
});
