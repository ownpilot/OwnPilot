/**
 * Custom Tool Registry Tests
 *
 * Tests for the DynamicToolRegistry bridge and shared ToolRegistry synchronization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDynamicRegistry = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@ownpilot/core', () => ({
  createDynamicToolRegistry: vi.fn(() => mockDynamicRegistry),
  ALL_TOOLS: [],
}));

import {
  getCustomToolDynamicRegistry,
  setSharedRegistryForCustomTools,
  executeCustomToolUnified,
  unregisterToolFromRegistries,
  syncToolToRegistry,
} from './custom-tool-registry.js';
import type { CustomToolRecord } from '../db/repositories/custom-tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSharedRegistry() {
  return {
    registerCustomTool: vi.fn(),
    unregister: vi.fn(),
    has: vi.fn(() => false),
    execute: vi.fn(),
  };
}

function createMockTool(overrides: Partial<CustomToolRecord> = {}): CustomToolRecord {
  return {
    id: 'tool-1',
    name: 'my_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    code: 'return "ok";',
    category: 'general',
    status: 'active',
    permissions: [],
    requiresApproval: false,
    requiredApiKeys: null,
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as CustomToolRecord;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom Tool Registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset shared registry to null
    setSharedRegistryForCustomTools(null);
  });

  // ========================================================================
  // getCustomToolDynamicRegistry
  // ========================================================================

  describe('getCustomToolDynamicRegistry', () => {
    it('returns the dynamic registry instance', () => {
      const registry = getCustomToolDynamicRegistry();
      expect(registry).toBe(mockDynamicRegistry);
    });
  });

  // ========================================================================
  // setSharedRegistryForCustomTools
  // ========================================================================

  describe('setSharedRegistryForCustomTools', () => {
    it('sets the shared registry reference', () => {
      const sharedRegistry = createMockSharedRegistry();
      setSharedRegistryForCustomTools(sharedRegistry);

      // Verify it's used by executing a tool through the shared path
      sharedRegistry.has.mockReturnValue(true);
      sharedRegistry.execute.mockResolvedValue({ ok: true, value: { content: 'done' } });

      // Won't throw — registry is set
      expect(() => setSharedRegistryForCustomTools(sharedRegistry)).not.toThrow();
    });

    it('accepts null to clear the registry', () => {
      setSharedRegistryForCustomTools(null);
      // Should not throw
    });
  });

  // ========================================================================
  // executeCustomToolUnified
  // ========================================================================

  describe('executeCustomToolUnified', () => {
    it('executes via shared registry when tool exists there', async () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(true);
      sharedRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: { result: 'shared' }, isError: false, metadata: { src: 'shared' } },
      });
      setSharedRegistryForCustomTools(sharedRegistry);

      const result = await executeCustomToolUnified('my_tool', { x: 1 }, {
        conversationId: 'conv-1',
        userId: 'user-1',
      });

      expect(result.content).toEqual({ result: 'shared' });
      expect(result.isError).toBe(false);
      expect(result.metadata).toEqual({ src: 'shared' });
      expect(sharedRegistry.execute).toHaveBeenCalledWith('my_tool', { x: 1 }, {
        conversationId: 'conv-1',
        userId: 'user-1',
      });
    });

    it('returns error when shared registry execution fails', async () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(true);
      sharedRegistry.execute.mockResolvedValue({
        ok: false,
        error: { message: 'Tool execution failed' },
      });
      setSharedRegistryForCustomTools(sharedRegistry);

      const result = await executeCustomToolUnified('my_tool', {}, {});

      expect(result.isError).toBe(true);
      expect(result.content).toBe('Tool execution failed');
    });

    it('falls back to dynamic registry when shared registry is null', async () => {
      mockDynamicRegistry.execute.mockResolvedValue({
        content: { result: 'dynamic' },
        isError: false,
      });

      const result = await executeCustomToolUnified('my_tool', { x: 1 }, {
        callId: 'call-1',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      expect(result.content).toEqual({ result: 'dynamic' });
      expect(mockDynamicRegistry.execute).toHaveBeenCalledWith('my_tool', { x: 1 }, {
        callId: 'call-1',
        conversationId: 'conv-2',
        userId: 'user-2',
      });
    });

    it('falls back to dynamic registry when tool not in shared registry', async () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(false);
      setSharedRegistryForCustomTools(sharedRegistry);

      mockDynamicRegistry.execute.mockResolvedValue({
        content: 'fallback result',
        isError: false,
      });

      const result = await executeCustomToolUnified('unknown_tool', {}, {});

      expect(sharedRegistry.execute).not.toHaveBeenCalled();
      expect(mockDynamicRegistry.execute).toHaveBeenCalled();
      expect(result.content).toBe('fallback result');
    });

    it('defaults conversationId when not provided', async () => {
      mockDynamicRegistry.execute.mockResolvedValue({ content: 'ok', isError: false });

      await executeCustomToolUnified('my_tool', {}, {});

      expect(mockDynamicRegistry.execute).toHaveBeenCalledWith(
        'my_tool',
        {},
        expect.objectContaining({ conversationId: 'custom-tool-execution' }),
      );
    });

    it('defaults isError to false when not returned', async () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(true);
      sharedRegistry.execute.mockResolvedValue({
        ok: true,
        value: { content: 'result' },
      });
      setSharedRegistryForCustomTools(sharedRegistry);

      const result = await executeCustomToolUnified('my_tool', {}, {});
      expect(result.isError).toBe(false);
    });
  });

  // ========================================================================
  // unregisterToolFromRegistries
  // ========================================================================

  describe('unregisterToolFromRegistries', () => {
    it('unregisters from dynamic registry', () => {
      unregisterToolFromRegistries('my_tool');

      expect(mockDynamicRegistry.unregister).toHaveBeenCalledWith('my_tool');
    });

    it('unregisters from shared registry when tool exists there', () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(true);
      setSharedRegistryForCustomTools(sharedRegistry);

      unregisterToolFromRegistries('my_tool');

      expect(mockDynamicRegistry.unregister).toHaveBeenCalledWith('my_tool');
      expect(sharedRegistry.unregister).toHaveBeenCalledWith('my_tool');
    });

    it('skips shared registry when tool not found there', () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(false);
      setSharedRegistryForCustomTools(sharedRegistry);

      unregisterToolFromRegistries('my_tool');

      expect(sharedRegistry.unregister).not.toHaveBeenCalled();
    });

    it('handles null shared registry gracefully', () => {
      setSharedRegistryForCustomTools(null);

      expect(() => unregisterToolFromRegistries('my_tool')).not.toThrow();
      expect(mockDynamicRegistry.unregister).toHaveBeenCalledWith('my_tool');
    });
  });

  // ========================================================================
  // syncToolToRegistry
  // ========================================================================

  describe('syncToolToRegistry', () => {
    it('registers active tool in dynamic registry', () => {
      const tool = createMockTool();

      syncToolToRegistry(tool);

      expect(mockDynamicRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my_tool',
          description: 'A test tool',
          code: 'return "ok";',
        }),
      );
    });

    it('registers active tool in shared registry when available', () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(false);
      setSharedRegistryForCustomTools(sharedRegistry);

      const tool = createMockTool();
      syncToolToRegistry(tool);

      expect(sharedRegistry.registerCustomTool).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my_tool',
          description: 'A test tool',
        }),
        expect.any(Function),
        'tool-1',
      );
    });

    it('skips shared registry registration if tool already exists there', () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(true);
      setSharedRegistryForCustomTools(sharedRegistry);

      const tool = createMockTool();
      syncToolToRegistry(tool);

      expect(sharedRegistry.registerCustomTool).not.toHaveBeenCalled();
    });

    it('unregisters inactive tool from both registries', () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(true);
      setSharedRegistryForCustomTools(sharedRegistry);

      const tool = createMockTool({ status: 'disabled' });
      syncToolToRegistry(tool);

      expect(mockDynamicRegistry.unregister).toHaveBeenCalledWith('my_tool');
      expect(sharedRegistry.unregister).toHaveBeenCalledWith('my_tool');
    });

    it('handles tool with requiredApiKeys', () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(false);
      setSharedRegistryForCustomTools(sharedRegistry);

      const tool = createMockTool({
        requiredApiKeys: [
          { name: 'openai', displayName: 'OpenAI', description: 'API key', category: 'ai', docsUrl: 'https://openai.com' },
        ],
      } as Partial<CustomToolRecord>);

      syncToolToRegistry(tool);

      expect(sharedRegistry.registerCustomTool).toHaveBeenCalledWith(
        expect.objectContaining({
          configRequirements: [
            expect.objectContaining({ name: 'openai', displayName: 'OpenAI' }),
          ],
        }),
        expect.any(Function),
        'tool-1',
      );
    });

    it('handles tool with workflowUsable metadata', () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(false);
      setSharedRegistryForCustomTools(sharedRegistry);

      const tool = createMockTool({
        metadata: { workflowUsable: true },
      } as Partial<CustomToolRecord>);

      syncToolToRegistry(tool);

      expect(sharedRegistry.registerCustomTool).toHaveBeenCalledWith(
        expect.objectContaining({ workflowUsable: true }),
        expect.any(Function),
        'tool-1',
      );
    });

    it('handles tool with null metadata', () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(false);
      setSharedRegistryForCustomTools(sharedRegistry);

      const tool = createMockTool({ metadata: null });
      syncToolToRegistry(tool);

      expect(sharedRegistry.registerCustomTool).toHaveBeenCalledWith(
        expect.objectContaining({ workflowUsable: undefined }),
        expect.any(Function),
        'tool-1',
      );
    });

    it('handles null shared registry for inactive tool', () => {
      setSharedRegistryForCustomTools(null);

      const tool = createMockTool({ status: 'disabled' });
      expect(() => syncToolToRegistry(tool)).not.toThrow();
      expect(mockDynamicRegistry.unregister).toHaveBeenCalledWith('my_tool');
    });

    it('creates executor that delegates to dynamic registry', async () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(false);
      setSharedRegistryForCustomTools(sharedRegistry);

      const tool = createMockTool();
      syncToolToRegistry(tool);

      // Get the executor that was registered
      const registeredExecutor = sharedRegistry.registerCustomTool.mock.calls[0][1];

      // Execute it
      mockDynamicRegistry.execute.mockResolvedValue({ content: 'proxied' });
      const result = await registeredExecutor({ arg: 1 }, { callId: 'c1', conversationId: 'conv', userId: 'u1' });

      expect(mockDynamicRegistry.execute).toHaveBeenCalledWith('my_tool', { arg: 1 }, { callId: 'c1', conversationId: 'conv', userId: 'u1' });
      expect(result).toEqual({ content: 'proxied' });
    });

    it('defaults category to "Custom" when null', () => {
      const sharedRegistry = createMockSharedRegistry();
      sharedRegistry.has.mockReturnValue(false);
      setSharedRegistryForCustomTools(sharedRegistry);

      const tool = createMockTool({ category: null } as unknown as Partial<CustomToolRecord>);
      syncToolToRegistry(tool);

      expect(sharedRegistry.registerCustomTool).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Custom' }),
        expect.any(Function),
        'tool-1',
      );
    });
  });
});
