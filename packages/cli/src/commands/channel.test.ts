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

function channelListData(
  channels: Array<{
    id: string;
    type: string;
    name: string;
    status: string;
    botInfo?: { username: string; firstName: string };
  }> = []
) {
  const connected = channels.filter((c) => c.status === 'connected').length;
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
      mockFetch.mockResolvedValue(
        apiOk(
          channelListData([
            {
              id: 'channel.telegram',
              type: 'telegram',
              name: 'Telegram',
              status: 'connected',
              botInfo: { username: 'mybot', firstName: 'My Bot' },
            },
          ])
        )
      );

      await channelList();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels',
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        })
      );

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('channel.telegram');
      expect(output).toContain('telegram');
      expect(output).toContain('Telegram');
      expect(output).toContain('@mybot');
    });

    it('shows empty message when no channels', async () => {
      mockFetch.mockResolvedValue(apiOk(channelListData()));

      await channelList();

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('No channels configured');
    });

    it('uses custom gateway URL from env', async () => {
      const origEnv = process.env.OWNPILOT_GATEWAY_URL;
      process.env.OWNPILOT_GATEWAY_URL = 'http://custom:9090';

      mockFetch.mockResolvedValue(apiOk(channelListData()));

      await channelList();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://custom:9090/api/v1/channels',
        expect.any(Object)
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

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
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

      mockFetch.mockResolvedValue(
        apiOk({
          pluginId: 'channel.telegram',
          status: 'connected',
          botInfo: { username: 'testbot', firstName: 'Test Bot' },
        })
      );

      await channelAdd();

      // Verify POST to setup endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels/channel.telegram/setup',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('bot_token'),
        })
      );

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('connected');
      expect(output).toContain('@testbot');
    });

    it('adds a Discord channel', async () => {
      vi.mocked(select).mockResolvedValue('discord');
      vi.mocked(input).mockResolvedValue('a'.repeat(60)); // long token
      vi.mocked(confirm).mockResolvedValue(false);

      mockFetch.mockResolvedValue(
        apiOk({
          pluginId: 'channel.discord',
          status: 'connected',
        })
      );

      await channelAdd();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels/channel.discord/setup',
        expect.objectContaining({ method: 'POST' })
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

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
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
        expect.any(Object)
      );
    });
  });

  // ========================================================================
  // channelConnect
  // ========================================================================

  describe('channelConnect()', () => {
    it('connects a channel by ID', async () => {
      mockFetch
        .mockResolvedValueOnce(
          apiOk(
            channelListData([
              {
                id: 'channel.telegram',
                type: 'telegram',
                name: 'Telegram',
                status: 'disconnected',
              },
            ])
          )
        )
        .mockResolvedValueOnce(apiOk({ pluginId: 'channel.telegram', status: 'connected' }));

      await channelConnect({ id: 'channel.telegram' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels/channel.telegram/connect',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('shows empty message when no channels exist', async () => {
      mockFetch.mockResolvedValue(apiOk(channelListData()));

      await channelConnect({});

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('No channels configured');
    });
  });

  // ========================================================================
  // channelDisconnect
  // ========================================================================

  describe('channelDisconnect()', () => {
    it('disconnects a channel by ID', async () => {
      mockFetch
        .mockResolvedValueOnce(
          apiOk(
            channelListData([
              { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'connected' },
            ])
          )
        )
        .mockResolvedValueOnce(apiOk({ pluginId: 'channel.telegram', status: 'disconnected' }));

      await channelDisconnect({ id: 'channel.telegram' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels/channel.telegram/disconnect',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('shows message when no connected channels', async () => {
      mockFetch.mockResolvedValue(
        apiOk(
          channelListData([
            { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'disconnected' },
          ])
        )
      );

      await channelDisconnect({});

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('No connected channels');
    });
  });

  // ========================================================================
  // channelRemove
  // ========================================================================

  describe('channelRemove()', () => {
    it('shows informational message about plugin-based channels', async () => {
      await channelRemove({});

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('plugin');
      expect(output).toContain('disconnect');
    });
  });

  // ========================================================================
  // apiFetch — error message formats (line 54)
  // ========================================================================

  describe('apiFetch() — error message extraction', () => {
    it('extracts string error field from response body', async () => {
      // Return { error: "some string error" } — triggers the string-error branch (line 54)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Bad request string error' }),
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelList()).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('Bad request string error');

      exitSpy.mockRestore();
    });

    it('falls back to body.message when error field is undefined', async () => {
      // Return { message: "fallback message" } with no error field
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Fallback message from body' }),
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelList()).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('Fallback message from body');

      exitSpy.mockRestore();
    });

    it('falls back to HTTP status code when no error or message fields', async () => {
      // Return empty body — falls through to `HTTP ${res.status}`
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelList()).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('HTTP 503');

      exitSpy.mockRestore();
    });

    it('uses JSON.stringify for error object without message property', async () => {
      // Return { error: { code: "SOME_CODE" } } with no message field in the error object
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 'SOME_CODE' } }),
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelList()).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('SOME_CODE');

      exitSpy.mockRestore();
    });

    it('handles json parse failure in error response', async () => {
      // Return a response where .json() rejects — falls back to {}
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => { throw new Error('not json'); },
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelList()).rejects.toThrow('process.exit');

      // With empty body {}, errField is undefined, body.message is undefined → "HTTP 500"
      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('HTTP 500');

      exitSpy.mockRestore();
    });
  });

  // ========================================================================
  // ensureGatewayError — non-connection error (line 72)
  // ========================================================================

  describe('ensureGatewayError() — non-connection errors', () => {
    it('shows generic error message for non-connection errors', async () => {
      mockFetch.mockRejectedValue(new Error('Some random error'));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelList()).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('Error: Some random error');
      expect(errOutput).not.toContain('Could not reach gateway');

      exitSpy.mockRestore();
    });

    it('shows generic error for non-Error thrown values', async () => {
      mockFetch.mockRejectedValue('string error thrown');

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelList()).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('string error thrown');

      exitSpy.mockRestore();
    });
  });

  // ========================================================================
  // pickChannel — multi-channel select prompt (lines 96-106)
  // ========================================================================

  describe('channelConnect() — pickChannel with multiple channels', () => {
    it('prompts user to select when multiple channels exist and no id provided', async () => {
      const channels = [
        { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'disconnected' },
        { id: 'channel.discord', type: 'discord', name: 'Discord', status: 'disconnected' },
      ];

      mockFetch
        .mockResolvedValueOnce(apiOk(channelListData(channels)))
        .mockResolvedValueOnce(apiOk({ pluginId: 'channel.discord', status: 'connected' }));

      vi.mocked(select).mockResolvedValue('channel.discord');

      await channelConnect({});

      // select should have been called with choices for both channels
      expect(select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('connect'),
          choices: expect.arrayContaining([
            expect.objectContaining({ value: 'channel.telegram' }),
            expect.objectContaining({ value: 'channel.discord' }),
          ]),
        })
      );

      // Should POST to connect the selected channel
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/channels/channel.discord/connect',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('auto-selects when only one channel exists (no prompt)', async () => {
      const channels = [
        { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'disconnected' },
      ];

      mockFetch
        .mockResolvedValueOnce(apiOk(channelListData(channels)))
        .mockResolvedValueOnce(apiOk({ pluginId: 'channel.telegram', status: 'connected' }));

      await channelConnect({});

      // select should NOT have been called since there's only one channel
      expect(select).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // channelConnect — error handling (lines 229-234, 238-239)
  // ========================================================================

  describe('channelConnect() — success result and error handling', () => {
    it('displays status icon and result after successful connect', async () => {
      mockFetch
        .mockResolvedValueOnce(
          apiOk(
            channelListData([
              { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'disconnected' },
            ])
          )
        )
        .mockResolvedValueOnce(apiOk({ pluginId: 'channel.telegram', status: 'connected' }));

      await channelConnect({ id: 'channel.telegram' });

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('channel.telegram');
      expect(output).toContain('connected');
    });

    it('calls ensureGatewayError when connect request fails', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelConnect({ id: 'channel.telegram' })).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('Could not reach gateway');

      exitSpy.mockRestore();
    });

    it('calls ensureGatewayError when connect POST returns error', async () => {
      mockFetch
        .mockResolvedValueOnce(
          apiOk(
            channelListData([
              { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'disconnected' },
            ])
          )
        )
        .mockResolvedValueOnce(apiError('CONNECT_FAILED', 'Token expired'));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelConnect({ id: 'channel.telegram' })).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('Token expired');

      exitSpy.mockRestore();
    });
  });

  // ========================================================================
  // channelDisconnect — no channels (lines 250-252), POST result (262-267),
  //                      error handler (271-272)
  // ========================================================================

  describe('channelDisconnect() — additional coverage', () => {
    it('shows message when no channels configured at all', async () => {
      mockFetch.mockResolvedValue(apiOk(channelListData()));

      await channelDisconnect({});

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('No channels configured');
    });

    it('displays status icon and result after successful disconnect', async () => {
      mockFetch
        .mockResolvedValueOnce(
          apiOk(
            channelListData([
              { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'connected' },
            ])
          )
        )
        .mockResolvedValueOnce(apiOk({ pluginId: 'channel.telegram', status: 'disconnected' }));

      await channelDisconnect({ id: 'channel.telegram' });

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('channel.telegram');
      expect(output).toContain('disconnected');
    });

    it('prompts user to select when multiple connected channels exist', async () => {
      const channels = [
        { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'connected' },
        { id: 'channel.discord', type: 'discord', name: 'Discord', status: 'connected' },
      ];

      mockFetch
        .mockResolvedValueOnce(apiOk(channelListData(channels)))
        .mockResolvedValueOnce(apiOk({ pluginId: 'channel.telegram', status: 'disconnected' }));

      vi.mocked(select).mockResolvedValue('channel.telegram');

      await channelDisconnect({});

      expect(select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('disconnect'),
          choices: expect.arrayContaining([
            expect.objectContaining({ value: 'channel.telegram' }),
            expect.objectContaining({ value: 'channel.discord' }),
          ]),
        })
      );
    });

    it('calls ensureGatewayError when disconnect request fails with ECONNREFUSED', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelDisconnect({ id: 'channel.telegram' })).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('Could not reach gateway');

      exitSpy.mockRestore();
    });

    it('calls ensureGatewayError when disconnect POST returns error', async () => {
      mockFetch
        .mockResolvedValueOnce(
          apiOk(
            channelListData([
              { id: 'channel.telegram', type: 'telegram', name: 'Telegram', status: 'connected' },
            ])
          )
        )
        .mockResolvedValueOnce(apiError('DISCONNECT_FAILED', 'Already disconnecting'));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(channelDisconnect({ id: 'channel.telegram' })).rejects.toThrow('process.exit');

      const errOutput = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errOutput).toContain('Already disconnecting');

      exitSpy.mockRestore();
    });
  });

  // ========================================================================
  // channelAdd — token validation and allowed_users (lines 168, 176-179)
  // ========================================================================

  describe('channelAdd() — additional coverage', () => {
    it('collects allowed_users when user confirms restricting to specific users', async () => {
      vi.mocked(select).mockResolvedValue('telegram');
      vi.mocked(input)
        .mockResolvedValueOnce('123:ABC')          // bot_token
        .mockResolvedValueOnce('12345,67890');      // allowed_users
      vi.mocked(confirm).mockResolvedValue(true);   // restrictUsers = true

      mockFetch.mockResolvedValue(
        apiOk({
          pluginId: 'channel.telegram',
          status: 'connected',
          botInfo: { username: 'testbot', firstName: 'Test Bot' },
        })
      );

      await channelAdd();

      // Verify POST body includes both bot_token and allowed_users
      const postCall = mockFetch.mock.calls.find(
        (c) => typeof c[1] === 'object' && (c[1] as RequestInit).method === 'POST'
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body.config.bot_token).toBe('123:ABC');
      expect(body.config.allowed_users).toBe('12345,67890');
    });

    it('does not include allowed_users when user declines restriction', async () => {
      vi.mocked(select).mockResolvedValue('telegram');
      vi.mocked(input).mockResolvedValue('123:ABC');
      vi.mocked(confirm).mockResolvedValue(false); // restrictUsers = false

      mockFetch.mockResolvedValue(
        apiOk({
          pluginId: 'channel.telegram',
          status: 'connected',
        })
      );

      await channelAdd();

      const postCall = mockFetch.mock.calls.find(
        (c) => typeof c[1] === 'object' && (c[1] as RequestInit).method === 'POST'
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as RequestInit).body as string);
      expect(body.config.bot_token).toBe('123:ABC');
      expect(body.config.allowed_users).toBeUndefined();
    });

    it('shows result without botInfo when not provided by server', async () => {
      vi.mocked(select).mockResolvedValue('telegram');
      vi.mocked(input).mockResolvedValue('123:ABC');
      vi.mocked(confirm).mockResolvedValue(false);

      mockFetch.mockResolvedValue(
        apiOk({
          pluginId: 'channel.telegram',
          status: 'connected',
          // no botInfo
        })
      );

      await channelAdd();

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('connected');
      expect(output).not.toContain('@');
    });

    it('silently returns when user cancels prompt (ExitPromptError)', async () => {
      vi.mocked(select).mockRejectedValue(new Error('ExitPromptError'));

      await channelAdd();

      // Should not call process.exit or show error
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // channelList — channel without botInfo
  // ========================================================================

  describe('channelList() — channels without botInfo', () => {
    it('displays empty bot column when channel has no botInfo', async () => {
      mockFetch.mockResolvedValue(
        apiOk(
          channelListData([
            {
              id: 'channel.telegram',
              type: 'telegram',
              name: 'Telegram',
              status: 'disconnected',
              // no botInfo
            },
          ])
        )
      );

      await channelList();

      const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('channel.telegram');
      expect(output).not.toContain('@');
    });
  });
});
