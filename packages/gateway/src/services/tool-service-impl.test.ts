/**
 * ToolService Implementation Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRegistry = {
  executeToolCall: vi.fn(),
  getDefinition: vi.fn(),
  getDefinitions: vi.fn(() => []),
  getToolsBySource: vi.fn(() => []),
  has: vi.fn(),
  getNames: vi.fn(() => []),
  use: vi.fn(),
};

vi.mock('./tool-executor.js', () => ({
  getSharedToolRegistry: vi.fn(() => mockRegistry),
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { ToolService, createToolService } from './tool-service-impl.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('delegates to registry.executeToolCall', async () => {
      mockRegistry.executeToolCall.mockResolvedValue({
        content: 'result text',
        isError: false,
      });

      const svc = new ToolService('user-1');
      const result = await svc.execute('my_tool', { key: 'val' });

      expect(mockRegistry.executeToolCall).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'my_tool', arguments: '{"key":"val"}' }),
        'service',
        'user-1',
      );
      expect(result.content).toBe('result text');
      expect(result.isError).toBe(false);
    });

    it('uses provided conversationId and userId', async () => {
      mockRegistry.executeToolCall.mockResolvedValue({ content: 'ok', isError: false });

      const svc = new ToolService();
      await svc.execute('tool_a', {}, { conversationId: 'conv-1', userId: 'u-2' });

      expect(mockRegistry.executeToolCall).toHaveBeenCalledWith(
        expect.anything(),
        'conv-1',
        'u-2',
      );
    });

    it('stringifies object content', async () => {
      mockRegistry.executeToolCall.mockResolvedValue({
        content: { data: 123 },
        isError: false,
      });

      const svc = new ToolService();
      const result = await svc.execute('tool_b', {});

      expect(result.content).toBe(JSON.stringify({ data: 123 }));
    });

    it('propagates isError flag', async () => {
      mockRegistry.executeToolCall.mockResolvedValue({
        content: 'oops',
        isError: true,
      });

      const svc = new ToolService();
      const result = await svc.execute('tool_fail', {});
      expect(result.isError).toBe(true);
    });
  });

  describe('getDefinition', () => {
    it('returns definition from registry', () => {
      const def = { name: 'foo', description: 'bar' };
      mockRegistry.getDefinition.mockReturnValue(def);

      const svc = new ToolService();
      expect(svc.getDefinition('foo')).toEqual(def);
    });

    it('returns undefined for unknown tool', () => {
      mockRegistry.getDefinition.mockReturnValue(undefined);
      const svc = new ToolService();
      expect(svc.getDefinition('nope')).toBeUndefined();
    });
  });

  describe('getDefinitions', () => {
    it('returns all definitions', () => {
      const defs = [{ name: 'a' }, { name: 'b' }];
      mockRegistry.getDefinitions.mockReturnValue(defs);

      const svc = new ToolService();
      expect(svc.getDefinitions()).toEqual(defs);
    });
  });

  describe('getDefinitionsBySource', () => {
    it('maps ToolsBySource to definitions', () => {
      const toolEntries = [
        { definition: { name: 'core_tool' } },
        { definition: { name: 'custom_tool' } },
      ];
      mockRegistry.getToolsBySource.mockReturnValue(toolEntries);

      const svc = new ToolService();
      const result = svc.getDefinitionsBySource('core');
      expect(result).toEqual([{ name: 'core_tool' }, { name: 'custom_tool' }]);
    });
  });

  describe('has', () => {
    it('returns true when tool exists', () => {
      mockRegistry.has.mockReturnValue(true);
      const svc = new ToolService();
      expect(svc.has('existing')).toBe(true);
    });

    it('returns false when tool missing', () => {
      mockRegistry.has.mockReturnValue(false);
      const svc = new ToolService();
      expect(svc.has('missing')).toBe(false);
    });
  });

  describe('getNames', () => {
    it('returns tool names from registry', () => {
      mockRegistry.getNames.mockReturnValue(['a', 'b', 'c']);
      const svc = new ToolService();
      expect(svc.getNames()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('use', () => {
    it('passes middleware to registry', () => {
      const middleware = { name: 'test-mw' };
      const svc = new ToolService();
      svc.use(middleware as any);
      expect(mockRegistry.use).toHaveBeenCalledWith(middleware);
    });
  });

  describe('getCount', () => {
    it('returns count of tool names', () => {
      mockRegistry.getNames.mockReturnValue(['x', 'y']);
      const svc = new ToolService();
      expect(svc.getCount()).toBe(2);
    });
  });

  describe('createToolService', () => {
    it('creates a ToolService instance', () => {
      const svc = createToolService('user-x');
      expect(svc).toBeInstanceOf(ToolService);
    });

    it('creates with default userId', () => {
      const svc = createToolService();
      expect(svc).toBeInstanceOf(ToolService);
    });
  });
});
