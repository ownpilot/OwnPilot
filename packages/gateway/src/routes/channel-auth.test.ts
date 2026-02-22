/**
 * Channel Auth Routes Tests
 *
 * Tests for channel user verification, blocking, and listing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// ─── Mock Dependencies ──────────────────────────────────────────
// Use vi.hoisted() so mock objects are available before vi.mock() hoisting

const { mockVerificationService, mockChannelUsersRepo } = vi.hoisted(() => ({
  mockVerificationService: {
    generateToken: vi.fn(),
    isVerified: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
  },
  mockChannelUsersRepo: {
    findByPlatform: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock('../channels/auth/verification.js', () => ({
  getChannelVerificationService: vi.fn(() => mockVerificationService),
}));

vi.mock('../db/repositories/channel-users.js', () => ({
  channelUsersRepo: mockChannelUsersRepo,
}));

// ─── Import route ───────────────────────────────────────────────

import { channelAuthRoutes } from './channel-auth.js';
import { errorHandler } from '../middleware/error-handler.js';

// ─── Helpers ────────────────────────────────────────────────────

function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    ownpilotUserId: 'default',
    platform: 'telegram',
    platformUserId: 'tg-12345',
    platformUsername: 'testuser',
    displayName: 'Test User',
    isVerified: true,
    verificationMethod: 'pin',
    verifiedAt: new Date('2024-06-01'),
    isBlocked: false,
    firstSeenAt: new Date('2024-01-01'),
    lastSeenAt: new Date('2024-06-15'),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Channel Auth Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.onError(errorHandler);
    app.route('/auth', channelAuthRoutes);
    vi.clearAllMocks();
  });

  // ─── POST /generate-token ────────────────────────────────────

  describe('POST /auth/generate-token', () => {
    it('should generate a verification token', async () => {
      mockVerificationService.generateToken.mockResolvedValue({
        token: 'ABC123',
        expiresAt: new Date('2024-06-01T12:00:00Z'),
      });

      const res = await app.request('/auth/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user-1', platform: 'telegram', type: 'pin' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.token).toBe('ABC123');
      expect(data.data.expiresAt).toBe('2024-06-01T12:00:00.000Z');
      expect(data.data.instructions).toContain('/connect ABC123');
    });

    it('should use defaults when optional fields are omitted', async () => {
      mockVerificationService.generateToken.mockResolvedValue({
        token: 'XYZ789',
        expiresAt: new Date('2024-06-01T13:00:00Z'),
      });

      const res = await app.request('/auth/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.token).toBe('XYZ789');
      expect(mockVerificationService.generateToken).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({ platform: undefined })
      );
    });
  });

  // ─── GET /status/:platform/:platformUserId ───────────────────

  describe('GET /auth/status/:platform/:platformUserId', () => {
    it('should return verified status with user details', async () => {
      mockVerificationService.isVerified.mockResolvedValue(true);
      mockChannelUsersRepo.findByPlatform.mockResolvedValue(mockUser());

      const res = await app.request('/auth/status/telegram/tg-12345');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.platform).toBe('telegram');
      expect(data.data.platformUserId).toBe('tg-12345');
      expect(data.data.isVerified).toBe(true);
      expect(data.data.user).not.toBeNull();
      expect(data.data.user.id).toBe('user-1');
      expect(data.data.user.displayName).toBe('Test User');
      expect(data.data.user.verificationMethod).toBe('pin');
    });

    it('should return unverified status with null user', async () => {
      mockVerificationService.isVerified.mockResolvedValue(false);
      mockChannelUsersRepo.findByPlatform.mockResolvedValue(null);

      const res = await app.request('/auth/status/telegram/tg-999');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.platform).toBe('telegram');
      expect(data.data.platformUserId).toBe('tg-999');
      expect(data.data.isVerified).toBe(false);
      expect(data.data.user).toBeNull();
    });
  });

  // ─── POST /block/:platform/:platformUserId ───────────────────

  describe('POST /auth/block/:platform/:platformUserId', () => {
    it('should block a user successfully', async () => {
      mockVerificationService.blockUser.mockResolvedValue(true);

      const res = await app.request('/auth/block/telegram/tg-12345', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(mockVerificationService.blockUser).toHaveBeenCalledWith('telegram', 'tg-12345');
    });

    it('should return false when user not found', async () => {
      mockVerificationService.blockUser.mockResolvedValue(false);

      const res = await app.request('/auth/block/telegram/unknown-user', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.blocked).toBe(false);
    });
  });

  // ─── POST /unblock/:platform/:platformUserId ─────────────────

  describe('POST /auth/unblock/:platform/:platformUserId', () => {
    it('should unblock a user successfully', async () => {
      mockVerificationService.unblockUser.mockResolvedValue(true);

      const res = await app.request('/auth/unblock/telegram/tg-12345', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(mockVerificationService.unblockUser).toHaveBeenCalledWith('telegram', 'tg-12345');
    });
  });

  // ─── GET /users ───────────────────────────────────────────────

  describe('GET /auth/users', () => {
    it('should return empty user list', async () => {
      mockChannelUsersRepo.list.mockResolvedValue([]);

      const res = await app.request('/auth/users');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.users).toEqual([]);
      expect(data.data.count).toBe(0);
      expect(data.data.limit).toBe(100);
      expect(data.data.offset).toBe(0);
    });

    it('should return users with details', async () => {
      mockChannelUsersRepo.list.mockResolvedValue([
        mockUser(),
        mockUser({
          id: 'user-2',
          platformUserId: 'tg-67890',
          displayName: 'User Two',
          isBlocked: true,
        }),
      ]);

      const res = await app.request('/auth/users');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.users).toHaveLength(2);
      expect(data.data.users[0].id).toBe('user-1');
      expect(data.data.users[0].displayName).toBe('Test User');
      expect(data.data.users[0].isBlocked).toBe(false);
      expect(data.data.users[1].isBlocked).toBe(true);
      expect(data.data.count).toBe(2);
    });

    it('should pass filter params', async () => {
      mockChannelUsersRepo.list.mockResolvedValue([]);

      await app.request('/auth/users?platform=telegram&verified=true&limit=10&offset=5');

      expect(mockChannelUsersRepo.list).toHaveBeenCalledWith({
        platform: 'telegram',
        isVerified: true,
        limit: 10,
        offset: 5,
      });
    });

    it('should pass verified=false filter', async () => {
      mockChannelUsersRepo.list.mockResolvedValue([]);

      await app.request('/auth/users?verified=false');

      expect(mockChannelUsersRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ isVerified: false })
      );
    });
  });
});
