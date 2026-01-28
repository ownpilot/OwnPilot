import { describe, it, expect } from 'vitest';
import {
  PIIDetector,
  createDetector,
  detectPII,
  hasPII,
} from './detector.js';

describe('PIIDetector', () => {
  describe('email detection', () => {
    it('detects simple email', () => {
      const result = detectPII('Contact me at john@example.com');
      expect(result.hasPII).toBe(true);
      expect(result.matches.length).toBe(1);
      expect(result.matches[0]?.category).toBe('email');
      expect(result.matches[0]?.match).toBe('john@example.com');
    });

    it('detects multiple emails', () => {
      const result = detectPII('Email john@example.com or jane@test.org');
      expect(result.matches.length).toBe(2);
      expect(result.categories).toContain('email');
    });

    it('handles complex email formats', () => {
      const result = detectPII('Contact john.doe+work@sub.example.com');
      expect(result.hasPII).toBe(true);
      expect(result.matches[0]?.match).toBe('john.doe+work@sub.example.com');
    });
  });

  describe('phone detection', () => {
    it('detects US phone numbers', () => {
      const result = detectPII('Call me at (555) 123-4567');
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'phone')).toBe(true);
    });

    it('detects international phone numbers', () => {
      const result = detectPII('Call +1-555-123-4567');
      expect(result.hasPII).toBe(true);
    });
  });

  describe('SSN detection', () => {
    it('detects SSN with dashes', () => {
      const result = detectPII('SSN: 123-45-6789');
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'ssn')).toBe(true);
      expect(result.maxSeverity).toBe('critical');
    });

    it('detects SSN without dashes', () => {
      const result = detectPII('SSN: 123456789');
      expect(result.hasPII).toBe(true);
    });

    it('rejects invalid SSNs', () => {
      // SSN starting with 9 is invalid
      const result = detectPII('Number: 900-00-0000');
      // Should have low confidence due to validation failure
      const ssnMatch = result.matches.find((m) => m.category === 'ssn');
      if (ssnMatch) {
        expect(ssnMatch.confidence).toBeLessThan(0.5);
      }
    });
  });

  describe('credit card detection', () => {
    it('detects Visa card', () => {
      const result = detectPII('Card: 4111-1111-1111-1111');
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'credit_card')).toBe(true);
      expect(result.maxSeverity).toBe('critical');
    });

    it('detects MasterCard', () => {
      const result = detectPII('Card: 5500 0000 0000 0004');
      expect(result.hasPII).toBe(true);
    });

    it('validates with Luhn algorithm', () => {
      // Invalid card number (fails Luhn)
      const result = detectPII('Card: 4111-1111-1111-1112');
      const ccMatch = result.matches.find((m) => m.category === 'credit_card');
      // Should have lower confidence due to Luhn failure
      if (ccMatch) {
        expect(ccMatch.confidence).toBeLessThan(0.9);
      }
    });
  });

  describe('IP address detection', () => {
    it('detects IPv4 addresses', () => {
      const result = detectPII('Server IP: 192.168.1.1');
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'ip_address')).toBe(true);
    });

    it('validates IP address format', () => {
      const result = detectPII('Invalid: 256.256.256.256');
      // Should not match as 256 is invalid for IPv4
      const ipMatch = result.matches.find((m) => m.category === 'ip_address');
      expect(ipMatch).toBeUndefined();
    });
  });

  describe('API key detection', () => {
    it('detects OpenAI API keys', () => {
      const result = detectPII('API key: sk-1234567890abcdefghijklmnop');
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'api_key')).toBe(true);
      expect(result.maxSeverity).toBe('critical');
    });

    it('detects Anthropic API keys', () => {
      const result = detectPII('Key: sk-ant-api123-ABCDEFGHIJKLMNOP');
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'api_key')).toBe(true);
    });

    it('detects GitHub tokens', () => {
      const result = detectPII('Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz');
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'api_key')).toBe(true);
    });

    it('detects AWS access keys', () => {
      const result = detectPII('AWS Key: AKIAIOSFODNN7EXAMPLE');
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'api_key')).toBe(true);
    });
  });

  describe('JWT detection', () => {
    it('detects JWT tokens', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Gfx6VO9tcxwk6xqx9yYzSfebfeakZp5JYIgP_edcw_A';
      const result = detectPII(`Token: ${jwt}`);
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'jwt')).toBe(true);
    });
  });

  describe('URL with credentials', () => {
    it('detects URLs with embedded credentials', () => {
      // Pattern matches https/http/ftp URLs with user:pass@host format
      const result = detectPII('Server: https://admin:secretpass@api.example.com/endpoint');
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'url')).toBe(true);
      expect(result.maxSeverity).toBe('critical');
    });
  });

  describe('configuration', () => {
    it('respects minimum confidence threshold', () => {
      const detector = createDetector({ minConfidence: 0.9 });
      const result = detector.detect('Some text with low confidence matches');
      // Should filter out low-confidence matches
      expect(result.matches.every((m) => m.confidence >= 0.9)).toBe(true);
    });

    it('filters by category', () => {
      const detector = createDetector({ categories: ['email'] });
      const result = detector.detect('Email: test@example.com SSN: 123-45-6789');
      expect(result.matches.every((m) => m.category === 'email')).toBe(true);
    });

    it('supports custom patterns', () => {
      const detector = createDetector({
        customPatterns: [
          {
            name: 'employee_id',
            category: 'custom',
            pattern: /EMP-\d{6}/g,
            confidence: 0.95,
            severity: 'medium',
          },
        ],
      });
      const result = detector.detect('Employee ID: EMP-123456');
      expect(result.hasPII).toBe(true);
      expect(result.matches.some((m) => m.category === 'custom')).toBe(true);
    });
  });

  describe('utility functions', () => {
    it('hasPII returns boolean', () => {
      expect(hasPII('No PII here')).toBe(false);
      expect(hasPII('Email: test@example.com')).toBe(true);
    });

    it('detectCategories filters results', () => {
      const detector = createDetector();
      const result = detector.detectCategories(
        'Email: test@example.com SSN: 123-45-6789',
        ['email']
      );
      expect(result.matches.every((m) => m.category === 'email')).toBe(true);
    });

    it('detectBySeverity filters by severity', () => {
      const detector = createDetector();
      const result = detector.detectBySeverity(
        'Email: test@example.com SSN: 123-45-6789 IP: 192.168.1.1',
        'critical'
      );
      expect(result.matches.every((m) => m.severity === 'critical')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = detectPII('');
      expect(result.hasPII).toBe(false);
      expect(result.matches.length).toBe(0);
    });

    it('handles text without PII', () => {
      const result = detectPII('This is a normal sentence without any personal information.');
      expect(result.hasPII).toBe(false);
    });

    it('does not produce overlapping matches', () => {
      const result = detectPII('Call 555-12-3456 or 555-123-4567');
      // Should not have overlapping ranges
      const matches = result.matches;
      for (let i = 1; i < matches.length; i++) {
        const prev = matches[i - 1]!;
        const curr = matches[i]!;
        expect(curr.start >= prev.end).toBe(true);
      }
    });
  });
});
