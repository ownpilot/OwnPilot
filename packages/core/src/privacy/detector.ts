/**
 * PII Detector
 * Scans text for personally identifiable information
 */

import type {
  PIIPattern,
  PIIMatch,
  DetectionResult,
  DetectorConfig,
  PIISeverity,
  PIICategory,
} from './types.js';
import { BUILT_IN_PATTERNS } from './patterns.js';

/**
 * Severity order for comparison
 */
const SEVERITY_ORDER: Record<PIISeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Compare severities
 */
function compareSeverity(a: PIISeverity, b: PIISeverity): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
}

/**
 * Get the higher severity
 */
function maxSeverity(a: PIISeverity | null, b: PIISeverity): PIISeverity {
  if (a === null) return b;
  return compareSeverity(a, b) >= 0 ? a : b;
}

/**
 * PII Detector class
 */
export class PIIDetector {
  private readonly patterns: readonly PIIPattern[];
  private readonly minConfidence: number;
  private readonly enabledCategories: Set<PIICategory> | null;

  constructor(config: DetectorConfig = {}) {
    const {
      customPatterns = [],
      categories,
      minConfidence = 0.5,
      useBuiltInPatterns = true,
    } = config;

    // Combine built-in and custom patterns
    this.patterns = [...(useBuiltInPatterns ? BUILT_IN_PATTERNS : []), ...customPatterns];

    this.minConfidence = minConfidence;
    this.enabledCategories = categories ? new Set(categories) : null;
  }

  /**
   * Detect PII in text
   */
  detect(text: string): DetectionResult {
    const matches: PIIMatch[] = [];
    const seenRanges = new Set<string>();

    for (const pattern of this.patterns) {
      // Skip if category not enabled
      if (this.enabledCategories && !this.enabledCategories.has(pattern.category)) {
        continue;
      }

      // Reset regex lastIndex for global patterns (reuse existing RegExp, avoid re-compilation)
      pattern.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.pattern.exec(text)) !== null) {
        const matchText = match[0];
        const start = match.index;
        const end = start + matchText.length;
        const rangeKey = `${start}-${end}`;

        // Skip if we've already matched this range with a higher confidence pattern
        if (seenRanges.has(rangeKey)) {
          continue;
        }

        // Run validator if present
        let confidence = pattern.confidence;
        if (pattern.validate) {
          if (!pattern.validate(matchText)) {
            // Reduce confidence if validation fails
            confidence *= 0.3;
          }
        }

        // Skip if below confidence threshold
        if (confidence < this.minConfidence) {
          continue;
        }

        seenRanges.add(rangeKey);

        matches.push({
          category: pattern.category,
          match: matchText,
          start,
          end,
          confidence,
          severity: pattern.severity,
          pattern: pattern.name,
        });
      }
    }

    // Sort matches by position
    matches.sort((a, b) => a.start - b.start);

    // Calculate aggregate statistics
    const categories = [...new Set(matches.map((m) => m.category))];
    let highest: PIISeverity | null = null;
    for (const m of matches) {
      highest = maxSeverity(highest, m.severity);
    }

    return {
      text,
      matches,
      hasPII: matches.length > 0,
      maxSeverity: highest,
      categories,
    };
  }

  /**
   * Check if text contains any PII
   */
  hasPII(text: string): boolean {
    return this.detect(text).hasPII;
  }

  /**
   * Get matches for specific categories only
   */
  detectCategories(text: string, categories: readonly PIICategory[]): DetectionResult {
    const result = this.detect(text);
    const categorySet = new Set(categories);

    const filteredMatches = result.matches.filter((m) => categorySet.has(m.category));

    let highest: PIISeverity | null = null;
    for (const m of filteredMatches) {
      highest = maxSeverity(highest, m.severity);
    }

    return {
      text: result.text,
      matches: filteredMatches,
      hasPII: filteredMatches.length > 0,
      maxSeverity: highest,
      categories: [...new Set(filteredMatches.map((m) => m.category))],
    };
  }

  /**
   * Get matches above a certain severity
   */
  detectBySeverity(text: string, minSeverity: PIISeverity): DetectionResult {
    const result = this.detect(text);
    const minOrder = SEVERITY_ORDER[minSeverity];

    const filteredMatches = result.matches.filter((m) => SEVERITY_ORDER[m.severity] >= minOrder);

    let highest: PIISeverity | null = null;
    for (const m of filteredMatches) {
      highest = maxSeverity(highest, m.severity);
    }

    return {
      text: result.text,
      matches: filteredMatches,
      hasPII: filteredMatches.length > 0,
      maxSeverity: highest,
      categories: [...new Set(filteredMatches.map((m) => m.category))],
    };
  }
}

/**
 * Create a PII detector with default configuration
 */
export function createDetector(config?: DetectorConfig): PIIDetector {
  return new PIIDetector(config);
}

/**
 * Quick detection with default settings
 */
export function detectPII(text: string): DetectionResult {
  return createDetector().detect(text);
}

/**
 * Quick check if text has PII
 */
export function hasPII(text: string): boolean {
  return createDetector().hasPII(text);
}
