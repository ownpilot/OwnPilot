/**
 * Signal Protocol Implementation
 *
 * Double Ratchet Algorithm for E2E encryption.
 * Based on Signal Protocol Specification:
 * - X3DH (Extended Triple Diffie-Hellman) for initial key agreement
 * - Double Ratchet for continuous key rotation
 * - AES-256-GCM for message encryption
 */

import { getLog } from '../../../services/log.js';
import type {
  CryptoProvider,
  EncryptedMessage,
  EncryptionResult,
  DecryptionResult,
  SessionState,
  RatchetState,
  ChainKey,
  MessageKey,
} from './types.js';
import type { IKeyStore, SessionStore } from './types.js';

const log = getLog('Signal:Protocol');

// Constants for KDF
const KDF_INFO_ROOT = Buffer.from('Signal_Root');
const KDF_INFO_CHAIN = Buffer.from('Signal_Chain');
const KDF_INFO_MESSAGE = Buffer.from('Signal_Message');

export class SignalProtocol {
  private crypto: CryptoProvider;
  private keyStore: IKeyStore;
  private sessionStore: SessionStore;

  constructor(
    crypto: CryptoProvider,
    keyStore: IKeyStore,
    sessionStore: SessionStore
  ) {
    this.crypto = crypto;
    this.keyStore = keyStore;
    this.sessionStore = sessionStore;
  }

  // ========================================================================
  // X3DH Key Agreement (Initial Session Setup)
  // ========================================================================

  /**
   * Initiate a session with a peer (Alice's side of X3DH).
   * Called when we want to send our first message to someone.
   */
  async initiateSession(
    peerPublicKeyBundle: {
      identityKey: Uint8Array;
      signedPreKey: {
        keyId: number;
        publicKey: Uint8Array;
        signature: Uint8Array;
      };
      oneTimePreKey?: {
        keyId: number;
        publicKey: Uint8Array;
      };
      registrationId: number;
    },
    peerDeviceId: string
  ): Promise<SessionState> {
    const identityKey = await this.keyStore.getIdentityKeyPair();

    // Verify signed pre-key signature
    const isValid = await this.crypto.verify(
      peerPublicKeyBundle.identityKey,
      peerPublicKeyBundle.signedPreKey.publicKey,
      peerPublicKeyBundle.signedPreKey.signature
    );

    if (!isValid) {
      throw new Error('Invalid signed pre-key signature');
    }

    // Generate ephemeral key pair (EK)
    const ephemeralKey = await this.crypto.generateKeyPair();

    // X3DH calculations
    const dh1 = await this.crypto.deriveSharedSecret(
      identityKey.privateKey,
      peerPublicKeyBundle.signedPreKey.publicKey
    );
    const dh2 = await this.crypto.deriveSharedSecret(
      ephemeralKey.privateKey,
      peerPublicKeyBundle.identityKey
    );
    const dh3 = await this.crypto.deriveSharedSecret(
      ephemeralKey.privateKey,
      peerPublicKeyBundle.signedPreKey.publicKey
    );

    let dh4: Uint8Array | undefined;
    if (peerPublicKeyBundle.oneTimePreKey) {
      dh4 = await this.crypto.deriveSharedSecret(
        ephemeralKey.privateKey,
        peerPublicKeyBundle.oneTimePreKey.publicKey
      );
    }

    // Combine DH results
    const sharedSecretInputs = dh4
      ? Buffer.concat([dh1, dh2, dh3, dh4])
      : Buffer.concat([dh1, dh2, dh3]);

    // Derive root key using HKDF
    const rootKey = await this.crypto.hkdf(
      sharedSecretInputs,
      new Uint8Array(32), // Zero salt
      KDF_INFO_ROOT,
      32
    );

    // Create session
    const peerFingerprint = this.getKeyFingerprint(peerPublicKeyBundle.identityKey);
    const randomBytes = this.crypto.generateRandomBytes(4);
    const sessionId = `sess_${Date.now()}_${Buffer.from(randomBytes).toString('hex')}`;

    const session: SessionState = {
      sessionId,
      peerIdentityKey: peerFingerprint,
      peerDeviceId,
      registrationId: peerPublicKeyBundle.registrationId,
      ratchetState: {
        rootKey: { key: rootKey },
        sendingChain: undefined, // Will be created on first encrypt
        receivingChain: undefined,
        sendMessageNumber: 0,
        receiveMessageNumber: 0,
        previousChainLength: 0,
        senderRatchetKeyPair: ephemeralKey,
        receiverRatchetPublicKey: undefined,
      },
      establishedAt: new Date(),
      lastUsedAt: new Date(),
    };

    await this.sessionStore.saveSession(session);
    log.info('Initiated new session', { sessionId, peer: peerDeviceId });

    return session;
  }

  /**
   * Accept a session initiation (Bob's side of X3DH).
   * Called when we receive the first message from someone.
   */
  async acceptSession(
    senderPublicKey: Uint8Array,
    senderEphemeralKey: Uint8Array,
    usedPreKeyId: number | undefined,
    usedSignedPreKeyId: number,
    senderDeviceId: string,
    senderRegistrationId: number
  ): Promise<SessionState> {
    const identityKey = await this.keyStore.getIdentityKeyPair();
    const signedPreKey = await this.keyStore.getSignedPreKey(usedSignedPreKeyId);

    if (!signedPreKey) {
      throw new Error('Unknown signed pre-key');
    }

    // Get pre-key if used
    let preKeyPrivate: Uint8Array | undefined;
    if (usedPreKeyId !== undefined) {
      const preKey = await this.keyStore.getPreKey(usedPreKeyId);
      if (preKey) {
        preKeyPrivate = preKey.keyPair.privateKey;
        // Pre-key is automatically marked as used when retrieved
      }
    }

    // X3DH calculations (reverse of initiateSession)
    const dh1 = await this.crypto.deriveSharedSecret(
      signedPreKey.keyPair.privateKey,
      senderPublicKey
    );
    const dh2 = await this.crypto.deriveSharedSecret(
      identityKey.privateKey,
      senderEphemeralKey
    );
    const dh3 = await this.crypto.deriveSharedSecret(
      signedPreKey.keyPair.privateKey,
      senderEphemeralKey
    );

    let dh4: Uint8Array | undefined;
    if (preKeyPrivate) {
      dh4 = await this.crypto.deriveSharedSecret(
        preKeyPrivate,
        senderEphemeralKey
      );
    }

    const sharedSecretInputs = dh4
      ? Buffer.concat([dh1, dh2, dh3, dh4])
      : Buffer.concat([dh1, dh2, dh3]);

    const rootKey = await this.crypto.hkdf(
      sharedSecretInputs,
      new Uint8Array(32),
      KDF_INFO_ROOT,
      32
    );

    // Generate our ratchet key pair
    const ourRatchetKey = await this.crypto.generateKeyPair();

    const peerFingerprint = this.getKeyFingerprint(senderPublicKey);
    const randomBytes = this.crypto.generateRandomBytes(4);
    const sessionId = `sess_${Date.now()}_${Buffer.from(randomBytes).toString('hex')}`;

    const session: SessionState = {
      sessionId,
      peerIdentityKey: peerFingerprint,
      peerDeviceId: senderDeviceId,
      registrationId: senderRegistrationId,
      ratchetState: {
        rootKey: { key: rootKey },
        sendingChain: undefined,
        receivingChain: undefined,
        sendMessageNumber: 0,
        receiveMessageNumber: 0,
        previousChainLength: 0,
        senderRatchetKeyPair: ourRatchetKey,
        receiverRatchetPublicKey: senderEphemeralKey,
      },
      establishedAt: new Date(),
      lastUsedAt: new Date(),
    };

    await this.sessionStore.saveSession(session);
    log.info('Accepted new session', { sessionId, peer: senderDeviceId });

    return session;
  }

  // ========================================================================
  // Double Ratchet Encryption
  // ========================================================================

  /**
   * Encrypt a message using Double Ratchet.
   */
  async encrypt(
    sessionId: string,
    plaintext: string
  ): Promise<EncryptionResult> {
    const sessions = await this.sessionStore.getAllSessions();
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const ratchet = session.ratchetState;

    // Perform DH ratchet step if needed (we received a new ratchet key)
    if (ratchet.receiverRatchetPublicKey && !ratchet.sendingChain) {
      await this.performDHRatchetStep(ratchet, ratchet.receiverRatchetPublicKey);
    }

    // Generate sending chain if needed
    if (!ratchet.sendingChain) {
      // First message - derive from root key
      ratchet.sendingChain = await this.deriveChainKey(ratchet.rootKey.key, 0);
    }

    // Advance chain key to get message key
    const messageKey = await this.deriveMessageKey(ratchet.sendingChain);
    ratchet.sendingChain.index++;

    // Encrypt message
    const plaintextBytes = Buffer.from(plaintext, 'utf8');
    const ciphertext = await this.crypto.encrypt(
      messageKey.cipherKey,
      messageKey.iv,
      plaintextBytes
    );

    // Get identity key for header
    const identityKey = await this.keyStore.getIdentityKeyPair();

    const encryptedMessage: EncryptedMessage = {
      header: {
        senderIdentityKey: Buffer.from(identityKey.publicKey).toString('base64'),
        senderDeviceId: session.peerDeviceId, // Should be our device ID actually
        senderSignedPreKeyId: (await this.keyStore.getActiveSignedPreKey()).keyId,
        senderEphemeralKey: ratchet.senderRatchetKeyPair
          ? Buffer.from(ratchet.senderRatchetKeyPair.publicKey).toString('base64')
          : '',
        previousChainLength: ratchet.previousChainLength,
        messageNumber: ratchet.sendMessageNumber++,
        timestamp: Date.now(),
      },
      ciphertext: Buffer.from(ciphertext.slice(0, -16)).toString('base64'),
      authTag: Buffer.from(ciphertext.slice(-16)).toString('base64'),
    };

    // Update session
    session.lastUsedAt = new Date();
    await this.sessionStore.saveSession(session);

    return { encrypted: encryptedMessage, sessionId };
  }

  /**
   * Decrypt a message using Double Ratchet.
   */
  async decrypt(
    encryptedMessage: EncryptedMessage,
    senderDeviceId: string
  ): Promise<DecryptionResult> {
    const { header, ciphertext, authTag } = encryptedMessage;

    // Find session by sender identity
    const senderIdentityKey = Buffer.from(header.senderIdentityKey, 'base64');
    const senderFingerprint = this.getKeyFingerprint(senderIdentityKey);

    let session = await this.sessionStore.getSession(senderFingerprint);

    // New session if not found and this looks like initial message
    if (!session) {
      const senderEphemeralKey = Buffer.from(header.senderEphemeralKey, 'base64');
      session = await this.acceptSession(
        senderIdentityKey,
        senderEphemeralKey,
        header.senderPreKeyId,
        header.senderSignedPreKeyId,
        senderDeviceId,
        0 // Registration ID unknown for initial message
      );
    }

    const ratchet = session.ratchetState;
    const senderEphemeralKey = Buffer.from(header.senderEphemeralKey, 'base64');

    // Check if sender has new ratchet key (DH step needed)
    if (!ratchet.receiverRatchetPublicKey ||
        !this.equalUint8Arrays(ratchet.receiverRatchetPublicKey, senderEphemeralKey)) {
      await this.performDHRatchetStep(ratchet, senderEphemeralKey);
    }

    // Skip message keys if needed (message out of order)
    while (ratchet.receiveMessageNumber < header.messageNumber) {
      if (!ratchet.receivingChain) {
        ratchet.receivingChain = await this.deriveChainKey(ratchet.rootKey.key, 0);
      }
      ratchet.receivingChain.index++;
      ratchet.receiveMessageNumber++;
    }

    // Generate receiving chain if needed
    if (!ratchet.receivingChain) {
      ratchet.receivingChain = await this.deriveChainKey(ratchet.rootKey.key, 0);
    }

    // Get message key
    const messageKey = await this.deriveMessageKey(ratchet.receivingChain);
    ratchet.receivingChain.index++;
    ratchet.receiveMessageNumber++;

    // Decrypt
    const ciphertextBytes = Buffer.from(ciphertext, 'base64');
    const authTagBytes = Buffer.from(authTag, 'base64');
    const fullCiphertext = Buffer.concat([ciphertextBytes, authTagBytes]);

    try {
      const plaintextBytes = await this.crypto.decrypt(
        messageKey.cipherKey,
        messageKey.iv,
        fullCiphertext
      );

      // Update session
      session.lastUsedAt = new Date();
      await this.sessionStore.saveSession(session);

      return {
        plaintext: Buffer.from(plaintextBytes).toString('utf8'),
        sessionId: session.sessionId,
        senderIdentity: senderFingerprint,
      };
    } catch (error) {
      log.error('Decryption failed', { sessionId: session.sessionId, error });
      throw new Error('Message authentication failed - possible tampering');
    }
  }

  // ========================================================================
  // Ratchet Operations
  // ========================================================================

  /**
   * Perform DH ratchet step when we see a new ephemeral key from peer.
   */
  private async performDHRatchetStep(
    ratchet: RatchetState,
    newReceiverPublicKey: Uint8Array
  ): Promise<void> {
    // Generate new sending key pair
    const newSendingKeyPair = await this.crypto.generateKeyPair();

    // Derive new root key from DH with received public key
    if (ratchet.senderRatchetKeyPair) {
      const dh = await this.crypto.deriveSharedSecret(
        ratchet.senderRatchetKeyPair.privateKey,
        newReceiverPublicKey
      );

      const newRootKey = await this.crypto.hkdf(
        Buffer.concat([ratchet.rootKey.key, dh]),
        new Uint8Array(32),
        KDF_INFO_ROOT,
        32
      );

      ratchet.rootKey.key = newRootKey;
    }

    // Update chain lengths
    ratchet.previousChainLength = ratchet.sendMessageNumber;
    ratchet.sendMessageNumber = 0;
    ratchet.receiveMessageNumber = 0;

    // Generate new receiving chain
    ratchet.receivingChain = await this.deriveChainKey(ratchet.rootKey.key, 0);

    // Update keys
    ratchet.senderRatchetKeyPair = newSendingKeyPair;
    ratchet.receiverRatchetPublicKey = newReceiverPublicKey;

    log.debug('Performed DH ratchet step');
  }

  /**
   * Derive chain key from root key.
   */
  private async deriveChainKey(
    rootKey: Uint8Array,
    index: number
  ): Promise<ChainKey> {
    const chainKeyBytes = await this.crypto.hkdf(
      rootKey,
      new Uint8Array(32),
      KDF_INFO_CHAIN,
      32
    );

    return {
      key: chainKeyBytes,
      index,
    };
  }

  /**
   * Derive message key from chain key.
   */
  private async deriveMessageKey(chainKey: ChainKey): Promise<MessageKey> {
    const messageKeyBytes = await this.crypto.hkdf(
      chainKey.key,
      new Uint8Array(32),
      KDF_INFO_MESSAGE,
      80 // 32 cipher + 32 mac + 16 iv
    );

    return {
      cipherKey: messageKeyBytes.slice(0, 32),
      macKey: messageKeyBytes.slice(32, 64),
      iv: messageKeyBytes.slice(64, 80),
      index: chainKey.index,
    };
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private getKeyFingerprint(publicKey: Uint8Array): string {
    return Buffer.from(publicKey.slice(0, 16)).toString('base64');
  }

  // These types are imported for potential future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private declare _typeCompatibility: {
    _RootKey: import('./types.js').RootKey;
    _KeyPair: import('./types.js').KeyPair;
  };

  private equalUint8Arrays(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // ========================================================================
  // Session Management
  // ========================================================================

  async getSession(peerIdentityKey: string): Promise<SessionState | null> {
    return this.sessionStore.getSession(peerIdentityKey);
  }

  async getAllSessions(): Promise<SessionState[]> {
    return this.sessionStore.getAllSessions();
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sessionStore.deleteSession(sessionId);
  }

  /**
   * Check if we have an established session with a peer.
   */
  async hasSession(peerIdentityKey: string): Promise<boolean> {
    const session = await this.sessionStore.getSession(peerIdentityKey);
    return session !== null;
  }
}
