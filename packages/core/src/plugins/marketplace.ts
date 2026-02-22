/**
 * Plugin Marketplace System
 *
 * Provides:
 * - Plugin signing and verification
 * - Marketplace manifest schema
 * - Publisher verification
 * - Trust levels and ratings
 * - Security declarations
 * - Revocation checking
 */

import { createHash, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import type { PluginCapability } from './isolation.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import { getErrorMessage } from '../services/error-utils.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Plugin trust level - determined by verification status
 */
export type TrustLevel =
  | 'unverified' // No verification
  | 'community' // Community reviewed
  | 'verified' // Publisher verified
  | 'official' // Official/first-party plugin
  | 'revoked'; // Revoked due to security issue

/**
 * Security risk assessment
 */
export type SecurityRisk = 'low' | 'medium' | 'high' | 'critical';

/**
 * Plugin category for marketplace
 */
export type PluginCategory =
  | 'productivity'
  | 'communication'
  | 'finance'
  | 'development'
  | 'entertainment'
  | 'education'
  | 'utilities'
  | 'integration'
  | 'ai-tools'
  | 'security'
  | 'other';

/**
 * Marketplace plugin manifest - extended version for distribution
 */
export interface MarketplaceManifest {
  // Core identification
  id: string;
  name: string;
  version: string;
  description: string;
  longDescription?: string;

  // Publisher info
  publisher: PublisherInfo;

  // Marketplace metadata
  category: PluginCategory;
  tags: string[];
  icon?: string;
  screenshots?: string[];
  homepage?: string;
  repository?: string;
  documentation?: string;

  // Security declarations
  security: SecurityDeclaration;

  // Capabilities required
  capabilities: PluginCapability[];

  // Entry point
  main: string;
  files: string[];

  // Dependencies (other plugins)
  dependencies?: Record<string, string>;

  // Compatibility
  compatibility: {
    minGatewayVersion: string;
    maxGatewayVersion?: string;
    platforms?: ('windows' | 'macos' | 'linux')[];
  };

  // Pricing (for marketplace)
  pricing?: {
    type: 'free' | 'paid' | 'freemium' | 'subscription';
    price?: number;
    currency?: string;
    trialDays?: number;
  };

  // Signature (added by signing process)
  signature?: PluginSignature;

  // Marketplace-added fields
  marketplace?: {
    trustLevel: TrustLevel;
    publishedAt: string;
    updatedAt: string;
    downloads: number;
    rating: number;
    reviewCount: number;
    verified: boolean;
    featured: boolean;
  };
}

/**
 * Publisher information
 */
export interface PublisherInfo {
  id: string;
  name: string;
  email: string;
  website?: string;
  verified: boolean;
  verifiedAt?: string;
  publicKey?: string;
}

/**
 * Security declaration - what the plugin does/doesn't do
 */
export interface SecurityDeclaration {
  // Data access declarations
  dataAccess: {
    collectsPersonalData: boolean;
    personalDataTypes?: string[];
    sharesDataWithThirdParties: boolean;
    thirdParties?: string[];
    dataRetentionDays?: number;
    gdprCompliant?: boolean;
  };

  // Network declarations
  networkAccess: {
    makesExternalRequests: boolean;
    domains: string[];
    sendsUserData: boolean;
    receivesRemoteCode: boolean;
  };

  // Storage declarations
  storageAccess: {
    usesLocalStorage: boolean;
    estimatedStorageBytes: number;
    encryptsStoredData: boolean;
  };

  // Execution declarations
  execution: {
    executesCode: boolean;
    codeLanguages?: string[];
    usesSandbox: boolean;
    spawnsProcesses: boolean;
  };

  // Privacy declarations
  privacy: {
    logsUserActivity: boolean;
    hasAnalytics: boolean;
    analyticsProvider?: string;
    privacyPolicyUrl?: string;
  };

  // Risk assessment (auto-calculated)
  riskLevel: SecurityRisk;
  riskFactors: string[];
}

/**
 * Plugin signature for verification
 */
export interface PluginSignature {
  algorithm: 'RSA-SHA256' | 'Ed25519';
  signature: string;
  timestamp: string;
  publisherKeyId: string;
  manifestHash: string;
  contentHash: string;
}

/**
 * Verification result
 */
export interface VerificationResult {
  valid: boolean;
  trustLevel: TrustLevel;
  publisherVerified: boolean;
  signatureValid: boolean;
  integrityValid: boolean;
  revoked: boolean;
  revokedReason?: string;
  warnings: string[];
  errors: string[];
}

/**
 * Revocation entry
 */
export interface RevocationEntry {
  pluginId: string;
  version?: string; // If empty, all versions revoked
  revokedAt: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  publisherNotified: boolean;
}

// =============================================================================
// Security Risk Calculator
// =============================================================================

/**
 * Calculate security risk based on declarations
 */
export function calculateSecurityRisk(
  declaration: Omit<SecurityDeclaration, 'riskLevel' | 'riskFactors'>
): {
  riskLevel: SecurityRisk;
  riskFactors: string[];
} {
  const riskFactors: string[] = [];
  let riskScore = 0;

  // Data access risks
  if (declaration.dataAccess.collectsPersonalData) {
    riskScore += 2;
    riskFactors.push('Collects personal data');
  }
  if (declaration.dataAccess.sharesDataWithThirdParties) {
    riskScore += 3;
    riskFactors.push('Shares data with third parties');
  }
  if (!declaration.dataAccess.gdprCompliant && declaration.dataAccess.collectsPersonalData) {
    riskScore += 2;
    riskFactors.push('Not GDPR compliant');
  }

  // Network risks
  if (declaration.networkAccess.makesExternalRequests) {
    riskScore += 1;
    if (declaration.networkAccess.domains.includes('*')) {
      riskScore += 3;
      riskFactors.push('Unrestricted network access');
    }
  }
  if (declaration.networkAccess.sendsUserData) {
    riskScore += 2;
    riskFactors.push('Sends user data externally');
  }
  if (declaration.networkAccess.receivesRemoteCode) {
    riskScore += 4;
    riskFactors.push('Receives and executes remote code');
  }

  // Execution risks
  if (declaration.execution.executesCode) {
    riskScore += 2;
    if (!declaration.execution.usesSandbox) {
      riskScore += 3;
      riskFactors.push('Executes code without sandbox');
    }
  }
  if (declaration.execution.spawnsProcesses) {
    riskScore += 4;
    riskFactors.push('Can spawn system processes');
  }

  // Storage risks
  if (!declaration.storageAccess.encryptsStoredData && declaration.storageAccess.usesLocalStorage) {
    riskScore += 1;
    riskFactors.push('Stores data without encryption');
  }

  // Privacy risks
  if (declaration.privacy.logsUserActivity) {
    riskScore += 1;
    riskFactors.push('Logs user activity');
  }
  if (declaration.privacy.hasAnalytics && !declaration.privacy.privacyPolicyUrl) {
    riskScore += 1;
    riskFactors.push('Has analytics without privacy policy');
  }

  // Calculate risk level
  let riskLevel: SecurityRisk;
  if (riskScore >= 10) {
    riskLevel = 'critical';
  } else if (riskScore >= 6) {
    riskLevel = 'high';
  } else if (riskScore >= 3) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  return { riskLevel, riskFactors };
}

// =============================================================================
// Plugin Signing
// =============================================================================

/**
 * Generate publisher key pair
 */
export function generatePublisherKeys(): {
  publicKey: string;
  privateKey: string;
  keyId: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const keyId = createHash('sha256').update(publicKey).digest('hex').substring(0, 16);

  return { publicKey, privateKey, keyId };
}

/**
 * Sign a plugin manifest
 */
export function signManifest(
  manifest: Omit<MarketplaceManifest, 'signature'>,
  privateKey: string,
  keyId: string,
  contentHash: string
): PluginSignature {
  // Create deterministic manifest hash
  const manifestCopy = { ...manifest };
  const manifestStr = JSON.stringify(manifestCopy, Object.keys(manifestCopy).sort());
  const manifestHash = createHash('sha256').update(manifestStr).digest('hex');

  // Create signature payload
  const payload = `${manifestHash}:${contentHash}:${Date.now()}`;

  // Sign
  const sign = createSign('RSA-SHA256');
  sign.update(payload);
  const signature = sign.sign(privateKey, 'base64');

  return {
    algorithm: 'RSA-SHA256',
    signature,
    timestamp: new Date().toISOString(),
    publisherKeyId: keyId,
    manifestHash,
    contentHash,
  };
}

/**
 * Verify plugin signature
 */
export function verifySignature(
  manifest: MarketplaceManifest,
  publisherPublicKey: string
): Result<boolean, string> {
  if (!manifest.signature) {
    return err('No signature found');
  }

  try {
    // Recreate manifest hash
    const manifestCopy = { ...manifest };
    delete (manifestCopy as Partial<MarketplaceManifest>).signature;
    delete (manifestCopy as Partial<MarketplaceManifest>).marketplace;
    const manifestStr = JSON.stringify(manifestCopy, Object.keys(manifestCopy).sort());
    const manifestHash = createHash('sha256').update(manifestStr).digest('hex');

    // Verify manifest hash matches
    if (manifestHash !== manifest.signature.manifestHash) {
      return err('Manifest hash mismatch - manifest may have been tampered with');
    }

    // Recreate payload
    const timestamp = new Date(manifest.signature.timestamp).getTime();
    const payload = `${manifest.signature.manifestHash}:${manifest.signature.contentHash}:${timestamp}`;

    // Verify signature
    const verify = createVerify('RSA-SHA256');
    verify.update(payload);
    const isValid = verify.verify(publisherPublicKey, manifest.signature.signature, 'base64');

    return ok(isValid);
  } catch (e) {
    return err(`Signature verification failed: ${getErrorMessage(e)}`);
  }
}

/**
 * Calculate content hash of plugin files
 */
export function calculateContentHash(files: Map<string, Buffer>): string {
  const hash = createHash('sha256');

  // Sort files by name for deterministic hash
  const sortedFiles = [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [name, content] of sortedFiles) {
    hash.update(name);
    hash.update(content);
  }

  return hash.digest('hex');
}

// =============================================================================
// Plugin Verifier
// =============================================================================

/**
 * Plugin verification service
 */
export class PluginVerifier {
  private revocationList: Map<string, RevocationEntry> = new Map();
  private publisherKeys: Map<string, string> = new Map(); // keyId -> publicKey
  private trustedPublishers: Set<string> = new Set();

  /**
   * Add a publisher's public key
   */
  registerPublisherKey(keyId: string, publicKey: string, trusted: boolean = false): void {
    this.publisherKeys.set(keyId, publicKey);
    if (trusted) {
      this.trustedPublishers.add(keyId);
    }
  }

  /**
   * Add revocation entry
   */
  addRevocation(entry: RevocationEntry): void {
    const key = entry.version ? `${entry.pluginId}@${entry.version}` : entry.pluginId;
    this.revocationList.set(key, entry);
  }

  /**
   * Check if plugin is revoked
   */
  isRevoked(pluginId: string, version?: string): RevocationEntry | null {
    // Check specific version
    if (version) {
      const versionEntry = this.revocationList.get(`${pluginId}@${version}`);
      if (versionEntry) return versionEntry;
    }

    // Check all versions
    const allEntry = this.revocationList.get(pluginId);
    return allEntry ?? null;
  }

  /**
   * Verify a plugin completely
   */
  verify(manifest: MarketplaceManifest, contentHash?: string): VerificationResult {
    const result: VerificationResult = {
      valid: true,
      trustLevel: 'unverified',
      publisherVerified: false,
      signatureValid: false,
      integrityValid: false,
      revoked: false,
      warnings: [],
      errors: [],
    };

    // Check revocation
    const revocation = this.isRevoked(manifest.id, manifest.version);
    if (revocation) {
      result.valid = false;
      result.revoked = true;
      result.revokedReason = revocation.reason;
      result.trustLevel = 'revoked';
      result.errors.push(`Plugin revoked: ${revocation.reason}`);
      return result;
    }

    // Check signature
    if (!manifest.signature) {
      result.warnings.push('Plugin is not signed');
    } else {
      const publisherKey = this.publisherKeys.get(manifest.signature.publisherKeyId);

      if (!publisherKey) {
        result.warnings.push('Publisher key not found in trusted keys');
      } else {
        const sigResult = verifySignature(manifest, publisherKey);

        if (sigResult.ok && sigResult.value) {
          result.signatureValid = true;
          result.publisherVerified = this.trustedPublishers.has(manifest.signature.publisherKeyId);

          // Check content hash if provided
          if (contentHash) {
            if (contentHash === manifest.signature.contentHash) {
              result.integrityValid = true;
            } else {
              result.valid = false;
              result.errors.push('Content hash mismatch - files may have been tampered with');
            }
          }
        } else {
          result.valid = false;
          result.errors.push(sigResult.ok ? 'Invalid signature' : sigResult.error);
        }
      }
    }

    // Determine trust level
    if (result.publisherVerified && result.signatureValid && result.integrityValid) {
      // Check if official
      if (manifest.publisher.id.startsWith('official-')) {
        result.trustLevel = 'official';
      } else {
        result.trustLevel = 'verified';
      }
    } else if (result.signatureValid) {
      result.trustLevel = 'community';
    } else {
      result.trustLevel = 'unverified';
    }

    // Security warnings
    if (manifest.security.riskLevel === 'critical') {
      result.warnings.push('Plugin has critical security risk level');
    } else if (manifest.security.riskLevel === 'high') {
      result.warnings.push('Plugin has high security risk level');
    }

    if (manifest.security.execution.spawnsProcesses) {
      result.warnings.push('Plugin can spawn system processes');
    }

    if (manifest.security.networkAccess.receivesRemoteCode) {
      result.warnings.push('Plugin receives and executes remote code');
    }

    if (manifest.security.dataAccess.sharesDataWithThirdParties) {
      result.warnings.push('Plugin shares data with third parties');
    }

    return result;
  }

  /**
   * Get revocation list
   */
  getRevocationList(): RevocationEntry[] {
    return [...this.revocationList.values()];
  }
}

// =============================================================================
// Marketplace Manifest Validator
// =============================================================================

/**
 * Validation error
 */
export interface ManifestValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Validate marketplace manifest
 */
export function validateManifest(
  manifest: Partial<MarketplaceManifest>
): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  // Required fields
  const requiredFields: Array<keyof MarketplaceManifest> = [
    'id',
    'name',
    'version',
    'description',
    'publisher',
    'category',
    'security',
    'capabilities',
    'main',
    'files',
    'compatibility',
  ];

  for (const field of requiredFields) {
    if (!manifest[field]) {
      errors.push({
        field,
        message: `${field} is required`,
        severity: 'error',
      });
    }
  }

  // Validate ID format
  if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
    errors.push({
      field: 'id',
      message: 'ID must contain only lowercase letters, numbers, and hyphens',
      severity: 'error',
    });
  }

  // Validate version (semver)
  if (manifest.version && !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(manifest.version)) {
    errors.push({
      field: 'version',
      message: 'Version must be valid semver (e.g., 1.0.0)',
      severity: 'error',
    });
  }

  // Validate publisher
  if (manifest.publisher) {
    if (!manifest.publisher.id) {
      errors.push({
        field: 'publisher.id',
        message: 'Publisher ID is required',
        severity: 'error',
      });
    }
    if (!manifest.publisher.email) {
      errors.push({
        field: 'publisher.email',
        message: 'Publisher email is required',
        severity: 'error',
      });
    }
  }

  // Validate security declaration
  if (manifest.security) {
    if (manifest.security.networkAccess.makesExternalRequests) {
      if (
        !manifest.security.networkAccess.domains ||
        manifest.security.networkAccess.domains.length === 0
      ) {
        errors.push({
          field: 'security.networkAccess.domains',
          message: 'Domains must be declared if plugin makes external requests',
          severity: 'error',
        });
      }
    }

    if (
      manifest.security.dataAccess.collectsPersonalData &&
      !manifest.security.privacy.privacyPolicyUrl
    ) {
      errors.push({
        field: 'security.privacy.privacyPolicyUrl',
        message: 'Privacy policy URL required when collecting personal data',
        severity: 'warning',
      });
    }
  }

  // Validate capabilities
  if (manifest.capabilities) {
    const validCapabilities: PluginCapability[] = [
      'storage:read',
      'storage:write',
      'storage:quota:1mb',
      'storage:quota:10mb',
      'storage:quota:100mb',
      'network:fetch',
      'network:domains:*',
      'network:domains:specific',
      'execute:javascript',
      'execute:sandbox',
      'ui:notifications',
      'ui:dialogs',
      'ui:widgets',
      'tools:register',
      'tools:invoke',
      'events:subscribe',
      'events:emit',
      'plugins:communicate',
    ];

    for (const cap of manifest.capabilities) {
      if (!validCapabilities.includes(cap)) {
        errors.push({
          field: 'capabilities',
          message: `Invalid capability: ${cap}`,
          severity: 'error',
        });
      }
    }
  }

  // Validate file references
  if (manifest.main && manifest.files && !manifest.files.includes(manifest.main)) {
    errors.push({
      field: 'main',
      message: 'Main entry point must be listed in files',
      severity: 'error',
    });
  }

  return errors;
}

// =============================================================================
// Marketplace Registry
// =============================================================================

/**
 * Plugin search criteria
 */
export interface SearchCriteria {
  query?: string;
  category?: PluginCategory;
  tags?: string[];
  trustLevel?: TrustLevel[];
  maxRiskLevel?: SecurityRisk;
  minRating?: number;
  pricing?: ('free' | 'paid' | 'freemium' | 'subscription')[];
  sortBy?: 'downloads' | 'rating' | 'updated' | 'name';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Marketplace registry - plugin discovery
 */
export class MarketplaceRegistry {
  private plugins: Map<string, MarketplaceManifest> = new Map();
  private verifier: PluginVerifier;

  constructor() {
    this.verifier = new PluginVerifier();
  }

  /**
   * Register a plugin in the marketplace
   */
  register(manifest: MarketplaceManifest): Result<void, ManifestValidationError[]> {
    // Validate
    const errors = validateManifest(manifest).filter((e) => e.severity === 'error');
    if (errors.length > 0) {
      return err(errors);
    }

    // Verify
    const verification = this.verifier.verify(manifest);
    if (verification.revoked) {
      return err([
        {
          field: 'id',
          message: `Plugin is revoked: ${verification.revokedReason}`,
          severity: 'error',
        },
      ]);
    }

    // Add marketplace metadata
    const registeredManifest: MarketplaceManifest = {
      ...manifest,
      marketplace: {
        trustLevel: verification.trustLevel,
        publishedAt: manifest.marketplace?.publishedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        downloads: manifest.marketplace?.downloads ?? 0,
        rating: manifest.marketplace?.rating ?? 0,
        reviewCount: manifest.marketplace?.reviewCount ?? 0,
        verified: verification.publisherVerified,
        featured: false,
      },
    };

    this.plugins.set(manifest.id, registeredManifest);
    return ok(undefined);
  }

  /**
   * Get plugin by ID
   */
  get(pluginId: string): MarketplaceManifest | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Search plugins
   */
  search(criteria: SearchCriteria): MarketplaceManifest[] {
    let results = [...this.plugins.values()];

    // Filter by query
    if (criteria.query) {
      const query = criteria.query.toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.tags.some((t) => t.toLowerCase().includes(query))
      );
    }

    // Filter by category
    if (criteria.category) {
      results = results.filter((p) => p.category === criteria.category);
    }

    // Filter by tags
    if (criteria.tags && criteria.tags.length > 0) {
      results = results.filter((p) => criteria.tags!.some((t) => p.tags.includes(t)));
    }

    // Filter by trust level
    if (criteria.trustLevel && criteria.trustLevel.length > 0) {
      results = results.filter(
        (p) => p.marketplace && criteria.trustLevel!.includes(p.marketplace.trustLevel)
      );
    }

    // Filter by risk level
    if (criteria.maxRiskLevel) {
      const riskOrder: SecurityRisk[] = ['low', 'medium', 'high', 'critical'];
      const maxIndex = riskOrder.indexOf(criteria.maxRiskLevel);
      results = results.filter((p) => riskOrder.indexOf(p.security.riskLevel) <= maxIndex);
    }

    // Filter by rating
    if (criteria.minRating !== undefined) {
      results = results.filter((p) => (p.marketplace?.rating ?? 0) >= criteria.minRating!);
    }

    // Filter by pricing
    if (criteria.pricing && criteria.pricing.length > 0) {
      results = results.filter((p) => criteria.pricing!.includes(p.pricing?.type ?? 'free'));
    }

    // Sort
    const sortBy = criteria.sortBy ?? 'downloads';
    const sortOrder = criteria.sortOrder ?? 'desc';
    const multiplier = sortOrder === 'desc' ? -1 : 1;

    results.sort((a, b) => {
      switch (sortBy) {
        case 'downloads':
          return multiplier * ((a.marketplace?.downloads ?? 0) - (b.marketplace?.downloads ?? 0));
        case 'rating':
          return multiplier * ((a.marketplace?.rating ?? 0) - (b.marketplace?.rating ?? 0));
        case 'updated':
          return (
            multiplier *
            (a.marketplace?.updatedAt ?? '').localeCompare(b.marketplace?.updatedAt ?? '')
          );
        case 'name':
          return multiplier * a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    // Pagination
    const offset = criteria.offset ?? 0;
    const limit = criteria.limit ?? 20;
    return results.slice(offset, offset + limit);
  }

  /**
   * Get featured plugins
   */
  getFeatured(): MarketplaceManifest[] {
    return [...this.plugins.values()].filter((p) => p.marketplace?.featured);
  }

  /**
   * Get popular plugins
   */
  getPopular(limit: number = 10): MarketplaceManifest[] {
    return this.search({ sortBy: 'downloads', limit });
  }

  /**
   * Get top-rated plugins
   */
  getTopRated(limit: number = 10): MarketplaceManifest[] {
    return this.search({ sortBy: 'rating', minRating: 4.0, limit });
  }

  /**
   * Get plugins by category
   */
  getByCategory(category: PluginCategory, limit: number = 20): MarketplaceManifest[] {
    return this.search({ category, limit });
  }

  /**
   * Get verifier instance
   */
  getVerifier(): PluginVerifier {
    return this.verifier;
  }

  /**
   * Record download
   */
  recordDownload(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin?.marketplace) {
      plugin.marketplace.downloads++;
    }
  }

  /**
   * Update rating
   */
  updateRating(pluginId: string, newRating: number, reviewCount: number): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin?.marketplace) {
      plugin.marketplace.rating = newRating;
      plugin.marketplace.reviewCount = reviewCount;
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a marketplace registry
 */
export function createMarketplaceRegistry(): MarketplaceRegistry {
  return new MarketplaceRegistry();
}

/**
 * Create a plugin verifier
 */
export function createPluginVerifier(): PluginVerifier {
  return new PluginVerifier();
}

/**
 * Create a minimal security declaration (low risk)
 */
export function createMinimalSecurityDeclaration(): SecurityDeclaration {
  const base = {
    dataAccess: {
      collectsPersonalData: false,
      sharesDataWithThirdParties: false,
    },
    networkAccess: {
      makesExternalRequests: false,
      domains: [],
      sendsUserData: false,
      receivesRemoteCode: false,
    },
    storageAccess: {
      usesLocalStorage: true,
      estimatedStorageBytes: 1024 * 1024, // 1MB
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

  const { riskLevel, riskFactors } = calculateSecurityRisk(base);
  return { ...base, riskLevel, riskFactors };
}

/**
 * Create a full security declaration from partial data
 */
export function createSecurityDeclaration(
  partial: Partial<Omit<SecurityDeclaration, 'riskLevel' | 'riskFactors'>>
): SecurityDeclaration {
  const base = createMinimalSecurityDeclaration();
  const merged = {
    dataAccess: { ...base.dataAccess, ...partial.dataAccess },
    networkAccess: { ...base.networkAccess, ...partial.networkAccess },
    storageAccess: { ...base.storageAccess, ...partial.storageAccess },
    execution: { ...base.execution, ...partial.execution },
    privacy: { ...base.privacy, ...partial.privacy },
  };

  const { riskLevel, riskFactors } = calculateSecurityRisk(merged);
  return { ...merged, riskLevel, riskFactors };
}
