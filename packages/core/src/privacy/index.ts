/**
 * Privacy module - PII detection and redaction
 *
 * @module privacy
 */

// Types
export type {
  PIICategory,
  PIISeverity,
  PIIMatch,
  DetectionResult,
  RedactionMode,
  RedactionOptions,
  RedactionResult,
  PIIPattern,
  DetectorConfig,
} from './types.js';

// Patterns
export {
  BUILT_IN_PATTERNS,
  getPatternsForCategories,
  getAllCategories,
} from './patterns.js';

// Detector
export {
  PIIDetector,
  createDetector,
  detectPII,
  hasPII,
} from './detector.js';

// Redactor
export {
  PIIRedactor,
  createRedactor,
  redactPII,
  maskPII,
  labelPII,
  removePII,
} from './redactor.js';
