import { describe, it, expect, vi } from 'vitest';
import { TelegramBot, createTelegramBot } from './bot.js';
import type { TelegramConfig } from '../types/index.js';

// Mock grammy Bot class
vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    command: vi.fn(),
    catch: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    api: {
      getMe: vi.fn().mockResolvedValue({ username: 'test_bot' }),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
      setWebhook: vi.fn().mockResolvedValue(true),
      deleteWebhook: vi.fn().mockResolvedValue(true),
    },
  })),
  webhookCallback: vi.fn().mockReturnValue(() => Promise.resolve(new Response())),
}));

const createTestConfig = (overrides: Partial<TelegramConfig> = {}): TelegramConfig => ({
  type: 'telegram',
  enabled: true,
  botToken: 'test-token-123',
  ...overrides,
});

describe('TelegramBot', () => {
  describe('construction', () => {
    it('creates bot with config', () => {
      const bot = new TelegramBot(createTestConfig());
      expect(bot.type).toBe('telegram');
    });

    it('creates bot with createTelegramBot helper', () => {
      const bot = createTelegramBot(createTestConfig());
      expect(bot).toBeInstanceOf(TelegramBot);
    });
  });

  describe('isReady', () => {
    it('returns true when properly configured', () => {
      const bot = new TelegramBot(createTestConfig());
      expect(bot.isReady()).toBe(true);
    });

    it('returns false when disabled', () => {
      const bot = new TelegramBot(createTestConfig({ enabled: false }));
      expect(bot.isReady()).toBe(false);
    });

    it('returns false when no token', () => {
      const bot = new TelegramBot(createTestConfig({ botToken: '' }));
      expect(bot.isReady()).toBe(false);
    });
  });

  describe('message handling', () => {
    it('registers message handler', () => {
      const bot = new TelegramBot(createTestConfig());
      const handler = vi.fn();

      bot.onMessage(handler);

      // Handler is registered (internal state, tested indirectly)
      expect(() => bot.onMessage(handler)).not.toThrow();
    });
  });

  describe('sendMessage', () => {
    it('sends simple message', async () => {
      const bot = new TelegramBot(createTestConfig());

      await expect(
        bot.sendMessage({
          chatId: '12345',
          text: 'Hello, world!',
        })
      ).resolves.not.toThrow();
    });

    it('sends message with reply', async () => {
      const bot = new TelegramBot(createTestConfig());

      await expect(
        bot.sendMessage({
          chatId: '12345',
          text: 'Reply message',
          replyToMessageId: '100',
        })
      ).resolves.not.toThrow();
    });
  });

  describe('start/stop', () => {
    it('starts the bot', async () => {
      const bot = new TelegramBot(createTestConfig());
      await expect(bot.start()).resolves.not.toThrow();
    });

    it('stops the bot', async () => {
      const bot = new TelegramBot(createTestConfig());
      await bot.start();
      await expect(bot.stop()).resolves.not.toThrow();
    });

    it('throws when starting disabled bot', async () => {
      const bot = new TelegramBot(createTestConfig({ enabled: false }));
      await expect(bot.start()).rejects.toThrow();
    });
  });

  describe('webhook', () => {
    it('sets webhook', async () => {
      const bot = new TelegramBot(createTestConfig());
      await expect(bot.setWebhook('https://example.com/webhook')).resolves.not.toThrow();
    });

    it('deletes webhook', async () => {
      const bot = new TelegramBot(createTestConfig());
      await expect(bot.deleteWebhook()).resolves.not.toThrow();
    });

    it('returns webhook callback', () => {
      const bot = new TelegramBot(createTestConfig());
      const callback = bot.getWebhookCallback();
      expect(typeof callback).toBe('function');
    });
  });

  describe('message splitting', () => {
    it('splits long messages', async () => {
      const bot = new TelegramBot(createTestConfig({ maxMessageLength: 100 }));
      const longMessage = 'A'.repeat(250);

      // Should not throw, messages will be split
      await expect(
        bot.sendMessage({
          chatId: '12345',
          text: longMessage,
        })
      ).resolves.not.toThrow();
    });
  });

  describe('access control', () => {
    it('allows configuration of allowed users', () => {
      const bot = new TelegramBot(
        createTestConfig({
          allowedUserIds: [123, 456],
          allowedChatIds: [789],
        })
      );

      expect(bot.isReady()).toBe(true);
    });
  });
});
