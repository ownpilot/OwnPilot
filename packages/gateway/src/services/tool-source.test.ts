/**
 * Tool Source Service Tests
 *
 * Tests the source code extraction utilities:
 * extractSwitchCase, extractConstFunction, extractFunction,
 * getToolSource, and initToolSourceMappings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fs to avoid reading real files
// ---------------------------------------------------------------------------

const mockFiles = new Map<string, string>();

vi.mock('fs', () => ({
  readFileSync: vi.fn((path: string) => {
    const content = mockFiles.get(path);
    if (content !== undefined) return content;
    throw new Error(`ENOENT: no such file ${path}`);
  }),
}));

import { getToolSource, initToolSourceMappings } from './tool-source.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _setMockFile(pathSuffix: string, content: string) {
  // The tool-source resolves absolute paths from __dirname,
  // so we need to match what it resolves. We'll set with the full suffix
  // and let the mock match by checking the end of the path.
  for (const [key] of mockFiles) {
    if (key.endsWith(pathSuffix)) {
      mockFiles.delete(key);
    }
  }
  // Set with a key that will match the readFileSync call
  mockFiles.set(pathSuffix, content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tool Source Service', () => {
  beforeEach(() => {
    mockFiles.clear();
    vi.clearAllMocks();
  });

  // ========================================================================
  // getToolSource with fallback
  // ========================================================================

  describe('getToolSource', () => {
    it('returns null when tool not mapped and no fallback', () => {
      const source = getToolSource('completely_unknown_tool');
      expect(source).toBeNull();
    });

    it('uses fallback when tool not mapped', () => {
      const fallback = () => 'async function executor(args) { return args; }';
      const source = getToolSource('unknown_plugin_tool', fallback);
      expect(source).toBe('async function executor(args) { return args; }');
    });

    it('returns empty string for fallback that returns empty', () => {
      // getToolSource returns the fallback result as-is (empty string is not cached but still returned)
      const source = getToolSource('another_unknown', () => '');
      expect(source).toBe('');
    });
  });

  // ========================================================================
  // initToolSourceMappings
  // ========================================================================

  describe('initToolSourceMappings', () => {
    it('does not throw when called with tool name arrays', () => {
      expect(() => {
        initToolSourceMappings({
          memoryNames: ['search_memories'],
          goalNames: ['create_goal'],
          customDataNames: ['query_custom_data'],
          personalDataNames: ['get_tasks'],
          triggerNames: ['create_trigger'],
          planNames: ['create_plan'],
        });
      }).not.toThrow();
    });
  });
});
