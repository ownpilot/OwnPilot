/**
 * Tests for Discord Channel API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockEventBus = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEventBus: () => mockEventBus,
    createEvent: vi.fn((_type: string, _cat: string, _src: string, data: unknown) => ({
      type: _type,
      data,
    })),
  };
});

vi.mock('../../../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock discord.js
const mockSend = vi.fn(async () => ({ id: 'sent-msg-001' }));
const mockSendTyping = vi.fn(async () => undefined);
const _mockFetchMessages = vi.fn();
const mockFetchChannel = vi.fn();
const mockLogin = vi.fn(async () => 'token');
const mockDestroy = vi.fn();
const mockFetchUser = vi.fn();

const mockHandlers = new Map<string, (msg: unknown) => void>();

const mockClient = {
  on: vi.fn((event: string, handler: (msg: unknown) => void) => {
    mockHandlers.set(event, handler);
  }),
  once: vi.fn((event: string, handler: () => void) => {
    // Simulate 'ready' event after login
    if (event === 'ready') {
      setTimeout(handler, 10);
    }
  }),
  login: mockLogin,
  destroy: mockDestroy,
  user: { id: '999888777', tag: 'TestBot#0001', username: 'TestBot' },
  channels: {
    fetch: mockFetchChannel,
  },
  users: {
    fetch: mockFetchUser,
  },
};

vi.mock('discord.js', () => ({
  // Must use regular function (not arrow) so `new Client(...)` works
  Client: vi.fn(function () { return mockClient; }),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 512,
    MessageContent: 32768,
    DirectMessages: 4096,
  },
}));

import { DiscordChannelAPI } from './discord-api.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscordChannelAPI', () => {
  let api: DiscordChannelAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandlers.clear();
    api = new DiscordChannelAPI(
      { bot_token: 'test-token-12345' },
      'channel.discord',
    );
  });

  // ==========================================================================
  // Constructor
  // ==========================================================================

  describe('constructor', () => {
    it('should initialize with disconnected status', () => {
      expect(api.getStatus()).toBe('disconnected');
      expect(api.getPlatform()).toBe('discord');
    });

    it('should parse guild_ids from comma-separated string', () => {
      const apiWithGuilds = new DiscordChannelAPI(
        { bot_token: 'token', guild_ids: '111,222,333' },
        'channel.discord',
      );
      expect(apiWithGuilds.getStatus()).toBe('disconnected');
    });

    it('should parse allowed_channels from comma-separated string', () => {
      const apiWithChannels = new DiscordChannelAPI(
        { bot_token: 'token', allowed_channels: '444, 555 , 666' },
        'channel.discord',
      );
      expect(apiWithChannels.getStatus()).toBe('disconnected');
    });
  });

  // ==========================================================================
  // connect
  // ==========================================================================

  describe('connect()', () => {
    it('should throw if bot_token is missing', async () => {
      const noToken = new DiscordChannelAPI({ bot_token: '' }, 'channel.discord');
      await expect(noToken.connect()).rejects.toThrow('Discord bot_token is required');
    });

    it('should connect and set status to connected', async () => {
      await api.connect();
      expect(api.getStatus()).toBe('connected');
      expect(mockLogin).toHaveBeenCalledWith('test-token-12345');
    });

    it('should not reconnect if already connected', async () => {
      await api.connect();
      mockLogin.mockClear();

      await api.connect();
      expect(mockLogin).not.toHaveBeenCalled();
    });

    it('should emit connecting and connected events', async () => {
      await api.connect();

      // Should have emitted at least 'connecting' and 'connected'
      const emitCalls = mockEventBus.emit.mock.calls;
      const eventTypes = emitCalls.map((c: unknown[]) => (c[0] as { type: string }).type);
      expect(eventTypes).toContain('channel.connecting');
      expect(eventTypes).toContain('channel.connected');
    });

    it('should register messageCreate handler', async () => {
      await api.connect();
      expect(mockHandlers.has('messageCreate')).toBe(true);
    });

    it('should set status to error on login failure', async () => {
      mockLogin.mockRejectedValueOnce(new Error('Invalid token'));

      await expect(api.connect()).rejects.toThrow('Invalid token');
      expect(api.getStatus()).toBe('error');
    });
  });

  // ==========================================================================
  // disconnect
  // ==========================================================================

  describe('disconnect()', () => {
    it('should destroy client and set status to disconnected', async () => {
      await api.connect();
      await api.disconnect();

      expect(mockDestroy).toHaveBeenCalled();
      expect(api.getStatus()).toBe('disconnected');
    });

    it('should be safe to call when not connected', async () => {
      await api.disconnect();
      expect(api.getStatus()).toBe('disconnected');
    });

    it('should emit disconnected event', async () => {
      await api.connect();
      mockEventBus.emit.mockClear();

      await api.disconnect();
      const emitCalls = mockEventBus.emit.mock.calls;
      const eventTypes = emitCalls.map((c: unknown[]) => (c[0] as { type: string }).type);
      expect(eventTypes).toContain('channel.disconnected');
    });
  });

  // ==========================================================================
  // sendMessage
  // ==========================================================================

  describe('sendMessage()', () => {
    beforeEach(async () => {
      mockFetchChannel.mockResolvedValue({
        isTextBased: () => true,
        send: mockSend,
        sendTyping: mockSendTyping,
      });
      await api.connect();
    });

    it('should send a message and return message ID', async () => {
      const msgId = await api.sendMessage({
        platformChatId: 'channel-123',
        text: 'Hello Discord!',
      });

      expect(msgId).toBe('sent-msg-001');
      expect(mockFetchChannel).toHaveBeenCalledWith('channel-123');
      expect(mockSend).toHaveBeenCalledWith({ content: 'Hello Discord!' });
    });

    it('should throw if not connected', async () => {
      await api.disconnect();
      await expect(
        api.sendMessage({ platformChatId: 'ch', text: 'hi' }),
      ).rejects.toThrow('Discord client is not connected');
    });

    it('should throw if channel not found', async () => {
      mockFetchChannel.mockResolvedValue(null);
      await expect(
        api.sendMessage({ platformChatId: 'bad-ch', text: 'hi' }),
      ).rejects.toThrow('not found or not text-based');
    });

    it('should throw if channel is not text-based', async () => {
      mockFetchChannel.mockResolvedValue({ isTextBased: () => false });
      await expect(
        api.sendMessage({ platformChatId: 'voice-ch', text: 'hi' }),
      ).rejects.toThrow('not found or not text-based');
    });

    it('should split long messages at 2000 char limit', async () => {
      const longText = 'A'.repeat(3000);
      await api.sendMessage({ platformChatId: 'ch', text: longText });

      expect(mockSend).toHaveBeenCalledTimes(2);
      const firstCall = mockSend.mock.calls[0]![0] as { content: string };
      expect(firstCall.content.length).toBeLessThanOrEqual(2000);
    });

    it('should include reply reference on first part only', async () => {
      await api.sendMessage({
        platformChatId: 'ch',
        text: 'Reply text',
        replyToId: 'channel.discord:original-msg-123',
      });

      expect(mockSend).toHaveBeenCalledWith({
        content: 'Reply text',
        reply: { messageReference: 'original-msg-123' },
      });
    });
  });

  // ==========================================================================
  // getPlatform & getStatus
  // ==========================================================================

  describe('getPlatform()', () => {
    it('should return discord', () => {
      expect(api.getPlatform()).toBe('discord');
    });
  });

  // ==========================================================================
  // sendTyping
  // ==========================================================================

  describe('sendTyping()', () => {
    it('should call sendTyping on channel', async () => {
      mockFetchChannel.mockResolvedValue({
        isTextBased: () => true,
        send: mockSend,
        sendTyping: mockSendTyping,
      });
      await api.connect();

      await api.sendTyping!('channel-123');
      expect(mockSendTyping).toHaveBeenCalled();
    });

    it('should not throw when not connected', async () => {
      await expect(api.sendTyping!('ch')).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // resolveUser
  // ==========================================================================

  describe('resolveUser()', () => {
    it('should return null when not connected', async () => {
      const user = await api.resolveUser!('123');
      expect(user).toBeNull();
    });

    it('should return user info when connected', async () => {
      await api.connect();
      mockFetchUser.mockResolvedValue({
        id: '123',
        displayName: 'Test User',
        username: 'testuser',
        avatarURL: () => 'https://cdn.discord.com/avatar.png',
        bot: false,
      });

      const user = await api.resolveUser!('123');
      expect(user).toEqual({
        platformUserId: '123',
        platform: 'discord',
        displayName: 'Test User',
        username: 'testuser',
        avatarUrl: 'https://cdn.discord.com/avatar.png',
        isBot: false,
      });
    });

    it('should return null if user fetch fails', async () => {
      await api.connect();
      mockFetchUser.mockRejectedValue(new Error('Unknown user'));

      const user = await api.resolveUser!('bad-id');
      expect(user).toBeNull();
    });
  });
});
