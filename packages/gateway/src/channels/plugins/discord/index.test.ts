/**
 * Tests for Discord Channel Plugin Builder
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getFieldValue: vi.fn(() => undefined),
  },
}));

vi.mock('./discord-api.js', () => ({
  // Must use regular function (not arrow) so `new DiscordChannelAPI(...)` works
  DiscordChannelAPI: vi.fn(function (_config: unknown, _id: string) {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendMessage: vi.fn(),
      getStatus: vi.fn(() => 'disconnected'),
      getPlatform: vi.fn(() => 'discord'),
    };
  }),
}));

import { buildDiscordChannelPlugin } from './index.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildDiscordChannelPlugin()', () => {
  const result = buildDiscordChannelPlugin();

  describe('manifest', () => {
    it('should have correct plugin ID', () => {
      expect(result.manifest.id).toBe('channel.discord');
    });

    it('should have correct name', () => {
      expect(result.manifest.name).toBe('Discord');
    });

    it('should be categorized as channel', () => {
      expect(result.manifest.category).toBe('channel');
    });

    it('should declare discord platform', () => {
      expect(result.manifest.platform).toBe('discord');
    });

    it('should have version 1.0.0', () => {
      expect(result.manifest.version).toBe('1.0.0');
    });
  });

  describe('requiredServices', () => {
    const requiredServices = result.manifest.requiredServices as Array<{
      name: string;
      displayName: string;
      category: string;
      configSchema: Array<{ name: string; type: string; required?: boolean }>;
    }>;

    it('should require discord_bot service', () => {
      expect(requiredServices).toHaveLength(1);
      expect(requiredServices[0]!.name).toBe('discord_bot');
    });

    it('should have correct display name', () => {
      expect(requiredServices[0]!.displayName).toBe('Discord Bot');
    });

    it('should be in channels category', () => {
      expect(requiredServices[0]!.category).toBe('channels');
    });

    it('should require bot_token as secret', () => {
      const schema = requiredServices[0]!.configSchema;
      const tokenField = schema.find((f) => f.name === 'bot_token');
      expect(tokenField).toBeDefined();
      expect(tokenField!.type).toBe('secret');
      expect(tokenField!.required).toBe(true);
    });

    it('should have guild_ids field', () => {
      const schema = requiredServices[0]!.configSchema;
      const guildField = schema.find((f) => f.name === 'guild_ids');
      expect(guildField).toBeDefined();
      expect(guildField!.type).toBe('string');
    });

    it('should have allowed_channels field', () => {
      const schema = requiredServices[0]!.configSchema;
      const channelField = schema.find((f) => f.name === 'allowed_channels');
      expect(channelField).toBeDefined();
      expect(channelField!.type).toBe('string');
    });
  });

  describe('implementation', () => {
    it('should include channelApiFactory', () => {
      expect(typeof result.implementation.channelApiFactory).toBe('function');
    });

    it('should create DiscordChannelAPI from factory', () => {
      const factory = result.implementation.channelApiFactory!;
      const api = factory({ bot_token: 'test-token' });
      expect(api).toBeDefined();
      expect(typeof api.connect).toBe('function');
      expect(typeof api.sendMessage).toBe('function');
    });
  });
});
