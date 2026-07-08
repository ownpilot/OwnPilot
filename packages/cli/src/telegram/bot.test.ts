import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record the order in which grammy handlers are registered so we can assert
// commands are wired before the catch-all message:text handler. grammy runs
// middleware in registration order and these single-arg handlers don't call
// next(), so a message:text handler registered first would swallow "/start"
// etc. (commands are text messages) and the command handlers would never fire.

const { registrationOrder, mockBot } = vi.hoisted(() => {
  const registrationOrder: string[] = [];
  const mockBot: Record<string, unknown> = {
    command: (name: string) => {
      registrationOrder.push(`command:${name}`);
      return mockBot;
    },
    on: (event: string) => {
      registrationOrder.push(`on:${event}`);
      return mockBot;
    },
    catch: () => {
      registrationOrder.push('catch');
      return mockBot;
    },
  };
  return { registrationOrder, mockBot };
});

vi.mock('grammy', () => ({
  // `new Bot(token)` must return our recorder. A constructor returning an
  // object makes `new` yield that object.
  Bot: class {
    constructor() {
      return mockBot as never;
    }
  },
  webhookCallback: vi.fn(() => vi.fn()),
}));

vi.mock('@ownpilot/core/services', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { TelegramBot } = await import('./bot.js');

describe('TelegramBot handler registration order', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('registers /start, /help, /reset before the catch-all message:text handler', () => {
    new TelegramBot({ botToken: 'test-token', enabled: true });

    const msgIdx = registrationOrder.indexOf('on:message:text');
    expect(msgIdx).toBeGreaterThanOrEqual(0);

    for (const cmd of ['command:start', 'command:help', 'command:reset']) {
      const idx = registrationOrder.indexOf(cmd);
      expect(idx).toBeGreaterThanOrEqual(0);
      // Each command must be registered BEFORE the message:text catch-all,
      // otherwise grammy never dispatches it.
      expect(idx).toBeLessThan(msgIdx);
    }
  });
});

// ── isReady ────────────────────────────────────────────────────────────

describe('TelegramBot.isReady', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('returns false when botToken is empty', () => {
    const bot = new TelegramBot({ botToken: '', enabled: true });
    expect(bot.isReady()).toBe(false);
  });

  it('returns false when enabled is false', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: false });
    expect(bot.isReady()).toBe(false);
  });

  it('returns true when both botToken and enabled are set', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    expect(bot.isReady()).toBe(true);
  });
});

// ── isUserAllowed (private, tested through behavior) ───────────────────

describe('TelegramBot configuration', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('sets default maxMessageLength when not provided', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    const config = (bot as unknown as { config: { maxMessageLength: number } }).config;
    expect(config.maxMessageLength).toBe(4096);
  });

  it('uses custom maxMessageLength when provided', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true, maxMessageLength: 2000 });
    const config = (bot as unknown as { config: { maxMessageLength: number } }).config;
    expect(config.maxMessageLength).toBe(2000);
  });

  it('defaults parseMode to undefined (plain text)', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    const config = (bot as unknown as { config: { parseMode: string | undefined } }).config;
    expect(config.parseMode).toBeUndefined();
  });
});

// ── onMessage ──────────────────────────────────────────────────────────

describe('TelegramBot.onMessage', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('sets message handler callback', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    const handler = vi.fn();
    bot.onMessage(handler);
    const internal = (bot as unknown as { messageHandler: typeof handler }).messageHandler;
    expect(internal).toBe(handler);
  });
});

// ── getWebhookCallback ─────────────────────────────────────────────────

describe('TelegramBot.getWebhookCallback', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('returns a function', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    const callback = bot.getWebhookCallback();
    // webhookCallback mock returns a vi.fn() which is a function
    expect(typeof callback).toBe('function');
  });
});

// ── createTelegramBot ──────────────────────────────────────────────────

describe('createTelegramBot', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('returns a TelegramBot instance', async () => {
    const { createTelegramBot } = await import('./bot.js');
    const bot = createTelegramBot({ botToken: 'token', enabled: true });
    expect(bot.type).toBe('telegram');
  });
});

// ── splitMessage behavior ──────────────────────────────────────────────

describe('TelegramBot splitMessage', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('splits long messages at natural boundaries', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    // Access private method via bracket notation
    const split = (bot as unknown as { splitMessage(text: string, maxLength: number): string[] })
      .splitMessage;
    const text = 'A'.repeat(5000);
    const parts = split(text, 4096);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]!.length).toBeLessThanOrEqual(4096);
  });

  it('returns single part for short messages', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    const split = (bot as unknown as { splitMessage(text: string, maxLength: number): string[] })
      .splitMessage;
    const parts = split('Hello', 4096);
    expect(parts).toEqual(['Hello']);
  });

  it('handles non-finite maxLength by defaulting to 4096', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    const split = (bot as unknown as { splitMessage(text: string, maxLength: number): string[] })
      .splitMessage;
    const text = 'A'.repeat(5000);
    const parts = split(text, NaN);
    expect(parts.length).toBeGreaterThan(0);
  });

  it('splits at newline boundary when available', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    const split = (bot as unknown as { splitMessage(text: string, maxLength: number): string[] })
      .splitMessage;
    // Create text with a newline right at a good split point
    const text = 'A'.repeat(3000) + '\n' + 'B'.repeat(3000);
    const parts = split(text, 3500);
    // Should split at the newline (approximately)
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].length).toBeLessThanOrEqual(3500);
  });
});

// ── Webhook ────────────────────────────────────────────────────────────

describe('TelegramBot webhook', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('setWebhook and deleteWebhook are exposed', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    expect(typeof bot.setWebhook).toBe('function');
    expect(typeof bot.deleteWebhook).toBe('function');
  });
});

// ── isUserAllowed ──────────────────────────────────────────────────────

describe('TelegramBot isUserAllowed', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('allows user when no allowedUserIds configured', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    const botAny = bot as unknown as {
      isUserAllowed(ctx: { from?: { id: number }; chat?: { id: number } }): boolean;
    };
    expect(botAny.isUserAllowed({ from: { id: 123 }, chat: { id: 456 } })).toBe(true);
  });

  it('blocks user when allowedUserIds is set and user not in list', () => {
    const bot = new TelegramBot({
      botToken: 'token',
      enabled: true,
      allowedUserIds: [789],
    });
    const botAny = bot as unknown as {
      isUserAllowed(ctx: { from?: { id: number }; chat?: { id: number } }): boolean;
    };
    expect(botAny.isUserAllowed({ from: { id: 123 }, chat: { id: 456 } })).toBe(false);
  });

  it('allows user when userId is in allowedUserIds', () => {
    const bot = new TelegramBot({
      botToken: 'token',
      enabled: true,
      allowedUserIds: [123],
    });
    const botAny = bot as unknown as {
      isUserAllowed(ctx: { from?: { id: number }; chat?: { id: number } }): boolean;
    };
    expect(botAny.isUserAllowed({ from: { id: 123 }, chat: { id: 456 } })).toBe(true);
  });

  it('blocks chat when allowedChatIds is set and chat not in list', () => {
    const bot = new TelegramBot({
      botToken: 'token',
      enabled: true,
      allowedChatIds: [789],
    });
    const botAny = bot as unknown as {
      isUserAllowed(ctx: { from?: { id: number }; chat?: { id: number } }): boolean;
    };
    expect(botAny.isUserAllowed({ from: { id: 123 }, chat: { id: 456 } })).toBe(false);
  });

  it('allows chat when chatId is in allowedChatIds', () => {
    const bot = new TelegramBot({
      botToken: 'token',
      enabled: true,
      allowedChatIds: [456],
    });
    const botAny = bot as unknown as {
      isUserAllowed(ctx: { from?: { id: number }; chat?: { id: number } }): boolean;
    };
    expect(botAny.isUserAllowed({ from: { id: 123 }, chat: { id: 456 } })).toBe(true);
  });

  it('respects fail-CLOSED: empty allowedUserIds blocks everyone', () => {
    const bot = new TelegramBot({
      botToken: 'token',
      enabled: true,
      allowedUserIds: [],
    });
    const botAny = bot as unknown as {
      isUserAllowed(ctx: { from?: { id: number }; chat?: { id: number } }): boolean;
    };
    // Empty array means the check is `!userId || !config.allowedUserIds.includes(userId)`
    // where `userId` is defined but `[].includes(userId)` returns false → blocked
    expect(botAny.isUserAllowed({ from: { id: 1 }, chat: { id: 2 } })).toBe(false);
  });
});

// ── parseIncomingMessage ───────────────────────────────────────────────

describe('TelegramBot parseIncomingMessage', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('parses a message with all fields', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    const parse = (
      bot as unknown as {
        parseIncomingMessage(ctx: {
          message?: { message_id: number; text: string; date: number };
          from?: { id: number; username?: string };
          chat?: { id: number };
        }): {
          id: string;
          channel: string;
          userId: string;
          username?: string;
          chatId: string;
          text: string;
          timestamp: Date;
          raw: unknown;
        };
      }
    ).parseIncomingMessage;

    const result = parse({
      message: { message_id: 42, text: 'Hello bot!', date: 1000 },
      from: { id: 123, username: 'testuser' },
      chat: { id: 456 },
    });

    expect(result.id).toBe('42');
    expect(result.channel).toBe('telegram');
    expect(result.userId).toBe('123');
    expect(result.username).toBe('testuser');
    expect(result.chatId).toBe('456');
    expect(result.text).toBe('Hello bot!');
    expect(result.timestamp.getTime()).toBe(1000 * 1000);
  });

  it('handles missing optional fields', () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    const parse = (
      bot as unknown as {
        parseIncomingMessage(ctx: Record<string, unknown>): {
          id: string;
          userId: string;
          chatId: string;
          text: string;
        };
      }
    ).parseIncomingMessage;

    const result = parse({});
    expect(result.id).toBe('');
    expect(result.userId).toBe('');
    expect(result.chatId).toBe('');
    expect(result.text).toBe('');
  });
});

// ── sendMessage ────────────────────────────────────────────────────────

describe('TelegramBot sendMessage', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('sends a simple message', async () => {
    // Extend the mock bot with sendMessage API
    const sendMessageApi = vi.fn().mockResolvedValue({ message_id: 101 });
    (mockBot as Record<string, unknown>).api = {
      sendMessage: sendMessageApi,
    };

    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    await bot.sendMessage({ chatId: '123', text: 'Hello' });

    expect(sendMessageApi).toHaveBeenCalledWith(
      123,
      'Hello',
      expect.objectContaining({
        parse_mode: undefined,
      })
    );
  });

  it('splits long messages and sends multiple parts', async () => {
    const sendMessageApi = vi.fn().mockResolvedValue({});
    (mockBot as Record<string, unknown>).api = {
      sendMessage: sendMessageApi,
    };

    const bot = new TelegramBot({
      botToken: 'token',
      enabled: true,
      maxMessageLength: 100,
    });

    const longText = 'A'.repeat(250);
    await bot.sendMessage({ chatId: '456', text: longText });

    // Should have been split into 3 parts
    expect(sendMessageApi).toHaveBeenCalledTimes(3);
  });

  it('handles part send failures and aggregates errors', async () => {
    const sendMessageApi = vi
      .fn()
      .mockResolvedValueOnce({}) // first part succeeds
      .mockRejectedValueOnce(new Error('Failed to send')); // second part fails
    (mockBot as Record<string, unknown>).api = {
      sendMessage: sendMessageApi,
    };

    const bot = new TelegramBot({
      botToken: 'token',
      enabled: true,
      maxMessageLength: 100,
    });

    const longText = 'A'.repeat(150);
    await expect(bot.sendMessage({ chatId: '789', text: longText })).rejects.toThrow(
      'Telegram sendMessage failed for 1/2 parts'
    );
  });

  it('throws for invalid chatId', async () => {
    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    await expect(bot.sendMessage({ chatId: 'not-a-number', text: 'Hi' })).rejects.toThrow(
      'Invalid chatId'
    );
  });

  it('passes replyToMessageId on first part only', async () => {
    const sendMessageApi = vi.fn().mockResolvedValue({});
    (mockBot as Record<string, unknown>).api = {
      sendMessage: sendMessageApi,
    };

    const bot = new TelegramBot({
      botToken: 'token',
      enabled: true,
      maxMessageLength: 50,
    });

    const longText = 'A'.repeat(120);
    await bot.sendMessage({
      chatId: '111',
      text: longText,
      replyToMessageId: '42',
    });

    // First part should have reply_to_message_id
    expect(sendMessageApi).toHaveBeenNthCalledWith(
      1,
      111,
      expect.any(String),
      expect.objectContaining({ reply_to_message_id: 42 })
    );

    // Subsequent parts should not have reply_to_message_id
    const lastCallArgs = sendMessageApi.mock.calls[sendMessageApi.mock.calls.length - 1];
    expect(lastCallArgs[2].reply_to_message_id).toBeUndefined();
  });
});

// ── start / stop ───────────────────────────────────────────────────────

describe('TelegramBot start/stop', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('start throws when not configured', async () => {
    const bot = new TelegramBot({ botToken: '', enabled: false });
    (mockBot as Record<string, unknown>).api = {
      getMe: vi.fn().mockResolvedValue({ username: 'TestBot' }),
    };

    await expect(bot.start()).rejects.toThrow('not properly configured');
  });

  it('start() and stop() are idempotent', async () => {
    const getMeApi = vi.fn().mockResolvedValue({ username: 'TestBot' });
    const startApi = vi.fn().mockImplementation((opts) => {
      if (opts?.onStart) opts.onStart();
    });
    const stopApi = vi.fn();
    (mockBot as Record<string, unknown>).api = { getMe: getMeApi };
    (mockBot as Record<string, unknown>).start = startApi;
    (mockBot as Record<string, unknown>).stop = stopApi;

    const bot = new TelegramBot({ botToken: 'real-token', enabled: true });

    // First start
    await bot.start();
    expect(bot.isReady()).toBe(true);

    // Second start is idempotent
    await bot.start();
    expect(startApi).toHaveBeenCalledTimes(1);

    // Stop
    await bot.stop();
    expect(stopApi).toHaveBeenCalledTimes(1);

    // Stop is idempotent
    await bot.stop();
    expect(stopApi).toHaveBeenCalledTimes(1);
  });
});

// ── setWebhook / deleteWebhook ─────────────────────────────────────────

describe('TelegramBot setWebhook/deleteWebhook', () => {
  beforeEach(() => {
    registrationOrder.length = 0;
  });

  it('setWebhook calls bot.api.setWebhook', async () => {
    const setWebhookApi = vi.fn().mockResolvedValue(true);
    (mockBot as Record<string, unknown>).api = {
      setWebhook: setWebhookApi,
    };

    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    await bot.setWebhook('https://example.com/webhook/secret');

    expect(setWebhookApi).toHaveBeenCalledWith('https://example.com/webhook/secret');
  });

  it('deleteWebhook calls bot.api.deleteWebhook', async () => {
    const deleteWebhookApi = vi.fn().mockResolvedValue(true);
    (mockBot as Record<string, unknown>).api = {
      deleteWebhook: deleteWebhookApi,
    };

    const bot = new TelegramBot({ botToken: 'token', enabled: true });
    await bot.deleteWebhook();

    expect(deleteWebhookApi).toHaveBeenCalled();
  });
});
