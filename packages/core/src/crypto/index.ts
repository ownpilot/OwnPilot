/**
 * Crypto module for OwnPilot
 * Zero dependencies - uses only Node.js built-in crypto
 * @packageDocumentation
 */

// Key derivation
export {
  deriveKey,
  deriveKeyBytes,
  generateSalt,
  generateIV,
  generateMasterKey,
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  secureCompare,
  secureClear,
  type KeyDerivationOptions,
} from './derive.js';

// OS Keychain integration
export {
  storeSecret,
  retrieveSecret,
  deleteSecret,
  hasSecret,
  isKeychainAvailable,
  getPlatform,
  type KeychainConfig,
  type Platform,
} from './keychain.js';

// Secure Vault
export { SecureVault, createVault, type VaultConfig } from './vault.js';

// Credential Store (password-based, for VPS deployments)
export {
  CredentialStore,
  createCredentialStore,
  getCredentialStore,
  type CredentialStoreConfig,
  type StoredCredentials,
} from './credentials.js';
