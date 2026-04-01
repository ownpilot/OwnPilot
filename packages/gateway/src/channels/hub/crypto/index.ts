/**
 * Signal Protocol E2E Encryption
 *
 * End-to-end encryption for Channel Hub using Signal Protocol (Double Ratchet).
 *
 * @example
 * ```typescript
 * import { createSignalProtocol, EncryptedMessage } from './crypto/index.js';
 *
 * // Create protocol instance
 * const signal = await createSignalProtocol();
 *
 * // Initiate session with peer
 * const peerBundle = await fetchPeerKeyBundle(peerId);
 * const session = await signal.initiateSession(peerBundle, 'peer-device-123');
 *
 * // Encrypt message
 * const { encrypted } = await signal.encrypt(session.sessionId, 'Hello!');
 *
 * // Decrypt message
 * const { plaintext } = await signal.decrypt(encryptedMessage, 'peer-device-123');
 * ```
 */

// Types
export type {
  // Core types
  KeyPair,
  IdentityKeyPair,
  PreKey,
  SignedPreKey,
  PublicKeyBundle,
  EncryptedMessage,
  ChainKey,
  MessageKey,
  RootKey,
  RatchetState,
  SessionState,
  SessionInitiation,
  EncryptionResult,
  DecryptionResult,
  KeyStoreConfig,
  SessionStore,
  IKeyStore,
  CryptoProvider,
  PrivacyConfig,
} from './types.js';

// Implementations
export { NodeCryptoProvider, nodeCrypto } from './node-crypto.js';
export { MemoryKeyStore } from './key-store.js';
export { SignalProtocol } from './signal-protocol.js';

// Factory function for easy setup
import { NodeCryptoProvider } from './node-crypto.js';
import { MemoryKeyStore } from './key-store.js';
import { SignalProtocol } from './signal-protocol.js';

export interface SignalProtocolSetup {
  protocol: SignalProtocol;
  keyStore: MemoryKeyStore;
  crypto: NodeCryptoProvider;
}

/**
 * Create a Signal Protocol instance with default Node.js crypto.
 * This is the recommended way to initialize the encryption layer.
 */
export async function createSignalProtocol(): Promise<SignalProtocolSetup> {
  const crypto = new NodeCryptoProvider();
  const keyStore = new MemoryKeyStore(crypto);

  // Initialize with default pre-key count
  await keyStore.initialize(100);

  const protocol = new SignalProtocol(crypto, keyStore, keyStore);

  return { protocol, keyStore, crypto };
}

/**
 * Create Signal Protocol with custom crypto provider.
 * For advanced use cases or hardware security modules.
 */
export async function createSignalProtocolWithProvider(
  crypto: import('./types.js').CryptoProvider
): Promise<SignalProtocolSetup> {
  const keyStore = new MemoryKeyStore(crypto);
  await keyStore.initialize(100);
  const protocol = new SignalProtocol(crypto, keyStore, keyStore);
  return { protocol, keyStore, crypto };
}
