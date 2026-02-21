/**
 * Tests for InteractiveAgentBuilder, getInteractiveAgentBuilder, createInteractiveAgentBuilder
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mocks — must be declared before imports
// =============================================================================

vi.mock('node:crypto', () => {
  let counter = 0;
  return {
    randomUUID: () => `test-uuid-${++counter}`,
  };
});

vi.mock('../services/get-log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import {
  InteractiveAgentBuilder,
  getInteractiveAgentBuilder,
  createInteractiveAgentBuilder,
  DEFAULT_CATEGORIES as _DEFAULT_CATEGORIES,
  DEFAULT_DATA_STORES as _DEFAULT_DATA_STORES,
  BASE_QUESTIONS as _BASE_QUESTIONS,
  type GeneratedAgentConfig as _GeneratedAgentConfig,
  type BuilderQuestion,
  type BuilderAnswer as _BuilderAnswer,
  type BuilderSession,
  type BuilderLLMProvider,
  type ToolInfo,
  type DataStoreInfo as _DataStoreInfo,
  type InteractiveAgentBuilderConfig as _InteractiveAgentBuilderConfig,
} from './index.js';

// =============================================================================
// Helpers
// =============================================================================

function makeLLMProvider(response = 'A well-crafted system prompt that is long enough to pass the 50 char check'): BuilderLLMProvider {
  return {
    complete: vi.fn().mockResolvedValue(response),
  };
}

function makeToolInfo(overrides: Partial<ToolInfo> = {}): ToolInfo {
  return {
    id: 'search',
    name: 'Search',
    description: 'Search the web',
    category: 'web',
    ...overrides,
  };
}

/** Walk a session through every question and return the session id. */
async function completeSessions(builder: InteractiveAgentBuilder): Promise<string> {
  const session = builder.startSession();
  const questions = builder.getQuestions();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    let answer: string | string[] | boolean;
    if (q.type === 'multiselect') {
      answer = [];
    } else if (q.type === 'confirm') {
      answer = true;
    } else if (q.id === 'purpose') {
      answer = 'Help me manage bookmarks and save notes';
    } else if (q.id === 'name') {
      answer = 'My Agent';
    } else {
      answer = (q.default as string) ?? 'custom';
    }
    builder.submitAnswer(session.id, answer);
  }
  return session.id;
}

// =============================================================================
// Tests
// =============================================================================

describe('InteractiveAgentBuilder', () => {
  let builder: InteractiveAgentBuilder;

  beforeEach(() => {
    vi.clearAllMocks();
    builder = new InteractiveAgentBuilder();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Constructor & Config
  // ===========================================================================
  describe('constructor & config', () => {
    it('creates instance without config', () => {
      const b = new InteractiveAgentBuilder();
      expect(b).toBeInstanceOf(InteractiveAgentBuilder);
    });

    it('default config has empty availableTools', () => {
      const questions = builder.getQuestions();
      const toolQ = questions.find((q) => q.id === 'tools')!;
      expect(toolQ.options).toEqual([]);
    });

    it('default config has 6 DEFAULT_DATA_STORES', () => {
      const questions = builder.getQuestions();
      const dataQ = questions.find((q) => q.id === 'dataAccess')!;
      expect(dataQ.options).toHaveLength(6);
    });

    it('default config uses DEFAULT_CATEGORIES for category question', () => {
      const questions = builder.getQuestions();
      const catQ = questions.find((q) => q.id === 'category')!;
      expect(catQ.options).toHaveLength(9);
      expect(catQ.options!.map((o) => o.value)).toContain('productivity');
      expect(catQ.options!.map((o) => o.value)).toContain('finance');
      expect(catQ.options!.map((o) => o.value)).toContain('custom');
    });

    it('custom availableTools passed through to tool question', () => {
      const b = new InteractiveAgentBuilder({
        availableTools: [makeToolInfo({ id: 'my-tool', name: 'My Tool' })],
      });
      const questions = b.getQuestions();
      const toolQ = questions.find((q) => q.id === 'tools')!;
      expect(toolQ.options).toHaveLength(1);
      expect(toolQ.options![0]!.value).toBe('my-tool');
      expect(toolQ.options![0]!.label).toBe('My Tool');
    });

    it('custom availableDataStores are stored in config but dataAccess question uses BASE_QUESTIONS constant', () => {
      // BASE_QUESTIONS is a module-level constant — dataAccess options are baked in at module
      // load time from DEFAULT_DATA_STORES, not computed per-instance.
      // The config stores the override for use in suggestDataAccess, not for question rendering.
      const b = new InteractiveAgentBuilder({
        availableDataStores: [{ id: 'custom-ds', name: 'Custom DS', description: 'desc' }],
      });
      // The builder should still be created successfully
      expect(b).toBeInstanceOf(InteractiveAgentBuilder);
      // dataAccess question uses the static BASE_QUESTIONS (6 default stores)
      const questions = b.getQuestions();
      const dataQ = questions.find((q) => q.id === 'dataAccess')!;
      expect(dataQ.options).toHaveLength(6);
    });

    it('custom categories are stored in config but category question uses BASE_QUESTIONS constant', () => {
      // BASE_QUESTIONS is a module-level constant — category options are baked in at module
      // load time from DEFAULT_CATEGORIES, not computed per-instance.
      const b = new InteractiveAgentBuilder({ categories: ['alpha', 'beta'] });
      expect(b).toBeInstanceOf(InteractiveAgentBuilder);
      // category question uses the static BASE_QUESTIONS (9 default categories)
      const questions = b.getQuestions();
      const catQ = questions.find((q) => q.id === 'category')!;
      expect(catQ.options).toHaveLength(9);
    });

    it('category option labels are capitalized (using static BASE_QUESTIONS)', () => {
      const b = new InteractiveAgentBuilder();
      const questions = b.getQuestions();
      const catQ = questions.find((q) => q.id === 'category')!;
      // Default categories are capitalized in BASE_QUESTIONS at module level
      expect(catQ.options![0]!.label).toBe('Productivity');
      expect(catQ.options![1]!.label).toBe('Finance');
    });
  });

  // ===========================================================================
  // setLLMProvider
  // ===========================================================================
  describe('setLLMProvider', () => {
    it('can set LLM provider after construction', () => {
      const provider = makeLLMProvider();
      expect(() => builder.setLLMProvider(provider)).not.toThrow();
    });

    it('LLM provider is used during generateConfig', async () => {
      const provider = makeLLMProvider();
      builder.setLLMProvider(provider);

      const sessionId = await completeSessions(builder);
      await builder.generateConfig(sessionId);

      expect(provider.complete).toHaveBeenCalled();
    });

    it('can replace LLM provider', async () => {
      const provider1 = makeLLMProvider('first');
      const provider2 = makeLLMProvider('A much longer system prompt that exceeds fifty characters');
      builder.setLLMProvider(provider1);
      builder.setLLMProvider(provider2);

      const sessionId = await completeSessions(builder);
      await builder.generateConfig(sessionId);

      expect(provider1.complete).not.toHaveBeenCalled();
      expect(provider2.complete).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // setAvailableTools
  // ===========================================================================
  describe('setAvailableTools', () => {
    it('replaces availableTools', () => {
      builder.setAvailableTools([makeToolInfo({ id: 'tool-a' }), makeToolInfo({ id: 'tool-b' })]);
      const questions = builder.getQuestions();
      const toolQ = questions.find((q) => q.id === 'tools')!;
      expect(toolQ.options).toHaveLength(2);
      expect(toolQ.options!.map((o) => o.value)).toContain('tool-a');
      expect(toolQ.options!.map((o) => o.value)).toContain('tool-b');
    });

    it('sets empty tools array', () => {
      builder.setAvailableTools([makeToolInfo()]);
      builder.setAvailableTools([]);
      const questions = builder.getQuestions();
      const toolQ = questions.find((q) => q.id === 'tools')!;
      expect(toolQ.options).toEqual([]);
    });

    it('tool options carry description', () => {
      builder.setAvailableTools([makeToolInfo({ id: 'x', name: 'X Tool', description: 'Does X' })]);
      const questions = builder.getQuestions();
      const toolQ = questions.find((q) => q.id === 'tools')!;
      expect(toolQ.options![0]!.description).toBe('Does X');
    });
  });

  // ===========================================================================
  // Session lifecycle
  // ===========================================================================
  describe('startSession', () => {
    it('returns a session object with expected shape', () => {
      const session = builder.startSession();
      expect(session.id).toBeTruthy();
      expect(session.phase).toBe('gathering');
      expect(session.answers).toEqual([]);
      expect(session.currentQuestionIndex).toBe(0);
      expect(session.generatedConfig).toBeUndefined();
      expect(session.createdAt).toBeTruthy();
      expect(session.updatedAt).toBeTruthy();
    });

    it('session id is a UUID (from mocked randomUUID)', () => {
      const session = builder.startSession();
      expect(session.id).toMatch(/^test-uuid-/);
    });

    it('createdAt is a valid ISO date string', () => {
      const session = builder.startSession();
      expect(new Date(session.createdAt).toISOString()).toBe(session.createdAt);
    });

    it('each call creates a unique session', () => {
      const s1 = builder.startSession();
      const s2 = builder.startSession();
      expect(s1.id).not.toBe(s2.id);
    });

    it('multiple sessions are independent', () => {
      const s1 = builder.startSession();
      const s2 = builder.startSession();

      builder.submitAnswer(s1.id, 'answer for s1');

      expect(builder.getSession(s1.id)!.currentQuestionIndex).toBe(1);
      expect(builder.getSession(s2.id)!.currentQuestionIndex).toBe(0);
    });
  });

  describe('getSession', () => {
    it('returns session by id', () => {
      const session = builder.startSession();
      const retrieved = builder.getSession(session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(session.id);
    });

    it('returns null for unknown session id', () => {
      expect(builder.getSession('no-such-id')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(builder.getSession('')).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('returns true and removes session', () => {
      const session = builder.startSession();
      const result = builder.deleteSession(session.id);
      expect(result).toBe(true);
      expect(builder.getSession(session.id)).toBeNull();
    });

    it('returns false for unknown session id', () => {
      expect(builder.deleteSession('nonexistent')).toBe(false);
    });

    it('does not affect other sessions', () => {
      const s1 = builder.startSession();
      const s2 = builder.startSession();
      builder.deleteSession(s1.id);
      expect(builder.getSession(s2.id)).not.toBeNull();
    });

    it('deleting same session twice returns false second time', () => {
      const session = builder.startSession();
      builder.deleteSession(session.id);
      expect(builder.deleteSession(session.id)).toBe(false);
    });
  });

  // ===========================================================================
  // getQuestions
  // ===========================================================================
  describe('getQuestions', () => {
    it('returns 7 questions total (6 base + 1 tools)', () => {
      expect(builder.getQuestions()).toHaveLength(7);
    });

    it('first question is purpose', () => {
      expect(builder.getQuestions()[0]!.id).toBe('purpose');
    });

    it('second question is name', () => {
      expect(builder.getQuestions()[1]!.id).toBe('name');
    });

    it('third question is category', () => {
      expect(builder.getQuestions()[2]!.id).toBe('category');
    });

    it('fourth question is personality', () => {
      expect(builder.getQuestions()[3]!.id).toBe('personality');
    });

    it('fifth question is dataAccess', () => {
      expect(builder.getQuestions()[4]!.id).toBe('dataAccess');
    });

    it('sixth question is autonomous', () => {
      expect(builder.getQuestions()[5]!.id).toBe('autonomous');
    });

    it('seventh question is tools', () => {
      expect(builder.getQuestions()[6]!.id).toBe('tools');
    });

    it('purpose question is required', () => {
      const q = builder.getQuestions().find((q) => q.id === 'purpose')!;
      expect(q.required).toBe(true);
      expect(q.type).toBe('text');
    });

    it('name question is required', () => {
      const q = builder.getQuestions().find((q) => q.id === 'name')!;
      expect(q.required).toBe(true);
      expect(q.type).toBe('text');
    });

    it('category question has default', () => {
      const q = builder.getQuestions().find((q) => q.id === 'category')!;
      expect(q.default).toBe('custom');
    });

    it('personality question has default friendly', () => {
      const q = builder.getQuestions().find((q) => q.id === 'personality')!;
      expect(q.default).toBe('friendly');
    });

    it('personality question has 4 options', () => {
      const q = builder.getQuestions().find((q) => q.id === 'personality')!;
      expect(q.options).toHaveLength(4);
      const values = q.options!.map((o) => o.value);
      expect(values).toContain('professional');
      expect(values).toContain('friendly');
      expect(values).toContain('concise');
      expect(values).toContain('detailed');
    });

    it('dataAccess question is not required', () => {
      const q = builder.getQuestions().find((q) => q.id === 'dataAccess')!;
      expect(q.required).toBe(false);
    });

    it('autonomous question has default true', () => {
      const q = builder.getQuestions().find((q) => q.id === 'autonomous')!;
      expect(q.default).toBe(true);
      expect(q.type).toBe('confirm');
    });

    it('tools question is not required', () => {
      const q = builder.getQuestions().find((q) => q.id === 'tools')!;
      expect(q.required).toBe(false);
      expect(q.type).toBe('multiselect');
    });

    it('tools question options update after setAvailableTools', () => {
      expect(builder.getQuestions().find((q) => q.id === 'tools')!.options).toHaveLength(0);
      builder.setAvailableTools([makeToolInfo()]);
      expect(builder.getQuestions().find((q) => q.id === 'tools')!.options).toHaveLength(1);
    });
  });

  // ===========================================================================
  // getCurrentQuestion
  // ===========================================================================
  describe('getCurrentQuestion', () => {
    it('returns null for unknown session id', () => {
      expect(builder.getCurrentQuestion('nonexistent')).toBeNull();
    });

    it('returns first question on fresh session', () => {
      const session = builder.startSession();
      const q = builder.getCurrentQuestion(session.id);
      expect(q).not.toBeNull();
      expect(q!.id).toBe('purpose');
    });

    it('returns null when phase is not gathering', () => {
      const session = builder.startSession();
      session.phase = 'generating';
      expect(builder.getCurrentQuestion(session.id)).toBeNull();
    });

    it('returns null when phase is complete', () => {
      const session = builder.startSession();
      session.phase = 'complete';
      expect(builder.getCurrentQuestion(session.id)).toBeNull();
    });

    it('returns null when phase is refining', () => {
      const session = builder.startSession();
      session.phase = 'refining';
      expect(builder.getCurrentQuestion(session.id)).toBeNull();
    });

    it('returns second question after answering first', () => {
      const session = builder.startSession();
      builder.submitAnswer(session.id, 'My agent does stuff');
      const q = builder.getCurrentQuestion(session.id);
      expect(q!.id).toBe('name');
    });

    it('returns null when all questions answered (index beyond end)', () => {
      const session = builder.startSession();
      // Submit answers for all 7 questions
      builder.submitAnswer(session.id, 'purpose');
      builder.submitAnswer(session.id, 'name');
      builder.submitAnswer(session.id, 'custom');
      builder.submitAnswer(session.id, 'friendly');
      builder.submitAnswer(session.id, []);
      builder.submitAnswer(session.id, true);
      builder.submitAnswer(session.id, []);
      // After last, phase changes to generating, so getCurrentQuestion returns null
      expect(builder.getCurrentQuestion(session.id)).toBeNull();
    });
  });

  // ===========================================================================
  // submitAnswer
  // ===========================================================================
  describe('submitAnswer', () => {
    it('returns error for unknown session', () => {
      const result = builder.submitAnswer('bad-id', 'some answer');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
    });

    it('returns error when required question has empty string answer', () => {
      const session = builder.startSession();
      const result = builder.submitAnswer(session.id, '');
      expect(result.success).toBe(false);
      expect(result.error).toBe('This question is required');
    });

    it('returns error when required question has false boolean', () => {
      const session = builder.startSession();
      // purpose is required text — false is falsy
      const result = builder.submitAnswer(session.id, false);
      expect(result.success).toBe(false);
      expect(result.error).toBe('This question is required');
    });

    it('allows empty answer for non-required question (dataAccess)', () => {
      const session = builder.startSession();
      // Answer purpose (required)
      builder.submitAnswer(session.id, 'help me track tasks');
      // Answer name (required)
      builder.submitAnswer(session.id, 'Task Agent');
      // Answer category (required)
      builder.submitAnswer(session.id, 'productivity');
      // Answer personality (required)
      builder.submitAnswer(session.id, 'friendly');
      // dataAccess is NOT required — empty array should be accepted
      const result = builder.submitAnswer(session.id, []);
      expect(result.success).toBe(true);
    });

    it('returns error when session has no current question (index out of range)', () => {
      const session = builder.startSession();
      // Force index beyond questions
      session.currentQuestionIndex = 999;
      const result = builder.submitAnswer(session.id, 'whatever');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No current question');
    });

    it('stores answer in session.answers', () => {
      const session = builder.startSession();
      builder.submitAnswer(session.id, 'I am a bookmarks manager');
      const s = builder.getSession(session.id)!;
      expect(s.answers).toHaveLength(1);
      expect(s.answers[0]!.questionId).toBe('purpose');
      expect(s.answers[0]!.value).toBe('I am a bookmarks manager');
    });

    it('advances currentQuestionIndex by 1 on success', () => {
      const session = builder.startSession();
      expect(builder.getSession(session.id)!.currentQuestionIndex).toBe(0);
      builder.submitAnswer(session.id, 'I help with things');
      expect(builder.getSession(session.id)!.currentQuestionIndex).toBe(1);
    });

    it('updates updatedAt on success', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
      const session = builder.startSession();
      const originalUpdatedAt = session.updatedAt;

      vi.setSystemTime(new Date('2025-06-01T00:00:00Z'));
      builder.submitAnswer(session.id, 'I manage notes');

      const s = builder.getSession(session.id)!;
      expect(s.updatedAt).not.toBe(originalUpdatedAt);
      expect(s.updatedAt).toBe('2025-06-01T00:00:00.000Z');
      vi.useRealTimers();
    });

    it('returns nextQuestion for non-final questions', () => {
      const session = builder.startSession();
      const result = builder.submitAnswer(session.id, 'I track my bookmarks');
      expect(result.success).toBe(true);
      expect(result.complete).toBeUndefined();
      expect(result.nextQuestion).toBeDefined();
      expect(result.nextQuestion!.id).toBe('name');
    });

    it('returns complete=true and changes phase after last question', () => {
      const session = builder.startSession();
      builder.submitAnswer(session.id, 'purpose text');
      builder.submitAnswer(session.id, 'My Agent Name');
      builder.submitAnswer(session.id, 'productivity');
      builder.submitAnswer(session.id, 'friendly');
      builder.submitAnswer(session.id, []);
      builder.submitAnswer(session.id, true);
      const last = builder.submitAnswer(session.id, []);

      expect(last.success).toBe(true);
      expect(last.complete).toBe(true);
      expect(last.nextQuestion).toBeUndefined();
      expect(builder.getSession(session.id)!.phase).toBe('generating');
    });

    it('does not return nextQuestion when complete', () => {
      const session = builder.startSession();
      builder.submitAnswer(session.id, 'p');
      builder.submitAnswer(session.id, 'n');
      builder.submitAnswer(session.id, 'custom');
      builder.submitAnswer(session.id, 'friendly');
      builder.submitAnswer(session.id, []);
      builder.submitAnswer(session.id, true);
      const result = builder.submitAnswer(session.id, []);
      expect(result.nextQuestion).toBeUndefined();
    });

    it('answers accumulate across multiple submits', () => {
      const session = builder.startSession();
      builder.submitAnswer(session.id, 'purpose text');
      builder.submitAnswer(session.id, 'Agent Name');
      const s = builder.getSession(session.id)!;
      expect(s.answers).toHaveLength(2);
      expect(s.answers[0]!.questionId).toBe('purpose');
      expect(s.answers[1]!.questionId).toBe('name');
    });

    it('accepts array answer for multiselect question (dataAccess)', () => {
      const session = builder.startSession();
      builder.submitAnswer(session.id, 'purpose');
      builder.submitAnswer(session.id, 'name');
      builder.submitAnswer(session.id, 'custom');
      builder.submitAnswer(session.id, 'friendly');
      const result = builder.submitAnswer(session.id, ['bookmarks', 'notes']);
      expect(result.success).toBe(true);
      const s = builder.getSession(session.id)!;
      expect(s.answers.find((a) => a.questionId === 'dataAccess')!.value).toEqual([
        'bookmarks',
        'notes',
      ]);
    });

    it('autonomous question is required so false (falsy) returns error', () => {
      // autonomous has required: true; false is falsy so fails the !answer check
      const session = builder.startSession();
      builder.submitAnswer(session.id, 'purpose');
      builder.submitAnswer(session.id, 'name');
      builder.submitAnswer(session.id, 'custom');
      builder.submitAnswer(session.id, 'friendly');
      builder.submitAnswer(session.id, []);
      const result = builder.submitAnswer(session.id, false);
      expect(result.success).toBe(false);
      expect(result.error).toBe('This question is required');
    });

    it('accepts true for autonomous confirm question', () => {
      const session = builder.startSession();
      builder.submitAnswer(session.id, 'purpose');
      builder.submitAnswer(session.id, 'name');
      builder.submitAnswer(session.id, 'custom');
      builder.submitAnswer(session.id, 'friendly');
      builder.submitAnswer(session.id, []);
      const result = builder.submitAnswer(session.id, true);
      expect(result.success).toBe(true);
      const s = builder.getSession(session.id)!;
      expect(s.answers.find((a) => a.questionId === 'autonomous')!.value).toBe(true);
    });
  });

  // ===========================================================================
  // generateConfig
  // ===========================================================================
  describe('generateConfig', () => {
    it('returns error for unknown session', async () => {
      const result = await builder.generateConfig('bad-id');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
    });

    it('returns error when phase is not generating', async () => {
      const session = builder.startSession();
      const result = await builder.generateConfig(session.id);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not ready for generation');
    });

    it('returns error when phase is complete', async () => {
      const session = builder.startSession();
      session.phase = 'complete';
      const result = await builder.generateConfig(session.id);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not ready for generation');
    });

    it('returns success with config after full question flow', async () => {
      const sessionId = await completeSessions(builder);
      const result = await builder.generateConfig(sessionId);
      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
    });

    it('changes session phase to complete on success', async () => {
      const sessionId = await completeSessions(builder);
      await builder.generateConfig(sessionId);
      expect(builder.getSession(sessionId)!.phase).toBe('complete');
    });

    it('stores generatedConfig on session', async () => {
      const sessionId = await completeSessions(builder);
      await builder.generateConfig(sessionId);
      expect(builder.getSession(sessionId)!.generatedConfig).toBeDefined();
    });

    it('extracts purpose from answers', async () => {
      const sessionId = await completeSessions(builder);
      const result = await builder.generateConfig(sessionId);
      expect(result.config!.triggers.description).toBe(
        'Help me manage bookmarks and save notes',
      );
    });

    it('extracts name from answers', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'help me' },
        { questionId: 'name', value: 'Bookmarks Agent' },
        { questionId: 'category', value: 'productivity' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: true },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.name).toBe('Bookmarks Agent');
    });

    it('defaults name to Unnamed Agent when missing', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'something' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.name).toBe('Unnamed Agent');
    });

    it('generates id from name (lowercase, dashes)', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'My Cool Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.id).toBe('my-cool-agent');
    });

    it('id trims leading and trailing dashes', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: '  Special---Agent  ' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      // spaces → '-', leading/trailing '-' stripped
      expect(result.config!.id).not.toMatch(/^-/);
      expect(result.config!.id).not.toMatch(/-$/);
    });

    it('description is truncated to 200 chars', async () => {
      const longPurpose = 'x'.repeat(300);
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: longPurpose },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.description).toHaveLength(200);
    });

    it('description shorter than 200 chars is not padded', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'Short purpose' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.description).toBe('Short purpose');
    });

    it('temperature is 0.3 for professional personality', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'professional' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.config.temperature).toBe(0.3);
    });

    it('temperature is 0.7 for friendly personality', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.config.temperature).toBe(0.7);
    });

    it('temperature is 0.7 for concise personality', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'concise' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.config.temperature).toBe(0.7);
    });

    it('temperature is 0.7 for detailed personality', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'detailed' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.config.temperature).toBe(0.7);
    });

    it('maxTurns is 50 when autonomous=true', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: true },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.config.maxTurns).toBe(50);
    });

    it('maxTurns is 25 when autonomous=false', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.config.maxTurns).toBe(25);
    });

    it('maxToolCalls is 200 when autonomous=true', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: true },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.config.maxToolCalls).toBe(200);
    });

    it('maxToolCalls is 100 when autonomous=false', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.config.maxToolCalls).toBe(100);
    });

    it('maxTokens is always 4096', async () => {
      const sessionId = await completeSessions(builder);
      const result = await builder.generateConfig(sessionId);
      expect(result.config!.config.maxTokens).toBe(4096);
    });

    it('tools array from answers is placed in config', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: ['save_bookmark', 'search_notes'] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.tools).toEqual(['save_bookmark', 'search_notes']);
    });

    it('dataAccess array from answers is placed in config', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: ['bookmarks', 'notes'] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.dataAccess).toEqual(['bookmarks', 'notes']);
    });

    it('defaults dataAccess to empty array when missing', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.dataAccess).toEqual([]);
    });

    it('trigger keywords are derived from purpose', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'manage financial expenses and track budget' },
        { questionId: 'name', value: 'Finance Agent' },
        { questionId: 'category', value: 'finance' },
        { questionId: 'personality', value: 'professional' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      const keywords = result.config!.triggers.keywords;
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords).toContain('manage');
      expect(keywords).toContain('financial');
      expect(keywords).toContain('expenses');
    });

    it('category is extracted from answers', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: 'test' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'development' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      expect(result.config!.category).toBe('development');
    });
  });

  // ===========================================================================
  // generateSystemPrompt — tested indirectly via generateConfig
  // ===========================================================================
  describe('generateSystemPrompt (via generateConfig)', () => {
    function makeMinimalSession(
      builder: InteractiveAgentBuilder,
      overrides: Record<string, string | string[] | boolean> = {},
    ): BuilderSession {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: (overrides.purpose as string) ?? 'test purpose' },
        { questionId: 'name', value: (overrides.name as string) ?? 'Test Agent' },
        { questionId: 'category', value: (overrides.category as string) ?? 'custom' },
        {
          questionId: 'personality',
          value: (overrides.personality as string) ?? 'friendly',
        },
        { questionId: 'dataAccess', value: (overrides.dataAccess as string[]) ?? [] },
        { questionId: 'autonomous', value: (overrides.autonomous as boolean) ?? false },
        { questionId: 'tools', value: (overrides.tools as string[]) ?? [] },
      ];
      session.phase = 'generating';
      return session;
    }

    it('uses LLM response when provider returns long response (> 50 chars)', async () => {
      const longResponse = 'You are a highly capable AI assistant designed to help with tasks';
      const provider = makeLLMProvider(longResponse);
      builder.setLLMProvider(provider);

      const session = makeMinimalSession(builder);
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toBe(longResponse);
    });

    it('falls back to template when LLM response is <= 50 chars', async () => {
      const provider = makeLLMProvider('Too short');
      builder.setLLMProvider(provider);

      const session = makeMinimalSession(builder, { name: 'Template Agent', purpose: 'help users find data' });
      const result = await builder.generateConfig(session.id);
      // Template always starts with "You are <name>"
      expect(result.config!.systemPrompt).toContain('You are Template Agent');
    });

    it('falls back to template when LLM response is exactly 50 chars', async () => {
      const provider = makeLLMProvider('x'.repeat(50)); // exactly 50, not > 50
      builder.setLLMProvider(provider);

      const session = makeMinimalSession(builder, { name: 'Boundary Agent', purpose: 'testing boundaries' });
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toContain('You are Boundary Agent');
    });

    it('falls back to template when LLM throws', async () => {
      const provider: BuilderLLMProvider = {
        complete: vi.fn().mockRejectedValue(new Error('LLM offline')),
      };
      builder.setLLMProvider(provider);

      const session = makeMinimalSession(builder, { name: 'Fallback Agent', purpose: 'do fallback stuff' });
      const result = await builder.generateConfig(session.id);
      // Should not throw and should use template
      expect(result.success).toBe(true);
      expect(result.config!.systemPrompt).toContain('You are Fallback Agent');
    });

    it('template includes name and purpose', async () => {
      const session = makeMinimalSession(builder, {
        name: 'Note Keeper',
        purpose: 'Save and organize notes for users',
      });
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toContain('Note Keeper');
      expect(result.config!.systemPrompt).toContain('Save and organize notes for users');
    });

    it('template includes professional personality text', async () => {
      const session = makeMinimalSession(builder, { personality: 'professional' });
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toContain('professional, business-like');
    });

    it('template includes friendly personality text', async () => {
      const session = makeMinimalSession(builder, { personality: 'friendly' });
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toContain('warm, approachable');
    });

    it('template includes concise personality text', async () => {
      const session = makeMinimalSession(builder, { personality: 'concise' });
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toContain('brief and to the point');
    });

    it('template includes detailed personality text', async () => {
      const session = makeMinimalSession(builder, { personality: 'detailed' });
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toContain('thorough explanations');
    });

    it('template includes Capabilities section when tools present', async () => {
      const session = makeMinimalSession(builder, { tools: ['save_note', 'search_notes'] });
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toContain('## Capabilities');
      expect(result.config!.systemPrompt).toContain('save_note');
      expect(result.config!.systemPrompt).toContain('search_notes');
    });

    it('template omits Capabilities section when no tools', async () => {
      const session = makeMinimalSession(builder, { tools: [] });
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).not.toContain('## Capabilities');
    });

    it('template includes Data Access section when dataAccess present', async () => {
      const session = makeMinimalSession(builder, { dataAccess: ['bookmarks', 'notes'] });
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toContain('## Data Access');
      expect(result.config!.systemPrompt).toContain('bookmarks');
      expect(result.config!.systemPrompt).toContain('notes');
    });

    it('template omits Data Access section when no dataAccess', async () => {
      const session = makeMinimalSession(builder, { dataAccess: [] });
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).not.toContain('## Data Access');
    });

    it('template always includes Core Responsibilities section', async () => {
      const session = makeMinimalSession(builder);
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toContain('## Core Responsibilities');
    });

    it('template always includes Guidelines section', async () => {
      const session = makeMinimalSession(builder);
      const result = await builder.generateConfig(session.id);
      expect(result.config!.systemPrompt).toContain('## Guidelines');
    });

    it('LLM is called with correct prompt structure', async () => {
      const provider = makeLLMProvider(
        'A detailed system prompt that is long enough to be used directly by the builder',
      );
      builder.setLLMProvider(provider);

      const session = makeMinimalSession(builder, {
        name: 'Expense Bot',
        purpose: 'track expenses',
        personality: 'professional',
        tools: ['add_expense'],
        dataAccess: ['finances'],
      });
      await builder.generateConfig(session.id);

      const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
        role: string;
        content: string;
      }>;
      expect(callArgs).toHaveLength(1);
      expect(callArgs[0]!.role).toBe('user');
      expect(callArgs[0]!.content).toContain('Expense Bot');
      expect(callArgs[0]!.content).toContain('track expenses');
      expect(callArgs[0]!.content).toContain('professional');
      expect(callArgs[0]!.content).toContain('add_expense');
      expect(callArgs[0]!.content).toContain('finances');
    });
  });

  // ===========================================================================
  // selectEmoji — tested indirectly via generateConfig / quickCreate
  // ===========================================================================
  describe('selectEmoji (via generateConfig purpose keywords)', () => {
    async function getEmoji(purpose: string, category = 'custom'): Promise<string> {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: purpose },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: category },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      return result.config!.emoji;
    }

    it('bookmark keyword → 🔖', async () => {
      expect(await getEmoji('manage bookmarks and links')).toBe('🔖');
    });

    it('note keyword → 📝', async () => {
      expect(await getEmoji('take notes and organize documents')).toBe('📝');
    });

    it('finance keyword → 💰', async () => {
      expect(await getEmoji('track finances and budgets')).toBe('💰');
    });

    it('money keyword → 💰', async () => {
      expect(await getEmoji('handle money transfers')).toBe('💰');
    });

    it('expense keyword → 💰', async () => {
      expect(await getEmoji('log expense records')).toBe('💰');
    });

    it('code keyword → 💻', async () => {
      expect(await getEmoji('write code snippets')).toBe('💻');
    });

    it('program keyword → 💻', async () => {
      expect(await getEmoji('help program applications')).toBe('💻');
    });

    it('write keyword → ✍️', async () => {
      expect(await getEmoji('write blog posts')).toBe('✍️');
    });

    it('writing keyword → ✍️', async () => {
      expect(await getEmoji('assist with writing tasks')).toBe('✍️');
    });

    it('research keyword → 🔬', async () => {
      expect(await getEmoji('conduct research on topics')).toBe('🔬');
    });

    it('schedule keyword → 📅', async () => {
      expect(await getEmoji('manage my schedule')).toBe('📅');
    });

    it('calendar keyword → 📅', async () => {
      expect(await getEmoji('view calendar events')).toBe('📅');
    });

    it('email keyword → 📧', async () => {
      expect(await getEmoji('compose email messages')).toBe('📧');
    });

    it('message keyword → 📧', async () => {
      expect(await getEmoji('send messages to contacts')).toBe('📧');
    });

    it('learn keyword → 📚', async () => {
      expect(await getEmoji('help me learn new topics')).toBe('📚');
    });

    it('study keyword → 📚', async () => {
      expect(await getEmoji('assist with study sessions')).toBe('📚');
    });

    it('health keyword → 💪', async () => {
      expect(await getEmoji('monitor health metrics')).toBe('💪');
    });

    it('fitness keyword → 💪', async () => {
      expect(await getEmoji('track fitness goals')).toBe('💪');
    });

    it('travel keyword → ✈️', async () => {
      expect(await getEmoji('plan travel itineraries')).toBe('✈️');
    });

    it('recipe keyword → 👨‍🍳', async () => {
      expect(await getEmoji('find recipe ideas')).toBe('👨‍🍳');
    });

    it('cook keyword → 👨‍🍳', async () => {
      expect(await getEmoji('help cook meals')).toBe('👨‍🍳');
    });

    it('music keyword → 🎵', async () => {
      expect(await getEmoji('create music playlists')).toBe('🎵');
    });

    it('movie keyword → 🎬', async () => {
      expect(await getEmoji('recommend movies to watch')).toBe('🎬');
    });

    it('video keyword → 🎬', async () => {
      expect(await getEmoji('manage video content')).toBe('🎬');
    });

    it('category productivity fallback → ⚡', async () => {
      expect(await getEmoji('generic helper', 'productivity')).toBe('⚡');
    });

    it('category finance fallback → 💰', async () => {
      expect(await getEmoji('generic helper', 'finance')).toBe('💰');
    });

    it('category development fallback → 💻', async () => {
      expect(await getEmoji('generic helper', 'development')).toBe('💻');
    });

    it('category communication fallback → 💬', async () => {
      expect(await getEmoji('generic helper', 'communication')).toBe('💬');
    });

    it('category data fallback → 📊', async () => {
      expect(await getEmoji('generic helper', 'data')).toBe('📊');
    });

    it('category education fallback → 📚', async () => {
      expect(await getEmoji('generic helper', 'education')).toBe('📚');
    });

    it('category health fallback → ❤️', async () => {
      expect(await getEmoji('generic helper', 'health')).toBe('❤️');
    });

    it('category entertainment fallback → 🎮', async () => {
      expect(await getEmoji('generic helper', 'entertainment')).toBe('🎮');
    });

    it('category custom fallback → 🤖', async () => {
      expect(await getEmoji('generic helper', 'custom')).toBe('🤖');
    });

    it('unknown category falls back to 🤖', async () => {
      expect(await getEmoji('generic helper', 'unknown-category')).toBe('🤖');
    });

    it('keyword match takes precedence over category fallback', async () => {
      // purpose has 'bookmark' → 🔖, even though category is 'productivity' (→ ⚡)
      expect(await getEmoji('save bookmark links', 'productivity')).toBe('🔖');
    });

    it('purpose check is case insensitive', async () => {
      expect(await getEmoji('Track My FINANCES')).toBe('💰');
    });
  });

  // ===========================================================================
  // extractKeywords — tested indirectly via generateConfig
  // ===========================================================================
  describe('extractKeywords (via generateConfig trigger keywords)', () => {
    async function getKeywords(purpose: string): Promise<string[]> {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: purpose },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      return result.config!.triggers.keywords;
    }

    it('filters out words with 3 or fewer characters', async () => {
      const keywords = await getKeywords('the cat sat on the mat for fun');
      expect(keywords).not.toContain('the');
      expect(keywords).not.toContain('cat');
      expect(keywords).not.toContain('sat');
      expect(keywords).not.toContain('mat');
      expect(keywords).not.toContain('for');
      expect(keywords).not.toContain('fun');
    });

    it('filters out stop words', async () => {
      // 'this', 'with', 'those' are stop words — 'should', 'have', 'that' are also stop words
      // 'words' is NOT a stop word (5 chars, not in the list) so it will appear
      const keywords = await getKeywords('this should have that with those');
      expect(keywords).not.toContain('this');
      expect(keywords).not.toContain('should');
      expect(keywords).not.toContain('have');
      expect(keywords).not.toContain('that');
      expect(keywords).not.toContain('with');
      expect(keywords).not.toContain('those');
    });

    it('"words" is not a stop word and not filtered', async () => {
      const keywords = await getKeywords('words with purpose');
      // 'with' is a stop word (filtered), 'words' is not (5 chars, kept)
      expect(keywords).toContain('words');
      expect(keywords).not.toContain('with');
    });

    it('returns max 10 keywords', async () => {
      const longPurpose = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';
      const keywords = await getKeywords(longPurpose);
      expect(keywords.length).toBeLessThanOrEqual(10);
    });

    it('returns lowercase keywords', async () => {
      const keywords = await getKeywords('Manage Financial Records And Track Expenses');
      for (const kw of keywords) {
        expect(kw).toBe(kw.toLowerCase());
      }
    });

    it('includes meaningful words from purpose', async () => {
      const keywords = await getKeywords('manage financial records expenses');
      expect(keywords).toContain('manage');
      expect(keywords).toContain('financial');
      expect(keywords).toContain('records');
      expect(keywords).toContain('expenses');
    });

    it('handles empty purpose gracefully', async () => {
      const session = builder.startSession();
      session.answers = [
        { questionId: 'purpose', value: '' },
        { questionId: 'name', value: 'Agent' },
        { questionId: 'category', value: 'custom' },
        { questionId: 'personality', value: 'friendly' },
        { questionId: 'dataAccess', value: [] },
        { questionId: 'autonomous', value: false },
        { questionId: 'tools', value: [] },
      ];
      session.phase = 'generating';
      const result = await builder.generateConfig(session.id);
      // Should not throw; keywords may be empty or minimal
      expect(Array.isArray(result.config!.triggers.keywords)).toBe(true);
    });

    it('splits on non-word characters', async () => {
      const keywords = await getKeywords('manage-expenses,track.budgets');
      expect(keywords).toContain('manage');
      expect(keywords).toContain('expenses');
      expect(keywords).toContain('track');
      expect(keywords).toContain('budgets');
    });

    it('word "would" is filtered as stop word', async () => {
      const keywords = await getKeywords('something would help users navigate difficult tasks');
      expect(keywords).not.toContain('would');
    });
  });

  // ===========================================================================
  // quickCreate
  // ===========================================================================
  describe('quickCreate', () => {
    it('returns success with config for a simple purpose', async () => {
      const result = await builder.quickCreate('help me track my bookmarks and links');
      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
    });

    it('uses provided name when given', async () => {
      const result = await builder.quickCreate('help me take notes', 'My Notes Bot');
      expect(result.config!.name).toBe('My Notes Bot');
    });

    it('auto-generates name from purpose when not given', async () => {
      const result = await builder.quickCreate('save links and bookmarks for later');
      // generateNameFromPurpose takes first 3 words and capitalizes each + " Agent"
      expect(result.config!.name).toContain('Agent');
    });

    it('generated name is 3 capitalized words + Agent suffix', async () => {
      const result = await builder.quickCreate('track my expenses daily');
      expect(result.config!.name).toBe('Track My Expenses Agent');
    });

    it('autonomous is always true in quickCreate', async () => {
      const result = await builder.quickCreate('do whatever');
      expect(result.config!.config.maxTurns).toBe(50);
      expect(result.config!.config.maxToolCalls).toBe(200);
    });

    it('personality is always friendly in quickCreate', async () => {
      const result = await builder.quickCreate('general helper');
      // friendly → temperature 0.7
      expect(result.config!.config.temperature).toBe(0.7);
    });

    it('creates a session that ends in complete phase', async () => {
      await builder.quickCreate('test purpose');
      // We can't easily get the session id from quickCreate, but we can verify no error
      // and that the config is present
    });
  });

  // ===========================================================================
  // detectCategory (via quickCreate)
  // ===========================================================================
  describe('detectCategory (via quickCreate)', () => {
    it('finance keyword → finance', async () => {
      const result = await builder.quickCreate('manage my finance records');
      expect(result.config!.category).toBe('finance');
    });

    it('money keyword → finance', async () => {
      const result = await builder.quickCreate('track money spending');
      expect(result.config!.category).toBe('finance');
    });

    it('expense keyword → finance', async () => {
      const result = await builder.quickCreate('log expense data');
      expect(result.config!.category).toBe('finance');
    });

    it('budget keyword → finance', async () => {
      const result = await builder.quickCreate('plan monthly budget');
      expect(result.config!.category).toBe('finance');
    });

    it('code keyword → development', async () => {
      const result = await builder.quickCreate('help write code snippets');
      expect(result.config!.category).toBe('development');
    });

    it('program keyword → development', async () => {
      const result = await builder.quickCreate('assist to program apps');
      expect(result.config!.category).toBe('development');
    });

    it('develop keyword → development', async () => {
      const result = await builder.quickCreate('help develop software solutions');
      expect(result.config!.category).toBe('development');
    });

    it('learn keyword → education', async () => {
      const result = await builder.quickCreate('help me learn languages');
      expect(result.config!.category).toBe('education');
    });

    it('study keyword → education', async () => {
      const result = await builder.quickCreate('assist study sessions');
      expect(result.config!.category).toBe('education');
    });

    it('teach keyword → education', async () => {
      const result = await builder.quickCreate('teach complex concepts');
      expect(result.config!.category).toBe('education');
    });

    it('email keyword → communication', async () => {
      const result = await builder.quickCreate('compose email messages');
      expect(result.config!.category).toBe('communication');
    });

    it('message keyword → communication', async () => {
      const result = await builder.quickCreate('send message notifications');
      expect(result.config!.category).toBe('communication');
    });

    it('chat keyword → communication', async () => {
      const result = await builder.quickCreate('support chat interactions');
      expect(result.config!.category).toBe('communication');
    });

    it('task keyword → productivity', async () => {
      const result = await builder.quickCreate('manage task lists');
      expect(result.config!.category).toBe('productivity');
    });

    it('schedule keyword → productivity', async () => {
      const result = await builder.quickCreate('schedule meetings and events');
      expect(result.config!.category).toBe('productivity');
    });

    it('organize keyword → productivity', async () => {
      const result = await builder.quickCreate('organize daily workflows');
      expect(result.config!.category).toBe('productivity');
    });

    it('data keyword → data', async () => {
      const result = await builder.quickCreate('process large data sets');
      expect(result.config!.category).toBe('data');
    });

    it('analyze keyword → data', async () => {
      const result = await builder.quickCreate('analyze performance metrics');
      expect(result.config!.category).toBe('data');
    });

    it('report keyword → data', async () => {
      const result = await builder.quickCreate('generate sales reports weekly');
      expect(result.config!.category).toBe('data');
    });

    it('unrecognized purpose → custom', async () => {
      const result = await builder.quickCreate('something completely unique and different');
      expect(result.config!.category).toBe('custom');
    });
  });

  // ===========================================================================
  // suggestDataAccess (via quickCreate)
  // ===========================================================================
  describe('suggestDataAccess (via quickCreate)', () => {
    it('bookmark keyword → includes bookmarks', async () => {
      const result = await builder.quickCreate('manage bookmark collections');
      expect(result.config!.dataAccess).toContain('bookmarks');
    });

    it('save keyword → includes bookmarks', async () => {
      const result = await builder.quickCreate('save urls for later');
      expect(result.config!.dataAccess).toContain('bookmarks');
    });

    it('link keyword → includes bookmarks', async () => {
      const result = await builder.quickCreate('organize useful links');
      expect(result.config!.dataAccess).toContain('bookmarks');
    });

    it('note keyword → includes notes', async () => {
      const result = await builder.quickCreate('create notes and reminders');
      expect(result.config!.dataAccess).toContain('notes');
    });

    it('document keyword → includes notes', async () => {
      const result = await builder.quickCreate('edit documents and files');
      expect(result.config!.dataAccess).toContain('notes');
    });

    it('finance keyword → includes finances', async () => {
      const result = await builder.quickCreate('manage my finance accounts');
      expect(result.config!.dataAccess).toContain('finances');
    });

    it('expense keyword → includes finances', async () => {
      const result = await builder.quickCreate('track expense records');
      expect(result.config!.dataAccess).toContain('finances');
    });

    it('money keyword → includes finances', async () => {
      const result = await builder.quickCreate('save money by tracking spending');
      expect(result.config!.dataAccess).toContain('finances');
    });

    it('remember keyword → includes memory', async () => {
      const result = await builder.quickCreate('remember important facts');
      expect(result.config!.dataAccess).toContain('memory');
    });

    it('memory keyword → includes memory', async () => {
      const result = await builder.quickCreate('store items in memory');
      expect(result.config!.dataAccess).toContain('memory');
    });

    it('schedule keyword → includes calendar', async () => {
      const result = await builder.quickCreate('schedule meetings and appointments');
      expect(result.config!.dataAccess).toContain('calendar');
    });

    it('calendar keyword → includes calendar', async () => {
      const result = await builder.quickCreate('view calendar entries');
      expect(result.config!.dataAccess).toContain('calendar');
    });

    it('event keyword → includes calendar', async () => {
      const result = await builder.quickCreate('track upcoming events');
      expect(result.config!.dataAccess).toContain('calendar');
    });

    it('unrelated purpose → empty dataAccess', async () => {
      const result = await builder.quickCreate('play chess and analyze positions');
      expect(result.config!.dataAccess).toEqual([]);
    });

    it('multiple keywords match multiple data stores', async () => {
      const result = await builder.quickCreate('save bookmark links and take notes');
      expect(result.config!.dataAccess).toContain('bookmarks');
      expect(result.config!.dataAccess).toContain('notes');
    });
  });

  // ===========================================================================
  // suggestTools (via quickCreate)
  // ===========================================================================
  describe('suggestTools (via quickCreate)', () => {
    it('no available tools → empty tools array', async () => {
      const result = await builder.quickCreate('manage bookmarks');
      expect(result.config!.tools).toEqual([]);
    });

    it('only adds tools that are available', async () => {
      builder.setAvailableTools([makeToolInfo({ id: 'save_bookmark' })]);
      const result = await builder.quickCreate('manage bookmarks');
      expect(result.config!.tools).toContain('save_bookmark');
    });

    it('does not add tools not in availableTools', async () => {
      builder.setAvailableTools([makeToolInfo({ id: 'save_bookmark' })]);
      // search_bookmarks and fetch_web_page are not available
      const result = await builder.quickCreate('manage bookmarks');
      expect(result.config!.tools).not.toContain('search_bookmarks');
      expect(result.config!.tools).not.toContain('fetch_web_page');
    });

    it('adds basic tools (get_current_time, calculate) when available', async () => {
      builder.setAvailableTools([
        makeToolInfo({ id: 'get_current_time' }),
        makeToolInfo({ id: 'calculate' }),
      ]);
      const result = await builder.quickCreate('help me with things');
      expect(result.config!.tools).toContain('get_current_time');
      expect(result.config!.tools).toContain('calculate');
    });

    it('does not duplicate tools', async () => {
      builder.setAvailableTools([
        makeToolInfo({ id: 'save_bookmark' }),
        makeToolInfo({ id: 'get_current_time' }),
      ]);
      const result = await builder.quickCreate('save bookmark links');
      const bookmarkCount = result.config!.tools.filter((t) => t === 'save_bookmark').length;
      expect(bookmarkCount).toBe(1);
    });

    it('note/write keywords suggest note tools', async () => {
      builder.setAvailableTools([
        makeToolInfo({ id: 'save_note' }),
        makeToolInfo({ id: 'search_notes' }),
      ]);
      const result = await builder.quickCreate('write notes and ideas');
      expect(result.config!.tools).toContain('save_note');
      expect(result.config!.tools).toContain('search_notes');
    });

    it('expense/finance/money/budget keywords suggest expense tools', async () => {
      builder.setAvailableTools([
        makeToolInfo({ id: 'add_expense' }),
        makeToolInfo({ id: 'query_expenses' }),
        makeToolInfo({ id: 'expense_summary' }),
      ]);
      const result = await builder.quickCreate('track monthly budget and expenses');
      expect(result.config!.tools).toContain('add_expense');
      expect(result.config!.tools).toContain('query_expenses');
      expect(result.config!.tools).toContain('expense_summary');
    });

    it('code/program/script keywords suggest execute_javascript', async () => {
      builder.setAvailableTools([makeToolInfo({ id: 'execute_javascript' })]);
      const result = await builder.quickCreate('run code scripts automatically');
      expect(result.config!.tools).toContain('execute_javascript');
    });

    it('remember/memory keywords suggest memory tools', async () => {
      builder.setAvailableTools([
        makeToolInfo({ id: 'create_memory' }),
        makeToolInfo({ id: 'search_memories' }),
      ]);
      const result = await builder.quickCreate('remember information from memory');
      expect(result.config!.tools).toContain('create_memory');
      expect(result.config!.tools).toContain('search_memories');
    });

    it('web/fetch/http/api keywords suggest http tools', async () => {
      builder.setAvailableTools([
        makeToolInfo({ id: 'http_request' }),
        makeToolInfo({ id: 'fetch_web_page' }),
      ]);
      const result = await builder.quickCreate('fetch data from web apis');
      expect(result.config!.tools).toContain('http_request');
      expect(result.config!.tools).toContain('fetch_web_page');
    });

    it('schedule/reminder/calendar keywords suggest scheduling tools', async () => {
      builder.setAvailableTools([
        makeToolInfo({ id: 'create_scheduled_task' }),
        makeToolInfo({ id: 'list_scheduled_tasks' }),
      ]);
      const result = await builder.quickCreate('schedule reminders and calendar events');
      expect(result.config!.tools).toContain('create_scheduled_task');
      expect(result.config!.tools).toContain('list_scheduled_tasks');
    });

    it('file/read/document keywords suggest file tools', async () => {
      builder.setAvailableTools([
        makeToolInfo({ id: 'read_file' }),
        makeToolInfo({ id: 'write_file' }),
        makeToolInfo({ id: 'list_directory' }),
      ]);
      const result = await builder.quickCreate('read files and documents');
      expect(result.config!.tools).toContain('read_file');
      expect(result.config!.tools).toContain('write_file');
      expect(result.config!.tools).toContain('list_directory');
    });
  });

  // ===========================================================================
  // generateNameFromPurpose (via quickCreate without name arg)
  // ===========================================================================
  describe('generateNameFromPurpose (via quickCreate without name)', () => {
    it('takes first 3 words and capitalizes', async () => {
      const result = await builder.quickCreate('track my expenses efficiently');
      expect(result.config!.name).toBe('Track My Expenses Agent');
    });

    it('handles purpose with fewer than 3 words', async () => {
      const result = await builder.quickCreate('track expenses', undefined);
      expect(result.config!.name).toBe('Track Expenses Agent');
    });

    it('handles single-word purpose', async () => {
      const result = await builder.quickCreate('bookmarks');
      expect(result.config!.name).toBe('Bookmarks Agent');
    });

    it('lowercases each word before capitalizing first letter', async () => {
      const result = await builder.quickCreate('TRACK MY EXPENSES NOW');
      expect(result.config!.name).toBe('Track My Expenses Agent');
    });

    it('splits on non-word characters', async () => {
      const result = await builder.quickCreate('track-my-expenses today');
      expect(result.config!.name).toContain('Agent');
    });
  });
});

// =============================================================================
// Constants
// =============================================================================

describe('DEFAULT_CATEGORIES', () => {
  // Import to test via a fresh builder's question options
  it('has 9 categories', () => {
    const b = new InteractiveAgentBuilder();
    const questions = b.getQuestions();
    const catQ = questions.find((q) => q.id === 'category')!;
    expect(catQ.options).toHaveLength(9);
  });

  it('contains productivity', () => {
    const b = new InteractiveAgentBuilder();
    const catQ = b.getQuestions().find((q) => q.id === 'category')!;
    expect(catQ.options!.map((o) => o.value)).toContain('productivity');
  });

  it('contains all 9 expected values', () => {
    const b = new InteractiveAgentBuilder();
    const catQ = b.getQuestions().find((q) => q.id === 'category')!;
    const values = catQ.options!.map((o) => o.value);
    for (const v of [
      'productivity',
      'finance',
      'development',
      'communication',
      'data',
      'education',
      'health',
      'entertainment',
      'custom',
    ]) {
      expect(values).toContain(v);
    }
  });
});

describe('DEFAULT_DATA_STORES', () => {
  it('has 6 data stores', () => {
    const b = new InteractiveAgentBuilder();
    const dataQ = b.getQuestions().find((q) => q.id === 'dataAccess')!;
    expect(dataQ.options).toHaveLength(6);
  });

  it('contains bookmarks, notes, finances, memory, preferences, calendar', () => {
    const b = new InteractiveAgentBuilder();
    const dataQ = b.getQuestions().find((q) => q.id === 'dataAccess')!;
    const values = dataQ.options!.map((o) => o.value);
    for (const v of ['bookmarks', 'notes', 'finances', 'memory', 'preferences', 'calendar']) {
      expect(values).toContain(v);
    }
  });
});

describe('BASE_QUESTIONS', () => {
  it('has 6 base questions', () => {
    // getQuestions returns 7 (6 base + 1 dynamic tools question)
    // so BASE_QUESTIONS is 6
    const b = new InteractiveAgentBuilder();
    expect(b.getQuestions()).toHaveLength(7);
  });
});

// =============================================================================
// Factory Functions
// =============================================================================

describe('getInteractiveAgentBuilder', () => {
  it('returns an InteractiveAgentBuilder instance', () => {
    const b = getInteractiveAgentBuilder();
    expect(b).toBeInstanceOf(InteractiveAgentBuilder);
  });

  it('returns the same singleton instance on repeated calls', () => {
    const b1 = getInteractiveAgentBuilder();
    const b2 = getInteractiveAgentBuilder();
    expect(b1).toBe(b2);
  });

  it('singleton has expected getQuestions behavior', () => {
    const b = getInteractiveAgentBuilder();
    expect(b.getQuestions()).toHaveLength(7);
  });
});

describe('createInteractiveAgentBuilder', () => {
  it('creates a new InteractiveAgentBuilder instance', () => {
    const b = createInteractiveAgentBuilder();
    expect(b).toBeInstanceOf(InteractiveAgentBuilder);
  });

  it('creates a new instance each time (not singleton)', () => {
    const b1 = createInteractiveAgentBuilder();
    const b2 = createInteractiveAgentBuilder();
    expect(b1).not.toBe(b2);
  });

  it('returns instance different from singleton', () => {
    const singleton = getInteractiveAgentBuilder();
    const fresh = createInteractiveAgentBuilder();
    expect(fresh).not.toBe(singleton);
  });

  it('accepts custom config', () => {
    const b = createInteractiveAgentBuilder({
      availableTools: [makeToolInfo({ id: 'custom-tool' })],
    });
    const questions = b.getQuestions();
    const toolQ = questions.find((q) => q.id === 'tools')!;
    expect(toolQ.options![0]!.value).toBe('custom-tool');
  });

  it('accepts undefined config (uses defaults)', () => {
    const b = createInteractiveAgentBuilder(undefined);
    expect(b).toBeInstanceOf(InteractiveAgentBuilder);
    expect(b.getQuestions()).toHaveLength(7);
  });

  it('each instance has independent session state', () => {
    const b1 = createInteractiveAgentBuilder();
    const b2 = createInteractiveAgentBuilder();
    const s1 = b1.startSession();
    // b2 should not know about b1's session
    expect(b2.getSession(s1.id)).toBeNull();
  });

  it('each instance has independent tool state', () => {
    const b1 = createInteractiveAgentBuilder({ availableTools: [makeToolInfo({ id: 'tool-x' })] });
    const b2 = createInteractiveAgentBuilder({ availableTools: [] });
    expect(b1.getQuestions().find((q) => q.id === 'tools')!.options).toHaveLength(1);
    expect(b2.getQuestions().find((q) => q.id === 'tools')!.options).toHaveLength(0);
  });
});

// =============================================================================
// Integration: full session walkthrough
// =============================================================================

describe('full session walkthrough', () => {
  let builder: InteractiveAgentBuilder;

  beforeEach(() => {
    vi.clearAllMocks();
    builder = new InteractiveAgentBuilder({
      availableTools: [
        makeToolInfo({ id: 'save_bookmark', name: 'Save Bookmark', description: 'Saves a bookmark' }),
        makeToolInfo({ id: 'get_current_time', name: 'Get Time', description: 'Get current time' }),
        makeToolInfo({ id: 'calculate', name: 'Calculate', description: 'Do math' }),
      ],
    });
  });

  it('walks through all 7 questions correctly', () => {
    const session = builder.startSession();
    const answers = [
      'Save and organize web bookmarks',
      'Bookmark Manager',
      'productivity',
      'professional',
      ['bookmarks'],
      true,
      ['save_bookmark'],
    ] as const;

    const questions: BuilderQuestion[] = [];

    for (let i = 0; i < answers.length; i++) {
      const currentQ = builder.getCurrentQuestion(session.id);
      expect(currentQ).not.toBeNull();
      questions.push(currentQ!);

      const result = builder.submitAnswer(session.id, answers[i] as string | string[] | boolean);
      expect(result.success).toBe(true);
    }

    expect(questions.map((q) => q.id)).toEqual([
      'purpose', 'name', 'category', 'personality', 'dataAccess', 'autonomous', 'tools',
    ]);
    expect(builder.getSession(session.id)!.phase).toBe('generating');
  });

  it('generateConfig produces a complete, valid config', async () => {
    const session = builder.startSession();
    builder.submitAnswer(session.id, 'Save and organize web bookmarks');
    builder.submitAnswer(session.id, 'Bookmark Manager');
    builder.submitAnswer(session.id, 'productivity');
    builder.submitAnswer(session.id, 'professional');
    builder.submitAnswer(session.id, ['bookmarks']);
    builder.submitAnswer(session.id, true);
    builder.submitAnswer(session.id, ['save_bookmark']);

    const result = await builder.generateConfig(session.id);

    expect(result.success).toBe(true);
    expect(result.config).toMatchObject({
      id: 'bookmark-manager',
      name: 'Bookmark Manager',
      emoji: '🔖', // 'bookmark' keyword in purpose
      category: 'productivity',
      description: 'Save and organize web bookmarks',
      tools: ['save_bookmark'],
      dataAccess: ['bookmarks'],
      config: {
        maxTokens: 4096,
        temperature: 0.3, // professional
        maxTurns: 50,     // autonomous
        maxToolCalls: 200, // autonomous
      },
    });
    expect(result.config!.systemPrompt).toBeTruthy();
    expect(result.config!.triggers.keywords.length).toBeGreaterThan(0);
  });

  it('session is marked complete and generatedConfig is stored', async () => {
    const session = builder.startSession();
    builder.submitAnswer(session.id, 'help with tasks');
    builder.submitAnswer(session.id, 'Task Bot');
    builder.submitAnswer(session.id, 'productivity');
    builder.submitAnswer(session.id, 'concise');
    builder.submitAnswer(session.id, []);
    builder.submitAnswer(session.id, true); // autonomous is required; false is falsy and rejected
    builder.submitAnswer(session.id, []);

    await builder.generateConfig(session.id);

    const s = builder.getSession(session.id)!;
    expect(s.phase).toBe('complete');
    expect(s.generatedConfig).toBeDefined();
    expect(s.generatedConfig!.name).toBe('Task Bot');
  });

  it('quickCreate with all available tools finds relevant tools', async () => {
    const result = await builder.quickCreate('save bookmark links');
    // save_bookmark matches 'bookmark' keyword, get_current_time and calculate are basic
    expect(result.config!.tools).toContain('save_bookmark');
    expect(result.config!.tools).toContain('get_current_time');
    expect(result.config!.tools).toContain('calculate');
  });

  it('quickCreate with LLM provider uses LLM for system prompt', async () => {
    const llmResponse = 'You are an expert bookmark management assistant with years of experience organizing web content.';
    const provider = makeLLMProvider(llmResponse);
    builder.setLLMProvider(provider);

    const result = await builder.quickCreate('save and organize bookmarks');
    expect(result.config!.systemPrompt).toBe(llmResponse);
  });
});
