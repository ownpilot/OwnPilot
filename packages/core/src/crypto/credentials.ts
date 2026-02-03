/**
 * CredentialStore - Password-based encrypted credential storage
 *
 * For personal AI gateway deployments where each user stores their
 * own API keys securely with a master password.
 *
 * - AES-256-GCM encryption
 * - PBKDF2 key derivation (600K iterations)
 * - No OS keychain dependency - works on any VPS
 * - Tamper detection via authentication tag
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { webcrypto } from 'node:crypto';
import { type Result, ok, err, fromPromise } from '../types/result.js';
import { CryptoError, NotFoundError, ValidationError } from '../types/errors.js';
import {
  deriveKey,
  generateSalt,
  generateIV,
  toBase64,
  fromBase64,
} from './derive.js';

const crypto = webcrypto;
type CryptoKeyType = Awaited<ReturnType<typeof crypto.subtle.deriveKey>>;

/**
 * Credential store configuration
 */
export interface CredentialStoreConfig {
  /** Path to credentials file (default: ~/.ownpilot/credentials.enc) */
  path?: string;
  /** PBKDF2 iterations (default: 600,000) */
  iterations?: number;
}

/**
 * Credentials file format
 */
interface CredentialsFile {
  version: 1;
  salt: string; // base64
  /** Password verification hash */
  verifier: string; // base64
  /** Encrypted credentials */
  data: string; // base64(IV || ciphertext || authTag)
}

/**
 * Custom provider configuration
 */
export interface CustomProviderConfig {
  /** Provider name */
  name: string;
  /** API base URL */
  baseUrl: string;
  /** API key */
  apiKey: string;
  /** Default model */
  defaultModel?: string;
}

/**
 * Stored credentials structure (Updated January 2026)
 */
export interface StoredCredentials {
  // Built-in providers
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;       // Google AI (Gemini)

  // OpenAI-compatible providers
  zhipuApiKey?: string;        // ZAI GLM (Zhipu AI)
  deepseekApiKey?: string;     // DeepSeek
  groqApiKey?: string;         // Groq
  togetherApiKey?: string;     // Together AI
  mistralApiKey?: string;      // Mistral AI
  fireworksApiKey?: string;    // Fireworks AI
  perplexityApiKey?: string;   // Perplexity
  xaiApiKey?: string;          // xAI (Grok)

  // Communication
  telegramBotToken?: string;

  // Security
  jwtSecret?: string;
  encryptionKey?: string;

  /** Custom/additional providers */
  customProviders?: CustomProviderConfig[];

  /** Other custom credentials */
  custom?: Record<string, string>;
}

const DEFAULT_PATH = join(homedir(), '.ownpilot', 'credentials.enc');

/**
 * CredentialStore - Password-based encrypted credential storage
 *
 * Usage:
 * ```ts
 * const store = new CredentialStore();
 *
 * // First time setup
 * await store.initialize('my-secure-password');
 * await store.unlock('my-secure-password');
 * await store.setCredentials({ openaiApiKey: 'sk-...' });
 *
 * // Later, to use
 * await store.unlock('my-secure-password');
 * const creds = await store.getCredentials();
 * ```
 */
export class CredentialStore {
  private readonly config: Required<CredentialStoreConfig>;
  private derivedKey: CryptoKeyType | null = null;
  private credentials: StoredCredentials | null = null;
  private isUnlocked = false;

  constructor(config: CredentialStoreConfig = {}) {
    this.config = {
      path: config.path ?? DEFAULT_PATH,
      iterations: config.iterations ?? 600_000,
    };
  }

  /**
   * Check if credential store is initialized (file exists)
   */
  isInitialized(): boolean {
    return existsSync(this.config.path);
  }

  /**
   * Initialize the credential store with a master password
   * Creates the encrypted credentials file
   */
  async initialize(password: string): Promise<Result<void, ValidationError | CryptoError>> {
    if (this.isInitialized()) {
      return err(new ValidationError('Credential store already initialized'));
    }

    if (!password || password.length < 8) {
      return err(new ValidationError('Password must be at least 8 characters'));
    }

    try {
      // Generate salt
      const salt = generateSalt(32);

      // Derive key from password
      const deriveResult = await deriveKey(password, salt, {
        iterations: this.config.iterations,
      });

      if (!deriveResult.ok) {
        return deriveResult;
      }

      // Create password verifier (encrypt a known string)
      const verifierPlaintext = new TextEncoder().encode('OWNPILOT_VERIFIED');
      const verifierIv = generateIV();
      const verifierCiphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: verifierIv },
        deriveResult.value,
        verifierPlaintext
      );

      const verifierCombined = new Uint8Array(verifierIv.length + verifierCiphertext.byteLength);
      verifierCombined.set(verifierIv, 0);
      verifierCombined.set(new Uint8Array(verifierCiphertext), verifierIv.length);

      // Encrypt empty credentials
      const emptyCredentials: StoredCredentials = {};
      const dataPlaintext = new TextEncoder().encode(JSON.stringify(emptyCredentials));
      const dataIv = generateIV();
      const dataCiphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: dataIv },
        deriveResult.value,
        dataPlaintext
      );

      const dataCombined = new Uint8Array(dataIv.length + dataCiphertext.byteLength);
      dataCombined.set(dataIv, 0);
      dataCombined.set(new Uint8Array(dataCiphertext), dataIv.length);

      // Create credentials file
      const file: CredentialsFile = {
        version: 1,
        salt: toBase64(salt),
        verifier: toBase64(verifierCombined),
        data: toBase64(dataCombined),
      };

      // Ensure directory exists
      const dir = dirname(this.config.path);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true, mode: 0o700 });
      }

      // Write file with restricted permissions
      await writeFile(this.config.path, JSON.stringify(file, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });

      return ok(undefined);
    } catch (error) {
      return err(new CryptoError('encrypt', 'Failed to initialize credential store', { cause: error }));
    }
  }

  /**
   * Unlock the credential store with the master password
   */
  async unlock(password: string): Promise<Result<void, ValidationError | CryptoError | NotFoundError>> {
    if (this.isUnlocked) {
      return ok(undefined);
    }

    if (!this.isInitialized()) {
      return err(new NotFoundError('Credential store', this.config.path));
    }

    // Read file
    const readResult = await fromPromise(readFile(this.config.path, 'utf-8'));
    if (!readResult.ok) {
      return err(new CryptoError('decrypt', 'Failed to read credentials file', { cause: readResult.error }));
    }

    let file: CredentialsFile;
    try {
      file = JSON.parse(readResult.value) as CredentialsFile;
    } catch {
      return err(new CryptoError('decrypt', 'Invalid credentials file format'));
    }

    // Derive key from password
    const salt = fromBase64(file.salt);
    const deriveResult = await deriveKey(password, salt, {
      iterations: this.config.iterations,
    });

    if (!deriveResult.ok) {
      return deriveResult;
    }

    // Verify password by decrypting verifier
    try {
      const verifierCombined = fromBase64(file.verifier);
      const verifierIv = verifierCombined.slice(0, 12);
      const verifierCiphertext = verifierCombined.slice(12);

      const verifierPlaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: verifierIv },
        deriveResult.value,
        verifierCiphertext
      );

      const verifierText = new TextDecoder().decode(verifierPlaintext);
      if (verifierText !== 'OWNPILOT_VERIFIED') {
        return err(new ValidationError('Invalid password'));
      }
    } catch {
      return err(new ValidationError('Invalid password'));
    }

    // Decrypt credentials
    try {
      const dataCombined = fromBase64(file.data);
      const dataIv = dataCombined.slice(0, 12);
      const dataCiphertext = dataCombined.slice(12);

      const dataPlaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: dataIv },
        deriveResult.value,
        dataCiphertext
      );

      this.credentials = JSON.parse(new TextDecoder().decode(dataPlaintext)) as StoredCredentials;
      this.derivedKey = deriveResult.value;
      this.isUnlocked = true;

      return ok(undefined);
    } catch (error) {
      return err(new CryptoError('decrypt', 'Failed to decrypt credentials', { cause: error }));
    }
  }

  /**
   * Lock the credential store (clear sensitive data from memory)
   */
  lock(): void {
    this.derivedKey = null;
    this.credentials = null;
    this.isUnlocked = false;
  }

  /**
   * Check if store is unlocked
   */
  get unlocked(): boolean {
    return this.isUnlocked;
  }

  /**
   * Get all credentials
   */
  getCredentials(): Result<StoredCredentials, ValidationError> {
    if (!this.isUnlocked || !this.credentials) {
      return err(new ValidationError('Credential store is locked'));
    }
    return ok({ ...this.credentials });
  }

  /**
   * Set credentials (merges with existing)
   */
  async setCredentials(credentials: Partial<StoredCredentials>): Promise<Result<void, ValidationError | CryptoError>> {
    if (!this.isUnlocked || !this.derivedKey) {
      return err(new ValidationError('Credential store is locked'));
    }

    // Merge credentials
    this.credentials = {
      ...this.credentials,
      ...credentials,
    };

    // Save to file
    return await this.save();
  }

  /**
   * Delete a specific credential
   */
  async deleteCredential(key: keyof StoredCredentials): Promise<Result<void, ValidationError | CryptoError>> {
    if (!this.isUnlocked || !this.credentials) {
      return err(new ValidationError('Credential store is locked'));
    }

    if (key === 'custom') {
      this.credentials.custom = undefined;
    } else {
      delete this.credentials[key];
    }

    return await this.save();
  }

  /**
   * Change the master password
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<Result<void, ValidationError | CryptoError | NotFoundError>> {
    // First unlock with current password
    if (!this.isUnlocked) {
      const unlockResult = await this.unlock(currentPassword);
      if (!unlockResult.ok) {
        return unlockResult;
      }
    }

    if (!newPassword || newPassword.length < 8) {
      return err(new ValidationError('New password must be at least 8 characters'));
    }

    // Read current file to get structure
    const readResult = await fromPromise(readFile(this.config.path, 'utf-8'));
    if (!readResult.ok) {
      return err(new CryptoError('decrypt', 'Failed to read credentials file', { cause: readResult.error }));
    }

    try {
      // Generate new salt
      const newSalt = generateSalt(32);

      // Derive new key
      const deriveResult = await deriveKey(newPassword, newSalt, {
        iterations: this.config.iterations,
      });

      if (!deriveResult.ok) {
        return deriveResult;
      }

      // Create new verifier
      const verifierPlaintext = new TextEncoder().encode('OWNPILOT_VERIFIED');
      const verifierIv = generateIV();
      const verifierCiphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: verifierIv },
        deriveResult.value,
        verifierPlaintext
      );

      const verifierCombined = new Uint8Array(verifierIv.length + verifierCiphertext.byteLength);
      verifierCombined.set(verifierIv, 0);
      verifierCombined.set(new Uint8Array(verifierCiphertext), verifierIv.length);

      // Re-encrypt credentials with new key
      const dataPlaintext = new TextEncoder().encode(JSON.stringify(this.credentials));
      const dataIv = generateIV();
      const dataCiphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: dataIv },
        deriveResult.value,
        dataPlaintext
      );

      const dataCombined = new Uint8Array(dataIv.length + dataCiphertext.byteLength);
      dataCombined.set(dataIv, 0);
      dataCombined.set(new Uint8Array(dataCiphertext), dataIv.length);

      // Update file
      const file: CredentialsFile = {
        version: 1,
        salt: toBase64(newSalt),
        verifier: toBase64(verifierCombined),
        data: toBase64(dataCombined),
      };

      await writeFile(this.config.path, JSON.stringify(file, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });

      // Update internal state
      this.derivedKey = deriveResult.value;

      return ok(undefined);
    } catch (error) {
      return err(new CryptoError('encrypt', 'Failed to change password', { cause: error }));
    }
  }

  /**
   * Save credentials to file
   */
  private async save(): Promise<Result<void, CryptoError>> {
    if (!this.derivedKey || !this.credentials) {
      return err(new CryptoError('encrypt', 'No credentials to save'));
    }

    try {
      // Read current file
      const readResult = await fromPromise(readFile(this.config.path, 'utf-8'));
      if (!readResult.ok) {
        return err(new CryptoError('encrypt', 'Failed to read credentials file'));
      }

      const file = JSON.parse(readResult.value) as CredentialsFile;

      // Encrypt credentials
      const dataPlaintext = new TextEncoder().encode(JSON.stringify(this.credentials));
      const dataIv = generateIV();
      const dataCiphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: dataIv },
        this.derivedKey,
        dataPlaintext
      );

      const dataCombined = new Uint8Array(dataIv.length + dataCiphertext.byteLength);
      dataCombined.set(dataIv, 0);
      dataCombined.set(new Uint8Array(dataCiphertext), dataIv.length);

      // Update file
      file.data = toBase64(dataCombined);

      await writeFile(this.config.path, JSON.stringify(file, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });

      return ok(undefined);
    } catch (error) {
      return err(new CryptoError('encrypt', 'Failed to save credentials', { cause: error }));
    }
  }

  /**
   * Load credentials to environment variables
   */
  loadToEnv(): Result<void, ValidationError> {
    if (!this.isUnlocked || !this.credentials) {
      return err(new ValidationError('Credential store is locked'));
    }

    const mapping: Partial<Record<keyof StoredCredentials, string>> = {
      // Main providers
      openaiApiKey: 'OPENAI_API_KEY',
      anthropicApiKey: 'ANTHROPIC_API_KEY',
      googleApiKey: 'GOOGLE_API_KEY',

      // OpenAI-compatible providers
      zhipuApiKey: 'ZHIPU_API_KEY',
      deepseekApiKey: 'DEEPSEEK_API_KEY',
      groqApiKey: 'GROQ_API_KEY',
      togetherApiKey: 'TOGETHER_API_KEY',
      mistralApiKey: 'MISTRAL_API_KEY',
      fireworksApiKey: 'FIREWORKS_API_KEY',
      perplexityApiKey: 'PERPLEXITY_API_KEY',
      xaiApiKey: 'XAI_API_KEY',

      // Communication
      telegramBotToken: 'TELEGRAM_BOT_TOKEN',

      // Security
      jwtSecret: 'JWT_SECRET',
      encryptionKey: 'ENCRYPTION_KEY',
    };

    for (const [key, envVar] of Object.entries(mapping)) {
      const value = this.credentials[key as keyof StoredCredentials];
      if (value && typeof value === 'string' && envVar && !process.env[envVar]) {
        process.env[envVar] = value;
      }
    }

    // Load custom credentials
    if (this.credentials.custom) {
      for (const [key, value] of Object.entries(this.credentials.custom)) {
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }

    return ok(undefined);
  }

  /**
   * Delete the credential store completely
   */
  async destroy(): Promise<Result<void, CryptoError>> {
    this.lock();

    try {
      const { unlink } = await import('node:fs/promises');
      if (existsSync(this.config.path)) {
        await unlink(this.config.path);
      }
      return ok(undefined);
    } catch (error) {
      return err(new CryptoError('encrypt', 'Failed to delete credentials file', { cause: error }));
    }
  }

  /**
   * Get the credentials file path
   */
  get path(): string {
    return this.config.path;
  }
}

/**
 * Create a credential store instance
 */
export function createCredentialStore(config?: CredentialStoreConfig): CredentialStore {
  return new CredentialStore(config);
}

/**
 * Default credential store instance
 */
let defaultStore: CredentialStore | null = null;

/**
 * Get or create the default credential store
 */
export function getCredentialStore(): CredentialStore {
  if (!defaultStore) {
    defaultStore = new CredentialStore();
  }
  return defaultStore;
}
