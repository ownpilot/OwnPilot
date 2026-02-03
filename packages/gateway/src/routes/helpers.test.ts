/**
 * Route Helpers Tests
 *
 * Comprehensive test suite for shared utility functions.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'hono';
import {
  getUserId,
  getPaginationParams,
  getIntParam,
  getOptionalIntParam,
  apiResponse,
  apiError,
  ERROR_CODES,
} from './helpers.js';

// Mock Hono context
function createMockContext(overrides: Partial<Context> = {}): Context {
  const mockContext = {
    get: vi.fn(),
    req: {
      query: vi.fn(),
    },
    json: vi.fn((data, status) => ({ data, status })),
    ...overrides,
  } as unknown as Context;

  return mockContext;
}

describe('Route Helpers', () => {
  describe('getUserId', () => {
    it('should return userId from context.get when available', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue('user-from-auth');

      const result = getUserId(c);

      expect(result).toBe('user-from-auth');
      expect(c.get).toHaveBeenCalledWith('userId');
    });

    it('should return default when no userId in auth context', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue(undefined);

      const result = getUserId(c);

      expect(result).toBe('default');
    });

    it('should not accept userId from query parameters (security)', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue(undefined);
      vi.mocked(c.req.query).mockReturnValue('malicious-user');

      const result = getUserId(c);

      expect(result).toBe('default');
    });
  });

  describe('getPaginationParams', () => {
    it('should return default pagination values when no query params', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue(undefined);

      const result = getPaginationParams(c);

      expect(result).toEqual({ limit: 20, offset: 0 });
    });

    it('should parse limit and offset from query parameters', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockImplementation((key) => {
        if (key === 'limit') return '50';
        if (key === 'offset') return '10';
        return undefined;
      });

      const result = getPaginationParams(c);

      expect(result).toEqual({ limit: 50, offset: 10 });
    });

    it('should enforce minimum limit of 1', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockImplementation((key) => {
        if (key === 'limit') return '0';
        return undefined;
      });

      const result = getPaginationParams(c);

      expect(result.limit).toBe(1);
    });

    it('should enforce maximum limit', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockImplementation((key) => {
        if (key === 'limit') return '200';
        return undefined;
      });

      const result = getPaginationParams(c, 20, 100);

      expect(result.limit).toBe(100);
    });

    it('should enforce minimum offset of 0', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockImplementation((key) => {
        if (key === 'offset') return '-10';
        return undefined;
      });

      const result = getPaginationParams(c);

      expect(result.offset).toBe(0);
    });

    it('should handle custom default limit', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue(undefined);

      const result = getPaginationParams(c, 50);

      expect(result.limit).toBe(50);
    });

    it('should handle custom max limit', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockImplementation((key) => {
        if (key === 'limit') return '500';
        return undefined;
      });

      const result = getPaginationParams(c, 20, 200);

      expect(result.limit).toBe(200);
    });

    it('should fall back to default limit when given invalid string', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockImplementation((key) => {
        if (key === 'limit') return 'invalid';
        return undefined;
      });

      const result = getPaginationParams(c);

      expect(result.limit).toBe(20);
    });

    it('should fall back to default offset when given invalid string', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockImplementation((key) => {
        if (key === 'offset') return 'abc';
        return undefined;
      });

      const result = getPaginationParams(c);

      expect(result.offset).toBe(0);
    });
  });

  describe('getIntParam', () => {
    it('should return default value when parameter not provided', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue(undefined);

      const result = getIntParam(c, 'days', 30);

      expect(result).toBe(30);
    });

    it('should parse integer from query parameter', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('45');

      const result = getIntParam(c, 'days', 30);

      expect(result).toBe(45);
      expect(c.req.query).toHaveBeenCalledWith('days');
    });

    it('should enforce minimum value', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('5');

      const result = getIntParam(c, 'limit', 20, 10);

      expect(result).toBe(10);
    });

    it('should enforce maximum value', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('200');

      const result = getIntParam(c, 'limit', 20, 1, 100);

      expect(result).toBe(100);
    });

    it('should allow values within bounds', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('50');

      const result = getIntParam(c, 'limit', 20, 1, 100);

      expect(result).toBe(50);
    });

    it('should handle negative values with min bound', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('-10');

      const result = getIntParam(c, 'offset', 0, 0);

      expect(result).toBe(0);
    });

    it('should work without bounds', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('999');

      const result = getIntParam(c, 'count', 10);

      expect(result).toBe(999);
    });

    it('should fall back to default value when given invalid string', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('not-a-number');

      const result = getIntParam(c, 'days', 30);

      expect(result).toBe(30);
    });

    it('should apply bounds after NaN fallback to default', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('abc');

      const result = getIntParam(c, 'count', 50, 1, 100);

      expect(result).toBe(50);
    });
  });

  describe('getOptionalIntParam', () => {
    it('should return undefined when parameter not provided', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue(undefined);

      const result = getOptionalIntParam(c, 'limit');

      expect(result).toBeUndefined();
    });

    it('should parse valid integer from query parameter', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('25');

      const result = getOptionalIntParam(c, 'limit');

      expect(result).toBe(25);
    });

    it('should return undefined for invalid string', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('abc');

      const result = getOptionalIntParam(c, 'limit');

      expect(result).toBeUndefined();
    });

    it('should enforce minimum bound', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('-5');

      const result = getOptionalIntParam(c, 'offset', 0);

      expect(result).toBe(0);
    });

    it('should enforce maximum bound', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('500');

      const result = getOptionalIntParam(c, 'limit', 1, 100);

      expect(result).toBe(100);
    });

    it('should allow values within bounds', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('50');

      const result = getOptionalIntParam(c, 'limit', 1, 100);

      expect(result).toBe(50);
    });

    it('should handle zero as valid value', () => {
      const c = createMockContext();
      vi.mocked(c.req.query).mockReturnValue('0');

      const result = getOptionalIntParam(c, 'offset', 0);

      expect(result).toBe(0);
    });
  });

  describe('apiResponse', () => {
    it('should create success response with data and meta', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockImplementation((key) => {
        if (key === 'requestId') return 'req-123';
        return undefined;
      });

      const data = { message: 'Success', count: 5 };
      const _result = apiResponse(c, data);

      expect(c.json).toHaveBeenCalled();
      const [response] = vi.mocked(c.json).mock.calls[0];
      expect(response).toMatchObject({
        success: true,
        data: { message: 'Success', count: 5 },
        meta: {
          requestId: 'req-123',
        },
      });
      expect(response.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should use unknown requestId when not available', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue(undefined);

      const _result = apiResponse(c, { data: 'test' });

      const [response] = vi.mocked(c.json).mock.calls[0];
      expect(response.meta.requestId).toBe('unknown');
    });

    it('should include custom status code when provided', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue('req-456');

      apiResponse(c, { created: true }, 201);

      expect(c.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
        201
      );
    });

    it('should use default status when not provided', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue('req-789');

      apiResponse(c, { data: 'test' });

      // Called with one argument (no status)
      expect(vi.mocked(c.json).mock.calls[0]).toHaveLength(1);
    });

    it('should handle null data', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue('req-null');

      apiResponse(c, null);

      const [response] = vi.mocked(c.json).mock.calls[0];
      expect(response.data).toBeNull();
      expect(response.success).toBe(true);
    });
  });

  describe('apiError', () => {
    it('should create error response with string error', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue('req-error-1');

      apiError(c, 'Something went wrong', 500);

      const [response, status] = vi.mocked(c.json).mock.calls[0];
      expect(response).toMatchObject({
        success: false,
        error: {
          code: ERROR_CODES.ERROR,
          message: 'Something went wrong',
        },
        meta: {
          requestId: 'req-error-1',
        },
      });
      expect(response.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(status).toBe(500);
    });

    it('should create error response with structured error', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue('req-error-2');

      apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Resource not found' }, 404);

      const [response, status] = vi.mocked(c.json).mock.calls[0];
      expect(response).toMatchObject({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Resource not found',
        },
      });
      expect(status).toBe(404);
    });

    it('should use default status 400 when not provided', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue('req-error-3');

      apiError(c, 'Invalid input');

      const [, status] = vi.mocked(c.json).mock.calls[0];
      expect(status).toBe(400);
    });

    it('should include timestamp in meta', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue('req-error-4');

      apiError(c, 'Error occurred');

      const [response] = vi.mocked(c.json).mock.calls[0];
      expect(response.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should handle custom error codes', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue('req-error-5');

      apiError(c, { code: 'CUSTOM_ERROR', message: 'Custom error message' }, 422);

      const [response, status] = vi.mocked(c.json).mock.calls[0];
      expect(response.error.code).toBe('CUSTOM_ERROR');
      expect(status).toBe(422);
    });

    it('should use unknown requestId when not available', () => {
      const c = createMockContext();
      vi.mocked(c.get).mockReturnValue(undefined);

      apiError(c, 'Error');

      const [response] = vi.mocked(c.json).mock.calls[0];
      expect(response.meta.requestId).toBe('unknown');
    });
  });

  describe('ERROR_CODES export', () => {
    it('should export ERROR_CODES object', () => {
      expect(ERROR_CODES).toBeDefined();
      expect(typeof ERROR_CODES).toBe('object');
    });

    it('should include common error codes', () => {
      expect(ERROR_CODES.NOT_FOUND).toBeDefined();
      expect(ERROR_CODES.INVALID_REQUEST).toBeDefined();
      expect(ERROR_CODES.ERROR).toBeDefined();
    });
  });
});
