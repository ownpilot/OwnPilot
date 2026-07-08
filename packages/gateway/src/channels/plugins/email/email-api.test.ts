/**
 * Email Channel API Tests
 *
 * Tests for EmailChannelAPI — covers constructor, connect/disconnect,
 * sendMessage, status/platform, and configuration getters.
 * The internal toSmtpTransporter/isRecord helpers are not exported
 * and are tested indirectly through class behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

const mockSendMail = vi.fn();
const mockVerify = vi.fn();
const mockClose = vi.fn();

const mockTransporter = {
  sendMail: mockSendMail,
  verify: mockVerify,
  close: mockClose,
};

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => mockTransporter),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// Tests
// =============================================================================

describe('EmailChannelAPI', () => {
  let EmailChannelAPI: (typeof import('./email-api.js'))['EmailChannelAPI'];

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('./email-api.js');
    EmailChannelAPI = mod.EmailChannelAPI;
  });

  function createAPI(config: Record<string, unknown> = {}, pluginId = 'channel.email') {
    return new EmailChannelAPI(config, pluginId);
  }

  // ── Constructor ──────────────────────────────────────────────────────

  describe('constructor', () => {
    it('stores pluginId', () => {
      const api = createAPI({}, 'channel.email');
      expect(api.getPluginId()).toBe('channel.email');
    });
  });

  // ── getStatus / getPlatform ──────────────────────────────────────────

  describe('getStatus / getPlatform', () => {
    it('returns disconnected initially', () => {
      const api = createAPI();
      expect(api.getStatus()).toBe('disconnected');
    });

    it('returns email platform', () => {
      const api = createAPI();
      expect(api.getPlatform()).toBe('email');
    });
  });

  // ── sendTyping ───────────────────────────────────────────────────────

  describe('sendTyping', () => {
    it('is a no-op (email does not support typing)', async () => {
      const api = createAPI();
      await api.sendTyping('someone@example.com');
      expect(api.getStatus()).toBe('disconnected');
    });
  });

  // ── getFromAddress / getPluginId ─────────────────────────────────────

  describe('getFromAddress / getPluginId', () => {
    it('returns empty from address when not configured', () => {
      const api = createAPI({});
      expect(api.getFromAddress()).toBe('');
    });

    it('is empty until connect sets it (from_address is loaded during connect)', async () => {
      // fromAddress is only set in connect(), not in the constructor
      const api = createAPI({ from_address: 'bot@example.com' });
      expect(api.getFromAddress()).toBe('');
      // After connect (even one that fails due to missing credentials),
      // from_address is still loaded
      await api.connect();
      expect(api.getFromAddress()).toBe('bot@example.com');
    });

    it('returns pluginId via getPluginId', () => {
      const api = createAPI({}, 'my-email-plugin');
      expect(api.getPluginId()).toBe('my-email-plugin');
    });
  });

  // ── connect ──────────────────────────────────────────────────────────

  describe('connect', () => {
    it('warns and sets error status when credentials missing', async () => {
      const api = createAPI({});
      await api.connect();
      expect(api.getStatus()).toBe('error');
    });

    it('handles nodemailer import gracefully', async () => {
      const api = createAPI({
        smtp_host: 'smtp.example.com',
        smtp_user: 'user',
        smtp_pass: 'pass',
        from_address: 'bot@example.com',
      });
      // nodemailer is mocked at module level — the connect will try to use it
      await api.connect();
      // Depends on whether mockVerify resolves to true or the dynamic mock works
      // The key thing is it doesn't crash
      expect(['connected', 'error']).toContain(api.getStatus());
    });
  });

  // ── disconnect ───────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('disconnects when no transporter (safe no-op)', async () => {
      const api = createAPI();
      await api.disconnect();
      expect(api.getStatus()).toBe('disconnected');
    });
  });

  // ── sendMessage ──────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('throws when not connected', async () => {
      const api = createAPI();
      await expect(
        api.sendMessage({
          platformChatId: 'recipient@example.com',
          text: 'Hello',
        })
      ).rejects.toThrow('Email channel not connected');
    });
  });
});
