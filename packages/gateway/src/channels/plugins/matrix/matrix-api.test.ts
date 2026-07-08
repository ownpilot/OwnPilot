import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { MatrixChannelAPI } from './matrix-api.js';

// =============================================================================
// Mocks
// =============================================================================

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// =============================================================================
// Helpers
// =============================================================================

function createAPI(config: Record<string, unknown> = {}, pluginId = 'channel.matrix') {
  return new MatrixChannelAPI(config, pluginId);
}

function makeSyncResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      next_batch: 's1',
      rooms: { join: {}, invite: {} },
      ...overrides,
    }),
  } as never;
}

function makeWhoamiResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ user_id: '@bot:example.com', ...overrides }),
  } as never;
}

// =============================================================================
// Tests
// =============================================================================

describe('MatrixChannelAPI', () => {
  // ── Constructor ──────────────────────────────────────────────────────

  describe('constructor', () => {
    it('parses allowed_rooms into a set', () => {
      const api = createAPI({
        homeserver_url: 'https://hs.example',
        access_token: 'tok',
        user_id: '@bot:hs',
        allowed_rooms: '!room1:hs, !room2:hs',
      });
      const allowedRooms = (api as unknown as { allowedRooms: Set<string> }).allowedRooms;
      expect(allowedRooms.has('!room1:hs')).toBe(true);
      expect(allowedRooms.has('!room2:hs')).toBe(true);
      expect(allowedRooms.size).toBe(2);
    });

    it('trims trailing slash from homeserver_url', () => {
      const api = createAPI({
        homeserver_url: 'https://hs.example/',
        access_token: 'tok',
        user_id: '@bot:hs',
      });
      const config = (api as unknown as { config: { homeserver_url: string } }).config;
      expect(config.homeserver_url).toBe('https://hs.example');
    });

    it('defaults auto_join to true', () => {
      const api = createAPI({
        homeserver_url: 'https://hs.example',
        access_token: 'tok',
        user_id: '@bot:hs',
      });
      const config = (api as unknown as { config: { auto_join?: boolean } }).config;
      expect(config.auto_join).toBe(true);
    });
  });

  // ── Connect (existing idempotency tests + new) ───────────────────────

  describe('connect() idempotency', () => {
    it('skips a redundant connect when already connected (no second sync loop)', async () => {
      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );
      (api as unknown as { status: string }).status = 'connected';
      await api.connect();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('also skips when a connect is already in flight (connecting)', async () => {
      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );
      (api as unknown as { status: string }).status = 'connecting';
      await api.connect();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns early and sets error when credentials missing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const api = createAPI({ homeserver_url: '', access_token: '', user_id: '' });
      await api.connect();
      expect(api.getStatus()).toBe('error');
      warnSpy.mockRestore();
    });

    it('sets error status when whoami fails', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401 } as never);
      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'bad-token', user_id: '@bot:hs' },
        'channel.matrix'
      );
      await api.connect();
      expect(api.getStatus()).toBe('error');
    });

    it('connects successfully and starts sync', async () => {
      // First call: whoami succeeds
      fetchMock.mockResolvedValueOnce(makeWhoamiResponse());
      // Second call: initial sync (timeout=0)
      fetchMock.mockResolvedValueOnce(makeSyncResponse());

      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );

      await api.connect();
      expect(api.getStatus()).toBe('connected');
    });
  });

  // ── Disconnect ───────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('stops sync and sets disconnected', async () => {
      const api = createAPI({
        homeserver_url: 'https://hs.example',
        access_token: 'tok',
        user_id: '@bot:hs',
      });
      await api.disconnect();
      expect(api.getStatus()).toBe('disconnected');
    });
  });

  // ── sendMessage ──────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('throws when status is not connected', async () => {
      const api = createAPI();
      await expect(api.sendMessage({ platformChatId: '!room:hs', text: 'Hello' })).rejects.toThrow(
        'Matrix channel not connected'
      );
    });

    it('sends message successfully when connected', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ event_id: '$evt1:hs' }),
      } as never);

      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );
      (api as unknown as { status: string }).status = 'connected';

      const result = await api.sendMessage({ platformChatId: '!room:hs', text: 'Hello' });
      expect(result).toBe('$evt1:hs');
    });

    it('throws when send API returns error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      } as never);

      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );
      (api as unknown as { status: string }).status = 'connected';

      await expect(api.sendMessage({ platformChatId: '!room:hs', text: 'Hello' })).rejects.toThrow(
        'Matrix API error 400'
      );
    });
  });

  // ── getStatus / getPlatform ──────────────────────────────────────────

  describe('getStatus / getPlatform', () => {
    it('returns disconnected initially', () => {
      const api = createAPI();
      expect(api.getStatus()).toBe('disconnected');
    });

    it('returns matrix platform', () => {
      const api = createAPI();
      expect(api.getPlatform()).toBe('matrix');
    });
  });

  // ── sendTyping ───────────────────────────────────────────────────────

  describe('sendTyping', () => {
    it('calls PUT /typing endpoint', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as never);

      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );

      await api.sendTyping('!room:hs');

      // Verify the fetch was called with typing endpoint
      const callUrl = fetchMock.mock.calls[0][0] as string;
      expect(callUrl).toContain('/typing/');
      expect(callUrl).toContain(encodeURIComponent('@bot:hs'));
    });

    it('handles errors gracefully', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network error'));
      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );

      await api.sendTyping('!room:hs'); // Should not throw
    });
  });

  // ── matrixFetch (private) ────────────────────────────────────────────

  describe('matrixFetch (tested via API calls)', () => {
    it('adds Authorization header', async () => {
      fetchMock.mockResolvedValueOnce(makeWhoamiResponse());
      fetchMock.mockResolvedValueOnce(makeSyncResponse());

      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'secr3t', user_id: '@bot:hs' },
        'channel.matrix'
      );
      await api.connect();

      const callHeaders = fetchMock.mock.calls[0][1] as Record<string, unknown>;
      expect((callHeaders.headers as Record<string, string>).Authorization).toBe('Bearer secr3t');
    });

    it('adds Content-Type for body requests', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ event_id: '$evt1:hs' }),
      } as never);

      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );
      (api as unknown as { status: string }).status = 'connected';

      await api.sendMessage({ platformChatId: '!room:hs', text: 'Hello' });

      const callHeaders = fetchMock.mock.calls[0][1] as Record<string, unknown>;
      expect((callHeaders.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json'
      );
    });

    it('uses default timeout signal when none provided', async () => {
      fetchMock.mockResolvedValueOnce(makeWhoamiResponse());
      fetchMock.mockResolvedValueOnce(makeSyncResponse());

      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );

      // Set connected to prevent whoami call, call sendMessage directly
      (api as unknown as { status: string }).status = 'connected';
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ event_id: '$evt' }),
      } as never);

      await api.sendMessage({ platformChatId: '!room:hs', text: 'Hi' });

      const callOpts = fetchMock.mock.calls[0][1] as Record<string, unknown>;
      expect(callOpts.signal).toBeDefined();
    });
  });

  // ── Initial sync ─────────────────────────────────────────────────────

  describe('initial sync', () => {
    it('calls /sync with timeout=0 for initial sync', async () => {
      fetchMock.mockResolvedValueOnce(makeWhoamiResponse());
      fetchMock.mockResolvedValueOnce(makeSyncResponse());

      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );

      await api.connect();

      // Second call should be initial sync
      const callUrl = fetchMock.mock.calls[1][0] as string;
      expect(callUrl).toContain('/sync');
      expect(callUrl).toContain('timeout=0');
    });
  });

  // ── handleRoomEvent (via sync parsing) ──────────────────────────────

  describe('handleRoomEvent', () => {
    it('processes m.room.message events', async () => {
      // Can't easily test the private method directly, but verify through
      // public API that it doesn't crash when sync returns events
      fetchMock.mockResolvedValueOnce(makeWhoamiResponse());
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          next_batch: 's2',
          rooms: {
            join: {
              '!room:hs': {
                timeline: {
                  events: [
                    {
                      type: 'm.room.message',
                      event_id: '$evt1',
                      sender: '@user:hs',
                      origin_server_ts: 1700000000000,
                      content: { msgtype: 'm.text', body: 'Hello!' },
                    },
                  ],
                },
              },
            },
          },
        }),
      } as never);

      const api = createAPI(
        { homeserver_url: 'https://hs.example', access_token: 'tok', user_id: '@bot:hs' },
        'channel.matrix'
      );

      await api.connect();
      expect(api.getStatus()).toBe('connected');
    });
  });
});
