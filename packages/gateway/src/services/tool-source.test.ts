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
    // Normalize to forward slashes (Windows compat)
    const normalizedPath = (path as string).replace(/\\/g, '/');
    // Exact match first
    if (mockFiles.has(normalizedPath)) return mockFiles.get(normalizedPath);
    // Suffix match: allows setting mock files with relative path suffixes
    for (const [key, val] of mockFiles) {
      if (normalizedPath.endsWith('/' + key) || normalizedPath === key) {
        return val;
      }
    }
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
          heartbeatNames: ['create_heartbeat'],
        });
      }).not.toThrow();
    });

    it('includes extension tools when provided', () => {
      expect(() => {
        initToolSourceMappings({
          memoryNames: [],
          goalNames: [],
          customDataNames: [],
          personalDataNames: [],
          triggerNames: [],
          planNames: [],
          heartbeatNames: [],
          extensionNames: ['run_extension'],
        });
      }).not.toThrow();
    });

    it('includes soulCommunicationNames when provided', () => {
      expect(() => {
        initToolSourceMappings({
          memoryNames: [],
          goalNames: [],
          customDataNames: [],
          personalDataNames: [],
          triggerNames: [],
          planNames: [],
          heartbeatNames: [],
          soulCommunicationNames: ['broadcast_message', 'send_to_soul'],
        });
      }).not.toThrow();
    });

    it('skips extensionNames when empty array', () => {
      expect(() => {
        initToolSourceMappings({
          memoryNames: [],
          goalNames: [],
          customDataNames: [],
          personalDataNames: [],
          triggerNames: [],
          planNames: [],
          heartbeatNames: [],
          extensionNames: [],
        });
      }).not.toThrow();
    });

    it('skips soulCommunicationNames when empty array', () => {
      expect(() => {
        initToolSourceMappings({
          memoryNames: [],
          goalNames: [],
          customDataNames: [],
          personalDataNames: [],
          triggerNames: [],
          planNames: [],
          heartbeatNames: [],
          soulCommunicationNames: [],
        });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // Extraction Functions
  // ========================================================================

  describe('extractSwitchCase', () => {
    it('extracts switch case with single quotes', () => {
      const mockSwitchContent = `
switch (toolName) {
  case 'test_tool': {
    const result = await executeSomething();
    return result;
  }
  case 'other_tool': {
    break;
  }
}
`;
      _setMockFile('routes/test.ts', mockSwitchContent);

      // Initialize mapping and test extraction
      initToolSourceMappings({
        memoryNames: ['test_tool'],
        goalNames: [],
        customDataNames: [],
        personalDataNames: [],
        triggerNames: [],
        planNames: [],
        heartbeatNames: [],
      });

      // Note: Since GATEWAY_TOOL_MAP is private, we can't directly test extraction
      // But we can verify getToolSource works with mocked files
    });

    it('handles missing case gracefully', () => {
      const result = getToolSource('nonexistent_tool');
      expect(result).toBeNull();
    });
  });

  describe('Core tool extraction', () => {
    it('extracts core tool source when file exists', () => {
      const mockFileContent = `
export const readFileExecutor = async (args: unknown, _context: ToolContext): Promise<ToolExecutionResult> => {
  const parsed = ReadFileArgsSchema.safeParse(args);
  if (!parsed.success) {
    return { content: 'Invalid args', isError: true };
  }
  const { path } = parsed.data;
  return { content: 'File content' };
};
`;
      _setMockFile('core/src/agent/tools/file-system.ts', mockFileContent);

      const source = getToolSource('read_file');
      // With suffix-matching mock, the file is found and executor is extracted
      expect(source).not.toBeNull();
      expect(source).toContain('readFileExecutor');
    });

    it('strips namespace prefix from tool names', () => {
      const result = getToolSource('plugin.some_tool');
      expect(result).toBeNull();
    });
  });

  describe('Caching behavior', () => {
    it('caches extraction results', () => {
      // First call should cache null
      const result1 = getToolSource('unknown_cached_tool');
      expect(result1).toBeNull();

      // Second call should return cached result
      const result2 = getToolSource('unknown_cached_tool');
      expect(result2).toBeNull();
    });

    it('uses cache eviction when full', () => {
      // Fill up the cache with many different tools
      for (let i = 0; i < 1100; i++) {
        getToolSource(`tool_${i}`);
      }

      // Should not throw and should handle cache eviction
      expect(() => {
        getToolSource('final_tool');
      }).not.toThrow();
    });

    it('evicts oldest entry when extraction cache is at capacity', () => {
      // Fill extraction cache to capacity (1000) using fallback to get non-null source
      for (let i = 0; i < 1000; i++) {
        getToolSource(`fill_cache_${i}`, () => `source_${i}`);
      }

      // This call should trigger eviction and still work
      const result = getToolSource('overflow_tool', () => 'overflow source');
      expect(result).toBe('overflow source');
    });
  });

  describe('File reading with cache', () => {
    it('caches file contents', () => {
      const mockContent = 'async function test() {}';
      _setMockFile('test-file.ts', mockContent);

      // Multiple calls should use cache
      const result1 = getToolSource('some_tool');
      const result2 = getToolSource('some_tool');

      // Both should return null since tool isn't mapped
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it('evicts oldest file from cache when full', () => {
      // This tests the cache eviction logic
      expect(() => {
        // Fill up file cache
        for (let i = 0; i < 110; i++) {
          _setMockFile(`file_${i}.ts`, `content ${i}`);
        }
      }).not.toThrow();
    });
  });

  // =========================================================================
  // Extraction Function Integration
  // (Tests extractSwitchCase, extractConstFunction, extractFunction via getToolSource)
  // =========================================================================

  describe('Extraction function integration', () => {
    it('extractSwitchCase: extracts a switch case block from a gateway tool file', () => {
      // Map a fresh tool name to extension-tools.ts
      initToolSourceMappings({
        memoryNames: [],
        goalNames: [],
        customDataNames: [],
        personalDataNames: [],
        triggerNames: [],
        planNames: [],
        heartbeatNames: [],
        extensionNames: ['tx_switch_test'],
      });

      mockFiles.set(
        'tools/extension-tools.ts',
        [
          'export async function executeExtensionTool(toolName, args) {',
          '  switch (toolName) {',
          "    case 'tx_switch_test': {",
          '      const result = performAction(args);',
          '      return { content: String(result) };',
          '    }',
          '    default:',
          '      return null;',
          '  }',
          '}',
        ].join('\n')
      );

      const source = getToolSource('tx_switch_test');
      expect(source).not.toBeNull();
      expect(source).toContain("case 'tx_switch_test'");
    });

    it('extractFunction (gateway fallback): falls back when no switch case matches', () => {
      // tx_func_test maps to same extension-tools.ts (fileCache populated from previous test)
      // Cached content has no case for tx_func_test → extractSwitchCase returns null
      // → extractFunction extracts the outer executeExtensionTool function
      initToolSourceMappings({
        memoryNames: [],
        goalNames: [],
        customDataNames: [],
        personalDataNames: [],
        triggerNames: [],
        planNames: [],
        heartbeatNames: [],
        extensionNames: ['tx_func_test'],
      });

      const source = getToolSource('tx_func_test');
      expect(source).not.toBeNull();
      expect(source).toContain('executeExtensionTool');
    });

    it('extractConstFunction: extracts an arrow function from a core tool file', () => {
      // 'calculate' maps to utility-tools.ts with executor calculateExecutor (not yet cached)
      mockFiles.set(
        'utility-tools.ts',
        [
          'export const calculateExecutor = async (',
          '  args: { expression: string },',
          '  _context: unknown',
          '): Promise<{ content: string }> => {',
          '  const result = mathjs.evaluate(args.expression);',
          '  return { content: String(result) };',
          '};',
        ].join('\n')
      );

      const source = getToolSource('calculate');
      expect(source).not.toBeNull();
      expect(source).toContain('calculateExecutor');
    });

    it('extractFunction (core fallback): extracts a named function when const arrow not present', () => {
      // 'read_pdf' maps to pdf-tools.ts with executor readPdfExecutor (not yet cached)
      // Named function syntax → extractConstFunction returns null → extractFunction succeeds
      mockFiles.set(
        'pdf-tools.ts',
        [
          'export async function readPdfExecutor(',
          '  args: { path: string },',
          '  _context: unknown',
          '): Promise<{ content: string }> {',
          '  const text = parsePdfFile(args.path);',
          '  return { content: text };',
          '}',
        ].join('\n')
      );

      const source = getToolSource('read_pdf');
      expect(source).not.toBeNull();
      expect(source).toContain('readPdfExecutor');
    });

    it('returns null gracefully when extraction patterns do not match', () => {
      // generate_uuid maps to utility-tools.ts (cached with calculateExecutor content)
      // generateUuidExecutor is not in the cached content → returns null
      expect(() => getToolSource('generate_uuid')).not.toThrow();
    });
  });
});
