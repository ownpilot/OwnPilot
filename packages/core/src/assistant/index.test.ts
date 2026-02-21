import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyIntent,
  executeCode,
  PersonalAssistant,
  createAssistant,
  getDefaultAssistant,
  type AssistantConfig,
  type AssistantRequest,
  type ConversationContext,
  type UserContext,
} from './index.js';

// =============================================================================
// Mocks
// =============================================================================

const mockGenerate = vi.fn();

vi.mock('../agent/code-generator.js', () => ({
  createCodeGenerator: vi.fn(() => ({
    generate: mockGenerate,
  })),
  CodeGenerator: vi.fn(),
}));

vi.mock('../services/error-utils.js', () => ({
  getErrorMessage: vi.fn((err: unknown) =>
    err instanceof Error ? err.message : String(err)
  ),
}));

// =============================================================================
// Helpers
// =============================================================================

function makeConversationContext(
  overrides: Partial<ConversationContext> = {}
): ConversationContext {
  return {
    conversationId: 'conv-1',
    channel: 'web',
    messages: [],
    ...overrides,
  };
}

function makeUserContext(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: 'user-1',
    preferences: {
      language: 'en',
      timezone: 'UTC',
      currency: 'USD',
    },
    permissions: [],
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AssistantRequest> = {}): AssistantRequest {
  return {
    message: 'hello',
    user: makeUserContext(),
    conversation: makeConversationContext(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<AssistantConfig> = {}): AssistantConfig {
  return {
    name: 'TestBot',
    systemPrompt: 'You are a test assistant.',
    language: 'en',
    capabilities: ['chat', 'tools'],
    ...overrides,
  };
}

function makePluginRegistry(overrides: Partial<{
  routeMessage: ReturnType<typeof vi.fn>;
  getTool: ReturnType<typeof vi.fn>;
  getAllTools: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    routeMessage: vi.fn().mockResolvedValue({ handled: false }),
    getTool: vi.fn().mockReturnValue(undefined),
    getAllTools: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

// =============================================================================
// classifyIntent — code patterns
// =============================================================================

describe('classifyIntent()', () => {
  const ctx = makeConversationContext();

  describe('code_request intent', () => {
    it('classifies "generate code" as code_request', () => {
      const result = classifyIntent('generate code for sorting', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies "write a function" as code_request', () => {
      const result = classifyIntent('write a function to parse JSON', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies "create a script" as code_request', () => {
      const result = classifyIntent('create a script to rename files', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies "create a program" as code_request', () => {
      const result = classifyIntent('create a program that reads CSV files', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies "python code" as code_request', () => {
      const result = classifyIntent('write me python code for a web scraper', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies "javascript code" as code_request', () => {
      const result = classifyIntent('javascript code for event handling', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies "typescript code" as code_request', () => {
      const result = classifyIntent('give me typescript code for an API client', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies "sql code" as code_request', () => {
      const result = classifyIntent('sql code to join two tables', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies message with backtick block as code_request', () => {
      const result = classifyIntent('can you review this: ```const x = 1```', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies "how do I write" as code_request', () => {
      const result = classifyIntent('how do I write a REST API in Node?', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies "how do I code" as code_request', () => {
      const result = classifyIntent('how do I code a binary search?', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('classifies "how to implement" as code_request', () => {
      const result = classifyIntent('how to implement a queue in javascript?', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('returns confidence 0.85 for code_request', () => {
      const result = classifyIntent('write a function', ctx);
      expect(result.confidence).toBe(0.85);
    });

    it('returns code entities for code_request', () => {
      const result = classifyIntent('write a python function', ctx);
      expect(result.entities).toBeDefined();
    });
  });

  // =============================================================================
  // extractCodeEntities via classifyIntent
  // =============================================================================

  describe('code entity extraction (via classifyIntent)', () => {
    it('extracts python language', () => {
      const result = classifyIntent('write python code for sorting', ctx);
      expect(result.entities.language).toBe('python');
    });

    it('extracts javascript language', () => {
      const result = classifyIntent('javascript code for debounce', ctx);
      expect(result.entities.language).toBe('javascript');
    });

    it('extracts typescript language', () => {
      const result = classifyIntent('typescript code for a generic function', ctx);
      expect(result.entities.language).toBe('typescript');
    });

    it('extracts java language', () => {
      const result = classifyIntent('write java code for a linked list', ctx);
      expect(result.entities.language).toBe('java');
    });

    it('extracts go language', () => {
      const result = classifyIntent('write go code for a goroutine', ctx);
      expect(result.entities.language).toBe('go');
    });

    it('extracts rust language', () => {
      const result = classifyIntent('write rust code for memory management', ctx);
      expect(result.entities.language).toBe('rust');
    });

    it('extracts sql language', () => {
      const result = classifyIntent('sql code to select all users', ctx);
      expect(result.entities.language).toBe('sql');
    });

    it('extracts html language', () => {
      const result = classifyIntent('write html code for a nav bar', ctx);
      expect(result.entities.language).toBe('html');
    });

    it('extracts css language', () => {
      const result = classifyIntent('css code for flexbox layout', ctx);
      expect(result.entities.language).toBe('css');
    });

    it('extracts function type', () => {
      // Pattern 1 matches "write a function" directly — no language word between
      const result = classifyIntent('write a function to add numbers', ctx);
      expect(result.intent).toBe('code_request');
      expect(result.entities.type).toBe('function');
    });

    it('extracts class type', () => {
      // "generate code" triggers code_request, then "class" is in the full message
      const result = classifyIntent('generate code for a class definition', ctx);
      expect(result.intent).toBe('code_request');
      expect(result.entities.type).toBe('class');
    });

    it('extracts api type from "api"', () => {
      // "generate code" triggers code_request, then "api" is in the full message
      const result = classifyIntent('generate code for an api endpoint', ctx);
      expect(result.intent).toBe('code_request');
      expect(result.entities.type).toBe('api');
    });

    it('extracts api type from "endpoint" keyword', () => {
      // "create a script" triggers code_request, then "endpoint" is in the message
      const result = classifyIntent('create a script that calls an endpoint', ctx);
      expect(result.intent).toBe('code_request');
      expect(result.entities.type).toBe('api');
    });

    it('returns empty entities when no language detected', () => {
      const result = classifyIntent('generate code for something', ctx);
      expect(result.entities.language).toBeUndefined();
    });
  });

  // =============================================================================
  // schedule intent
  // =============================================================================

  describe('schedule intent', () => {
    it('classifies "every day" as schedule', () => {
      const result = classifyIntent('remind me every day at 9am', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('classifies "every morning" as schedule', () => {
      const result = classifyIntent('check the weather every morning', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('classifies "every evening" as schedule', () => {
      const result = classifyIntent('send report every evening', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('classifies "every week" as schedule', () => {
      const result = classifyIntent('sync data every week', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('classifies "every month" as schedule', () => {
      const result = classifyIntent('send invoice every month', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('classifies "remind me" as schedule', () => {
      const result = classifyIntent('remind me to take my medication', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('classifies "alarm" as schedule', () => {
      const result = classifyIntent('set an alarm for 7am', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('classifies "schedule" as schedule', () => {
      const result = classifyIntent('schedule a meeting for tomorrow', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('classifies "at 3pm" pattern as schedule', () => {
      const result = classifyIntent('ping me at 3pm', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('classifies "tomorrow at" as schedule', () => {
      const result = classifyIntent('do the backup tomorrow at 2', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('classifies "today at" as schedule', () => {
      const result = classifyIntent('send the report today at 5', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('returns confidence 0.80 for schedule', () => {
      const result = classifyIntent('remind me to drink water', ctx);
      expect(result.confidence).toBe(0.80);
    });

    it('includes suggested tools for schedule', () => {
      const result = classifyIntent('remind me every day', ctx);
      expect(result.suggestedTools).toContain('create_scheduled_task');
      expect(result.suggestedTools).toContain('list_scheduled_tasks');
    });
  });

  // =============================================================================
  // extractScheduleEntities via classifyIntent
  // =============================================================================

  describe('schedule entity extraction (via classifyIntent)', () => {
    it('extracts PM time correctly (3pm → hour 15)', () => {
      const result = classifyIntent('remind me at 3pm', ctx);
      expect((result.entities.time as { hour: number }).hour).toBe(15);
    });

    it('extracts AM time correctly (9am → hour 9)', () => {
      const result = classifyIntent('remind me at 9am', ctx);
      expect((result.entities.time as { hour: number }).hour).toBe(9);
    });

    it('extracts midnight correctly (12am → hour 0)', () => {
      const result = classifyIntent('remind me at 12am', ctx);
      expect((result.entities.time as { hour: number }).hour).toBe(0);
    });

    it('extracts noon correctly (12pm → hour 12)', () => {
      const result = classifyIntent('remind me at 12pm', ctx);
      expect((result.entities.time as { hour: number }).hour).toBe(12);
    });

    it('extracts minute from time with colon', () => {
      const result = classifyIntent('remind me at 3:30pm', ctx);
      const time = result.entities.time as { hour: number; minute: number };
      expect(time.hour).toBe(15);
      expect(time.minute).toBe(30);
    });

    it('defaults minute to 0 when no colon', () => {
      const result = classifyIntent('remind me at 5pm', ctx);
      const time = result.entities.time as { hour: number; minute: number };
      expect(time.minute).toBe(0);
    });

    it('extracts daily frequency', () => {
      const result = classifyIntent('remind me every day', ctx);
      expect(result.entities.frequency).toBe('daily');
    });

    it('extracts daily frequency from "daily" keyword in schedule message', () => {
      // "remind" triggers schedule intent; "daily" triggers frequency extraction
      const result = classifyIntent('remind me daily', ctx);
      expect(result.intent).toBe('schedule');
      expect(result.entities.frequency).toBe('daily');
    });

    it('extracts weekly frequency', () => {
      const result = classifyIntent('remind me every week', ctx);
      expect(result.entities.frequency).toBe('weekly');
    });

    it('extracts weekly frequency from "weekly" keyword in schedule message', () => {
      // "remind" triggers schedule intent; "weekly" triggers frequency extraction
      const result = classifyIntent('remind me weekly', ctx);
      expect(result.intent).toBe('schedule');
      expect(result.entities.frequency).toBe('weekly');
    });

    it('extracts monthly frequency', () => {
      const result = classifyIntent('remind me every month', ctx);
      expect(result.entities.frequency).toBe('monthly');
    });

    it('extracts monthly frequency from "monthly" keyword in schedule message', () => {
      // "remind" triggers schedule intent; "monthly" triggers frequency extraction
      const result = classifyIntent('remind me monthly', ctx);
      expect(result.intent).toBe('schedule');
      expect(result.entities.frequency).toBe('monthly');
    });

    it('returns empty entities when no time or frequency', () => {
      const result = classifyIntent('set a reminder', ctx);
      expect(result.entities.time).toBeUndefined();
      expect(result.entities.frequency).toBeUndefined();
    });
  });

  // =============================================================================
  // memory intent
  // =============================================================================

  describe('memory intent', () => {
    it('classifies "remember this" as memory', () => {
      const result = classifyIntent('remember this meeting note', ctx);
      expect(result.intent).toBe('memory');
    });

    it('classifies "save this" as memory', () => {
      const result = classifyIntent('save this information for later', ctx);
      expect(result.intent).toBe('memory');
    });

    it('classifies "note" as memory', () => {
      const result = classifyIntent('please note that my password is complex', ctx);
      expect(result.intent).toBe('memory');
    });

    it('classifies "don\'t forget" as memory', () => {
      const result = classifyIntent("don't forget to buy milk", ctx);
      expect(result.intent).toBe('memory');
    });

    it('classifies "what do you know" as memory', () => {
      const result = classifyIntent('what do you know about me?', ctx);
      expect(result.intent).toBe('memory');
    });

    it('classifies "do you remember" as memory', () => {
      const result = classifyIntent('do you remember my name?', ctx);
      expect(result.intent).toBe('memory');
    });

    it('returns confidence 0.80 for memory', () => {
      const result = classifyIntent('remember this for me', ctx);
      expect(result.confidence).toBe(0.80);
    });

    it('includes suggested tools for memory', () => {
      const result = classifyIntent('remember my birthday', ctx);
      expect(result.suggestedTools).toContain('create_memory');
      expect(result.suggestedTools).toContain('search_memories');
    });

    it('returns empty entities for memory', () => {
      const result = classifyIntent('remember this note', ctx);
      expect(result.entities).toEqual({});
    });
  });

  // =============================================================================
  // help intent
  // =============================================================================

  describe('help intent', () => {
    it('classifies "help" at start of message as help', () => {
      const result = classifyIntent('help me please', ctx);
      expect(result.intent).toBe('help');
    });

    it('classifies "what can you do" as help', () => {
      const result = classifyIntent('what can you do for me?', ctx);
      expect(result.intent).toBe('help');
    });

    it('classifies "how do I use" as help', () => {
      // Avoid "schedule" word — that would match the schedule pattern first
      const result = classifyIntent('how do I use this tool?', ctx);
      expect(result.intent).toBe('help');
    });

    it('classifies "how to use" as help', () => {
      const result = classifyIntent('how to use your features?', ctx);
      expect(result.intent).toBe('help');
    });

    it('classifies "features" as help', () => {
      const result = classifyIntent('show me your features', ctx);
      expect(result.intent).toBe('help');
    });

    it('classifies "capabilities" as help', () => {
      const result = classifyIntent('what are your capabilities?', ctx);
      expect(result.intent).toBe('help');
    });

    it('returns confidence 0.90 for help', () => {
      const result = classifyIntent('help me out', ctx);
      expect(result.confidence).toBe(0.90);
    });

    it('returns empty entities for help', () => {
      const result = classifyIntent('help', ctx);
      expect(result.entities).toEqual({});
    });

    it('does not include suggestedTools for help', () => {
      const result = classifyIntent('help', ctx);
      expect(result.suggestedTools).toBeUndefined();
    });
  });

  // =============================================================================
  // question intent
  // =============================================================================

  describe('question intent', () => {
    it('classifies message ending with "?" as question', () => {
      const result = classifyIntent('Is JavaScript single-threaded?', ctx);
      expect(result.intent).toBe('question');
    });

    it('classifies "what is X?" as question', () => {
      const result = classifyIntent('what is the capital of France?', ctx);
      expect(result.intent).toBe('question');
    });

    it('classifies "who is" as question', () => {
      const result = classifyIntent('who is the CEO of Apple?', ctx);
      expect(result.intent).toBe('question');
    });

    it('classifies "where is" as question', () => {
      const result = classifyIntent('where is the Eiffel Tower?', ctx);
      expect(result.intent).toBe('question');
    });

    it('classifies "when is" as question', () => {
      const result = classifyIntent('when is the next full moon?', ctx);
      expect(result.intent).toBe('question');
    });

    it('classifies "why does" as question', () => {
      const result = classifyIntent('why does the sky look blue?', ctx);
      expect(result.intent).toBe('question');
    });

    it('classifies "how does" as question', () => {
      const result = classifyIntent('how does DNS work?', ctx);
      expect(result.intent).toBe('question');
    });

    it('classifies "which" as question', () => {
      const result = classifyIntent('which framework is faster?', ctx);
      expect(result.intent).toBe('question');
    });

    it('returns confidence 0.70 for question', () => {
      const result = classifyIntent('what is TypeScript?', ctx);
      expect(result.confidence).toBe(0.70);
    });

    it('returns empty entities for question', () => {
      const result = classifyIntent('what is Node.js?', ctx);
      expect(result.entities).toEqual({});
    });
  });

  // =============================================================================
  // task intent
  // =============================================================================

  describe('task intent', () => {
    it('classifies "do this" as task', () => {
      const result = classifyIntent('do the migration for me', ctx);
      expect(result.intent).toBe('task');
    });

    it('classifies "make a" as task', () => {
      const result = classifyIntent('make a list of todos', ctx);
      expect(result.intent).toBe('task');
    });

    it('classifies "create a" as task', () => {
      const result = classifyIntent('create a new folder', ctx);
      expect(result.intent).toBe('task');
    });

    it('classifies "generate a" as task', () => {
      const result = classifyIntent('generate a report', ctx);
      expect(result.intent).toBe('task');
    });

    it('classifies "delete" as task', () => {
      const result = classifyIntent('delete the old log files', ctx);
      expect(result.intent).toBe('task');
    });

    it('classifies "send" as task', () => {
      const result = classifyIntent('send an email to the team', ctx);
      expect(result.intent).toBe('task');
    });

    it('classifies "open" as task', () => {
      const result = classifyIntent('open the config file', ctx);
      expect(result.intent).toBe('task');
    });

    it('classifies "please do" as task', () => {
      const result = classifyIntent('please fix this bug', ctx);
      expect(result.intent).toBe('task');
    });

    it('returns confidence 0.65 for task', () => {
      const result = classifyIntent('please help me with this', ctx);
      expect(result.confidence).toBe(0.65);
    });

    it('returns empty entities for task', () => {
      const result = classifyIntent('do the work', ctx);
      expect(result.entities).toEqual({});
    });
  });

  // =============================================================================
  // general_chat intent (default)
  // =============================================================================

  describe('general_chat intent (default)', () => {
    it('returns general_chat for unmatched message', () => {
      const result = classifyIntent('I love sunny days', ctx);
      expect(result.intent).toBe('general_chat');
    });

    it('returns general_chat for greetings', () => {
      const result = classifyIntent('good morning!', ctx);
      expect(result.intent).toBe('general_chat');
    });

    it('returns general_chat for random statements', () => {
      const result = classifyIntent('the weather is nice today', ctx);
      expect(result.intent).toBe('general_chat');
    });

    it('returns confidence 0.50 for general_chat', () => {
      const result = classifyIntent('random message', ctx);
      expect(result.confidence).toBe(0.50);
    });

    it('returns empty entities for general_chat', () => {
      const result = classifyIntent('just chatting', ctx);
      expect(result.entities).toEqual({});
    });

    it('returns no suggestedTools for general_chat', () => {
      const result = classifyIntent('just chatting', ctx);
      expect(result.suggestedTools).toBeUndefined();
    });
  });

  // =============================================================================
  // Priority ordering (code takes precedence over schedule, etc.)
  // =============================================================================

  describe('intent priority ordering', () => {
    it('code_request takes priority over question (trailing ?)', () => {
      // "write a function" matches code pattern before ? is checked
      const result = classifyIntent('can you write a function for sorting?', ctx);
      expect(result.intent).toBe('code_request');
    });

    it('schedule takes priority over question', () => {
      const result = classifyIntent('can you remind me at 3pm?', ctx);
      expect(result.intent).toBe('schedule');
    });

    it('memory takes priority over question', () => {
      const result = classifyIntent('do you remember my name?', ctx);
      expect(result.intent).toBe('memory');
    });
  });
});

// =============================================================================
// executeCode()
// =============================================================================

describe('executeCode()', () => {
  it('always returns success: false', async () => {
    const result = await executeCode('console.log("hi")', 'javascript');
    expect(result.success).toBe(false);
  });

  it('returns the sandbox integration error message', async () => {
    const result = await executeCode('print("hello")', 'python');
    expect(result.error).toBe('Code execution requires sandbox integration');
  });

  it('does not return output', async () => {
    const result = await executeCode('1 + 1', 'javascript');
    expect(result.output).toBeUndefined();
  });

  it('accepts custom timeout without error', async () => {
    const result = await executeCode('const x = 1', 'typescript', 5000);
    expect(result.success).toBe(false);
  });

  it('uses default timeout when not provided', async () => {
    const result = await executeCode('x', 'javascript');
    expect(result.success).toBe(false);
  });

  it('returns consistent result for different languages', async () => {
    const js = await executeCode('var x = 1', 'javascript');
    const py = await executeCode('x = 1', 'python');
    expect(js.success).toBe(false);
    expect(py.success).toBe(false);
  });
});

// =============================================================================
// PersonalAssistant — constructor & getCodeGenerator
// =============================================================================

describe('PersonalAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue({
      success: true,
      code: 'console.log("hello")',
      language: 'javascript',
      explanation: 'A hello world program',
      execution: { success: true, output: 'hello', duration: 10 },
      metadata: { generatedAt: new Date().toISOString(), validationPassed: true },
    });
  });

  describe('constructor', () => {
    it('creates an instance without error', () => {
      const assistant = new PersonalAssistant(makeConfig());
      expect(assistant).toBeInstanceOf(PersonalAssistant);
    });

    it('creates a code generator on construction (getCodeGenerator is non-null)', () => {
      const assistant = new PersonalAssistant(makeConfig());
      // The mock's createCodeGenerator returns a generate fn — confirm it is wired
      expect(assistant.getCodeGenerator()).not.toBeNull();
      expect(assistant.getCodeGenerator()).toBeDefined();
    });

    it('getCodeGenerator returns the code generator', () => {
      const assistant = new PersonalAssistant(makeConfig());
      expect(assistant.getCodeGenerator()).toBeDefined();
    });

    it('getConfig returns the config passed in', () => {
      const config = makeConfig({ name: 'MyBot' });
      const assistant = new PersonalAssistant(config);
      expect(assistant.getConfig()).toEqual(config);
    });

    it('getConfig reflects all config fields', () => {
      const config = makeConfig({
        name: 'AdvancedBot',
        language: 'auto',
        maxContextTokens: 64000,
        toolTimeout: 10000,
      });
      const assistant = new PersonalAssistant(config);
      const returned = assistant.getConfig();
      expect(returned.maxContextTokens).toBe(64000);
      expect(returned.toolTimeout).toBe(10000);
    });
  });

  // =============================================================================
  // initialize()
  // =============================================================================

  describe('initialize()', () => {
    it('accepts all dependencies without error', () => {
      const assistant = new PersonalAssistant(makeConfig());
      const registry = makePluginRegistry();
      expect(() => assistant.initialize({ pluginRegistry: registry as never })).not.toThrow();
    });

    it('accepts partial dependencies', () => {
      const assistant = new PersonalAssistant(makeConfig());
      expect(() => assistant.initialize({})).not.toThrow();
    });

    it('accepts only memoryStore', () => {
      const assistant = new PersonalAssistant(makeConfig());
      const memoryStore = { save: vi.fn(), get: vi.fn() };
      expect(() => assistant.initialize({ memoryStore: memoryStore as never })).not.toThrow();
    });

    it('accepts only scheduler', () => {
      const assistant = new PersonalAssistant(makeConfig());
      const scheduler = { schedule: vi.fn() };
      expect(() => assistant.initialize({ scheduler: scheduler as never })).not.toThrow();
    });

    it('accepts only llmProvider', () => {
      const assistant = new PersonalAssistant(makeConfig());
      const llmProvider = { complete: vi.fn(), stream: vi.fn() };
      expect(() => assistant.initialize({ llmProvider: llmProvider as never })).not.toThrow();
    });
  });

  // =============================================================================
  // getAvailableTools()
  // =============================================================================

  describe('getAvailableTools()', () => {
    it('returns empty array when no plugin registry', () => {
      const assistant = new PersonalAssistant(makeConfig());
      expect(assistant.getAvailableTools()).toEqual([]);
    });

    it('returns tool definitions from plugin registry', () => {
      const assistant = new PersonalAssistant(makeConfig());
      const toolDef = {
        name: 'my_tool',
        description: 'Does something',
        parameters: { type: 'object', properties: {} },
      };
      const registry = makePluginRegistry({
        getAllTools: vi.fn().mockReturnValue([{ definition: toolDef, executor: vi.fn() }]),
      });
      assistant.initialize({ pluginRegistry: registry as never });
      const tools = assistant.getAvailableTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual(toolDef);
    });

    it('returns multiple tool definitions', () => {
      const assistant = new PersonalAssistant(makeConfig());
      const toolDefs = [
        { name: 'tool_a', description: 'A', parameters: {} },
        { name: 'tool_b', description: 'B', parameters: {} },
      ];
      const registry = makePluginRegistry({
        getAllTools: vi.fn().mockReturnValue(
          toolDefs.map(d => ({ definition: d, executor: vi.fn() }))
        ),
      });
      assistant.initialize({ pluginRegistry: registry as never });
      expect(assistant.getAvailableTools()).toHaveLength(2);
    });
  });

  // =============================================================================
  // process() — routing
  // =============================================================================

  describe('process() routing', () => {
    it('routes code request to handleCodeRequest', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      // Use a message that directly matches a code pattern
      const response = await assistant.process(
        makeRequest({ message: 'python code for sorting an array' })
      );
      expect(response.code).toBeDefined();
    });

    it('routes schedule request to handleScheduleRequest', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'remind me every day at 9am' })
      );
      expect(response.message).toContain('scheduling');
    });

    it('routes memory request to handleMemoryRequest', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'remember my name is Alice' })
      );
      expect(response.message).toContain('memory');
    });

    it('routes help request to handleHelpRequest', async () => {
      const assistant = new PersonalAssistant(makeConfig({ name: 'MyAssistant' }));
      const response = await assistant.process(
        makeRequest({ message: 'help me understand what you can do' })
      );
      expect(response.message).toContain('MyAssistant');
    });

    it('routes question to handleGeneralRequest', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'what is the speed of light?' })
      );
      expect(response.message).toContain('LLM integration');
    });

    it('routes general_chat to handleGeneralRequest', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'I love sunny days' })
      );
      expect(response.message).toContain('LLM integration');
    });

    it('routes task intent to handleGeneralRequest', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'send an email to my team' })
      );
      // send matches task, but general handler handles it
      expect(response.message).toBeDefined();
    });

    it('calls pluginRegistry.routeMessage when registry is set', async () => {
      const registry = makePluginRegistry();
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      await assistant.process(makeRequest({ message: 'do something' }));
      expect(registry.routeMessage).toHaveBeenCalledOnce();
    });

    it('passes correct handler context to routeMessage', async () => {
      const registry = makePluginRegistry();
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const request = makeRequest({
        message: 'test',
        user: makeUserContext({ userId: 'u-42' }),
        conversation: makeConversationContext({
          conversationId: 'conv-99',
          channel: 'telegram',
        }),
        metadata: { extra: true },
      });
      await assistant.process(request);
      expect(registry.routeMessage).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          userId: 'u-42',
          conversationId: 'conv-99',
          channel: 'telegram',
          metadata: { extra: true },
        })
      );
    });

    it('skips plugin routing when no registry', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'I love sunny days' })
      );
      expect(response).toBeDefined();
    });

    it('does not route to intent handlers when plugin handles message', async () => {
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          response: 'Plugin handled this',
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(
        makeRequest({ message: 'help' }) // would normally go to handleHelp
      );
      expect(response.message).toBe('Plugin handled this');
    });
  });

  // =============================================================================
  // handleCodeRequest
  // =============================================================================

  describe('handleCodeRequest', () => {
    it('includes generated code in response', async () => {
      mockGenerate.mockResolvedValue({
        success: true,
        code: 'const x = 42;',
        language: 'javascript',
        explanation: 'A constant',
        execution: { success: true, output: '42', duration: 5 },
        metadata: { generatedAt: new Date().toISOString(), validationPassed: true },
      });
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.code).toBeDefined();
      expect(response.code?.code).toBe('const x = 42;');
    });

    it('includes language in the response code block', async () => {
      mockGenerate.mockResolvedValue({
        success: true,
        code: 'def hello(): pass',
        language: 'python',
        explanation: 'A hello function',
        execution: undefined,
        metadata: { generatedAt: new Date().toISOString(), validationPassed: true },
      });
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write python code for hello' })
      );
      expect(response.message).toContain('python');
    });

    it('includes explanation when code generation succeeds', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.message).toContain('Explanation');
    });

    it('includes execution result when execution succeeds', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.message).toContain('Execution Result');
    });

    it('includes execution duration when execution succeeds', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.message).toContain('10ms');
    });

    it('includes execution error when execution fails', async () => {
      mockGenerate.mockResolvedValue({
        success: true,
        code: 'bad code',
        language: 'javascript',
        explanation: 'Bad code',
        execution: { success: false, error: 'SyntaxError', duration: 0 },
        metadata: { generatedAt: new Date().toISOString(), validationPassed: true },
      });
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.message).toContain('Execution Error');
      expect(response.message).toContain('SyntaxError');
    });

    it('does not include execution section when no execution result', async () => {
      mockGenerate.mockResolvedValue({
        success: true,
        code: 'const x = 1;',
        language: 'javascript',
        explanation: 'Simple constant',
        execution: undefined,
        metadata: { generatedAt: new Date().toISOString(), validationPassed: true },
      });
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.message).not.toContain('Execution Result');
      expect(response.message).not.toContain('Execution Error');
    });

    it('includes three suggestions on success', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.suggestions).toHaveLength(3);
    });

    it('includes executionResult in code property', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.code?.executionResult).toBe('hello');
    });

    it('includes intent in metadata on success', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.metadata?.intent).toBe('code_request');
    });

    it('returns error message on failed code generation', async () => {
      mockGenerate.mockResolvedValue({
        success: false,
        language: 'javascript',
        error: 'LLM unavailable',
        metadata: { generatedAt: new Date().toISOString(), validationPassed: false },
      });
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.message).toBe('LLM unavailable');
    });

    it('returns default fallback message when no error on failure', async () => {
      mockGenerate.mockResolvedValue({
        success: false,
        language: 'javascript',
        metadata: { generatedAt: new Date().toISOString(), validationPassed: false },
      });
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.message).toBe(
        'Could not generate code. Please provide a more detailed description.'
      );
    });

    it('returns three suggestions on failure', async () => {
      mockGenerate.mockResolvedValue({
        success: false,
        language: 'javascript',
        metadata: { generatedAt: new Date().toISOString(), validationPassed: false },
      });
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.suggestions).toHaveLength(3);
    });

    it('does not include code property on failure', async () => {
      mockGenerate.mockResolvedValue({
        success: false,
        language: 'javascript',
        error: 'failed',
        metadata: { generatedAt: new Date().toISOString(), validationPassed: false },
      });
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'write javascript code' })
      );
      expect(response.code).toBeUndefined();
    });

    it('uses javascript as default language when no language entity', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      // No language in message → falls back to javascript
      const response = await assistant.process(
        makeRequest({ message: 'generate code for sorting' })
      );
      expect(response.code?.language).toBe('javascript');
    });
  });

  // =============================================================================
  // handleScheduleRequest
  // =============================================================================

  describe('handleScheduleRequest', () => {
    it('returns scheduling understanding message', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'remind me every day' })
      );
      expect(response.message).toBe(
        'I understand your scheduling request. You can use these tools:'
      );
    });

    it('returns three scheduling suggestions', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'remind me every day' })
      );
      expect(response.suggestions).toHaveLength(3);
    });

    it('suggestions mention create_scheduled_task', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'remind me every week' })
      );
      expect(response.suggestions?.some(s => s.includes('create_scheduled_task'))).toBe(true);
    });

    it('suggestions mention list_scheduled_tasks', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'set an alarm at 7am' })
      );
      expect(response.suggestions?.some(s => s.includes('list_scheduled_tasks'))).toBe(true);
    });

    it('includes intent in metadata', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'remind me every day' })
      );
      expect(response.metadata?.intent).toBe('schedule');
    });

    it('includes extracted entities in metadata', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'remind me every day at 9am' })
      );
      expect(response.metadata?.entities).toBeDefined();
    });
  });

  // =============================================================================
  // handleMemoryRequest
  // =============================================================================

  describe('handleMemoryRequest', () => {
    it('returns memory understanding message', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'remember my birthday is July 4th' })
      );
      expect(response.message).toBe(
        'I understand your memory request. What would you like me to remember or recall?'
      );
    });

    it('returns three memory suggestions', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'save this note for me' })
      );
      expect(response.suggestions).toHaveLength(3);
    });

    it('does not include toolCalls in memory response', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'remember my name' })
      );
      expect(response.toolCalls).toBeUndefined();
    });

    it('does not include code in memory response', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: "don't forget my address" })
      );
      expect(response.code).toBeUndefined();
    });
  });

  // =============================================================================
  // handleHelpRequest
  // =============================================================================

  describe('handleHelpRequest', () => {
    it('includes the assistant name in the response', async () => {
      const assistant = new PersonalAssistant(makeConfig({ name: 'HelpBot' }));
      const response = await assistant.process(
        makeRequest({ message: 'help me' })
      );
      expect(response.message).toContain("I'm HelpBot");
    });

    it('lists general chat capability', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(makeRequest({ message: 'help' }));
      expect(response.message).toContain('General Chat');
    });

    it('lists code generation capability', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(makeRequest({ message: 'help' }));
      expect(response.message).toContain('Code Generation');
    });

    it('lists scheduling capability', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(makeRequest({ message: 'help' }));
      expect(response.message).toContain('Scheduling');
    });

    it('lists memory capability', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(makeRequest({ message: 'help' }));
      expect(response.message).toContain('Memory');
    });

    it('returns three follow-up suggestions', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(makeRequest({ message: 'help' }));
      expect(response.suggestions).toHaveLength(3);
    });

    it('does not include metadata in help response', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(makeRequest({ message: 'help' }));
      expect(response.metadata).toBeUndefined();
    });
  });

  // =============================================================================
  // handleGeneralRequest
  // =============================================================================

  describe('handleGeneralRequest', () => {
    it('returns LLM placeholder message', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'what is the meaning of life?' })
      );
      expect(response.message).toBe(
        'This request requires LLM integration. Currently operating with basic pattern matching.'
      );
    });

    it('includes intent in metadata', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'I love sunny days' })
      );
      expect(response.metadata?.intent).toBe('general_chat');
    });

    it('includes confidence in metadata', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'I love sunny days' })
      );
      expect(response.metadata?.confidence).toBe(0.50);
    });

    it('does not include code in general response', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'the sky is blue' })
      );
      expect(response.code).toBeUndefined();
    });

    it('does not include suggestions in general response', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'tell me a story' })
      );
      expect(response.suggestions).toBeUndefined();
    });

    it('handles question intent as general request', async () => {
      const assistant = new PersonalAssistant(makeConfig());
      const response = await assistant.process(
        makeRequest({ message: 'what is the capital of Germany?' })
      );
      expect(response.message).toContain('LLM integration');
      expect(response.metadata?.intent).toBe('question');
    });
  });

  // =============================================================================
  // processPluginResult — via process() with plugin registry
  // =============================================================================

  describe('processPluginResult()', () => {
    it('returns plugin response when handled=true and response is set', async () => {
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          response: 'Plugin says hello',
          toolCalls: [],
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'ping' }));
      expect(response.message).toBe('Plugin says hello');
    });

    it('includes plugin metadata when provided', async () => {
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          response: 'ok',
          metadata: { source: 'weather-plugin' },
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'weather' }));
      expect(response.metadata?.source).toBe('weather-plugin');
    });

    it('executes tool calls from plugin result', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({ content: 'tool output' });
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          response: 'Done',
          toolCalls: [{ tool: 'my_tool', args: { param: 'value' } }],
        }),
        getTool: vi.fn().mockReturnValue({
          definition: { name: 'my_tool' },
          executor: mockExecutor,
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      await assistant.process(makeRequest({ message: 'use tool' }));
      expect(mockExecutor).toHaveBeenCalledWith(
        { param: 'value' },
        expect.objectContaining({ conversationId: 'conv-1', userId: 'user-1' })
      );
    });

    it('includes tool results in response', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({ content: 'weather data' });
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          toolCalls: [{ tool: 'get_weather', args: { city: 'Paris' } }],
        }),
        getTool: vi.fn().mockReturnValue({
          definition: { name: 'get_weather' },
          executor: mockExecutor,
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'weather' }));
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]!.tool).toBe('get_weather');
      expect(response.toolCalls![0]!.result).toBe('weather data');
    });

    it('skips tool execution when tool not found in registry', async () => {
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          toolCalls: [{ tool: 'unknown_tool', args: {} }],
        }),
        getTool: vi.fn().mockReturnValue(undefined),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'call tool' }));
      expect(response.toolCalls).toHaveLength(0);
    });

    it('catches tool execution errors and stores error in result', async () => {
      const failingExecutor = vi.fn().mockRejectedValue(new Error('Tool crashed'));
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          toolCalls: [{ tool: 'bad_tool', args: {} }],
        }),
        getTool: vi.fn().mockReturnValue({
          definition: { name: 'bad_tool' },
          executor: failingExecutor,
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'call bad tool' }));
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]!.result).toEqual({ error: 'Tool crashed' });
    });

    it('uses formatToolResults as message when no response and tool calls present', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({ content: 'result text' });
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          response: undefined,
          toolCalls: [{ tool: 'format_tool', args: {} }],
        }),
        getTool: vi.fn().mockReturnValue({
          definition: { name: 'format_tool' },
          executor: mockExecutor,
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'format' }));
      expect(response.message).toContain('format_tool');
      expect(response.message).toContain('result text');
    });

    it('passes tool call args correctly to executor', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({ content: 'ok' });
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          toolCalls: [{ tool: 'parameterized_tool', args: { x: 1, y: 'hello' } }],
        }),
        getTool: vi.fn().mockReturnValue({
          definition: { name: 'parameterized_tool' },
          executor: mockExecutor,
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      await assistant.process(makeRequest({ message: 'run tool' }));
      expect(mockExecutor).toHaveBeenCalledWith(
        { x: 1, y: 'hello' },
        expect.any(Object)
      );
    });

    it('handles multiple tool calls sequentially', async () => {
      const executor1 = vi.fn().mockResolvedValue({ content: 'r1' });
      const executor2 = vi.fn().mockResolvedValue({ content: 'r2' });
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          toolCalls: [
            { tool: 'tool_one', args: {} },
            { tool: 'tool_two', args: {} },
          ],
        }),
        getTool: vi
          .fn()
          .mockImplementationOnce(() => ({ definition: { name: 'tool_one' }, executor: executor1 }))
          .mockImplementationOnce(() => ({ definition: { name: 'tool_two' }, executor: executor2 })),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'run both' }));
      expect(response.toolCalls).toHaveLength(2);
      expect(executor1).toHaveBeenCalledOnce();
      expect(executor2).toHaveBeenCalledOnce();
    });
  });

  // =============================================================================
  // formatToolResults (exercised through processPluginResult)
  // =============================================================================

  describe('formatToolResults (via processPluginResult)', () => {
    it('returns empty string when toolCalls is empty and no response', async () => {
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          response: undefined,
          toolCalls: [],
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'ping' }));
      expect(response.message).toBe('');
    });

    it('formats string tool result correctly', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({ content: 'plain text result' });
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          toolCalls: [{ tool: 'str_tool', args: {} }],
        }),
        getTool: vi.fn().mockReturnValue({
          definition: { name: 'str_tool' },
          executor: mockExecutor,
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'str' }));
      expect(response.message).toContain('**str_tool**');
      expect(response.message).toContain('plain text result');
    });

    it('JSON stringifies object tool result', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({ content: { key: 'value', num: 42 } });
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          toolCalls: [{ tool: 'obj_tool', args: {} }],
        }),
        getTool: vi.fn().mockReturnValue({
          definition: { name: 'obj_tool' },
          executor: mockExecutor,
        }),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'obj' }));
      expect(response.message).toContain('"key"');
      expect(response.message).toContain('"value"');
      expect(response.message).toContain('42');
    });

    it('formats multiple tool results separated by double newlines', async () => {
      const exec1 = vi.fn().mockResolvedValue({ content: 'result1' });
      const exec2 = vi.fn().mockResolvedValue({ content: 'result2' });
      const registry = makePluginRegistry({
        routeMessage: vi.fn().mockResolvedValue({
          handled: true,
          toolCalls: [
            { tool: 'tool_alpha', args: {} },
            { tool: 'tool_beta', args: {} },
          ],
        }),
        getTool: vi
          .fn()
          .mockImplementationOnce(() => ({ definition: { name: 'tool_alpha' }, executor: exec1 }))
          .mockImplementationOnce(() => ({ definition: { name: 'tool_beta' }, executor: exec2 })),
      });
      const assistant = new PersonalAssistant(makeConfig());
      assistant.initialize({ pluginRegistry: registry as never });
      const response = await assistant.process(makeRequest({ message: 'multi' }));
      expect(response.message).toContain('**tool_alpha**');
      expect(response.message).toContain('**tool_beta**');
      expect(response.message).toContain('\n\n');
    });
  });
});

// =============================================================================
// createAssistant factory
// =============================================================================

describe('createAssistant()', () => {
  it('creates a PersonalAssistant instance', () => {
    const assistant = createAssistant();
    expect(assistant).toBeInstanceOf(PersonalAssistant);
  });

  it('uses default name "Gateway Assistant"', () => {
    const assistant = createAssistant();
    expect(assistant.getConfig().name).toBe('Gateway Assistant');
  });

  it('uses default language "auto"', () => {
    const assistant = createAssistant();
    expect(assistant.getConfig().language).toBe('auto');
  });

  it('uses default maxContextTokens 128000', () => {
    const assistant = createAssistant();
    expect(assistant.getConfig().maxContextTokens).toBe(128000);
  });

  it('uses default toolTimeout 30000', () => {
    const assistant = createAssistant();
    expect(assistant.getConfig().toolTimeout).toBe(30000);
  });

  it('uses default capabilities including chat', () => {
    const assistant = createAssistant();
    expect(assistant.getConfig().capabilities).toContain('chat');
  });

  it('uses default capabilities including memory', () => {
    const assistant = createAssistant();
    expect(assistant.getConfig().capabilities).toContain('memory');
  });

  it('merges custom name into config', () => {
    const assistant = createAssistant({ name: 'CustomBot' });
    expect(assistant.getConfig().name).toBe('CustomBot');
  });

  it('merges custom capabilities into config', () => {
    const assistant = createAssistant({ capabilities: ['chat', 'code'] });
    expect(assistant.getConfig().capabilities).toEqual(['chat', 'code']);
  });

  it('merges custom language into config', () => {
    const assistant = createAssistant({ language: 'en' });
    expect(assistant.getConfig().language).toBe('en');
  });

  it('keeps defaults for unspecified fields', () => {
    const assistant = createAssistant({ name: 'PartialConfig' });
    expect(assistant.getConfig().maxContextTokens).toBe(128000);
    expect(assistant.getConfig().language).toBe('auto');
  });

  it('creates distinct instances on each call', () => {
    const a = createAssistant();
    const b = createAssistant();
    expect(a).not.toBe(b);
  });
});

// =============================================================================
// getDefaultAssistant singleton
// =============================================================================

describe('getDefaultAssistant()', () => {
  it('returns a PersonalAssistant instance', () => {
    const assistant = getDefaultAssistant();
    expect(assistant).toBeInstanceOf(PersonalAssistant);
  });

  it('returns the same instance on subsequent calls', () => {
    const first = getDefaultAssistant();
    const second = getDefaultAssistant();
    expect(first).toBe(second);
  });

  it('has default name "Gateway Assistant"', () => {
    const assistant = getDefaultAssistant();
    expect(assistant.getConfig().name).toBe('Gateway Assistant');
  });

  it('can process requests without error', async () => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue({
      success: true,
      code: 'const x = 1;',
      language: 'javascript',
      explanation: 'A simple const',
      execution: { success: true, output: '1', duration: 1 },
      metadata: { generatedAt: new Date().toISOString(), validationPassed: true },
    });
    const assistant = getDefaultAssistant();
    const response = await assistant.process(makeRequest({ message: 'hello there' }));
    expect(response).toBeDefined();
    expect(response.message).toBeDefined();
  });
});
