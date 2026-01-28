/**
 * Built-in PII detection patterns
 * Regex patterns for common PII types
 */

import type { PIIPattern } from './types.js';

/**
 * Luhn algorithm for credit card validation
 */
function isValidLuhn(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i] ?? '0', 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Validate US SSN format
 */
function isValidSSN(ssn: string): boolean {
  const clean = ssn.replace(/\D/g, '');
  if (clean.length !== 9) return false;

  // SSN cannot start with 9, 000, or have 00 in positions 4-5 or 0000 in positions 6-9
  const area = clean.substring(0, 3);
  const group = clean.substring(3, 5);
  const serial = clean.substring(5, 9);

  if (area === '000' || area === '666' || area.startsWith('9')) return false;
  if (group === '00') return false;
  if (serial === '0000') return false;

  return true;
}

/**
 * Check if email looks valid
 */
function isValidEmail(email: string): boolean {
  // Additional validation beyond regex
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1];
  if (!domain) return false;

  // Check for common invalid patterns
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  if (domain.includes('..')) return false;

  return true;
}

/**
 * Check if IP address is valid
 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  return parts.every((part) => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255 && part === num.toString();
  });
}

/**
 * Built-in PII detection patterns
 */
export const BUILT_IN_PATTERNS: readonly PIIPattern[] = [
  // Email addresses
  {
    name: 'email',
    category: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    confidence: 0.95,
    severity: 'medium',
    validate: isValidEmail,
  },

  // Phone numbers (various formats)
  {
    name: 'phone_us',
    category: 'phone',
    pattern: /\b(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.8,
    severity: 'medium',
  },
  {
    name: 'phone_international',
    category: 'phone',
    pattern: /\b\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/g,
    confidence: 0.75,
    severity: 'medium',
  },

  // US Social Security Number
  {
    name: 'ssn',
    category: 'ssn',
    pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    confidence: 0.85,
    severity: 'critical',
    validate: isValidSSN,
  },

  // Credit card numbers
  {
    name: 'credit_card_visa',
    category: 'credit_card',
    pattern: /\b4\d{3}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g,
    confidence: 0.9,
    severity: 'critical',
    validate: isValidLuhn,
  },
  {
    name: 'credit_card_mastercard',
    category: 'credit_card',
    pattern: /\b5[1-5]\d{2}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g,
    confidence: 0.9,
    severity: 'critical',
    validate: isValidLuhn,
  },
  {
    name: 'credit_card_amex',
    category: 'credit_card',
    pattern: /\b3[47]\d{2}[-.\s]?\d{6}[-.\s]?\d{5}\b/g,
    confidence: 0.9,
    severity: 'critical',
    validate: isValidLuhn,
  },
  {
    name: 'credit_card_generic',
    category: 'credit_card',
    pattern: /\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b/g,
    confidence: 0.7,
    severity: 'critical',
    validate: isValidLuhn,
  },

  // IP addresses
  {
    name: 'ipv4',
    category: 'ip_address',
    pattern: /\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b/g,
    confidence: 0.85,
    severity: 'low',
    validate: isValidIPv4,
  },
  {
    name: 'ipv6',
    category: 'ip_address',
    pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    confidence: 0.9,
    severity: 'low',
  },

  // Date of birth patterns (various formats)
  {
    name: 'dob_us',
    category: 'date_of_birth',
    pattern: /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g,
    confidence: 0.6,
    severity: 'medium',
  },
  {
    name: 'dob_iso',
    category: 'date_of_birth',
    pattern: /\b(?:19|20)\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])\b/g,
    confidence: 0.6,
    severity: 'medium',
  },

  // API keys and tokens
  {
    name: 'api_key_generic',
    category: 'api_key',
    pattern: /\b(?:api[_-]?key|apikey|api[_-]?token)['":\s]*[=:]?\s*['"]?([a-zA-Z0-9_-]{20,})/gi,
    confidence: 0.8,
    severity: 'critical',
  },
  {
    name: 'openai_api_key',
    category: 'api_key',
    pattern: /\bsk-[a-zA-Z0-9]{20,}\b/g,
    confidence: 0.95,
    severity: 'critical',
  },
  {
    name: 'anthropic_api_key',
    category: 'api_key',
    pattern: /\bsk-ant-[a-zA-Z0-9-]{20,}\b/g,
    confidence: 0.95,
    severity: 'critical',
  },
  {
    name: 'github_token',
    category: 'api_key',
    pattern: /\bgh[pousr]_[a-zA-Z0-9]{36,}\b/g,
    confidence: 0.95,
    severity: 'critical',
  },
  {
    name: 'aws_access_key',
    category: 'api_key',
    pattern: /\bAKIA[A-Z0-9]{16}\b/g,
    confidence: 0.95,
    severity: 'critical',
  },
  {
    name: 'aws_secret_key',
    category: 'api_key',
    pattern: /\b[A-Za-z0-9/+=]{40}\b/g,
    confidence: 0.5, // Low confidence as it can match many things
    severity: 'critical',
  },

  // JWT tokens
  {
    name: 'jwt',
    category: 'jwt',
    pattern: /\beyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\b/g,
    confidence: 0.95,
    severity: 'high',
  },

  // Passwords in common formats
  {
    name: 'password_field',
    category: 'password',
    pattern: /(?:password|passwd|pwd|pass)['":\s]*[=:]?\s*['"]?([^\s'"]{8,})/gi,
    confidence: 0.7,
    severity: 'critical',
  },

  // URLs with credentials
  {
    name: 'url_with_credentials',
    category: 'url',
    pattern: /\b(?:https?|ftp):\/\/[^:\s]+:[^@\s]+@[^\s]+\b/gi,
    confidence: 0.95,
    severity: 'critical',
  },

  // Bank account numbers (generic)
  {
    name: 'bank_account_iban',
    category: 'bank_account',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}(?:[A-Z0-9]?){0,16}\b/g,
    confidence: 0.85,
    severity: 'critical',
  },
  {
    name: 'bank_routing_number',
    category: 'bank_account',
    pattern: /\b\d{9}\b/g, // US routing numbers
    confidence: 0.3, // Very low - too many false positives
    severity: 'high',
  },

  // Passport numbers (US format)
  {
    name: 'passport_us',
    category: 'passport',
    pattern: /\b[A-Z]\d{8}\b/g,
    confidence: 0.5,
    severity: 'critical',
  },

  // Driver's license (common US formats)
  {
    name: 'driver_license_generic',
    category: 'driver_license',
    pattern: /\b[A-Z]\d{7,8}\b/g,
    confidence: 0.4,
    severity: 'high',
  },
];

/**
 * Get patterns for specific categories
 */
export function getPatternsForCategories(
  categories: readonly string[]
): readonly PIIPattern[] {
  return BUILT_IN_PATTERNS.filter((p) =>
    categories.includes(p.category)
  );
}

/**
 * Get all category names
 */
export function getAllCategories(): readonly string[] {
  return [...new Set(BUILT_IN_PATTERNS.map((p) => p.category))];
}
