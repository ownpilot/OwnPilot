/**
 * Tests for MemoryInjector, getMemoryInjector, injectMemoryIntoPrompt,
 * and createEnhancedAgentPrompt.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { mockMemoryStore } = vi.hoisted(() => {
  const mockMemoryStore = {
    getProfile: vi.fn().mockResolvedValue({
      userId: 'user-1',
      identity: { name: 'Alice', nickname: 'Al', age: 30, nationality: 'American' },
      location: {
        home: { city: 'NYC', country: 'USA', timezone: 'America/New_York' },
        current: '',
      },
      work: { occupation: 'Engineer', company: 'Acme', skills: ['TypeScript'] },
      lifestyle: { hobbies: ['reading'] },
      communication: {
        preferredStyle: 'casual',
        verbosity: 'concise',
        primaryLanguage: 'English',
      },
      goals: { shortTerm: ['learn Rust'], mediumTerm: ['promotion'] },
      social: { family: [{ name: 'Bob', relation: 'brother' }] },
      aiPreferences: { autonomyLevel: 'high', customInstructions: ['Use TypeScript'] },
      meta: { completeness: 80, lastUpdated: '2024-01-01' },
    }),
    search: vi.fn().mockResolvedValue([]),
  };
  return { mockMemoryStore };
});

vi.mock('../memory/personal.js', () => ({
  getPersonalMemoryStore: vi.fn().mockResolvedValue(mockMemoryStore),
}));

vi.mock('./prompt-composer.js', () => ({
  PromptComposer: vi.fn().mockImplementation(() => ({
    compose: vi.fn().mockReturnValue('composed-system-prompt'),
  })),
  getTimeContext: vi.fn().mockReturnValue({
    timezone: 'UTC',
    datetime: '2024-01-01T12:00:00Z',
  }),
}));

// Import after mocks are declared
import {
  MemoryInjector,
  getMemoryInjector,
  injectMemoryIntoPrompt,
  createEnhancedAgentPrompt,
} from './memory-injector.js';
import type { MemoryInjectionOptions as _MemoryInjectionOptions, InjectedPromptResult as _InjectedPromptResult } from './memory-injector.js';
import { getPersonalMemoryStore } from '../memory/personal.js';
import { PromptComposer, getTimeContext } from './prompt-composer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(name: string, category?: string): ToolDefinition {
  return {
    name,
    description: `Desc for ${name}`,
    parameters: { type: 'object' as const, properties: {} },
    category,
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('MemoryInjector', () => {
  let injector: MemoryInjector;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the singleton so each test starts fresh
    // (getMemoryInjector caches globally, but we create a new instance here)
    injector = new MemoryInjector();
  });

  // =========================================================================
  // Constructor
  // =========================================================================

  describe('constructor', () => {
    it('should create a PromptComposer instance', () => {
      new MemoryInjector();
      expect(PromptComposer).toHaveBeenCalled();
    });

    it('should create a new PromptComposer for each MemoryInjector', () => {
      const callsBefore = vi.mocked(PromptComposer).mock.calls.length;
      new MemoryInjector();
      expect(vi.mocked(PromptComposer).mock.calls.length).toBe(callsBefore + 1);
    });
  });

  // =========================================================================
  // injectMemory
  // =========================================================================

  describe('injectMemory', () => {
    it('should return composed system prompt from PromptComposer', async () => {
      const result = await injector.injectMemory('base prompt');
      expect(result.systemPrompt).toBe('composed-system-prompt');
    });

    it('should return correct promptLength', async () => {
      const result = await injector.injectMemory('base prompt');
      expect(result.promptLength).toBe('composed-system-prompt'.length);
    });

    it('should set hasTimeContext to true by default', async () => {
      const result = await injector.injectMemory('base prompt');
      expect(result.hasTimeContext).toBe(true);
    });

    it('should call getTimeContext when includeTimeContext is not false', async () => {
      await injector.injectMemory('base prompt');
      expect(getTimeContext).toHaveBeenCalled();
    });

    it('should not call getTimeContext when includeTimeContext is false', async () => {
      await injector.injectMemory('base prompt', { includeTimeContext: false });
      expect(getTimeContext).not.toHaveBeenCalled();
    });

    it('should set hasTimeContext to false when includeTimeContext is false', async () => {
      const result = await injector.injectMemory('base prompt', {
        includeTimeContext: false,
      });
      expect(result.hasTimeContext).toBe(false);
    });

    it('should return toolCount as 0 when no tools provided', async () => {
      const result = await injector.injectMemory('base prompt');
      expect(result.toolCount).toBe(0);
    });

    it('should return correct toolCount when tools are provided', async () => {
      const tools = [makeTool('a'), makeTool('b'), makeTool('c')];
      const result = await injector.injectMemory('base prompt', { tools });
      expect(result.toolCount).toBe(3);
    });

    it('should return instructionCount 0 when no userId provided', async () => {
      const result = await injector.injectMemory('base prompt');
      expect(result.instructionCount).toBe(0);
    });

    it('should not have userProfile when no userId provided', async () => {
      const result = await injector.injectMemory('base prompt');
      expect(result.userProfile).toBeUndefined();
    });

    it('should not call getPersonalMemoryStore when no userId provided', async () => {
      await injector.injectMemory('base prompt');
      expect(getPersonalMemoryStore).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // With userId
    // -----------------------------------------------------------------------

    it('should load user profile when userId is provided', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile).toBeDefined();
      expect(result.userProfile!.userId).toBe('user-1');
    });

    it('should call getPersonalMemoryStore with the userId', async () => {
      await injector.injectMemory('base prompt', { userId: 'user-1' });
      expect(getPersonalMemoryStore).toHaveBeenCalledWith('user-1');
    });

    it('should include custom instructions count when profile has them', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      // The mock profile has customInstructions: ['Use TypeScript']
      expect(result.instructionCount).toBe(1);
    });

    it('should convert comprehensive profile to UserProfile with correct name', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.name).toBe('Alice');
    });

    it('should convert comprehensive profile facts correctly', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      const facts = result.userProfile!.facts;
      const nameF = facts.find((f) => f.key === 'name');
      expect(nameF).toEqual({ key: 'name', value: 'Alice', confidence: 1.0 });

      const nickF = facts.find((f) => f.key === 'nickname');
      expect(nickF).toEqual({ key: 'nickname', value: 'Al', confidence: 1.0 });

      const ageF = facts.find((f) => f.key === 'age');
      expect(ageF).toEqual({ key: 'age', value: '30', confidence: 0.9 });

      const natF = facts.find((f) => f.key === 'nationality');
      expect(natF).toEqual({ key: 'nationality', value: 'American', confidence: 0.9 });
    });

    it('should convert location facts correctly', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      const facts = result.userProfile!.facts;
      expect(facts.find((f) => f.key === 'city')).toEqual({
        key: 'city',
        value: 'NYC',
        confidence: 0.9,
      });
      expect(facts.find((f) => f.key === 'country')).toEqual({
        key: 'country',
        value: 'USA',
        confidence: 0.9,
      });
    });

    it('should convert work facts correctly', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      const facts = result.userProfile!.facts;
      expect(facts.find((f) => f.key === 'occupation')).toEqual({
        key: 'occupation',
        value: 'Engineer',
        confidence: 0.9,
      });
      expect(facts.find((f) => f.key === 'company')).toEqual({
        key: 'company',
        value: 'Acme',
        confidence: 0.9,
      });
    });

    it('should set communicationStyle from profile', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.communicationStyle).toEqual({
        formality: 'casual',
        verbosity: 'concise',
        language: 'English',
        timezone: 'America/New_York',
      });
    });

    it('should combine hobbies and skills into interests', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.interests).toEqual(['reading', 'TypeScript']);
    });

    it('should set topicsOfInterest equal to interests', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.topicsOfInterest).toEqual(
        result.userProfile!.interests,
      );
    });

    it('should combine shortTerm and mediumTerm into goals', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.goals).toEqual(['learn Rust', 'promotion']);
    });

    it('should map family relationships', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.relationships).toEqual(['Bob (brother)']);
    });

    it('should set customInstructions from aiPreferences', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.customInstructions).toEqual(['Use TypeScript']);
    });

    it('should set preferences from customInstructions', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.preferences).toEqual(['Use TypeScript']);
    });

    it('should set lastInteraction from meta.lastUpdated', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.lastInteraction).toBe('2024-01-01');
    });

    it('should set totalConversations to 0', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.totalConversations).toBe(0);
    });

    it('should set completeness from meta', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
      });
      expect(result.userProfile!.completeness).toBe(80);
    });

    // -----------------------------------------------------------------------
    // includeProfile=false
    // -----------------------------------------------------------------------

    it('should skip profile loading when includeProfile is false', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
        includeProfile: false,
      });
      expect(result.userProfile).toBeUndefined();
      expect(getPersonalMemoryStore).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // includeInstructions=false
    // -----------------------------------------------------------------------

    it('should skip custom instructions when includeInstructions is false', async () => {
      const result = await injector.injectMemory('base prompt', {
        userId: 'user-1',
        includeInstructions: false,
      });
      // Profile is still loaded, but instructions are not included
      expect(result.userProfile).toBeDefined();
      expect(result.instructionCount).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Capabilities + autonomyLevel override
    // -----------------------------------------------------------------------

    it('should update capabilities autonomyLevel from profile', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.injectMemory('base prompt', {
        userId: 'user-1',
        capabilities: { memory: true },
      });

      // The compose function should have been called with updated capabilities
      expect(composeFn).toHaveBeenCalled();
      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.capabilities.autonomyLevel).toBe('high');
      expect(passedContext.capabilities.memory).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Error handling in getCachedProfile
    // -----------------------------------------------------------------------

    it('should return no profile when getPersonalMemoryStore rejects', async () => {
      vi.mocked(getPersonalMemoryStore).mockRejectedValueOnce(
        new Error('DB failure'),
      );

      const result = await injector.injectMemory('base prompt', {
        userId: 'user-error',
      });
      expect(result.userProfile).toBeUndefined();
      expect(result.instructionCount).toBe(0);
    });

    it('should return no profile when getProfile rejects', async () => {
      vi.mocked(getPersonalMemoryStore).mockResolvedValueOnce({
        ...mockMemoryStore,
        getProfile: vi.fn().mockRejectedValueOnce(new Error('corrupt')),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await injector.injectMemory('base prompt', {
        userId: 'user-corrupt',
      });
      expect(result.userProfile).toBeUndefined();
    });
  });

  // =========================================================================
  // Profile caching
  // =========================================================================

  describe('profile caching', () => {
    it('should cache profile on first call', async () => {
      await injector.injectMemory('base', { userId: 'user-1' });
      expect(getPersonalMemoryStore).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await injector.injectMemory('base', { userId: 'user-1' });
      expect(getPersonalMemoryStore).toHaveBeenCalledTimes(1);
    });

    it('should use cache within TTL (no extra DB calls)', async () => {
      await injector.injectMemory('base', { userId: 'user-1' });
      await injector.injectMemory('base', { userId: 'user-1' });
      await injector.injectMemory('base', { userId: 'user-1' });
      expect(getPersonalMemoryStore).toHaveBeenCalledTimes(1);
    });

    it('should reload after invalidateCache', async () => {
      await injector.injectMemory('base', { userId: 'user-1' });
      expect(getPersonalMemoryStore).toHaveBeenCalledTimes(1);

      injector.invalidateCache('user-1');

      await injector.injectMemory('base', { userId: 'user-1' });
      expect(getPersonalMemoryStore).toHaveBeenCalledTimes(2);
    });

    it('invalidateCache should be safe for non-existent user', () => {
      // Should not throw
      expect(() => injector.invalidateCache('no-such-user')).not.toThrow();
    });

    it('should reload profile after TTL expires', async () => {
      const realDateNow = Date.now;
      let nowValue = 1_000_000;
      Date.now = vi.fn(() => nowValue);

      try {
        await injector.injectMemory('base', { userId: 'user-1' });
        expect(getPersonalMemoryStore).toHaveBeenCalledTimes(1);

        // Advance time past the 5-minute TTL
        nowValue += 5 * 60 * 1000 + 1;

        await injector.injectMemory('base', { userId: 'user-1' });
        expect(getPersonalMemoryStore).toHaveBeenCalledTimes(2);
      } finally {
        Date.now = realDateNow;
      }
    });

    it('should evict oldest entry when cache exceeds 20 entries', async () => {
      // Fill the cache with 20 users
      for (let i = 0; i < 21; i++) {
        await injector.injectMemory('base', { userId: `user-${i}` });
      }

      // The 21st insertion should trigger eviction of the first entry (user-0)
      // Verify by checking that loading user-0 again calls getPersonalMemoryStore
      vi.mocked(getPersonalMemoryStore).mockClear();
      await injector.injectMemory('base', { userId: 'user-0' });
      expect(getPersonalMemoryStore).toHaveBeenCalledWith('user-0');
    });

    it('should keep recently added entries when evicting', async () => {
      // Fill with 21 users (0..20), user-0 is evicted
      for (let i = 0; i < 21; i++) {
        await injector.injectMemory('base', { userId: `user-${i}` });
      }

      // user-20 (most recently added) should still be cached
      vi.mocked(getPersonalMemoryStore).mockClear();
      await injector.injectMemory('base', { userId: 'user-20' });
      expect(getPersonalMemoryStore).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // createAgentPrompt
  // =========================================================================

  describe('createAgentPrompt', () => {
    it('should return the composed system prompt string', async () => {
      const result = await injector.createAgentPrompt('TestAgent', 'A test agent');
      expect(result).toBe('composed-system-prompt');
    });

    it('should pass a base prompt containing the agent name as a heading', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.createAgentPrompt('MyBot', 'Helpful bot');

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.basePrompt).toContain('# MyBot');
    });

    it('should include the agent description in the base prompt', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.createAgentPrompt('MyBot', 'Helpful bot for coding');

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.basePrompt).toContain('Helpful bot for coding');
    });

    it('should include Core Behavior section', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.createAgentPrompt('MyBot', 'A bot');

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.basePrompt).toContain('## Core Behavior');
      expect(passedContext.basePrompt).toContain('Be Proactive');
    });

    it('should include personality section when provided', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.createAgentPrompt('MyBot', 'A bot', {
        personality: 'Friendly and enthusiastic',
      });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.basePrompt).toContain('## Personality');
      expect(passedContext.basePrompt).toContain('Friendly and enthusiastic');
    });

    it('should not include personality section when not provided', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.createAgentPrompt('MyBot', 'A bot');

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.basePrompt).not.toContain('## Personality');
    });

    it('should include special instructions section when provided', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.createAgentPrompt('MyBot', 'A bot', {
        specialInstructions: ['Always be polite', 'Use markdown'],
      });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.basePrompt).toContain('## Special Instructions');
      expect(passedContext.basePrompt).toContain('- Always be polite');
      expect(passedContext.basePrompt).toContain('- Use markdown');
    });

    it('should not include special instructions section when array is empty', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.createAgentPrompt('MyBot', 'A bot', {
        specialInstructions: [],
      });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.basePrompt).not.toContain('## Special Instructions');
    });

    it('should forward userId to injectMemory', async () => {
      await injector.createAgentPrompt('MyBot', 'A bot', {
        userId: 'user-1',
      });
      expect(getPersonalMemoryStore).toHaveBeenCalledWith('user-1');
    });

    it('should forward tools to injectMemory', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;
      const tools = [makeTool('tool_a')];

      await injector.createAgentPrompt('MyBot', 'A bot', { tools });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.tools).toBe(tools);
    });
  });

  // =========================================================================
  // getRelevantContext
  // =========================================================================

  describe('getRelevantContext', () => {
    it('should return null when search returns empty results', async () => {
      mockMemoryStore.search.mockResolvedValueOnce([]);
      const result = await injector.getRelevantContext('user-1', 'something');
      expect(result).toBeNull();
    });

    it('should return formatted context string when results exist', async () => {
      mockMemoryStore.search.mockResolvedValueOnce([
        { key: 'favorite_food', value: 'pizza' },
        { key: 'hobby', value: 'reading' },
      ]);

      const result = await injector.getRelevantContext('user-1', 'interests');

      expect(result).toContain('Relevant information from memory:');
      expect(result).toContain('- favorite_food: pizza');
      expect(result).toContain('- hobby: reading');
    });

    it('should limit results to 5 entries', async () => {
      const manyResults = Array.from({ length: 10 }, (_, i) => ({
        key: `key-${i}`,
        value: `value-${i}`,
      }));
      mockMemoryStore.search.mockResolvedValueOnce(manyResults);

      const result = await injector.getRelevantContext('user-1', 'query');

      // Should only contain the first 5 items
      expect(result).toContain('- key-0: value-0');
      expect(result).toContain('- key-4: value-4');
      expect(result).not.toContain('- key-5: value-5');
    });

    it('should call getPersonalMemoryStore with the userId', async () => {
      vi.mocked(getPersonalMemoryStore).mockClear();
      await injector.getRelevantContext('user-42', 'query');
      expect(getPersonalMemoryStore).toHaveBeenCalledWith('user-42');
    });

    it('should call search with the query', async () => {
      await injector.getRelevantContext('user-1', 'TypeScript tips');
      expect(mockMemoryStore.search).toHaveBeenCalledWith('TypeScript tips');
    });

    it('should return null on error', async () => {
      vi.mocked(getPersonalMemoryStore).mockRejectedValueOnce(
        new Error('store error'),
      );

      const result = await injector.getRelevantContext('user-1', 'query');
      expect(result).toBeNull();
    });

    it('should return null when search throws', async () => {
      mockMemoryStore.search.mockRejectedValueOnce(new Error('search failed'));

      const result = await injector.getRelevantContext('user-1', 'query');
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // PromptContext construction
  // =========================================================================

  describe('PromptContext construction', () => {
    it('should pass basePrompt to composer', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.injectMemory('my base prompt');

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.basePrompt).toBe('my base prompt');
    });

    it('should pass tools to composer', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;
      const tools = [makeTool('search'), makeTool('fetch')];

      await injector.injectMemory('base', { tools });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.tools).toBe(tools);
    });

    it('should pass capabilities to composer', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;
      const capabilities = { memory: true, codeExecution: true };

      await injector.injectMemory('base', { capabilities });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.capabilities).toEqual(capabilities);
    });

    it('should pass conversationContext to composer', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;
      const conversationContext = { messageCount: 10, topics: ['coding'] };

      await injector.injectMemory('base', { conversationContext });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.conversationContext).toBe(conversationContext);
    });

    it('should pass workspaceContext to composer', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;
      const workspaceContext = { workspaceDir: '/home/user/workspace' };

      await injector.injectMemory('base', { workspaceContext });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.workspaceContext).toBe(workspaceContext);
    });

    it('should pass timeContext from getTimeContext to composer', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.injectMemory('base');

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.timeContext).toEqual({
        timezone: 'UTC',
        datetime: '2024-01-01T12:00:00Z',
      });
    });

    it('should not set timeContext when includeTimeContext is false', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.injectMemory('base', { includeTimeContext: false });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.timeContext).toBeUndefined();
    });

    it('should pass userProfile to composer context when loaded', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.injectMemory('base', { userId: 'user-1' });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.userProfile).toBeDefined();
      expect(passedContext.userProfile.userId).toBe('user-1');
    });

    it('should pass customInstructions to composer context when loaded', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.injectMemory('base', { userId: 'user-1' });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.customInstructions).toEqual(['Use TypeScript']);
    });

    it('should not pass customInstructions when includeInstructions is false', async () => {
      const composeFn = vi.mocked(PromptComposer).mock.results[0]?.value?.compose;

      await injector.injectMemory('base', {
        userId: 'user-1',
        includeInstructions: false,
      });

      const passedContext = composeFn.mock.calls[0][0];
      expect(passedContext.customInstructions).toBeUndefined();
    });
  });

  // =========================================================================
  // comprehensiveToUserProfile edge cases
  // =========================================================================

  describe('comprehensiveToUserProfile edge cases (via injectMemory)', () => {
    it('should handle profile with missing optional identity fields', async () => {
      vi.mocked(getPersonalMemoryStore).mockResolvedValueOnce({
        getProfile: vi.fn().mockResolvedValue({
          userId: 'user-sparse',
          identity: { name: 'Sparse' },
          location: {},
          work: {},
          lifestyle: {},
          communication: {},
          goals: {},
          social: {},
          aiPreferences: {},
          meta: { completeness: 10, lastUpdated: '2024-06-01' },
        }),
        search: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await injector.injectMemory('base', {
        userId: 'user-sparse',
      });

      expect(result.userProfile).toBeDefined();
      expect(result.userProfile!.name).toBe('Sparse');
      // Only the name fact should be present
      expect(result.userProfile!.facts).toEqual([
        { key: 'name', value: 'Sparse', confidence: 1.0 },
      ]);
      expect(result.userProfile!.interests).toEqual([]);
      expect(result.userProfile!.goals).toEqual([]);
      expect(result.userProfile!.relationships).toEqual([]);
      expect(result.userProfile!.customInstructions).toEqual([]);
    });

    it('should handle profile with empty social.family (undefined)', async () => {
      vi.mocked(getPersonalMemoryStore).mockResolvedValueOnce({
        getProfile: vi.fn().mockResolvedValue({
          userId: 'user-nofam',
          identity: {},
          location: {},
          work: {},
          lifestyle: {},
          communication: {},
          goals: {},
          social: {},
          aiPreferences: {},
          meta: { completeness: 0, lastUpdated: '2024-06-01' },
        }),
        search: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await injector.injectMemory('base', {
        userId: 'user-nofam',
      });

      expect(result.userProfile!.relationships).toEqual([]);
    });

    it('should handle profile with no customInstructions in aiPreferences', async () => {
      vi.mocked(getPersonalMemoryStore).mockResolvedValueOnce({
        getProfile: vi.fn().mockResolvedValue({
          userId: 'user-noinstr',
          identity: {},
          location: {},
          work: {},
          lifestyle: {},
          communication: {},
          goals: {},
          social: {},
          aiPreferences: {},
          meta: { completeness: 0, lastUpdated: '2024-06-01' },
        }),
        search: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await injector.injectMemory('base', {
        userId: 'user-noinstr',
      });

      expect(result.instructionCount).toBe(0);
      expect(result.userProfile!.customInstructions).toEqual([]);
      expect(result.userProfile!.preferences).toEqual([]);
    });

    it('should handle communicationStyle defaults when not set', async () => {
      vi.mocked(getPersonalMemoryStore).mockResolvedValueOnce({
        getProfile: vi.fn().mockResolvedValue({
          userId: 'user-nocomm',
          identity: {},
          location: {},
          work: {},
          lifestyle: {},
          communication: {},
          goals: {},
          social: {},
          aiPreferences: {},
          meta: { completeness: 0, lastUpdated: '2024-06-01' },
        }),
        search: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await injector.injectMemory('base', {
        userId: 'user-nocomm',
      });

      expect(result.userProfile!.communicationStyle).toEqual({
        formality: 'mixed',
        verbosity: 'mixed',
        language: undefined,
        timezone: undefined,
      });
    });
  });
});

// ===========================================================================
// Factory functions
// ===========================================================================

describe('getMemoryInjector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module-level singleton by re-importing would be complex.
    // Instead we test the singleton behavior directly.
  });

  it('should return a MemoryInjector instance', () => {
    const injector = getMemoryInjector();
    expect(injector).toBeInstanceOf(MemoryInjector);
  });

  it('should return the same instance on subsequent calls (singleton)', () => {
    const a = getMemoryInjector();
    const b = getMemoryInjector();
    expect(a).toBe(b);
  });
});

describe('injectMemoryIntoPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return an InjectedPromptResult', async () => {
    const result = await injectMemoryIntoPrompt('test prompt');
    expect(result).toHaveProperty('systemPrompt');
    expect(result).toHaveProperty('toolCount');
    expect(result).toHaveProperty('instructionCount');
    expect(result).toHaveProperty('hasTimeContext');
    expect(result).toHaveProperty('promptLength');
  });

  it('should use the global singleton injector', async () => {
    const result = await injectMemoryIntoPrompt('prompt');
    expect(result.systemPrompt).toBe('composed-system-prompt');
  });

  it('should forward options to injectMemory', async () => {
    const tools = [makeTool('t1')];
    const result = await injectMemoryIntoPrompt('prompt', { tools });
    expect(result.toolCount).toBe(1);
  });
});

describe('createEnhancedAgentPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a string (the composed prompt)', async () => {
    const result = await createEnhancedAgentPrompt('Agent', 'Desc');
    expect(typeof result).toBe('string');
  });

  it('should return the composed system prompt', async () => {
    const result = await createEnhancedAgentPrompt('Agent', 'Desc');
    expect(result).toBe('composed-system-prompt');
  });

  it('should forward personality and specialInstructions', async () => {
    // This should not throw and should return the composed prompt
    const result = await createEnhancedAgentPrompt('Agent', 'Desc', {
      personality: 'Bold',
      specialInstructions: ['Be direct'],
    });
    expect(result).toBe('composed-system-prompt');
  });

  it('should forward userId option', async () => {
    vi.mocked(getPersonalMemoryStore).mockClear();
    await createEnhancedAgentPrompt('Agent', 'Desc', { userId: 'user-1' });
    expect(getPersonalMemoryStore).toHaveBeenCalledWith('user-1');
  });
});
