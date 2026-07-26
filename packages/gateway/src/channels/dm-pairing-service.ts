/**
 * DM Pairing Service
 *
 * Manages DM pairing flows for non-owner channel senders:
 * - Generates one-time 6-digit pairing codes (CSPRNG)
 * - Tracks pending approval requests per platform
 * - Handles approve/deny lifecycle
 *
 * Trust boundary: Platform user IDs come from the normalizer layer and are
 * already validated; the code generated here is purely internal.
 */

import { randomInt } from 'node:crypto';
import type { DmPairingRequestsRepository } from '../db/repositories/channels/dm-pairing.js';
import type { ChannelUsersRepository } from '../db/repositories/channels/users.js';
import { wsGateway } from '../ws/server.js';
import { getLog } from '../services/log.js';

const log = getLog('DmPairingService');

export class DmPairingService {
  constructor(
    private readonly dmPairingRequests: DmPairingRequestsRepository,
    private readonly usersRepo: ChannelUsersRepository
  ) {}

  /**
   * Get the set of platformUserIds that are pending approval for a platform.
   * Used to determine whether a non-owner DM gets the pairing flow.
   */
  async getPendingSenders(platform: string): Promise<Set<string>> {
    const tokens = await this.dmPairingRequests.listPending(platform);
    return new Set(tokens.map((t) => t.platformUserId));
  }

  /**
   * Generate a 6-digit pairing code for a non-owner DM.
   * Stores the code in verification_tokens and notifies the owner via WS.
   */
  async generateDmPairingCode(
    _pluginId: string,
    platform: string,
    senderUserId: string,
    _ownerUserId: string
  ): Promise<string> {
    // SECURITY (EXPOSE-004): the 6-digit code is a one-time pairing
    // credential — an attacker who can predict it gains DM access. Use
    // crypto.randomInt (CSPRNG); non-cryptographic PRNG output would be predictable from
    // a few observed outputs.
    let code: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = String(randomInt(100000, 1000000));
      const created = await this.dmPairingRequests.create({
        platform,
        platformUserId: senderUserId,
        code: candidate,
        expiresInMinutes: 10,
      });
      if (created) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new Error('Could not allocate a unique DM pairing code');
    }

    // Mark sender as pending
    const channelUser = await this.usersRepo.findByPlatform(platform, senderUserId);
    if (channelUser) {
      await this.usersRepo.updateStatus(channelUser.id, 'pending');
    }

    // Notify owner via WS
    wsGateway.broadcast('data:changed', {
      entity: 'dm-pairing' as const,
      action: 'pending' as const,
    });

    return code;
  }

  /**
   * Approve a pending DM sender by code.
   * Called via REST API from the owner's dashboard.
   */
  async approvePendingSender(
    platform: string,
    code: string
  ): Promise<{ success: boolean; error?: string }> {
    const token = await this.dmPairingRequests.consumeByCode(code, platform);
    if (!token) {
      return { success: false, error: 'Invalid or expired code.' };
    }

    // Update channel user status to active
    const channelUser = await this.usersRepo.findByPlatform(platform, token.platformUserId);
    if (channelUser) {
      await this.usersRepo.updateStatus(channelUser.id, 'active');
    }

    // Verify the user
    if (channelUser) {
      await this.usersRepo.markVerified(channelUser.id, 'default', 'admin');
    }

    log.info('Pending sender approved via DM pairing code', {
      platform,
      senderUserId: token.platformUserId,
    });

    return { success: true };
  }

  /**
   * Deny a pending DM sender by platform+userId.
   */
  async denyPendingSender(
    platform: string,
    platformUserId: string
  ): Promise<{ success: boolean; error?: string }> {
    const token = await this.dmPairingRequests.findValidToken(platform, platformUserId);
    if (token) {
      await this.dmPairingRequests.consume(token.id);
    }

    const channelUser = await this.usersRepo.findByPlatform(platform, platformUserId);
    if (channelUser) {
      await this.usersRepo.block(channelUser.id);
    }

    log.info('Pending sender denied', { platform, platformUserId });
    return { success: true };
  }

  /**
   * List all pending DM pairing requests for a platform.
   */
  async listPendingSenders(platform: string): Promise<
    Array<{
      platformUserId: string;
      displayName?: string;
      code: string;
      expiresAt: Date;
    }>
  > {
    const tokens = await this.dmPairingRequests.listPending(platform);
    const result = [];
    for (const token of tokens) {
      const channelUser = await this.usersRepo.findByPlatform(platform, token.platformUserId);
      result.push({
        platformUserId: token.platformUserId,
        displayName: channelUser?.displayName,
        code: token.code,
        expiresAt: token.expiresAt,
      });
    }
    return result;
  }
}
