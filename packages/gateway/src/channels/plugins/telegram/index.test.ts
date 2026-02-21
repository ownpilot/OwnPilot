/**
 * Comprehensive tests for buildTelegramChannelPlugin()
 *
 * Uses the REAL createChannelPlugin builder from @ownpilot/core (via importOriginal).
 * Only getChannelService, TelegramChannelAPI, and configServicesRepo are mocked.
 *
 * Coverage:
 *   1. Return structure (manifest + implementation)
 *   2. Manifest metadata fields
 *   3. Required services / configSchema
 *   4. Channel API factory (config resolution + TelegramChannelAPI instantiation)
 *   5. Tool definition
 *   6. Tool executor (connected, disconnected, null channel)
 *   7. Edge cases
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks — referenced inside vi.mock() factory functions
// ============================================================================

const { mockGetFieldValue, MockTelegramChannelAPI, mockGetChannelService, mockChannelApi } =
  vi.hoisted(() => {
    const mockChannelApi = {
      getStatus: vi.fn(() => 'connected' as const),
      sendMessage: vi.fn().mockResolvedValue('msg-123'),
    };

    return {
      mockGetFieldValue: vi.fn(() => null),
      MockTelegramChannelAPI: vi.fn(function (
        this: { config: Record<string, unknown>; pluginId: string },
        config: Record<string, unknown>,
        pluginId: string,
      ) {
        this.config = config;
        this.pluginId = pluginId;
      }),
      mockGetChannelService: vi.fn(() => ({
        getChannel: vi.fn(() => mockChannelApi),
      })),
      mockChannelApi,
    };
  });

// Keep createChannelPlugin real — only override getChannelService.
vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...actual,
    getChannelService: mockGetChannelService,
  };
});

vi.mock('./telegram-api.js', () => ({
  TelegramChannelAPI: MockTelegramChannelAPI,
}));

vi.mock('../../../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getFieldValue: mockGetFieldValue,
  },
}));

// ============================================================================
// Module under test
// ============================================================================

import { buildTelegramChannelPlugin } from './index.js';

// ============================================================================
// Helpers
// ============================================================================

/** Build the plugin once and return it. */
function build() {
  return buildTelegramChannelPlugin();
}

/** Extract the channelApiFactory from the built plugin. */
function getFactory() {
  const plugin = build();
  const factory = (
    plugin.implementation as { channelApiFactory?: (cfg: Record<string, unknown>) => unknown }
  ).channelApiFactory;
  expect(factory).toBeDefined();
  return factory!;
}

/** Extract the single tool definition from the built plugin. */
function getToolEntry() {
  const plugin = build();
  const tools = plugin.implementation.tools as Map<
    string,
    { definition: Record<string, unknown>; executor: (p: Record<string, unknown>) => Promise<{ content: string }> }
  >;
  expect(tools).toBeDefined();
  const entry = tools.get('channel_telegram_send');
  expect(entry).toBeDefined();
  return entry!;
}

/** Execute the tool executor with given params. */
async function runExecutor(params: Record<string, unknown>) {
  const { executor } = getToolEntry();
  return executor(params);
}

// ============================================================================
// beforeEach
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Re-apply defaults after clearAllMocks.
  mockGetFieldValue.mockReturnValue(null);
  mockChannelApi.getStatus.mockReturnValue('connected');
  mockChannelApi.sendMessage.mockResolvedValue('msg-123');
  mockGetChannelService.mockReturnValue({
    getChannel: vi.fn(() => mockChannelApi),
  });
});

// ============================================================================
// 1. buildTelegramChannelPlugin() return structure
// ============================================================================

describe('buildTelegramChannelPlugin() — return structure', () => {
  it('returns an object (not null/undefined)', () => {
    expect(build()).toBeTruthy();
  });

  it('returns an object with a manifest property', () => {
    expect(build()).toHaveProperty('manifest');
  });

  it('returns an object with an implementation property', () => {
    expect(build()).toHaveProperty('implementation');
  });

  it('manifest is a non-null object', () => {
    const { manifest } = build();
    expect(manifest).toBeDefined();
    expect(typeof manifest).toBe('object');
    expect(manifest).not.toBeNull();
  });

  it('implementation is a non-null object', () => {
    const { implementation } = build();
    expect(implementation).toBeDefined();
    expect(typeof implementation).toBe('object');
    expect(implementation).not.toBeNull();
  });

  it('manifest.id is "channel.telegram"', () => {
    expect(build().manifest.id).toBe('channel.telegram');
  });

  it('manifest.name is "Telegram"', () => {
    expect(build().manifest.name).toBe('Telegram');
  });

  it('manifest.version is "1.0.0"', () => {
    expect(build().manifest.version).toBe('1.0.0');
  });

  it('manifest.description contains "Telegram"', () => {
    expect(build().manifest.description).toContain('Telegram');
  });

  it('manifest.description contains "Bot API"', () => {
    expect(build().manifest.description).toContain('Bot API');
  });

  it('manifest.platform is "telegram"', () => {
    const manifest = build().manifest as { platform: string };
    expect(manifest.platform).toBe('telegram');
  });

  it('manifest.author.name is "OwnPilot"', () => {
    expect(build().manifest.author?.name).toBe('OwnPilot');
  });

  it('manifest.capabilities includes "tools"', () => {
    expect(build().manifest.capabilities).toContain('tools');
  });

  it('manifest.capabilities includes "events"', () => {
    expect(build().manifest.capabilities).toContain('events');
  });

  it('manifest.capabilities has exactly 2 entries', () => {
    expect(build().manifest.capabilities).toHaveLength(2);
  });

  it('manifest.permissions includes "network"', () => {
    expect(build().manifest.permissions).toContain('network');
  });

  it('manifest.permissions has exactly 1 entry', () => {
    expect(build().manifest.permissions).toHaveLength(1);
  });

  it('manifest.icon is "✈️"', () => {
    expect(build().manifest.icon).toBe('✈️');
  });

  it('manifest.category is "channel" (set automatically by ChannelPluginBuilder.build())', () => {
    expect(build().manifest.category).toBe('channel');
  });

  it('manifest.main is a string', () => {
    expect(typeof build().manifest.main).toBe('string');
  });

  it('implementation.channelApiFactory is a function', () => {
    const impl = build().implementation as { channelApiFactory?: unknown };
    expect(typeof impl.channelApiFactory).toBe('function');
  });

  it('implementation.tools is a Map', () => {
    const impl = build().implementation;
    expect(impl.tools).toBeInstanceOf(Map);
  });

  it('implementation.handlers is an array', () => {
    const impl = build().implementation;
    expect(Array.isArray(impl.handlers)).toBe(true);
  });
});

// ============================================================================
// 2. Required services configuration
// ============================================================================

describe('buildTelegramChannelPlugin() — requiredServices', () => {
  function getServices() {
    return build().manifest.requiredServices ?? [];
  }

  function getFirstService() {
    const services = getServices();
    expect(services.length).toBeGreaterThan(0);
    return services[0]!;
  }

  function getSchema() {
    const svc = getFirstService();
    return (svc.configSchema ?? []) as Array<Record<string, unknown>>;
  }

  it('has exactly 1 required service', () => {
    expect(getServices()).toHaveLength(1);
  });

  it('service name is "telegram_bot"', () => {
    expect(getFirstService().name).toBe('telegram_bot');
  });

  it('service displayName is "Telegram Bot"', () => {
    expect(getFirstService().displayName).toBe('Telegram Bot');
  });

  it('service category is "channels"', () => {
    expect(getFirstService().category).toBe('channels');
  });

  it('service docsUrl contains "core.telegram.org"', () => {
    expect(getFirstService().docsUrl).toContain('core.telegram.org');
  });

  it('service docsUrl contains "botfather"', () => {
    expect((getFirstService().docsUrl ?? '').toLowerCase()).toContain('botfather');
  });

  it('configSchema has exactly 6 fields', () => {
    expect(getSchema()).toHaveLength(6);
  });

  // ---- configSchema fields are in ascending order by `order` ----

  it('configSchema fields are ordered by ascending order value', () => {
    const schema = getSchema();
    const orders = schema.map((f) => f.order as number);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
  });

  // ---- bot_token (order 0) ----

  it('bot_token field: name is "bot_token"', () => {
    expect(getSchema()[0]!.name).toBe('bot_token');
  });

  it('bot_token field: type is "secret"', () => {
    expect(getSchema()[0]!.type).toBe('secret');
  });

  it('bot_token field: required is true', () => {
    expect(getSchema()[0]!.required).toBe(true);
  });

  it('bot_token field: label is "Bot Token"', () => {
    expect(getSchema()[0]!.label).toBe('Bot Token');
  });

  it('bot_token field: order is 0', () => {
    expect(getSchema()[0]!.order).toBe(0);
  });

  it('bot_token field: has a non-empty description', () => {
    const desc = getSchema()[0]!.description as string;
    expect(typeof desc).toBe('string');
    expect(desc.length).toBeGreaterThan(0);
  });

  it('bot_token field: has a non-empty placeholder', () => {
    const ph = getSchema()[0]!.placeholder as string;
    expect(typeof ph).toBe('string');
    expect(ph.length).toBeGreaterThan(0);
  });

  // ---- allowed_users (order 1) ----

  it('allowed_users field: name is "allowed_users"', () => {
    expect(getSchema()[1]!.name).toBe('allowed_users');
  });

  it('allowed_users field: type is "string"', () => {
    expect(getSchema()[1]!.type).toBe('string');
  });

  it('allowed_users field: label is "Allowed User IDs"', () => {
    expect(getSchema()[1]!.label).toBe('Allowed User IDs');
  });

  it('allowed_users field: order is 1', () => {
    expect(getSchema()[1]!.order).toBe(1);
  });

  it('allowed_users field: not required (falsy)', () => {
    expect(getSchema()[1]!.required).toBeFalsy();
  });

  it('allowed_users field: has a description', () => {
    const desc = getSchema()[1]!.description as string;
    expect(typeof desc).toBe('string');
  });

  // ---- allowed_chats (order 2) ----

  it('allowed_chats field: name is "allowed_chats"', () => {
    expect(getSchema()[2]!.name).toBe('allowed_chats');
  });

  it('allowed_chats field: type is "string"', () => {
    expect(getSchema()[2]!.type).toBe('string');
  });

  it('allowed_chats field: label is "Allowed Chat IDs"', () => {
    expect(getSchema()[2]!.label).toBe('Allowed Chat IDs');
  });

  it('allowed_chats field: order is 2', () => {
    expect(getSchema()[2]!.order).toBe(2);
  });

  it('allowed_chats field: has a non-empty placeholder', () => {
    const ph = getSchema()[2]!.placeholder as string;
    expect(typeof ph).toBe('string');
    expect(ph.length).toBeGreaterThan(0);
  });

  // ---- parse_mode (order 3) ----

  it('parse_mode field: name is "parse_mode"', () => {
    expect(getSchema()[3]!.name).toBe('parse_mode');
  });

  it('parse_mode field: type is "select"', () => {
    expect(getSchema()[3]!.type).toBe('select');
  });

  it('parse_mode field: defaultValue is "HTML"', () => {
    expect(getSchema()[3]!.defaultValue).toBe('HTML');
  });

  it('parse_mode field: label is "Message Parse Mode"', () => {
    expect(getSchema()[3]!.label).toBe('Message Parse Mode');
  });

  it('parse_mode field: order is 3', () => {
    expect(getSchema()[3]!.order).toBe(3);
  });

  it('parse_mode options: has exactly 3 entries', () => {
    const opts = getSchema()[3]!.options as Array<{ value: string; label: string }>;
    expect(opts).toHaveLength(3);
  });

  it('parse_mode options: includes HTML value', () => {
    const opts = getSchema()[3]!.options as Array<{ value: string; label: string }>;
    expect(opts.some((o) => o.value === 'HTML')).toBe(true);
  });

  it('parse_mode options: includes Markdown value', () => {
    const opts = getSchema()[3]!.options as Array<{ value: string; label: string }>;
    expect(opts.some((o) => o.value === 'Markdown')).toBe(true);
  });

  it('parse_mode options: includes MarkdownV2 value', () => {
    const opts = getSchema()[3]!.options as Array<{ value: string; label: string }>;
    expect(opts.some((o) => o.value === 'MarkdownV2')).toBe(true);
  });

  it('parse_mode options: each entry has a value and label', () => {
    const opts = getSchema()[3]!.options as Array<{ value: string; label: string }>;
    for (const opt of opts) {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
    }
  });

  // ---- webhook_url (order 4) ----

  it('webhook_url field: name is "webhook_url"', () => {
    expect(getSchema()[4]!.name).toBe('webhook_url');
  });

  it('webhook_url field: type is "string"', () => {
    expect(getSchema()[4]!.type).toBe('string');
  });

  it('webhook_url field: label is "Webhook Base URL"', () => {
    expect(getSchema()[4]!.label).toBe('Webhook Base URL');
  });

  it('webhook_url field: order is 4', () => {
    expect(getSchema()[4]!.order).toBe(4);
  });

  it('webhook_url field: not required (falsy)', () => {
    expect(getSchema()[4]!.required).toBeFalsy();
  });

  it('webhook_url field: has a non-empty placeholder', () => {
    const ph = getSchema()[4]!.placeholder as string;
    expect(typeof ph).toBe('string');
    expect(ph.length).toBeGreaterThan(0);
  });

  // ---- webhook_secret (order 5) ----

  it('webhook_secret field: name is "webhook_secret"', () => {
    expect(getSchema()[5]!.name).toBe('webhook_secret');
  });

  it('webhook_secret field: type is "secret"', () => {
    expect(getSchema()[5]!.type).toBe('secret');
  });

  it('webhook_secret field: label is "Webhook Secret"', () => {
    expect(getSchema()[5]!.label).toBe('Webhook Secret');
  });

  it('webhook_secret field: order is 5', () => {
    expect(getSchema()[5]!.order).toBe(5);
  });

  it('webhook_secret field: not required (falsy)', () => {
    expect(getSchema()[5]!.required).toBeFalsy();
  });

  it('webhook_secret field: has a non-empty placeholder', () => {
    const ph = getSchema()[5]!.placeholder as string;
    expect(typeof ph).toBe('string');
    expect(ph.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 3. Channel API factory
// ============================================================================

describe('buildTelegramChannelPlugin() — channelApi factory', () => {
  it('implementation.channelApiFactory is defined', () => {
    const impl = build().implementation as { channelApiFactory?: unknown };
    expect(impl.channelApiFactory).toBeDefined();
  });

  it('implementation.channelApiFactory is a function', () => {
    const impl = build().implementation as { channelApiFactory?: unknown };
    expect(typeof impl.channelApiFactory).toBe('function');
  });

  it('factory calls new TelegramChannelAPI when invoked', () => {
    const factory = getFactory();
    factory({ bot_token: 'test-tok' });
    expect(MockTelegramChannelAPI).toHaveBeenCalledTimes(1);
  });

  it('factory passes "channel.telegram" as the second argument to TelegramChannelAPI', () => {
    const factory = getFactory();
    factory({ bot_token: 'test-tok' });
    const args = MockTelegramChannelAPI.mock.calls[0]!;
    expect(args[1]).toBe('channel.telegram');
  });

  it('factory returns the TelegramChannelAPI instance', () => {
    const factory = getFactory();
    const result = factory({ bot_token: 'tok' });
    expect(result).toBe(MockTelegramChannelAPI.mock.instances[0]);
  });

  // ---- bot_token resolution ----

  it('uses bot_token from config when present (non-null)', () => {
    const factory = getFactory();
    factory({ bot_token: 'cfg-token' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.bot_token).toBe('cfg-token');
  });

  it('falls back to configServicesRepo.getFieldValue for bot_token when config omits it', () => {
    mockGetFieldValue.mockImplementation((_svc: string, field: string) =>
      field === 'bot_token' ? 'repo-token' : null,
    );
    const factory = getFactory();
    factory({});
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.bot_token).toBe('repo-token');
  });

  it('uses empty string for bot_token when config and repo both return null', () => {
    mockGetFieldValue.mockReturnValue(null);
    const factory = getFactory();
    factory({});
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.bot_token).toBe('');
  });

  it('uses empty string for bot_token when config and repo both return undefined', () => {
    mockGetFieldValue.mockReturnValue(undefined);
    const factory = getFactory();
    factory({});
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.bot_token).toBe('');
  });

  it('does not query configServicesRepo for bot_token when config provides a truthy value', () => {
    const factory = getFactory();
    factory({ bot_token: 'provided' });
    const queriedFields = mockGetFieldValue.mock.calls.map((c) => c[1]);
    expect(queriedFields).not.toContain('bot_token');
  });

  // ---- webhook_url resolution ----

  it('uses webhook_url from config when present', () => {
    const factory = getFactory();
    factory({ bot_token: 'tok', webhook_url: 'https://example.com' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.webhook_url).toBe('https://example.com');
  });

  it('falls back to configServicesRepo.getFieldValue for webhook_url when config omits it', () => {
    mockGetFieldValue.mockImplementation((_svc: string, field: string) =>
      field === 'webhook_url' ? 'https://repo.com' : null,
    );
    const factory = getFactory();
    factory({ bot_token: 'tok' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.webhook_url).toBe('https://repo.com');
  });

  it('uses empty string for webhook_url when both config and repo return null', () => {
    mockGetFieldValue.mockReturnValue(null);
    const factory = getFactory();
    factory({ bot_token: 'tok' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.webhook_url).toBe('');
  });

  it('uses empty string for webhook_url when both config and repo return undefined', () => {
    mockGetFieldValue.mockReturnValue(undefined);
    const factory = getFactory();
    factory({ bot_token: 'tok' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.webhook_url).toBe('');
  });

  // ---- webhook_secret resolution ----

  it('uses webhook_secret from config when present', () => {
    const factory = getFactory();
    factory({ bot_token: 'tok', webhook_secret: 'my-secret' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.webhook_secret).toBe('my-secret');
  });

  it('falls back to configServicesRepo.getFieldValue for webhook_secret when config omits it', () => {
    mockGetFieldValue.mockImplementation((_svc: string, field: string) =>
      field === 'webhook_secret' ? 'repo-secret' : null,
    );
    const factory = getFactory();
    factory({ bot_token: 'tok' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.webhook_secret).toBe('repo-secret');
  });

  it('uses empty string for webhook_secret when both config and repo return null', () => {
    mockGetFieldValue.mockReturnValue(null);
    const factory = getFactory();
    factory({ bot_token: 'tok' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.webhook_secret).toBe('');
  });

  it('uses empty string for webhook_secret when both config and repo return undefined', () => {
    mockGetFieldValue.mockReturnValue(undefined);
    const factory = getFactory();
    factory({ bot_token: 'tok' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.webhook_secret).toBe('');
  });

  // ---- config spread ----

  it('spreads all original config keys into resolvedConfig', () => {
    const factory = getFactory();
    factory({ bot_token: 'tok', allowed_users: '111,222', parse_mode: 'Markdown' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.allowed_users).toBe('111,222');
    expect(inst.config.parse_mode).toBe('Markdown');
  });

  it('preserves arbitrary extra config keys in resolvedConfig', () => {
    const factory = getFactory();
    factory({ bot_token: 'tok', custom_key: 'custom_val' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.custom_key).toBe('custom_val');
  });

  // ---- configServicesRepo query targeting ----

  it('queries configServicesRepo with service name "telegram_bot"', () => {
    const factory = getFactory();
    factory({});
    for (const call of mockGetFieldValue.mock.calls) {
      expect(call[0]).toBe('telegram_bot');
    }
  });

  it('queries configServicesRepo for field "webhook_url"', () => {
    const factory = getFactory();
    factory({ bot_token: 'tok' });
    const fields = mockGetFieldValue.mock.calls.map((c) => c[1]);
    expect(fields).toContain('webhook_url');
  });

  it('queries configServicesRepo for field "webhook_secret"', () => {
    const factory = getFactory();
    factory({ bot_token: 'tok' });
    const fields = mockGetFieldValue.mock.calls.map((c) => c[1]);
    expect(fields).toContain('webhook_secret');
  });

  // ---- mixed scenario: some from config, some from repo ----

  it('resolves bot_token from config and webhook_url from repo simultaneously', () => {
    mockGetFieldValue.mockImplementation((_svc: string, field: string) =>
      field === 'webhook_url' ? 'https://hook.io' : null,
    );
    const factory = getFactory();
    factory({ bot_token: 'my-cfg-token' });
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.bot_token).toBe('my-cfg-token');
    expect(inst.config.webhook_url).toBe('https://hook.io');
    expect(inst.config.webhook_secret).toBe('');
  });
});

// ============================================================================
// 4. Tool definition
// ============================================================================

describe('buildTelegramChannelPlugin() — tool definition', () => {
  it('implementation.tools is a Map with exactly 1 entry', () => {
    const tools = build().implementation.tools as Map<string, unknown>;
    expect(tools.size).toBe(1);
  });

  it('tools Map contains "channel_telegram_send" key', () => {
    const tools = build().implementation.tools as Map<string, unknown>;
    expect(tools.has('channel_telegram_send')).toBe(true);
  });

  it('tool definition name is "channel_telegram_send"', () => {
    expect(getToolEntry().definition.name).toBe('channel_telegram_send');
  });

  it('tool definition description contains "Telegram"', () => {
    const desc = getToolEntry().definition.description as string;
    expect(desc).toContain('Telegram');
  });

  it('tool definition description mentions "chat"', () => {
    const desc = (getToolEntry().definition.description as string).toLowerCase();
    expect(desc).toContain('chat');
  });

  it('tool definition description mentions "bot"', () => {
    const desc = (getToolEntry().definition.description as string).toLowerCase();
    expect(desc).toContain('bot');
  });

  it('tool parameters type is "object"', () => {
    const params = getToolEntry().definition.parameters as Record<string, unknown>;
    expect(params.type).toBe('object');
  });

  it('tool parameters.properties has "chat_id" key', () => {
    const params = getToolEntry().definition.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, unknown>;
    expect(props).toHaveProperty('chat_id');
  });

  it('tool parameters.properties has "text" key', () => {
    const params = getToolEntry().definition.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, unknown>;
    expect(props).toHaveProperty('text');
  });

  it('chat_id parameter type is "string"', () => {
    const params = getToolEntry().definition.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { type: string }>;
    expect(props.chat_id!.type).toBe('string');
  });

  it('text parameter type is "string"', () => {
    const params = getToolEntry().definition.parameters as Record<string, unknown>;
    const props = params.properties as Record<string, { type: string }>;
    expect(props.text!.type).toBe('string');
  });

  it('required array contains "chat_id"', () => {
    const params = getToolEntry().definition.parameters as Record<string, unknown>;
    expect(params.required as string[]).toContain('chat_id');
  });

  it('required array contains "text"', () => {
    const params = getToolEntry().definition.parameters as Record<string, unknown>;
    expect(params.required as string[]).toContain('text');
  });

  it('required array has exactly 2 entries', () => {
    const params = getToolEntry().definition.parameters as Record<string, unknown>;
    expect(params.required as string[]).toHaveLength(2);
  });

  it('tool entry has an executor function', () => {
    expect(typeof getToolEntry().executor).toBe('function');
  });
});

// ============================================================================
// 5. Tool executor — connected path
// ============================================================================

describe('buildTelegramChannelPlugin() — tool executor (connected)', () => {
  it('returns an object with a content property', async () => {
    const result = await runExecutor({ chat_id: '100', text: 'hello' });
    expect(result).toHaveProperty('content');
  });

  it('content is a string', async () => {
    const result = await runExecutor({ chat_id: '100', text: 'hello' });
    expect(typeof result.content).toBe('string');
  });

  it('success content contains the chat_id', async () => {
    const result = await runExecutor({ chat_id: '999', text: 'hi' });
    expect(result.content).toContain('999');
  });

  it('success content contains the message ID returned by sendMessage', async () => {
    mockChannelApi.sendMessage.mockResolvedValue('msg-abc');
    const result = await runExecutor({ chat_id: '1', text: 'hi' });
    expect(result.content).toContain('msg-abc');
  });

  it('success content contains "Message sent"', async () => {
    const result = await runExecutor({ chat_id: '1', text: 'hi' });
    expect(result.content).toContain('Message sent');
  });

  it('calls sendMessage with platformChatId converted to string', async () => {
    const mockSvc = { getChannel: vi.fn(() => mockChannelApi) };
    mockGetChannelService.mockReturnValue(mockSvc);
    await runExecutor({ chat_id: 12345, text: 'numeric' });
    expect(mockChannelApi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ platformChatId: '12345' }),
    );
  });

  it('calls sendMessage with text converted to string', async () => {
    const mockSvc = { getChannel: vi.fn(() => mockChannelApi) };
    mockGetChannelService.mockReturnValue(mockSvc);
    await runExecutor({ chat_id: '1', text: 99 });
    expect(mockChannelApi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: '99' }),
    );
  });

  it('calls sendMessage with correct platformChatId for string chat_id', async () => {
    const mockSvc = { getChannel: vi.fn(() => mockChannelApi) };
    mockGetChannelService.mockReturnValue(mockSvc);
    await runExecutor({ chat_id: 'chat-xyz', text: 'msg' });
    expect(mockChannelApi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ platformChatId: 'chat-xyz' }),
    );
  });

  it('calls getChannelService exactly once', async () => {
    await runExecutor({ chat_id: '1', text: 'hi' });
    expect(mockGetChannelService).toHaveBeenCalledTimes(1);
  });

  it('calls getChannel with "channel.telegram"', async () => {
    const mockGetChannel = vi.fn(() => mockChannelApi);
    mockGetChannelService.mockReturnValue({ getChannel: mockGetChannel });
    await runExecutor({ chat_id: '1', text: 'hi' });
    expect(mockGetChannel).toHaveBeenCalledWith('channel.telegram');
  });

  it('calls api.getStatus() to verify connection', async () => {
    const mockGetChannel = vi.fn(() => mockChannelApi);
    mockGetChannelService.mockReturnValue({ getChannel: mockGetChannel });
    await runExecutor({ chat_id: '1', text: 'hi' });
    expect(mockChannelApi.getStatus).toHaveBeenCalled();
  });

  it('executor is async — returns a Promise', () => {
    const { executor } = getToolEntry();
    const result = executor({ chat_id: '1', text: 'hi' });
    expect(result).toBeInstanceOf(Promise);
  });

  it('numeric chat_id appears in the success message as string representation', async () => {
    const result = await runExecutor({ chat_id: 77, text: 'test' });
    expect(result.content).toContain('77');
  });
});

// ============================================================================
// 6. Tool executor — not-connected paths
// ============================================================================

describe('buildTelegramChannelPlugin() — tool executor (not connected)', () => {
  it('returns error content when getStatus() returns "disconnected"', async () => {
    mockChannelApi.getStatus.mockReturnValue('disconnected');
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => mockChannelApi) });
    const result = await runExecutor({ chat_id: '1', text: 'hi' });
    expect(result.content).toContain('not connected');
  });

  it('returns error content when getStatus() returns "connecting"', async () => {
    mockChannelApi.getStatus.mockReturnValue('connecting');
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => mockChannelApi) });
    const result = await runExecutor({ chat_id: '1', text: 'hi' });
    expect(result.content).toContain('not connected');
  });

  it('returns error content when getStatus() returns "reconnecting"', async () => {
    mockChannelApi.getStatus.mockReturnValue('reconnecting');
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => mockChannelApi) });
    const result = await runExecutor({ chat_id: '1', text: 'hi' });
    expect(result.content).toContain('not connected');
  });

  it('returns error content when getStatus() returns "error"', async () => {
    mockChannelApi.getStatus.mockReturnValue('error');
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => mockChannelApi) });
    const result = await runExecutor({ chat_id: '1', text: 'hi' });
    expect(result.content).toContain('not connected');
  });

  it('does not call sendMessage when bot is not connected', async () => {
    mockChannelApi.getStatus.mockReturnValue('disconnected');
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => mockChannelApi) });
    await runExecutor({ chat_id: '1', text: 'hi' });
    expect(mockChannelApi.sendMessage).not.toHaveBeenCalled();
  });

  it('returns error content when getChannel() returns null', async () => {
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => null) });
    const result = await runExecutor({ chat_id: '1', text: 'hi' });
    expect(result.content).toContain('not connected');
  });

  it('returns error content when getChannel() returns undefined', async () => {
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => undefined) });
    const result = await runExecutor({ chat_id: '1', text: 'hi' });
    expect(result.content).toContain('not connected');
  });

  it('does not call sendMessage when getChannel() returns null', async () => {
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => null) });
    await runExecutor({ chat_id: '1', text: 'hi' });
    expect(mockChannelApi.sendMessage).not.toHaveBeenCalled();
  });

  it('not-connected error content mentions "connect"', async () => {
    mockChannelApi.getStatus.mockReturnValue('disconnected');
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => mockChannelApi) });
    const result = await runExecutor({ chat_id: '1', text: 'hi' });
    expect(result.content.toLowerCase()).toContain('connect');
  });

  it('not-connected content is a string', async () => {
    mockChannelApi.getStatus.mockReturnValue('disconnected');
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => mockChannelApi) });
    const result = await runExecutor({ chat_id: '1', text: 'hi' });
    expect(typeof result.content).toBe('string');
  });

  it('success content includes message ID from custom sendMessage return value', async () => {
    mockChannelApi.sendMessage.mockResolvedValue('custom-id-999');
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => mockChannelApi) });
    const result = await runExecutor({ chat_id: '5', text: 'test' });
    expect(result.content).toContain('custom-id-999');
  });
});

// ============================================================================
// 7. Edge cases
// ============================================================================

describe('buildTelegramChannelPlugin() — edge cases', () => {
  it('two separate calls return independent plugin instances', () => {
    const a = buildTelegramChannelPlugin();
    const b = buildTelegramChannelPlugin();
    expect(a).not.toBe(b);
  });

  it('two separate calls produce manifests with the same id', () => {
    const a = buildTelegramChannelPlugin();
    const b = buildTelegramChannelPlugin();
    expect(a.manifest.id).toBe(b.manifest.id);
  });

  it('configServicesRepo.getFieldValue returning null for all fields results in empty-string fallbacks', () => {
    mockGetFieldValue.mockReturnValue(null);
    const factory = getFactory();
    factory({});
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.bot_token).toBe('');
    expect(inst.config.webhook_url).toBe('');
    expect(inst.config.webhook_secret).toBe('');
  });

  it('configServicesRepo.getFieldValue returning undefined for all fields results in empty-string fallbacks', () => {
    mockGetFieldValue.mockReturnValue(undefined);
    const factory = getFactory();
    factory({});
    const inst = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    expect(inst.config.bot_token).toBe('');
    expect(inst.config.webhook_url).toBe('');
    expect(inst.config.webhook_secret).toBe('');
  });

  it('factory can be invoked multiple times producing independent TelegramChannelAPI instances', () => {
    const factory = getFactory();
    factory({ bot_token: 'tok1' });
    factory({ bot_token: 'tok2' });
    expect(MockTelegramChannelAPI).toHaveBeenCalledTimes(2);
    const inst0 = MockTelegramChannelAPI.mock.instances[0] as { config: Record<string, unknown> };
    const inst1 = MockTelegramChannelAPI.mock.instances[1] as { config: Record<string, unknown> };
    expect(inst0.config.bot_token).toBe('tok1');
    expect(inst1.config.bot_token).toBe('tok2');
  });

  it('empty config object passed to factory does not throw', () => {
    const factory = getFactory();
    expect(() => factory({})).not.toThrow();
  });

  it('manifest does not expose bot_token or any secrets directly', () => {
    const manifest = build().manifest;
    expect((manifest as Record<string, unknown>).bot_token).toBeUndefined();
    expect((manifest as Record<string, unknown>).webhook_secret).toBeUndefined();
  });

  it('tool executor resolves (does not reject) when everything is connected', async () => {
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => mockChannelApi) });
    await expect(runExecutor({ chat_id: '1', text: 'test' })).resolves.toBeDefined();
  });

  it('tool executor resolves (does not reject) when bot is disconnected', async () => {
    mockChannelApi.getStatus.mockReturnValue('disconnected');
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => mockChannelApi) });
    await expect(runExecutor({ chat_id: '1', text: 'test' })).resolves.toBeDefined();
  });

  it('tool executor resolves (does not reject) when channel is null', async () => {
    mockGetChannelService.mockReturnValue({ getChannel: vi.fn(() => null) });
    await expect(runExecutor({ chat_id: '1', text: 'test' })).resolves.toBeDefined();
  });

  it('manifest.requiredServices is an array', () => {
    const { manifest } = build();
    expect(Array.isArray(manifest.requiredServices)).toBe(true);
  });

  it('manifest.capabilities is an array', () => {
    expect(Array.isArray(build().manifest.capabilities)).toBe(true);
  });

  it('manifest.permissions is an array', () => {
    expect(Array.isArray(build().manifest.permissions)).toBe(true);
  });
});
