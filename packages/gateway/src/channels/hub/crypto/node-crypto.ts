/**
 * Node.js Crypto Provider
 *
 * Signal Protocol cryptographic primitives using Node.js built-in crypto.
 * Uses X25519 for ECDH, Ed25519 for signatures, AES-256-GCM for encryption.
 */

import { randomBytes, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import type {
  CryptoProvider,
  KeyPair,
  IdentityKeyPair,
  PreKey,
  SignedPreKey,
} from './types.js';

// X25519 key generation and ECDH
async function generateX25519KeyPair(): Promise<KeyPair> {
  // Generate X25519 key pair
  const privateKey = new Uint8Array(randomBytes(32));
  // Clamp private key for X25519
  privateKey[0] = privateKey[0]! & 248;
  privateKey[31] = privateKey[31]! & 127;
  privateKey[31] = privateKey[31]! | 64;

  // Derive public key from private key using the crypto module
  const publicKey = await x25519ScalarMultBase(privateKey);

  return { publicKey, privateKey };
}

// X25519 scalar multiplication with base point (constant)
async function x25519ScalarMultBase(privateKey: Uint8Array): Promise<Uint8Array> {
  const basePoint = Buffer.from([
    9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ]);
  return x25519ScalarMult(privateKey, basePoint);
}

// X25519 scalar multiplication (ECDH)
async function x25519ScalarMult(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
  const cryptoModule = await import('node:crypto');
  const ecdh = cryptoModule.createECDH('X25519');
  ecdh.setPrivateKey(Buffer.from(privateKey));
  return ecdh.computeSecret(Buffer.from(publicKey));
}

// Ed25519 key generation and signing
async function generateEd25519KeyPair(): Promise<KeyPair> {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { format: 'der', type: 'pkcs8' },
    publicKeyEncoding: { format: 'der', type: 'spki' },
  });

  // Extract raw keys from DER encoding
  // Ed25519 private key in PKCS#8 is 48 bytes (last 32 are the key)
  // Ed25519 public key in SPKI is 44 bytes (last 32 are the key)
  return {
    privateKey: new Uint8Array(privateKey.slice(-32)),
    publicKey: new Uint8Array(publicKey.slice(-32)),
  };
}

// Ed25519 sign
async function ed25519Sign(privateKey: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const { createSign } = await import('node:crypto');

  // Construct PKCS#8 private key with our raw key
  const pkcs8Prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
    0x04, 0x22, 0x04, 0x20
  ]);
  const fullPrivateKey = Buffer.concat([pkcs8Prefix, Buffer.from(privateKey)]);

  const sign = createSign('sha512');
  sign.update(message);
  return sign.sign(fullPrivateKey);
}

// Ed25519 verify
async function ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const { createVerify } = await import('node:crypto');

  // Construct SPKI public key
  const spkiPrefix = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
  ]);
  const fullPublicKey = Buffer.concat([spkiPrefix, Buffer.from(publicKey)]);

  const verify = createVerify('sha512');
  verify.update(message);
  return verify.verify(fullPublicKey, signature);
}

// HKDF key derivation
async function hkdf(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  // HKDF-Extract
  const prk = createHmac('sha256', salt).update(inputKeyMaterial).digest();

  // HKDF-Expand
  const okm = Buffer.alloc(length);
  let previousBlock = Buffer.alloc(0);
  const n = Math.ceil(length / 32);

  for (let i = 1; i <= n; i++) {
    const t = createHmac('sha256', prk)
      .update(Buffer.concat([previousBlock, info, Buffer.from([i])]))
      .digest();
    t.copy(okm, (i - 1) * 32);
    previousBlock = t;
  }

  return okm.slice(0, length);
}

// AES-256-GCM encryption
async function aesGcmEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array
): Promise<Uint8Array> {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([ciphertext, authTag]);
}

// AES-256-GCM decryption
async function aesGcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const authTag = ciphertext.slice(-16);
  const encrypted = ciphertext.slice(0, -16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export class NodeCryptoProvider implements CryptoProvider {
  async generateKeyPair(): Promise<KeyPair> {
    return generateX25519KeyPair();
  }

  async generateIdentityKeyPair(): Promise<IdentityKeyPair> {
    // Use Ed25519 for identity keys (can be converted to X25519 if needed)
    const keyPair = await generateEd25519KeyPair();
    return {
      ...keyPair,
      keyId: `id_${Date.now()}_${randomBytes(4).toString('hex')}`,
      createdAt: new Date(),
    };
  }

  async generatePreKey(keyId: number): Promise<PreKey> {
    const keyPair = await generateX25519KeyPair();
    return {
      keyId,
      keyPair,
      used: false,
    };
  }

  async generateSignedPreKey(
    identityKey: IdentityKeyPair,
    keyId: number
  ): Promise<SignedPreKey> {
    const keyPair = await generateX25519KeyPair();
    // Sign the public key with identity key
    const signature = await this.sign(identityKey, keyPair.publicKey);

    return {
      keyId,
      keyPair,
      signature,
      createdAt: new Date(),
    };
  }

  async sign(identityKey: IdentityKeyPair, message: Uint8Array): Promise<Uint8Array> {
    return ed25519Sign(identityKey.privateKey, message);
  }

  async verify(
    identityPublicKey: Uint8Array,
    message: Uint8Array,
    signature: Uint8Array
  ): Promise<boolean> {
    return ed25519Verify(identityPublicKey, message, signature);
  }

  async deriveSharedSecret(
    privateKey: Uint8Array,
    publicKey: Uint8Array
  ): Promise<Uint8Array> {
    return x25519ScalarMult(privateKey, publicKey);
  }

  async hkdf(
    inputKeyMaterial: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number
  ): Promise<Uint8Array> {
    return hkdf(inputKeyMaterial, salt, info, length);
  }

  async encrypt(
    aesKey: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array
  ): Promise<Uint8Array> {
    return aesGcmEncrypt(aesKey, iv, plaintext);
  }

  async decrypt(
    aesKey: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array
  ): Promise<Uint8Array> {
    return aesGcmDecrypt(aesKey, iv, ciphertext);
  }

  generateRandomBytes(length: number): Uint8Array {
    return randomBytes(length);
  }
}

// Export singleton instance
export const nodeCrypto = new NodeCryptoProvider();
