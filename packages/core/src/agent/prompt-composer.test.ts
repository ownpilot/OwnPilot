/**
 * Tests for PromptComposer, getTimeContext, and helper formatting functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PromptComposer,
  getTimeContext,
  createPromptComposer,
  composeSystemPrompt,
} from './prompt-composer.js';
import type {
  PromptContext,
  AgentCapabilities,
  PromptConversationContext,
  TimeContext,
  WorkspaceContext,
} from './prompt-composer.js';
import type { UserProfile } from '../memory/conversation.js';
import type { ToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 'u1',
    name: 'Alice',
    facts: [],
    preferences: [],
    communicationStyle: undefined,
    interests: [],
    topicsOfInterest: [],
    goals: [],
    relationships: [],
    customInstructions: [],
    lastInteraction: new Date().toISOString(),
    totalConversations: 0,
    completeness: 0,
    ...overrides,
  };
}

function makeTool(name: string, category?: string): ToolDefinition {
  return {
    name,
    description: `Desc for ${name}`,
    parameters: { type: 'object' as const, properties: {} },
    category,
  };
}

function baseContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    basePrompt: 'You are a helpful assistant.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getTimeContext
// ---------------------------------------------------------------------------

describe('getTimeContext', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return morning for hour 5', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 5, 0, 0));
    const ctx = getTimeContext();
    expect(ctx.timeOfDay).toBe('morning');
  });

  it('should return morning for hour 11', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 11, 59, 59));
    const ctx = getTimeContext();
    expect(ctx.timeOfDay).toBe('morning');
  });

  it('should return afternoon for hour 12', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 12, 0, 0));
    const ctx = getTimeContext();
    expect(ctx.timeOfDay).toBe('afternoon');
  });

  it('should return afternoon for hour 16', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 16, 30, 0));
    const ctx = getTimeContext();
    expect(ctx.timeOfDay).toBe('afternoon');
  });

  it('should return evening for hour 17', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 17, 0, 0));
    const ctx = getTimeContext();
    expect(ctx.timeOfDay).toBe('evening');
  });

  it('should return evening for hour 20', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 20, 59, 59));
    const ctx = getTimeContext();
    expect(ctx.timeOfDay).toBe('evening');
  });

  it('should return night for hour 21', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 21, 0, 0));
    const ctx = getTimeContext();
    expect(ctx.timeOfDay).toBe('night');
  });

  it('should return night for hour 4', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 4, 30, 0));
    const ctx = getTimeContext();
    expect(ctx.timeOfDay).toBe('night');
  });

  it('should return night for hour 0 (midnight)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 1, 0, 0, 0));
    const ctx = getTimeContext();
    expect(ctx.timeOfDay).toBe('night');
  });

  it('should include currentTime as Date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 15, 10, 30, 0));
    const ctx = getTimeContext();
    expect(ctx.currentTime).toBeInstanceOf(Date);
  });

  it('should include dayOfWeek string', () => {
    vi.useFakeTimers();
    // Jan 6 2025 is a Monday
    vi.setSystemTime(new Date(2025, 0, 6, 10, 0, 0));
    const ctx = getTimeContext();
    expect(ctx.dayOfWeek).toBe('Monday');
  });

  it('should use provided timezone string', () => {
    const ctx = getTimeContext('America/New_York');
    expect(ctx.timezone).toBe('America/New_York');
  });

  it('should fall back to Intl timezone when no timezone given', () => {
    const ctx = getTimeContext();
    expect(typeof ctx.timezone).toBe('string');
    expect(ctx.timezone!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PromptComposer — constructor
// ---------------------------------------------------------------------------

describe('PromptComposer', () => {
  describe('constructor', () => {
    it('should create with default options', () => {
      const composer = new PromptComposer();
      // Verify it works by composing a minimal prompt
      const result = composer.compose(baseContext());
      expect(result).toContain('You are a helpful assistant.');
    });

    it('should accept custom maxPromptLength', () => {
      const composer = new PromptComposer({ maxPromptLength: 100 });
      const longBase = 'A'.repeat(200);
      const result = composer.compose(baseContext({ basePrompt: longBase }));
      // Should be truncated; at minimum the first section is kept
      expect(result.length).toBeLessThanOrEqual(200 + 10); // base section is always kept
    });

    it('should accept option overrides', () => {
      const composer = new PromptComposer({
        includeToolDescriptions: false,
        includeUserProfile: false,
        includeTimeContext: false,
        includeCapabilities: false,
      });
      // Even with tools / profile provided, sections are suppressed
      const result = composer.compose(
        baseContext({
          tools: [makeTool('test')],
          userProfile: makeProfile(),
          timeContext: getTimeContext(),
          capabilities: { codeExecution: true },
        })
      );
      expect(result).not.toContain('About the User');
      expect(result).not.toContain('Available Tools');
      expect(result).not.toContain('Your Capabilities');
      expect(result).not.toContain('Current Context');
    });
  });

  // -----------------------------------------------------------------------
  // compose — section composition
  // -----------------------------------------------------------------------

  describe('compose', () => {
    let composer: PromptComposer;

    beforeEach(() => {
      composer = new PromptComposer({ maxPromptLength: 50_000 });
    });

    it('should always include base prompt at the top', () => {
      const result = composer.compose(baseContext());
      expect(result.startsWith('You are a helpful assistant.')).toBe(true);
    });

    // --- User profile ---

    it('should include user profile section with name', () => {
      const result = composer.compose(baseContext({ userProfile: makeProfile({ name: 'Bob' }) }));
      expect(result).toContain('## About the User');
      expect(result).toContain('Name: Bob');
    });

    it('should include high-confidence facts', () => {
      const result = composer.compose(
        baseContext({
          userProfile: makeProfile({
            facts: [
              { key: 'Job', value: 'Engineer', confidence: 0.9 },
              { key: 'Pet', value: 'Cat', confidence: 0.5 }, // below 0.7 threshold
            ],
          }),
        })
      );
      expect(result).toContain('Job: Engineer');
      expect(result).not.toContain('Pet: Cat');
    });

    it('should include communication style preferences', () => {
      const result = composer.compose(
        baseContext({
          userProfile: makeProfile({
            communicationStyle: {
              formality: 'casual',
              verbosity: 'concise',
              language: 'English',
              timezone: 'UTC',
            },
          }),
        })
      );
      expect(result).toContain('Prefers casual communication');
      expect(result).toContain('Prefers concise responses');
      expect(result).toContain('Primary language: English');
      expect(result).toContain('Timezone: UTC');
    });

    it('should not include mixed formality/verbosity lines', () => {
      const result = composer.compose(
        baseContext({
          userProfile: makeProfile({
            communicationStyle: {
              formality: 'mixed',
              verbosity: 'mixed',
            },
          }),
        })
      );
      expect(result).not.toContain('Prefers mixed communication');
      expect(result).not.toContain('Prefers mixed responses');
    });

    it('should include interests', () => {
      const result = composer.compose(
        baseContext({
          userProfile: makeProfile({ interests: ['Rust', 'TypeScript', 'Go'] }),
        })
      );
      expect(result).toContain('Interests: Rust, TypeScript, Go');
    });

    it('should include goals', () => {
      const result = composer.compose(
        baseContext({
          userProfile: makeProfile({ goals: ['Learn Rust', 'Ship v2'] }),
        })
      );
      expect(result).toContain('Current goals: Learn Rust; Ship v2');
    });

    it('should skip user profile section when profile has no meaningful data', () => {
      const result = composer.compose(
        baseContext({
          userProfile: makeProfile({ name: undefined, facts: [], interests: [], goals: [] }),
        })
      );
      // No lines produced => section omitted
      expect(result).not.toContain('## About the User');
    });

    // --- Custom instructions ---

    it('should include custom instructions section', () => {
      const result = composer.compose(
        baseContext({ customInstructions: ['Always use metric units', 'Be brief'] })
      );
      expect(result).toContain('## Custom Instructions');
      expect(result).toContain('- Always use metric units');
      expect(result).toContain('- Be brief');
    });

    it('should skip custom instructions when list is empty', () => {
      const result = composer.compose(baseContext({ customInstructions: [] }));
      expect(result).not.toContain('## Custom Instructions');
    });

    // --- Tools ---

    it('should include tools section with compact category summary', () => {
      const tools = [
        makeTool('read_file', 'File'),
        makeTool('write_file', 'File'),
        makeTool('web_search', 'Web'),
      ];
      const result = composer.compose(baseContext({ tools }));
      expect(result).toContain('## Available Tools');
      expect(result).toContain('3 tools registered across 2 categories');
      expect(result).toContain('File (2)');
      expect(result).toContain('Web (1)');
    });

    it('should include tool count without verbose sections', () => {
      const result = composer.compose(baseContext({ tools: [makeTool('test_tool')] }));
      expect(result).toContain('## Available Tools');
      expect(result).toContain('1 tools registered across');
      // No strategy section or quick-reference — detailed capabilities are in BASE_SYSTEM_PROMPT
      expect(result).not.toContain('### How to Use Tools');
      expect(result).not.toContain('**Quick-reference:**');
    });

    it('should handle empty tools list (no section)', () => {
      const result = composer.compose(baseContext({ tools: [] }));
      expect(result).not.toContain('## Available Tools');
    });

    it('should use "General" category for tools without a category', () => {
      const result = composer.compose(baseContext({ tools: [makeTool('some_tool')] }));
      expect(result).toContain('General (1)');
    });

    it('should include automation section when automation tools present', () => {
      const tools = [makeTool('core.create_trigger', 'Automation')];
      const result = composer.compose(baseContext({ tools }));
      expect(result).toContain('## Automation');
      expect(result).toContain('triggers');
    });

    it('should detect automation tools by base name even with namespace prefix', () => {
      const tools = [makeTool('core.create_plan', 'Other')];
      const result = composer.compose(baseContext({ tools }));
      expect(result).toContain('## Automation');
    });

    it('should not include automation section when no automation tools', () => {
      const tools = [makeTool('read_file', 'File')];
      const result = composer.compose(baseContext({ tools }));
      expect(result).not.toContain('## Automation');
    });

    // --- Workspace ---

    it('should include workspace section with allowed dirs', () => {
      const ws: WorkspaceContext = {
        workspaceDir: '/home/user/workspace',
        homeDir: '/home/user',
        tempDir: '/tmp',
      };
      const result = composer.compose(baseContext({ workspaceContext: ws }));
      expect(result).toContain('## File System Access');
      expect(result).toContain('Workspace: `/home/user/workspace`');
      expect(result).toContain('Home: `/home/user`');
      expect(result).toContain('Temp: `/tmp`');
    });

    it('should handle workspace without optional dirs', () => {
      const ws: WorkspaceContext = { workspaceDir: '/work' };
      const result = composer.compose(baseContext({ workspaceContext: ws }));
      expect(result).toContain('Workspace: `/work`');
      expect(result).not.toContain('Home:');
    });

    // --- Capabilities ---

    it('should include capabilities section', () => {
      const caps: AgentCapabilities = {
        codeExecution: true,
        fileAccess: true,
        webBrowsing: false,
        memory: true,
      };
      const result = composer.compose(baseContext({ capabilities: caps }));
      expect(result).toContain('## Your Capabilities');
      expect(result).toContain('Execute code and scripts');
      expect(result).toContain('Read and write files');
      expect(result).toContain('Remember information');
      expect(result).not.toContain('Browse the web');
    });

    it('should include external services in capabilities', () => {
      const caps: AgentCapabilities = {
        externalServices: ['GitHub', 'Slack'],
      };
      const result = composer.compose(baseContext({ capabilities: caps }));
      expect(result).toContain('Access to external services: GitHub, Slack');
    });

    it('should skip autonomyLevel in capabilities output', () => {
      const caps: AgentCapabilities = { autonomyLevel: 'high' };
      const result = composer.compose(baseContext({ capabilities: caps }));
      expect(result).not.toContain('## Autonomy Guidelines');
    });

    // --- Time context ---

    it('should include time context section', () => {
      const tc: TimeContext = {
        currentTime: new Date(2025, 0, 6, 14, 30),
        timezone: 'America/Chicago',
        dayOfWeek: 'Monday',
        timeOfDay: 'afternoon',
      };
      const result = composer.compose(baseContext({ timeContext: tc }));
      expect(result).toContain('## Current Context');
      expect(result).toContain('Monday');
      expect(result).toContain('America/Chicago');
    });

    // --- Conversation context ---

    it('should include conversation context with message count', () => {
      const cc: PromptConversationContext = { messageCount: 5 };
      const result = composer.compose(baseContext({ conversationContext: cc }));
      expect(result).toContain('## Conversation Context');
      expect(result).toContain('Messages in this conversation: 5');
    });

    it('should include topics, currentTask, and previousSummary', () => {
      const cc: PromptConversationContext = {
        messageCount: 10,
        topics: ['TypeScript', 'Testing'],
        currentTask: 'Write unit tests',
        previousSummary: 'Discussed project setup',
      };
      const result = composer.compose(baseContext({ conversationContext: cc }));
      expect(result).toContain('Topics discussed: TypeScript, Testing');
      expect(result).toContain('Current task: Write unit tests');
      expect(result).toContain('Previous conversation summary: Discussed project setup');
    });

    it('should skip conversation context when messageCount is 0 and no other fields', () => {
      const cc: PromptConversationContext = { messageCount: 0 };
      const result = composer.compose(baseContext({ conversationContext: cc }));
      expect(result).not.toContain('## Conversation Context');
    });

    // --- Section dividers ---

    it('should separate sections with --- divider', () => {
      const result = composer.compose(baseContext({ customInstructions: ['Do stuff'] }));
      expect(result).toContain('\n\n---\n\n');
    });
  });

  // -----------------------------------------------------------------------
  // truncatePrompt
  // -----------------------------------------------------------------------

  describe('truncatePrompt', () => {
    it('should return prompt unchanged when under maxPromptLength', () => {
      const composer = new PromptComposer({ maxPromptLength: 50_000 });
      const result = composer.compose(baseContext());
      expect(result).toBe('You are a helpful assistant.');
    });

    it('should truncate by removing later sections to fit under maxPromptLength', () => {
      const composer = new PromptComposer({ maxPromptLength: 100 });
      const longInstruction = 'X'.repeat(200);
      const result = composer.compose(
        baseContext({
          customInstructions: [longInstruction],
          conversationContext: { messageCount: 1 },
        })
      );
      // Base prompt (28 chars) is always kept; long section exceeds budget
      expect(result.length).toBeLessThanOrEqual(300);
      expect(result).toContain('You are a helpful assistant.');
    });

    it('should always keep the base prompt (first section)', () => {
      const composer = new PromptComposer({ maxPromptLength: 30 });
      const result = composer.compose(
        baseContext({
          customInstructions: ['Some extra data'],
        })
      );
      // Even with a very small limit the base prompt is always present
      expect(result).toContain('You are a helpful assistant.');
    });
  });

  // -----------------------------------------------------------------------
  // Factory functions
  // -----------------------------------------------------------------------

  describe('createPromptComposer', () => {
    it('should return a PromptComposer instance', () => {
      const composer = createPromptComposer();
      expect(composer).toBeInstanceOf(PromptComposer);
    });

    it('should pass options through', () => {
      const composer = createPromptComposer({ includeTimeContext: false });
      const tc: TimeContext = {
        currentTime: new Date(),
        dayOfWeek: 'Monday',
        timeOfDay: 'morning',
      };
      const result = composer.compose(baseContext({ timeContext: tc }));
      expect(result).not.toContain('## Current Context');
    });
  });

  describe('composeSystemPrompt', () => {
    it('should compose with default settings', () => {
      const result = composeSystemPrompt(baseContext());
      expect(result).toContain('You are a helpful assistant.');
    });

    it('should include all sections when context is fully populated', () => {
      const result = composeSystemPrompt({
        basePrompt: 'Base prompt.',
        userProfile: makeProfile({ name: 'Eve', interests: ['AI'] }),
        tools: [makeTool('search', 'Search')],
        customInstructions: ['Be concise'],
        capabilities: { memory: true, autonomyLevel: 'medium' },
        conversationContext: { messageCount: 3, topics: ['Testing'] },
      });
      expect(result).toContain('Base prompt.');
      expect(result).toContain('## About the User');
      expect(result).toContain('## Custom Instructions');
      expect(result).toContain('## Available Tools');
      expect(result).toContain('## Your Capabilities');
      expect(result).toContain('## Conversation Context');
    });
  });
});
