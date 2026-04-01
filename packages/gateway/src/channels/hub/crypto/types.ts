/**
 * Signal Protocol Types
 *
 * Type definitions for E2E encryption using Signal Protocol (Double Ratchet).
 */

/**
 * Curve25519 key pair for X3DH and Double Ratchet
 */
export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Identity key pair (long-term)
 */
export interface IdentityKeyPair extends KeyPair {
  keyId: string;
  createdAt: Date;
}

/**
 * Pre-key (one-time use for X3DH initial handshake)
 */
export interface PreKey {
  keyId: number;
  keyPair: KeyPair;
  used: boolean;
  usedAt?: Date;
}

/**
 * Signed pre-key (medium-term, rotates periodically)
 */
export interface SignedPreKey {
  keyId: number;
  keyPair: KeyPair;
  signature: Uint8Array;
  createdAt: Date;
}

/**
 * Bundle of public keys for X3DH initial handshake
 * Sent to server to establish initial contact
 */
export interface PublicKeyBundle {
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
}

/**
 * Encrypted message format
 */
export interface EncryptedMessage {
  // Header (unencrypted, but authenticated)
  header: {
    senderIdentityKey: string; // base64
    senderDeviceId: string;
    senderPreKeyId?: number;
    senderSignedPreKeyId: number;
    senderEphemeralKey: string; // base64
    previousChainLength: number;
    messageNumber: number;
    timestamp: number;
  };
  // Ciphertext
  ciphertext: string; // base64
  // Authentication tag
  authTag: string; // base64
}

/**
 * Chain key for symmetric ratchet
 */
export interface ChainKey {
  key: Uint8Array;
  index: number;
}

/**
 * Message key derived from chain key
 */
export interface MessageKey {
  cipherKey: Uint8Array;
  macKey: Uint8Array;
  iv: Uint8Array;
  index: number;
}

/**
 * Root key for root ratchet (updates on DH ratchet step)
 */
export interface RootKey {
  key: Uint8Array;
}

/**
 * Ratchet state for a session
 */
export interface RatchetState {
  rootKey: RootKey;
  sendingChain?: ChainKey;
  receivingChain?: ChainKey;
  sendMessageNumber: number;
  receiveMessageNumber: number;
  previousChainLength: number;
  senderRatchetKeyPair?: KeyPair;
  receiverRatchetPublicKey?: Uint8Array;
}

/**
 * Session state for a peer
 */
export interface SessionState {
  sessionId: string;
  peerIdentityKey: string; // base64 fingerprint
  peerDeviceId: string;
  registrationId: number;
  ratchetState: RatchetState;
  establishedAt: Date;
  lastUsedAt: Date;
}

/**
 * Session initiation result
 */
export interface SessionInitiation {
  sessionId: string;
  initialMessage?: EncryptedMessage;
  keyBundle: PublicKeyBundle;
}

/**
 * Encryption result
 */
export interface EncryptionResult {
  encrypted: EncryptedMessage;
  sessionId: string;
}

/**
 * Decryption result
 */
export interface DecryptionResult {
  plaintext: string;
  sessionId: string;
  senderIdentity: string;
}

/**
 * Key store configuration
 */
export interface KeyStoreConfig {
  identityKeyPath: string;
  preKeyCount: number; // Number of one-time pre-keys to maintain
  signedPreKeyRotationDays: number;
}

/**
 * Session store interface
 */
export interface SessionStore {
  getSession(peerIdentityKey: string): Promise<SessionState | null>;
  saveSession(session: SessionState): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  getAllSessions(): Promise<SessionState[]>;
}

/**
 * Key store interface
 */
export interface IKeyStore {
  // Identity key
  getIdentityKeyPair(): Promise<IdentityKeyPair>;
  generateIdentityKeyPair(): Promise<IdentityKeyPair>;

  // Pre-keys
  getPreKey(keyId: number): Promise<PreKey | null>;
  storePreKey(preKey: PreKey): Promise<void>;
  removePreKey(keyId: number): Promise<void>;
  getUnusedPreKeys(): Promise<PreKey[]>;
  generatePreKeys(count: number): Promise<PreKey[]>;

  // Signed pre-keys
  getSignedPreKey(keyId: number): Promise<SignedPreKey | null>;
  getActiveSignedPreKey(): Promise<SignedPreKey>;
  storeSignedPreKey(signedPreKey: SignedPreKey): Promise<void>;
  generateSignedPreKey(keyId: number): Promise<SignedPreKey>;
  rotateSignedPreKey(): Promise<SignedPreKey>;

  // Registration ID
  getRegistrationId(): Promise<number>;
}

/**
 * Crypto provider interface for pluggable crypto
 */
export interface CryptoProvider {
  generateKeyPair(): Promise<KeyPair>;
  generateIdentityKeyPair(): Promise<IdentityKeyPair>;
  generatePreKey(keyId: number): Promise<PreKey>;
  generateSignedPreKey(identityKey: IdentityKeyPair, keyId: number): Promise<SignedPreKey>;
  sign(identityKey: IdentityKeyPair, message: Uint8Array): Promise<Uint8Array>;
  verify(identityPublicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
  deriveSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array>;
  hkdf(inputKeyMaterial: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array>;
  encrypt(aesKey: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>;
  decrypt(aesKey: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array>;
  generateRandomBytes(length: number): Uint8Array;
}

/**
 * Privacy level configuration
 */
export interface PrivacyConfig {
  level: 'standard' | 'enhanced' | 'paranoid';
  e2eEnabled: boolean;
  metadataStripping: boolean;
  ephemeralTimeout?: number; // seconds for paranoid mode
  forwardSecrecy: boolean;
  futureSecrecy: boolean;
}

// Backward compatibility alias
export type CryptoPrivacyConfig = PrivacyConfig;
