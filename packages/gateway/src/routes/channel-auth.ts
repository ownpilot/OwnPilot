/**
 * Channel Authentication Routes
 *
 * REST API endpoints for managing channel user verification.
 * Users generate tokens here, then use /connect on channel platforms.
 */

import { Hono } from 'hono';
import { getChannelVerificationService } from '../channels/auth/verification.js';
import { channelUsersRepo } from '../db/repositories/channel-users.js';
import { getPaginationParams, apiResponse, apiError, ERROR_CODES } from './helpers.js';
import { wsGateway } from '../ws/server.js';

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

  return apiResponse(c, {
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

  return apiResponse(c, {
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

  return apiResponse(c, { blocked });
});

/**
 * POST /channels/auth/unblock/:platform/:platformUserId
 * Unblock a channel user.
 */
channelAuthRoutes.post('/unblock/:platform/:platformUserId', async (c) => {
  const { platform, platformUserId } = c.req.param();
  const service = getChannelVerificationService();
  const unblocked = await service.unblockUser(platform, platformUserId);

  return apiResponse(c, { unblocked });
});

/**
 * GET /channels/auth/users
 * List all channel users with optional filters.
 */
channelAuthRoutes.get('/users', async (c) => {
  const platform = c.req.query('platform');
  const verified = c.req.query('verified');
  const { limit, offset } = getPaginationParams(c, 100);

  const users = await channelUsersRepo.list({
    platform: platform ?? undefined,
    isVerified: verified !== undefined ? verified === 'true' : undefined,
    limit,
    offset,
  });

  return apiResponse(c, {
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

// ==========================================================================
// ID-based user management endpoints
// ==========================================================================

/**
 * POST /channels/auth/users/:id/approve
 * Approve a pending channel user.
 */
channelAuthRoutes.post('/users/:id/approve', async (c) => {
  const id = c.req.param('id');
  const service = getChannelVerificationService();
  const approved = await service.approveUser(id);

  if (!approved) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'User not found' }, 404);
  }

  const user = await channelUsersRepo.getById(id);
  wsGateway.broadcast('data:changed', { entity: 'channel', action: 'updated' });
  wsGateway.broadcast('channel:user:approved', {
    channelId: '',
    platform: user?.platform ?? '',
    userId: id,
    platformUserId: user?.platformUserId ?? '',
    displayName: user?.displayName,
  });

  return apiResponse(c, { approved: true });
});

/**
 * POST /channels/auth/users/:id/block
 * Block a channel user by ID.
 */
channelAuthRoutes.post('/users/:id/block', async (c) => {
  const id = c.req.param('id');
  const user = await channelUsersRepo.getById(id);
  if (!user) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'User not found' }, 404);
  }

  await channelUsersRepo.block(id);
  wsGateway.broadcast('data:changed', { entity: 'channel', action: 'updated' });

  return apiResponse(c, { blocked: true });
});

/**
 * POST /channels/auth/users/:id/unblock
 * Unblock a channel user by ID.
 */
channelAuthRoutes.post('/users/:id/unblock', async (c) => {
  const id = c.req.param('id');
  const user = await channelUsersRepo.getById(id);
  if (!user) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'User not found' }, 404);
  }

  await channelUsersRepo.unblock(id);
  wsGateway.broadcast('data:changed', { entity: 'channel', action: 'updated' });

  return apiResponse(c, { unblocked: true });
});

/**
 * POST /channels/auth/users/:id/unverify
 * Revoke verification for a channel user by ID.
 */
channelAuthRoutes.post('/users/:id/unverify', async (c) => {
  const id = c.req.param('id');
  const service = getChannelVerificationService();
  const result = await service.unverifyUser(id);

  if (!result) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'User not found' }, 404);
  }

  wsGateway.broadcast('data:changed', { entity: 'channel', action: 'updated' });

  return apiResponse(c, { unverified: true });
});

/**
 * DELETE /channels/auth/users/:id
 * Delete a channel user by ID.
 */
channelAuthRoutes.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  const service = getChannelVerificationService();
  const deleted = await service.deleteUser(id);

  if (!deleted) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'User not found' }, 404);
  }

  wsGateway.broadcast('data:changed', { entity: 'channel', action: 'deleted' });

  return apiResponse(c, { deleted: true });
});
