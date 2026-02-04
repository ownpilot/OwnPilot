/**
 * PII Redactor
 * Masks or removes personally identifiable information from text
 */

import { createHash } from 'node:crypto';
import type {
  PIIMatch,
  RedactionOptions,
  RedactionResult,
  PIISeverity,
  PIICategory,
} from './types.js';
import { PIIDetector, createDetector } from './detector.js';

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
 * Default redaction options
 */
const DEFAULT_OPTIONS: Required<RedactionOptions> = {
  mode: 'mask',
  maskChar: '*',
  categories: [],
  minSeverity: 'low',
  keepFirst: 0,
  keepLast: 0,
};

/**
 * PII Redactor class
 */
export class PIIRedactor {
  private readonly detector: PIIDetector;
  private readonly options: Required<RedactionOptions>;

  constructor(
    detector?: PIIDetector,
    options: RedactionOptions = {}
  ) {
    this.detector = detector ?? createDetector();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Redact PII from text
   */
  redact(text: string, options?: RedactionOptions): RedactionResult {
    const opts = { ...this.options, ...options };
    const detection = this.detector.detect(text);

    if (!detection.hasPII) {
      return {
        original: text,
        redacted: text,
        count: 0,
        redacted_matches: [],
      };
    }

    // Filter matches by category and severity
    const categorySet =
      opts.categories.length > 0 ? new Set(opts.categories) : null;
    const minSeverityOrder = SEVERITY_ORDER[opts.minSeverity];

    const matchesToRedact = detection.matches.filter((match) => {
      // Check category filter
      if (categorySet && !categorySet.has(match.category)) {
        return false;
      }
      // Check severity filter
      if (SEVERITY_ORDER[match.severity] < minSeverityOrder) {
        return false;
      }
      return true;
    });

    if (matchesToRedact.length === 0) {
      return {
        original: text,
        redacted: text,
        count: 0,
        redacted_matches: [],
      };
    }

    // Sort matches by position (reverse order for safe replacement)
    const sortedMatches = [...matchesToRedact].sort(
      (a, b) => b.start - a.start
    );

    let redactedText = text;
    for (const match of sortedMatches) {
      const replacement = this.getRedaction(match, opts);
      redactedText =
        redactedText.slice(0, match.start) +
        replacement +
        redactedText.slice(match.end);
    }

    return {
      original: text,
      redacted: redactedText,
      count: matchesToRedact.length,
      redacted_matches: matchesToRedact,
    };
  }

  /**
   * Get the redaction string for a match
   */
  private getRedaction(
    match: PIIMatch,
    opts: Required<RedactionOptions>
  ): string {
    const { mode, maskChar, keepFirst, keepLast } = opts;
    const { match: text, category } = match;

    switch (mode) {
      case 'mask':
        return this.maskText(text, maskChar, keepFirst, keepLast);

      case 'category':
        return `[${category.toUpperCase()}]`;

      case 'hash':
        return this.hashText(text);

      case 'remove':
        return '';

      default:
        return this.maskText(text, maskChar, keepFirst, keepLast);
    }
  }

  /**
   * Mask text with asterisks (or other char)
   */
  private maskText(
    text: string,
    maskChar: string,
    keepFirst: number,
    keepLast: number
  ): string {
    const len = text.length;

    // Handle edge cases
    if (len <= keepFirst + keepLast) {
      return maskChar.repeat(len);
    }

    const first = text.slice(0, keepFirst);
    const last = keepLast > 0 ? text.slice(-keepLast) : '';
    const masked = maskChar.repeat(len - keepFirst - keepLast);

    return first + masked + last;
  }

  /**
   * Hash text for deterministic redaction
   */
  private hashText(text: string): string {
    const hash = createHash('sha256')
      .update(text)
      .digest('hex')
      .slice(0, 8);
    return `[REDACTED:${hash}]`;
  }

  /**
   * Redact specific categories only
   */
  redactCategories(
    text: string,
    categories: readonly PIICategory[],
    options?: Omit<RedactionOptions, 'categories'>
  ): RedactionResult {
    return this.redact(text, {
      ...options,
      categories: [...categories],
    });
  }

  /**
   * Redact by minimum severity
   */
  redactBySeverity(
    text: string,
    minSeverity: PIISeverity,
    options?: Omit<RedactionOptions, 'minSeverity'>
  ): RedactionResult {
    return this.redact(text, {
      ...options,
      minSeverity,
    });
  }
}

/**
 * Create a redactor with default configuration
 */
export function createRedactor(
  detector?: PIIDetector,
  options?: RedactionOptions
): PIIRedactor {
  return new PIIRedactor(detector, options);
}

/**
 * Quick redaction with default settings
 */
export function redactPII(
  text: string,
  options?: RedactionOptions
): RedactionResult {
  return createRedactor().redact(text, options);
}

/**
 * Mask all PII with asterisks
 */
export function maskPII(text: string): string {
  return redactPII(text, { mode: 'mask' }).redacted;
}

/**
 * Replace PII with category labels
 */
export function labelPII(text: string): string {
  return redactPII(text, { mode: 'category' }).redacted;
}

/**
 * Remove all PII
 */
export function removePII(text: string): string {
  return redactPII(text, { mode: 'remove' }).redacted;
}
