/**
 * Bot CLI Command Tests
 *
 * Tests for bot.ts — starts the Telegram bot with provider configuration
 * loaded from the database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockSettingsRepo = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue(null),
}));

const mockLoadApiKeysToEnvironment = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetDefaultProvider = vi.hoisted(() => vi.fn().mockResolvedValue('openai'));
const mockGetApiKey = vi.hoisted(() => vi.fn().mockResolvedValue('test-api-key'));
const mockGetDefaultModel = vi.hoisted(() => vi.fn().mockResolvedValue('gpt-4'));

const mockCreateSimpleAgent = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({
      ok: true,
      value: { content: 'Test response' },
    }),
  })
);

const mockBotStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockBotStop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSetWebhook = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSendMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockOnMessage = vi.hoisted(() => vi.fn());

const mockCreateTelegramBot = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    start: mockBotStart,
    stop: mockBotStop,
    setWebhook: mockSetWebhook,
    sendMessage: mockSendMessage,
    onMessage: mockOnMessage,
  })
);

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@ownpilot/core', () => ({
  createSimpleAgent: mockCreateSimpleAgent,
}));

vi.mock('@ownpilot/channels', () => ({
  createTelegramBot: mockCreateTelegramBot,
}));

vi.mock('@ownpilot/gateway', () => ({
  loadApiKeysToEnvironment: mockLoadApiKeysToEnvironment,
  getDefaultProvider: mockGetDefaultProvider,
  getApiKey: mockGetApiKey,
  getDefaultModel: mockGetDefaultModel,
  settingsRepo: mockSettingsRepo,
}));

// ============================================================================
// Import after mocks
// ============================================================================

import { startBot } from './bot.js';

describe('Bot CLI Command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  describe('startBot', () => {
    it('exits when no token provided', async () => {
      mockSettingsRepo.get.mockResolvedValue(null);

      await startBot({});

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Telegram bot token is required')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits when no provider configured', async () => {
      mockSettingsRepo.get.mockResolvedValue('test-token');
      mockGetDefaultProvider.mockResolvedValue(null);

      await startBot({ token: 'test-token' });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No AI provider API key configured')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits when API key not found', async () => {
      mockSettingsRepo.get.mockResolvedValue('test-token');
      mockGetDefaultProvider.mockResolvedValue('openai');
      mockGetApiKey.mockResolvedValue(null);

      await startBot({ token: 'test-token' });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('API key for openai not found')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits when unsupported provider used', async () => {
      mockSettingsRepo.get.mockResolvedValue('test-token');
      mockGetDefaultProvider.mockResolvedValue('unsupported-provider');
      mockGetApiKey.mockResolvedValue('test-key');

      await startBot({ token: 'test-token' });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('unsupported-provider" is not supported')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('starts bot with long polling successfully', async () => {
      mockSettingsRepo.get.mockResolvedValue('test-token');
      mockGetDefaultProvider.mockResolvedValue('openai');
      mockGetApiKey.mockResolvedValue('test-key');
      mockGetDefaultModel.mockResolvedValue('gpt-4');

      await startBot({ token: 'test-token' });

      expect(mockLoadApiKeysToEnvironment).toHaveBeenCalled();
      expect(mockCreateSimpleAgent).toHaveBeenCalledWith(
        'openai',
        'test-key',
        expect.objectContaining({
          name: 'Telegram Bot',
          model: 'gpt-4',
        })
      );
      expect(mockCreateTelegramBot).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'telegram',
          botToken: 'test-token',
        })
      );
      expect(mockBotStart).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Bot started with long polling'));
    });

    it('starts bot with webhook successfully', async () => {
      mockSettingsRepo.get.mockResolvedValue('test-token');
      mockGetDefaultProvider.mockResolvedValue('openai');
      mockGetApiKey.mockResolvedValue('test-key');
      mockGetDefaultModel.mockResolvedValue('gpt-4');

      await startBot({ token: 'test-token', webhook: 'https://example.com/webhook' });

      expect(mockSetWebhook).toHaveBeenCalledWith('https://example.com/webhook');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Webhook set to'));
    });

    it('exits when webhook URL is not HTTPS', async () => {
      mockSettingsRepo.get.mockResolvedValue('test-token');
      mockGetDefaultProvider.mockResolvedValue('openai');
      mockGetApiKey.mockResolvedValue('test-key');

      await startBot({ token: 'test-token', webhook: 'http://example.com/webhook' });

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Webhook URL must use HTTPS'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('parses allowed users and chats from options', async () => {
      mockSettingsRepo.get.mockResolvedValue('test-token');
      mockGetDefaultProvider.mockResolvedValue('openai');
      mockGetApiKey.mockResolvedValue('test-key');

      await startBot({
        token: 'test-token',
        users: '123,456,abc',
        chats: '789,invalid',
      });

      expect(mockCreateTelegramBot).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedUserIds: [123, 456],
          allowedChatIds: [789],
        })
      );
    });

    it('uses token from options over database', async () => {
      mockSettingsRepo.get.mockResolvedValue('db-token');
      mockGetDefaultProvider.mockResolvedValue('openai');
      mockGetApiKey.mockResolvedValue('test-key');

      await startBot({ token: 'cli-token' });

      expect(mockCreateTelegramBot).toHaveBeenCalledWith(
        expect.objectContaining({
          botToken: 'cli-token',
        })
      );
    });

    it('supports anthropic provider', async () => {
      mockSettingsRepo.get.mockResolvedValue('test-token');
      mockGetDefaultProvider.mockResolvedValue('anthropic');
      mockGetApiKey.mockResolvedValue('test-key');

      await startBot({ token: 'test-token' });

      expect(mockCreateSimpleAgent).toHaveBeenCalledWith(
        'anthropic',
        'test-key',
        expect.any(Object)
      );
    });
  });
});
