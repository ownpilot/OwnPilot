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

    // ========================================================================
    // onMessage callback tests (lines 100-130)
    // ========================================================================

    describe('onMessage handler', () => {
      /** Helper: set up valid bot config mocks and return the captured onMessage handler */
      async function setupBotAndGetHandler() {
        mockSettingsRepo.get.mockResolvedValue('test-token');
        mockGetDefaultProvider.mockResolvedValue('openai');
        mockGetApiKey.mockResolvedValue('test-key');
        mockGetDefaultModel.mockResolvedValue('gpt-4');

        await startBot({ token: 'test-token' });

        // mockOnMessage is called with the handler function
        expect(mockOnMessage).toHaveBeenCalledWith(expect.any(Function));
        return mockOnMessage.mock.calls[0]![0] as (message: {
          id: number;
          text: string;
          chatId: number;
          userId: number;
          username?: string;
        }) => Promise<void>;
      }

      it('handles successful chat response', async () => {
        const mockChat = vi.fn().mockResolvedValue({
          ok: true,
          value: { content: 'Hello from the bot!' },
        });
        mockCreateSimpleAgent.mockReturnValue({ chat: mockChat });

        const handler = await setupBotAndGetHandler();

        await handler({
          id: 42,
          text: 'Hello',
          chatId: 100,
          userId: 1,
          username: 'testuser',
        });

        expect(mockChat).toHaveBeenCalledWith('Hello');
        expect(mockSendMessage).toHaveBeenCalledWith({
          chatId: 100,
          text: 'Hello from the bot!',
          replyToMessageId: 42,
        });
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[testuser]'));
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Response:'));
      });

      it('uses userId when username is not available', async () => {
        const mockChat = vi.fn().mockResolvedValue({
          ok: true,
          value: { content: 'response' },
        });
        mockCreateSimpleAgent.mockReturnValue({ chat: mockChat });

        const handler = await setupBotAndGetHandler();

        await handler({
          id: 1,
          text: 'Hi',
          chatId: 100,
          userId: 999,
        });

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[999]'));
      });

      it('uses "(No response)" when content is empty', async () => {
        const mockChat = vi.fn().mockResolvedValue({
          ok: true,
          value: { content: '' },
        });
        mockCreateSimpleAgent.mockReturnValue({ chat: mockChat });

        const handler = await setupBotAndGetHandler();

        await handler({
          id: 1,
          text: 'Hi',
          chatId: 100,
          userId: 1,
          username: 'user',
        });

        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ text: '(No response)' })
        );
      });

      it('sends error message to chat on agent error', async () => {
        const mockChat = vi.fn().mockResolvedValue({
          ok: false,
          error: { message: 'Rate limit exceeded' },
        });
        mockCreateSimpleAgent.mockReturnValue({ chat: mockChat });

        const handler = await setupBotAndGetHandler();

        await handler({
          id: 5,
          text: 'test',
          chatId: 200,
          userId: 1,
          username: 'user',
        });

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Rate limit exceeded'));
        expect(mockSendMessage).toHaveBeenCalledWith({
          chatId: 200,
          text: 'Sorry, I encountered an error: Rate limit exceeded',
          replyToMessageId: 5,
        });
      });

      it('handles failure to send error message to chat', async () => {
        const mockChat = vi.fn().mockResolvedValue({
          ok: false,
          error: { message: 'Agent error' },
        });
        mockCreateSimpleAgent.mockReturnValue({ chat: mockChat });
        mockSendMessage.mockRejectedValueOnce(new Error('Telegram API down'));

        const handler = await setupBotAndGetHandler();

        await handler({
          id: 5,
          text: 'test',
          chatId: 200,
          userId: 1,
          username: 'user',
        });

        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to send error message:',
          'Telegram API down'
        );
      });

      it('handles non-Error thrown when sending error message', async () => {
        const mockChat = vi.fn().mockResolvedValue({
          ok: false,
          error: { message: 'Agent error' },
        });
        mockCreateSimpleAgent.mockReturnValue({ chat: mockChat });
        mockSendMessage.mockRejectedValueOnce('string error');

        const handler = await setupBotAndGetHandler();

        await handler({
          id: 5,
          text: 'test',
          chatId: 200,
          userId: 1,
          username: 'user',
        });

        expect(errorSpy).toHaveBeenCalledWith('Failed to send error message:', 'string error');
      });

      it('catches top-level errors in message processing', async () => {
        const mockChat = vi.fn().mockRejectedValue(new Error('Unexpected crash'));
        mockCreateSimpleAgent.mockReturnValue({ chat: mockChat });

        const handler = await setupBotAndGetHandler();

        await handler({
          id: 1,
          text: 'test',
          chatId: 100,
          userId: 1,
          username: 'user',
        });

        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to process message:',
          'Unexpected crash'
        );
      });

      it('catches top-level non-Error thrown in message processing', async () => {
        const mockChat = vi.fn().mockRejectedValue('raw string throw');
        mockCreateSimpleAgent.mockReturnValue({ chat: mockChat });

        const handler = await setupBotAndGetHandler();

        await handler({
          id: 1,
          text: 'test',
          chatId: 100,
          userId: 1,
          username: 'user',
        });

        expect(errorSpy).toHaveBeenCalledWith(
          'Failed to process message:',
          'raw string throw'
        );
      });
    });

    // ========================================================================
    // Webhook error handling (lines 151-156)
    // ========================================================================

    describe('webhook error handling', () => {
      it('exits with error for invalid webhook URL (TypeError)', async () => {
        mockSettingsRepo.get.mockResolvedValue('test-token');
        mockGetDefaultProvider.mockResolvedValue('openai');
        mockGetApiKey.mockResolvedValue('test-key');

        // 'not-a-url' will cause new URL() to throw TypeError.
        // After process.exit is mocked (no-op), execution falls through to `throw err`.
        await startBot({ token: 'test-token', webhook: 'not-a-url' }).catch(() => {});

        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid webhook URL: not-a-url')
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
      });

      it('re-throws non-TypeError errors from webhook setup', async () => {
        mockSettingsRepo.get.mockResolvedValue('test-token');
        mockGetDefaultProvider.mockResolvedValue('openai');
        mockGetApiKey.mockResolvedValue('test-key');

        // setWebhook throws a non-TypeError after URL is validated
        const networkError = new Error('Network failure');
        mockSetWebhook.mockRejectedValueOnce(networkError);

        await expect(
          startBot({ token: 'test-token', webhook: 'https://example.com/hook' })
        ).rejects.toThrow('Network failure');
      });
    });

    // ========================================================================
    // Shutdown handler (lines 167-170)
    // ========================================================================

    describe('shutdown handler', () => {
      it('registers SIGINT and SIGTERM handlers and stops bot on signal', async () => {
        mockSettingsRepo.get.mockResolvedValue('test-token');
        mockGetDefaultProvider.mockResolvedValue('openai');
        mockGetApiKey.mockResolvedValue('test-key');

        const onSpy = vi.spyOn(process, 'on');

        await startBot({ token: 'test-token' });

        // Verify SIGINT and SIGTERM handlers are registered
        const sigintCalls = onSpy.mock.calls.filter(([sig]) => sig === 'SIGINT');
        const sigtermCalls = onSpy.mock.calls.filter(([sig]) => sig === 'SIGTERM');
        expect(sigintCalls.length).toBeGreaterThan(0);
        expect(sigtermCalls.length).toBeGreaterThan(0);

        // Invoke the shutdown handler (use the SIGINT one)
        const shutdownFn = sigintCalls[sigintCalls.length - 1]![1] as () => Promise<void>;
        await shutdownFn();

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Stopping bot'));
        expect(mockBotStop).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(0);

        onSpy.mockRestore();
      });
    });
  });
});
