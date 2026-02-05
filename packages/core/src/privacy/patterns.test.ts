import { describe, it, expect } from 'vitest';
import { BUILT_IN_PATTERNS, getPatternsForCategories, getAllCategories } from './patterns.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function findPattern(name: string) {
  return BUILT_IN_PATTERNS.find((p) => p.name === name)!;
}

function testMatch(patternName: string, input: string, shouldMatch: boolean) {
  const p = findPattern(patternName);
  // Reset regex state (global flag)
  p.pattern.lastIndex = 0;
  const match = p.pattern.test(input);
  if (shouldMatch) {
    expect(match).toBe(true);
  } else {
    expect(match).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Email patterns
// ---------------------------------------------------------------------------
describe('email pattern', () => {
  it('matches valid emails', () => {
    testMatch('email', 'user@example.com', true);
    testMatch('email', 'test.user+tag@domain.co.uk', true);
  });

  it('rejects invalid emails', () => {
    testMatch('email', 'notanemail', false);
    testMatch('email', '@nodomain.com', false);
  });

  it('validate rejects bad domains', () => {
    const p = findPattern('email');
    expect(p.validate!('user@.com')).toBe(false);
    expect(p.validate!('user@domain..com')).toBe(false);
    expect(p.validate!('user@domain.com')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phone patterns
// ---------------------------------------------------------------------------
describe('phone_us pattern', () => {
  it('matches US phone numbers', () => {
    testMatch('phone_us', '555-123-4567', true);
    testMatch('phone_us', '(555) 123-4567', true);
    testMatch('phone_us', '+1 555 123 4567', true);
  });
});

describe('phone_international pattern', () => {
  it('matches international phone numbers', () => {
    testMatch('phone_international', '+44 20 7946 0958', true);
    testMatch('phone_international', '+49-30-12345678', true);
  });
});

// ---------------------------------------------------------------------------
// SSN pattern
// ---------------------------------------------------------------------------
describe('ssn pattern', () => {
  it('matches valid SSN formats', () => {
    testMatch('ssn', '123-45-6789', true);
    testMatch('ssn', '123 45 6789', true);
  });

  it('validate rejects invalid SSNs', () => {
    const p = findPattern('ssn');
    expect(p.validate!('000-12-3456')).toBe(false); // area 000
    expect(p.validate!('666-12-3456')).toBe(false); // area 666
    expect(p.validate!('900-12-3456')).toBe(false); // area starts with 9
    expect(p.validate!('123-00-6789')).toBe(false); // group 00
    expect(p.validate!('123-45-0000')).toBe(false); // serial 0000
    expect(p.validate!('123-45-6789')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Credit card patterns
// ---------------------------------------------------------------------------
describe('credit_card_visa pattern', () => {
  it('matches Visa numbers', () => {
    // Visa test number (passes Luhn)
    testMatch('credit_card_visa', '4111111111111111', true);
  });

  it('validate checks Luhn', () => {
    const p = findPattern('credit_card_visa');
    expect(p.validate!('4111111111111111')).toBe(true);
    expect(p.validate!('4111111111111112')).toBe(false);
  });
});

describe('credit_card_mastercard pattern', () => {
  it('matches Mastercard numbers', () => {
    testMatch('credit_card_mastercard', '5500000000000004', true);
  });
});

describe('credit_card_amex pattern', () => {
  it('matches Amex numbers', () => {
    testMatch('credit_card_amex', '340000000000009', true);
    testMatch('credit_card_amex', '370000000000002', true);
  });
});

describe('credit_card_generic pattern', () => {
  it('matches 16-digit card numbers', () => {
    testMatch('credit_card_generic', '1234-5678-9012-3456', true);
  });

  it('validate checks Luhn', () => {
    const p = findPattern('credit_card_generic');
    expect(p.validate!('4111111111111111')).toBe(true); // valid Luhn
    expect(p.validate!('1234567890123456')).toBe(false); // invalid Luhn
  });
});

// ---------------------------------------------------------------------------
// IP patterns
// ---------------------------------------------------------------------------
describe('ipv4 pattern', () => {
  it('matches valid IPv4', () => {
    testMatch('ipv4', '192.168.1.1', true);
    testMatch('ipv4', '10.0.0.1', true);
    testMatch('ipv4', '255.255.255.255', true);
  });

  it('rejects invalid IPv4', () => {
    testMatch('ipv4', '256.1.1.1', false);
  });

  it('validate checks octets', () => {
    const p = findPattern('ipv4');
    expect(p.validate!('192.168.1.1')).toBe(true);
    expect(p.validate!('192.168.1')).toBe(false); // too few parts
  });
});

describe('ipv6 pattern', () => {
  it('matches full IPv6', () => {
    testMatch('ipv6', '2001:0db8:85a3:0000:0000:8a2e:0370:7334', true);
  });

  it('matches compressed IPv6', () => {
    testMatch('ipv6', '::1', true);
    testMatch('ipv6', 'fe80::1', true);
  });
});

// ---------------------------------------------------------------------------
// Date of birth patterns
// ---------------------------------------------------------------------------
describe('dob_us pattern', () => {
  it('matches US date format', () => {
    testMatch('dob_us', '01/15/1990', true);
    testMatch('dob_us', '12-31-2000', true);
  });

  it('rejects invalid months', () => {
    testMatch('dob_us', '13/15/1990', false);
  });
});

describe('dob_iso pattern', () => {
  it('matches ISO date format', () => {
    testMatch('dob_iso', '1990-01-15', true);
    testMatch('dob_iso', '2000/12/31', true);
  });
});

// ---------------------------------------------------------------------------
// API key patterns
// ---------------------------------------------------------------------------
describe('api_key_generic pattern', () => {
  it('matches api key patterns', () => {
    testMatch('api_key_generic', 'api_key: abcdefghijklmnopqrstuvwx', true);
    testMatch('api_key_generic', 'apiKey="12345678901234567890"', true);
  });
});

describe('openai_api_key pattern', () => {
  it('matches OpenAI keys', () => {
    testMatch('openai_api_key', 'sk-abcdefghijklmnopqrstuvwx', true);
  });
});

describe('anthropic_api_key pattern', () => {
  it('matches Anthropic keys', () => {
    testMatch('anthropic_api_key', 'sk-ant-abcdefghijklmnopqrstuvwx', true);
  });
});

describe('github_token pattern', () => {
  it('matches GitHub tokens', () => {
    testMatch('github_token', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij', true);
  });
});

describe('aws_access_key pattern', () => {
  it('matches AWS access keys', () => {
    testMatch('aws_access_key', 'AKIAIOSFODNN7EXAMPLE', true);
  });
});

// ---------------------------------------------------------------------------
// JWT pattern
// ---------------------------------------------------------------------------
describe('jwt pattern', () => {
  it('matches JWT tokens', () => {
    testMatch('jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123_-', true);
  });
});

// ---------------------------------------------------------------------------
// Password pattern
// ---------------------------------------------------------------------------
describe('password_field pattern', () => {
  it('matches password assignments', () => {
    testMatch('password_field', 'password: "mysecretpass"', true);
    testMatch('password_field', 'pwd=supersecret', true);
  });
});

// ---------------------------------------------------------------------------
// URL with credentials
// ---------------------------------------------------------------------------
describe('url_with_credentials pattern', () => {
  it('matches URLs with credentials', () => {
    testMatch('url_with_credentials', 'https://user:pass@example.com', true);
    testMatch('url_with_credentials', 'ftp://admin:secret@ftp.example.com', true);
  });
});

// ---------------------------------------------------------------------------
// Bank account patterns
// ---------------------------------------------------------------------------
describe('bank_account_iban pattern', () => {
  it('matches IBAN format', () => {
    // Valid GB IBAN
    testMatch('bank_account_iban', 'GB29NWBK60161331926819', true);
  });

  it('validate checks IBAN checksum', () => {
    const p = findPattern('bank_account_iban');
    expect(p.validate!('GB29NWBK60161331926819')).toBe(true);
    expect(p.validate!('GB00NWBK60161331926819')).toBe(false);
  });
});

describe('bank_routing_number pattern', () => {
  it('validate checks routing number checksum', () => {
    const p = findPattern('bank_routing_number');
    // Valid routing number: 021000021 (JPMorgan Chase)
    expect(p.validate!('021000021')).toBe(true);
    expect(p.validate!('000000000')).toBe(true); // 0 checksum is valid (0 % 10 === 0)
    expect(p.validate!('123456789')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Passport pattern
// ---------------------------------------------------------------------------
describe('passport_us pattern', () => {
  it('matches US passport format', () => {
    testMatch('passport_us', 'A12345678', true);
  });
});

// ---------------------------------------------------------------------------
// Driver's license
// ---------------------------------------------------------------------------
describe('driver_license_generic pattern', () => {
  it('matches generic DL format', () => {
    testMatch('driver_license_generic', 'D1234567', true);
    testMatch('driver_license_generic', 'S12345678', true);
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------
describe('getPatternsForCategories', () => {
  it('filters by category', () => {
    const emailPatterns = getPatternsForCategories(['email']);
    expect(emailPatterns.length).toBeGreaterThanOrEqual(1);
    expect(emailPatterns.every((p) => p.category === 'email')).toBe(true);
  });

  it('returns multiple categories', () => {
    const patterns = getPatternsForCategories(['email', 'phone']);
    expect(patterns.some((p) => p.category === 'email')).toBe(true);
    expect(patterns.some((p) => p.category === 'phone')).toBe(true);
  });

  it('returns empty for unknown category', () => {
    const patterns = getPatternsForCategories(['nonexistent']);
    expect(patterns).toHaveLength(0);
  });
});

describe('getAllCategories', () => {
  it('returns all unique categories', () => {
    const categories = getAllCategories();
    expect(categories.length).toBeGreaterThan(0);
    // No duplicates
    expect(new Set(categories).size).toBe(categories.length);
  });

  it('includes expected categories', () => {
    const categories = getAllCategories();
    expect(categories).toContain('email');
    expect(categories).toContain('phone');
    expect(categories).toContain('ssn');
    expect(categories).toContain('credit_card');
    expect(categories).toContain('api_key');
    expect(categories).toContain('ip_address');
  });
});

// ---------------------------------------------------------------------------
// BUILT_IN_PATTERNS structure
// ---------------------------------------------------------------------------
describe('BUILT_IN_PATTERNS structure', () => {
  it('all patterns have required fields', () => {
    for (const p of BUILT_IN_PATTERNS) {
      expect(p.name).toBeTruthy();
      expect(p.category).toBeTruthy();
      expect(p.pattern).toBeInstanceOf(RegExp);
      expect(p.confidence).toBeGreaterThanOrEqual(0);
      expect(p.confidence).toBeLessThanOrEqual(1);
      expect(['low', 'medium', 'high', 'critical']).toContain(p.severity);
    }
  });

  it('all patterns have global flag', () => {
    for (const p of BUILT_IN_PATTERNS) {
      expect(p.pattern.global).toBe(true);
    }
  });
});
