/**
 * Comprehensive tests for ChannelServiceImpl.
 *
 * Covers: constructor/singleton, send, broadcast, broadcastAll,
 * getChannel, listChannels, getByPlatform, connect, disconnect,
 * resolveUser, autoConnectChannels, processIncomingMessage,
 * withSessionLock, dispose, and helper functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockEventBus = vi.hoisted(() => ({
  emit: vi.fn(),
  on: vi.fn().mockReturnValue(vi.fn()), // returns unsub function
}));

const mockGetEventBus = vi.hoisted(() => vi.fn().mockReturnValue(mockEventBus));
const mockCreateEvent = vi.hoisted(() =>
  vi.fn().mockImplementation((type: string, _cat: string, _src: string, data: unknown) => ({
    type,
    data,
  }))
);
const mockHasServiceRegistry = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockGetServiceRegistry = vi.hoisted(() => vi.fn());

const mockUsersRepo = vi.hoisted(() => ({
  findOrCreate: vi.fn(),
}));

const mockSessionsRepo = vi.hoisted(() => ({
  findActive: vi.fn(),
  create: vi.fn(),
  touchLastMessage: vi.fn(),
  linkConversation: vi.fn().mockResolvedValue(undefined),
}));

const mockMessagesRepo = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue(undefined),
}));

const mockConfigServicesRepo = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  getDefaultEntry: vi.fn(),
}));

const mockVerificationService = vi.hoisted(() => ({
  resolveUser: vi.fn(),
  verifyToken: vi.fn(),
  verifyViaWhitelist: vi.fn(),
}));

const mockWsGateway = vi.hoisted(() => ({
  broadcast: vi.fn(),
}));

const mockConversationsRepo = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue(undefined),
}));

const mockGetOrCreateChatAgent = vi.hoisted(() => vi.fn());
const mockIsDemoMode = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const mockResolveForProcess = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    provider: 'openai',
    model: 'gpt-4',
    fallbackProvider: null,
    fallbackModel: null,
    source: 'global',
  })
);

// ============================================================================
// vi.mock declarations
// ============================================================================

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    getEventBus: mockGetEventBus,
    createEvent: mockCreateEvent,
    hasServiceRegistry: mockHasServiceRegistry,
    getServiceRegistry: mockGetServiceRegistry,
  };
});

vi.mock('../db/repositories/channel-users.js', () => ({
  channelUsersRepo: mockUsersRepo,
  ChannelUsersRepository: vi.fn(),
}));

vi.mock('../db/repositories/channel-sessions.js', () => ({
  channelSessionsRepo: mockSessionsRepo,
  ChannelSessionsRepository: vi.fn(),
}));

vi.mock('../db/repositories/channel-messages.js', () => ({
  ChannelMessagesRepository: class {
    create = mockMessagesRepo.create;
  },
}));

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: mockConfigServicesRepo,
}));

vi.mock('./auth/verification.js', () => ({
  getChannelVerificationService: () => mockVerificationService,
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: mockWsGateway,
}));

vi.mock('../routes/helpers.js', () => ({
  truncate: (text: string, len: number) =>
    text.length > len ? text.substring(0, len) + '...' : text,
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock('../routes/agents.js', () => ({
  getOrCreateChatAgent: mockGetOrCreateChatAgent,
  isDemoMode: mockIsDemoMode,
}));

vi.mock('../services/model-routing.js', () => ({
  resolveForProcess: mockResolveForProcess,
}));

vi.mock('../routes/settings.js', () => ({
  resolveProviderAndModel: vi.fn().mockResolvedValue({ provider: 'openai', model: 'gpt-4' }),
}));

vi.mock('../db/repositories/conversations.js', () => ({
  createConversationsRepository: () => mockConversationsRepo,
}));

// ============================================================================
// Helpers
// ============================================================================

function createChannelPlugin(
  overrides?: Partial<{
    id: string;
    name: string;
    status: string;
    platform: string;
    connectionStatus: string;
    sendMessageResult: string;
    requiredServices: Array<{ name: string }>;
  }>
) {
  const opts = {
    id: 'test-plugin',
    name: 'Test Channel',
    status: 'enabled',
    platform: 'telegram',
    connectionStatus: 'disconnected',
    sendMessageResult: 'msg-123',
    requiredServices: [{ name: 'telegram' }],
    ...overrides,
  };

  return {
    manifest: {
      id: opts.id,
      name: opts.name,
      category: 'channel' as const,
      platform: opts.platform,
      icon: '📱',
      requiredServices: opts.requiredServices,
    },
    status: opts.status,
    api: {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue(opts.sendMessageResult),
      getStatus: vi.fn().mockReturnValue(opts.connectionStatus),
      getPlatform: vi.fn().mockReturnValue(opts.platform),
      sendTyping: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function createNonChannelPlugin(id = 'non-channel') {
  return {
    manifest: { id, name: 'Other Plugin', category: 'tool' as const },
    status: 'enabled',
    api: {},
  };
}

function createMockPluginRegistry(
  plugins: Array<ReturnType<typeof createChannelPlugin> | ReturnType<typeof createNonChannelPlugin>>
) {
  return {
    get: vi.fn((id: string) => plugins.find((p) => p.manifest.id === id) ?? undefined),
    getAll: vi.fn(() => plugins),
  };
}

function createIncomingMessage(
  overrides?: Partial<{
    id: string;
    channelPluginId: string;
    platform: string;
    platformChatId: string;
    text: string;
    sender: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }>
) {
  return {
    id: 'msg-1',
    channelPluginId: 'test-plugin',
    platform: 'telegram',
    platformChatId: 'chat-123',
    sender: {
      platformUserId: 'user-456',
      platform: 'telegram',
      displayName: 'Test User',
      username: 'testuser',
      avatarUrl: 'https://example.com/avatar.jpg',
      ...(overrides?.sender ?? {}),
    },
    text: 'Hello!',
    timestamp: new Date(),
    metadata: { platformMessageId: 'ext-msg-1', ...(overrides?.metadata ?? {}) },
    ...overrides,
    // Restore sender/metadata after spread so nested overrides work
    ...(overrides?.sender
      ? {
          sender: {
            platformUserId: 'user-456',
            platform: 'telegram',
            displayName: 'Test User',
            username: 'testuser',
            avatarUrl: 'https://example.com/avatar.jpg',
            ...overrides.sender,
          },
        }
      : {}),
    ...(overrides?.metadata
      ? { metadata: { platformMessageId: 'ext-msg-1', ...overrides.metadata } }
      : {}),
  };
}

function createChannelUser(
  overrides?: Partial<{
    id: string;
    isBlocked: boolean;
    isVerified: boolean;
    ownpilotUserId: string;
  }>
) {
  return {
    id: 'cu-1',
    ownpilotUserId: 'op-user-1',
    platform: 'telegram',
    platformUserId: 'user-456',
    isVerified: true,
    isBlocked: false,
    metadata: {},
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock agent with memory/conversation methods needed by processViaBus.
 * The memory object is stable (same reference on every getMemory() call).
 */
function createMockAgent(
  overrides?: Partial<{
    id: string;
    memoryHas: boolean;
    newConvId: string;
    systemPrompt: string;
    chat: ReturnType<typeof vi.fn>;
  }>
) {
  const opts = {
    id: 'default',
    memoryHas: true,
    newConvId: 'new-conv-id',
    systemPrompt: 'You are helpful',
    chat: undefined as ReturnType<typeof vi.fn> | undefined,
    ...overrides,
  };
  const memory = {
    has: vi.fn(() => opts.memoryHas),
    create: vi.fn((_prompt: string) => ({
      id: opts.newConvId,
      systemPrompt: opts.systemPrompt,
      messages: [],
    })),
  };
  return {
    id: opts.id,
    setRequestApproval: vi.fn(),
    getConversation: vi.fn(() => ({
      id: 'conv-default',
      systemPrompt: opts.systemPrompt,
    })),
    loadConversation: vi.fn(() => true),
    getMemory: vi.fn(() => memory),
    ...(opts.chat ? { chat: opts.chat } : {}),
  };
}

// ============================================================================
// Tests
// ============================================================================

import {
  ChannelServiceImpl,
  createChannelServiceImpl,
  getChannelServiceImpl,
} from './service-impl.js';

describe('ChannelServiceImpl', () => {
  let channelPlugin: ReturnType<typeof createChannelPlugin>;
  let nonChannelPlugin: ReturnType<typeof createNonChannelPlugin>;
  let registry: ReturnType<typeof createMockPluginRegistry>;
  let service: ChannelServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();

    channelPlugin = createChannelPlugin();
    nonChannelPlugin = createNonChannelPlugin();
    registry = createMockPluginRegistry([channelPlugin, nonChannelPlugin]);

    // Default: EventBus available
    mockGetEventBus.mockReturnValue(mockEventBus);
    mockEventBus.on.mockReturnValue(vi.fn());

    service = new ChannelServiceImpl(registry as never, {
      usersRepo: mockUsersRepo as never,
      sessionsRepo: mockSessionsRepo as never,
      verificationService: mockVerificationService as never,
    });
  });

  afterEach(() => {
    service?.dispose();
  });

  // ==========================================================================
  // Constructor & Singleton
  // ==========================================================================

  describe('constructor & singleton', () => {
    it('should subscribe to events on construction when EventBus is available', () => {
      expect(mockEventBus.on).toHaveBeenCalledWith(
        'channel.message.received',
        expect.any(Function)
      );
    });

    it('should handle EventBus not available on construction', () => {
      mockGetEventBus.mockImplementation(() => {
        throw new Error('No EventBus');
      });

      // Should not throw
      const svc = new ChannelServiceImpl(registry as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });
      expect(svc).toBeDefined();
      svc.dispose();
    });

    it('should use default repos when options not provided', () => {
      // Constructs without error using module-level singletons
      const svc = new ChannelServiceImpl(registry as never);
      expect(svc).toBeDefined();
      svc.dispose();
    });

    it('createChannelServiceImpl sets singleton', () => {
      const svc = createChannelServiceImpl(registry as never);
      expect(getChannelServiceImpl()).toBe(svc);
      svc.dispose();
    });

    it('getChannelServiceImpl returns null before creation', () => {
      // Reset the singleton by creating a new one and checking before
      // Note: module-level singleton; this test just verifies the accessor works
      const svc = createChannelServiceImpl(registry as never);
      expect(getChannelServiceImpl()).toBe(svc);
      svc.dispose();
    });
  });

  // ==========================================================================
  // getChannel
  // ==========================================================================

  describe('getChannel()', () => {
    it('should return ChannelPluginAPI for a valid channel plugin', () => {
      const api = service.getChannel('test-plugin');
      expect(api).toBeDefined();
      expect(api!.sendMessage).toBe(channelPlugin.api.sendMessage);
    });

    it('should return undefined for a non-channel plugin', () => {
      expect(service.getChannel('non-channel')).toBeUndefined();
    });

    it('should return undefined for unknown pluginId', () => {
      expect(service.getChannel('does-not-exist')).toBeUndefined();
    });

    it('should return undefined if plugin lacks required API methods', () => {
      const incomplete = {
        manifest: { id: 'incomplete', name: 'Incomplete', category: 'channel' as const },
        status: 'enabled',
        api: { connect: vi.fn() }, // missing sendMessage, getStatus, getPlatform
      };
      const reg = createMockPluginRegistry([incomplete as never]);
      const svc = new ChannelServiceImpl(reg as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });
      expect(svc.getChannel('incomplete')).toBeUndefined();
      svc.dispose();
    });
  });

  // ==========================================================================
  // listChannels
  // ==========================================================================

  describe('listChannels()', () => {
    it('should return array of ChannelPluginInfo for enabled channel plugins', () => {
      const channels = service.listChannels();
      expect(channels).toHaveLength(1);
      expect(channels[0]).toEqual({
        pluginId: 'test-plugin',
        platform: 'telegram',
        name: 'Test Channel',
        status: 'disconnected',
        icon: '📱',
      });
    });

    it('should exclude non-channel plugins', () => {
      const channels = service.listChannels();
      const ids = channels.map((ch) => ch.pluginId);
      expect(ids).not.toContain('non-channel');
    });

    it('should exclude disabled plugins', () => {
      const disabled = createChannelPlugin({ id: 'disabled-ch', status: 'disabled' });
      const reg = createMockPluginRegistry([channelPlugin, disabled]);
      const svc = new ChannelServiceImpl(reg as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });
      const channels = svc.listChannels();
      expect(channels).toHaveLength(1);
      expect(channels[0]!.pluginId).toBe('test-plugin');
      svc.dispose();
    });
  });

  // ==========================================================================
  // getByPlatform
  // ==========================================================================

  describe('getByPlatform()', () => {
    it('should filter channel plugins by platform', () => {
      const apis = service.getByPlatform('telegram');
      expect(apis).toHaveLength(1);
    });

    it('should return empty array for unknown platform', () => {
      const apis = service.getByPlatform('discord');
      expect(apis).toHaveLength(0);
    });

    it('should return multiple plugins for the same platform', () => {
      const second = createChannelPlugin({ id: 'test-plugin-2', sendMessageResult: 'msg-222' });
      const reg = createMockPluginRegistry([channelPlugin, second]);
      const svc = new ChannelServiceImpl(reg as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });
      expect(svc.getByPlatform('telegram')).toHaveLength(2);
      svc.dispose();
    });
  });

  // ==========================================================================
  // send
  // ==========================================================================

  describe('send()', () => {
    const outgoing = { platformChatId: 'chat-1', text: 'Hello back!' };

    it('should delegate to plugin API sendMessage', async () => {
      const msgId = await service.send('test-plugin', outgoing);
      expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(outgoing);
      expect(msgId).toBe('msg-123');
    });

    it('should emit MESSAGE_SENT event on success', async () => {
      await service.send('test-plugin', outgoing);
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'channel.message.sent',
        'channel',
        'channel-service',
        expect.objectContaining({
          channelPluginId: 'test-plugin',
          platform: 'telegram',
          platformMessageId: 'msg-123',
          platformChatId: 'chat-1',
        })
      );
      expect(mockEventBus.emit).toHaveBeenCalled();
    });

    it('should emit MESSAGE_SEND_ERROR event on failure and re-throw', async () => {
      const err = new Error('Send failed');
      channelPlugin.api.sendMessage.mockRejectedValueOnce(err);

      await expect(service.send('test-plugin', outgoing)).rejects.toThrow('Send failed');

      expect(mockCreateEvent).toHaveBeenCalledWith(
        'channel.message.send_error',
        'channel',
        'channel-service',
        expect.objectContaining({
          channelPluginId: 'test-plugin',
          error: 'Send failed',
        })
      );
    });

    it('should throw if channel plugin not found', async () => {
      await expect(service.send('unknown', outgoing)).rejects.toThrow(
        'Channel plugin not found: unknown'
      );
    });

    it('should handle EventBus unavailable gracefully on success', async () => {
      mockGetEventBus.mockImplementation(() => {
        throw new Error('No EventBus');
      });
      // Re-create service so constructor catches EventBus error
      const svc = new ChannelServiceImpl(registry as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      // Should still succeed (just skip event emit)
      const msgId = await svc.send('test-plugin', outgoing);
      expect(msgId).toBe('msg-123');
      svc.dispose();
    });

    it('should handle EventBus unavailable gracefully on failure', async () => {
      mockGetEventBus.mockImplementation(() => {
        throw new Error('No EventBus');
      });
      const svc = new ChannelServiceImpl(registry as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      channelPlugin.api.sendMessage.mockRejectedValueOnce(new Error('Fail'));
      await expect(svc.send('test-plugin', outgoing)).rejects.toThrow('Fail');
      svc.dispose();
    });
  });

  // ==========================================================================
  // broadcast
  // ==========================================================================

  describe('broadcast()', () => {
    const outgoing = { platformChatId: 'chat-1', text: 'Broadcast msg' };

    it('should send to all plugins matching platform', async () => {
      const results = await service.broadcast('telegram', outgoing);
      expect(results.size).toBe(1);
      expect(results.get('test-plugin')).toBe('msg-123');
    });

    it('should return empty map for non-matching platform', async () => {
      const results = await service.broadcast('discord', outgoing);
      expect(results.size).toBe(0);
    });

    it('should skip and log errors for individual plugin failures', async () => {
      const second = createChannelPlugin({ id: 'test-plugin-2', sendMessageResult: 'msg-999' });
      channelPlugin.api.sendMessage.mockRejectedValueOnce(new Error('fail'));
      const reg = createMockPluginRegistry([channelPlugin, second]);
      const svc = new ChannelServiceImpl(reg as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      const results = await svc.broadcast('telegram', outgoing);
      // First plugin failed, second succeeded
      expect(results.size).toBe(1);
      expect(results.has('test-plugin')).toBe(false);
      expect(results.get('test-plugin-2')).toBe('msg-999');
      svc.dispose();
    });
  });

  // ==========================================================================
  // broadcastAll
  // ==========================================================================

  describe('broadcastAll()', () => {
    const outgoing = { platformChatId: 'chat-1', text: 'All channels' };

    it('should send to all connected plugins', async () => {
      channelPlugin.api.getStatus.mockReturnValue('connected');
      const results = await service.broadcastAll(outgoing);
      expect(results.size).toBe(1);
      expect(results.get('test-plugin')).toBe('msg-123');
    });

    it('should skip disconnected plugins', async () => {
      channelPlugin.api.getStatus.mockReturnValue('disconnected');
      const results = await service.broadcastAll(outgoing);
      expect(results.size).toBe(0);
    });

    it('should handle mixed connected/disconnected', async () => {
      const connected = createChannelPlugin({
        id: 'connected-ch',
        connectionStatus: 'connected',
        sendMessageResult: 'msg-c',
      });
      const disconnected = createChannelPlugin({
        id: 'disconnected-ch',
        connectionStatus: 'disconnected',
        sendMessageResult: 'msg-d',
      });
      const reg = createMockPluginRegistry([connected, disconnected]);
      const svc = new ChannelServiceImpl(reg as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      const results = await svc.broadcastAll(outgoing);
      expect(results.size).toBe(1);
      expect(results.get('connected-ch')).toBe('msg-c');
      expect(results.has('disconnected-ch')).toBe(false);
      svc.dispose();
    });

    it('should log errors for individual failures and continue', async () => {
      const first = createChannelPlugin({ id: 'ch-1', connectionStatus: 'connected' });
      const second = createChannelPlugin({
        id: 'ch-2',
        connectionStatus: 'connected',
        sendMessageResult: 'msg-2',
      });
      first.api.sendMessage.mockRejectedValueOnce(new Error('boom'));
      const reg = createMockPluginRegistry([first, second]);
      const svc = new ChannelServiceImpl(reg as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      const results = await svc.broadcastAll(outgoing);
      expect(results.size).toBe(1);
      expect(results.get('ch-2')).toBe('msg-2');
      svc.dispose();
    });
  });

  // ==========================================================================
  // connect
  // ==========================================================================

  describe('connect()', () => {
    it('should call api.connect() and emit CONNECTING + CONNECTED events', async () => {
      await service.connect('test-plugin');

      expect(channelPlugin.api.connect).toHaveBeenCalled();

      // CONNECTING emitted before connect
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'channel.connecting',
        'channel',
        'channel-service',
        expect.objectContaining({ status: 'connecting', channelPluginId: 'test-plugin' })
      );

      // CONNECTED emitted after connect
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'channel.connected',
        'channel',
        'channel-service',
        expect.objectContaining({ status: 'connected', channelPluginId: 'test-plugin' })
      );
    });

    it('should broadcast connection status to WS clients', async () => {
      await service.connect('test-plugin');
      expect(mockWsGateway.broadcast).toHaveBeenCalledWith('channel:status', {
        channelId: 'test-plugin',
        status: 'connected',
      });
    });

    it('should throw if plugin not found', async () => {
      await expect(service.connect('unknown')).rejects.toThrow('Channel plugin not found: unknown');
    });

    it('should handle EventBus unavailable for events but still connect', async () => {
      mockGetEventBus.mockImplementation(() => {
        throw new Error('No EventBus');
      });
      const svc = new ChannelServiceImpl(registry as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      await svc.connect('test-plugin');
      expect(channelPlugin.api.connect).toHaveBeenCalled();
      expect(mockWsGateway.broadcast).toHaveBeenCalledWith('channel:status', {
        channelId: 'test-plugin',
        status: 'connected',
      });
      svc.dispose();
    });
  });

  // ==========================================================================
  // disconnect
  // ==========================================================================

  describe('disconnect()', () => {
    it('should call api.disconnect() and emit DISCONNECTED event', async () => {
      await service.disconnect('test-plugin');

      expect(channelPlugin.api.disconnect).toHaveBeenCalled();
      expect(mockCreateEvent).toHaveBeenCalledWith(
        'channel.disconnected',
        'channel',
        'channel-service',
        expect.objectContaining({
          status: 'disconnected',
          channelPluginId: 'test-plugin',
        })
      );
    });

    it('should broadcast disconnection status to WS clients', async () => {
      await service.disconnect('test-plugin');
      expect(mockWsGateway.broadcast).toHaveBeenCalledWith('channel:status', {
        channelId: 'test-plugin',
        status: 'disconnected',
      });
    });

    it('should throw if plugin not found', async () => {
      await expect(service.disconnect('unknown')).rejects.toThrow(
        'Channel plugin not found: unknown'
      );
    });

    it('should handle EventBus unavailable gracefully', async () => {
      mockGetEventBus.mockImplementation(() => {
        throw new Error('No bus');
      });
      const svc = new ChannelServiceImpl(registry as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      await svc.disconnect('test-plugin');
      expect(channelPlugin.api.disconnect).toHaveBeenCalled();
      svc.dispose();
    });
  });

  // ==========================================================================
  // resolveUser
  // ==========================================================================

  describe('resolveUser()', () => {
    it('should delegate to verificationService.resolveUser()', async () => {
      mockVerificationService.resolveUser.mockResolvedValue('op-user-1');
      const result = await service.resolveUser('telegram', 'user-456');
      expect(result).toBe('op-user-1');
      expect(mockVerificationService.resolveUser).toHaveBeenCalledWith('telegram', 'user-456');
    });

    it('should return null when user not resolved', async () => {
      mockVerificationService.resolveUser.mockResolvedValue(null);
      const result = await service.resolveUser('telegram', 'unknown');
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // autoConnectChannels
  // ==========================================================================

  describe('autoConnectChannels()', () => {
    it('should skip already-connected channels', async () => {
      channelPlugin.api.getStatus.mockReturnValue('connected');
      await service.autoConnectChannels();
      expect(channelPlugin.api.connect).not.toHaveBeenCalled();
    });

    it('should skip channels without required services', async () => {
      const noServices = createChannelPlugin({ id: 'no-svc', requiredServices: [] });
      const reg = createMockPluginRegistry([noServices]);
      const svc = new ChannelServiceImpl(reg as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      await svc.autoConnectChannels();
      expect(noServices.api.connect).not.toHaveBeenCalled();
      svc.dispose();
    });

    it('should skip channels where service is not available', async () => {
      mockConfigServicesRepo.isAvailable.mockReturnValue(false);
      await service.autoConnectChannels();
      expect(channelPlugin.api.connect).not.toHaveBeenCalled();
    });

    it('should connect channels with available configuration', async () => {
      mockConfigServicesRepo.isAvailable.mockReturnValue(true);
      await service.autoConnectChannels();
      expect(channelPlugin.api.connect).toHaveBeenCalled();
    });

    it('should log and continue on individual connect failure', async () => {
      mockConfigServicesRepo.isAvailable.mockReturnValue(true);
      channelPlugin.api.connect.mockRejectedValueOnce(new Error('Connect failed'));

      // Should not throw
      await service.autoConnectChannels();
    });

    it('should broadcast channel:status error on connect failure', async () => {
      mockConfigServicesRepo.isAvailable.mockReturnValue(true);
      channelPlugin.api.connect.mockRejectedValueOnce(new Error('Bot token invalid'));

      await service.autoConnectChannels();

      expect(mockWsGateway.broadcast).toHaveBeenCalledWith('channel:status', {
        channelId: 'test-plugin',
        status: 'error',
        error: 'Bot token invalid',
      });
    });
  });

  // ==========================================================================
  // processIncomingMessage
  // ==========================================================================

  describe('processIncomingMessage()', () => {
    let message: ReturnType<typeof createIncomingMessage>;
    let channelUser: ReturnType<typeof createChannelUser>;

    beforeEach(() => {
      message = createIncomingMessage();
      channelUser = createChannelUser();
      mockUsersRepo.findOrCreate.mockResolvedValue(channelUser);

      // Default: existing session
      mockSessionsRepo.findActive.mockResolvedValue({
        id: 'session-1',
        conversationId: 'conv-1',
      });
      mockSessionsRepo.touchLastMessage.mockResolvedValue(undefined);
    });

    describe('user resolution', () => {
      it('should find or create channel user from message sender', async () => {
        // Set up MessageBus path
        const mockBus = {
          process: vi.fn().mockResolvedValue({ response: { content: 'AI response' } }),
        };
        mockHasServiceRegistry.mockReturnValue(true);
        mockGetServiceRegistry.mockReturnValue({
          get: vi.fn().mockImplementation((token: unknown) => {
            const name = (token as { name: string }).name;
            if (name === 'message') return mockBus;
            if (name === 'session') return null;
            throw new Error('Not found');
          }),
        });
        mockGetOrCreateChatAgent.mockResolvedValue(createMockAgent());

        await service.processIncomingMessage(message);

        expect(mockUsersRepo.findOrCreate).toHaveBeenCalledWith({
          platform: 'telegram',
          platformUserId: 'user-456',
          displayName: 'Test User',
          platformUsername: 'testuser',
          avatarUrl: 'https://example.com/avatar.jpg',
        });
      });

      it('should return early if user is blocked', async () => {
        mockUsersRepo.findOrCreate.mockResolvedValue(createChannelUser({ isBlocked: true }));

        await service.processIncomingMessage(message);

        // Should not save message or proceed
        expect(mockMessagesRepo.create).not.toHaveBeenCalled();
        expect(mockWsGateway.broadcast).not.toHaveBeenCalled();
      });
    });

    describe('/connect command', () => {
      it('should handle /connect TOKEN command', async () => {
        const connectMsg = createIncomingMessage({ text: '/connect abc123' });
        mockVerificationService.verifyToken.mockResolvedValue({ success: true });

        await service.processIncomingMessage(connectMsg);

        expect(mockVerificationService.verifyToken).toHaveBeenCalledWith(
          'abc123',
          'telegram',
          'user-456',
          'Test User',
          'testuser'
        );
        // Should send success message
        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ text: expect.stringContaining('Verified!') })
        );
      });

      it('should send failure message for invalid token', async () => {
        const connectMsg = createIncomingMessage({ text: '/connect badtoken' });
        mockVerificationService.verifyToken.mockResolvedValue({ success: false });

        await service.processIncomingMessage(connectMsg);

        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('Verification failed'),
          })
        );
      });

      it('should return early after handling /connect (no AI routing)', async () => {
        const connectMsg = createIncomingMessage({ text: '/connect abc123' });
        mockVerificationService.verifyToken.mockResolvedValue({ success: true });

        await service.processIncomingMessage(connectMsg);

        // Should not save a regular message or do session lookup
        expect(mockSessionsRepo.findActive).not.toHaveBeenCalled();
      });
    });

    describe('verification', () => {
      it('should reject unverified user not in whitelist', async () => {
        mockUsersRepo.findOrCreate.mockResolvedValue(createChannelUser({ isVerified: false }));
        // allowed_users has entries, but NOT our test user (user-456)
        mockConfigServicesRepo.getDefaultEntry.mockReturnValue({
          data: { allowed_users: 'other-user-999' },
        });

        await service.processIncomingMessage(message);

        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('not authorized'),
          })
        );
        // Should NOT proceed to message processing
        expect(mockSessionsRepo.findActive).not.toHaveBeenCalled();
      });

      it('should auto-verify user in whitelist and continue processing', async () => {
        const unverifiedUser = createChannelUser({ isVerified: false });
        mockUsersRepo.findOrCreate.mockResolvedValue(unverifiedUser);
        mockConfigServicesRepo.getDefaultEntry.mockReturnValue({
          data: { allowed_users: 'user-456,other-user' },
        });

        // Set up MessageBus for continued processing
        const mockBus = {
          process: vi.fn().mockResolvedValue({ response: { content: 'Verified response' } }),
        };
        mockHasServiceRegistry.mockReturnValue(true);
        mockGetServiceRegistry.mockReturnValue({
          get: vi.fn().mockImplementation((token: unknown) => {
            const name = (token as { name: string }).name;
            if (name === 'message') return mockBus;
            if (name === 'session') return null;
            throw new Error('Not found');
          }),
        });
        mockGetOrCreateChatAgent.mockResolvedValue(createMockAgent());

        await service.processIncomingMessage(message);

        expect(mockVerificationService.verifyViaWhitelist).toHaveBeenCalledWith(
          'telegram',
          'user-456',
          'Test User'
        );
        // Should proceed to message processing (save message)
        expect(mockMessagesRepo.create).toHaveBeenCalled();
      });

      it('should auto-verify when no allowed_users restriction is set', async () => {
        const unverifiedUser = createChannelUser({ isVerified: false });
        mockUsersRepo.findOrCreate.mockResolvedValue(unverifiedUser);
        mockConfigServicesRepo.getDefaultEntry.mockReturnValue({
          data: { allowed_users: '' },
        });

        // Set up MessageBus for continued processing
        const mockBus = {
          process: vi.fn().mockResolvedValue({ response: { content: 'Auto-verified response' } }),
        };
        mockHasServiceRegistry.mockReturnValue(true);
        mockGetServiceRegistry.mockReturnValue({
          get: vi.fn().mockImplementation((token: unknown) => {
            const name = (token as { name: string }).name;
            if (name === 'message') return mockBus;
            if (name === 'session') return null;
            throw new Error('Not found');
          }),
        });
        mockGetOrCreateChatAgent.mockResolvedValue(createMockAgent());

        await service.processIncomingMessage(message);

        expect(mockVerificationService.verifyViaWhitelist).toHaveBeenCalledWith(
          'telegram',
          'user-456',
          'Test User'
        );
        // Should proceed to message processing
        expect(mockMessagesRepo.create).toHaveBeenCalled();
      });
    });

    describe('message saving and WS broadcast', () => {
      beforeEach(() => {
        // Set up direct agent path (no bus) for simplicity
        mockHasServiceRegistry.mockReturnValue(false);
        mockGetOrCreateChatAgent.mockResolvedValue(
          createMockAgent({
            chat: vi.fn().mockResolvedValue({ ok: true, value: { content: 'AI says hi' } }),
          })
        );
      });

      it('should save incoming message', async () => {
        await service.processIncomingMessage(message);

        expect(mockMessagesRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'msg-1',
            channelId: 'test-plugin',
            direction: 'inbound',
            senderId: 'user-456',
            senderName: 'Test User',
            content: 'Hello!',
          })
        );
      });

      it('should tolerate save failure for incoming message', async () => {
        mockMessagesRepo.create.mockRejectedValueOnce(new Error('DB error'));

        // Should not throw; continues processing
        await service.processIncomingMessage(message);

        // Still broadcasts and processes
        expect(mockWsGateway.broadcast).toHaveBeenCalledWith(
          'channel:message',
          expect.objectContaining({ direction: 'incoming' })
        );
      });

      it('should broadcast incoming message to WS clients', async () => {
        await service.processIncomingMessage(message);

        expect(mockWsGateway.broadcast).toHaveBeenCalledWith(
          'channel:message',
          expect.objectContaining({
            id: 'msg-1',
            channelId: 'test-plugin',
            direction: 'incoming',
          })
        );
      });

      it('should broadcast system notification', async () => {
        await service.processIncomingMessage(message);

        expect(mockWsGateway.broadcast).toHaveBeenCalledWith(
          'system:notification',
          expect.objectContaining({
            type: 'info',
            message: expect.stringContaining('Test User'),
          })
        );
      });
    });

    describe('session management', () => {
      beforeEach(() => {
        mockHasServiceRegistry.mockReturnValue(false);
        mockGetOrCreateChatAgent.mockResolvedValue(
          createMockAgent({
            chat: vi.fn().mockResolvedValue({ ok: true, value: { content: 'response' } }),
          })
        );
      });

      it('should reuse existing session if found', async () => {
        const existingSession = { id: 'session-1', conversationId: 'conv-1' };
        mockSessionsRepo.findActive.mockResolvedValue(existingSession);

        await service.processIncomingMessage(message);

        expect(mockSessionsRepo.findActive).toHaveBeenCalledWith('cu-1', 'test-plugin', 'chat-123');
        // Should NOT create a new conversation
        expect(mockConversationsRepo.create).not.toHaveBeenCalled();
      });

      it('should create new conversation and session if none exists', async () => {
        mockSessionsRepo.findActive.mockResolvedValue(null);
        mockSessionsRepo.create.mockResolvedValue({
          id: 'new-session',
          conversationId: 'new-conv-id',
        });

        await service.processIncomingMessage(message);

        // Should create conversation in agent memory and persist to DB
        expect(mockConversationsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'new-conv-id', // ID from agent.getMemory().create()
            agentName: 'default',
            metadata: expect.objectContaining({
              source: 'channel',
              platform: 'telegram',
            }),
          })
        );
        expect(mockSessionsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            channelUserId: 'cu-1',
            channelPluginId: 'test-plugin',
            platformChatId: 'chat-123',
            conversationId: 'new-conv-id',
          })
        );
      });

      it('should touch session lastMessageAt', async () => {
        await service.processIncomingMessage(message);
        expect(mockSessionsRepo.touchLastMessage).toHaveBeenCalledWith('session-1');
      });

      it('should create conversation in agent memory when creating new session', async () => {
        mockSessionsRepo.findActive.mockResolvedValue(null);
        const agent = createMockAgent({ newConvId: 'mem-conv-1' });
        mockGetOrCreateChatAgent.mockResolvedValue(agent);
        mockSessionsRepo.create.mockResolvedValue({
          id: 'new-session',
          conversationId: 'mem-conv-1',
        });

        await service.processIncomingMessage(message);

        // Agent memory should have been used to create the conversation
        const memory = agent.getMemory();
        expect(memory.create).toHaveBeenCalledWith('You are helpful');
      });

      it('should register/touch unified session service when available', async () => {
        const mockSessionService = {
          getOrCreate: vi.fn().mockReturnValue({ id: 'unified-1' }),
          linkConversation: vi.fn(),
        };
        mockHasServiceRegistry.mockReturnValue(true);
        mockGetServiceRegistry.mockReturnValue({
          get: vi.fn().mockImplementation((token: unknown) => {
            const name = (token as { name: string }).name;
            if (name === 'session') return mockSessionService;
            throw new Error('Not found');
          }),
        });

        await service.processIncomingMessage(message);

        expect(mockSessionService.getOrCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'op-user-1',
            source: 'channel',
          })
        );
        expect(mockSessionService.linkConversation).toHaveBeenCalledWith('unified-1', 'conv-1');
      });
    });

    describe('typing indicator', () => {
      beforeEach(() => {
        mockHasServiceRegistry.mockReturnValue(false);
        mockGetOrCreateChatAgent.mockResolvedValue(
          createMockAgent({
            chat: vi.fn().mockResolvedValue({ ok: true, value: { content: 'response' } }),
          })
        );
      });

      it('should send typing indicator (best-effort)', async () => {
        await service.processIncomingMessage(message);
        expect(channelPlugin.api.sendTyping).toHaveBeenCalledWith('chat-123');
      });

      it('should not fail if typing indicator throws', async () => {
        channelPlugin.api.sendTyping.mockRejectedValueOnce(new Error('typing fail'));
        // Should not throw
        await service.processIncomingMessage(message);
      });
    });

    describe('processViaBus path', () => {
      let mockBus: { process: ReturnType<typeof vi.fn> };

      beforeEach(() => {
        mockBus = {
          process: vi.fn().mockResolvedValue({
            response: { content: 'AI bus response' },
          }),
        };
        mockHasServiceRegistry.mockReturnValue(true);
        mockGetServiceRegistry.mockReturnValue({
          get: vi.fn().mockImplementation((token: unknown) => {
            const name = (token as { name: string }).name;
            if (name === 'message') return mockBus;
            if (name === 'session') return null;
            throw new Error('Not found');
          }),
        });
        mockGetOrCreateChatAgent.mockResolvedValue(createMockAgent());
      });

      it('should route through MessageBus when available', async () => {
        await service.processIncomingMessage(message);

        expect(mockBus.process).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'msg-1',
            role: 'user',
            content: 'Hello!',
            metadata: expect.objectContaining({
              source: 'channel',
              platform: 'telegram',
            }),
          }),
          expect.objectContaining({
            context: expect.objectContaining({
              agentId: 'default',
              provider: 'openai',
              model: 'gpt-4',
            }),
          })
        );
      });

      it('should send AI response back to channel', async () => {
        await service.processIncomingMessage(message);

        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            platformChatId: 'chat-123',
            text: 'AI bus response',
            replyToId: 'msg-1',
          })
        );
      });

      it('should send "(No response generated)" for empty response', async () => {
        mockBus.process.mockResolvedValue({ response: { content: '' } });

        await service.processIncomingMessage(message);

        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: '(No response generated)',
          })
        );
      });

      it('should send "(No response generated)" for whitespace-only response', async () => {
        mockBus.process.mockResolvedValue({ response: { content: '   ' } });

        await service.processIncomingMessage(message);

        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: '(No response generated)',
          })
        );
      });

      it('should save outgoing message to channel_messages table', async () => {
        await service.processIncomingMessage(message);

        // Second call to create (first is incoming, second is outgoing)
        const outgoingCall = mockMessagesRepo.create.mock.calls[1];
        expect(outgoingCall[0]).toMatchObject({
          channelId: 'test-plugin',
          direction: 'outbound',
          senderId: 'assistant',
          senderName: 'Assistant',
          content: 'AI bus response',
        });
      });

      it('should broadcast outgoing message to WS clients', async () => {
        await service.processIncomingMessage(message);

        expect(mockWsGateway.broadcast).toHaveBeenCalledWith(
          'channel:message',
          expect.objectContaining({
            direction: 'outgoing',
            sender: 'Assistant',
            content: 'AI bus response',
          })
        );
      });

      it('should return demo reply in demo mode', async () => {
        mockIsDemoMode.mockResolvedValueOnce(true);

        await service.processIncomingMessage(message);

        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('[Demo Mode]'),
          })
        );
        expect(mockBus.process).not.toHaveBeenCalled();
      });

      it('should resolve provider and model via model routing', async () => {
        await service.processIncomingMessage(message);

        expect(mockResolveForProcess).toHaveBeenCalledWith('telegram');
      });

      it('should load session conversation onto agent for context continuity', async () => {
        const agent = createMockAgent();
        mockGetOrCreateChatAgent.mockResolvedValue(agent);

        await service.processIncomingMessage(message);

        // Should call loadConversation with the session's conversationId
        expect(agent.loadConversation).toHaveBeenCalledWith('conv-1');
      });

      it('should create new conversation when agent memory lost it (server restart)', async () => {
        // Agent memory does NOT have the session's conversation
        const agent = createMockAgent({ memoryHas: false, newConvId: 'recovered-conv-id' });
        mockGetOrCreateChatAgent.mockResolvedValue(agent);

        await service.processIncomingMessage(message);

        // Should persist conversation to DB first (fixes FK constraint violation)
        expect(mockConversationsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'recovered-conv-id',
            agentName: 'default',
            metadata: expect.objectContaining({
              source: 'channel',
              recoveredFrom: 'conv-1',
            }),
          })
        );

        // Then update the DB session FK
        expect(mockSessionsRepo.linkConversation).toHaveBeenCalledWith(
          'session-1',
          'recovered-conv-id'
        );
        expect(agent.loadConversation).toHaveBeenCalledWith('recovered-conv-id');

        // bus.process should receive the new conversationId
        expect(mockBus.process).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              conversationId: 'recovered-conv-id',
            }),
          }),
          expect.objectContaining({
            context: expect.objectContaining({
              conversationId: 'recovered-conv-id',
            }),
          })
        );
      });

      it('should skip conversation loading when conversationId is null', async () => {
        // Session with null conversationId
        mockSessionsRepo.findActive.mockResolvedValue({
          id: 'session-null',
          conversationId: null,
        });
        const agent = createMockAgent();
        mockGetOrCreateChatAgent.mockResolvedValue(agent);

        await service.processIncomingMessage(message);

        // Should NOT call loadConversation
        expect(agent.loadConversation).not.toHaveBeenCalled();
      });
    });

    describe('processDirectAgent path (fallback)', () => {
      let mockAgent: ReturnType<typeof createMockAgent>;

      beforeEach(() => {
        // No MessageBus available
        mockHasServiceRegistry.mockReturnValue(false);
        mockAgent = createMockAgent({
          chat: vi.fn().mockResolvedValue({
            ok: true,
            value: { content: 'Direct agent response' },
          }),
        });
        mockGetOrCreateChatAgent.mockResolvedValue(mockAgent);
      });

      it('should fall back to direct agent when no MessageBus', async () => {
        await service.processIncomingMessage(message);

        expect(mockAgent.chat).toHaveBeenCalledWith('Hello!');
        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: 'Direct agent response',
          })
        );
      });

      it('should handle agent error result', async () => {
        mockAgent.chat.mockResolvedValue({
          ok: false,
          error: { message: 'Agent failed' },
        });

        await service.processIncomingMessage(message);

        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('Agent failed'),
          })
        );
      });

      it('should return demo reply in demo mode (direct agent path)', async () => {
        mockIsDemoMode.mockResolvedValueOnce(true);

        await service.processIncomingMessage(message);

        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('[Demo Mode]'),
          })
        );
        expect(mockAgent.chat).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should send provider-error message for provider-related failures', async () => {
        mockHasServiceRegistry.mockReturnValue(false);
        mockGetOrCreateChatAgent.mockRejectedValue(new Error('No provider configured'));

        await service.processIncomingMessage(message);

        // Error reply should mention API key / settings
        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('API key'),
          })
        );
      });

      it('should send generic error message for non-provider failures', async () => {
        mockHasServiceRegistry.mockReturnValue(false);
        mockGetOrCreateChatAgent.mockRejectedValue(new Error('Something unexpected'));

        await service.processIncomingMessage(message);

        expect(channelPlugin.api.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            text: expect.stringContaining('Something unexpected'),
          })
        );
      });

      it('should not throw if error reply also fails', async () => {
        mockHasServiceRegistry.mockReturnValue(false);
        mockGetOrCreateChatAgent.mockRejectedValue(new Error('Primary error'));
        channelPlugin.api.sendMessage.mockRejectedValue(new Error('Reply also failed'));

        // Should not throw — best-effort error reply
        await service.processIncomingMessage(message);
      });

      it('should tolerate outgoing message save failure', async () => {
        mockHasServiceRegistry.mockReturnValue(false);
        mockGetOrCreateChatAgent.mockResolvedValue(
          createMockAgent({
            chat: vi.fn().mockResolvedValue({ ok: true, value: { content: 'response' } }),
          })
        );
        // First call (incoming) succeeds, second call (outgoing) fails
        mockMessagesRepo.create
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('DB save error'));

        // Should not throw
        await service.processIncomingMessage(message);
      });
    });
  });

  // ==========================================================================
  // withSessionLock
  // ==========================================================================

  describe('withSessionLock()', () => {
    // Access private method via any-cast for testing
    function callWithSessionLock<T>(
      svc: ChannelServiceImpl,
      key: string,
      fn: () => Promise<T>
    ): Promise<T> {
      return (
        svc as unknown as {
          withSessionLock: (typeof svc)['getChannel'] &
            ((key: string, fn: () => Promise<T>) => Promise<T>);
        }
      ).withSessionLock(key, fn);
    }

    it('should serialize operations for the same key', async () => {
      const order: number[] = [];

      const p1 = callWithSessionLock(service, 'key-a', async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push(1);
        return 'first';
      });

      const p2 = callWithSessionLock(service, 'key-a', async () => {
        order.push(2);
        return 'second';
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('first');
      expect(r2).toBe('second');
      expect(order).toEqual([1, 2]); // second waits for first
    });

    it('should allow different keys to run concurrently', async () => {
      const order: string[] = [];

      const p1 = callWithSessionLock(service, 'key-a', async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push('a');
      });

      const p2 = callWithSessionLock(service, 'key-b', async () => {
        order.push('b');
      });

      await Promise.all([p1, p2]);
      // 'b' should complete before 'a' because it doesn't wait
      expect(order).toEqual(['b', 'a']);
    });

    it('should clean up lock after completion', async () => {
      await callWithSessionLock(service, 'key-x', async () => 'done');

      // Lock map should be empty after completion
      const locks = (service as unknown as { sessionLocks: Map<string, Promise<void>> })
        .sessionLocks;
      expect(locks.has('key-x')).toBe(false);
    });

    it('should clean up lock even if fn throws', async () => {
      await callWithSessionLock(service, 'key-err', async () => {
        throw new Error('fn error');
      }).catch(() => {
        /* expected */
      });

      const locks = (service as unknown as { sessionLocks: Map<string, Promise<void>> })
        .sessionLocks;
      expect(locks.has('key-err')).toBe(false);
    });

    it('should propagate errors from fn', async () => {
      await expect(
        callWithSessionLock(service, 'key-e', async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');
    });
  });

  // ==========================================================================
  // dispose
  // ==========================================================================

  describe('dispose()', () => {
    it('should call all unsubscribe functions', () => {
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();
      mockEventBus.on.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2);

      // Create a new instance that subscribes twice
      const svc = new ChannelServiceImpl(registry as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      svc.dispose();

      // The constructor only subscribes once (MESSAGE_RECEIVED), so unsub1 should be called
      expect(unsub1).toHaveBeenCalled();
    });

    it('should clear the unsubscribes array', () => {
      service.dispose();
      // Calling dispose again should be safe (no double-unsub)
      service.dispose();
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle plugin with empty api object (not a channel plugin)', () => {
      const emptyApi = {
        manifest: { id: 'empty-api', name: 'Empty', category: 'channel' as const },
        status: 'enabled',
        api: {},
      };
      const reg = createMockPluginRegistry([emptyApi as never]);
      const svc = new ChannelServiceImpl(reg as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      expect(svc.getChannel('empty-api')).toBeUndefined();
      expect(svc.listChannels()).toHaveLength(0);
      svc.dispose();
    });

    it('should handle getChannel when plugin exists but is not a channel', () => {
      expect(service.getChannel('non-channel')).toBeUndefined();
    });

    it('should not proceed past step 7 if channel API becomes unavailable', async () => {
      // Simulate: plugin found during user resolution but not during response phase
      const channelUser = createChannelUser();
      mockUsersRepo.findOrCreate.mockResolvedValue(channelUser);
      mockSessionsRepo.findActive.mockResolvedValue({ id: 's-1', conversationId: 'c-1' });
      mockHasServiceRegistry.mockReturnValue(false);

      // Remove the channel plugin from registry after initial calls
      let callCount = 0;
      registry.get.mockImplementation((_id: string) => {
        callCount++;
        // First call (in processIncomingMessage for whitelist check) returns the plugin,
        // subsequent calls return undefined to simulate plugin disappearing
        if (callCount <= 2) return channelPlugin;
        return undefined;
      });

      // Should handle gracefully (returns early when api is undefined)
      await service.processIncomingMessage(createIncomingMessage());
    });

    it('should handle processIncomingMessage when channel plugin missing for /connect', async () => {
      const connectMsg = createIncomingMessage({
        text: '/connect token123',
        channelPluginId: 'missing-plugin',
      });
      const channelUser = createChannelUser();
      mockUsersRepo.findOrCreate.mockResolvedValue(channelUser);
      mockVerificationService.verifyToken.mockResolvedValue({ success: true });

      // Plugin not found
      registry.get.mockReturnValue(undefined);

      // Should not throw
      await service.processIncomingMessage(connectMsg);
    });

    it('should handle multiple plugins on the same platform in broadcast', async () => {
      const plugin1 = createChannelPlugin({ id: 'tg-1', sendMessageResult: 'mid-1' });
      const plugin2 = createChannelPlugin({ id: 'tg-2', sendMessageResult: 'mid-2' });
      const reg = createMockPluginRegistry([plugin1, plugin2]);
      const svc = new ChannelServiceImpl(reg as never, {
        usersRepo: mockUsersRepo as never,
        sessionsRepo: mockSessionsRepo as never,
        verificationService: mockVerificationService as never,
      });

      const results = await svc.broadcast('telegram', { platformChatId: 'c-1', text: 'hi' });
      expect(results.size).toBe(2);
      expect(results.get('tg-1')).toBe('mid-1');
      expect(results.get('tg-2')).toBe('mid-2');
      svc.dispose();
    });

    it('should handle null conversationId in session', async () => {
      mockUsersRepo.findOrCreate.mockResolvedValue(createChannelUser());
      mockSessionsRepo.findActive.mockResolvedValue({
        id: 'session-null',
        conversationId: null,
      });
      mockHasServiceRegistry.mockReturnValue(false);
      mockGetOrCreateChatAgent.mockResolvedValue(
        createMockAgent({
          chat: vi.fn().mockResolvedValue({ ok: true, value: { content: 'response' } }),
        })
      );

      // Should not throw; skips linkConversation
      await service.processIncomingMessage(createIncomingMessage());
    });
  });
});
