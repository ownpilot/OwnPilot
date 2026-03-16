import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { ChannelAttachment } from '@ownpilot/core';
import {
  channelAssetsRepo,
  type ChannelAssetsRepository,
} from '../db/repositories/channel-assets.js';
import { getLog } from './log.js';

const log = getLog('ChannelAssetStore');
import { CHANNEL_ASSET_TTL_MS, CHANNEL_ASSET_MAX_FILENAME_LENGTH } from '../config/defaults.js';

const DEFAULT_TTL_MS = CHANNEL_ASSET_TTL_MS;

function safeSegment(value: string): string {
  return (
    value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, CHANNEL_ASSET_MAX_FILENAME_LENGTH) || 'unknown'
  );
}

function extensionForAttachment(attachment: ChannelAttachment): string {
  if (attachment.filename) {
    const ext = extname(attachment.filename);
    if (ext) return ext;
  }

  const mime = attachment.mimeType.toLowerCase();
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'audio/ogg') return '.ogg';
  if (mime === 'audio/mpeg') return '.mp3';
  if (mime === 'audio/wav') return '.wav';
  if (mime === 'video/mp4') return '.mp4';
  if (mime === 'application/pdf') return '.pdf';
  return '';
}

export class ChannelAssetStore {
  private lastPurgeAt = 0;

  constructor(
    private readonly repo: ChannelAssetsRepository = channelAssetsRepo,
    private readonly baseDir = join(process.cwd(), '.ownpilot', 'tmp', 'channel-assets'),
    private readonly ttlMs = DEFAULT_TTL_MS
  ) {}

  async persistIncomingAttachments(params: {
    messageId: string;
    channelPluginId: string;
    platform: string;
    platformChatId: string;
    conversationId?: string;
    attachments: ChannelAttachment[];
  }): Promise<ChannelAttachment[]> {
    await this.purgeExpiredIfNeeded();

    const stored: ChannelAttachment[] = [];
    for (const attachment of params.attachments) {
      if (!attachment.data || attachment.data.length === 0) {
        stored.push(attachment);
        continue;
      }

      const assetId = randomUUID();
      const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
      const dir = join(
        this.baseDir,
        safeSegment(params.channelPluginId),
        safeSegment(params.platformChatId),
        safeSegment(params.messageId)
      );
      await mkdir(dir, { recursive: true });

      const filename =
        attachment.filename ?? `${attachment.type}${extensionForAttachment(attachment)}`;
      const storagePath = join(
        dir,
        `${assetId}${extensionForAttachment(attachment) || extname(filename)}`
      );
      const data = Buffer.from(attachment.data);
      await writeFile(storagePath, data);

      const sha256 = createHash('sha256').update(data).digest('hex');
      await this.repo.create({
        id: assetId,
        channelMessageId: params.messageId,
        channelPluginId: params.channelPluginId,
        platform: params.platform,
        platformChatId: params.platformChatId,
        conversationId: params.conversationId,
        type: attachment.type,
        mimeType: attachment.mimeType,
        filename,
        size: attachment.size ?? data.length,
        storagePath,
        sha256,
        expiresAt,
        metadata: {},
      });

      stored.push({
        ...attachment,
        assetId,
        path: storagePath,
        expiresAt,
        size: attachment.size ?? data.length,
      });
    }

    return stored;
  }

  async linkConversation(assetIds: string[], conversationId: string): Promise<void> {
    await this.repo.linkConversation(assetIds, conversationId);
  }

  async purgeExpired(): Promise<number> {
    const expired = await this.repo.listExpired(new Date().toISOString());
    for (const asset of expired) {
      if (asset.storagePath) {
        await rm(asset.storagePath, { force: true }).catch((e) =>
          log.debug('Asset cleanup failed', { path: asset.storagePath, error: String(e) })
        );
      }
    }
    await this.repo.deleteMany(expired.map((asset) => asset.id));
    return expired.length;
  }

  private async purgeExpiredIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPurgeAt < 15 * 60 * 1000) return;
    this.lastPurgeAt = now;

    try {
      const purged = await this.purgeExpired();
      if (purged > 0) log.info(`Purged ${purged} expired channel asset(s)`);
    } catch (error) {
      log.warn('Failed to purge expired channel assets', { error });
    }
  }
}

export const channelAssetStore = new ChannelAssetStore();
