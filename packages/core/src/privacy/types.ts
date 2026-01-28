/**
 * Privacy module types
 * Define PII categories and detection results
 */

/**
 * Categories of personally identifiable information
 */
export type PIICategory =
  | 'email'
  | 'phone'
  | 'ssn' // US Social Security Number
  | 'credit_card'
  | 'ip_address'
  | 'date_of_birth'
  | 'name'
  | 'address'
  | 'passport'
  | 'driver_license'
  | 'bank_account'
  | 'api_key'
  | 'password'
  | 'jwt'
  | 'url'
  | 'custom';

/**
 * Severity levels for PII
 */
export type PIISeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * A single PII detection
 */
export interface PIIMatch {
  /** Category of PII detected */
  readonly category: PIICategory;
  /** The matched text */
  readonly match: string;
  /** Start index in original text */
  readonly start: number;
  /** End index in original text */
  readonly end: number;
  /** Confidence level (0-1) */
  readonly confidence: number;
  /** Severity level */
  readonly severity: PIISeverity;
  /** Pattern name that matched */
  readonly pattern: string;
}

/**
 * Result of PII detection
 */
export interface DetectionResult {
  /** Original text analyzed */
  readonly text: string;
  /** All PII matches found */
  readonly matches: readonly PIIMatch[];
  /** Whether any PII was found */
  readonly hasPII: boolean;
  /** Highest severity found */
  readonly maxSeverity: PIISeverity | null;
  /** Categories of PII found */
  readonly categories: readonly PIICategory[];
}

/**
 * Redaction mode
 */
export type RedactionMode =
  | 'mask' // Replace with asterisks
  | 'category' // Replace with [CATEGORY]
  | 'hash' // Replace with hash
  | 'remove'; // Remove entirely

/**
 * Options for redaction
 */
export interface RedactionOptions {
  /** Redaction mode (default: 'mask') */
  mode?: RedactionMode;
  /** Mask character (default: '*') */
  maskChar?: string;
  /** Categories to redact (default: all) */
  categories?: PIICategory[];
  /** Minimum severity to redact (default: 'low') */
  minSeverity?: PIISeverity;
  /** Keep first N characters when masking (default: 0) */
  keepFirst?: number;
  /** Keep last N characters when masking (default: 0) */
  keepLast?: number;
}

/**
 * Result of redaction
 */
export interface RedactionResult {
  /** Original text */
  readonly original: string;
  /** Redacted text */
  readonly redacted: string;
  /** Number of redactions made */
  readonly count: number;
  /** Matches that were redacted */
  readonly redacted_matches: readonly PIIMatch[];
}

/**
 * Pattern definition for PII detection
 */
export interface PIIPattern {
  /** Unique pattern name */
  readonly name: string;
  /** Category of PII this detects */
  readonly category: PIICategory;
  /** Regular expression pattern */
  readonly pattern: RegExp;
  /** Base confidence for this pattern */
  readonly confidence: number;
  /** Severity of this PII type */
  readonly severity: PIISeverity;
  /** Optional validator function */
  readonly validate?: (match: string) => boolean;
}

/**
 * Configuration for the detector
 */
export interface DetectorConfig {
  /** Additional custom patterns */
  customPatterns?: PIIPattern[];
  /** Categories to detect (default: all) */
  categories?: PIICategory[];
  /** Minimum confidence threshold (default: 0.5) */
  minConfidence?: number;
  /** Enable built-in patterns (default: true) */
  useBuiltInPatterns?: boolean;
}
