/**
 * Plugin Marketplace System Tests
 *
 * Comprehensive tests for:
 * - calculateSecurityRisk: risk scoring and threshold classification
 * - generatePublisherKeys: RSA 4096-bit key pair generation
 * - signManifest / verifySignature: real crypto signing and verification
 * - calculateContentHash: deterministic SHA256 file hashing
 * - PluginVerifier: revocation, key registration, full verification pipeline
 * - validateManifest: manifest schema validation with all field rules
 * - MarketplaceRegistry: registration, search, filtering, sorting, pagination
 * - Factory functions: createMarketplaceRegistry, createPluginVerifier,
 *   createMinimalSecurityDeclaration, createSecurityDeclaration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateSecurityRisk,
  generatePublisherKeys,
  signManifest,
  verifySignature,
  calculateContentHash,
  PluginVerifier,
  validateManifest,
  MarketplaceRegistry,
  createMarketplaceRegistry,
  createPluginVerifier,
  createMinimalSecurityDeclaration,
  createSecurityDeclaration,
} from './marketplace.js';
import type {
  MarketplaceManifest,
  SecurityDeclaration,
  RevocationEntry,
} from './marketplace.js';

// =============================================================================
// Helpers
// =============================================================================

function makeMinimalManifest(
  overrides: Partial<MarketplaceManifest> = {},
): MarketplaceManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    publisher: {
      id: 'pub-1',
      name: 'Test',
      email: 'test@example.com',
      verified: false,
    },
    category: 'utilities' as const,
    tags: ['test'],
    security: createMinimalSecurityDeclaration(),
    capabilities: ['storage:read' as const],
    main: 'index.js',
    files: ['index.js'],
    compatibility: { minGatewayVersion: '1.0.0' },
    ...overrides,
  };
}

function makeMinimalDeclarationInput() {
  return {
    dataAccess: {
      collectsPersonalData: false,
      sharesDataWithThirdParties: false,
    },
    networkAccess: {
      makesExternalRequests: false,
      domains: [] as string[],
      sendsUserData: false,
      receivesRemoteCode: false,
    },
    storageAccess: {
      usesLocalStorage: false,
      estimatedStorageBytes: 0,
      encryptsStoredData: true,
    },
    execution: {
      executesCode: false,
      usesSandbox: true,
      spawnsProcesses: false,
    },
    privacy: {
      logsUserActivity: false,
      hasAnalytics: false,
    },
  };
}

// =============================================================================
// calculateSecurityRisk
// =============================================================================

describe('calculateSecurityRisk', () => {
  it('should return low risk for a minimal declaration', () => {
    const decl = makeMinimalDeclarationInput();
    const result = calculateSecurityRisk(decl);
    expect(result.riskLevel).toBe('low');
    expect(result.riskFactors).toHaveLength(0);
  });

  it('should add +2 for collectsPersonalData', () => {
    const decl = makeMinimalDeclarationInput();
    decl.dataAccess.collectsPersonalData = true;
    decl.dataAccess.gdprCompliant = true;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Collects personal data');
    // score=2 => low
    expect(result.riskLevel).toBe('low');
  });

  it('should add +3 for sharesDataWithThirdParties', () => {
    const decl = makeMinimalDeclarationInput();
    decl.dataAccess.sharesDataWithThirdParties = true;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Shares data with third parties');
    // score=3 => medium
    expect(result.riskLevel).toBe('medium');
  });

  it('should add +2 for not GDPR compliant when collecting personal data', () => {
    const decl = makeMinimalDeclarationInput();
    decl.dataAccess.collectsPersonalData = true;
    decl.dataAccess.gdprCompliant = false;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Not GDPR compliant');
    // collectsPersonalData(+2) + notGdpr(+2) = 4 => medium
    expect(result.riskLevel).toBe('medium');
  });

  it('should not penalize GDPR non-compliance when not collecting personal data', () => {
    const decl = makeMinimalDeclarationInput();
    decl.dataAccess.collectsPersonalData = false;
    decl.dataAccess.gdprCompliant = false;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).not.toContain('Not GDPR compliant');
  });

  it('should add +1 for makesExternalRequests', () => {
    const decl = makeMinimalDeclarationInput();
    decl.networkAccess.makesExternalRequests = true;
    decl.networkAccess.domains = ['api.example.com'];
    const result = calculateSecurityRisk(decl);
    // score=1 => low
    expect(result.riskLevel).toBe('low');
    expect(result.riskFactors).toHaveLength(0); // no named factor for just makesExternalRequests
  });

  it('should add +3 extra for wildcard domains', () => {
    const decl = makeMinimalDeclarationInput();
    decl.networkAccess.makesExternalRequests = true;
    decl.networkAccess.domains = ['*'];
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Unrestricted network access');
    // makesExternalRequests(+1) + wildcard(+3) = 4 => medium
    expect(result.riskLevel).toBe('medium');
  });

  it('should add +2 for sendsUserData', () => {
    const decl = makeMinimalDeclarationInput();
    decl.networkAccess.sendsUserData = true;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Sends user data externally');
    expect(result.riskLevel).toBe('low'); // score=2
  });

  it('should add +4 for receivesRemoteCode', () => {
    const decl = makeMinimalDeclarationInput();
    decl.networkAccess.receivesRemoteCode = true;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Receives and executes remote code');
    // score=4 => medium
    expect(result.riskLevel).toBe('medium');
  });

  it('should add +2 for executesCode', () => {
    const decl = makeMinimalDeclarationInput();
    decl.execution.executesCode = true;
    decl.execution.usesSandbox = true;
    const result = calculateSecurityRisk(decl);
    // score=2 => low
    expect(result.riskLevel).toBe('low');
  });

  it('should add +3 extra for executesCode without sandbox', () => {
    const decl = makeMinimalDeclarationInput();
    decl.execution.executesCode = true;
    decl.execution.usesSandbox = false;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Executes code without sandbox');
    // executesCode(+2) + noSandbox(+3) = 5 => medium
    expect(result.riskLevel).toBe('medium');
  });

  it('should add +4 for spawnsProcesses', () => {
    const decl = makeMinimalDeclarationInput();
    decl.execution.spawnsProcesses = true;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Can spawn system processes');
    // score=4 => medium
    expect(result.riskLevel).toBe('medium');
  });

  it('should add +1 for unencrypted local storage', () => {
    const decl = makeMinimalDeclarationInput();
    decl.storageAccess.usesLocalStorage = true;
    decl.storageAccess.encryptsStoredData = false;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Stores data without encryption');
    expect(result.riskLevel).toBe('low'); // score=1
  });

  it('should not penalize encrypted local storage', () => {
    const decl = makeMinimalDeclarationInput();
    decl.storageAccess.usesLocalStorage = true;
    decl.storageAccess.encryptsStoredData = true;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).not.toContain('Stores data without encryption');
  });

  it('should add +1 for logsUserActivity', () => {
    const decl = makeMinimalDeclarationInput();
    decl.privacy.logsUserActivity = true;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Logs user activity');
    expect(result.riskLevel).toBe('low'); // score=1
  });

  it('should add +1 for analytics without privacy policy', () => {
    const decl = makeMinimalDeclarationInput();
    decl.privacy.hasAnalytics = true;
    // no privacyPolicyUrl
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).toContain('Has analytics without privacy policy');
    expect(result.riskLevel).toBe('low'); // score=1
  });

  it('should not penalize analytics with a privacy policy', () => {
    const decl = makeMinimalDeclarationInput();
    decl.privacy.hasAnalytics = true;
    decl.privacy.privacyPolicyUrl = 'https://example.com/privacy';
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors).not.toContain('Has analytics without privacy policy');
  });

  it('should classify score 6-9 as high', () => {
    const decl = makeMinimalDeclarationInput();
    // receivesRemoteCode(+4) + sendsUserData(+2) = 6
    decl.networkAccess.receivesRemoteCode = true;
    decl.networkAccess.sendsUserData = true;
    const result = calculateSecurityRisk(decl);
    expect(result.riskLevel).toBe('high');
  });

  it('should classify score >= 10 as critical', () => {
    const decl = makeMinimalDeclarationInput();
    // spawnsProcesses(+4) + receivesRemoteCode(+4) + sendsUserData(+2) = 10
    decl.execution.spawnsProcesses = true;
    decl.networkAccess.receivesRemoteCode = true;
    decl.networkAccess.sendsUserData = true;
    const result = calculateSecurityRisk(decl);
    expect(result.riskLevel).toBe('critical');
  });

  it('should accumulate multiple risk factors', () => {
    const decl = makeMinimalDeclarationInput();
    decl.dataAccess.collectsPersonalData = true;
    decl.dataAccess.sharesDataWithThirdParties = true;
    decl.networkAccess.sendsUserData = true;
    decl.privacy.logsUserActivity = true;
    const result = calculateSecurityRisk(decl);
    expect(result.riskFactors.length).toBeGreaterThanOrEqual(4);
    // collectsPersonalData(+2) + notGdprCompliant(+2) + sharesData(+3) + sendsUserData(+2) + logsActivity(+1) = 10
    expect(result.riskLevel).toBe('critical');
  });
});

// =============================================================================
// generatePublisherKeys
// =============================================================================

describe('generatePublisherKeys', () => {
  it('should return publicKey, privateKey, and keyId', () => {
    const keys = generatePublisherKeys();
    expect(keys).toHaveProperty('publicKey');
    expect(keys).toHaveProperty('privateKey');
    expect(keys).toHaveProperty('keyId');
  });

  it('should produce PEM-encoded RSA public key', () => {
    const keys = generatePublisherKeys();
    expect(keys.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    expect(keys.publicKey).toContain('-----END PUBLIC KEY-----');
  });

  it('should produce PEM-encoded RSA private key', () => {
    const keys = generatePublisherKeys();
    expect(keys.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
    expect(keys.privateKey).toContain('-----END PRIVATE KEY-----');
  });

  it('should produce a 16-character hex keyId', () => {
    const keys = generatePublisherKeys();
    expect(keys.keyId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should generate unique key pairs on successive calls', () => {
    const keys1 = generatePublisherKeys();
    const keys2 = generatePublisherKeys();
    expect(keys1.publicKey).not.toBe(keys2.publicKey);
    expect(keys1.privateKey).not.toBe(keys2.privateKey);
    expect(keys1.keyId).not.toBe(keys2.keyId);
  });
});

// =============================================================================
// signManifest & verifySignature
// =============================================================================

describe('signManifest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return a valid PluginSignature object', () => {
    const keys = generatePublisherKeys();
    const manifest = makeMinimalManifest();
    const contentHash = 'abc123';
    const sig = signManifest(manifest, keys.privateKey, keys.keyId, contentHash);

    expect(sig.algorithm).toBe('RSA-SHA256');
    expect(sig.signature).toBeTruthy();
    expect(sig.timestamp).toBeTruthy();
    expect(sig.publisherKeyId).toBe(keys.keyId);
    expect(sig.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sig.contentHash).toBe(contentHash);
  });

  it('should produce a base64-encoded signature string', () => {
    const keys = generatePublisherKeys();
    const manifest = makeMinimalManifest();
    const sig = signManifest(manifest, keys.privateKey, keys.keyId, 'hash');
    // Verify it decodes from base64 without error
    const buf = Buffer.from(sig.signature, 'base64');
    expect(buf.length).toBeGreaterThan(0);
  });

  it('should produce different signatures for different content hashes', () => {
    const keys = generatePublisherKeys();
    const manifest = makeMinimalManifest();
    const sig1 = signManifest(manifest, keys.privateKey, keys.keyId, 'hash-a');
    const sig2 = signManifest(manifest, keys.privateKey, keys.keyId, 'hash-b');
    expect(sig1.signature).not.toBe(sig2.signature);
  });
});

describe('verifySignature', () => {
  beforeEach(() => {
    // Freeze time so Date.now() and new Date() return consistent values
    // within signManifest (which uses both), enabling verifySignature to
    // reconstruct the exact payload that was signed.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should verify a correctly signed manifest', () => {
    const keys = generatePublisherKeys();
    const manifest = makeMinimalManifest();
    const contentHash = 'test-content-hash';
    const sig = signManifest(manifest, keys.privateKey, keys.keyId, contentHash);
    const signedManifest: MarketplaceManifest = { ...manifest, signature: sig };

    const result = verifySignature(signedManifest, keys.publicKey);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(true);
    }
  });

  it('should return error when manifest has no signature', () => {
    const keys = generatePublisherKeys();
    const manifest = makeMinimalManifest();
    const result = verifySignature(manifest, keys.publicKey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('No signature found');
    }
  });

  it('should detect manifest tampering (hash mismatch)', () => {
    const keys = generatePublisherKeys();
    const manifest = makeMinimalManifest();
    const sig = signManifest(manifest, keys.privateKey, keys.keyId, 'hash');
    // Tamper with the manifest after signing
    const tampered: MarketplaceManifest = {
      ...manifest,
      name: 'Tampered Plugin',
      signature: sig,
    };

    const result = verifySignature(tampered, keys.publicKey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Manifest hash mismatch');
    }
  });

  it('should fail verification with wrong public key', () => {
    const keys1 = generatePublisherKeys();
    const keys2 = generatePublisherKeys();
    const manifest = makeMinimalManifest();
    const sig = signManifest(manifest, keys1.privateKey, keys1.keyId, 'hash');
    const signedManifest: MarketplaceManifest = { ...manifest, signature: sig };

    const result = verifySignature(signedManifest, keys2.publicKey);
    // Signature should be invalid (either ok:true with value:false, or ok:false with error)
    if (result.ok) {
      expect(result.value).toBe(false);
    }
  });

  it('should ignore marketplace metadata during verification', () => {
    const keys = generatePublisherKeys();
    const manifest = makeMinimalManifest();
    const sig = signManifest(manifest, keys.privateKey, keys.keyId, 'hash');
    const signedManifest: MarketplaceManifest = {
      ...manifest,
      signature: sig,
      marketplace: {
        trustLevel: 'verified',
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        downloads: 9999,
        rating: 5.0,
        reviewCount: 100,
        verified: true,
        featured: true,
      },
    };

    const result = verifySignature(signedManifest, keys.publicKey);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(true);
    }
  });
});

// =============================================================================
// calculateContentHash
// =============================================================================

describe('calculateContentHash', () => {
  it('should return a 64-character hex SHA256 hash', () => {
    const files = new Map<string, Buffer>();
    files.set('index.js', Buffer.from('console.log("hello")'));
    const hash = calculateContentHash(files);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should produce deterministic output for the same files', () => {
    const files = new Map<string, Buffer>();
    files.set('a.js', Buffer.from('aaa'));
    files.set('b.js', Buffer.from('bbb'));
    const hash1 = calculateContentHash(files);
    const hash2 = calculateContentHash(files);
    expect(hash1).toBe(hash2);
  });

  it('should produce the same hash regardless of insertion order', () => {
    const files1 = new Map<string, Buffer>();
    files1.set('b.js', Buffer.from('bbb'));
    files1.set('a.js', Buffer.from('aaa'));

    const files2 = new Map<string, Buffer>();
    files2.set('a.js', Buffer.from('aaa'));
    files2.set('b.js', Buffer.from('bbb'));

    expect(calculateContentHash(files1)).toBe(calculateContentHash(files2));
  });

  it('should produce different hashes for different file contents', () => {
    const files1 = new Map<string, Buffer>();
    files1.set('index.js', Buffer.from('version1'));

    const files2 = new Map<string, Buffer>();
    files2.set('index.js', Buffer.from('version2'));

    expect(calculateContentHash(files1)).not.toBe(calculateContentHash(files2));
  });

  it('should produce different hashes for different file names', () => {
    const files1 = new Map<string, Buffer>();
    files1.set('a.js', Buffer.from('content'));

    const files2 = new Map<string, Buffer>();
    files2.set('b.js', Buffer.from('content'));

    expect(calculateContentHash(files1)).not.toBe(calculateContentHash(files2));
  });

  it('should handle an empty file map', () => {
    const files = new Map<string, Buffer>();
    const hash = calculateContentHash(files);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// =============================================================================
// PluginVerifier
// =============================================================================

describe('PluginVerifier', () => {
  let verifier: PluginVerifier;

  beforeEach(() => {
    verifier = new PluginVerifier();
  });

  describe('registerPublisherKey', () => {
    // Freeze time so signManifest/verifySignature timestamps are consistent
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('should register a publisher key', () => {
      const keys = generatePublisherKeys();
      verifier.registerPublisherKey(keys.keyId, keys.publicKey);
      // Verify indirectly by signing and verifying a manifest
      const manifest = makeMinimalManifest();
      const sig = signManifest(manifest, keys.privateKey, keys.keyId, 'hash');
      const signedManifest: MarketplaceManifest = { ...manifest, signature: sig };
      const result = verifier.verify(signedManifest);
      expect(result.signatureValid).toBe(true);
    });

    it('should mark a publisher as trusted when flag is set', () => {
      const keys = generatePublisherKeys();
      verifier.registerPublisherKey(keys.keyId, keys.publicKey, true);
      const manifest = makeMinimalManifest();
      const contentHash = 'test-hash';
      const sig = signManifest(manifest, keys.privateKey, keys.keyId, contentHash);
      const signedManifest: MarketplaceManifest = { ...manifest, signature: sig };
      const result = verifier.verify(signedManifest, contentHash);
      expect(result.publisherVerified).toBe(true);
    });
  });

  describe('addRevocation / isRevoked', () => {
    it('should revoke a plugin by ID (all versions)', () => {
      const entry: RevocationEntry = {
        pluginId: 'bad-plugin',
        revokedAt: new Date().toISOString(),
        reason: 'Malware detected',
        severity: 'critical',
        publisherNotified: true,
      };
      verifier.addRevocation(entry);
      expect(verifier.isRevoked('bad-plugin')).toEqual(entry);
    });

    it('should revoke a specific version', () => {
      const entry: RevocationEntry = {
        pluginId: 'plugin-x',
        version: '2.0.0',
        revokedAt: new Date().toISOString(),
        reason: 'Vulnerability in v2',
        severity: 'high',
        publisherNotified: false,
      };
      verifier.addRevocation(entry);
      expect(verifier.isRevoked('plugin-x', '2.0.0')).toEqual(entry);
      expect(verifier.isRevoked('plugin-x', '1.0.0')).toBeNull();
    });

    it('should check all-versions revocation as fallback', () => {
      const entry: RevocationEntry = {
        pluginId: 'plugin-y',
        revokedAt: new Date().toISOString(),
        reason: 'Publisher compromised',
        severity: 'critical',
        publisherNotified: true,
      };
      verifier.addRevocation(entry);
      // No version-specific entry, but all-versions entry exists
      expect(verifier.isRevoked('plugin-y', '3.0.0')).toEqual(entry);
    });

    it('should return null for non-revoked plugins', () => {
      expect(verifier.isRevoked('safe-plugin')).toBeNull();
      expect(verifier.isRevoked('safe-plugin', '1.0.0')).toBeNull();
    });
  });

  describe('getRevocationList', () => {
    it('should return all revocation entries', () => {
      verifier.addRevocation({
        pluginId: 'a',
        revokedAt: new Date().toISOString(),
        reason: 'r1',
        severity: 'low',
        publisherNotified: false,
      });
      verifier.addRevocation({
        pluginId: 'b',
        version: '1.0.0',
        revokedAt: new Date().toISOString(),
        reason: 'r2',
        severity: 'medium',
        publisherNotified: true,
      });
      const list = verifier.getRevocationList();
      expect(list).toHaveLength(2);
    });

    it('should return an empty array when no revocations exist', () => {
      expect(verifier.getRevocationList()).toEqual([]);
    });
  });

  describe('verify', () => {
    // Freeze time so signManifest/verifySignature timestamps are consistent
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('should return unverified for unsigned manifest', () => {
      const manifest = makeMinimalManifest();
      const result = verifier.verify(manifest);
      expect(result.valid).toBe(true);
      expect(result.trustLevel).toBe('unverified');
      expect(result.signatureValid).toBe(false);
      expect(result.warnings).toContain('Plugin is not signed');
    });

    it('should warn when publisher key is not found', () => {
      const keys = generatePublisherKeys();
      const manifest = makeMinimalManifest();
      const sig = signManifest(manifest, keys.privateKey, keys.keyId, 'hash');
      const signedManifest: MarketplaceManifest = { ...manifest, signature: sig };
      // Do NOT register the key
      const result = verifier.verify(signedManifest);
      expect(result.warnings).toContain('Publisher key not found in trusted keys');
      expect(result.signatureValid).toBe(false);
    });

    it('should return community trust level for valid signature without trusted publisher', () => {
      const keys = generatePublisherKeys();
      verifier.registerPublisherKey(keys.keyId, keys.publicKey, false);
      const manifest = makeMinimalManifest();
      const sig = signManifest(manifest, keys.privateKey, keys.keyId, 'hash');
      const signedManifest: MarketplaceManifest = { ...manifest, signature: sig };
      const result = verifier.verify(signedManifest);
      expect(result.signatureValid).toBe(true);
      expect(result.publisherVerified).toBe(false);
      expect(result.trustLevel).toBe('community');
    });

    it('should return verified trust level for trusted publisher with content hash', () => {
      const keys = generatePublisherKeys();
      verifier.registerPublisherKey(keys.keyId, keys.publicKey, true);
      const manifest = makeMinimalManifest();
      const contentHash = 'matching-hash';
      const sig = signManifest(manifest, keys.privateKey, keys.keyId, contentHash);
      const signedManifest: MarketplaceManifest = { ...manifest, signature: sig };
      const result = verifier.verify(signedManifest, contentHash);
      expect(result.signatureValid).toBe(true);
      expect(result.publisherVerified).toBe(true);
      expect(result.integrityValid).toBe(true);
      expect(result.trustLevel).toBe('verified');
    });

    it('should return official trust level for official publisher', () => {
      const keys = generatePublisherKeys();
      verifier.registerPublisherKey(keys.keyId, keys.publicKey, true);
      const manifest = makeMinimalManifest({
        publisher: {
          id: 'official-core',
          name: 'Official',
          email: 'official@example.com',
          verified: true,
        },
      });
      const contentHash = 'official-hash';
      const sig = signManifest(manifest, keys.privateKey, keys.keyId, contentHash);
      const signedManifest: MarketplaceManifest = { ...manifest, signature: sig };
      const result = verifier.verify(signedManifest, contentHash);
      expect(result.trustLevel).toBe('official');
    });

    it('should detect content hash mismatch', () => {
      const keys = generatePublisherKeys();
      verifier.registerPublisherKey(keys.keyId, keys.publicKey, true);
      const manifest = makeMinimalManifest();
      const sig = signManifest(manifest, keys.privateKey, keys.keyId, 'original-hash');
      const signedManifest: MarketplaceManifest = { ...manifest, signature: sig };
      const result = verifier.verify(signedManifest, 'different-hash');
      expect(result.valid).toBe(false);
      expect(result.integrityValid).toBe(false);
      expect(result.errors).toContain(
        'Content hash mismatch - files may have been tampered with',
      );
    });

    it('should immediately return revoked result for revoked plugin', () => {
      verifier.addRevocation({
        pluginId: 'test-plugin',
        revokedAt: new Date().toISOString(),
        reason: 'Security breach',
        severity: 'critical',
        publisherNotified: true,
      });
      const manifest = makeMinimalManifest();
      const result = verifier.verify(manifest);
      expect(result.valid).toBe(false);
      expect(result.revoked).toBe(true);
      expect(result.trustLevel).toBe('revoked');
      expect(result.revokedReason).toBe('Security breach');
    });

    it('should add warning for critical risk level', () => {
      const security = createSecurityDeclaration({
        execution: { executesCode: true, usesSandbox: false, spawnsProcesses: true },
        networkAccess: {
          makesExternalRequests: true,
          domains: ['*'],
          sendsUserData: true,
          receivesRemoteCode: true,
        },
      });
      const manifest = makeMinimalManifest({ security });
      const result = verifier.verify(manifest);
      expect(result.warnings).toContain('Plugin has critical security risk level');
    });

    it('should add warning for high risk level', () => {
      const security = createSecurityDeclaration({
        networkAccess: {
          makesExternalRequests: false,
          domains: [],
          sendsUserData: true,
          receivesRemoteCode: true,
        },
      });
      const manifest = makeMinimalManifest({ security });
      const result = verifier.verify(manifest);
      expect(result.warnings).toContain('Plugin has high security risk level');
    });

    it('should add warning when plugin spawns processes', () => {
      const security = createSecurityDeclaration({
        execution: { executesCode: false, usesSandbox: true, spawnsProcesses: true },
      });
      const manifest = makeMinimalManifest({ security });
      const result = verifier.verify(manifest);
      expect(result.warnings).toContain('Plugin can spawn system processes');
    });

    it('should add warning when plugin receives remote code', () => {
      const security = createSecurityDeclaration({
        networkAccess: {
          makesExternalRequests: false,
          domains: [],
          sendsUserData: false,
          receivesRemoteCode: true,
        },
      });
      const manifest = makeMinimalManifest({ security });
      const result = verifier.verify(manifest);
      expect(result.warnings).toContain('Plugin receives and executes remote code');
    });

    it('should add warning when plugin shares data with third parties', () => {
      const security = createSecurityDeclaration({
        dataAccess: {
          collectsPersonalData: false,
          sharesDataWithThirdParties: true,
        },
      });
      const manifest = makeMinimalManifest({ security });
      const result = verifier.verify(manifest);
      expect(result.warnings).toContain('Plugin shares data with third parties');
    });
  });
});

// =============================================================================
// validateManifest
// =============================================================================

describe('validateManifest', () => {
  it('should return no errors for a valid manifest', () => {
    const manifest = makeMinimalManifest();
    const errors = validateManifest(manifest);
    // There may be warnings but no errors
    const hardErrors = errors.filter((e) => e.severity === 'error');
    expect(hardErrors).toHaveLength(0);
  });

  it('should require all mandatory fields', () => {
    const errors = validateManifest({});
    const requiredFields = [
      'id', 'name', 'version', 'description', 'publisher',
      'category', 'security', 'capabilities', 'main', 'files', 'compatibility',
    ];
    for (const field of requiredFields) {
      expect(errors.some((e) => e.field === field && e.severity === 'error')).toBe(true);
    }
  });

  it('should reject invalid ID format (uppercase)', () => {
    const manifest = makeMinimalManifest({ id: 'Bad-Plugin' });
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'id' && e.message.includes('lowercase'))).toBe(true);
  });

  it('should reject invalid ID format (spaces)', () => {
    const manifest = makeMinimalManifest({ id: 'bad plugin' });
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'id')).toBe(true);
  });

  it('should accept valid ID format', () => {
    const manifest = makeMinimalManifest({ id: 'my-cool-plugin-123' });
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'id' && e.message.includes('lowercase'))).toBe(false);
  });

  it('should reject invalid semver version', () => {
    const manifest = makeMinimalManifest({ version: 'v1.0' });
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'version' && e.message.includes('semver'))).toBe(true);
  });

  it('should accept valid semver with prerelease tag', () => {
    const manifest = makeMinimalManifest({ version: '1.0.0-beta.1' });
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'version')).toBe(false);
  });

  it('should require publisher.id', () => {
    const manifest = makeMinimalManifest({
      publisher: { id: '', name: 'Test', email: 'test@example.com', verified: false },
    });
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'publisher.id')).toBe(true);
  });

  it('should require publisher.email', () => {
    const manifest = makeMinimalManifest({
      publisher: { id: 'pub-1', name: 'Test', email: '', verified: false },
    });
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'publisher.email')).toBe(true);
  });

  it('should require domains when makesExternalRequests is true', () => {
    const security = createSecurityDeclaration({
      networkAccess: {
        makesExternalRequests: true,
        domains: [],
        sendsUserData: false,
        receivesRemoteCode: false,
      },
    });
    const manifest = makeMinimalManifest({ security });
    const errors = validateManifest(manifest);
    expect(
      errors.some((e) => e.field === 'security.networkAccess.domains'),
    ).toBe(true);
  });

  it('should not require domains when makesExternalRequests is false', () => {
    const manifest = makeMinimalManifest();
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'security.networkAccess.domains')).toBe(false);
  });

  it('should warn about missing privacy policy when collecting personal data', () => {
    const security = createSecurityDeclaration({
      dataAccess: {
        collectsPersonalData: true,
        sharesDataWithThirdParties: false,
      },
    });
    const manifest = makeMinimalManifest({ security });
    const errors = validateManifest(manifest);
    const warning = errors.find((e) => e.field === 'security.privacy.privacyPolicyUrl');
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe('warning');
  });

  it('should reject invalid capabilities', () => {
    const manifest = makeMinimalManifest({
      capabilities: ['storage:read', 'invalid:cap' as never],
    });
    const errors = validateManifest(manifest);
    expect(
      errors.some((e) => e.field === 'capabilities' && e.message.includes('invalid:cap')),
    ).toBe(true);
  });

  it('should accept all valid capabilities', () => {
    const manifest = makeMinimalManifest({
      capabilities: ['storage:read', 'storage:write', 'network:fetch', 'events:subscribe'],
    });
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'capabilities')).toBe(false);
  });

  it('should require main entry point to be listed in files', () => {
    const manifest = makeMinimalManifest({
      main: 'app.js',
      files: ['index.js'],
    });
    const errors = validateManifest(manifest);
    expect(
      errors.some((e) => e.field === 'main' && e.message.includes('listed in files')),
    ).toBe(true);
  });

  it('should pass when main is included in files', () => {
    const manifest = makeMinimalManifest({
      main: 'index.js',
      files: ['index.js', 'utils.js'],
    });
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'main')).toBe(false);
  });
});

// =============================================================================
// MarketplaceRegistry
// =============================================================================

describe('MarketplaceRegistry', () => {
  let registry: MarketplaceRegistry;

  beforeEach(() => {
    registry = new MarketplaceRegistry();
  });

  describe('register', () => {
    it('should register a valid manifest', () => {
      const manifest = makeMinimalManifest();
      const result = registry.register(manifest);
      expect(result.ok).toBe(true);
    });

    it('should reject an invalid manifest', () => {
      const manifest = makeMinimalManifest({ id: 'INVALID ID' });
      const result = registry.register(manifest);
      expect(result.ok).toBe(false);
    });

    it('should add marketplace metadata on registration', () => {
      const manifest = makeMinimalManifest();
      registry.register(manifest);
      const stored = registry.get('test-plugin');
      expect(stored).toBeDefined();
      expect(stored!.marketplace).toBeDefined();
      expect(stored!.marketplace!.downloads).toBe(0);
      expect(stored!.marketplace!.rating).toBe(0);
      expect(stored!.marketplace!.featured).toBe(false);
    });

    it('should reject a revoked plugin', () => {
      const verifier = registry.getVerifier();
      verifier.addRevocation({
        pluginId: 'test-plugin',
        revokedAt: new Date().toISOString(),
        reason: 'Banned',
        severity: 'critical',
        publisherNotified: true,
      });
      const manifest = makeMinimalManifest();
      const result = registry.register(manifest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0].message).toContain('revoked');
      }
    });

    it('should preserve existing marketplace metadata if provided', () => {
      const manifest = makeMinimalManifest();
      (manifest as MarketplaceManifest).marketplace = {
        trustLevel: 'community',
        publishedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        downloads: 500,
        rating: 4.5,
        reviewCount: 10,
        verified: false,
        featured: false,
      };
      registry.register(manifest);
      const stored = registry.get('test-plugin');
      expect(stored!.marketplace!.downloads).toBe(500);
      expect(stored!.marketplace!.publishedAt).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent plugin', () => {
      expect(registry.get('no-such-plugin')).toBeUndefined();
    });

    it('should return the registered manifest', () => {
      const manifest = makeMinimalManifest();
      registry.register(manifest);
      const stored = registry.get('test-plugin');
      expect(stored).toBeDefined();
      expect(stored!.id).toBe('test-plugin');
    });
  });

  describe('search', () => {
    beforeEach(() => {
      // Register multiple plugins for search testing
      registry.register(
        makeMinimalManifest({
          id: 'alpha-tool',
          name: 'Alpha Tool',
          description: 'A productivity alpha tool',
          category: 'productivity',
          tags: ['alpha', 'tool'],
          pricing: { type: 'free' },
        }),
      );
      registry.register(
        makeMinimalManifest({
          id: 'beta-comm',
          name: 'Beta Communication',
          description: 'A communication plugin',
          category: 'communication',
          tags: ['beta', 'chat'],
          pricing: { type: 'paid', price: 9.99, currency: 'USD' },
        }),
      );
      registry.register(
        makeMinimalManifest({
          id: 'gamma-dev',
          name: 'Gamma Dev',
          description: 'A development helper',
          category: 'development',
          tags: ['gamma', 'tool'],
          pricing: { type: 'freemium' },
        }),
      );
      // Set downloads/ratings for sorting tests
      registry.recordDownload('alpha-tool');
      registry.recordDownload('alpha-tool');
      registry.recordDownload('alpha-tool');
      registry.recordDownload('beta-comm');
      registry.updateRating('alpha-tool', 4.8, 20);
      registry.updateRating('beta-comm', 4.2, 50);
      registry.updateRating('gamma-dev', 3.5, 5);
    });

    it('should return all plugins with no criteria', () => {
      const results = registry.search({});
      expect(results).toHaveLength(3);
    });

    it('should filter by query matching name', () => {
      const results = registry.search({ query: 'alpha' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('alpha-tool');
    });

    it('should filter by query matching description', () => {
      const results = registry.search({ query: 'communication' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('beta-comm');
    });

    it('should filter by query matching tags', () => {
      const results = registry.search({ query: 'tool' });
      expect(results).toHaveLength(2);
    });

    it('should be case-insensitive in query', () => {
      const results = registry.search({ query: 'ALPHA' });
      expect(results).toHaveLength(1);
    });

    it('should filter by category', () => {
      const results = registry.search({ category: 'development' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('gamma-dev');
    });

    it('should filter by tags', () => {
      const results = registry.search({ tags: ['chat'] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('beta-comm');
    });

    it('should filter by trust level', () => {
      const results = registry.search({ trustLevel: ['unverified'] });
      expect(results).toHaveLength(3);
    });

    it('should filter by max risk level', () => {
      const results = registry.search({ maxRiskLevel: 'low' });
      expect(results).toHaveLength(3); // all minimal = low risk
    });

    it('should filter by minimum rating', () => {
      const results = registry.search({ minRating: 4.0 });
      expect(results).toHaveLength(2); // alpha (4.8), beta (4.2)
    });

    it('should filter by pricing type', () => {
      const results = registry.search({ pricing: ['paid'] });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('beta-comm');
    });

    it('should sort by downloads descending by default', () => {
      const results = registry.search({});
      expect(results[0].id).toBe('alpha-tool'); // 3 downloads
    });

    it('should sort by rating', () => {
      const results = registry.search({ sortBy: 'rating', sortOrder: 'desc' });
      expect(results[0].id).toBe('alpha-tool'); // 4.8
      expect(results[results.length - 1].id).toBe('gamma-dev'); // 3.5
    });

    it('should sort by name ascending', () => {
      const results = registry.search({ sortBy: 'name', sortOrder: 'asc' });
      expect(results[0].id).toBe('alpha-tool');
      expect(results[1].id).toBe('beta-comm');
      expect(results[2].id).toBe('gamma-dev');
    });

    it('should sort by name descending', () => {
      const results = registry.search({ sortBy: 'name', sortOrder: 'desc' });
      expect(results[0].id).toBe('gamma-dev');
    });

    it('should apply pagination with limit', () => {
      const results = registry.search({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('should apply pagination with offset', () => {
      const results = registry.search({ limit: 2, offset: 2 });
      expect(results).toHaveLength(1);
    });

    it('should return empty array when offset exceeds total', () => {
      const results = registry.search({ offset: 100 });
      expect(results).toHaveLength(0);
    });
  });

  describe('getFeatured', () => {
    it('should return only featured plugins', () => {
      registry.register(makeMinimalManifest({ id: 'feat-plugin' }));
      // No plugins are featured by default
      expect(registry.getFeatured()).toHaveLength(0);
    });
  });

  describe('getPopular', () => {
    it('should return plugins sorted by downloads', () => {
      registry.register(makeMinimalManifest({ id: 'pop-a' }));
      registry.register(makeMinimalManifest({ id: 'pop-b' }));
      registry.recordDownload('pop-b');
      registry.recordDownload('pop-b');
      registry.recordDownload('pop-a');
      const popular = registry.getPopular(2);
      expect(popular).toHaveLength(2);
      expect(popular[0].id).toBe('pop-b'); // more downloads
    });
  });

  describe('getTopRated', () => {
    it('should return plugins with rating >= 4.0', () => {
      registry.register(makeMinimalManifest({ id: 'rated-a' }));
      registry.register(makeMinimalManifest({ id: 'rated-b' }));
      registry.updateRating('rated-a', 4.5, 10);
      registry.updateRating('rated-b', 3.0, 5);
      const topRated = registry.getTopRated(10);
      expect(topRated).toHaveLength(1);
      expect(topRated[0].id).toBe('rated-a');
    });
  });

  describe('getByCategory', () => {
    it('should return plugins in the given category', () => {
      registry.register(makeMinimalManifest({ id: 'cat-a', category: 'finance' }));
      registry.register(makeMinimalManifest({ id: 'cat-b', category: 'finance' }));
      registry.register(makeMinimalManifest({ id: 'cat-c', category: 'utilities' }));
      const finance = registry.getByCategory('finance');
      expect(finance).toHaveLength(2);
    });
  });

  describe('recordDownload', () => {
    it('should increment download count', () => {
      registry.register(makeMinimalManifest({ id: 'dl-plugin' }));
      registry.recordDownload('dl-plugin');
      registry.recordDownload('dl-plugin');
      const plugin = registry.get('dl-plugin');
      expect(plugin!.marketplace!.downloads).toBe(2);
    });

    it('should do nothing for non-existent plugin', () => {
      // Should not throw
      registry.recordDownload('no-such-plugin');
    });
  });

  describe('updateRating', () => {
    it('should update rating and review count', () => {
      registry.register(makeMinimalManifest({ id: 'rate-plugin' }));
      registry.updateRating('rate-plugin', 4.7, 25);
      const plugin = registry.get('rate-plugin');
      expect(plugin!.marketplace!.rating).toBe(4.7);
      expect(plugin!.marketplace!.reviewCount).toBe(25);
    });

    it('should do nothing for non-existent plugin', () => {
      // Should not throw
      registry.updateRating('no-such-plugin', 5.0, 1);
    });
  });
});

// =============================================================================
// Factory Functions
// =============================================================================

describe('Factory Functions', () => {
  describe('createMarketplaceRegistry', () => {
    it('should return a MarketplaceRegistry instance', () => {
      const registry = createMarketplaceRegistry();
      expect(registry).toBeInstanceOf(MarketplaceRegistry);
    });
  });

  describe('createPluginVerifier', () => {
    it('should return a PluginVerifier instance', () => {
      const verifier = createPluginVerifier();
      expect(verifier).toBeInstanceOf(PluginVerifier);
    });
  });

  describe('createMinimalSecurityDeclaration', () => {
    it('should return a low-risk declaration', () => {
      const decl = createMinimalSecurityDeclaration();
      expect(decl.riskLevel).toBe('low');
      expect(decl.riskFactors).toHaveLength(0);
    });

    it('should have all false data-access flags', () => {
      const decl = createMinimalSecurityDeclaration();
      expect(decl.dataAccess.collectsPersonalData).toBe(false);
      expect(decl.dataAccess.sharesDataWithThirdParties).toBe(false);
    });

    it('should have no network access', () => {
      const decl = createMinimalSecurityDeclaration();
      expect(decl.networkAccess.makesExternalRequests).toBe(false);
      expect(decl.networkAccess.domains).toEqual([]);
      expect(decl.networkAccess.sendsUserData).toBe(false);
      expect(decl.networkAccess.receivesRemoteCode).toBe(false);
    });

    it('should have encrypted local storage', () => {
      const decl = createMinimalSecurityDeclaration();
      expect(decl.storageAccess.usesLocalStorage).toBe(true);
      expect(decl.storageAccess.encryptsStoredData).toBe(true);
    });

    it('should have sandbox enabled and no code execution', () => {
      const decl = createMinimalSecurityDeclaration();
      expect(decl.execution.executesCode).toBe(false);
      expect(decl.execution.usesSandbox).toBe(true);
      expect(decl.execution.spawnsProcesses).toBe(false);
    });

    it('should have no privacy-affecting flags', () => {
      const decl = createMinimalSecurityDeclaration();
      expect(decl.privacy.logsUserActivity).toBe(false);
      expect(decl.privacy.hasAnalytics).toBe(false);
    });
  });

  describe('createSecurityDeclaration', () => {
    it('should merge partial overrides with minimal defaults', () => {
      const decl = createSecurityDeclaration({
        dataAccess: {
          collectsPersonalData: true,
          sharesDataWithThirdParties: false,
        },
      });
      expect(decl.dataAccess.collectsPersonalData).toBe(true);
      expect(decl.dataAccess.sharesDataWithThirdParties).toBe(false);
      // Other sections should keep defaults
      expect(decl.networkAccess.makesExternalRequests).toBe(false);
    });

    it('should auto-calculate risk level from merged declaration', () => {
      const decl = createSecurityDeclaration({
        execution: { executesCode: true, usesSandbox: false, spawnsProcesses: true },
      });
      // executesCode(+2) + noSandbox(+3) + spawnsProcesses(+4) = 9 => high
      expect(decl.riskLevel).toBe('high');
      expect(decl.riskFactors).toContain('Executes code without sandbox');
      expect(decl.riskFactors).toContain('Can spawn system processes');
    });

    it('should return low risk when no risky overrides are provided', () => {
      const decl = createSecurityDeclaration({});
      expect(decl.riskLevel).toBe('low');
    });
  });
});
