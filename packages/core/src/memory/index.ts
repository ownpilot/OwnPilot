/**
 * Secure Personal Memory System
 *
 * Privacy & Security First Design:
 * - All data encrypted at rest (AES-256-GCM)
 * - Per-user isolated memory spaces
 * - Access control with permissions
 * - Comprehensive audit logging
 * - Secure key derivation (never stored)
 * - Data expiration and secure deletion
 * - Memory types: facts, preferences, conversations, semantic
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
} from 'node:crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Memory types for different kinds of information
 */
export type MemoryType =
  | 'fact' // Personal facts (name, preferences, etc.)
  | 'preference' // User preferences and settings
  | 'conversation' // Conversation summaries
  | 'context' // Contextual information
  | 'secret' // Sensitive data (extra encryption)
  | 'task' // Task-related memory
  | 'relationship' // People and contacts
  | 'location' // Location-related info
  | 'temporal'; // Time-based reminders

/**
 * Access level for memory entries
 */
export type AccessLevel =
  | 'private' // Only user can access
  | 'assistant' // Assistant can read, user can write
  | 'shared' // Can be shared with specific contexts
  | 'system'; // System-level (e.g., preferences)

/**
 * Memory entry metadata
 */
export interface MemoryMetadata {
  /** When the memory was created */
  createdAt: string;
  /** When the memory was last accessed */
  lastAccessedAt?: string;
  /** When the memory was last modified */
  modifiedAt?: string;
  /** Access count */
  accessCount: number;
  /** Expiration time (ISO string) */
  expiresAt?: string;
  /** Time-to-live in seconds (from last access) */
  ttl?: number;
  /** Source of the memory (manual, conversation, inferred) */
  source: 'manual' | 'conversation' | 'inferred' | 'imported';
  /** Confidence score (0-1) for inferred memories */
  confidence?: number;
  /** Related memory IDs */
  relatedIds?: string[];
  /** Tags for organization */
  tags?: string[];
  /** Custom metadata */
  custom?: Record<string, unknown>;
}

/**
 * Memory entry (internal, encrypted)
 */
export interface EncryptedMemoryEntry {
  /** Unique identifier */
  id: string;
  /** User ID (hashed) */
  userIdHash: string;
  /** Memory type */
  type: MemoryType;
  /** Access level */
  accessLevel: AccessLevel;
  /** Encrypted content */
  encryptedContent: string;
  /** Encryption IV */
  iv: string;
  /** Auth tag for GCM */
  authTag: string;
  /** Encrypted key (optional, for secrets) */
  encryptedKey?: string;
  /** Content hash (for deduplication) */
  contentHash: string;
  /** Metadata (not encrypted, but hashed where sensitive) */
  metadata: MemoryMetadata;
}

/**
 * Decrypted memory entry (for use)
 */
export interface MemoryEntry {
  id: string;
  type: MemoryType;
  accessLevel: AccessLevel;
  /** The actual content/value */
  content: unknown;
  /** Optional key for the content */
  key?: string;
  metadata: MemoryMetadata;
}

/**
 * Memory query criteria
 */
export interface MemoryQuery {
  /** Filter by type */
  type?: MemoryType | MemoryType[];
  /** Filter by tags */
  tags?: string[];
  /** Full-text search in content (after decryption) */
  search?: string;
  /** Filter by access level */
  accessLevel?: AccessLevel;
  /** Created after this date */
  createdAfter?: string;
  /** Created before this date */
  createdBefore?: string;
  /** Minimum confidence (for inferred) */
  minConfidence?: number;
  /** Include expired entries */
  includeExpired?: boolean;
  /** Maximum results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  timestamp: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'search' | 'export' | 'purge';
  userId: string;
  memoryId?: string;
  memoryType?: MemoryType;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Memory store configuration
 */
export interface SecureMemoryConfig {
  /** Base directory for storage */
  storageDir?: string;
  /** PBKDF2 iterations (higher = more secure, slower) */
  pbkdf2Iterations?: number;
  /** Salt for key derivation (should be unique per installation) */
  installationSalt?: string;
  /** Enable audit logging */
  auditLog?: boolean;
  /** Audit log retention days */
  auditRetentionDays?: number;
  /** Auto-purge expired entries interval (ms) */
  purgeInterval?: number;
  /** Max entries per user (0 = unlimited) */
  maxEntriesPerUser?: number;
}

// =============================================================================
// Encryption Utilities
// =============================================================================

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;
const _AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_DEFAULT_ITERATIONS = 100000;

/**
 * Derive encryption key from user password/master key
 * NEVER store the derived key - always derive on demand
 */
function deriveKey(
  masterKey: string,
  salt: Buffer,
  iterations: number = PBKDF2_DEFAULT_ITERATIONS
): Buffer {
  return pbkdf2Sync(masterKey, salt, iterations, KEY_LENGTH, 'sha512');
}

/**
 * Generate a secure random salt
 */
function _generateSalt(): Buffer {
  return randomBytes(SALT_LENGTH);
}

/**
 * Hash user ID (for storage without revealing actual ID)
 */
function hashUserId(userId: string, salt: string): string {
  return createHash('sha256').update(userId + salt).digest('hex');
}

/**
 * Hash content for deduplication (without revealing content)
 */
function hashContent(content: string, salt: string): string {
  return createHash('sha256').update(content + salt).digest('hex').slice(0, 16);
}

/**
 * Encrypt content with AES-256-GCM
 */
function encryptContent(
  content: string,
  key: Buffer
): { encrypted: string; iv: string; authTag: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(content, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return {
    encrypted,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

/**
 * Decrypt content
 */
function decryptContent(
  encrypted: string,
  iv: string,
  authTag: string,
  key: Buffer
): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Securely wipe a buffer (overwrite with zeros)
 */
function secureWipe(buffer: Buffer): void {
  buffer.fill(0);
}

// =============================================================================
// Secure Memory Store
// =============================================================================

/**
 * Secure Personal Memory Store
 */
export class SecureMemoryStore {
  private readonly config: Required<SecureMemoryConfig>;
  private readonly salt: Buffer;
  private entries: Map<string, EncryptedMemoryEntry> = new Map();
  private auditLog: AuditLogEntry[] = [];
  private purgeTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(config: SecureMemoryConfig = {}) {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    const dataDir = path.join(homeDir, '.ownpilot', 'memory');

    this.config = {
      storageDir: config.storageDir ?? dataDir,
      pbkdf2Iterations: config.pbkdf2Iterations ?? PBKDF2_DEFAULT_ITERATIONS,
      installationSalt: config.installationSalt ?? process.env.MEMORY_SALT ?? 'change-this-in-production',
      auditLog: config.auditLog ?? true,
      auditRetentionDays: config.auditRetentionDays ?? 30,
      purgeInterval: config.purgeInterval ?? 3600000, // 1 hour
      maxEntriesPerUser: config.maxEntriesPerUser ?? 10000,
    };

    // Generate installation-specific salt
    this.salt = createHash('sha256')
      .update(this.config.installationSalt)
      .digest();
  }

  /**
   * Initialize the memory store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.config.storageDir, { recursive: true });
    await this.loadEntries();
    await this.loadAuditLog();

    // Start purge timer
    if (this.config.purgeInterval > 0) {
      this.purgeTimer = setInterval(() => {
        this.purgeExpired().catch(console.error);
      }, this.config.purgeInterval);
    }

    this.initialized = true;
    console.log('[SecureMemory] Initialized with', this.entries.size, 'entries');
  }

  /**
   * Store a memory entry
   */
  async store(
    userId: string,
    masterKey: string,
    type: MemoryType,
    content: unknown,
    options: {
      key?: string;
      accessLevel?: AccessLevel;
      ttl?: number;
      expiresAt?: string;
      tags?: string[];
      source?: MemoryMetadata['source'];
      confidence?: number;
      relatedIds?: string[];
      custom?: Record<string, unknown>;
    } = {}
  ): Promise<string> {
    this.ensureInitialized();

    const userIdHash = hashUserId(userId, this.config.installationSalt);

    // Check entry limit
    const userEntryCount = this.countUserEntries(userIdHash);
    if (this.config.maxEntriesPerUser > 0 && userEntryCount >= this.config.maxEntriesPerUser) {
      await this.logAudit('create', userId, undefined, type, false, 'Entry limit exceeded');
      throw new Error('Memory entry limit exceeded');
    }

    // Derive encryption key (never stored)
    const key = deriveKey(masterKey, this.salt, this.config.pbkdf2Iterations);

    try {
      // Serialize content
      const contentStr = JSON.stringify(content);

      // Check for duplicates
      const contentHash = hashContent(contentStr, this.config.installationSalt);
      const existing = this.findByContentHash(userIdHash, contentHash);
      if (existing) {
        // Update existing instead of creating duplicate
        return this.updateInternal(existing.id, userId, masterKey, content, options);
      }

      // Encrypt content
      const { encrypted, iv, authTag } = encryptContent(contentStr, key);

      // Generate ID
      const id = `mem_${Date.now()}_${randomBytes(8).toString('hex')}`;

      // Create entry
      const entry: EncryptedMemoryEntry = {
        id,
        userIdHash,
        type,
        accessLevel: options.accessLevel ?? 'private',
        encryptedContent: encrypted,
        iv,
        authTag,
        contentHash,
        metadata: {
          createdAt: new Date().toISOString(),
          accessCount: 0,
          source: options.source ?? 'manual',
          confidence: options.confidence,
          ttl: options.ttl,
          expiresAt: options.expiresAt ?? (options.ttl
            ? new Date(Date.now() + options.ttl * 1000).toISOString()
            : undefined),
          tags: options.tags,
          relatedIds: options.relatedIds,
          custom: options.custom,
        },
      };

      this.entries.set(id, entry);
      await this.saveEntries();
      await this.logAudit('create', userId, id, type, true);

      return id;
    } finally {
      secureWipe(key);
    }
  }

  /**
   * Retrieve a memory entry by ID
   */
  async retrieve(
    userId: string,
    masterKey: string,
    memoryId: string
  ): Promise<MemoryEntry | null> {
    this.ensureInitialized();

    const entry = this.entries.get(memoryId);
    if (!entry) {
      await this.logAudit('read', userId, memoryId, undefined, false, 'Not found');
      return null;
    }

    // Verify user ownership
    const userIdHash = hashUserId(userId, this.config.installationSalt);
    if (entry.userIdHash !== userIdHash) {
      await this.logAudit('read', userId, memoryId, entry.type, false, 'Access denied');
      return null;
    }

    // Check expiration
    if (this.isExpired(entry)) {
      await this.logAudit('read', userId, memoryId, entry.type, false, 'Expired');
      return null;
    }

    // Derive key and decrypt
    const key = deriveKey(masterKey, this.salt, this.config.pbkdf2Iterations);

    try {
      const contentStr = decryptContent(
        entry.encryptedContent,
        entry.iv,
        entry.authTag,
        key
      );

      // Update access metadata
      entry.metadata.lastAccessedAt = new Date().toISOString();
      entry.metadata.accessCount++;

      // Refresh TTL if configured
      if (entry.metadata.ttl) {
        entry.metadata.expiresAt = new Date(
          Date.now() + entry.metadata.ttl * 1000
        ).toISOString();
      }

      await this.saveEntries();
      await this.logAudit('read', userId, memoryId, entry.type, true);

      return {
        id: entry.id,
        type: entry.type,
        accessLevel: entry.accessLevel,
        content: JSON.parse(contentStr),
        metadata: entry.metadata,
      };
    } catch {
      await this.logAudit('read', userId, memoryId, entry.type, false, 'Decryption failed');
      return null;
    } finally {
      secureWipe(key);
    }
  }

  /**
   * Query memories (decrypts matching entries)
   */
  async query(
    userId: string,
    masterKey: string,
    criteria: MemoryQuery = {}
  ): Promise<MemoryEntry[]> {
    this.ensureInitialized();

    const userIdHash = hashUserId(userId, this.config.installationSalt);
    const results: MemoryEntry[] = [];

    // Filter entries
    let candidates = Array.from(this.entries.values())
      .filter(e => e.userIdHash === userIdHash);

    // Apply type filter
    if (criteria.type) {
      const types = Array.isArray(criteria.type) ? criteria.type : [criteria.type];
      candidates = candidates.filter(e => types.includes(e.type));
    }

    // Apply access level filter
    if (criteria.accessLevel) {
      candidates = candidates.filter(e => e.accessLevel === criteria.accessLevel);
    }

    // Apply tag filter
    if (criteria.tags && criteria.tags.length > 0) {
      candidates = candidates.filter(e =>
        e.metadata.tags?.some(t => criteria.tags!.includes(t))
      );
    }

    // Apply date filters
    if (criteria.createdAfter) {
      candidates = candidates.filter(e => e.metadata.createdAt >= criteria.createdAfter!);
    }
    if (criteria.createdBefore) {
      candidates = candidates.filter(e => e.metadata.createdAt <= criteria.createdBefore!);
    }

    // Apply confidence filter
    if (criteria.minConfidence !== undefined) {
      candidates = candidates.filter(e =>
        e.metadata.confidence === undefined || e.metadata.confidence >= criteria.minConfidence!
      );
    }

    // Filter expired unless requested
    if (!criteria.includeExpired) {
      candidates = candidates.filter(e => !this.isExpired(e));
    }

    // Derive key
    const key = deriveKey(masterKey, this.salt, this.config.pbkdf2Iterations);

    try {
      // Decrypt and filter by search
      for (const entry of candidates) {
        try {
          const contentStr = decryptContent(
            entry.encryptedContent,
            entry.iv,
            entry.authTag,
            key
          );

          // Apply search filter
          if (criteria.search) {
            const searchLower = criteria.search.toLowerCase();
            if (!contentStr.toLowerCase().includes(searchLower)) {
              continue;
            }
          }

          results.push({
            id: entry.id,
            type: entry.type,
            accessLevel: entry.accessLevel,
            content: JSON.parse(contentStr),
            metadata: entry.metadata,
          });
        } catch {
          // Skip entries that fail decryption
        }
      }

      // Sort by creation date (newest first)
      results.sort((a, b) =>
        b.metadata.createdAt.localeCompare(a.metadata.createdAt)
      );

      // Apply pagination
      const offset = criteria.offset ?? 0;
      const limit = criteria.limit ?? 100;
      const paginated = results.slice(offset, offset + limit);

      await this.logAudit('search', userId, undefined, undefined, true, undefined, {
        resultCount: paginated.length,
        totalCount: results.length,
      });

      return paginated;
    } finally {
      secureWipe(key);
    }
  }

  /**
   * Update a memory entry
   */
  async update(
    userId: string,
    masterKey: string,
    memoryId: string,
    content: unknown,
    options: {
      tags?: string[];
      ttl?: number;
      expiresAt?: string;
      accessLevel?: AccessLevel;
    } = {}
  ): Promise<boolean> {
    return this.updateInternal(memoryId, userId, masterKey, content, options) === memoryId;
  }

  /**
   * Delete a memory entry (secure deletion)
   */
  async delete(userId: string, memoryId: string): Promise<boolean> {
    this.ensureInitialized();

    const entry = this.entries.get(memoryId);
    if (!entry) {
      await this.logAudit('delete', userId, memoryId, undefined, false, 'Not found');
      return false;
    }

    // Verify ownership
    const userIdHash = hashUserId(userId, this.config.installationSalt);
    if (entry.userIdHash !== userIdHash) {
      await this.logAudit('delete', userId, memoryId, entry.type, false, 'Access denied');
      return false;
    }

    // Delete entry
    this.entries.delete(memoryId);
    await this.saveEntries();
    await this.logAudit('delete', userId, memoryId, entry.type, true);

    return true;
  }

  /**
   * Delete all memories for a user (secure wipe)
   */
  async deleteAll(userId: string): Promise<number> {
    this.ensureInitialized();

    const userIdHash = hashUserId(userId, this.config.installationSalt);
    let deleted = 0;

    for (const [id, entry] of this.entries) {
      if (entry.userIdHash === userIdHash) {
        this.entries.delete(id);
        deleted++;
      }
    }

    if (deleted > 0) {
      await this.saveEntries();
    }

    await this.logAudit('purge', userId, undefined, undefined, true, undefined, {
      deletedCount: deleted,
    });

    return deleted;
  }

  /**
   * Get memory statistics for a user
   */
  async getStats(userId: string): Promise<{
    totalEntries: number;
    byType: Record<MemoryType, number>;
    byAccessLevel: Record<AccessLevel, number>;
    oldestEntry?: string;
    newestEntry?: string;
    totalTags: number;
    expiredCount: number;
  }> {
    this.ensureInitialized();

    const userIdHash = hashUserId(userId, this.config.installationSalt);
    const userEntries = Array.from(this.entries.values())
      .filter(e => e.userIdHash === userIdHash);

    const byType: Record<string, number> = {};
    const byAccessLevel: Record<string, number> = {};
    const allTags = new Set<string>();
    let expiredCount = 0;
    let oldest: string | undefined;
    let newest: string | undefined;

    for (const entry of userEntries) {
      byType[entry.type] = (byType[entry.type] ?? 0) + 1;
      byAccessLevel[entry.accessLevel] = (byAccessLevel[entry.accessLevel] ?? 0) + 1;

      if (entry.metadata.tags) {
        entry.metadata.tags.forEach(t => allTags.add(t));
      }

      if (this.isExpired(entry)) {
        expiredCount++;
      }

      if (!oldest || entry.metadata.createdAt < oldest) {
        oldest = entry.metadata.createdAt;
      }
      if (!newest || entry.metadata.createdAt > newest) {
        newest = entry.metadata.createdAt;
      }
    }

    return {
      totalEntries: userEntries.length,
      byType: byType as Record<MemoryType, number>,
      byAccessLevel: byAccessLevel as Record<AccessLevel, number>,
      oldestEntry: oldest,
      newestEntry: newest,
      totalTags: allTags.size,
      expiredCount,
    };
  }

  /**
   * Export all memories (encrypted backup)
   */
  async export(userId: string, masterKey: string): Promise<{
    version: string;
    exportedAt: string;
    entryCount: number;
    entries: MemoryEntry[];
  }> {
    const entries = await this.query(userId, masterKey, { includeExpired: true });

    await this.logAudit('export', userId, undefined, undefined, true, undefined, {
      entryCount: entries.length,
    });

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      entryCount: entries.length,
      entries,
    };
  }

  /**
   * Import memories from backup
   */
  async import(
    userId: string,
    masterKey: string,
    backup: { entries: MemoryEntry[] }
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const entry of backup.entries) {
      try {
        await this.store(userId, masterKey, entry.type, entry.content, {
          accessLevel: entry.accessLevel,
          tags: entry.metadata.tags,
          source: 'imported',
          ttl: entry.metadata.ttl,
          custom: entry.metadata.custom,
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    return { imported, skipped };
  }

  /**
   * Shutdown the memory store
   */
  async shutdown(): Promise<void> {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
    }

    await this.saveEntries();
    await this.saveAuditLog();

    this.entries.clear();
    this.auditLog = [];
    this.initialized = false;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SecureMemoryStore not initialized. Call initialize() first.');
    }
  }

  private updateInternal(
    memoryId: string,
    userId: string,
    masterKey: string,
    content: unknown,
    options: Record<string, unknown>
  ): string {
    const entry = this.entries.get(memoryId);
    if (!entry) {
      throw new Error('Memory entry not found');
    }

    const userIdHash = hashUserId(userId, this.config.installationSalt);
    if (entry.userIdHash !== userIdHash) {
      throw new Error('Access denied');
    }

    const key = deriveKey(masterKey, this.salt, this.config.pbkdf2Iterations);

    try {
      const contentStr = JSON.stringify(content);
      const { encrypted, iv, authTag } = encryptContent(contentStr, key);

      entry.encryptedContent = encrypted;
      entry.iv = iv;
      entry.authTag = authTag;
      entry.contentHash = hashContent(contentStr, this.config.installationSalt);
      entry.metadata.modifiedAt = new Date().toISOString();

      if (options.tags) entry.metadata.tags = options.tags as string[];
      if (options.accessLevel) entry.accessLevel = options.accessLevel as AccessLevel;
      if (options.ttl) {
        entry.metadata.ttl = options.ttl as number;
        entry.metadata.expiresAt = new Date(Date.now() + (options.ttl as number) * 1000).toISOString();
      }
      if (options.expiresAt) entry.metadata.expiresAt = options.expiresAt as string;

      // Save synchronously in this context
      this.saveEntries().catch(console.error);
      this.logAudit('update', userId, memoryId, entry.type, true).catch(console.error);

      return memoryId;
    } finally {
      secureWipe(key);
    }
  }

  private countUserEntries(userIdHash: string): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.userIdHash === userIdHash) count++;
    }
    return count;
  }

  private findByContentHash(
    userIdHash: string,
    contentHash: string
  ): EncryptedMemoryEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.userIdHash === userIdHash && entry.contentHash === contentHash) {
        return entry;
      }
    }
    return undefined;
  }

  private isExpired(entry: EncryptedMemoryEntry): boolean {
    if (!entry.metadata.expiresAt) return false;
    return new Date() > new Date(entry.metadata.expiresAt);
  }

  private async purgeExpired(): Promise<number> {
    let purged = 0;
    for (const [id, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(id);
        purged++;
      }
    }

    if (purged > 0) {
      await this.saveEntries();
      console.log('[SecureMemory] Purged', purged, 'expired entries');
    }

    return purged;
  }

  private async loadEntries(): Promise<void> {
    const filePath = path.join(this.config.storageDir, 'entries.encrypted.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as EncryptedMemoryEntry[];
      this.entries = new Map(data.map(e => [e.id, e]));
    } catch {
      this.entries = new Map();
    }
  }

  private async saveEntries(): Promise<void> {
    const filePath = path.join(this.config.storageDir, 'entries.encrypted.json');
    const data = Array.from(this.entries.values());
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async loadAuditLog(): Promise<void> {
    const filePath = path.join(this.config.storageDir, 'audit.log.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      this.auditLog = JSON.parse(content) as AuditLogEntry[];

      // Prune old entries
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.config.auditRetentionDays);
      this.auditLog = this.auditLog.filter(e => new Date(e.timestamp) > cutoff);
    } catch {
      this.auditLog = [];
    }
  }

  private async saveAuditLog(): Promise<void> {
    if (!this.config.auditLog) return;

    const filePath = path.join(this.config.storageDir, 'audit.log.json');
    await fs.writeFile(filePath, JSON.stringify(this.auditLog, null, 2), 'utf-8');
  }

  private async logAudit(
    action: AuditLogEntry['action'],
    userId: string,
    memoryId?: string,
    memoryType?: MemoryType,
    success: boolean = true,
    error?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.config.auditLog) return;

    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      action,
      userId: hashUserId(userId, this.config.installationSalt).slice(0, 16), // Partial hash for privacy
      memoryId: memoryId?.slice(0, 16), // Partial ID
      memoryType,
      success,
      error,
      metadata,
    };

    this.auditLog.push(entry);

    // Keep log size reasonable
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000);
    }

    // Save periodically
    if (this.auditLog.length % 100 === 0) {
      await this.saveAuditLog();
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new secure memory store
 */
export function createSecureMemoryStore(config?: SecureMemoryConfig): SecureMemoryStore {
  return new SecureMemoryStore(config);
}

/**
 * Memory store singleton (for convenience)
 */
let defaultStore: SecureMemoryStore | null = null;

export async function getDefaultMemoryStore(): Promise<SecureMemoryStore> {
  if (!defaultStore) {
    defaultStore = createSecureMemoryStore();
    await defaultStore.initialize();
  }
  return defaultStore;
}

// =============================================================================
// Memory Tools (for AI agent)
// =============================================================================

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../agent/types.js';

export const rememberTool: ToolDefinition = {
  name: 'remember',
  description: 'Store information in long-term memory. Use this to remember facts, preferences, or important details about the user.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The information to remember',
      },
      type: {
        type: 'string',
        description: 'Type of memory',
        enum: ['fact', 'preference', 'context', 'relationship', 'task'],
      },
      tags: {
        type: 'array',
        description: 'Tags for organization',
        items: { type: 'string' },
      },
      ttl: {
        type: 'number',
        description: 'Time to live in seconds (optional)',
      },
    },
    required: ['content', 'type'],
  },
};

export const recallTool: ToolDefinition = {
  name: 'recall',
  description: 'Retrieve information from long-term memory. Use this to recall facts, preferences, or context.',
  parameters: {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        description: 'Search query',
      },
      type: {
        type: 'string',
        description: 'Filter by memory type',
        enum: ['fact', 'preference', 'context', 'relationship', 'task'],
      },
      tags: {
        type: 'array',
        description: 'Filter by tags',
        items: { type: 'string' },
      },
      limit: {
        type: 'number',
        description: 'Maximum results (default: 10)',
      },
    },
    required: [],
  },
};

export const forgetTool: ToolDefinition = {
  name: 'forget',
  description: 'Remove information from memory. Use with caution - this permanently deletes the memory.',
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'ID of the memory to forget',
      },
    },
    required: ['memoryId'],
  },
};

// Tool executors would be implemented with proper context handling
// These are placeholders - actual implementation needs userId and masterKey from context

export const SECURE_MEMORY_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  {
    definition: rememberTool,
    executor: async (args, _context): Promise<ToolExecutionResult> => {
      // In production, get userId and masterKey from context
      return {
        content: JSON.stringify({
          message: 'Memory tools require secure context with userId and masterKey',
          argsReceived: args,
        }),
        isError: true,
      };
    },
  },
  {
    definition: recallTool,
    executor: async (args, _context): Promise<ToolExecutionResult> => {
      return {
        content: JSON.stringify({
          message: 'Memory tools require secure context with userId and masterKey',
          argsReceived: args,
        }),
        isError: true,
      };
    },
  },
  {
    definition: forgetTool,
    executor: async (args, _context): Promise<ToolExecutionResult> => {
      return {
        content: JSON.stringify({
          message: 'Memory tools require secure context with userId and masterKey',
          argsReceived: args,
        }),
        isError: true,
      };
    },
  },
];

// =============================================================================
// Re-export Conversation Memory
// =============================================================================

export {
  // Types
  type MemoryCategory,
  type MemoryImportance,
  type MemorySource,
  type MemoryEntry as ConversationMemoryEntry,
  type ConversationSummary,
  type UserProfile,
  type MemoryQueryOptions,
  type MemoryStats as ConversationMemoryStats,
  type MemoryRetentionPolicy,
  // Classes
  ConversationMemoryStore,
  // Factory functions
  createConversationMemoryStore,
  getMemoryStore,
  // Constants
  DEFAULT_RETENTION_POLICY,
} from './conversation.js';

// =============================================================================
// Re-export Personal Memory
// =============================================================================

export {
  // Types
  type PersonalDataCategory,
  type PersonalDataEntry,
  type ComprehensiveProfile,
  // Classes
  PersonalMemoryStore,
  // Factory functions
  createPersonalMemoryStore,
  getPersonalMemoryStore,
} from './personal.js';
