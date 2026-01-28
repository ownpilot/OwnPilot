import { describe, it, expect } from 'vitest';
import {
  PIIRedactor,
  createRedactor,
  redactPII,
  maskPII,
  labelPII,
  removePII,
} from './redactor.js';

describe('PIIRedactor', () => {
  describe('mask mode', () => {
    it('masks email with asterisks', () => {
      const result = redactPII('Email: test@example.com', { mode: 'mask' });
      // test@example.com = 16 characters
      expect(result.redacted).toBe('Email: ****************');
      expect(result.count).toBe(1);
    });

    it('masks multiple PII items', () => {
      const result = redactPII('Email: test@example.com Phone: 555-123-4567');
      expect(result.count).toBe(2);
      expect(result.redacted).not.toContain('test@example.com');
      expect(result.redacted).not.toContain('555-123-4567');
    });

    it('preserves first N characters', () => {
      const result = redactPII('Email: test@example.com', {
        mode: 'mask',
        keepFirst: 2,
      });
      // test@example.com = 16 chars, keep first 2 = te + 14 asterisks
      expect(result.redacted).toBe('Email: te**************');
    });

    it('preserves last N characters', () => {
      const result = redactPII('Email: test@example.com', {
        mode: 'mask',
        keepLast: 4,
      });
      // test@example.com = 16 chars, keep last 4 = 12 asterisks + .com
      expect(result.redacted).toBe('Email: ************.com');
    });

    it('preserves both first and last characters', () => {
      const result = redactPII('Email: test@example.com', {
        mode: 'mask',
        keepFirst: 2,
        keepLast: 4,
      });
      // test@example.com = 16 chars, keep first 2 + last 4 = te + 10 asterisks + .com
      expect(result.redacted).toBe('Email: te**********.com');
    });

    it('uses custom mask character', () => {
      const result = redactPII('Email: test@example.com', {
        mode: 'mask',
        maskChar: 'X',
      });
      // test@example.com = 16 characters
      expect(result.redacted).toBe('Email: XXXXXXXXXXXXXXXX');
    });
  });

  describe('category mode', () => {
    it('replaces with category label', () => {
      const result = redactPII('Email: test@example.com', { mode: 'category' });
      expect(result.redacted).toBe('Email: [EMAIL]');
    });

    it('uses correct category for each type', () => {
      const result = redactPII('SSN: 123-45-6789', { mode: 'category' });
      expect(result.redacted).toBe('SSN: [SSN]');
    });

    it('handles multiple categories', () => {
      const result = labelPII('Email: test@example.com SSN: 123-45-6789');
      expect(result).toContain('[EMAIL]');
      expect(result).toContain('[SSN]');
    });
  });

  describe('hash mode', () => {
    it('replaces with deterministic hash', () => {
      const result1 = redactPII('Email: test@example.com', { mode: 'hash' });
      const result2 = redactPII('Email: test@example.com', { mode: 'hash' });
      // Same input should produce same hash
      expect(result1.redacted).toBe(result2.redacted);
      expect(result1.redacted).toMatch(/Email: \[REDACTED:[a-f0-9]{8}\]/);
    });

    it('produces different hashes for different values', () => {
      const result1 = redactPII('Email: test@example.com', { mode: 'hash' });
      const result2 = redactPII('Email: other@example.com', { mode: 'hash' });
      expect(result1.redacted).not.toBe(result2.redacted);
    });
  });

  describe('remove mode', () => {
    it('removes PII entirely', () => {
      const result = redactPII('Email: test@example.com', { mode: 'remove' });
      expect(result.redacted).toBe('Email: ');
    });

    it('removes all PII from text', () => {
      const result = removePII('Contact test@example.com or 555-123-4567');
      expect(result).not.toContain('test@example.com');
      expect(result).not.toContain('555-123-4567');
    });
  });

  describe('category filtering', () => {
    it('redacts only specified categories', () => {
      const redactor = createRedactor();
      const result = redactor.redactCategories(
        'Email: test@example.com SSN: 123-45-6789',
        ['email']
      );
      expect(result.redacted).toContain('123-45-6789');
      expect(result.redacted).not.toContain('test@example.com');
    });

    it('respects category filter in options', () => {
      const result = redactPII('Email: test@example.com SSN: 123-45-6789', {
        categories: ['ssn'],
      });
      expect(result.redacted).toContain('test@example.com');
      expect(result.redacted).not.toContain('123-45-6789');
    });
  });

  describe('severity filtering', () => {
    it('redacts only above minimum severity', () => {
      const redactor = createRedactor();
      const result = redactor.redactBySeverity(
        'Email: test@example.com SSN: 123-45-6789 IP: 192.168.1.1',
        'critical'
      );
      // SSN is critical, should be redacted
      expect(result.redacted).not.toContain('123-45-6789');
      // IP is low severity, should remain
      expect(result.redacted).toContain('192.168.1.1');
    });

    it('respects minSeverity option', () => {
      const result = redactPII(
        'Email: test@example.com SSN: 123-45-6789',
        { minSeverity: 'critical' }
      );
      // Email is medium severity, should remain
      expect(result.redacted).toContain('test@example.com');
      // SSN is critical, should be redacted
      expect(result.redacted).not.toContain('123-45-6789');
    });
  });

  describe('utility functions', () => {
    it('maskPII returns masked string', () => {
      const result = maskPII('Email: test@example.com');
      // test@example.com = 16 characters
      expect(result).toBe('Email: ****************');
    });

    it('labelPII returns labeled string', () => {
      const result = labelPII('Email: test@example.com');
      expect(result).toBe('Email: [EMAIL]');
    });

    it('removePII returns cleaned string', () => {
      const result = removePII('Email: test@example.com');
      expect(result).toBe('Email: ');
    });
  });

  describe('edge cases', () => {
    it('handles text without PII', () => {
      const result = redactPII('Hello, world!');
      expect(result.redacted).toBe('Hello, world!');
      expect(result.count).toBe(0);
    });

    it('handles empty string', () => {
      const result = redactPII('');
      expect(result.redacted).toBe('');
      expect(result.count).toBe(0);
    });

    it('handles adjacent PII values', () => {
      // Adjacent emails without space - regex might combine them
      const result = redactPII('test@example.com test@other.com');
      expect(result.count).toBe(2);
    });

    it('returns redacted matches in result', () => {
      const result = redactPII('Email: test@example.com');
      expect(result.redacted_matches.length).toBe(1);
      expect(result.redacted_matches[0]?.category).toBe('email');
    });

    it('handles keepFirst + keepLast larger than string', () => {
      // test@a.co is 9 chars (valid short email)
      const result = redactPII('a@bc.de', {
        mode: 'mask',
        keepFirst: 10,
        keepLast: 10,
      });
      // When keepFirst + keepLast > length, mask entirely
      // a@bc.de = 7 chars
      expect(result.redacted).toBe('*******');
    });
  });

  describe('integration', () => {
    it('handles complex text with multiple PII types', () => {
      const text = `
        Customer: John Doe
        Email: john@example.com
        Phone: (555) 123-4567
        SSN: 123-45-6789
        Card: 4111-1111-1111-1111
        IP: 192.168.1.100
      `;

      const result = redactPII(text, { mode: 'category' });

      expect(result.count).toBeGreaterThan(3);
      expect(result.redacted).toContain('[EMAIL]');
      expect(result.redacted).toContain('[SSN]');
      expect(result.redacted).toContain('[CREDIT_CARD]');
    });

    it('preserves non-PII text structure', () => {
      const text = 'Hello, my email is test@example.com and I live at 123 Main St.';
      const result = redactPII(text);

      expect(result.redacted).toContain('Hello, my email is ');
      expect(result.redacted).toContain(' and I live at 123 Main St.');
    });
  });
});
