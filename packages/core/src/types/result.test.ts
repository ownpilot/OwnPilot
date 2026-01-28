import { describe, it, expect } from 'vitest';
import {
  ok,
  err,
  unwrap,
  unwrapOr,
  mapResult,
  mapError,
  andThen,
  fromPromise,
  fromThrowable,
  combine,
  isOk,
  isErr,
} from './result.js';

describe('Result', () => {
  describe('ok', () => {
    it('creates a successful result', () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    it('works with complex types', () => {
      const result = ok({ name: 'test', value: [1, 2, 3] });
      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ name: 'test', value: [1, 2, 3] });
    });
  });

  describe('err', () => {
    it('creates a failed result', () => {
      const result = err(new Error('test error'));
      expect(result.ok).toBe(false);
      expect(result.error.message).toBe('test error');
    });

    it('works with string errors', () => {
      const result = err('simple error');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('simple error');
    });
  });

  describe('unwrap', () => {
    it('returns value for ok result', () => {
      const result = ok(42);
      expect(unwrap(result)).toBe(42);
    });

    it('throws for err result', () => {
      const result = err(new Error('test error'));
      expect(() => unwrap(result)).toThrow('test error');
    });
  });

  describe('unwrapOr', () => {
    it('returns value for ok result', () => {
      const result = ok(42);
      expect(unwrapOr(result, 0)).toBe(42);
    });

    it('returns default for err result', () => {
      const result = err(new Error('test'));
      expect(unwrapOr(result, 0)).toBe(0);
    });
  });

  describe('mapResult', () => {
    it('transforms ok value', () => {
      const result = ok(5);
      const mapped = mapResult(result, (x) => x * 2);
      expect(mapped.ok).toBe(true);
      expect(mapped.value).toBe(10);
    });

    it('passes through error', () => {
      const result = err(new Error('test'));
      const mapped = mapResult(result, (x: number) => x * 2);
      expect(mapped.ok).toBe(false);
    });
  });

  describe('mapError', () => {
    it('passes through ok value', () => {
      const result = ok(42);
      const mapped = mapError(result, (e) => new Error(`wrapped: ${e}`));
      expect(mapped.ok).toBe(true);
      expect(mapped.value).toBe(42);
    });

    it('transforms error', () => {
      const result = err('original');
      const mapped = mapError(result, (e) => `wrapped: ${e}`);
      expect(mapped.ok).toBe(false);
      expect(mapped.error).toBe('wrapped: original');
    });
  });

  describe('andThen', () => {
    it('chains successful operations', () => {
      const result = ok(5);
      const chained = andThen(result, (x) => ok(x * 2));
      expect(chained.ok).toBe(true);
      expect(chained.value).toBe(10);
    });

    it('short-circuits on error', () => {
      const result = err(new Error('first'));
      const chained = andThen(result, (_x: number) => ok(42));
      expect(chained.ok).toBe(false);
    });

    it('propagates error from chain', () => {
      const result = ok(5);
      const chained = andThen(result, (_x) => err(new Error('from chain')));
      expect(chained.ok).toBe(false);
    });
  });

  describe('fromPromise', () => {
    it('converts resolved promise to ok', async () => {
      const result = await fromPromise(Promise.resolve(42));
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    it('converts rejected promise to err', async () => {
      const result = await fromPromise(Promise.reject(new Error('test')));
      expect(result.ok).toBe(false);
    });

    it('uses error mapper', async () => {
      const result = await fromPromise(
        Promise.reject(new Error('original')),
        (e) => `mapped: ${e instanceof Error ? e.message : e}`
      );
      expect(result.ok).toBe(false);
      expect(result.error).toBe('mapped: original');
    });
  });

  describe('fromThrowable', () => {
    it('converts successful function to ok', () => {
      const result = fromThrowable(() => 42);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    it('converts throwing function to err', () => {
      const result = fromThrowable(() => {
        throw new Error('test');
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('combine', () => {
    it('combines all ok results', () => {
      const results = [ok(1), ok(2), ok(3)];
      const combined = combine(results);
      expect(combined.ok).toBe(true);
      expect(combined.value).toEqual([1, 2, 3]);
    });

    it('returns first error', () => {
      const results = [ok(1), err(new Error('second')), err(new Error('third'))];
      const combined = combine(results);
      expect(combined.ok).toBe(false);
      expect((combined as { ok: false; error: Error }).error.message).toBe('second');
    });
  });

  describe('type guards', () => {
    it('isOk returns true for ok', () => {
      const result = ok(42);
      expect(isOk(result)).toBe(true);
      expect(isErr(result)).toBe(false);
    });

    it('isErr returns true for err', () => {
      const result = err(new Error('test'));
      expect(isErr(result)).toBe(true);
      expect(isOk(result)).toBe(false);
    });
  });
});
