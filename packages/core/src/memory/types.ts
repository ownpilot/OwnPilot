/**
 * Secure Personal Memory System — Type Definitions
 */

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
