import { BaseRepository, parseJsonField } from '../base.js';

interface ChannelAssetRecord {
  id: string;
  channelMessageId: string;
  channelPluginId: string;
  platform: string;
  platformChatId: string;
  conversationId?: string;
  type: 'image' | 'audio' | 'video' | 'file';
  mimeType: string;
  filename?: string;
  size?: number;
  storagePath?: string;
  sha256?: string;
  metadata: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
}

interface ChannelAssetRow {
  id: string;
  channel_message_id: string;
  channel_plugin_id: string;
  platform: string;
  platform_chat_id: string;
  conversation_id: string | null;
  type: string;
  mime_type: string;
  filename: string | null;
  size: string | null;
  storage_path: string | null;
  sha256: string | null;
  metadata: string;
  expires_at: string;
  created_at: string;
}

function rowToRecord(row: ChannelAssetRow): ChannelAssetRecord {
  return {
    id: row.id,
    channelMessageId: row.channel_message_id,
    channelPluginId: row.channel_plugin_id,
    platform: row.platform,
    platformChatId: row.platform_chat_id,
    conversationId: row.conversation_id ?? undefined,
    type: row.type as ChannelAssetRecord['type'],
    mimeType: row.mime_type,
    filename: row.filename ?? undefined,
    size: row.size != null ? Number(row.size) : undefined,
    storagePath: row.storage_path ?? undefined,
    sha256: row.sha256 ?? undefined,
    metadata: parseJsonField(row.metadata, {}),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export class ChannelAssetsRepository extends BaseRepository {
  async create(input: {
    id: string;
    channelMessageId: string;
    channelPluginId: string;
    platform: string;
    platformChatId: string;
    conversationId?: string;
    type: ChannelAssetRecord['type'];
    mimeType: string;
    filename?: string;
    size?: number;
    storagePath?: string;
    sha256?: string;
    metadata?: Record<string, unknown>;
    expiresAt: string;
  }): Promise<ChannelAssetRecord> {
    await this.execute(
      `INSERT INTO channel_assets (
        id, channel_message_id, channel_plugin_id, platform, platform_chat_id,
        conversation_id, type, mime_type, filename, size, storage_path, sha256,
        metadata, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        input.id,
        input.channelMessageId,
        input.channelPluginId,
        input.platform,
        input.platformChatId,
        input.conversationId ?? null,
        input.type,
        input.mimeType,
        input.filename ?? null,
        input.size ?? null,
        input.storagePath ?? null,
        input.sha256 ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.expiresAt,
      ]
    );

    const created = await this.getById(input.id);
    if (!created) throw new Error('Failed to create channel asset');
    return created;
  }

  async getById(id: string): Promise<ChannelAssetRecord | null> {
    const row = await this.queryOne<ChannelAssetRow>('SELECT * FROM channel_assets WHERE id = $1', [
      id,
    ]);
    return row ? rowToRecord(row) : null;
  }

  async linkConversation(assetIds: string[], conversationId: string): Promise<void> {
    if (assetIds.length === 0) return;
    await this.execute(
      `UPDATE channel_assets
       SET conversation_id = $1
       WHERE id = ANY($2::text[]) AND conversation_id IS NULL`,
      [conversationId, assetIds]
    );
  }

  async listExpired(nowIso: string): Promise<ChannelAssetRecord[]> {
    const rows = await this.query<ChannelAssetRow>(
      `SELECT * FROM channel_assets WHERE expires_at <= $1 ORDER BY expires_at ASC LIMIT 100`,
      [nowIso]
    );
    return rows.map(rowToRecord);
  }

  async deleteMany(assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return;
    await this.execute(`DELETE FROM channel_assets WHERE id = ANY($1::text[])`, [assetIds]);
  }
}

export const channelAssetsRepo = new ChannelAssetsRepository();

export function createChannelAssetsRepository(): ChannelAssetsRepository {
  return new ChannelAssetsRepository();
}
