import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before any imports that use them
// ---------------------------------------------------------------------------

const { mockBot, mockLog } = vi.hoisted(() => {
  const mockBot = {
    on: vi.fn(),
    command: vi.fn(),
    catch: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    api: {
      getMe: vi.fn().mockResolvedValue({ username: 'test_bot' }),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      setWebhook: vi.fn().mockResolvedValue(true),
      deleteWebhook: vi.fn().mockResolvedValue(true),
    },
  };
  return {
    mockBot,
    mockLog: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('grammy', () => ({
  Bot: vi.fn(() => mockBot),
  webhookCallback: vi.fn(() => vi.fn()),
}));

vi.mock('../log.js', () => ({
  getLog: vi.fn(() => mockLog),
}));

import { TelegramBot, createTelegramBot } from './bot.js';
import type { TelegramConfig } from '../types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    type: 'telegram',
    enabled: true,
    botToken: 'test-token-123',
    ...overrides,
  };
}

function captureHandler(methodName: 'on' | 'command', trigger: string) {
  const call = mockBot[methodName].mock.calls.find(
    (c: unknown[]) => c[0] === trigger
  );
  if (!call) throw new Error(`No ${methodName}('${trigger}') call found`);
  return call[1] as (ctx: Record<string, unknown>) => Promise<void>;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    from: { id: 123, username: 'testuser' },
    chat: { id: 456 },
    message: { message_id: 789, text: 'hello', date: 1700000000 },
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelegramBot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBot.start.mockResolvedValue(undefined);
    mockBot.stop.mockResolvedValue(undefined);
    mockBot.api.getMe.mockResolvedValue({ username: 'test_bot' });
    mockBot.api.sendMessage.mockResolvedValue({ message_id: 1 });
    mockBot.api.setWebhook.mockResolvedValue(true);
    mockBot.api.deleteWebhook.mockResolvedValue(true);
  });

  // =========================================================================
  // Construction
  // =========================================================================

  describe('construction', () => {
    it('creates bot with config', () => {
      const bot = new TelegramBot(makeConfig());
      expect(bot.type).toBe('telegram');
    });

    it('merges default config (parseMode, maxMessageLength)', () => {
      const bot = new TelegramBot(makeConfig());
      // Verify setupHandlers was called (handlers are registered)
      expect(mockBot.on).toHaveBeenCalledWith('message:text', expect.any(Function));
      expect(mockBot.command).toHaveBeenCalledWith('start', expect.any(Function));
      expect(mockBot.command).toHaveBeenCalledWith('help', expect.any(Function));
      expect(mockBot.command).toHaveBeenCalledWith('reset', expect.any(Function));
      expect(mockBot.catch).toHaveBeenCalledWith(expect.any(Function));
      expect(bot).toBeInstanceOf(TelegramBot);
    });
  });

  // =========================================================================
  // isReady
  // =========================================================================

  describe('isReady', () => {
    it('returns true when token and enabled', () => {
      expect(new TelegramBot(makeConfig()).isReady()).toBe(true);
    });

    it('returns false when disabled', () => {
      expect(new TelegramBot(makeConfig({ enabled: false })).isReady()).toBe(false);
    });

    it('returns false when no token', () => {
      expect(new TelegramBot(makeConfig({ botToken: '' })).isReady()).toBe(false);
    });
  });

  // =========================================================================
  // Message handler callbacks
  // =========================================================================

  describe('message:text handler', () => {
    it('passes incoming message to registered handler', async () => {
      const bot = new TelegramBot(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      bot.onMessage(handler);

      const msgHandler = captureHandler('on', 'message:text');
      await msgHandler(makeCtx());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '789',
          channel: 'telegram',
          userId: '123',
          username: 'testuser',
          chatId: '456',
          text: 'hello',
        })
      );
    });

    it('does nothing when no handler registered', async () => {
      new TelegramBot(makeConfig());
      const msgHandler = captureHandler('on', 'message:text');
      const ctx = makeCtx();
      await msgHandler(ctx); // should not throw
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it('sends error reply when handler throws', async () => {
      const bot = new TelegramBot(makeConfig());
      bot.onMessage(vi.fn().mockRejectedValue(new Error('handler fail')));

      const msgHandler = captureHandler('on', 'message:text');
      const ctx = makeCtx();
      await msgHandler(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        'Sorry, I encountered an error processing your message.'
      );
      expect(mockLog.error).toHaveBeenCalledWith(
        'Error handling Telegram message',
        expect.any(Error)
      );
    });

    it('blocks disallowed users', async () => {
      const bot = new TelegramBot(makeConfig({ allowedUserIds: [999] }));
      const handler = vi.fn();
      bot.onMessage(handler);

      const msgHandler = captureHandler('on', 'message:text');
      await msgHandler(makeCtx());

      expect(handler).not.toHaveBeenCalled();
    });

    it('blocks disallowed chats', async () => {
      const bot = new TelegramBot(makeConfig({ allowedChatIds: [999] }));
      const handler = vi.fn();
      bot.onMessage(handler);

      const msgHandler = captureHandler('on', 'message:text');
      await msgHandler(makeCtx());

      expect(handler).not.toHaveBeenCalled();
    });

    it('blocks when from is undefined and user whitelist set', async () => {
      const bot = new TelegramBot(makeConfig({ allowedUserIds: [123] }));
      const handler = vi.fn();
      bot.onMessage(handler);

      const msgHandler = captureHandler('on', 'message:text');
      await msgHandler(makeCtx({ from: undefined }));

      expect(handler).not.toHaveBeenCalled();
    });

    it('blocks when chat is undefined and chat whitelist set', async () => {
      const bot = new TelegramBot(makeConfig({ allowedChatIds: [456] }));
      const handler = vi.fn();
      bot.onMessage(handler);

      const msgHandler = captureHandler('on', 'message:text');
      await msgHandler(makeCtx({ chat: undefined }));

      expect(handler).not.toHaveBeenCalled();
    });

    it('allows all users when no whitelist configured', async () => {
      const bot = new TelegramBot(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      bot.onMessage(handler);

      const msgHandler = captureHandler('on', 'message:text');
      await msgHandler(makeCtx({ from: { id: 9999 } }));

      expect(handler).toHaveBeenCalled();
    });

    it('parses message with missing optional fields', async () => {
      const bot = new TelegramBot(makeConfig());
      const handler = vi.fn().mockResolvedValue(undefined);
      bot.onMessage(handler);

      const msgHandler = captureHandler('on', 'message:text');
      await msgHandler(
        makeCtx({
          from: { id: 10 },
          chat: { id: 20 },
          message: { message_id: 30, date: 0 },
        })
      );

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '30',
          userId: '10',
          username: undefined,
          text: '',
        })
      );
    });
  });

  // =========================================================================
  // Command handlers
  // =========================================================================

  describe('commands', () => {
    it('/start sends welcome for allowed user', async () => {
      new TelegramBot(makeConfig());
      const ctx = makeCtx();
      await captureHandler('command', 'start')(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Welcome to OwnPilot'));
    });

    it('/start rejects unauthorized user', async () => {
      new TelegramBot(makeConfig({ allowedUserIds: [999] }));
      const ctx = makeCtx();
      await captureHandler('command', 'start')(ctx);
      expect(ctx.reply).toHaveBeenCalledWith('Sorry, you are not authorized to use this bot.');
    });

    it('/help sends help text', async () => {
      new TelegramBot(makeConfig());
      const ctx = makeCtx();
      await captureHandler('command', 'help')(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('OwnPilot Bot Help'));
    });

    it('/help skips unauthorized user', async () => {
      new TelegramBot(makeConfig({ allowedUserIds: [999] }));
      const ctx = makeCtx();
      await captureHandler('command', 'help')(ctx);
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it('/reset sends confirmation', async () => {
      new TelegramBot(makeConfig());
      const ctx = makeCtx();
      await captureHandler('command', 'reset')(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Conversation reset'));
    });

    it('/reset skips unauthorized user', async () => {
      new TelegramBot(makeConfig({ allowedUserIds: [999] }));
      const ctx = makeCtx();
      await captureHandler('command', 'reset')(ctx);
      expect(ctx.reply).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Error handler
  // =========================================================================

  describe('bot.catch', () => {
    it('logs errors', () => {
      new TelegramBot(makeConfig());
      const errorHandler = mockBot.catch.mock.calls[0]![0] as (err: Error) => void;
      const err = new Error('test');
      errorHandler(err);
      expect(mockLog.error).toHaveBeenCalledWith('Telegram bot error', err);
    });
  });

  // =========================================================================
  // Start / Stop
  // =========================================================================

  describe('start', () => {
    it('fetches bot info and starts long polling', async () => {
      const bot = new TelegramBot(makeConfig());
      await bot.start();

      expect(mockBot.api.getMe).toHaveBeenCalled();
      expect(mockBot.start).toHaveBeenCalledWith(
        expect.objectContaining({ onStart: expect.any(Function) })
      );
      expect(mockLog.info).toHaveBeenCalledWith('Starting Telegram bot: @test_bot');
    });

    it('fires onStart callback to mark running', async () => {
      const bot = new TelegramBot(makeConfig());

      // Make start call the onStart callback
      mockBot.start.mockImplementation(async (opts: { onStart?: () => void }) => {
        opts?.onStart?.();
      });

      await bot.start();
      expect(mockLog.info).toHaveBeenCalledWith('Telegram bot started successfully');
    });

    it('is idempotent when already running', async () => {
      const bot = new TelegramBot(makeConfig());
      mockBot.start.mockImplementation(async (opts: { onStart?: () => void }) => {
        opts?.onStart?.();
      });

      await bot.start();
      mockBot.api.getMe.mockClear();
      await bot.start(); // second call — no-op

      expect(mockBot.api.getMe).not.toHaveBeenCalled();
    });

    it('throws when bot is not ready', async () => {
      const bot = new TelegramBot(makeConfig({ enabled: false }));
      await expect(bot.start()).rejects.toThrow('not properly configured');
    });
  });

  describe('stop', () => {
    it('stops running bot', async () => {
      const bot = new TelegramBot(makeConfig());
      mockBot.start.mockImplementation(async (opts: { onStart?: () => void }) => {
        opts?.onStart?.();
      });

      await bot.start();
      await bot.stop();

      expect(mockBot.stop).toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith('Telegram bot stopped');
    });

    it('is idempotent when not running', async () => {
      const bot = new TelegramBot(makeConfig());
      await bot.stop(); // no-op
      expect(mockBot.stop).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // sendMessage
  // =========================================================================

  describe('sendMessage', () => {
    it('sends simple message with default parseMode', async () => {
      const bot = new TelegramBot(makeConfig());
      await bot.sendMessage({ chatId: '456', text: 'Hello!' });

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(456, 'Hello!', {
        parse_mode: 'HTML',
        reply_to_message_id: undefined,
      });
    });

    it('sends with reply_to_message_id', async () => {
      const bot = new TelegramBot(makeConfig());
      await bot.sendMessage({ chatId: '456', text: 'Reply', replyToMessageId: '100' });

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(456, 'Reply', {
        parse_mode: 'HTML',
        reply_to_message_id: 100,
      });
    });

    it('uses custom parseMode from message', async () => {
      const bot = new TelegramBot(makeConfig());
      await bot.sendMessage({ chatId: '456', text: 'Test', parseMode: 'Markdown' });

      expect(mockBot.api.sendMessage).toHaveBeenCalledWith(456, 'Test', {
        parse_mode: 'Markdown',
        reply_to_message_id: undefined,
      });
    });

    it('throws for non-numeric chatId', async () => {
      const bot = new TelegramBot(makeConfig());
      await expect(bot.sendMessage({ chatId: 'abc', text: 'x' })).rejects.toThrow('Invalid chatId');
    });

    it('splits long messages into parts', async () => {
      const bot = new TelegramBot(makeConfig({ maxMessageLength: 20 }));
      const text = 'word '.repeat(20); // 100 chars
      await bot.sendMessage({ chatId: '456', text });
      expect(mockBot.api.sendMessage.mock.calls.length).toBeGreaterThan(1);
    });

    it('rethrows last error after attempting all parts', async () => {
      const bot = new TelegramBot(makeConfig({ maxMessageLength: 20 }));
      mockBot.api.sendMessage.mockRejectedValue(new Error('send failed'));
      const text = 'word '.repeat(20);
      await expect(bot.sendMessage({ chatId: '456', text })).rejects.toThrow('send failed');
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send message part'),
        expect.any(Object)
      );
    });

    it('wraps non-Error thrown values', async () => {
      const bot = new TelegramBot(makeConfig({ maxMessageLength: 20 }));
      mockBot.api.sendMessage.mockRejectedValue('raw string');
      const text = 'word '.repeat(20);
      await expect(bot.sendMessage({ chatId: '456', text })).rejects.toThrow('raw string');
    });

    it('splits at newline boundaries', async () => {
      const bot = new TelegramBot(makeConfig({ maxMessageLength: 30 }));
      const text = 'first line here\nsecond line here\nthird line here';
      await bot.sendMessage({ chatId: '456', text });
      expect(mockBot.api.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('splits at space when no newline near boundary', async () => {
      const bot = new TelegramBot(makeConfig({ maxMessageLength: 20 }));
      const text = 'short words in a longer sentence without newlines here and more';
      await bot.sendMessage({ chatId: '456', text });
      expect(mockBot.api.sendMessage.mock.calls.length).toBeGreaterThan(1);
    });

    it('hard splits continuous text without spaces or newlines', async () => {
      const bot = new TelegramBot(makeConfig({ maxMessageLength: 10 }));
      const text = 'abcdefghijklmnopqrstuvwxyz'; // 26 chars, no splits possible
      await bot.sendMessage({ chatId: '456', text });
      expect(mockBot.api.sendMessage.mock.calls.length).toBeGreaterThan(1);
    });

    it('reply_to only on first part of split message', async () => {
      const bot = new TelegramBot(makeConfig({ maxMessageLength: 20 }));
      const text = 'word '.repeat(20);
      await bot.sendMessage({ chatId: '456', text, replyToMessageId: '99' });

      const calls = mockBot.api.sendMessage.mock.calls;
      // First part has reply_to_message_id
      expect(calls[0]![2].reply_to_message_id).toBe(99);
      // Second part does not
      if (calls.length > 1) {
        expect(calls[1]![2].reply_to_message_id).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // Webhook
  // =========================================================================

  describe('webhook', () => {
    it('getWebhookCallback returns a function', () => {
      const bot = new TelegramBot(makeConfig());
      expect(typeof bot.getWebhookCallback()).toBe('function');
    });

    it('setWebhook calls API and logs', async () => {
      const bot = new TelegramBot(makeConfig());
      await bot.setWebhook('https://example.com/hook');
      expect(mockBot.api.setWebhook).toHaveBeenCalledWith('https://example.com/hook');
      expect(mockLog.info).toHaveBeenCalledWith('Telegram webhook set to: https://example.com/hook');
    });

    it('deleteWebhook calls API and logs', async () => {
      const bot = new TelegramBot(makeConfig());
      await bot.deleteWebhook();
      expect(mockBot.api.deleteWebhook).toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith('Telegram webhook deleted');
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createTelegramBot', () => {
    it('returns a TelegramBot instance', () => {
      const bot = createTelegramBot(makeConfig());
      expect(bot).toBeInstanceOf(TelegramBot);
    });
  });
});
