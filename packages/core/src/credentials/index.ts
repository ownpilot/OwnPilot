/**
 * Credential Isolation System
 *
 * Provides secure credential management:
 * - Per-user credential isolation
 * - Encrypted storage support
 * - Multiple credential types (API keys, OAuth tokens, etc.)
 * - Secure access patterns
 * - Audit logging
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { getLog } from '../services/get-log.js';
import { getErrorMessage } from '../services/error-utils.js';

const log = getLog('Credentials');

// =============================================================================
// Types
// =============================================================================

/**
 * Credential types supported
 */
export type CredentialType =
  | 'api_key' // Simple API key
  | 'oauth_token' // OAuth access token
  | 'oauth_refresh' // OAuth refresh token
  | 'basic_auth' // Basic auth (username:password)
  | 'bearer_token' // Bearer token
  | 'certificate' // Client certificate
  | 'custom'; // Custom credential

/**
 * Provider identifiers for credentials
 */
export type CredentialProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'mistral'
  | 'xai'
  | 'perplexity'
  | 'zhipu'
  | 'telegram'
  | 'custom';

/**
 * Credential metadata
 */
export interface CredentialMetadata {
  /** When the credential was created */
  readonly createdAt: Date;
  /** When the credential was last used */
  readonly lastUsedAt?: Date;
  /** When the credential expires (if applicable) */
  readonly expiresAt?: Date;
  /** Number of times this credential has been used */
  readonly usageCount: number;
  /** Description or label */
  readonly label?: string;
  /** Scopes/permissions (for OAuth) */
  readonly scopes?: readonly string[];
  /** Associated project/workspace */
  readonly projectId?: string;
}

/**
 * Credential entry (internal representation)
 */
export interface CredentialEntry {
  /** Unique identifier */
  readonly id: string;
  /** User who owns this credential */
  readonly userId: string;
  /** Provider this credential is for */
  readonly provider: CredentialProvider;
  /** Type of credential */
  readonly type: CredentialType;
  /** Encrypted credential value */
  readonly encryptedValue: string;
  /** Initialization vector for decryption */
  readonly iv: string;
  /** PBKDF2 salt (absent in legacy entries using SHA-256 derivation) */
  readonly salt?: string;
  /** Metadata */
  readonly metadata: CredentialMetadata;
}

/**
 * Credential for use (decrypted, temporary)
 */
export interface Credential {
  /** Provider */
  readonly provider: CredentialProvider;
  /** Type */
  readonly type: CredentialType;
  /** Decrypted value */
  readonly value: string;
  /** Additional properties (for OAuth, etc.) */
  readonly properties?: Record<string, string>;
}

/**
 * Credential store configuration
 */
export interface UserCredentialStoreConfig {
  /** Master encryption key (should be from secure source) */
  readonly encryptionKey: string;
  /** Storage backend */
  readonly backend: CredentialStorageBackend;
  /** Enable audit logging */
  readonly auditLog?: boolean;
  /** Auto-rotate credentials older than this (ms) */
  readonly rotationInterval?: number;
}

/**
 * Storage backend interface
 */
export interface CredentialStorageBackend {
  /** Get credential by ID */
  get(id: string): Promise<CredentialEntry | null>;
  /** Get all credentials for a user */
  getByUser(userId: string): Promise<CredentialEntry[]>;
  /** Get credential for user and provider */
  getByProvider(userId: string, provider: CredentialProvider): Promise<CredentialEntry | null>;
  /** Store credential */
  set(entry: CredentialEntry): Promise<void>;
  /** Delete credential */
  delete(id: string): Promise<void>;
  /** Delete all credentials for a user */
  deleteByUser(userId: string): Promise<void>;
  /** List all credential IDs */
  list(): Promise<string[]>;
}

// =============================================================================
// In-Memory Backend (for development/testing)
// =============================================================================

/**
 * In-memory credential storage (NOT for production)
 */
export class InMemoryCredentialBackend implements CredentialStorageBackend {
  private readonly store = new Map<string, CredentialEntry>();

  async get(id: string): Promise<CredentialEntry | null> {
    return this.store.get(id) ?? null;
  }

  async getByUser(userId: string): Promise<CredentialEntry[]> {
    const entries: CredentialEntry[] = [];
    for (const entry of this.store.values()) {
      if (entry.userId === userId) {
        entries.push(entry);
      }
    }
    return entries;
  }

  async getByProvider(
    userId: string,
    provider: CredentialProvider
  ): Promise<CredentialEntry | null> {
    for (const entry of this.store.values()) {
      if (entry.userId === userId && entry.provider === provider) {
        return entry;
      }
    }
    return null;
  }

  async set(entry: CredentialEntry): Promise<void> {
    this.store.set(entry.id, entry);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async deleteByUser(userId: string): Promise<void> {
    for (const [id, entry] of this.store.entries()) {
      if (entry.userId === userId) {
        this.store.delete(id);
      }
    }
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys());
  }

  /** Clear all credentials (for testing) */
  clear(): void {
    this.store.clear();
  }
}

// =============================================================================
// Encryption Utilities
// =============================================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 600_000;

/**
 * Derive a 256-bit key from the master key using PBKDF2.
 * Falls back to legacy SHA-256 hash when no salt is provided (for reading old data).
 */
function deriveKey(masterKey: string, salt?: Buffer): Buffer {
  if (salt) {
    return pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  }
  // Legacy fallback — single SHA-256 (no brute-force resistance). Retained
  // ONLY to read pre-salt entries; those are re-encrypted with PBKDF2+salt on
  // first read via migrateLegacyEntryIfNeeded (CRYPTO-004), so this path is
  // self-healing and a no-salt entry should not persist past one read.
  return createHash('sha256').update(masterKey).digest();
}

/**
 * Encrypt a credential value
 */
function encryptValue(
  value: string,
  masterKey: string
): { encrypted: string; iv: string; salt: string } {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(value, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // Append auth tag
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([Buffer.from(encrypted, 'base64'), authTag]);

  return {
    encrypted: combined.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
  };
}

/**
 * Decrypt a credential value.
 * Accepts optional salt for PBKDF2; omit for legacy SHA-256 derivation.
 */
function decryptValue(encrypted: string, iv: string, masterKey: string, salt?: string): string {
  const saltBuffer = salt ? Buffer.from(salt, 'base64') : undefined;
  const key = deriveKey(masterKey, saltBuffer);
  const ivBuffer = Buffer.from(iv, 'base64');
  const combined = Buffer.from(encrypted, 'base64');

  // Extract auth tag
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encryptedData = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, ivBuffer);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData.toString('base64'), 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// =============================================================================
// Credential Store
// =============================================================================

/**
 * Secure credential store
 */
export class UserCredentialStore {
  private readonly config: UserCredentialStoreConfig;
  private readonly backend: CredentialStorageBackend;

  constructor(config: UserCredentialStoreConfig) {
    this.config = config;
    this.backend = config.backend;
  }

  /**
   * Store a credential
   */
  async store(
    userId: string,
    provider: CredentialProvider,
    type: CredentialType,
    value: string,
    options?: {
      label?: string;
      scopes?: string[];
      expiresAt?: Date;
      projectId?: string;
    }
  ): Promise<string> {
    // Generate unique ID
    const id = `cred_${randomBytes(16).toString('hex')}`;

    // Encrypt the value
    const { encrypted, iv, salt } = encryptValue(value, this.config.encryptionKey);

    // Create entry
    const entry: CredentialEntry = {
      id,
      userId,
      provider,
      type,
      encryptedValue: encrypted,
      iv,
      salt,
      metadata: {
        createdAt: new Date(),
        usageCount: 0,
        label: options?.label,
        scopes: options?.scopes,
        expiresAt: options?.expiresAt,
        projectId: options?.projectId,
      },
    };

    // Store
    await this.backend.set(entry);

    // Audit log
    this.auditLog('store', userId, provider, id);

    return id;
  }

  /**
   * CRYPTO-004: lazily upgrade legacy (no-salt, single-SHA-256) entries to the
   * PBKDF2+salt scheme the first time they are successfully decrypted, so the
   * weak O(1) key derivation never survives a read. Non-fatal on failure — a
   * migration error must never break a credential read.
   */
  private async migrateLegacyEntryIfNeeded(
    entry: CredentialEntry,
    plaintext: string
  ): Promise<void> {
    if (entry.salt) return;
    try {
      const { encrypted, iv, salt } = encryptValue(plaintext, this.config.encryptionKey);
      await this.backend.set({ ...entry, encryptedValue: encrypted, iv, salt });
    } catch {
      // best-effort; keep serving the decrypted value
    }
  }

  /**
   * Get a credential for use
   */
  async get(userId: string, provider: CredentialProvider): Promise<Credential | null> {
    const entry = await this.backend.getByProvider(userId, provider);
    if (!entry) {
      return null;
    }

    // Check expiration
    if (entry.metadata.expiresAt && new Date() > entry.metadata.expiresAt) {
      this.auditLog('expired', userId, provider, entry.id);
      return null;
    }

    // Decrypt — wrapped because a wrong encryption key or tampered ciphertext
    // throws synchronously, which would otherwise escape out of get() and take
    // down the caller. Surface as a null result with an audit event instead.
    let value: string;
    try {
      value = decryptValue(entry.encryptedValue, entry.iv, this.config.encryptionKey, entry.salt);
    } catch (err) {
      log.error('Decrypt failed for credential', {
        userId,
        provider,
        id: entry.id,
        err: getErrorMessage(err),
      });
      this.auditLog('decrypt_failed', userId, provider, entry.id);
      return null;
    }

    // CRYPTO-004: upgrade legacy no-salt entries on read.
    await this.migrateLegacyEntryIfNeeded(entry, value);

    // Update usage
    await this.updateUsage(entry);

    // Audit log
    this.auditLog('access', userId, provider, entry.id);

    return {
      provider: entry.provider,
      type: entry.type,
      value,
    };
  }

  /**
   * Get credential by ID
   */
  async getById(id: string, userId: string): Promise<Credential | null> {
    const entry = await this.backend.get(id);
    if (!entry || entry.userId !== userId) {
      return null;
    }

    // Check expiration
    if (entry.metadata.expiresAt && new Date() > entry.metadata.expiresAt) {
      return null;
    }

    // Decrypt — same guard as get() above
    let value: string;
    try {
      value = decryptValue(entry.encryptedValue, entry.iv, this.config.encryptionKey, entry.salt);
    } catch (err) {
      log.error('Decrypt failed for credential', {
        userId,
        provider: entry.provider,
        id,
        err: getErrorMessage(err),
      });
      return null;
    }

    // CRYPTO-004: upgrade legacy no-salt entries on read.
    await this.migrateLegacyEntryIfNeeded(entry, value);

    // Update usage
    await this.updateUsage(entry);

    return {
      provider: entry.provider,
      type: entry.type,
      value,
    };
  }

  /**
   * List credentials for a user (without values)
   */
  async list(userId: string): Promise<
    Array<{
      id: string;
      provider: CredentialProvider;
      type: CredentialType;
      metadata: CredentialMetadata;
    }>
  > {
    const entries = await this.backend.getByUser(userId);
    return entries.map((entry) => ({
      id: entry.id,
      provider: entry.provider,
      type: entry.type,
      metadata: entry.metadata,
    }));
  }

  /**
   * Delete a credential
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const entry = await this.backend.get(id);
    if (!entry || entry.userId !== userId) {
      return false;
    }

    await this.backend.delete(id);
    this.auditLog('delete', userId, entry.provider, id);
    return true;
  }

  /**
   * Delete all credentials for a user
   */
  async deleteAll(userId: string): Promise<void> {
    await this.backend.deleteByUser(userId);
    this.auditLog('delete_all', userId, 'all' as CredentialProvider, 'all');
  }

  /**
   * Rotate a credential (store new value, invalidate old)
   */
  async rotate(
    userId: string,
    provider: CredentialProvider,
    newValue: string
  ): Promise<string | null> {
    const existing = await this.backend.getByProvider(userId, provider);
    if (!existing) {
      return null;
    }

    // Delete old
    await this.backend.delete(existing.id);

    // Store new with same metadata
    const newId = await this.store(userId, provider, existing.type, newValue, {
      label: existing.metadata.label,
      scopes: existing.metadata.scopes ? [...existing.metadata.scopes] : undefined,
      projectId: existing.metadata.projectId,
    });

    this.auditLog('rotate', userId, provider, newId);
    return newId;
  }

  /**
   * Check if a credential exists
   */
  async exists(userId: string, provider: CredentialProvider): Promise<boolean> {
    const entry = await this.backend.getByProvider(userId, provider);
    return entry !== null;
  }

  /**
   * Update usage metadata
   */
  private async updateUsage(entry: CredentialEntry): Promise<void> {
    const updated: CredentialEntry = {
      ...entry,
      metadata: {
        ...entry.metadata,
        lastUsedAt: new Date(),
        usageCount: entry.metadata.usageCount + 1,
      },
    };
    await this.backend.set(updated);
  }

  /**
   * Audit log
   */
  private auditLog(
    action: string,
    userId: string,
    provider: CredentialProvider,
    credentialId: string
  ): void {
    if (!this.config.auditLog) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      action,
      userId,
      provider,
      credentialId: credentialId.slice(0, 16) + '...', // Truncate for privacy
    };

    // In production, this would write to a secure audit log
    if (process.env.NODE_ENV === 'development') {
      log.debug('Audit:', logEntry);
    }
  }
}

// =============================================================================
// Credential Context
// =============================================================================

/**
 * Per-request credential context
 * Provides isolated credential access for a specific user/request.
 *
 * The cache stores DECRYPTED plaintext, so it must not live forever in
 * long-lived services (background workers, heartbeats, daemons). Entries
 * expire after {@link CACHE_TTL_MS}; callers should still invoke {@link clear}
 * at the end of a request when they can.
 */
const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  credential: Credential;
  expiresAt: number;
}

export class CredentialContext {
  private readonly store: UserCredentialStore;
  private readonly userId: string;
  private readonly cache = new Map<CredentialProvider, CacheEntry>();

  constructor(store: UserCredentialStore, userId: string) {
    this.store = store;
    this.userId = userId;
  }

  /**
   * Get a credential (with caching)
   */
  async get(provider: CredentialProvider): Promise<Credential | null> {
    const entry = this.cache.get(provider);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.credential;
    }
    if (entry) {
      // Expired — drop it so a memory dump can't read stale plaintext.
      this.cache.delete(provider);
    }

    const credential = await this.store.get(this.userId, provider);
    if (credential) {
      this.cache.set(provider, { credential, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    return credential;
  }

  /**
   * Get API key for a provider
   */
  async getApiKey(provider: CredentialProvider): Promise<string | null> {
    const credential = await this.get(provider);
    return credential?.value ?? null;
  }

  /**
   * Check if credential exists
   */
  async has(provider: CredentialProvider): Promise<boolean> {
    const entry = this.cache.get(provider);
    if (entry && entry.expiresAt > Date.now()) return true;
    return this.store.exists(this.userId, provider);
  }

  /**
   * Clear the cache (call at end of request)
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get user ID
   */
  getUserId(): string {
    return this.userId;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a credential store with in-memory backend (development only).
 *
 * Encryption-key resolution order:
 *   1. Explicit `encryptionKey` argument.
 *   2. `CREDENTIAL_ENCRYPTION_KEY` environment variable.
 *   3. Random fallback — ONLY in test runs (`NODE_ENV === 'test'`) and only
 *      after logging a loud warning. In production this would silently
 *      ditch all persisted credentials on restart, so we refuse instead.
 */
export function createInMemoryCredentialStore(encryptionKey?: string): UserCredentialStore {
  let key = encryptionKey ?? process.env.CREDENTIAL_ENCRYPTION_KEY;

  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'createInMemoryCredentialStore: no encryption key. Pass `encryptionKey` or set ' +
          'CREDENTIAL_ENCRYPTION_KEY. A random fallback would discard all credentials on restart.'
      );
    }
    log.warn(
      'createInMemoryCredentialStore: no encryption key configured; using a random key. ' +
        'Set CREDENTIAL_ENCRYPTION_KEY to make credentials survive restarts.'
    );
    key = randomBytes(32).toString('hex');
  }

  return new UserCredentialStore({
    encryptionKey: key,
    backend: new InMemoryCredentialBackend(),
    auditLog: true,
  });
}

/**
 * Create a credential context for a user
 */
export function createCredentialContext(
  store: UserCredentialStore,
  userId: string
): CredentialContext {
  return new CredentialContext(store, userId);
}

// =============================================================================
// Environment Variable Loader
// =============================================================================

/**
 * Load credentials from environment variables
 * Useful for initial setup and testing
 */
export async function loadCredentialsFromEnv(
  store: UserCredentialStore,
  userId: string
): Promise<void> {
  const envMappings: Array<{
    envVar: string;
    provider: CredentialProvider;
    type: CredentialType;
    label: string;
  }> = [
    { envVar: 'OPENAI_API_KEY', provider: 'openai', type: 'api_key', label: 'OpenAI API Key' },
    {
      envVar: 'ANTHROPIC_API_KEY',
      provider: 'anthropic',
      type: 'api_key',
      label: 'Anthropic API Key',
    },
    {
      envVar: 'GOOGLE_AI_API_KEY',
      provider: 'google',
      type: 'api_key',
      label: 'Google AI API Key',
    },
    {
      envVar: 'DEEPSEEK_API_KEY',
      provider: 'deepseek',
      type: 'api_key',
      label: 'DeepSeek API Key',
    },
    { envVar: 'GROQ_API_KEY', provider: 'groq', type: 'api_key', label: 'Groq API Key' },
    {
      envVar: 'TOGETHER_API_KEY',
      provider: 'together',
      type: 'api_key',
      label: 'Together API Key',
    },
    {
      envVar: 'FIREWORKS_API_KEY',
      provider: 'fireworks',
      type: 'api_key',
      label: 'Fireworks API Key',
    },
    { envVar: 'MISTRAL_API_KEY', provider: 'mistral', type: 'api_key', label: 'Mistral API Key' },
    { envVar: 'XAI_API_KEY', provider: 'xai', type: 'api_key', label: 'xAI API Key' },
    {
      envVar: 'PERPLEXITY_API_KEY',
      provider: 'perplexity',
      type: 'api_key',
      label: 'Perplexity API Key',
    },
    {
      envVar: 'ZHIPU_API_KEY',
      provider: 'zhipu',
      type: 'api_key',
      label: 'Zhipu API Key',
    },
    {
      envVar: 'TELEGRAM_BOT_TOKEN',
      provider: 'telegram',
      type: 'api_key',
      label: 'Telegram Bot Token',
    },
  ];

  for (const mapping of envMappings) {
    const value = process.env[mapping.envVar];
    if (value) {
      // Check if already exists
      const exists = await store.exists(userId, mapping.provider);
      if (!exists) {
        await store.store(userId, mapping.provider, mapping.type, value, {
          label: mapping.label,
        });
      }
    }
  }
}
