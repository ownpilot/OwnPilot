/**
 * Channel Verification Service
 *
 * Handles PIN/token-based verification, whitelist checking,
 * and user identity resolution for channel users.
 */

import { type ChannelUserVerifiedData, type ChannelUserBlockedData } from '@ownpilot/core/channels';
import { getEventBus, createEvent } from '@ownpilot/core/events';
import { ChannelEvents } from '@ownpilot/core/channels';

import type { ChannelVerificationRepository } from '../../db/repositories/channels/verification.js';
import { channelVerificationRepo } from '../../db/repositories/channels/verification.js';
import type { ChannelUsersRepository } from '../../db/repositories/channels/users.js';
import { channelUsersRepo, type ChannelUserEntity } from '../../db/repositories/channels/users.js';

// ============================================================================
// Service
// ============================================================================

export class ChannelVerificationService {
  constructor(
    private readonly verificationRepo: ChannelVerificationRepository = channelVerificationRepo,
    private readonly usersRepo: ChannelUsersRepository = channelUsersRepo
  ) {}

  /**
   * Generate a new verification token for a user.
   * The user sends this token via /connect on a channel platform.
   */
  async generateToken(
    ownpilotUserId: string,
    options?: {
      platform?: string;
      ttlMinutes?: number;
      type?: 'pin' | 'token';
    }
  ): Promise<{ token: string; expiresAt: Date }> {
    return this.verificationRepo.generateToken(ownpilotUserId, options);
  }

  /**
   * Attempt to verify a token from a channel message (/connect TOKEN).
   * On success, links the channel user to the OwnPilot user.
   */
  async verifyToken(
    token: string,
    platform: string,
    platformUserId: string,
    displayName: string,
    platformUsername?: string
  ): Promise<{
    success: boolean;
    ownpilotUserId?: string;
    error?: string;
  }> {
    // Claim first so losing concurrent requests cannot create an OwnPilot-linked
    // channel user before discovering that the single-use token is gone.
    const tokenEntity = await this.verificationRepo.claimValidToken(token, platform);
    if (!tokenEntity) {
      return { success: false, error: 'Invalid or expired token.' };
    }

    // Find or create the channel user
    const channelUser = await this.usersRepo.findOrCreate({
      platform,
      platformUserId,
      displayName,
      platformUsername,
      ownpilotUserId: tokenEntity.ownpilotUserId,
    });

    await this.verificationRepo.assignClaimedTokenToUser(tokenEntity.id, channelUser.id);

    // Mark as verified (only the claim winner reaches here)
    await this.usersRepo.markVerified(channelUser.id, tokenEntity.ownpilotUserId, 'pin');

    // Emit verification event
    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelUserVerifiedData>(
          'channel.user.verified',
          'channel',
          'channel-verification-service',
          {
            platform,
            platformUserId,
            ownpilotUserId: tokenEntity.ownpilotUserId,
            verificationMethod: 'pin',
          }
        )
      );
    } catch {
      // EventBus not initialized yet - ignore
    }

    return {
      success: true,
      ownpilotUserId: tokenEntity.ownpilotUserId,
    };
  }

  /**
   * Check if a platform user is verified.
   */
  async isVerified(platform: string, platformUserId: string): Promise<boolean> {
    const user = await this.usersRepo.findByPlatform(platform, platformUserId);
    return user?.isVerified === true && !user.isBlocked;
  }

  /**
   * Check if a user is in the whitelist for a channel plugin.
   * Whitelist is stored in the channel plugin's config.
   */
  async checkWhitelist(allowedList: string[], platformUserId: string): Promise<boolean> {
    if (allowedList.length === 0) return true; // No whitelist = allow all
    return allowedList.includes(platformUserId);
  }

  /**
   * Auto-verify a user via whitelist.
   */
  async verifyViaWhitelist(
    platform: string,
    platformUserId: string,
    displayName: string,
    ownpilotUserId: string = 'default'
  ): Promise<ChannelUserEntity> {
    const channelUser = await this.usersRepo.findOrCreate({
      platform,
      platformUserId,
      displayName,
      ownpilotUserId,
    });

    if (!channelUser.isVerified) {
      await this.usersRepo.markVerified(channelUser.id, ownpilotUserId, 'whitelist');
    }

    return { ...channelUser, isVerified: true };
  }

  /**
   * Resolve a channel user to their OwnPilot user ID.
   * Returns null if not verified.
   */
  async resolveUser(platform: string, platformUserId: string): Promise<string | null> {
    const user = await this.usersRepo.findByPlatform(platform, platformUserId);
    if (!user || !user.isVerified || user.isBlocked) return null;
    return user.ownpilotUserId;
  }

  /**
   * Block a channel user.
   */
  async blockUser(platform: string, platformUserId: string): Promise<boolean> {
    const user = await this.usersRepo.findByPlatform(platform, platformUserId);
    if (!user) return false;
    await this.usersRepo.block(user.id);

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelUserBlockedData>(
          ChannelEvents.USER_BLOCKED,
          'channel',
          'channel-verification-service',
          { platform, platformUserId }
        )
      );
    } catch {
      // EventBus not initialized yet
    }

    return true;
  }

  /**
   * Unblock a channel user.
   */
  async unblockUser(platform: string, platformUserId: string): Promise<boolean> {
    const user = await this.usersRepo.findByPlatform(platform, platformUserId);
    if (!user) return false;
    await this.usersRepo.unblock(user.id);

    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelUserBlockedData>(
          ChannelEvents.USER_UNBLOCKED,
          'channel',
          'channel-verification-service',
          { platform, platformUserId }
        )
      );
    } catch {
      // EventBus not initialized yet
    }

    return true;
  }

  /**
   * Approve a pending user by ID (admin action).
   */
  async approveUser(userId: string): Promise<boolean> {
    const user = await this.usersRepo.getById(userId);
    if (!user) return false;
    await this.usersRepo.markVerified(user.id, user.ownpilotUserId, 'admin');

    // Emit verification event so channel service can notify the user
    try {
      const eventBus = getEventBus();
      eventBus.emit(
        createEvent<ChannelUserVerifiedData>(
          'channel.user.verified',
          'channel',
          'channel-verification-service',
          {
            platform: user.platform,
            platformUserId: user.platformUserId,
            ownpilotUserId: user.ownpilotUserId,
            verificationMethod: 'admin',
          }
        )
      );
    } catch {
      // EventBus not initialized yet - ignore
    }

    return true;
  }

  /**
   * Delete a channel user by ID.
   */
  async deleteUser(userId: string): Promise<boolean> {
    return this.usersRepo.delete(userId);
  }

  /**
   * Revoke verification for a channel user by ID.
   */
  async unverifyUser(userId: string): Promise<boolean> {
    const user = await this.usersRepo.getById(userId);
    if (!user) return false;
    await this.usersRepo.unverify(user.id);
    return true;
  }

  /**
   * Clean up expired tokens.
   */
  async cleanup(): Promise<number> {
    return this.verificationRepo.cleanupExpired();
  }
}

// Singleton
let _service: ChannelVerificationService | null = null;

export function getChannelVerificationService(): ChannelVerificationService {
  if (!_service) {
    _service = new ChannelVerificationService();
  }
  return _service;
}
