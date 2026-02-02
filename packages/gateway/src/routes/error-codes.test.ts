/**
 * Error Codes Tests
 *
 * Validates the structure and completeness of centralized error codes.
 */

import { describe, it, expect } from 'vitest';
import { ERROR_CODES } from './error-codes.js';

describe('ERROR_CODES', () => {
  describe('Structure', () => {
    it('should be an object', () => {
      expect(ERROR_CODES).toBeDefined();
      expect(typeof ERROR_CODES).toBe('object');
    });

    it('should not be null or an array', () => {
      expect(ERROR_CODES).not.toBeNull();
      expect(Array.isArray(ERROR_CODES)).toBe(false);
    });

    it('should have string values for all keys', () => {
      Object.values(ERROR_CODES).forEach((value) => {
        expect(typeof value).toBe('string');
      });
    });

    it('should have uppercase keys matching their values', () => {
      Object.entries(ERROR_CODES).forEach(([key, value]) => {
        expect(key).toBe(value);
        expect(key).toBe(key.toUpperCase());
      });
    });
  });

  describe('Generic Errors (404)', () => {
    it('should have NOT_FOUND error', () => {
      expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    });

    it('should have FILE_NOT_FOUND error', () => {
      expect(ERROR_CODES.FILE_NOT_FOUND).toBe('FILE_NOT_FOUND');
    });

    it('should have BACKUP_NOT_FOUND error', () => {
      expect(ERROR_CODES.BACKUP_NOT_FOUND).toBe('BACKUP_NOT_FOUND');
    });

    it('should have PROVIDER_NOT_FOUND error', () => {
      expect(ERROR_CODES.PROVIDER_NOT_FOUND).toBe('PROVIDER_NOT_FOUND');
    });

    it('should have WORKSPACE_NOT_FOUND error', () => {
      expect(ERROR_CODES.WORKSPACE_NOT_FOUND).toBe('WORKSPACE_NOT_FOUND');
    });
  });

  describe('Validation Errors (400)', () => {
    it('should have INVALID_REQUEST error', () => {
      expect(ERROR_CODES.INVALID_REQUEST).toBe('INVALID_REQUEST');
    });

    it('should have INVALID_INPUT error', () => {
      expect(ERROR_CODES.INVALID_INPUT).toBe('INVALID_INPUT');
    });

    it('should have INVALID_VALUE error', () => {
      expect(ERROR_CODES.INVALID_VALUE).toBe('INVALID_VALUE');
    });

    it('should have INVALID_CRON error', () => {
      expect(ERROR_CODES.INVALID_CRON).toBe('INVALID_CRON');
    });

    it('should have MISSING_FILENAME error', () => {
      expect(ERROR_CODES.MISSING_FILENAME).toBe('MISSING_FILENAME');
    });
  });

  describe('Access & Permission Errors (403)', () => {
    it('should have ACCESS_DENIED error', () => {
      expect(ERROR_CODES.ACCESS_DENIED).toBe('ACCESS_DENIED');
    });

    it('should have PROTECTED error', () => {
      expect(ERROR_CODES.PROTECTED).toBe('PROTECTED');
    });
  });

  describe('Conflict Errors (409)', () => {
    it('should have ALREADY_RUNNING error', () => {
      expect(ERROR_CODES.ALREADY_RUNNING).toBe('ALREADY_RUNNING');
    });

    it('should have SESSION_ACTIVE error', () => {
      expect(ERROR_CODES.SESSION_ACTIVE).toBe('SESSION_ACTIVE');
    });

    it('should have OPERATION_IN_PROGRESS error', () => {
      expect(ERROR_CODES.OPERATION_IN_PROGRESS).toBe('OPERATION_IN_PROGRESS');
    });

    it('should have NOT_PAUSED error', () => {
      expect(ERROR_CODES.NOT_PAUSED).toBe('NOT_PAUSED');
    });
  });

  describe('Generic Operation Failures (500)', () => {
    it('should have ERROR error', () => {
      expect(ERROR_CODES.ERROR).toBe('ERROR');
    });

    it('should have EXECUTION_ERROR error', () => {
      expect(ERROR_CODES.EXECUTION_ERROR).toBe('EXECUTION_ERROR');
    });
  });

  describe('Completeness', () => {
    it('should have at least 20 error codes defined', () => {
      const codeCount = Object.keys(ERROR_CODES).length;
      expect(codeCount).toBeGreaterThanOrEqual(20);
    });

    it('should not have duplicate values', () => {
      const values = Object.values(ERROR_CODES);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it('should have consistent naming convention (UPPER_SNAKE_CASE)', () => {
      Object.keys(ERROR_CODES).forEach((key) => {
        expect(key).toMatch(/^[A-Z_]+$/);
      });
    });
  });

  describe('Commonly Used Codes', () => {
    const commonCodes = [
      'NOT_FOUND',
      'INVALID_REQUEST',
      'ERROR',
      'ACCESS_DENIED',
      'ALREADY_RUNNING',
    ];

    commonCodes.forEach((code) => {
      it(`should have ${code} error code`, () => {
        expect(ERROR_CODES).toHaveProperty(code);
        expect(ERROR_CODES[code as keyof typeof ERROR_CODES]).toBe(code);
      });
    });
  });
});
