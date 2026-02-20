import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the dynamic import of the module under test
// ---------------------------------------------------------------------------

const mockHasServiceRegistry = vi.fn().mockReturnValue(false);
const mockGetServiceRegistry = vi.fn();

vi.mock('@ownpilot/core', () => ({
  hasServiceRegistry: (...args: unknown[]) => mockHasServiceRegistry(...args),
  getServiceRegistry: (...args: unknown[]) => mockGetServiceRegistry(...args),
  Services: { Message: 'message', Database: 'database' },
}));

vi.mock('../config/defaults.js', () => ({
  AI_META_TOOL_NAMES: ['search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool'],
}));

// Dynamically import so that the vi.mock calls above take effect first.
const {
  buildExecutionSystemPrompt,
  buildToolCatalog,
  generateDemoResponse,
  tryGetMessageBus,
  PERM_LABELS,
  MODE_LABELS,
  EXEC_CATEGORIES,
} = await import('./chat-prompt.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ExecutionPermissions object with sensible defaults. */
function makePerms(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    mode: 'local',
    execute_javascript: 'allowed',
    execute_python: 'allowed',
    execute_shell: 'prompt',
    compile_code: 'blocked',
    package_manager: 'blocked',
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Minimal ToolDefinition factory. */
function makeTool(overrides: Record<string, unknown> = {}) {
  return {
    name: 'my_tool',
    description: 'A custom tool',
    category: 'Custom',
    parameters: {},
    ...overrides,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('PERM_LABELS', () => {
  it('has all three permission keys', () => {
    expect(PERM_LABELS).toHaveProperty('blocked');
    expect(PERM_LABELS).toHaveProperty('prompt');
    expect(PERM_LABELS).toHaveProperty('allowed');
  });
});

describe('MODE_LABELS', () => {
  it('has all three mode keys', () => {
    expect(MODE_LABELS).toHaveProperty('local');
    expect(MODE_LABELS).toHaveProperty('docker');
    expect(MODE_LABELS).toHaveProperty('auto');
  });
});

describe('EXEC_CATEGORIES', () => {
  it('has exactly 5 entries', () => {
    expect(EXEC_CATEGORIES).toHaveLength(5);
  });

  it('contains all expected category names', () => {
    expect(EXEC_CATEGORIES).toContain('execute_javascript');
    expect(EXEC_CATEGORIES).toContain('execute_python');
    expect(EXEC_CATEGORIES).toContain('execute_shell');
    expect(EXEC_CATEGORIES).toContain('compile_code');
    expect(EXEC_CATEGORIES).toContain('package_manager');
  });
});

// ---------------------------------------------------------------------------
// buildExecutionSystemPrompt
// ---------------------------------------------------------------------------

describe('buildExecutionSystemPrompt', () => {
  it('returns DISABLED message when perms.enabled is false', () => {
    const result = buildExecutionSystemPrompt(makePerms({ enabled: false }));
    expect(result).toContain('DISABLED');
    expect(result).not.toContain('ENABLED');
  });

  it('returns ENABLED section when perms.enabled is true with local mode', () => {
    const result = buildExecutionSystemPrompt(makePerms({ mode: 'local' }));
    expect(result).toContain('ENABLED');
    expect(result).toContain('Local');
  });

  it('returns docker note when mode is docker', () => {
    const result = buildExecutionSystemPrompt(makePerms({ mode: 'docker' }));
    expect(result).toContain('compile_code and package_manager unavailable in Docker mode.');
  });

  it('does not include docker note when mode is local', () => {
    const result = buildExecutionSystemPrompt(makePerms({ mode: 'local' }));
    expect(result).not.toContain('compile_code and package_manager unavailable in Docker mode.');
  });

  it('does not include docker note when mode is auto', () => {
    const result = buildExecutionSystemPrompt(makePerms({ mode: 'auto' }));
    expect(result).not.toContain('compile_code and package_manager unavailable in Docker mode.');
  });

  it('returns Auto description when mode is auto', () => {
    const result = buildExecutionSystemPrompt(makePerms({ mode: 'auto' }));
    expect(result).toContain('Auto');
  });

  it('contains all 5 category names in the permissions line', () => {
    const result = buildExecutionSystemPrompt(makePerms());
    for (const cat of EXEC_CATEGORIES) {
      expect(result).toContain(cat);
    }
  });

  it('uses PERM_LABELS display values for each permission level', () => {
    const result = buildExecutionSystemPrompt(
      makePerms({
        execute_javascript: 'allowed',
        execute_python: 'prompt',
        execute_shell: 'blocked',
        compile_code: 'allowed',
        package_manager: 'blocked',
      })
    );
    expect(result).toContain(PERM_LABELS['allowed']!);
    expect(result).toContain(PERM_LABELS['prompt']!);
    expect(result).toContain(PERM_LABELS['blocked']!);
  });

  it('falls back to raw mode string for unknown mode', () => {
    const result = buildExecutionSystemPrompt(makePerms({ mode: 'wasm' }));
    expect(result).toContain('wasm');
  });
});

// ---------------------------------------------------------------------------
// generateDemoResponse
// ---------------------------------------------------------------------------

describe('generateDemoResponse', () => {
  it('detects "help" keyword and returns demo mode help response', () => {
    const result = generateDemoResponse('help me please', 'openai', 'gpt-4o');
    expect(result).toContain('demo mode');
    expect(result).toContain('OpenAI');
  });

  it('detects "what can you" phrase and returns same help response', () => {
    const result = generateDemoResponse('what can you do for me?', 'openai', 'gpt-4o');
    expect(result).toContain('demo mode');
    expect(result).toContain('OpenAI');
  });

  it('detects "capabilities" keyword and lists providers', () => {
    const result = generateDemoResponse('show me your capabilities', 'anthropic', 'claude-3');
    expect(result).toContain('Supported Providers');
    expect(result).toContain('Anthropic');
  });

  it('detects Turkish "yetenekler" keyword and returns capabilities response', () => {
    const result = generateDemoResponse('yetenekler neler?', 'anthropic', 'claude-3');
    expect(result).toContain('Supported Providers');
  });

  it('detects "tool" keyword and returns tools response', () => {
    const result = generateDemoResponse('what tools do you have?', 'openai', 'gpt-4o');
    expect(result).toContain('Tools in OwnPilot');
  });

  it('default message echoes user message and mentions provider/model', () => {
    const result = generateDemoResponse('hello world', 'openai', 'gpt-4o');
    expect(result).toContain('hello world');
    expect(result).toContain('OpenAI');
    expect(result).toContain('gpt-4o');
  });

  it('uses display name for known provider "openai"', () => {
    const result = generateDemoResponse('hello', 'openai', 'gpt-4o');
    expect(result).toContain('OpenAI');
  });

  it('uses display name for known provider "anthropic"', () => {
    const result = generateDemoResponse('hello', 'anthropic', 'claude-3');
    expect(result).toContain('Anthropic');
  });

  it('uses provider string as-is for unknown provider', () => {
    const result = generateDemoResponse('hello', 'my-custom-provider', 'v1');
    expect(result).toContain('my-custom-provider');
  });

  it('performs case-insensitive match for "HELP"', () => {
    const result = generateDemoResponse('HELP ME', 'openai', 'gpt-4o');
    expect(result).toContain('demo mode');
  });

  it('performs case-insensitive match for "Tool" (mixed case)', () => {
    const result = generateDemoResponse('Tool list please', 'openai', 'gpt-4o');
    expect(result).toContain('Tools in OwnPilot');
  });
});

// ---------------------------------------------------------------------------
// tryGetMessageBus
// ---------------------------------------------------------------------------

describe('tryGetMessageBus', () => {
  beforeEach(() => {
    mockHasServiceRegistry.mockReturnValue(false);
    mockGetServiceRegistry.mockReset();
  });

  it('returns null when hasServiceRegistry() returns false', () => {
    mockHasServiceRegistry.mockReturnValue(false);
    const result = tryGetMessageBus();
    expect(result).toBeNull();
  });

  it('returns MessageBus when registry is available', () => {
    const fakeMessageBus = { send: vi.fn() };
    mockHasServiceRegistry.mockReturnValue(true);
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue(fakeMessageBus),
    });

    const result = tryGetMessageBus();
    expect(result).toBe(fakeMessageBus);
  });

  it('returns null when registry.get throws', () => {
    mockHasServiceRegistry.mockReturnValue(true);
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockImplementation(() => {
        throw new Error('Service not found');
      }),
    });

    const result = tryGetMessageBus();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildToolCatalog
// ---------------------------------------------------------------------------

describe('buildToolCatalog', () => {
  beforeEach(() => {
    mockHasServiceRegistry.mockReturnValue(false);
    mockGetServiceRegistry.mockReset();
  });

  it('returns empty string when no custom tools and no tables', async () => {
    // Database service returns empty table list
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue({ listTables: vi.fn().mockResolvedValue([]) }),
    });

    const result = await buildToolCatalog([]);
    expect(result).toBe('');
  });

  it('lists custom tools when present', async () => {
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue({ listTables: vi.fn().mockResolvedValue([]) }),
    });

    const tool = makeTool({ name: 'my_custom_tool', description: 'Does something custom', category: 'Custom' });
    const result = await buildToolCatalog([tool]);

    expect(result).toContain('Active Custom Tools');
    expect(result).toContain('my_custom_tool');
  });

  it('uses brief when available instead of slicing description', async () => {
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue({ listTables: vi.fn().mockResolvedValue([]) }),
    });

    const tool = makeTool({
      name: 'brief_tool',
      description: 'A very long description that should not appear in the catalog output at all',
      brief: 'Short brief',
      category: 'Custom',
    });
    const result = await buildToolCatalog([tool]);

    expect(result).toContain('Short brief');
  });

  it('includes User category tools in custom tools section', async () => {
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue({ listTables: vi.fn().mockResolvedValue([]) }),
    });

    const tool = makeTool({ name: 'user_tool', category: 'User' });
    const result = await buildToolCatalog([tool]);

    expect(result).toContain('Active Custom Tools');
    expect(result).toContain('user_tool');
  });

  it('includes Dynamic Tools category in custom tools section', async () => {
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue({ listTables: vi.fn().mockResolvedValue([]) }),
    });

    const tool = makeTool({ name: 'dynamic_tool', category: 'Dynamic Tools' });
    const result = await buildToolCatalog([tool]);

    expect(result).toContain('Active Custom Tools');
    expect(result).toContain('dynamic_tool');
  });

  it('lists custom data tables when available', async () => {
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue({
        listTables: vi.fn().mockResolvedValue([
          { name: 'my_notes', displayName: 'My Notes' },
        ]),
      }),
    });

    const result = await buildToolCatalog([]);

    expect(result).toContain('Custom Data Tables');
    expect(result).toContain('My Notes');
    expect(result).toContain('my_notes');
  });

  it('uses plain name when displayName equals name', async () => {
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue({
        listTables: vi.fn().mockResolvedValue([
          { name: 'tasks', displayName: 'tasks' },
        ]),
      }),
    });

    const result = await buildToolCatalog([]);

    expect(result).toContain('tasks');
    // Should NOT show "tasks (tasks)" — displayName === name means no parenthetical
    expect(result).not.toContain('tasks (tasks)');
  });

  it('skips meta-tools (search_tools, use_tool, etc.)', async () => {
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue({ listTables: vi.fn().mockResolvedValue([]) }),
    });

    const metaTool = makeTool({ name: 'search_tools', category: 'Custom' });
    const result = await buildToolCatalog([metaTool]);

    expect(result).not.toContain('search_tools');
  });

  it('handles service error gracefully and still returns custom tools section', async () => {
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockImplementation(() => {
        throw new Error('Database unavailable');
      }),
    });

    const tool = makeTool({ name: 'resilient_tool', category: 'Custom' });
    const result = await buildToolCatalog([tool]);

    expect(result).toContain('resilient_tool');
    // Tables section should be absent since service threw
    expect(result).not.toContain('Custom Data Tables');
  });

  it('returns empty string when service throws and no custom tools exist', async () => {
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockImplementation(() => {
        throw new Error('Database unavailable');
      }),
    });

    const result = await buildToolCatalog([]);
    expect(result).toBe('');
  });

  it('does not include non-custom category tools in custom tools section', async () => {
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn().mockReturnValue({ listTables: vi.fn().mockResolvedValue([]) }),
    });

    const systemTool = makeTool({ name: 'get_current_time', category: 'Time' });
    const result = await buildToolCatalog([systemTool]);

    expect(result).not.toContain('Active Custom Tools');
    expect(result).not.toContain('get_current_time');
  });
});
