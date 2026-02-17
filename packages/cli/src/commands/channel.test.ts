/**
 * Channel CLI Commands Tests
 *
 * Tests channel management commands that call the gateway REST API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ============================================================================
// Helpers
// ============================================================================

function apiOk<T>(data: T) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  };
}

function apiError(code: string, message: string, status = 500) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message } }),
  };
}

function channelListData(channels: Array<{
  id: string;
  type: string;
  name: string;
  status: string;
  botInfo?: { username: string; firstName: string };
}> = []) {
  const connected = channels.filter(c => c.status === 'connected').length;
  return {
    channels,
    summary: {
      total: channels.length,
      connected,
      disconnected: channels.length - connected,
    },
    availableTypes: ['telegram', 'discord'],
  };
}

// ============================================================================
// Tests
// ============================================================================

import {
  channelList,
  channelAdd,
  channelStatus,
  channelConnect,
  channelDisconnect,
  channelRemove,
} from './channel.js';

import { select, input, confirm } from '@inquirer/prompts';

describe('Channel CLI Commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // ========================================================================
  // channelList
  // ========================================================================

  describe('channelList()', () => {
    it('displays channels in table format', async () => {
      mockFetch.mockResolvedValue(apiOk(channelListData([
        { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'connected', botInfo: { username: 'mybot', firstName: 'My Bot' } },
      ])));

      await channelList();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels',
        expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
      );

      const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('channel.telegram');
      expect(output).toContain('telegram');
      expect(output).toContain('Telegram');
      expect(output).toContain('@mybot');
    });

    it('shows empty message when no channels', async () => {
      mockFetch.mockResolvedValue(apiOk(channelListData()));

      await channelList();

      const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('No channels configured');
    });

    it('uses custom gateway URL from env', async () => {
      const origEnv = process.env.OWNPILOT_GATEWAY_URL;
      process.env.OWNPILOT_GATEWAY_URL = 'http://custom:9090';

      mockFetch.mockResolvedValue(apiOk(channelListData()));

      await channelList();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom:9090/api/v1/channels',
        expect.any(Object),
      );

      // delete instead of assign — assigning undefined to process.env creates string "undefined"
      if (origEnv === undefined) {
        delete process.env.OWNPILOT_GATEWAY_URL;
      } else {
        process.env.OWNPILOT_GATEWAY_URL = origEnv;
      }
    });

    it('shows connection error when gateway unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('fetch failed'));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelList()).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(errOutput).toContain('Could not reach gateway');

      exitSpy.mockRestore();
    });
  });

  // ========================================================================
  // channelAdd
  // ========================================================================

  describe('channelAdd()', () => {
    it('adds a Telegram channel via quick setup', async () => {
      vi.mocked(select).mockResolvedValue('telegram');
      vi.mocked(input).mockResolvedValue('123:ABC');
      vi.mocked(confirm).mockResolvedValue(false);

      mockFetch.mockResolvedValue(apiOk({
        pluginId: 'channel.telegram',
        status: 'connected',
        botInfo: { username: 'testbot', firstName: 'Test Bot' },
      }));

      await channelAdd();

      // Verify POST to setup endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels/channel.telegram/setup',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('bot_token'),
        }),
      );

      const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('connected');
      expect(output).toContain('@testbot');
    });

    it('adds a Discord channel', async () => {
      vi.mocked(select).mockResolvedValue('discord');
      vi.mocked(input).mockResolvedValue('a'.repeat(60)); // long token
      vi.mocked(confirm).mockResolvedValue(false);

      mockFetch.mockResolvedValue(apiOk({
        pluginId: 'channel.discord',
        status: 'connected',
      }));

      await channelAdd();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels/channel.discord/setup',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('handles setup failure', async () => {
      vi.mocked(select).mockResolvedValue('telegram');
      vi.mocked(input).mockResolvedValue('bad-token');
      vi.mocked(confirm).mockResolvedValue(false);

      mockFetch.mockResolvedValue(apiError('CONNECTION_FAILED', 'Invalid token'));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelAdd()).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(errOutput).toContain('Invalid token');

      exitSpy.mockRestore();
    });
  });

  // ========================================================================
  // channelStatus (alias for list)
  // ========================================================================

  describe('channelStatus()', () => {
    it('delegates to channelList', async () => {
      mockFetch.mockResolvedValue(apiOk(channelListData()));

      await channelStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/channels'),
        expect.any(Object),
      );
    });
  });

  // ========================================================================
  // channelConnect
  // ========================================================================

  describe('channelConnect()', () => {
    it('connects a channel by ID', async () => {
      mockFetch
        .mockResolvedValueOnce(apiOk(channelListData([
          { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'disconnected' },
        ])))
        .mockResolvedValueOnce(apiOk({ pluginId: 'channel.telegram', status: 'connected' }));

      await channelConnect({ id: 'channel.telegram' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels/channel.telegram/connect',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('shows empty message when no channels exist', async () => {
      mockFetch.mockResolvedValue(apiOk(channelListData()));

      await channelConnect({});

      const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('No channels configured');
    });
  });

  // ========================================================================
  // channelDisconnect
  // ========================================================================

  describe('channelDisconnect()', () => {
    it('disconnects a channel by ID', async () => {
      mockFetch
        .mockResolvedValueOnce(apiOk(channelListData([
          { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'connected' },
        ])))
        .mockResolvedValueOnce(apiOk({ pluginId: 'channel.telegram', status: 'disconnected' }));

      await channelDisconnect({ id: 'channel.telegram' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels/channel.telegram/disconnect',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('shows message when no connected channels', async () => {
      mockFetch.mockResolvedValue(apiOk(channelListData([
        { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'disconnected' },
      ])));

      await channelDisconnect({});

      const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('No connected channels');
    });
  });

  // ========================================================================
  // channelRemove
  // ========================================================================

  describe('channelRemove()', () => {
    it('shows informational message about plugin-based channels', async () => {
      await channelRemove({});

      const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(output).toContain('plugin');
      expect(output).toContain('disconnect');
    });
  });
});
