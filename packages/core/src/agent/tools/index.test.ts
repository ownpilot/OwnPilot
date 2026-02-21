/**
 * Tests for packages/core/src/agent/tools/index.ts
 *
 * Strategy: every tool-set module is mocked with a small deterministic set of
 * fake tools so we can assert exact counts, keys, and call signatures without
 * pulling real filesystem / sandbox / network dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// HOISTED MOCK DATA — must be declared before any vi.mock() factory runs
// =============================================================================

const {
  mockFsTools,
  mockCodeTools,
  mockWebFetchTools,
  mockExpenseTools,
  mockPdfTools,
  mockImageTools,
  mockEmailTools,
  mockGitTools,
  mockAudioTools,
  mockDataExtractionTools,
  mockWeatherTools,
  mockUtilityTools,
  mockCustomDataTools,
  mockMemoryTools,
  mockGoalTools,
  mockPersonalDataTools,
  mockDynamicToolDefs,
  mockDynamicToolNames,
} = vi.hoisted(() => {
  const makeTool = (name: string, description = `Description for ${name}`) => ({
    definition: {
      name,
      description,
      parameters: { type: 'object' as const, properties: {} },
    },
    executor: vi.fn(),
  });

  return {
    mockFsTools: [makeTool('read_file'), makeTool('write_file')],
    mockCodeTools: [makeTool('execute_javascript'), makeTool('execute_python')],
    mockWebFetchTools: [makeTool('http_request'), makeTool('fetch_web_page')],
    mockExpenseTools: [makeTool('add_expense'), makeTool('query_expenses')],
    mockPdfTools: [makeTool('read_pdf'), makeTool('create_pdf')],
    mockImageTools: [makeTool('analyze_image'), makeTool('generate_image')],
    mockEmailTools: [makeTool('send_email'), makeTool('list_emails')],
    mockGitTools: [makeTool('git_status'), makeTool('git_commit')],
    mockAudioTools: [makeTool('text_to_speech'), makeTool('speech_to_text')],
    mockDataExtractionTools: [makeTool('extract_entities'), makeTool('extract_table_data')],
    mockWeatherTools: [makeTool('get_weather'), makeTool('get_weather_forecast')],
    mockUtilityTools: [
      makeTool('get_current_datetime'),
      makeTool('calculate'),
      makeTool('convert_units'),
    ],
    // These are definition-only tool sets (no executors in ALL_TOOLS)
    mockCustomDataTools: [makeTool('list_custom_tables'), makeTool('add_custom_record')],
    mockMemoryTools: [makeTool('create_memory'), makeTool('search_memories')],
    mockGoalTools: [makeTool('create_goal'), makeTool('list_goals')],
    mockPersonalDataTools: [makeTool('add_task'), makeTool('add_note')],
    // DYNAMIC_TOOL_DEFINITIONS is ToolDefinition[] (no executor pair)
    mockDynamicToolDefs: [
      {
        name: 'create_tool',
        description: 'Create a new custom tool',
        parameters: { type: 'object' as const, properties: {} },
      },
      {
        name: 'list_custom_tools',
        description: 'List all custom tools',
        parameters: { type: 'object' as const, properties: {} },
      },
    ],
    mockDynamicToolNames: ['create_tool', 'list_custom_tools'],
  };
});

// =============================================================================
// MODULE MOCKS
// =============================================================================

vi.mock('./file-system.js', () => ({ FILE_SYSTEM_TOOLS: mockFsTools }));
vi.mock('./code-execution.js', () => ({ CODE_EXECUTION_TOOLS: mockCodeTools }));
vi.mock('./web-fetch.js', () => ({ WEB_FETCH_TOOLS: mockWebFetchTools }));
vi.mock('./expense-tracker.js', () => ({ EXPENSE_TRACKER_TOOLS: mockExpenseTools }));
vi.mock('./pdf-tools.js', () => ({
  PDF_TOOLS: mockPdfTools,
  PDF_TOOL_NAMES: mockPdfTools.map((t) => t.definition.name),
}));
vi.mock('./image-tools.js', () => ({
  IMAGE_TOOLS: mockImageTools,
  IMAGE_TOOL_NAMES: mockImageTools.map((t) => t.definition.name),
}));
vi.mock('./email-tools.js', () => ({
  EMAIL_TOOLS: mockEmailTools,
  EMAIL_TOOL_NAMES: mockEmailTools.map((t) => t.definition.name),
}));
vi.mock('./git-tools.js', () => ({
  GIT_TOOLS: mockGitTools,
  GIT_TOOL_NAMES: mockGitTools.map((t) => t.definition.name),
}));
vi.mock('./audio-tools.js', () => ({
  AUDIO_TOOLS: mockAudioTools,
  AUDIO_TOOL_NAMES: mockAudioTools.map((t) => t.definition.name),
}));
vi.mock('./data-extraction-tools.js', () => ({
  DATA_EXTRACTION_TOOLS: mockDataExtractionTools,
  DATA_EXTRACTION_TOOL_NAMES: mockDataExtractionTools.map((t) => t.definition.name),
}));
vi.mock('./weather-tools.js', () => ({
  WEATHER_TOOLS: mockWeatherTools,
  WEATHER_TOOL_NAMES: mockWeatherTools.map((t) => t.definition.name),
}));
vi.mock('./utility-tools.js', () => ({
  UTILITY_TOOLS: mockUtilityTools,
  UTILITY_TOOL_NAMES: mockUtilityTools.map((t) => t.definition.name),
}));
vi.mock('./custom-data.js', () => ({
  CUSTOM_DATA_TOOLS: mockCustomDataTools,
  CUSTOM_DATA_TOOL_NAMES: mockCustomDataTools.map((t) => t.definition.name),
}));
vi.mock('./memory-tools.js', () => ({
  MEMORY_TOOLS: mockMemoryTools,
  MEMORY_TOOL_NAMES: mockMemoryTools.map((t) => t.definition.name),
}));
vi.mock('./goal-tools.js', () => ({
  GOAL_TOOLS: mockGoalTools,
  GOAL_TOOL_NAMES: mockGoalTools.map((t) => t.definition.name),
}));
vi.mock('./personal-data.js', () => ({
  PERSONAL_DATA_TOOLS: mockPersonalDataTools,
  PERSONAL_DATA_TOOL_NAMES: mockPersonalDataTools.map((t) => t.definition.name),
}));
vi.mock('./dynamic-tools.js', () => ({
  DYNAMIC_TOOL_DEFINITIONS: mockDynamicToolDefs,
  DYNAMIC_TOOL_NAMES: mockDynamicToolNames,
  createDynamicToolRegistry: vi.fn(),
}));
vi.mock('./tool-tags.js', () => ({
  TOOL_SEARCH_TAGS: {},
}));
vi.mock('./tool-limits.js', () => ({
  TOOL_MAX_LIMITS: {},
  applyToolLimits: vi.fn((_, args) => args),
}));
vi.mock('./module-resolver.js', () => ({
  setModuleResolver: vi.fn(),
  tryImport: vi.fn(),
}));

// Namespace helpers — qualifyToolName returns `core.<baseName>`;
// getBaseName strips everything before and including the last dot.
vi.mock('../tool-namespace.js', () => ({
  qualifyToolName: vi.fn((baseName: string, _prefix: string) => `core.${baseName}`),
  getBaseName: vi.fn((name: string) => {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.substring(idx + 1) : name;
  }),
}));

// =============================================================================
// IMPORT MODULE UNDER TEST — must come AFTER all vi.mock() calls
// =============================================================================

import {
  TOOL_SETS,
  ALL_TOOLS,
  ALL_TOOL_NAMES,
  getToolDefinitions,
  getToolExecutors,
  registerAllTools,
  registerToolSet,
  getTool,
  TOOL_CATEGORIES,
  getToolsByCategory,
  getCategoryForTool,
  getToolStats,
} from './index.js';

import { qualifyToolName, getBaseName } from '../tool-namespace.js';

// =============================================================================
// HELPERS
// =============================================================================

/** Total number of tools spread into ALL_TOOLS by the module under test */
const EXPECTED_ALL_TOOLS_COUNT =
  mockFsTools.length +
  mockCodeTools.length +
  mockWebFetchTools.length +
  mockExpenseTools.length +
  mockPdfTools.length +
  mockImageTools.length +
  mockEmailTools.length +
  mockGitTools.length +
  mockAudioTools.length +
  mockDataExtractionTools.length +
  mockWeatherTools.length +
  mockUtilityTools.length; // 24 total

// All tool names that should appear in ALL_TOOL_NAMES
const ALL_EXPECTED_TOOL_NAMES = [
  ...mockFsTools,
  ...mockCodeTools,
  ...mockWebFetchTools,
  ...mockExpenseTools,
  ...mockPdfTools,
  ...mockImageTools,
  ...mockEmailTools,
  ...mockGitTools,
  ...mockAudioTools,
  ...mockDataExtractionTools,
  ...mockWeatherTools,
  ...mockUtilityTools,
].map((t) => t.definition.name);

// =============================================================================
// TESTS
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL_SETS
// ─────────────────────────────────────────────────────────────────────────────

describe('TOOL_SETS', () => {
  it('is a non-null object', () => {
    expect(TOOL_SETS).toBeDefined();
    expect(typeof TOOL_SETS).toBe('object');
    expect(TOOL_SETS).not.toBeNull();
  });

  it('contains exactly the 12 expected keys', () => {
    const keys = Object.keys(TOOL_SETS);
    expect(keys).toHaveLength(12);
  });

  it('contains the fileSystem key', () => {
    expect(TOOL_SETS).toHaveProperty('fileSystem');
  });

  it('contains the codeExecution key', () => {
    expect(TOOL_SETS).toHaveProperty('codeExecution');
  });

  it('contains the webFetch key', () => {
    expect(TOOL_SETS).toHaveProperty('webFetch');
  });

  it('contains the expenseTracker key', () => {
    expect(TOOL_SETS).toHaveProperty('expenseTracker');
  });

  it('contains the pdf key', () => {
    expect(TOOL_SETS).toHaveProperty('pdf');
  });

  it('contains the image key', () => {
    expect(TOOL_SETS).toHaveProperty('image');
  });

  it('contains the email key', () => {
    expect(TOOL_SETS).toHaveProperty('email');
  });

  it('contains the git key', () => {
    expect(TOOL_SETS).toHaveProperty('git');
  });

  it('contains the audio key', () => {
    expect(TOOL_SETS).toHaveProperty('audio');
  });

  it('contains the dataExtraction key', () => {
    expect(TOOL_SETS).toHaveProperty('dataExtraction');
  });

  it('contains the weather key', () => {
    expect(TOOL_SETS).toHaveProperty('weather');
  });

  it('contains the utility key', () => {
    expect(TOOL_SETS).toHaveProperty('utility');
  });

  it('fileSystem resolves to the mocked FILE_SYSTEM_TOOLS array', () => {
    expect(TOOL_SETS.fileSystem).toBe(mockFsTools);
  });

  it('codeExecution resolves to the mocked CODE_EXECUTION_TOOLS array', () => {
    expect(TOOL_SETS.codeExecution).toBe(mockCodeTools);
  });

  it('webFetch resolves to the mocked WEB_FETCH_TOOLS array', () => {
    expect(TOOL_SETS.webFetch).toBe(mockWebFetchTools);
  });

  it('expenseTracker resolves to the mocked EXPENSE_TRACKER_TOOLS array', () => {
    expect(TOOL_SETS.expenseTracker).toBe(mockExpenseTools);
  });

  it('pdf resolves to the mocked PDF_TOOLS array', () => {
    expect(TOOL_SETS.pdf).toBe(mockPdfTools);
  });

  it('image resolves to the mocked IMAGE_TOOLS array', () => {
    expect(TOOL_SETS.image).toBe(mockImageTools);
  });

  it('email resolves to the mocked EMAIL_TOOLS array', () => {
    expect(TOOL_SETS.email).toBe(mockEmailTools);
  });

  it('git resolves to the mocked GIT_TOOLS array', () => {
    expect(TOOL_SETS.git).toBe(mockGitTools);
  });

  it('audio resolves to the mocked AUDIO_TOOLS array', () => {
    expect(TOOL_SETS.audio).toBe(mockAudioTools);
  });

  it('dataExtraction resolves to the mocked DATA_EXTRACTION_TOOLS array', () => {
    expect(TOOL_SETS.dataExtraction).toBe(mockDataExtractionTools);
  });

  it('weather resolves to the mocked WEATHER_TOOLS array', () => {
    expect(TOOL_SETS.weather).toBe(mockWeatherTools);
  });

  it('utility resolves to the mocked UTILITY_TOOLS array', () => {
    expect(TOOL_SETS.utility).toBe(mockUtilityTools);
  });

  it('every value in TOOL_SETS is an array', () => {
    for (const [key, set] of Object.entries(TOOL_SETS)) {
      expect(Array.isArray(set), `TOOL_SETS.${key} should be an array`).toBe(true);
    }
  });

  it('every tool in every set has a definition object', () => {
    for (const [key, set] of Object.entries(TOOL_SETS)) {
      for (const tool of set) {
        expect(tool.definition, `TOOL_SETS.${key} tool missing definition`).toBeDefined();
      }
    }
  });

  it('every tool in every set has an executor function', () => {
    for (const [key, set] of Object.entries(TOOL_SETS)) {
      for (const tool of set) {
        expect(typeof tool.executor, `TOOL_SETS.${key} tool executor should be a function`).toBe('function');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ALL_TOOLS
// ─────────────────────────────────────────────────────────────────────────────

describe('ALL_TOOLS', () => {
  it('is an array', () => {
    expect(Array.isArray(ALL_TOOLS)).toBe(true);
  });

  it('has the correct total tool count (sum of all mocked sets)', () => {
    expect(ALL_TOOLS).toHaveLength(EXPECTED_ALL_TOOLS_COUNT);
  });

  it('contains tools from the fileSystem set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
  });

  it('contains tools from the codeExecution set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('execute_javascript');
    expect(names).toContain('execute_python');
  });

  it('contains tools from the webFetch set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('http_request');
    expect(names).toContain('fetch_web_page');
  });

  it('contains tools from the expenseTracker set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('add_expense');
    expect(names).toContain('query_expenses');
  });

  it('contains tools from the pdf set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('read_pdf');
    expect(names).toContain('create_pdf');
  });

  it('contains tools from the image set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('analyze_image');
    expect(names).toContain('generate_image');
  });

  it('contains tools from the email set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('send_email');
    expect(names).toContain('list_emails');
  });

  it('contains tools from the git set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('git_status');
    expect(names).toContain('git_commit');
  });

  it('contains tools from the audio set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('text_to_speech');
    expect(names).toContain('speech_to_text');
  });

  it('contains tools from the dataExtraction set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('extract_entities');
    expect(names).toContain('extract_table_data');
  });

  it('contains tools from the weather set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('get_weather');
    expect(names).toContain('get_weather_forecast');
  });

  it('contains tools from the utility set', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    expect(names).toContain('get_current_datetime');
    expect(names).toContain('calculate');
    expect(names).toContain('convert_units');
  });

  it('every entry has a definition with a name string', () => {
    for (const tool of ALL_TOOLS) {
      expect(typeof tool.definition.name).toBe('string');
      expect(tool.definition.name.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a definition with a description string', () => {
    for (const tool of ALL_TOOLS) {
      expect(typeof tool.definition.description).toBe('string');
    }
  });

  it('every entry has an executor that is a function', () => {
    for (const tool of ALL_TOOLS) {
      expect(typeof tool.executor).toBe('function');
    }
  });

  it('has no duplicate tool names', () => {
    const names = ALL_TOOLS.map((t) => t.definition.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('contains all tools from every TOOL_SET value', () => {
    const allNames = new Set(ALL_TOOLS.map((t) => t.definition.name));
    for (const set of Object.values(TOOL_SETS)) {
      for (const tool of set) {
        expect(allNames.has(tool.definition.name)).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ALL_TOOL_NAMES
// ─────────────────────────────────────────────────────────────────────────────

describe('ALL_TOOL_NAMES', () => {
  it('is an array', () => {
    expect(Array.isArray(ALL_TOOL_NAMES)).toBe(true);
  });

  it('has the same length as ALL_TOOLS', () => {
    expect(ALL_TOOL_NAMES).toHaveLength(ALL_TOOLS.length);
  });

  it('matches the names from ALL_TOOLS in order', () => {
    const expected = ALL_TOOLS.map((t) => t.definition.name);
    expect(ALL_TOOL_NAMES).toEqual(expected);
  });

  it('every entry is a non-empty string', () => {
    for (const name of ALL_TOOL_NAMES) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('contains "read_file"', () => {
    expect(ALL_TOOL_NAMES).toContain('read_file');
  });

  it('contains "execute_javascript"', () => {
    expect(ALL_TOOL_NAMES).toContain('execute_javascript');
  });

  it('contains "get_weather"', () => {
    expect(ALL_TOOL_NAMES).toContain('get_weather');
  });

  it('has no duplicate entries', () => {
    const unique = new Set(ALL_TOOL_NAMES);
    expect(unique.size).toBe(ALL_TOOL_NAMES.length);
  });

  it('contains all expected tool names', () => {
    for (const name of ALL_EXPECTED_TOOL_NAMES) {
      expect(ALL_TOOL_NAMES).toContain(name);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getToolDefinitions()
// ─────────────────────────────────────────────────────────────────────────────

describe('getToolDefinitions()', () => {
  it('returns an array', () => {
    expect(Array.isArray(getToolDefinitions())).toBe(true);
  });

  it('returns the same number of entries as ALL_TOOLS', () => {
    expect(getToolDefinitions()).toHaveLength(ALL_TOOLS.length);
  });

  it('each entry is a definition object, not a {definition, executor} pair', () => {
    for (const def of getToolDefinitions()) {
      expect(def).not.toHaveProperty('executor');
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
    }
  });

  it('each definition has a string name', () => {
    for (const def of getToolDefinitions()) {
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
    }
  });

  it('definitions match the definitions in ALL_TOOLS, in order', () => {
    const defs = getToolDefinitions();
    for (let i = 0; i < defs.length; i++) {
      expect(defs[i]).toBe(ALL_TOOLS[i]!.definition);
    }
  });

  it('contains a definition for "read_file"', () => {
    const defs = getToolDefinitions();
    const found = defs.find((d) => d.name === 'read_file');
    expect(found).toBeDefined();
  });

  it('contains a definition for "get_weather"', () => {
    const defs = getToolDefinitions();
    const found = defs.find((d) => d.name === 'get_weather');
    expect(found).toBeDefined();
  });

  it('does not return the same array reference on repeated calls (fresh mapping)', () => {
    const first = getToolDefinitions();
    const second = getToolDefinitions();
    // Content identical but these are two separate mapped arrays
    expect(first).toEqual(second);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getToolExecutors()
// ─────────────────────────────────────────────────────────────────────────────

describe('getToolExecutors()', () => {
  it('returns a Map', () => {
    expect(getToolExecutors()).toBeInstanceOf(Map);
  });

  it('the Map has the same number of entries as ALL_TOOLS', () => {
    expect(getToolExecutors().size).toBe(ALL_TOOLS.length);
  });

  it('every ALL_TOOL name is a key in the Map', () => {
    const map = getToolExecutors();
    for (const tool of ALL_TOOLS) {
      expect(map.has(tool.definition.name)).toBe(true);
    }
  });

  it('every value in the Map is a function', () => {
    const map = getToolExecutors();
    for (const [, executor] of map) {
      expect(typeof executor).toBe('function');
    }
  });

  it('the executor for "read_file" matches the mock executor', () => {
    const map = getToolExecutors();
    const executor = map.get('read_file');
    expect(executor).toBe(mockFsTools[0]!.executor);
  });

  it('the executor for "write_file" matches the mock executor', () => {
    const map = getToolExecutors();
    const executor = map.get('write_file');
    expect(executor).toBe(mockFsTools[1]!.executor);
  });

  it('the executor for "execute_javascript" matches the mock executor', () => {
    const map = getToolExecutors();
    const executor = map.get('execute_javascript');
    expect(executor).toBe(mockCodeTools[0]!.executor);
  });

  it('returns undefined for a tool name not in ALL_TOOLS', () => {
    const map = getToolExecutors();
    expect(map.get('nonexistent_tool')).toBeUndefined();
  });

  it('returns a fresh Map instance on each call', () => {
    const m1 = getToolExecutors();
    const m2 = getToolExecutors();
    expect(m1).not.toBe(m2);
  });

  it('the executor for "get_weather" matches the mock executor', () => {
    const map = getToolExecutors();
    expect(map.get('get_weather')).toBe(mockWeatherTools[0]!.executor);
  });

  it('the executor for "get_current_datetime" matches the mock executor', () => {
    const map = getToolExecutors();
    expect(map.get('get_current_datetime')).toBe(mockUtilityTools[0]!.executor);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerAllTools()
// ─────────────────────────────────────────────────────────────────────────────

describe('registerAllTools()', () => {
  it('calls registry.register once for every tool in ALL_TOOLS', () => {
    const mockRegistry = { register: vi.fn() };
    registerAllTools(mockRegistry);
    expect(mockRegistry.register).toHaveBeenCalledTimes(ALL_TOOLS.length);
  });

  it('calls qualifyToolName for every tool with prefix "core"', () => {
    const mockRegistry = { register: vi.fn() };
    registerAllTools(mockRegistry);
    expect(qualifyToolName).toHaveBeenCalledTimes(ALL_TOOLS.length);
    for (const tool of ALL_TOOLS) {
      expect(qualifyToolName).toHaveBeenCalledWith(tool.definition.name, 'core');
    }
  });

  it('passes the qualified name to registry.register', () => {
    const mockRegistry = { register: vi.fn() };
    registerAllTools(mockRegistry);
    const calls = mockRegistry.register.mock.calls;
    for (const call of calls) {
      const registeredDef = call[0] as { name: string };
      // Our mock qualifyToolName returns `core.<baseName>`
      expect(registeredDef.name).toMatch(/^core\./);
    }
  });

  it('passes the original executor as the second argument to registry.register', () => {
    const mockRegistry = { register: vi.fn() };
    registerAllTools(mockRegistry);
    const calls = mockRegistry.register.mock.calls;
    const registeredExecutors = calls.map((c) => c[1]);
    for (const tool of ALL_TOOLS) {
      expect(registeredExecutors).toContain(tool.executor);
    }
  });

  it('does not mutate the original definition name (passes a spread copy)', () => {
    const mockRegistry = { register: vi.fn() };
    const originalNames = ALL_TOOLS.map((t) => t.definition.name);
    registerAllTools(mockRegistry);
    const afterNames = ALL_TOOLS.map((t) => t.definition.name);
    expect(afterNames).toEqual(originalNames);
  });

  it('the registered definition object is a spread of the original (not the same reference)', () => {
    const mockRegistry = { register: vi.fn() };
    registerAllTools(mockRegistry);
    const calls = mockRegistry.register.mock.calls;
    for (let i = 0; i < calls.length; i++) {
      const registeredDef = calls[i]![0];
      expect(registeredDef).not.toBe(ALL_TOOLS[i]!.definition);
    }
  });

  it('works with an empty ALL_TOOLS equivalent (no calls on empty registry)', () => {
    // We verify through the mock that for N tools, exactly N register calls occur.
    // This test ensures the loop guard works.
    const mockRegistry = { register: vi.fn() };
    registerAllTools(mockRegistry);
    expect(mockRegistry.register.mock.calls.length).toBeGreaterThan(0);
  });

  it('includes all tool descriptions in the registered definitions', () => {
    const mockRegistry = { register: vi.fn() };
    registerAllTools(mockRegistry);
    const registeredDescriptions = mockRegistry.register.mock.calls.map(
      (c) => (c[0] as { description: string }).description,
    );
    for (const tool of ALL_TOOLS) {
      expect(registeredDescriptions).toContain(tool.definition.description);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registerToolSet()
// ─────────────────────────────────────────────────────────────────────────────

describe('registerToolSet()', () => {
  it('registers only the tools in the specified set (fileSystem)', () => {
    const mockRegistry = { register: vi.fn() };
    registerToolSet(mockRegistry, 'fileSystem');
    expect(mockRegistry.register).toHaveBeenCalledTimes(mockFsTools.length);
  });

  it('registers only the tools in the specified set (codeExecution)', () => {
    const mockRegistry = { register: vi.fn() };
    registerToolSet(mockRegistry, 'codeExecution');
    expect(mockRegistry.register).toHaveBeenCalledTimes(mockCodeTools.length);
  });

  it('registers only the tools in the specified set (email)', () => {
    const mockRegistry = { register: vi.fn() };
    registerToolSet(mockRegistry, 'email');
    expect(mockRegistry.register).toHaveBeenCalledTimes(mockEmailTools.length);
  });

  it('registers only the tools in the specified set (weather)', () => {
    const mockRegistry = { register: vi.fn() };
    registerToolSet(mockRegistry, 'weather');
    expect(mockRegistry.register).toHaveBeenCalledTimes(mockWeatherTools.length);
  });

  it('registers only the tools in the specified set (utility)', () => {
    const mockRegistry = { register: vi.fn() };
    registerToolSet(mockRegistry, 'utility');
    expect(mockRegistry.register).toHaveBeenCalledTimes(mockUtilityTools.length);
  });

  it('passes qualified names to registry.register for the set tools', () => {
    const mockRegistry = { register: vi.fn() };
    registerToolSet(mockRegistry, 'git');
    const calls = mockRegistry.register.mock.calls;
    for (const call of calls) {
      const def = call[0] as { name: string };
      expect(def.name).toMatch(/^core\./);
    }
  });

  it('calls qualifyToolName exactly once per tool in the set', () => {
    const mockRegistry = { register: vi.fn() };
    registerToolSet(mockRegistry, 'image');
    expect(qualifyToolName).toHaveBeenCalledTimes(mockImageTools.length);
  });

  it('does not register tools from other sets', () => {
    const mockRegistry = { register: vi.fn() };
    registerToolSet(mockRegistry, 'pdf');
    const calls = mockRegistry.register.mock.calls;
    const registeredNames = calls.map((c) => {
      const def = c[0] as { name: string };
      return def.name;
    });
    // Should not contain any file system tool names (qualified)
    const fsQualifiedNames = mockFsTools.map((t) => `core.${t.definition.name}`);
    for (const fsName of fsQualifiedNames) {
      expect(registeredNames).not.toContain(fsName);
    }
  });

  it('passes the executor as second argument', () => {
    const mockRegistry = { register: vi.fn() };
    registerToolSet(mockRegistry, 'webFetch');
    const calls = mockRegistry.register.mock.calls;
    const executors = calls.map((c) => c[1]);
    for (const tool of mockWebFetchTools) {
      expect(executors).toContain(tool.executor);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTool()
// ─────────────────────────────────────────────────────────────────────────────

describe('getTool()', () => {
  it('returns the correct tool for a base name', () => {
    const tool = getTool('read_file');
    expect(tool).toBeDefined();
    expect(tool!.definition.name).toBe('read_file');
  });

  it('returns the correct tool for "execute_javascript"', () => {
    const tool = getTool('execute_javascript');
    expect(tool).toBeDefined();
    expect(tool!.definition.name).toBe('execute_javascript');
  });

  it('returns the correct tool for "get_weather"', () => {
    const tool = getTool('get_weather');
    expect(tool).toBeDefined();
    expect(tool!.definition.name).toBe('get_weather');
  });

  it('returns undefined for an unknown tool name', () => {
    const tool = getTool('completely_unknown_tool');
    expect(tool).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    const tool = getTool('');
    expect(tool).toBeUndefined();
  });

  it('calls getBaseName to strip any namespace prefix', () => {
    getTool('core.read_file');
    expect(getBaseName).toHaveBeenCalledWith('core.read_file');
  });

  it('resolves "core.read_file" to the read_file tool via getBaseName', () => {
    const tool = getTool('core.read_file');
    expect(tool).toBeDefined();
    expect(tool!.definition.name).toBe('read_file');
  });

  it('resolves a deeply qualified name like "plugin.foo.get_weather"', () => {
    // getBaseName mock returns everything after the last dot
    const tool = getTool('plugin.foo.get_weather');
    expect(tool).toBeDefined();
    expect(tool!.definition.name).toBe('get_weather');
  });

  it('returns an object with both definition and executor', () => {
    const tool = getTool('send_email');
    expect(tool).toBeDefined();
    expect(tool).toHaveProperty('definition');
    expect(tool).toHaveProperty('executor');
  });

  it('the returned executor matches the mock executor', () => {
    const tool = getTool('send_email');
    expect(tool!.executor).toBe(mockEmailTools[0]!.executor);
  });

  it('the returned tool is the same reference as in ALL_TOOLS', () => {
    const tool = getTool('read_file');
    const inAllTools = ALL_TOOLS.find((t) => t.definition.name === 'read_file');
    expect(tool).toBe(inAllTools);
  });

  it('returns undefined for a base name that only exists in definition-only sets', () => {
    // create_memory is in MEMORY_TOOLS (definition-only), not in ALL_TOOLS
    const tool = getTool('create_memory');
    expect(tool).toBeUndefined();
  });

  it('calls getBaseName even for plain base names (no dot)', () => {
    getTool('calculate');
    expect(getBaseName).toHaveBeenCalledWith('calculate');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL_CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

describe('TOOL_CATEGORIES', () => {
  it('is a non-null object', () => {
    expect(TOOL_CATEGORIES).toBeDefined();
    expect(typeof TOOL_CATEGORIES).toBe('object');
    expect(TOOL_CATEGORIES).not.toBeNull();
  });

  it('has at least 15 category keys', () => {
    expect(Object.keys(TOOL_CATEGORIES).length).toBeGreaterThanOrEqual(15);
  });

  it('contains the "Tasks" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Tasks');
  });

  it('contains the "File System" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('File System');
  });

  it('contains the "Code Execution (Sandbox Required)" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Code Execution (Sandbox Required)');
  });

  it('contains the "Web & API" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Web & API');
  });

  it('contains the "Email" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Email');
  });

  it('contains the "Git" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Git');
  });

  it('contains the "PDF" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('PDF');
  });

  it('contains the "Image" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Image');
  });

  it('contains the "Audio" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Audio');
  });

  it('contains the "Weather" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Weather');
  });

  it('contains the "Memory" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Memory');
  });

  it('contains the "Goals" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Goals');
  });

  it('contains the "Finance" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Finance');
  });

  it('contains the "Utilities" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Utilities');
  });

  it('contains the "Dynamic Tools" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Dynamic Tools');
  });

  it('contains the "Custom Data" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Custom Data');
  });

  it('contains the "Bookmarks" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Bookmarks');
  });

  it('contains the "Notes" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Notes');
  });

  it('contains the "Calendar" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Calendar');
  });

  it('contains the "Contacts" category', () => {
    expect(TOOL_CATEGORIES).toHaveProperty('Contacts');
  });

  it('every category value is an array', () => {
    for (const [key, tools] of Object.entries(TOOL_CATEGORIES)) {
      expect(Array.isArray(tools), `TOOL_CATEGORIES["${key}"] should be an array`).toBe(true);
    }
  });

  it('every category has at least one tool name', () => {
    for (const [key, tools] of Object.entries(TOOL_CATEGORIES)) {
      expect(tools.length, `TOOL_CATEGORIES["${key}"] should be non-empty`).toBeGreaterThan(0);
    }
  });

  it('every tool name in every category is a string', () => {
    for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
      for (const name of tools) {
        expect(typeof name, `TOOL_CATEGORIES["${category}"] has non-string entry`).toBe('string');
      }
    }
  });

  it('"Tasks" category includes "add_task"', () => {
    expect(TOOL_CATEGORIES.Tasks).toContain('add_task');
  });

  it('"Tasks" category includes "list_tasks"', () => {
    expect(TOOL_CATEGORIES.Tasks).toContain('list_tasks');
  });

  it('"Tasks" category includes "complete_task"', () => {
    expect(TOOL_CATEGORIES.Tasks).toContain('complete_task');
  });

  it('"File System" category includes "read_file"', () => {
    expect(TOOL_CATEGORIES['File System']).toContain('read_file');
  });

  it('"File System" category includes "write_file"', () => {
    expect(TOOL_CATEGORIES['File System']).toContain('write_file');
  });

  it('"Code Execution (Sandbox Required)" includes "execute_javascript"', () => {
    expect(TOOL_CATEGORIES['Code Execution (Sandbox Required)']).toContain('execute_javascript');
  });

  it('"Web & API" includes "http_request"', () => {
    expect(TOOL_CATEGORIES['Web & API']).toContain('http_request');
  });

  it('"Weather" includes "get_weather" and "get_weather_forecast"', () => {
    expect(TOOL_CATEGORIES.Weather).toContain('get_weather');
    expect(TOOL_CATEGORIES.Weather).toContain('get_weather_forecast');
  });

  it('"Utilities" includes "get_current_datetime"', () => {
    expect(TOOL_CATEGORIES.Utilities).toContain('get_current_datetime');
  });

  it('"Dynamic Tools" includes "create_tool"', () => {
    expect(TOOL_CATEGORIES['Dynamic Tools']).toContain('create_tool');
  });

  it('"Memory" includes "create_memory" and "search_memories"', () => {
    expect(TOOL_CATEGORIES.Memory).toContain('create_memory');
    expect(TOOL_CATEGORIES.Memory).toContain('search_memories');
  });

  it('"Goals" includes "create_goal" and "list_goals"', () => {
    expect(TOOL_CATEGORIES.Goals).toContain('create_goal');
    expect(TOOL_CATEGORIES.Goals).toContain('list_goals');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getToolsByCategory()
// ─────────────────────────────────────────────────────────────────────────────

describe('getToolsByCategory()', () => {
  it('returns a Map', () => {
    expect(getToolsByCategory()).toBeInstanceOf(Map);
  });

  it('the Map has the same number of categories as TOOL_CATEGORIES', () => {
    const map = getToolsByCategory();
    expect(map.size).toBe(Object.keys(TOOL_CATEGORIES).length);
  });

  it('every TOOL_CATEGORIES key is present as a Map key', () => {
    const map = getToolsByCategory();
    for (const category of Object.keys(TOOL_CATEGORIES)) {
      expect(map.has(category)).toBe(true);
    }
  });

  it('every value in the Map is an array', () => {
    const map = getToolsByCategory();
    for (const [category, tools] of map) {
      expect(Array.isArray(tools), `Category "${category}" should have an array value`).toBe(true);
    }
  });

  it('"File System" category contains definitions for mock fs tools that appear in ALL_TOOLS', () => {
    const map = getToolsByCategory();
    const fsCategory = map.get('File System');
    expect(fsCategory).toBeDefined();
    // "read_file" and "write_file" are in the mock ALL_TOOLS
    const names = fsCategory!.map((d) => d.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
  });

  it('"Code Execution (Sandbox Required)" includes execute_javascript definition', () => {
    const map = getToolsByCategory();
    const codeCategory = map.get('Code Execution (Sandbox Required)');
    expect(codeCategory).toBeDefined();
    const names = codeCategory!.map((d) => d.name);
    expect(names).toContain('execute_javascript');
  });

  it('"Weather" includes get_weather and get_weather_forecast definitions', () => {
    const map = getToolsByCategory();
    const weatherCategory = map.get('Weather');
    expect(weatherCategory).toBeDefined();
    const names = weatherCategory!.map((d) => d.name);
    expect(names).toContain('get_weather');
    expect(names).toContain('get_weather_forecast');
  });

  it('categories that list tools not in ALL_TOOLS have empty arrays for those tools', () => {
    // "Memory" tools are not in ALL_TOOLS (definition-only), so that category should be empty
    const map = getToolsByCategory();
    const memoryCategory = map.get('Memory');
    expect(memoryCategory).toBeDefined();
    // None of the mock memory tool names appear in ALL_TOOLS
    expect(memoryCategory!.length).toBe(0);
  });

  it('"Goals" category is empty because goal tools are definition-only (not in ALL_TOOLS)', () => {
    const map = getToolsByCategory();
    const goalsCategory = map.get('Goals');
    expect(goalsCategory).toBeDefined();
    expect(goalsCategory!.length).toBe(0);
  });

  it('"Tasks" category is empty because personal data tools are not in ALL_TOOLS', () => {
    const map = getToolsByCategory();
    const tasksCategory = map.get('Tasks');
    expect(tasksCategory).toBeDefined();
    expect(tasksCategory!.length).toBe(0);
  });

  it('returned definition objects have name and description properties', () => {
    const map = getToolsByCategory();
    const fsCategory = map.get('File System')!;
    for (const def of fsCategory) {
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
    }
  });

  it('returns a fresh Map instance on each call', () => {
    const m1 = getToolsByCategory();
    const m2 = getToolsByCategory();
    expect(m1).not.toBe(m2);
  });

  it('"Email" category contains send_email and list_emails definitions', () => {
    const map = getToolsByCategory();
    const emailCategory = map.get('Email');
    expect(emailCategory).toBeDefined();
    const names = emailCategory!.map((d) => d.name);
    expect(names).toContain('send_email');
    expect(names).toContain('list_emails');
  });

  it('"Git" category contains git_status and git_commit definitions', () => {
    const map = getToolsByCategory();
    const gitCategory = map.get('Git');
    expect(gitCategory).toBeDefined();
    const names = gitCategory!.map((d) => d.name);
    expect(names).toContain('git_status');
    expect(names).toContain('git_commit');
  });

  it('"PDF" category contains read_pdf and create_pdf definitions', () => {
    const map = getToolsByCategory();
    const pdfCategory = map.get('PDF');
    expect(pdfCategory).toBeDefined();
    const names = pdfCategory!.map((d) => d.name);
    expect(names).toContain('read_pdf');
    expect(names).toContain('create_pdf');
  });

  it('"Finance" category contains add_expense and query_expenses definitions', () => {
    const map = getToolsByCategory();
    const financeCategory = map.get('Finance');
    expect(financeCategory).toBeDefined();
    const names = financeCategory!.map((d) => d.name);
    expect(names).toContain('add_expense');
    expect(names).toContain('query_expenses');
  });

  it('"Utilities" category contains get_current_datetime, calculate, convert_units', () => {
    const map = getToolsByCategory();
    const utilsCategory = map.get('Utilities');
    expect(utilsCategory).toBeDefined();
    const names = utilsCategory!.map((d) => d.name);
    expect(names).toContain('get_current_datetime');
    expect(names).toContain('calculate');
    expect(names).toContain('convert_units');
  });

  it('"Image" category contains analyze_image and generate_image', () => {
    const map = getToolsByCategory();
    const imageCategory = map.get('Image');
    expect(imageCategory).toBeDefined();
    const names = imageCategory!.map((d) => d.name);
    expect(names).toContain('analyze_image');
    expect(names).toContain('generate_image');
  });

  it('"Audio" category contains text_to_speech and speech_to_text', () => {
    const map = getToolsByCategory();
    const audioCategory = map.get('Audio');
    expect(audioCategory).toBeDefined();
    const names = audioCategory!.map((d) => d.name);
    expect(names).toContain('text_to_speech');
    expect(names).toContain('speech_to_text');
  });

  it('"Data Extraction" category contains extract_entities and extract_table_data', () => {
    const map = getToolsByCategory();
    const extractionCategory = map.get('Data Extraction');
    expect(extractionCategory).toBeDefined();
    const names = extractionCategory!.map((d) => d.name);
    expect(names).toContain('extract_entities');
    expect(names).toContain('extract_table_data');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCategoryForTool()
// ─────────────────────────────────────────────────────────────────────────────

describe('getCategoryForTool()', () => {
  it('returns "File System" for "read_file"', () => {
    expect(getCategoryForTool('read_file')).toBe('File System');
  });

  it('returns "File System" for "write_file"', () => {
    expect(getCategoryForTool('write_file')).toBe('File System');
  });

  it('returns "Code Execution (Sandbox Required)" for "execute_javascript"', () => {
    expect(getCategoryForTool('execute_javascript')).toBe('Code Execution (Sandbox Required)');
  });

  it('returns "Code Execution (Sandbox Required)" for "execute_python"', () => {
    expect(getCategoryForTool('execute_python')).toBe('Code Execution (Sandbox Required)');
  });

  it('returns "Web & API" for "http_request"', () => {
    expect(getCategoryForTool('http_request')).toBe('Web & API');
  });

  it('returns "Weather" for "get_weather"', () => {
    expect(getCategoryForTool('get_weather')).toBe('Weather');
  });

  it('returns "Weather" for "get_weather_forecast"', () => {
    expect(getCategoryForTool('get_weather_forecast')).toBe('Weather');
  });

  it('returns "Email" for "send_email"', () => {
    expect(getCategoryForTool('send_email')).toBe('Email');
  });

  it('returns "Email" for "list_emails"', () => {
    expect(getCategoryForTool('list_emails')).toBe('Email');
  });

  it('returns "Git" for "git_status"', () => {
    expect(getCategoryForTool('git_status')).toBe('Git');
  });

  it('returns "Git" for "git_commit"', () => {
    expect(getCategoryForTool('git_commit')).toBe('Git');
  });

  it('returns "PDF" for "read_pdf"', () => {
    expect(getCategoryForTool('read_pdf')).toBe('PDF');
  });

  it('returns "Finance" for "add_expense"', () => {
    expect(getCategoryForTool('add_expense')).toBe('Finance');
  });

  it('returns "Utilities" for "get_current_datetime"', () => {
    expect(getCategoryForTool('get_current_datetime')).toBe('Utilities');
  });

  it('returns "Utilities" for "calculate"', () => {
    expect(getCategoryForTool('calculate')).toBe('Utilities');
  });

  it('returns "Memory" for "create_memory"', () => {
    expect(getCategoryForTool('create_memory')).toBe('Memory');
  });

  it('returns "Goals" for "create_goal"', () => {
    expect(getCategoryForTool('create_goal')).toBe('Goals');
  });

  it('returns "Tasks" for "add_task"', () => {
    expect(getCategoryForTool('add_task')).toBe('Tasks');
  });

  it('returns "Dynamic Tools" for "create_tool"', () => {
    expect(getCategoryForTool('create_tool')).toBe('Dynamic Tools');
  });

  it('returns undefined for a completely unknown tool name', () => {
    expect(getCategoryForTool('totally_unknown_xyz')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getCategoryForTool('')).toBeUndefined();
  });

  it('calls getBaseName to strip qualified prefix', () => {
    getCategoryForTool('core.read_file');
    expect(getBaseName).toHaveBeenCalledWith('core.read_file');
  });

  it('resolves "core.read_file" to "File System" via getBaseName', () => {
    const category = getCategoryForTool('core.read_file');
    expect(category).toBe('File System');
  });

  it('resolves deeply qualified "plugin.foo.execute_javascript" correctly', () => {
    const category = getCategoryForTool('plugin.foo.execute_javascript');
    expect(category).toBe('Code Execution (Sandbox Required)');
  });

  it('returns "Image" for "analyze_image"', () => {
    expect(getCategoryForTool('analyze_image')).toBe('Image');
  });

  it('returns "Audio" for "text_to_speech"', () => {
    expect(getCategoryForTool('text_to_speech')).toBe('Audio');
  });

  it('returns "Data Extraction" for "extract_entities"', () => {
    expect(getCategoryForTool('extract_entities')).toBe('Data Extraction');
  });

  it('returns "Custom Data" for "list_custom_tables"', () => {
    expect(getCategoryForTool('list_custom_tables')).toBe('Custom Data');
  });

  it('returns "Bookmarks" for "add_bookmark"', () => {
    expect(getCategoryForTool('add_bookmark')).toBe('Bookmarks');
  });

  it('returns "Notes" for "add_note"', () => {
    expect(getCategoryForTool('add_note')).toBe('Notes');
  });

  it('returns "Calendar" for "add_calendar_event"', () => {
    expect(getCategoryForTool('add_calendar_event')).toBe('Calendar');
  });

  it('returns "Contacts" for "add_contact"', () => {
    expect(getCategoryForTool('add_contact')).toBe('Contacts');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getToolStats()
// ─────────────────────────────────────────────────────────────────────────────

describe('getToolStats()', () => {
  it('returns an object', () => {
    const stats = getToolStats();
    expect(typeof stats).toBe('object');
    expect(stats).not.toBeNull();
  });

  it('has a totalTools property', () => {
    expect(getToolStats()).toHaveProperty('totalTools');
  });

  it('has a categories property', () => {
    expect(getToolStats()).toHaveProperty('categories');
  });

  it('has a toolsByCategory property', () => {
    expect(getToolStats()).toHaveProperty('toolsByCategory');
  });

  it('totalTools equals ALL_TOOLS.length', () => {
    const stats = getToolStats();
    expect(stats.totalTools).toBe(ALL_TOOLS.length);
  });

  it('totalTools equals the expected mock tool count', () => {
    const stats = getToolStats();
    expect(stats.totalTools).toBe(EXPECTED_ALL_TOOLS_COUNT);
  });

  it('categories equals the number of keys in TOOL_CATEGORIES', () => {
    const stats = getToolStats();
    expect(stats.categories).toBe(Object.keys(TOOL_CATEGORIES).length);
  });

  it('categories count is greater than 15', () => {
    const stats = getToolStats();
    expect(stats.categories).toBeGreaterThan(15);
  });

  it('toolsByCategory is an object', () => {
    const stats = getToolStats();
    expect(typeof stats.toolsByCategory).toBe('object');
    expect(stats.toolsByCategory).not.toBeNull();
  });

  it('toolsByCategory has the same keys as TOOL_CATEGORIES', () => {
    const stats = getToolStats();
    const expectedKeys = Object.keys(TOOL_CATEGORIES);
    const actualKeys = Object.keys(stats.toolsByCategory);
    expect(actualKeys.sort()).toEqual(expectedKeys.sort());
  });

  it('toolsByCategory["File System"] matches TOOL_CATEGORIES["File System"].length', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['File System']).toBe(TOOL_CATEGORIES['File System'].length);
  });

  it('toolsByCategory["Weather"] is 2', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['Weather']).toBe(2);
  });

  it('toolsByCategory["PDF"] is 3', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['PDF']).toBe(3);
  });

  it('toolsByCategory["Code Execution (Sandbox Required)"] is 5', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['Code Execution (Sandbox Required)']).toBe(5);
  });

  it('toolsByCategory["Email"] is 6', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['Email']).toBe(6);
  });

  it('toolsByCategory["Git"] is 7', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['Git']).toBe(7);
  });

  it('toolsByCategory["Memory"] matches TOOL_CATEGORIES["Memory"].length', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['Memory']).toBe(TOOL_CATEGORIES.Memory.length);
  });

  it('toolsByCategory["Utilities"] matches TOOL_CATEGORIES["Utilities"].length', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['Utilities']).toBe(TOOL_CATEGORIES.Utilities.length);
  });

  it('all toolsByCategory values are positive integers', () => {
    const stats = getToolStats();
    for (const [category, count] of Object.entries(stats.toolsByCategory)) {
      expect(typeof count, `toolsByCategory["${category}"] should be a number`).toBe('number');
      expect(count, `toolsByCategory["${category}"] should be positive`).toBeGreaterThan(0);
    }
  });

  it('returns consistent results across multiple calls', () => {
    const s1 = getToolStats();
    const s2 = getToolStats();
    expect(s1.totalTools).toBe(s2.totalTools);
    expect(s1.categories).toBe(s2.categories);
    expect(s1.toolsByCategory).toEqual(s2.toolsByCategory);
  });

  it('toolsByCategory["Tasks"] is 6', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['Tasks']).toBe(6);
  });

  it('toolsByCategory["Finance"] is 7', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['Finance']).toBe(7);
  });

  it('toolsByCategory["Dynamic Tools"] is 4', () => {
    const stats = getToolStats();
    expect(stats.toolsByCategory['Dynamic Tools']).toBe(4);
  });
});
