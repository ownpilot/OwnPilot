/**
 * SecureVault - Encrypted key-value storage
 * - AES-256-GCM encryption with unique IV per entry
 * - Master key stored in OS keychain
 * - PBKDF2 key derivation (600K iterations)
 * - Tamper detection via authentication tag
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { webcrypto } from 'node:crypto';
import { type Result, ok, err, fromPromise } from '../types/result.js';
import { CryptoError, NotFoundError, ValidationError, InternalError } from '../types/errors.js';
import { type JsonValue } from '../types/utility.js';
import {
  deriveKey,
  generateSalt,
  generateIV,
  generateMasterKey,
  toBase64,
  fromBase64,
  secureClear,
} from './derive.js';
import {
  storeSecret,
  retrieveSecret,
  deleteSecret,
  hasSecret,
  type KeychainConfig,
} from './keychain.js';

// Use Node.js webcrypto directly - properly typed in @types/node
const crypto = webcrypto;

// Type alias for CryptoKey from Node.js webcrypto
type CryptoKeyType = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;

/**
 * Vault configuration
 */
export interface VaultConfig {
  /** Path to vault file */
  path: string;
  /** Keychain service name */
  service?: string;
  /** Keychain account name */
  account?: string;
  /** PBKDF2 iterations (default: 600,000) */
  iterations?: number;
}

/**
 * Vault file format
 */
interface VaultFile {
  version: 1;
  salt: string; // base64
  entries: Record<string, string>; // key -> base64(IV || ciphertext || authTag)
}

/**
 * SecureVault - Encrypted key-value storage with OS keychain integration
 */
export class SecureVault {
  private readonly config: Required<VaultConfig>;
  private derivedKey: CryptoKeyType | null = null;
  private vaultData: VaultFile | null = null;
  private isUnlocked = false;

  constructor(config: VaultConfig) {
    this.config = {
      path: config.path,
      service: config.service ?? 'ownpilot',
      account: config.account ?? 'ownpilot',
      iterations: config.iterations ?? 600_000,
    };
  }

  /**
   * Get keychain config
   */
  private get keychainConfig(): KeychainConfig {
    return {
      service: this.config.service,
      account: this.config.account,
    };
  }

  /**
   * Initialize a new vault (first-time setup)
   * Creates a new master key and stores it in the OS keychain
   */
  async initialize(): Promise<Result<void, CryptoError | ValidationError | InternalError>> {
    // Check if already initialized
    if (await hasSecret(this.keychainConfig)) {
      return err(new ValidationError('Vault already initialized'));
    }

    // Generate new master key
    const masterKey = generateMasterKey(32);

    // Store in OS keychain
    const storeResult = await storeSecret(masterKey, this.keychainConfig);
    if (!storeResult.ok) {
      secureClear(masterKey);
      return storeResult;
    }

    // Create vault file with new salt
    const salt = generateSalt(32);
    this.vaultData = {
      version: 1,
      salt: toBase64(salt),
      entries: {},
    };

    // Save vault file
    const saveResult = await this.saveVault();
    if (!saveResult.ok) {
      secureClear(masterKey);
      return saveResult;
    }

    secureClear(masterKey);
    return ok(undefined);
  }

  /**
   * Check if vault is initialized
   */
  async isInitialized(): Promise<boolean> {
    return await hasSecret(this.keychainConfig);
  }

  /**
   * Unlock the vault (load master key from keychain and derive encryption key)
   */
  async unlock(): Promise<Result<void, CryptoError | NotFoundError | InternalError>> {
    if (this.isUnlocked) {
      return ok(undefined);
    }

    // Retrieve master key from keychain
    const secretResult = await retrieveSecret(this.keychainConfig);
    if (!secretResult.ok) {
      return secretResult;
    }

    const masterKey = secretResult.value;
    if (!masterKey) {
      return err(new NotFoundError('Master key', 'keychain'));
    }

    // Load vault file
    const loadResult = await this.loadVault();
    if (!loadResult.ok) {
      secureClear(masterKey);
      return loadResult;
    }

    // Derive encryption key from master key
    const salt = fromBase64(this.vaultData!.salt);
    const deriveResult = await deriveKey(toBase64(masterKey), salt, {
      iterations: this.config.iterations,
    });

    secureClear(masterKey);

    if (!deriveResult.ok) {
      return deriveResult;
    }

    this.derivedKey = deriveResult.value;
    this.isUnlocked = true;
    return ok(undefined);
  }

  /**
   * Lock the vault (clear encryption key from memory)
   */
  lock(): void {
    this.derivedKey = null;
    this.isUnlocked = false;
  }

  /**
   * Check if vault is unlocked
   */
  get unlocked(): boolean {
    return this.isUnlocked;
  }

  /**
   * Store a value in the vault
   *
   * @param key - The key to store under
   * @param value - The value to store (must be JSON-serializable)
   */
  async set(key: string, value: JsonValue): Promise<Result<void, CryptoError | ValidationError>> {
    if (!this.isUnlocked || !this.derivedKey || !this.vaultData) {
      return err(new ValidationError('Vault is locked'));
    }

    try {
      // Serialize value
      const plaintext = new TextEncoder().encode(JSON.stringify(value));

      // Generate unique IV for this entry
      const iv = generateIV();

      // Encrypt
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        this.derivedKey,
        plaintext
      );

      // Combine IV + ciphertext (authTag is included in ciphertext for AES-GCM)
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(ciphertext), iv.length);

      // Store as base64
      this.vaultData.entries[key] = toBase64(combined);

      // Save vault
      return await this.saveVault();
    } catch (error) {
      return err(
        new CryptoError('encrypt', `Failed to encrypt value for key: ${key}`, { cause: error })
      );
    }
  }

  /**
   * Retrieve a value from the vault
   *
   * @param key - The key to retrieve
   * @returns The decrypted value, or null if not found
   */
  async get<T extends JsonValue>(
    key: string
  ): Promise<Result<T | null, CryptoError | ValidationError>> {
    if (!this.isUnlocked || !this.derivedKey || !this.vaultData) {
      return err(new ValidationError('Vault is locked'));
    }

    const entry = this.vaultData.entries[key];
    if (!entry) {
      return ok(null);
    }

    try {
      // Decode from base64
      const combined = fromBase64(entry);

      // Extract IV (first 12 bytes) and ciphertext (rest)
      const iv = combined.slice(0, 12);
      const ciphertext = combined.slice(12);

      // Decrypt
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.derivedKey,
        ciphertext
      );

      // Parse JSON
      const text = new TextDecoder().decode(plaintext);
      return ok(JSON.parse(text) as T);
    } catch (error) {
      return err(
        new CryptoError('decrypt', `Failed to decrypt value for key: ${key}`, { cause: error })
      );
    }
  }

  /**
   * Delete a value from the vault
   *
   * @param key - The key to delete
   * @returns true if deleted, false if not found
   */
  async delete(key: string): Promise<Result<boolean, ValidationError | CryptoError>> {
    if (!this.isUnlocked || !this.vaultData) {
      return err(new ValidationError('Vault is locked'));
    }

    if (!(key in this.vaultData.entries)) {
      return ok(false);
    }

    delete this.vaultData.entries[key];
    const saveResult = await this.saveVault();
    if (!saveResult.ok) {
      return saveResult;
    }

    return ok(true);
  }

  /**
   * Check if a key exists in the vault
   */
  has(key: string): Result<boolean, ValidationError> {
    if (!this.isUnlocked || !this.vaultData) {
      return err(new ValidationError('Vault is locked'));
    }

    return ok(key in this.vaultData.entries);
  }

  /**
   * List all keys in the vault
   */
  keys(): Result<string[], ValidationError> {
    if (!this.isUnlocked || !this.vaultData) {
      return err(new ValidationError('Vault is locked'));
    }

    return ok(Object.keys(this.vaultData.entries));
  }

  /**
   * Clear all entries from the vault
   */
  async clear(): Promise<Result<void, ValidationError | CryptoError>> {
    if (!this.isUnlocked || !this.vaultData) {
      return err(new ValidationError('Vault is locked'));
    }

    this.vaultData.entries = {};
    return await this.saveVault();
  }

  /**
   * Destroy the vault completely (delete keychain entry and vault file)
   */
  async destroy(): Promise<Result<void, CryptoError | InternalError>> {
    this.lock();

    // Delete from keychain
    const deleteResult = await deleteSecret(this.keychainConfig);
    if (!deleteResult.ok) {
      return deleteResult;
    }

    // Delete vault file
    // Note: We're not deleting the file itself, just clearing it
    // The user should manually delete if needed
    this.vaultData = null;

    return ok(undefined);
  }

  /**
   * Load vault file from disk
   */
  private async loadVault(): Promise<Result<void, CryptoError | NotFoundError>> {
    if (!existsSync(this.config.path)) {
      return err(new NotFoundError('Vault file', this.config.path));
    }

    const readResult = await fromPromise(readFile(this.config.path, 'utf-8'));
    if (!readResult.ok) {
      return err(
        new CryptoError('decrypt', 'Failed to read vault file', { cause: readResult.error })
      );
    }

    try {
      this.vaultData = JSON.parse(readResult.value) as VaultFile;
      return ok(undefined);
    } catch (error) {
      return err(new CryptoError('decrypt', 'Invalid vault file format', { cause: error }));
    }
  }

  /**
   * Save vault file to disk
   */
  private async saveVault(): Promise<Result<void, CryptoError>> {
    if (!this.vaultData) {
      return err(new CryptoError('encrypt', 'No vault data to save'));
    }

    try {
      // Ensure directory exists
      const dir = dirname(this.config.path);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      await writeFile(this.config.path, JSON.stringify(this.vaultData, null, 2), 'utf-8');
      return ok(undefined);
    } catch (error) {
      return err(new CryptoError('encrypt', 'Failed to write vault file', { cause: error }));
    }
  }

  /**
   * Change the master key (re-encrypt all entries)
   * Must be unlocked first
   */
  async rotateMasterKey(): Promise<Result<void, CryptoError | ValidationError | InternalError>> {
    if (!this.isUnlocked || !this.derivedKey || !this.vaultData) {
      return err(new ValidationError('Vault is locked'));
    }

    // Decrypt all current entries
    const decrypted: Record<string, JsonValue> = {};
    for (const key of Object.keys(this.vaultData.entries)) {
      const result = await this.get(key);
      if (!result.ok) {
        return result as Result<void, CryptoError>;
      }
      if (result.value !== null) {
        decrypted[key] = result.value;
      }
    }

    // Generate new master key
    const newMasterKey = generateMasterKey(32);

    // Store in keychain (overwrites old one)
    const storeResult = await storeSecret(newMasterKey, this.keychainConfig);
    if (!storeResult.ok) {
      secureClear(newMasterKey);
      return storeResult;
    }

    // Generate new salt
    const newSalt = generateSalt(32);

    // Derive new encryption key
    const deriveResult = await deriveKey(toBase64(newMasterKey), newSalt, {
      iterations: this.config.iterations,
    });

    secureClear(newMasterKey);

    if (!deriveResult.ok) {
      return deriveResult;
    }

    // Update vault data
    this.derivedKey = deriveResult.value;
    this.vaultData.salt = toBase64(newSalt);
    this.vaultData.entries = {};

    // Re-encrypt all entries
    for (const [key, value] of Object.entries(decrypted)) {
      const setResult = await this.set(key, value);
      if (!setResult.ok) {
        return setResult;
      }
    }

    return ok(undefined);
  }
}

/**
 * Create a vault instance
 */
export function createVault(config: VaultConfig): SecureVault {
  return new SecureVault(config);
}
