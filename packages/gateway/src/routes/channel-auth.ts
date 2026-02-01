/**
 * Channel Authentication Routes
 *
 * REST API endpoints for managing channel user verification.
 * Users generate tokens here, then use /connect on channel platforms.
 */

import { Hono } from 'hono';
import { getChannelVerificationService } from '../channels/auth/verification.js';
import { channelUsersRepo } from '../db/repositories/channel-users.js';

export const channelAuthRoutes = new Hono();

/**
 * POST /channels/auth/generate-token
 * Generate a verification PIN/token for linking a channel account.
 */
channelAuthRoutes.post('/generate-token', async (c) => {
  const body = await c.req.json<{
    userId?: string;
    platform?: string;
    ttlMinutes?: number;
    type?: 'pin' | 'token';
  }>();

  const service = getChannelVerificationService();
  const result = await service.generateToken(body.userId ?? 'default', {
    platform: body.platform,
    ttlMinutes: body.ttlMinutes,
    type: body.type,
  });

  return c.json({
    success: true,
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
    instructions: `Send "/connect ${result.token}" to the bot on your messaging platform to verify your identity.`,
  });
});

/**
 * GET /channels/auth/status/:platform/:platformUserId
 * Check verification status for a platform user.
 */
channelAuthRoutes.get('/status/:platform/:platformUserId', async (c) => {
  const { platform, platformUserId } = c.req.param();
  const service = getChannelVerificationService();
  const verified = await service.isVerified(platform, platformUserId);

  const user = await channelUsersRepo.findByPlatform(platform, platformUserId);

  return c.json({
    platform,
    platformUserId,
    isVerified: verified,
    user: user
      ? {
          id: user.id,
          displayName: user.displayName,
          platformUsername: user.platformUsername,
          verificationMethod: user.verificationMethod,
          verifiedAt: user.verifiedAt?.toISOString(),
          firstSeenAt: user.firstSeenAt.toISOString(),
          lastSeenAt: user.lastSeenAt.toISOString(),
        }
      : null,
  });
});

/**
 * POST /channels/auth/block/:platform/:platformUserId
 * Block a channel user.
 */
channelAuthRoutes.post('/block/:platform/:platformUserId', async (c) => {
  const { platform, platformUserId } = c.req.param();
  const service = getChannelVerificationService();
  const blocked = await service.blockUser(platform, platformUserId);

  return c.json({ success: blocked });
});

/**
 * POST /channels/auth/unblock/:platform/:platformUserId
 * Unblock a channel user.
 */
channelAuthRoutes.post('/unblock/:platform/:platformUserId', async (c) => {
  const { platform, platformUserId } = c.req.param();
  const service = getChannelVerificationService();
  const unblocked = await service.unblockUser(platform, platformUserId);

  return c.json({ success: unblocked });
});

/**
 * GET /channels/auth/users
 * List all channel users with optional filters.
 */
channelAuthRoutes.get('/users', async (c) => {
  const platform = c.req.query('platform');
  const verified = c.req.query('verified');
  const limit = parseInt(c.req.query('limit') ?? '100', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const users = await channelUsersRepo.list({
    platform: platform ?? undefined,
    isVerified: verified !== undefined ? verified === 'true' : undefined,
    limit,
    offset,
  });

  return c.json({
    users: users.map((u) => ({
      id: u.id,
      ownpilotUserId: u.ownpilotUserId,
      platform: u.platform,
      platformUserId: u.platformUserId,
      platformUsername: u.platformUsername,
      displayName: u.displayName,
      isVerified: u.isVerified,
      verificationMethod: u.verificationMethod,
      isBlocked: u.isBlocked,
      firstSeenAt: u.firstSeenAt.toISOString(),
      lastSeenAt: u.lastSeenAt.toISOString(),
    })),
    count: users.length,
    limit,
    offset,
  });
});
