/**
 * Extensions Repository
 *
 * Manages installed extension state (status, settings, manifest).
 * Uses in-memory cache for fast synchronous access (same pattern as
 * PluginsRepository and ConfigServicesRepository).
 */

import { BaseRepository, parseJsonField } from './base.js';
import { getLog } from '../../services/log.js';
import type { ExtensionManifest, ExtensionFormat } from '../../services/extension-types.js';

const log = getLog('ExtRepo');

// =============================================================================
// ROW TYPES (database representation)
// =============================================================================

interface ExtensionRow {
  id: string;
  user_id: string;
  name: string;
  version: string;
  description: string | null;
  category: string;
  format: string;
  icon: string | null;
  author_name: string | null;
  manifest: string; // JSONB string
  status: string;
  source_path: string | null;
  settings: string; // JSONB string
  error_message: string | null;
  tool_count: number;
  trigger_count: number;
  installed_at: string;
  updated_at: string;
}

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface ExtensionRecord {
  id: string;
  userId: string;
  name: string;
  version: string;
  description?: string;
  category: string;
  /** Package format: 'ownpilot' (native tool bundles) or 'agentskills' (open standard SKILL.md) */
  format: ExtensionFormat;
  icon?: string;
  authorName?: string;
  manifest: ExtensionManifest;
  status: 'enabled' | 'disabled' | 'error';
  sourcePath?: string;
  settings: Record<string, unknown>;
  errorMessage?: string;
  toolCount: number;
  triggerCount: number;
  installedAt: string;
  updatedAt: string;
}

export interface UpsertExtensionInput {
  id: string;
  userId?: string;
  name: string;
  version: string;
  description?: string;
  category?: string;
  format?: ExtensionFormat;
  icon?: string;
  authorName?: string;
  manifest: ExtensionManifest;
  status?: string;
  sourcePath?: string;
  settings?: Record<string, unknown>;
  toolCount?: number;
  triggerCount?: number;
}

// =============================================================================
// CACHE
// =============================================================================

let cache = new Map<string, ExtensionRecord>();
let cacheInitialized = false;

// =============================================================================
// ROW-TO-MODEL CONVERSION
// =============================================================================

function rowToRecord(row: ExtensionRow): ExtensionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    version: row.version,
    description: row.description ?? undefined,
    category: row.category,
    format: (row.format ?? 'ownpilot') as ExtensionRecord['format'],
    icon: row.icon ?? undefined,
    authorName: row.author_name ?? undefined,
    manifest: parseJsonField<ExtensionManifest>(row.manifest, {
      id: '',
      name: '',
      version: '',
      description: '',
      tools: [],
    }),
    status: row.status as ExtensionRecord['status'],
    sourcePath: row.source_path ?? undefined,
    settings: parseJsonField<Record<string, unknown>>(row.settings, {}),
    errorMessage: row.error_message ?? undefined,
    toolCount: row.tool_count,
    triggerCount: row.trigger_count,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

// =============================================================================
// REPOSITORY
// =============================================================================

export class ExtensionsRepository extends BaseRepository {
  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await this.refreshCache();
  }

  async refreshCache(): Promise<void> {
    const rows = await this.query<ExtensionRow>('SELECT * FROM user_extensions');
    cache = new Map(rows.map((r) => [r.id, rowToRecord(r)]));
    cacheInitialized = true;
  }

  private async refreshRecordCache(id: string): Promise<void> {
    const row = await this.queryOne<ExtensionRow>('SELECT * FROM user_extensions WHERE id = $1', [
      id,
    ]);
    if (row) {
      cache.set(id, rowToRecord(row));
    } else {
      cache.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Accessors (sync, from cache)
  // ---------------------------------------------------------------------------

  getById(id: string): ExtensionRecord | null {
    if (!cacheInitialized) {
      log.warn(`Cache not initialized, returning null for: ${id}`);
      return null;
    }
    return cache.get(id) ?? null;
  }

  getAll(): ExtensionRecord[] {
    if (!cacheInitialized) {
      log.warn('Cache not initialized, returning empty list');
      return [];
    }
    return Array.from(cache.values());
  }

  getEnabled(): ExtensionRecord[] {
    return this.getAll().filter((p) => p.status === 'enabled');
  }

  // ---------------------------------------------------------------------------
  // CRUD (async, writes to DB + refreshes cache)
  // ---------------------------------------------------------------------------

  async upsert(input: UpsertExtensionInput): Promise<ExtensionRecord> {
    await this.execute(
      `INSERT INTO user_extensions (id, user_id, name, version, description, category, format, icon, author_name, manifest, status, source_path, settings, tool_count, trigger_count, installed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         version = EXCLUDED.version,
         description = EXCLUDED.description,
         category = EXCLUDED.category,
         format = EXCLUDED.format,
         icon = EXCLUDED.icon,
         author_name = EXCLUDED.author_name,
         manifest = EXCLUDED.manifest,
         source_path = EXCLUDED.source_path,
         tool_count = EXCLUDED.tool_count,
         trigger_count = EXCLUDED.trigger_count,
         updated_at = NOW()`,
      [
        input.id,
        input.userId ?? 'default',
        input.name,
        input.version,
        input.description ?? null,
        input.category ?? 'other',
        input.format ?? 'ownpilot',
        input.icon ?? null,
        input.authorName ?? null,
        JSON.stringify(input.manifest),
        input.status ?? 'enabled',
        input.sourcePath ?? null,
        JSON.stringify(input.settings ?? {}),
        input.toolCount ?? input.manifest.tools.length,
        input.triggerCount ?? input.manifest.triggers?.length ?? 0,
      ]
    );

    await this.refreshRecordCache(input.id);
    return cache.get(input.id)!;
  }

  async updateStatus(
    id: string,
    status: ExtensionRecord['status'],
    errorMessage?: string
  ): Promise<ExtensionRecord | null> {
    const existing = cache.get(id);
    if (!existing) return null;

    await this.execute(
      'UPDATE user_extensions SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
      [status, errorMessage ?? null, id]
    );

    await this.refreshRecordCache(id);
    return cache.get(id) ?? null;
  }

  async updateSettings(
    id: string,
    settings: Record<string, unknown>
  ): Promise<ExtensionRecord | null> {
    const existing = cache.get(id);
    if (!existing) return null;

    await this.execute(
      'UPDATE user_extensions SET settings = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(settings), id]
    );

    await this.refreshRecordCache(id);
    return cache.get(id) ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM user_extensions WHERE id = $1', [id]);
    cache.delete(id);
    return result.changes > 0;
  }
}

// =============================================================================
// SINGLETON & INIT
// =============================================================================

export const extensionsRepo = new ExtensionsRepository();

export async function initializeExtensionsRepo(): Promise<void> {
  await extensionsRepo.initialize();
}
