import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelManager, createChannelManager } from './manager.js';
import type { ChannelConfig, TelegramConfig, IncomingMessage, OutgoingMessage } from './types/index.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------

const { mockTelegramHandler, mockLog } = vi.hoisted(() => {
  const mockTelegramHandler = {
    type: 'telegram',
    onMessage: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn(() => true),
  };
  return {
    mockTelegramHandler,
    mockLog: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('./telegram/index.js', () => ({
  createTelegramBot: vi.fn(() => mockTelegramHandler),
}));

vi.mock('./log.js', () => ({
  getLog: vi.fn(() => mockLog),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture the async callback registered via handler.onMessage */
function captureOnMessageCallback(): (msg: IncomingMessage) => Promise<void> {
  const call = mockTelegramHandler.onMessage.mock.calls[0];
  if (!call) throw new Error('onMessage was not called on the handler');
  return call[0] as (msg: IncomingMessage) => Promise<void>;
}

function makeTelegramConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    type: 'telegram',
    enabled: true,
    botToken: 'test-token',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'msg-1',
    channel: 'telegram',
    userId: 'user-42',
    chatId: 'chat-99',
    text: 'Hello, agent!',
    timestamp: new Date(),
    raw: {},
    ...overrides,
  };
}

function makeAgent(chatResult: unknown = { ok: true, value: { content: 'Agent reply' } }) {
  return {
    chat: vi.fn().mockResolvedValue(chatResult),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates manager with an empty channels list', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [] });
      expect(manager.getActiveChannels()).toEqual([]);
    });

    it('skips disabled channels', () => {
      const manager = new ChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig({ enabled: false })],
      });
      expect(manager.getActiveChannels()).toEqual([]);
    });

    it('does not call createTelegramBot for disabled channels', async () => {
      const { createTelegramBot } = await import('./telegram/index.js');
      new ChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig({ enabled: false })],
      });
      expect(createTelegramBot).not.toHaveBeenCalled();
    });

    it('creates a handler for the telegram channel type', async () => {
      const { createTelegramBot } = await import('./telegram/index.js');
      const config = makeTelegramConfig();
      new ChannelManager({ agent: makeAgent(), channels: [config] });
      expect(createTelegramBot).toHaveBeenCalledWith(config);
    });

    it('registers the telegram handler in the active channels', () => {
      const manager = new ChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig()],
      });
      expect(manager.getActiveChannels()).toContain('telegram');
    });

    it('calls onMessage to set up the message handler after creation', () => {
      new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      expect(mockTelegramHandler.onMessage).toHaveBeenCalledTimes(1);
      expect(typeof mockTelegramHandler.onMessage.mock.calls[0]?.[0]).toBe('function');
    });

    it('warns and skips unknown channel types', () => {
      const unknownConfig: ChannelConfig = { type: 'discord', enabled: true };
      const manager = new ChannelManager({ agent: makeAgent(), channels: [unknownConfig] });
      expect(mockLog.warn).toHaveBeenCalledWith('Unknown channel type: discord');
      expect(manager.getActiveChannels()).not.toContain('discord');
    });

    it('does not warn for known channel types', () => {
      new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      expect(mockLog.warn).not.toHaveBeenCalled();
    });

    it('handles multiple channels and registers all enabled ones', async () => {
      const { createTelegramBot } = await import('./telegram/index.js');
      // Two telegram configs with different types — test multi-channel
      // We use a second mock handler for the second call
      const secondHandler = {
        type: 'telegram2',
        onMessage: vi.fn(),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isReady: vi.fn(() => true),
      };
      (createTelegramBot as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(mockTelegramHandler)
        .mockReturnValueOnce(secondHandler);

      const manager = new ChannelManager({
        agent: makeAgent(),
        channels: [
          makeTelegramConfig(),
          // Simulate a second enabled telegram config — type overridden to distinguish
          { ...makeTelegramConfig(), type: 'telegram' } as TelegramConfig,
        ],
      });
      // Both enabled; the map key is config.type so the second overwrites the first
      expect(manager.getActiveChannels()).toContain('telegram');
    });

    it('skips only disabled channels when mixed with enabled ones', () => {
      const manager = new ChannelManager({
        agent: makeAgent(),
        channels: [
          makeTelegramConfig({ enabled: false }),
          makeTelegramConfig({ enabled: true }),
        ],
      });
      expect(manager.getActiveChannels()).toEqual(['telegram']);
    });

    it('does not set up message handler for disabled channels', () => {
      new ChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig({ enabled: false })],
      });
      expect(mockTelegramHandler.onMessage).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Message handling — invoke the onMessage callback directly
  // -------------------------------------------------------------------------

  describe('message handling (setupMessageHandler)', () => {
    it('calls agent.chat with the message text for a normal message', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: 'Hello!' }));

      expect(agent.chat).toHaveBeenCalledWith('Hello!');
    });

    it('sends agent response back to the channel', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'Hi there!' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      const msg = makeMessage({ text: 'Hi', chatId: 'chat-1', id: 'msg-a' });

      await onMsg(msg);

      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledWith({
        chatId: 'chat-1',
        text: 'Hi there!',
        replyToMessageId: 'msg-a',
      });
    });

    it('does not call agent.chat for an empty message', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: '' }));

      expect(agent.chat).not.toHaveBeenCalled();
    });

    it('does not send a response for an empty message', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: '' }));

      expect(mockTelegramHandler.sendMessage).not.toHaveBeenCalled();
    });

    it('ignores whitespace-only messages', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: '   \t\n  ' }));

      expect(agent.chat).not.toHaveBeenCalled();
      expect(mockTelegramHandler.sendMessage).not.toHaveBeenCalled();
    });

    it('ignores a message containing only newlines', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: '\n\n\n' }));

      expect(agent.chat).not.toHaveBeenCalled();
    });

    it('sends a "too long" error when message exceeds 32000 chars', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      const longText = 'x'.repeat(32_001);
      const msg = makeMessage({ text: longText, chatId: 'c', id: 'id-1' });

      await onMsg(msg);

      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledWith({
        chatId: 'c',
        text: `Message too long (32001 chars). Please keep messages under 32000 characters.`,
        replyToMessageId: 'id-1',
      });
    });

    it('does not call agent.chat when message is too long', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: 'y'.repeat(32_001) }));

      expect(agent.chat).not.toHaveBeenCalled();
    });

    it('allows a message that is exactly 32000 chars (boundary)', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'ok' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: 'z'.repeat(32_000) }));

      expect(agent.chat).toHaveBeenCalled();
    });

    it('sends a user-friendly error message when agent returns ok: false', async () => {
      const agent = makeAgent({ ok: false, error: { message: 'Provider unavailable' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      const msg = makeMessage({ chatId: 'c2', id: 'id-2' });

      await onMsg(msg);

      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledWith({
        chatId: 'c2',
        text: 'Sorry, I encountered an error processing your request. Please try again.',
        replyToMessageId: 'id-2',
      });
    });

    it('logs the agent error internally when result is ok: false', async () => {
      const agent = makeAgent({ ok: false, error: { message: 'Timeout' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ username: 'alice' }));

      expect(mockLog.error).toHaveBeenCalledWith(
        'Agent error for alice:',
        'Timeout',
      );
    });

    it('uses userId in error log when username is absent and result is ok: false', async () => {
      const agent = makeAgent({ ok: false, error: { message: 'Err' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ username: undefined, userId: 'uid-7' }));

      expect(mockLog.error).toHaveBeenCalledWith('Agent error for uid-7:', 'Err');
    });

    it('sends generic error message when agent.chat throws', async () => {
      const agent = { chat: vi.fn().mockRejectedValue(new Error('Network failure')) };
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      const msg = makeMessage({ chatId: 'c3', id: 'id-3' });

      await onMsg(msg);

      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledWith({
        chatId: 'c3',
        text: 'Sorry, something went wrong while processing your message.',
        replyToMessageId: 'id-3',
      });
    });

    it('logs the thrown error when agent.chat throws', async () => {
      const thrownError = new Error('Crash!');
      const agent = { chat: vi.fn().mockRejectedValue(thrownError) };
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage());

      expect(mockLog.error).toHaveBeenCalledWith('Error processing message', thrownError);
    });

    it('logs sendMessage failure when both agent throws and sendMessage throws', async () => {
      const agentError = new Error('Agent down');
      const sendError = new Error('Network gone');
      const agent = { chat: vi.fn().mockRejectedValue(agentError) };
      mockTelegramHandler.sendMessage.mockRejectedValueOnce(sendError);
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage());

      expect(mockLog.error).toHaveBeenCalledWith('Error processing message', agentError);
      expect(mockLog.error).toHaveBeenCalledWith('Failed to send error response', sendError);
    });

    it('does not propagate when both agent and sendMessage throw (double failure)', async () => {
      const agent = { chat: vi.fn().mockRejectedValue(new Error('a')) };
      mockTelegramHandler.sendMessage.mockRejectedValueOnce(new Error('b'));
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await expect(onMsg(makeMessage())).resolves.toBeUndefined();
    });

    it('truncates display text to 100 chars + ellipsis in the info log', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'ok' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      const longText = 'A'.repeat(150);

      await onMsg(makeMessage({ text: longText, username: 'bob' }));

      const infoArgs = mockLog.info.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Message from'),
      );
      expect(infoArgs).toBeDefined();
      const logLine = infoArgs![0] as string;
      expect(logLine).toContain('A'.repeat(100) + '...');
      expect(logLine).not.toContain('A'.repeat(150));
    });

    it('does not truncate display text when message is exactly 100 chars', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'ok' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      const text = 'B'.repeat(100);

      await onMsg(makeMessage({ text }));

      const infoArgs = mockLog.info.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Message from'),
      );
      const logLine = infoArgs![0] as string;
      expect(logLine).not.toContain('...');
      expect(logLine).toContain('B'.repeat(100));
    });

    it('does not truncate display text when message is under 100 chars', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'ok' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      const text = 'Short message';

      await onMsg(makeMessage({ text }));

      const infoArgs = mockLog.info.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Message from'),
      );
      const logLine = infoArgs![0] as string;
      expect(logLine).not.toContain('...');
    });

    it('logs using username when available', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'hi' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ username: 'charlieUser', userId: 'uid-100' }));

      const infoArgs = mockLog.info.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Message from'),
      );
      expect((infoArgs![0] as string)).toContain('charlieUser');
      expect((infoArgs![0] as string)).not.toContain('uid-100');
    });

    it('falls back to userId in the info log when username is not provided', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'hi' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ username: undefined, userId: 'uid-55' }));

      const infoArgs = mockLog.info.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Message from'),
      );
      expect((infoArgs![0] as string)).toContain('uid-55');
    });

    it('includes the channel type in the info log', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'ok' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage());

      const infoArgs = mockLog.info.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('[telegram]'),
      );
      expect(infoArgs).toBeDefined();
    });

    it('sets the replyToMessageId correctly on success response', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'reply' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ id: 'original-id', chatId: 'chat-xy' }));

      const call = mockTelegramHandler.sendMessage.mock.calls[0] as [OutgoingMessage];
      expect(call[0].replyToMessageId).toBe('original-id');
    });

    it('sets the correct chatId on success response', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'reply' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ chatId: 'my-chat-id' }));

      const call = mockTelegramHandler.sendMessage.mock.calls[0] as [OutgoingMessage];
      expect(call[0].chatId).toBe('my-chat-id');
    });

    it('sets the correct chatId on error response (ok: false)', async () => {
      const agent = makeAgent({ ok: false, error: { message: 'fail' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ chatId: 'error-chat' }));

      const call = mockTelegramHandler.sendMessage.mock.calls[0] as [OutgoingMessage];
      expect(call[0].chatId).toBe('error-chat');
    });

    it('sets the correct chatId on thrown-exception error response', async () => {
      const agent = { chat: vi.fn().mockRejectedValue(new Error('bang')) };
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ chatId: 'throw-chat', id: 'throw-id' }));

      const call = mockTelegramHandler.sendMessage.mock.calls[0] as [OutgoingMessage];
      expect(call[0].chatId).toBe('throw-chat');
      expect(call[0].replyToMessageId).toBe('throw-id');
    });

    it('sends error reply with correct replyToMessageId when result is ok: false', async () => {
      const agent = makeAgent({ ok: false, error: { message: 'fail' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ id: 'err-msg-id' }));

      const call = mockTelegramHandler.sendMessage.mock.calls[0] as [OutgoingMessage];
      expect(call[0].replyToMessageId).toBe('err-msg-id');
    });
  });

  // -------------------------------------------------------------------------
  // 3. start()
  // -------------------------------------------------------------------------

  describe('start()', () => {
    it('calls handler.start() for ready channels', async () => {
      mockTelegramHandler.isReady.mockReturnValue(true);
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await manager.start();

      expect(mockTelegramHandler.start).toHaveBeenCalledTimes(1);
    });

    it('logs "Starting channel: telegram" for ready channel', async () => {
      mockTelegramHandler.isReady.mockReturnValue(true);
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await manager.start();

      expect(mockLog.info).toHaveBeenCalledWith('Starting channel: telegram');
    });

    it('does not call handler.start() when channel is not ready', async () => {
      mockTelegramHandler.isReady.mockReturnValue(false);
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await manager.start();

      expect(mockTelegramHandler.start).not.toHaveBeenCalled();
    });

    it('warns when channel is not ready during start', async () => {
      mockTelegramHandler.isReady.mockReturnValue(false);
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await manager.start();

      expect(mockLog.warn).toHaveBeenCalledWith('Channel telegram is not ready, skipping');
    });

    it('logs "Channel startup complete" after all channels are processed', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await manager.start();

      expect(mockLog.info).toHaveBeenCalledWith('Channel startup complete');
    });

    it('logs "Channel startup complete" even with no channels', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [] });

      await manager.start();

      expect(mockLog.info).toHaveBeenCalledWith('Channel startup complete');
    });

    it('logs error when channel start fails but does not throw', async () => {
      const startError = new Error('Start failed');
      mockTelegramHandler.start.mockRejectedValueOnce(startError);
      mockTelegramHandler.isReady.mockReturnValue(true);
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await expect(manager.start()).resolves.toBeUndefined();
      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to start channel telegram:',
        startError,
      );
    });

    it('still logs startup complete after a channel start failure', async () => {
      mockTelegramHandler.start.mockRejectedValueOnce(new Error('fail'));
      mockTelegramHandler.isReady.mockReturnValue(true);
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await manager.start();

      expect(mockLog.info).toHaveBeenCalledWith('Channel startup complete');
    });

    it('resolves without throwing even if all channels fail to start', async () => {
      mockTelegramHandler.start.mockRejectedValue(new Error('always fails'));
      mockTelegramHandler.isReady.mockReturnValue(true);
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await expect(manager.start()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. stop()
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('calls handler.stop() for all active channels', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await manager.stop();

      expect(mockTelegramHandler.stop).toHaveBeenCalledTimes(1);
    });

    it('logs "Stopping channel: telegram" before stopping', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await manager.stop();

      expect(mockLog.info).toHaveBeenCalledWith('Stopping channel: telegram');
    });

    it('logs "All channels stopped" after completion', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await manager.stop();

      expect(mockLog.info).toHaveBeenCalledWith('All channels stopped');
    });

    it('logs "All channels stopped" when there are no active channels', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [] });

      await manager.stop();

      expect(mockLog.info).toHaveBeenCalledWith('All channels stopped');
    });

    it('logs error when channel stop fails but does not throw', async () => {
      const stopError = new Error('Stop failure');
      mockTelegramHandler.stop.mockRejectedValueOnce(stopError);
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await expect(manager.stop()).resolves.toBeUndefined();
      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to stop channel telegram:',
        stopError,
      );
    });

    it('still logs "All channels stopped" after a stop failure', async () => {
      mockTelegramHandler.stop.mockRejectedValueOnce(new Error('stop fail'));
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await manager.stop();

      expect(mockLog.info).toHaveBeenCalledWith('All channels stopped');
    });

    it('resolves without throwing even if channel stop fails', async () => {
      mockTelegramHandler.stop.mockRejectedValue(new Error('always fails'));
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await expect(manager.stop()).resolves.toBeUndefined();
    });

    it('does not call start when stopping', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      vi.clearAllMocks();

      await manager.stop();

      expect(mockTelegramHandler.start).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. getChannel()
  // -------------------------------------------------------------------------

  describe('getChannel()', () => {
    it('returns the handler for a registered channel type', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      const handler = manager.getChannel('telegram');

      expect(handler).toBe(mockTelegramHandler);
    });

    it('returns undefined for an unknown channel type', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      const handler = manager.getChannel('slack');

      expect(handler).toBeUndefined();
    });

    it('returns undefined when no channels are registered', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [] });

      const handler = manager.getChannel('telegram');

      expect(handler).toBeUndefined();
    });

    it('returns handler for a disabled channel that happens to share a type key — undefined', () => {
      const manager = new ChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig({ enabled: false })],
      });

      expect(manager.getChannel('telegram')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. getActiveChannels()
  // -------------------------------------------------------------------------

  describe('getActiveChannels()', () => {
    it('returns an empty array when no channels are registered', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [] });

      expect(manager.getActiveChannels()).toEqual([]);
    });

    it('returns ["telegram"] when the telegram channel is registered', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      expect(manager.getActiveChannels()).toEqual(['telegram']);
    });

    it('does not include disabled channels', () => {
      const manager = new ChannelManager({
        agent: makeAgent(),
        channels: [
          makeTelegramConfig({ enabled: false }),
        ],
      });

      expect(manager.getActiveChannels()).toEqual([]);
    });

    it('does not include unknown channel types in active channels', () => {
      const manager = new ChannelManager({
        agent: makeAgent(),
        channels: [{ type: 'matrix', enabled: true }],
      });

      expect(manager.getActiveChannels()).not.toContain('matrix');
    });

    it('returns an array (not a Map or Set)', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      const result = manager.getActiveChannels();

      expect(Array.isArray(result)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 7. sendMessage()
  // -------------------------------------------------------------------------

  describe('sendMessage()', () => {
    it('returns true when the channel exists and message is sent', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      const msg: OutgoingMessage = { chatId: 'c', text: 'hi' };

      const result = await manager.sendMessage('telegram', msg);

      expect(result).toBe(true);
    });

    it('calls handler.sendMessage with the exact message object', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      const msg: OutgoingMessage = { chatId: 'chat-123', text: 'Test message', replyToMessageId: 'r-1' };

      await manager.sendMessage('telegram', msg);

      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledWith(msg);
    });

    it('returns false when the channel does not exist', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      const msg: OutgoingMessage = { chatId: 'c', text: 'hi' };

      const result = await manager.sendMessage('slack', msg);

      expect(result).toBe(false);
    });

    it('does not call sendMessage on the handler when channel is unknown', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      mockTelegramHandler.sendMessage.mockClear();

      await manager.sendMessage('unknown-channel', { chatId: 'c', text: 'ignored' });

      expect(mockTelegramHandler.sendMessage).not.toHaveBeenCalled();
    });

    it('returns false with no registered channels', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [] });

      const result = await manager.sendMessage('telegram', { chatId: 'c', text: 't' });

      expect(result).toBe(false);
    });

    it('propagates handler.sendMessage rejection', async () => {
      const sendError = new Error('Send failed');
      mockTelegramHandler.sendMessage.mockRejectedValueOnce(sendError);
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await expect(manager.sendMessage('telegram', { chatId: 'c', text: 't' })).rejects.toThrow('Send failed');
    });
  });

  // -------------------------------------------------------------------------
  // 8. broadcast()
  // -------------------------------------------------------------------------

  describe('broadcast()', () => {
    it('sends to all channels present in the chatIds map', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      const chatIds = new Map([['telegram', 'chat-broadcast']]);

      await manager.broadcast(chatIds, 'Hello everyone!');

      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledWith({
        chatId: 'chat-broadcast',
        text: 'Hello everyone!',
      });
    });

    it('does not call sendMessage for channels missing from the handlers map', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      mockTelegramHandler.sendMessage.mockClear();
      const chatIds = new Map([['slack', 'slack-chat-id']]);

      await manager.broadcast(chatIds, 'Should be skipped');

      expect(mockTelegramHandler.sendMessage).not.toHaveBeenCalled();
    });

    it('resolves without throwing even with an empty chatIds map', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      await expect(manager.broadcast(new Map(), 'empty broadcast')).resolves.toBeUndefined();
    });

    it('resolves without throwing when no channels are registered', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [] });

      await expect(manager.broadcast(new Map([['telegram', 'c']]), 'nothing')).resolves.toBeUndefined();
    });

    it('logs an error and does not throw when a broadcast sendMessage fails', async () => {
      const broadcastError = new Error('Broadcast send failed');
      mockTelegramHandler.sendMessage.mockRejectedValueOnce(broadcastError);
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      const chatIds = new Map([['telegram', 'c']]);

      await expect(manager.broadcast(chatIds, 'test')).resolves.toBeUndefined();
      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to broadcast to telegram:',
        broadcastError,
      );
    });

    it('passes the correct text to every channel in the map', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      const chatIds = new Map([['telegram', 'tg-chat']]);

      await manager.broadcast(chatIds, 'Broadcast text!');

      const call = mockTelegramHandler.sendMessage.mock.calls[0] as [OutgoingMessage];
      expect(call[0].text).toBe('Broadcast text!');
    });

    it('passes the correct chatId to each handler', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      const chatIds = new Map([['telegram', 'specific-chat']]);

      await manager.broadcast(chatIds, 'hi');

      const call = mockTelegramHandler.sendMessage.mock.calls[0] as [OutgoingMessage];
      expect(call[0].chatId).toBe('specific-chat');
    });

    it('skips mixed unknown channels and only sends to known ones', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      mockTelegramHandler.sendMessage.mockClear();
      const chatIds = new Map([
        ['slack', 'slack-chat'],
        ['telegram', 'tg-chat'],
        ['discord', 'dc-chat'],
      ]);

      await manager.broadcast(chatIds, 'mixed broadcast');

      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledWith({
        chatId: 'tg-chat',
        text: 'mixed broadcast',
      });
    });
  });

  // -------------------------------------------------------------------------
  // 9. createChannelManager() factory
  // -------------------------------------------------------------------------

  describe('createChannelManager()', () => {
    it('returns a ChannelManager instance', () => {
      const manager = createChannelManager({ agent: makeAgent(), channels: [] });
      expect(manager).toBeInstanceOf(ChannelManager);
    });

    it('returned manager has the correct active channels', () => {
      const manager = createChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig()],
      });
      expect(manager.getActiveChannels()).toEqual(['telegram']);
    });

    it('returned manager can start channels', async () => {
      const manager = createChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig()],
      });
      await expect(manager.start()).resolves.toBeUndefined();
    });

    it('returned manager can stop channels', async () => {
      const manager = createChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig()],
      });
      await expect(manager.stop()).resolves.toBeUndefined();
    });

    it('each call to createChannelManager returns a distinct instance', () => {
      const a = createChannelManager({ agent: makeAgent(), channels: [] });
      const b = createChannelManager({ agent: makeAgent(), channels: [] });
      expect(a).not.toBe(b);
    });

    it('returned manager exposes sendMessage correctly', async () => {
      const manager = createChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig()],
      });
      const result = await manager.sendMessage('telegram', { chatId: 'c', text: 'hello' });
      expect(result).toBe(true);
    });

    it('returned manager exposes broadcast correctly', async () => {
      const manager = createChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig()],
      });
      await expect(
        manager.broadcast(new Map([['telegram', 'c']]), 'bcast')
      ).resolves.toBeUndefined();
    });

    it('returned manager exposes getChannel correctly', () => {
      const manager = createChannelManager({
        agent: makeAgent(),
        channels: [makeTelegramConfig()],
      });
      expect(manager.getChannel('telegram')).toBe(mockTelegramHandler);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Edge cases & cross-cutting concerns
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles a message of exactly 101 chars being truncated in log', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'ok' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      const text = 'C'.repeat(101);

      await onMsg(makeMessage({ text }));

      const infoArgs = mockLog.info.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Message from'),
      );
      expect((infoArgs![0] as string)).toContain('...');
    });

    it('handles a message of exactly 32001 chars as "too long"', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: 'x'.repeat(32_001) }));

      expect(agent.chat).not.toHaveBeenCalled();
      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledOnce();
    });

    it('does not call agent.chat when message is just whitespace and 32001 chars', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      // Whitespace check comes before length check in source — empty wins
      await onMsg(makeMessage({ text: ' '.repeat(32_001) }));

      expect(agent.chat).not.toHaveBeenCalled();
    });

    it('passes the message text verbatim to agent.chat', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'done' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      const text = 'What is the meaning of life?';

      await onMsg(makeMessage({ text }));

      expect(agent.chat).toHaveBeenCalledWith(text);
    });

    it('agent.chat is called only once per message', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'once' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: 'ping' }));

      expect(agent.chat).toHaveBeenCalledTimes(1);
    });

    it('handler.sendMessage is called exactly once on success', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'reply' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: 'hello' }));

      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('handler.sendMessage is called exactly once on agent ok: false', async () => {
      const agent = makeAgent({ ok: false, error: { message: 'fail' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: 'hello' }));

      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('handler.sendMessage is called exactly once on agent throw', async () => {
      const agent = { chat: vi.fn().mockRejectedValue(new Error('crash')) };
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: 'hello' }));

      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('processes multiple sequential messages independently', async () => {
      const agent = makeAgent({ ok: true, value: { content: 'pong' } });
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: 'first', chatId: 'c1', id: 'm1' }));
      await onMsg(makeMessage({ text: 'second', chatId: 'c2', id: 'm2' }));

      expect(agent.chat).toHaveBeenCalledTimes(2);
      expect(mockTelegramHandler.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('the too-long error message includes the actual character count', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();
      const text = 'A'.repeat(32_500);

      await onMsg(makeMessage({ text }));

      const call = mockTelegramHandler.sendMessage.mock.calls[0] as [OutgoingMessage];
      expect(call[0].text).toContain('32500 chars');
    });

    it('the too-long error message mentions the 32000 character limit', async () => {
      const agent = makeAgent();
      new ChannelManager({ agent, channels: [makeTelegramConfig()] });
      const onMsg = captureOnMessageCallback();

      await onMsg(makeMessage({ text: 'B'.repeat(32_001) }));

      const call = mockTelegramHandler.sendMessage.mock.calls[0] as [OutgoingMessage];
      expect(call[0].text).toContain('32000 characters');
    });

    it('start() does not call stop on any handler', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      mockTelegramHandler.isReady.mockReturnValue(true);
      vi.clearAllMocks();

      await manager.start();

      expect(mockTelegramHandler.stop).not.toHaveBeenCalled();
    });

    it('stop() does not call start on any handler', async () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });
      vi.clearAllMocks();

      await manager.stop();

      expect(mockTelegramHandler.start).not.toHaveBeenCalled();
    });

    it('getActiveChannels returns a fresh snapshot array each time', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      const first = manager.getActiveChannels();
      const second = manager.getActiveChannels();

      expect(first).toEqual(second);
      expect(first).not.toBe(second); // different array instances
    });

    it('sendMessage returns a Promise', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      const result = manager.sendMessage('telegram', { chatId: 'c', text: 't' });

      expect(result).toBeInstanceOf(Promise);
    });

    it('broadcast returns a Promise', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      const result = manager.broadcast(new Map(), 'hi');

      expect(result).toBeInstanceOf(Promise);
    });

    it('start() returns a Promise', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      const result = manager.start();

      expect(result).toBeInstanceOf(Promise);
    });

    it('stop() returns a Promise', () => {
      const manager = new ChannelManager({ agent: makeAgent(), channels: [makeTelegramConfig()] });

      const result = manager.stop();

      expect(result).toBeInstanceOf(Promise);
    });

    it('only the agent assigned at construction is used for chat', async () => {
      const agentA = makeAgent({ ok: true, value: { content: 'from-A' } });
      const agentB = makeAgent({ ok: true, value: { content: 'from-B' } });
      const managerA = new ChannelManager({ agent: agentA, channels: [makeTelegramConfig()] });
      // managerB uses a separate onMessage registration
      vi.clearAllMocks();
      const managerB = new ChannelManager({ agent: agentB, channels: [makeTelegramConfig()] });
      const onMsgB = captureOnMessageCallback();

      await onMsgB(makeMessage({ text: 'test' }));

      expect(agentB.chat).toHaveBeenCalled();
      // agentA should be untouched from managerB's message dispatch
      expect(agentA.chat).not.toHaveBeenCalled();

      // satisfy "no unused var" — access managerA to confirm it's distinct
      expect(managerA).not.toBe(managerB);
    });

    it('multiple unknown channel types each emit their own warn', () => {
      new ChannelManager({
        agent: makeAgent(),
        channels: [
          { type: 'whatsapp', enabled: true },
          { type: 'discord', enabled: true },
        ],
      });

      expect(mockLog.warn).toHaveBeenCalledWith('Unknown channel type: whatsapp');
      expect(mockLog.warn).toHaveBeenCalledWith('Unknown channel type: discord');
      expect(mockLog.warn).toHaveBeenCalledTimes(2);
    });
  });
});
