import { describe, it, expect } from 'vitest';
import {
  type AssistantConfig,
  type AssistantCapability,
  type UserContext,
  type ConversationContext,
  type AssistantRequest,
  type AssistantResponse,
  type IntentResult,
  type Intent,
} from './index.js';

// =============================================================================
// Type structure tests — verify exported types are usable
// =============================================================================

describe('assistant type exports', () => {
  it('AssistantConfig has required fields', () => {
    const config: AssistantConfig = {
      name: 'Test',
      systemPrompt: 'prompt',
      language: 'en',
      capabilities: ['chat'],
    };
    expect(config.name).toBe('Test');
    expect(config.systemPrompt).toBe('prompt');
    expect(config.language).toBe('en');
    expect(config.capabilities).toEqual(['chat']);
  });

  it('AssistantCapability accepts valid values', () => {
    const caps: AssistantCapability[] = [
      'chat',
      'code',
      'tools',
      'memory',
      'plugins',
      'scheduler',
      'multimodal',
      'web',
    ];
    expect(caps).toHaveLength(8);
  });

  it('UserContext has required fields', () => {
    const ctx: UserContext = {
      userId: 'u1',
      preferences: { language: 'en', timezone: 'UTC', currency: 'USD' },
      permissions: ['read'],
    };
    expect(ctx.userId).toBe('u1');
    expect(ctx.preferences.language).toBe('en');
    expect(ctx.permissions).toEqual(['read']);
  });

  it('ConversationContext has required fields', () => {
    const ctx: ConversationContext = {
      conversationId: 'c1',
      channel: 'web',
      messages: [],
    };
    expect(ctx.conversationId).toBe('c1');
    expect(ctx.channel).toBe('web');
    expect(ctx.messages).toEqual([]);
  });

  it('AssistantRequest has required fields', () => {
    const req: AssistantRequest = {
      message: 'hello',
      user: {
        userId: 'u1',
        preferences: { language: 'en', timezone: 'UTC', currency: 'USD' },
        permissions: [],
      },
      conversation: {
        conversationId: 'c1',
        channel: 'web',
        messages: [],
      },
    };
    expect(req.message).toBe('hello');
    expect(req.user.userId).toBe('u1');
    expect(req.conversation.conversationId).toBe('c1');
  });

  it('AssistantResponse has required fields', () => {
    const res: AssistantResponse = {
      message: 'hi there',
    };
    expect(res.message).toBe('hi there');
  });

  it('IntentResult has required fields', () => {
    const result: IntentResult = {
      intent: 'general_chat',
      confidence: 0.9,
      entities: {},
    };
    expect(result.intent).toBe('general_chat');
    expect(result.confidence).toBe(0.9);
    expect(result.entities).toEqual({});
  });

  it('Intent accepts valid values', () => {
    const intents: Intent[] = [
      'general_chat',
      'question',
      'task',
      'code_request',
      'tool_use',
      'schedule',
      'memory',
      'settings',
      'help',
      'unknown',
    ];
    expect(intents).toHaveLength(10);
  });
});

// =============================================================================
// Re-exports from skills.js and memory-oversight.js
// =============================================================================

describe('assistant module re-exports', () => {
  it('re-exports memory-oversight module', async () => {
    const mod = await import('./index.js');
    expect(mod.MEMORY_OVERSIGHT_TOOLS).toBeDefined();
    expect(mod.MemoryCleaner).toBeDefined();
  });
});
