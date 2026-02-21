import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ownpilot/core', () => ({
  getEventBus: vi.fn(),
  createEvent: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../../db/repositories/channel-verification.js', () => ({
  ChannelVerificationRepository: vi.fn(),
  channelVerificationRepo: {},
}));

vi.mock('../../db/repositories/channel-users.js', () => ({
  ChannelUsersRepository: vi.fn(),
  channelUsersRepo: {},
}));

import { getEventBus } from '@ownpilot/core';
import {
  ChannelVerificationService,
  getChannelVerificationService,
} from './verification.js';

// ---------------------------------------------------------------------------
// Mock repos
// ---------------------------------------------------------------------------

function createMockVerificationRepo() {
  return {
    generateToken: vi.fn(),
    findValidToken: vi.fn(),
    consumeToken: vi.fn(),
    cleanupExpired: vi.fn(),
  };
}

function createMockUsersRepo() {
  return {
    findOrCreate: vi.fn(),
    markVerified: vi.fn(),
    findByPlatform: vi.fn(),
    block: vi.fn(),
    unblock: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChannelUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cu-1',
    ownpilotUserId: 'owner-1',
    platform: 'telegram',
    platformUserId: 'tg-123',
    displayName: 'Alice',
    isVerified: false,
    isBlocked: false,
    metadata: {},
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    ...overrides,
  };
}

function makeTokenEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    ownpilotUserId: 'owner-1',
    token: 'ABC123',
    expiresAt: new Date(Date.now() + 600_000),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelVerificationService', () => {
  let service: ChannelVerificationService;
  let mockVerificationRepo: ReturnType<typeof createMockVerificationRepo>;
  let mockUsersRepo: ReturnType<typeof createMockUsersRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerificationRepo = createMockVerificationRepo();
    mockUsersRepo = createMockUsersRepo();
    service = new ChannelVerificationService(
      mockVerificationRepo as any,
      mockUsersRepo as any
    );
  });

  // =========================================================================
  // generateToken
  // =========================================================================

  describe('generateToken', () => {
    it('should delegate to verificationRepo with correct args', async () => {
      const result = { token: 'PIN-9999', expiresAt: new Date() };
      mockVerificationRepo.generateToken.mockResolvedValue(result);

      await service.generateToken('user-1');

      expect(mockVerificationRepo.generateToken).toHaveBeenCalledWith(
        'user-1',
        undefined
      );
    });

    it('should return token and expiresAt from repo', async () => {
      const expiresAt = new Date('2026-03-01T00:00:00Z');
      mockVerificationRepo.generateToken.mockResolvedValue({
        token: 'XYZ',
        expiresAt,
      });

      const result = await service.generateToken('user-1');

      expect(result).toEqual({ token: 'XYZ', expiresAt });
    });

    it('should pass options through to repo', async () => {
      const options = { platform: 'telegram', ttlMinutes: 30, type: 'pin' as const };
      mockVerificationRepo.generateToken.mockResolvedValue({
        token: 'T',
        expiresAt: new Date(),
      });

      await service.generateToken('user-1', options);

      expect(mockVerificationRepo.generateToken).toHaveBeenCalledWith(
        'user-1',
        options
      );
    });
  });

  // =========================================================================
  // verifyToken
  // =========================================================================

  describe('verifyToken', () => {
    const token = 'ABC123';
    const platform = 'telegram';
    const platformUserId = 'tg-123';
    const displayName = 'Alice';

    it('should return success when token is valid', async () => {
      const tokenEntity = makeTokenEntity();
      const channelUser = makeChannelUser();
      mockVerificationRepo.findValidToken.mockResolvedValue(tokenEntity);
      mockUsersRepo.findOrCreate.mockResolvedValue(channelUser);
      mockUsersRepo.markVerified.mockResolvedValue(undefined);
      mockVerificationRepo.consumeToken.mockResolvedValue(undefined);
      vi.mocked(getEventBus).mockReturnValue({ emit: vi.fn() } as any);

      const result = await service.verifyToken(
        token,
        platform,
        platformUserId,
        displayName
      );

      expect(result).toEqual({
        success: true,
        ownpilotUserId: 'owner-1',
      });
    });

    it('should return error when token is invalid or expired', async () => {
      mockVerificationRepo.findValidToken.mockResolvedValue(null);

      const result = await service.verifyToken(
        token,
        platform,
        platformUserId,
        displayName
      );

      expect(result).toEqual({
        success: false,
        error: 'Invalid or expired token.',
      });
      expect(mockUsersRepo.findOrCreate).not.toHaveBeenCalled();
    });

    it('should call findOrCreate with correct data', async () => {
      const tokenEntity = makeTokenEntity();
      mockVerificationRepo.findValidToken.mockResolvedValue(tokenEntity);
      mockUsersRepo.findOrCreate.mockResolvedValue(makeChannelUser());
      vi.mocked(getEventBus).mockReturnValue({ emit: vi.fn() } as any);

      await service.verifyToken(
        token,
        platform,
        platformUserId,
        displayName,
        'alice_tg'
      );

      expect(mockUsersRepo.findOrCreate).toHaveBeenCalledWith({
        platform,
        platformUserId,
        displayName,
        platformUsername: 'alice_tg',
        ownpilotUserId: tokenEntity.ownpilotUserId,
      });
    });

    it('should call markVerified with pin method', async () => {
      const tokenEntity = makeTokenEntity();
      const channelUser = makeChannelUser({ id: 'cu-42' });
      mockVerificationRepo.findValidToken.mockResolvedValue(tokenEntity);
      mockUsersRepo.findOrCreate.mockResolvedValue(channelUser);
      vi.mocked(getEventBus).mockReturnValue({ emit: vi.fn() } as any);

      await service.verifyToken(token, platform, platformUserId, displayName);

      expect(mockUsersRepo.markVerified).toHaveBeenCalledWith(
        'cu-42',
        tokenEntity.ownpilotUserId,
        'pin'
      );
    });

    it('should call consumeToken with correct IDs', async () => {
      const tokenEntity = makeTokenEntity({ id: 'tok-99' });
      const channelUser = makeChannelUser({ id: 'cu-42' });
      mockVerificationRepo.findValidToken.mockResolvedValue(tokenEntity);
      mockUsersRepo.findOrCreate.mockResolvedValue(channelUser);
      vi.mocked(getEventBus).mockReturnValue({ emit: vi.fn() } as any);

      await service.verifyToken(token, platform, platformUserId, displayName);

      expect(mockVerificationRepo.consumeToken).toHaveBeenCalledWith(
        'tok-99',
        'cu-42'
      );
    });

    it('should emit channel.user.verified event on success', async () => {
      const tokenEntity = makeTokenEntity();
      mockVerificationRepo.findValidToken.mockResolvedValue(tokenEntity);
      mockUsersRepo.findOrCreate.mockResolvedValue(makeChannelUser());
      const mockEmit = vi.fn();
      vi.mocked(getEventBus).mockReturnValue({ emit: mockEmit } as any);

      await service.verifyToken(token, platform, platformUserId, displayName);

      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('should succeed even when getEventBus throws', async () => {
      const tokenEntity = makeTokenEntity();
      mockVerificationRepo.findValidToken.mockResolvedValue(tokenEntity);
      mockUsersRepo.findOrCreate.mockResolvedValue(makeChannelUser());
      vi.mocked(getEventBus).mockImplementation(() => {
        throw new Error('EventBus not initialized');
      });

      const result = await service.verifyToken(
        token,
        platform,
        platformUserId,
        displayName
      );

      expect(result).toEqual({
        success: true,
        ownpilotUserId: tokenEntity.ownpilotUserId,
      });
    });

    it('should pass platformUsername through as undefined when not provided', async () => {
      const tokenEntity = makeTokenEntity();
      mockVerificationRepo.findValidToken.mockResolvedValue(tokenEntity);
      mockUsersRepo.findOrCreate.mockResolvedValue(makeChannelUser());
      vi.mocked(getEventBus).mockReturnValue({ emit: vi.fn() } as any);

      await service.verifyToken(token, platform, platformUserId, displayName);

      expect(mockUsersRepo.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({ platformUsername: undefined })
      );
    });
  });

  // =========================================================================
  // isVerified
  // =========================================================================

  describe('isVerified', () => {
    it('should return true when user is verified and not blocked', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(
        makeChannelUser({ isVerified: true, isBlocked: false })
      );

      const result = await service.isVerified('telegram', 'tg-123');

      expect(result).toBe(true);
    });

    it('should return false when user is verified but blocked', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(
        makeChannelUser({ isVerified: true, isBlocked: true })
      );

      const result = await service.isVerified('telegram', 'tg-123');

      expect(result).toBe(false);
    });

    it('should return false when user is not verified', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(
        makeChannelUser({ isVerified: false, isBlocked: false })
      );

      const result = await service.isVerified('telegram', 'tg-123');

      expect(result).toBe(false);
    });

    it('should return false when user is not found', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(null);

      const result = await service.isVerified('telegram', 'tg-123');

      expect(result).toBe(false);
    });

    it('should return false when isVerified is explicitly false', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(
        makeChannelUser({ isVerified: false })
      );

      const result = await service.isVerified('telegram', 'tg-123');

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // checkWhitelist
  // =========================================================================

  describe('checkWhitelist', () => {
    it('should return true for empty list (allow all)', async () => {
      const result = await service.checkWhitelist([], 'tg-123');

      expect(result).toBe(true);
    });

    it('should return true when user is in the list', async () => {
      const result = await service.checkWhitelist(['tg-123'], 'tg-123');

      expect(result).toBe(true);
    });

    it('should return false when user is not in the list', async () => {
      const result = await service.checkWhitelist(['tg-456'], 'tg-123');

      expect(result).toBe(false);
    });

    it('should return true when user is among multiple entries', async () => {
      const result = await service.checkWhitelist(
        ['tg-111', 'tg-123', 'tg-456'],
        'tg-123'
      );

      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // verifyViaWhitelist
  // =========================================================================

  describe('verifyViaWhitelist', () => {
    it('should call markVerified for an unverified user', async () => {
      const user = makeChannelUser({ isVerified: false });
      mockUsersRepo.findOrCreate.mockResolvedValue(user);

      await service.verifyViaWhitelist('telegram', 'tg-123', 'Alice');

      expect(mockUsersRepo.markVerified).toHaveBeenCalledWith(
        user.id,
        'default',
        'whitelist'
      );
    });

    it('should skip markVerified for an already verified user', async () => {
      const user = makeChannelUser({ isVerified: true });
      mockUsersRepo.findOrCreate.mockResolvedValue(user);

      await service.verifyViaWhitelist('telegram', 'tg-123', 'Alice');

      expect(mockUsersRepo.markVerified).not.toHaveBeenCalled();
    });

    it('should return entity with isVerified: true', async () => {
      const user = makeChannelUser({ isVerified: false });
      mockUsersRepo.findOrCreate.mockResolvedValue(user);

      const result = await service.verifyViaWhitelist(
        'telegram',
        'tg-123',
        'Alice'
      );

      expect(result.isVerified).toBe(true);
    });

    it('should use default ownpilotUserId when not specified', async () => {
      mockUsersRepo.findOrCreate.mockResolvedValue(
        makeChannelUser({ isVerified: false })
      );

      await service.verifyViaWhitelist('telegram', 'tg-123', 'Alice');

      expect(mockUsersRepo.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({ ownpilotUserId: 'default' })
      );
    });

    it('should use provided ownpilotUserId when specified', async () => {
      mockUsersRepo.findOrCreate.mockResolvedValue(
        makeChannelUser({ isVerified: false })
      );

      await service.verifyViaWhitelist(
        'telegram',
        'tg-123',
        'Alice',
        'custom-owner'
      );

      expect(mockUsersRepo.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({ ownpilotUserId: 'custom-owner' })
      );
    });
  });

  // =========================================================================
  // resolveUser
  // =========================================================================

  describe('resolveUser', () => {
    it('should return ownpilotUserId when verified and not blocked', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(
        makeChannelUser({
          isVerified: true,
          isBlocked: false,
          ownpilotUserId: 'owner-42',
        })
      );

      const result = await service.resolveUser('telegram', 'tg-123');

      expect(result).toBe('owner-42');
    });

    it('should return null when user is not verified', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(
        makeChannelUser({ isVerified: false, isBlocked: false })
      );

      const result = await service.resolveUser('telegram', 'tg-123');

      expect(result).toBeNull();
    });

    it('should return null when user is blocked', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(
        makeChannelUser({ isVerified: true, isBlocked: true })
      );

      const result = await service.resolveUser('telegram', 'tg-123');

      expect(result).toBeNull();
    });

    it('should return null when user is not found', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(null);

      const result = await service.resolveUser('telegram', 'tg-123');

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // blockUser
  // =========================================================================

  describe('blockUser', () => {
    it('should block user and return true when user exists', async () => {
      const user = makeChannelUser({ id: 'cu-7' });
      mockUsersRepo.findByPlatform.mockResolvedValue(user);

      const result = await service.blockUser('telegram', 'tg-123');

      expect(result).toBe(true);
      expect(mockUsersRepo.block).toHaveBeenCalledWith('cu-7');
    });

    it('should return false when user is not found', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(null);

      const result = await service.blockUser('telegram', 'tg-123');

      expect(result).toBe(false);
      expect(mockUsersRepo.block).not.toHaveBeenCalled();
    });

    it('should call usersRepo.block with correct user ID', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(
        makeChannelUser({ id: 'cu-special' })
      );

      await service.blockUser('telegram', 'tg-999');

      expect(mockUsersRepo.findByPlatform).toHaveBeenCalledWith(
        'telegram',
        'tg-999'
      );
      expect(mockUsersRepo.block).toHaveBeenCalledWith('cu-special');
    });
  });

  // =========================================================================
  // unblockUser
  // =========================================================================

  describe('unblockUser', () => {
    it('should unblock user and return true when user exists', async () => {
      const user = makeChannelUser({ id: 'cu-7' });
      mockUsersRepo.findByPlatform.mockResolvedValue(user);

      const result = await service.unblockUser('telegram', 'tg-123');

      expect(result).toBe(true);
      expect(mockUsersRepo.unblock).toHaveBeenCalledWith('cu-7');
    });

    it('should return false when user is not found', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(null);

      const result = await service.unblockUser('telegram', 'tg-123');

      expect(result).toBe(false);
      expect(mockUsersRepo.unblock).not.toHaveBeenCalled();
    });

    it('should call usersRepo.unblock with correct user ID', async () => {
      mockUsersRepo.findByPlatform.mockResolvedValue(
        makeChannelUser({ id: 'cu-unblock' })
      );

      await service.unblockUser('telegram', 'tg-555');

      expect(mockUsersRepo.findByPlatform).toHaveBeenCalledWith(
        'telegram',
        'tg-555'
      );
      expect(mockUsersRepo.unblock).toHaveBeenCalledWith('cu-unblock');
    });
  });

  // =========================================================================
  // cleanup
  // =========================================================================

  describe('cleanup', () => {
    it('should delegate to verificationRepo.cleanupExpired', async () => {
      mockVerificationRepo.cleanupExpired.mockResolvedValue(5);

      const result = await service.cleanup();

      expect(mockVerificationRepo.cleanupExpired).toHaveBeenCalledOnce();
      expect(result).toBe(5);
    });

    it('should return the count from repo', async () => {
      mockVerificationRepo.cleanupExpired.mockResolvedValue(0);

      const result = await service.cleanup();

      expect(result).toBe(0);
    });
  });
});

// ===========================================================================
// getChannelVerificationService (singleton)
// ===========================================================================

describe('getChannelVerificationService', () => {
  it('should return a ChannelVerificationService instance', () => {
    const svc = getChannelVerificationService();

    expect(svc).toBeInstanceOf(ChannelVerificationService);
  });

  it('should return the same instance on subsequent calls (singleton)', () => {
    const svc1 = getChannelVerificationService();
    const svc2 = getChannelVerificationService();

    expect(svc1).toBe(svc2);
  });
});
