/**
 * Key Store
 *
 * Persistent storage for Signal Protocol keys.
 * Uses database for production, memory for testing.
 */

import { getLog } from '../../../services/log.js';
import type {
  IKeyStore,
  IdentityKeyPair,
  PreKey,
  SignedPreKey,
  SessionStore,
  SessionState,
} from './types.js';
import type { CryptoProvider } from './types.js';

const log = getLog('Signal:KeyStore');

interface StoredKeys {
  identityKey?: IdentityKeyPair;
  preKeys: Map<number, PreKey>;
  signedPreKeys: Map<number, SignedPreKey>;
  activeSignedPreKeyId?: number;
  registrationId?: number;
}

/**
 * In-memory key store for testing and development.
 * In production, this should be backed by encrypted database storage.
 */
export class MemoryKeyStore implements IKeyStore, SessionStore {
  private keys: StoredKeys;
  private sessions = new Map<string, SessionState>();
  private crypto: CryptoProvider;

  constructor(crypto: CryptoProvider) {
    this.crypto = crypto;
    this.keys = {
      preKeys: new Map(),
      signedPreKeys: new Map(),
    };
  }

  // ========================================================================
  // Identity Key
  // ========================================================================

  async getIdentityKeyPair(): Promise<IdentityKeyPair> {
    if (!this.keys.identityKey) {
      throw new Error('Identity key not found. Generate one first.');
    }
    return this.keys.identityKey;
  }

  async generateIdentityKeyPair(): Promise<IdentityKeyPair> {
    const keyPair = await this.crypto.generateIdentityKeyPair();
    this.keys.identityKey = keyPair;
    log.info('Generated new identity key pair', { keyId: keyPair.keyId });
    return keyPair;
  }

  getIdentityKeyFingerprint(): string {
    if (!this.keys.identityKey) {
      throw new Error('Identity key not found');
    }
    // Create fingerprint from first 16 bytes of public key
    const publicKey = this.keys.identityKey.publicKey;
    return Buffer.from(publicKey.slice(0, 16)).toString('base64');
  }

  // ========================================================================
  // Pre-keys (one-time use)
  // ========================================================================

  async getPreKey(keyId: number): Promise<PreKey | null> {
    const preKey = this.keys.preKeys.get(keyId);
    if (!preKey) return null;

    // Mark as used when retrieved (for X3DH)
    if (!preKey.used) {
      preKey.used = true;
      preKey.usedAt = new Date();
      this.keys.preKeys.set(keyId, preKey);
    }

    return preKey;
  }

  async storePreKey(preKey: PreKey): Promise<void> {
    this.keys.preKeys.set(preKey.keyId, preKey);
  }

  async removePreKey(keyId: number): Promise<void> {
    this.keys.preKeys.delete(keyId);
  }

  async getUnusedPreKeys(): Promise<PreKey[]> {
    return Array.from(this.keys.preKeys.values()).filter(k => !k.used);
  }

  async generatePreKeys(count: number): Promise<PreKey[]> {
    const startId = this.keys.preKeys.size;
    const preKeys: PreKey[] = [];

    for (let i = 0; i < count; i++) {
      const keyId = startId + i;
      const preKey = await this.crypto.generatePreKey(keyId);
      this.keys.preKeys.set(keyId, preKey);
      preKeys.push(preKey);
    }

    log.info(`Generated ${count} pre-keys`, { total: this.keys.preKeys.size });
    return preKeys;
  }

  /**
   * Maintain minimum pre-key count.
   * Should be called periodically to ensure server has enough pre-keys.
   */
  async maintainPreKeys(minCount: number): Promise<PreKey[]> {
    const unused = await this.getUnusedPreKeys();
    const needed = minCount - unused.length;

    if (needed > 0) {
      log.info(`Generating ${needed} new pre-keys to maintain minimum`, { minCount });
      return this.generatePreKeys(needed);
    }

    return [];
  }

  // ========================================================================
  // Signed Pre-keys (medium-term)
  // ========================================================================

  async getSignedPreKey(keyId: number): Promise<SignedPreKey | null> {
    return this.keys.signedPreKeys.get(keyId) ?? null;
  }

  async getActiveSignedPreKey(): Promise<SignedPreKey> {
    if (this.keys.activeSignedPreKeyId === undefined) {
      throw new Error('No active signed pre-key');
    }

    const key = this.keys.signedPreKeys.get(this.keys.activeSignedPreKeyId);
    if (!key) {
      throw new Error('Active signed pre-key not found');
    }

    return key;
  }

  async storeSignedPreKey(signedPreKey: SignedPreKey): Promise<void> {
    this.keys.signedPreKeys.set(signedPreKey.keyId, signedPreKey);
  }

  async generateSignedPreKey(keyId: number): Promise<SignedPreKey> {
    const identityKey = await this.getIdentityKeyPair();
    const signedPreKey = await this.crypto.generateSignedPreKey(identityKey, keyId);

    this.keys.signedPreKeys.set(keyId, signedPreKey);

    // If this is the first signed pre-key, make it active
    if (this.keys.activeSignedPreKeyId === undefined) {
      this.keys.activeSignedPreKeyId = keyId;
    }

    log.info('Generated signed pre-key', { keyId });
    return signedPreKey;
  }

  async rotateSignedPreKey(): Promise<SignedPreKey> {
    const newKeyId = this.keys.signedPreKeys.size;
    const newKey = await this.generateSignedPreKey(newKeyId);
    this.keys.activeSignedPreKeyId = newKeyId;

    log.info('Rotated signed pre-key', { newKeyId });
    return newKey;
  }

  /**
   * Check if signed pre-key needs rotation (older than threshold).
   */
  shouldRotateSignedPreKey(maxAgeDays: number): boolean {
    if (this.keys.activeSignedPreKeyId === undefined) return true;

    const activeKey = this.keys.signedPreKeys.get(this.keys.activeSignedPreKeyId);
    if (!activeKey) return true;

    const ageMs = Date.now() - activeKey.createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    return ageDays > maxAgeDays;
  }

  // ========================================================================
  // Registration ID
  // ========================================================================

  async getRegistrationId(): Promise<number> {
    if (!this.keys.registrationId) {
      // Generate random 31-bit registration ID
      this.keys.registrationId = Math.floor(Math.random() * 0x7fffffff) + 1;
    }
    return this.keys.registrationId;
  }

  // ========================================================================
  // Session Store Implementation
  // ========================================================================

  async getSession(peerIdentityKey: string): Promise<SessionState | null> {
    return this.sessions.get(peerIdentityKey) ?? null;
  }

  async saveSession(session: SessionState): Promise<void> {
    this.sessions.set(session.peerIdentityKey, session);
    log.debug('Saved session', { sessionId: session.sessionId, peer: session.peerIdentityKey.slice(0, 8) });
  }

  async deleteSession(sessionId: string): Promise<void> {
    for (const [key, session] of this.sessions) {
      if (session.sessionId === sessionId) {
        this.sessions.delete(key);
        log.debug('Deleted session', { sessionId });
        return;
      }
    }
  }

  async getAllSessions(): Promise<SessionState[]> {
    return Array.from(this.sessions.values());
  }

  // ========================================================================
  // Bundle Generation
  // ========================================================================

  /**
   * Generate public key bundle for X3DH initial handshake.
   * This is what gets uploaded to the server for others to initiate sessions.
   */
  async generatePublicKeyBundle(): Promise<{
    identityKey: Uint8Array;
    signedPreKey: {
      keyId: number;
      publicKey: Uint8Array;
      signature: Uint8Array;
    };
    oneTimePreKeys: Array<{
      keyId: number;
      publicKey: Uint8Array;
    }>;
    registrationId: number;
  }> {
    const identityKey = await this.getIdentityKeyPair();
    const signedPreKey = await this.getActiveSignedPreKey();
    const unusedPreKeys = await this.getUnusedPreKeys();
    const registrationId = await this.getRegistrationId();

    // Limit to 100 pre-keys in bundle (Signal recommendation)
    const preKeysForBundle = unusedPreKeys.slice(0, 100).map(k => ({
      keyId: k.keyId,
      publicKey: k.keyPair.publicKey,
    }));

    return {
      identityKey: identityKey.publicKey,
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: signedPreKey.keyPair.publicKey,
        signature: signedPreKey.signature,
      },
      oneTimePreKeys: preKeysForBundle,
      registrationId,
    };
  }

  // ========================================================================
  // Initialization
  // ========================================================================

  /**
   * Initialize key store with required keys.
   * Call this on first run.
   */
  async initialize(preKeyCount: number = 100): Promise<void> {
    if (!this.keys.identityKey) {
      await this.generateIdentityKeyPair();
    }

    if (this.keys.signedPreKeys.size === 0) {
      await this.generateSignedPreKey(0);
      this.keys.activeSignedPreKeyId = 0;
    }

    const unused = await this.getUnusedPreKeys();
    if (unused.length < preKeyCount) {
      const needed = preKeyCount - unused.length;
      await this.generatePreKeys(needed);
    }

    log.info('Key store initialized', {
      identityKey: this.keys.identityKey?.keyId,
      signedPreKeys: this.keys.signedPreKeys.size,
      preKeys: this.keys.preKeys.size,
    });
  }

  /**
   * Get store statistics for monitoring.
   */
  getStats(): {
    hasIdentityKey: boolean;
    signedPreKeys: number;
    totalPreKeys: number;
    unusedPreKeys: number;
    activeSessions: number;
  } {
    return {
      hasIdentityKey: !!this.keys.identityKey,
      signedPreKeys: this.keys.signedPreKeys.size,
      totalPreKeys: this.keys.preKeys.size,
      unusedPreKeys: Array.from(this.keys.preKeys.values()).filter(k => !k.used).length,
      activeSessions: this.sessions.size,
    };
  }
}
