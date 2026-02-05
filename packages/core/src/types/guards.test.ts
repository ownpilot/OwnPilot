import { describe, it, expect } from 'vitest';
import {
  isObject,
  isString,
  isNonEmptyString,
  isNumber,
  isPositiveInteger,
  isNonNegativeInteger,
  isBoolean,
  isArray,
  isStringArray,
  isDate,
  isISODateString,
  isNull,
  isUndefined,
  isNullish,
  isFunction,
  hasProperty,
  hasProperties,
  isUUID,
  isEmail,
  isURL,
  isSemver,
  assert,
  assertDefined,
} from './guards.js';

// ===========================================================================
// isObject
// ===========================================================================

describe('isObject', () => {
  it('returns true for empty object literal', () => {
    expect(isObject({})).toBe(true);
  });

  it('returns true for object with properties', () => {
    expect(isObject({ a: 1, b: 'hello' })).toBe(true);
  });

  it('returns true for Object.create(null)', () => {
    expect(isObject(Object.create(null))).toBe(true);
  });

  it('returns false for null', () => {
    expect(isObject(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isObject([])).toBe(false);
    expect(isObject([1, 2, 3])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isObject(42)).toBe(false);
    expect(isObject('string')).toBe(false);
    expect(isObject(true)).toBe(false);
    expect(isObject(undefined)).toBe(false);
    expect(isObject(Symbol('s'))).toBe(false);
  });

  it('returns false for functions', () => {
    expect(isObject(() => {})).toBe(false);
    expect(isObject(function named() {})).toBe(false);
  });

  it('returns true for class instances', () => {
    class Foo {}
    expect(isObject(new Foo())).toBe(true);
  });

  it('returns true for Date instances (they are objects)', () => {
    // Dates are objects and not arrays, so isObject returns true
    expect(isObject(new Date())).toBe(true);
  });
});

// ===========================================================================
// isString
// ===========================================================================

describe('isString', () => {
  it('returns true for empty string', () => {
    expect(isString('')).toBe(true);
  });

  it('returns true for non-empty string', () => {
    expect(isString('hello')).toBe(true);
  });

  it('returns true for template literal string', () => {
    expect(isString(`template ${1 + 1}`)).toBe(true);
  });

  it('returns false for number', () => {
    expect(isString(0)).toBe(false);
    expect(isString(42)).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
  });

  it('returns false for object', () => {
    expect(isString({})).toBe(false);
  });

  it('returns false for boolean', () => {
    expect(isString(true)).toBe(false);
  });
});

// ===========================================================================
// isNonEmptyString
// ===========================================================================

describe('isNonEmptyString', () => {
  it('returns true for non-empty string', () => {
    expect(isNonEmptyString('hello')).toBe(true);
  });

  it('returns true for single character string', () => {
    expect(isNonEmptyString('a')).toBe(true);
  });

  it('returns true for whitespace-only string (length > 0)', () => {
    expect(isNonEmptyString(' ')).toBe(true);
    expect(isNonEmptyString('\t')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('returns false for number 0', () => {
    expect(isNonEmptyString(0)).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
  });

  it('returns false for non-string types', () => {
    expect(isNonEmptyString(42)).toBe(false);
    expect(isNonEmptyString(true)).toBe(false);
    expect(isNonEmptyString({})).toBe(false);
    expect(isNonEmptyString([])).toBe(false);
  });
});

// ===========================================================================
// isNumber
// ===========================================================================

describe('isNumber', () => {
  it('returns true for 0', () => {
    expect(isNumber(0)).toBe(true);
  });

  it('returns true for positive integer', () => {
    expect(isNumber(1)).toBe(true);
    expect(isNumber(100)).toBe(true);
  });

  it('returns true for negative integer', () => {
    expect(isNumber(-1)).toBe(true);
    expect(isNumber(-999)).toBe(true);
  });

  it('returns true for floating point', () => {
    expect(isNumber(1.5)).toBe(true);
    expect(isNumber(-0.001)).toBe(true);
  });

  it('returns true for Infinity', () => {
    expect(isNumber(Infinity)).toBe(true);
    expect(isNumber(-Infinity)).toBe(true);
  });

  it('returns false for NaN', () => {
    expect(isNumber(NaN)).toBe(false);
  });

  it('returns false for string representation of number', () => {
    expect(isNumber('1')).toBe(false);
    expect(isNumber('0')).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isNumber(null)).toBe(false);
    expect(isNumber(undefined)).toBe(false);
  });

  it('returns false for boolean', () => {
    expect(isNumber(true)).toBe(false);
    expect(isNumber(false)).toBe(false);
  });
});

// ===========================================================================
// isPositiveInteger
// ===========================================================================

describe('isPositiveInteger', () => {
  it('returns true for 1', () => {
    expect(isPositiveInteger(1)).toBe(true);
  });

  it('returns true for large positive integer', () => {
    expect(isPositiveInteger(100)).toBe(true);
    expect(isPositiveInteger(999999)).toBe(true);
  });

  it('returns false for 0', () => {
    expect(isPositiveInteger(0)).toBe(false);
  });

  it('returns false for negative integers', () => {
    expect(isPositiveInteger(-1)).toBe(false);
    expect(isPositiveInteger(-100)).toBe(false);
  });

  it('returns false for floating point numbers', () => {
    expect(isPositiveInteger(1.5)).toBe(false);
    expect(isPositiveInteger(0.1)).toBe(false);
  });

  it('returns false for NaN', () => {
    expect(isPositiveInteger(NaN)).toBe(false);
  });

  it('returns false for Infinity', () => {
    expect(isPositiveInteger(Infinity)).toBe(false);
  });

  it('returns false for non-number types', () => {
    expect(isPositiveInteger('1')).toBe(false);
    expect(isPositiveInteger(null)).toBe(false);
    expect(isPositiveInteger(undefined)).toBe(false);
  });
});

// ===========================================================================
// isNonNegativeInteger
// ===========================================================================

describe('isNonNegativeInteger', () => {
  it('returns true for 0', () => {
    expect(isNonNegativeInteger(0)).toBe(true);
  });

  it('returns true for positive integers', () => {
    expect(isNonNegativeInteger(1)).toBe(true);
    expect(isNonNegativeInteger(42)).toBe(true);
  });

  it('returns false for negative integers', () => {
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(-100)).toBe(false);
  });

  it('returns false for floating point numbers', () => {
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeInteger(0.1)).toBe(false);
  });

  it('returns false for NaN and Infinity', () => {
    expect(isNonNegativeInteger(NaN)).toBe(false);
    expect(isNonNegativeInteger(Infinity)).toBe(false);
  });

  it('returns false for non-number types', () => {
    expect(isNonNegativeInteger('0')).toBe(false);
    expect(isNonNegativeInteger(null)).toBe(false);
  });
});

// ===========================================================================
// isBoolean
// ===========================================================================

describe('isBoolean', () => {
  it('returns true for true', () => {
    expect(isBoolean(true)).toBe(true);
  });

  it('returns true for false', () => {
    expect(isBoolean(false)).toBe(true);
  });

  it('returns false for 0 and 1 (truthy/falsy numbers)', () => {
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean(1)).toBe(false);
  });

  it('returns false for string "true" and "false"', () => {
    expect(isBoolean('true')).toBe(false);
    expect(isBoolean('false')).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isBoolean(null)).toBe(false);
    expect(isBoolean(undefined)).toBe(false);
  });

  it('returns false for objects', () => {
    expect(isBoolean({})).toBe(false);
    expect(isBoolean([])).toBe(false);
  });
});

// ===========================================================================
// isArray
// ===========================================================================

describe('isArray', () => {
  it('returns true for empty array', () => {
    expect(isArray([])).toBe(true);
  });

  it('returns true for array with elements', () => {
    expect(isArray([1, 2, 3])).toBe(true);
    expect(isArray(['a', 'b'])).toBe(true);
  });

  it('returns true for mixed-type array', () => {
    expect(isArray([1, 'a', null, undefined])).toBe(true);
  });

  it('returns false for object', () => {
    expect(isArray({})).toBe(false);
    expect(isArray({ length: 3 })).toBe(false);
  });

  it('returns false for string "array"', () => {
    expect(isArray('array')).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isArray(null)).toBe(false);
    expect(isArray(undefined)).toBe(false);
  });

  it('returns false for arguments-like objects', () => {
    expect(isArray({ 0: 'a', 1: 'b', length: 2 })).toBe(false);
  });
});

// ===========================================================================
// isStringArray
// ===========================================================================

describe('isStringArray', () => {
  it('returns true for array of strings', () => {
    expect(isStringArray(['a', 'b', 'c'])).toBe(true);
  });

  it('returns true for empty array', () => {
    expect(isStringArray([])).toBe(true);
  });

  it('returns true for single-element string array', () => {
    expect(isStringArray(['hello'])).toBe(true);
  });

  it('returns false for array of numbers', () => {
    expect(isStringArray([1, 2, 3])).toBe(false);
  });

  it('returns false for mixed array with strings and numbers', () => {
    expect(isStringArray(['a', 1])).toBe(false);
  });

  it('returns false for mixed array with strings and null', () => {
    expect(isStringArray(['a', null])).toBe(false);
  });

  it('returns false for non-array', () => {
    expect(isStringArray('not-array')).toBe(false);
    expect(isStringArray({})).toBe(false);
    expect(isStringArray(null)).toBe(false);
  });

  it('returns true for array containing empty strings', () => {
    expect(isStringArray(['', ''])).toBe(true);
  });
});

// ===========================================================================
// isDate
// ===========================================================================

describe('isDate', () => {
  it('returns true for new Date()', () => {
    expect(isDate(new Date())).toBe(true);
  });

  it('returns true for specific date', () => {
    expect(isDate(new Date('2025-01-01'))).toBe(true);
  });

  it('returns false for invalid date (new Date("invalid"))', () => {
    expect(isDate(new Date('invalid'))).toBe(false);
  });

  it('returns false for Date.now() (returns number)', () => {
    expect(isDate(Date.now())).toBe(false);
  });

  it('returns false for ISO date string', () => {
    expect(isDate('2024-01-01T00:00:00.000Z')).toBe(false);
  });

  it('returns false for number timestamp', () => {
    expect(isDate(1704067200000)).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isDate(null)).toBe(false);
    expect(isDate(undefined)).toBe(false);
  });
});

// ===========================================================================
// isISODateString
// ===========================================================================

describe('isISODateString', () => {
  it('returns true for full ISO 8601 string', () => {
    expect(isISODateString('2024-01-01T00:00:00.000Z')).toBe(true);
  });

  it('returns true for another valid ISO string', () => {
    expect(isISODateString('2025-06-15T12:30:45.123Z')).toBe(true);
  });

  it('returns false for date-only string (not full ISO)', () => {
    // '2024-01-01' parses to a valid date but Date.toISOString() !== '2024-01-01'
    expect(isISODateString('2024-01-01')).toBe(false);
  });

  it('returns false for "not a date"', () => {
    expect(isISODateString('not a date')).toBe(false);
  });

  it('returns false for invalid month', () => {
    expect(isISODateString('2024-13-01T00:00:00.000Z')).toBe(false);
  });

  it('returns false for number', () => {
    expect(isISODateString(1704067200000)).toBe(false);
  });

  it('returns false for Date object', () => {
    expect(isISODateString(new Date())).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isISODateString('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isISODateString(null)).toBe(false);
  });

  it('returns false for ISO string without Z suffix', () => {
    // '2024-01-01T00:00:00.000' without Z won't round-trip through toISOString()
    expect(isISODateString('2024-01-01T00:00:00.000')).toBe(false);
  });
});

// ===========================================================================
// isNull
// ===========================================================================

describe('isNull', () => {
  it('returns true for null', () => {
    expect(isNull(null)).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(isNull(undefined)).toBe(false);
  });

  it('returns false for 0', () => {
    expect(isNull(0)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isNull('')).toBe(false);
  });

  it('returns false for false', () => {
    expect(isNull(false)).toBe(false);
  });
});

// ===========================================================================
// isUndefined
// ===========================================================================

describe('isUndefined', () => {
  it('returns true for undefined', () => {
    expect(isUndefined(undefined)).toBe(true);
  });

  it('returns true for void 0', () => {
    expect(isUndefined(void 0)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isUndefined(null)).toBe(false);
  });

  it('returns false for 0', () => {
    expect(isUndefined(0)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isUndefined('')).toBe(false);
  });

  it('returns false for false', () => {
    expect(isUndefined(false)).toBe(false);
  });
});

// ===========================================================================
// isNullish
// ===========================================================================

describe('isNullish', () => {
  it('returns true for null', () => {
    expect(isNullish(null)).toBe(true);
  });

  it('returns true for undefined', () => {
    expect(isNullish(undefined)).toBe(true);
  });

  it('returns false for 0', () => {
    expect(isNullish(0)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isNullish('')).toBe(false);
  });

  it('returns false for false', () => {
    expect(isNullish(false)).toBe(false);
  });

  it('returns false for NaN', () => {
    expect(isNullish(NaN)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isNullish({})).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(isNullish([])).toBe(false);
  });
});

// ===========================================================================
// isFunction
// ===========================================================================

describe('isFunction', () => {
  it('returns true for arrow function', () => {
    expect(isFunction(() => {})).toBe(true);
  });

  it('returns true for function declaration', () => {
    function foo() {}
    expect(isFunction(foo)).toBe(true);
  });

  it('returns true for async function', () => {
    expect(isFunction(async () => {})).toBe(true);
  });

  it('returns true for class constructor', () => {
    class Foo {}
    expect(isFunction(Foo)).toBe(true);
  });

  it('returns true for built-in functions', () => {
    expect(isFunction(parseInt)).toBe(true);
    expect(isFunction(Array.isArray)).toBe(true);
  });

  it('returns false for object', () => {
    expect(isFunction({})).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isFunction(null)).toBe(false);
    expect(isFunction(undefined)).toBe(false);
  });

  it('returns false for string and number', () => {
    expect(isFunction('function')).toBe(false);
    expect(isFunction(42)).toBe(false);
  });
});

// ===========================================================================
// hasProperty
// ===========================================================================

describe('hasProperty', () => {
  it('returns true when key exists on object', () => {
    expect(hasProperty({ name: 'test' }, 'name')).toBe(true);
  });

  it('returns true when key exists with undefined value', () => {
    expect(hasProperty({ key: undefined }, 'key')).toBe(true);
  });

  it('returns true when key exists with null value', () => {
    expect(hasProperty({ key: null }, 'key')).toBe(true);
  });

  it('returns false when key is missing', () => {
    expect(hasProperty({ a: 1 }, 'b')).toBe(false);
  });

  it('returns false for non-object (null)', () => {
    expect(hasProperty(null, 'key')).toBe(false);
  });

  it('returns false for non-object (array)', () => {
    expect(hasProperty([1, 2], '0')).toBe(false);
  });

  it('returns false for non-object (string)', () => {
    expect(hasProperty('hello', 'length')).toBe(false);
  });

  it('returns false for non-object (number)', () => {
    expect(hasProperty(42, 'toString')).toBe(false);
  });

  it('checks inherited properties via in operator', () => {
    const parent = { inherited: true };
    const child = Object.create(parent);
    child.own = true;
    expect(hasProperty(child, 'inherited')).toBe(true);
    expect(hasProperty(child, 'own')).toBe(true);
  });
});

// ===========================================================================
// hasProperties
// ===========================================================================

describe('hasProperties', () => {
  it('returns true when all keys exist', () => {
    expect(hasProperties({ a: 1, b: 2, c: 3 }, ['a', 'b', 'c'])).toBe(true);
  });

  it('returns true when object has extra keys beyond required', () => {
    expect(hasProperties({ a: 1, b: 2, extra: 3 }, ['a', 'b'])).toBe(true);
  });

  it('returns true for empty keys array', () => {
    expect(hasProperties({}, [])).toBe(true);
    expect(hasProperties({ a: 1 }, [])).toBe(true);
  });

  it('returns false when any key is missing', () => {
    expect(hasProperties({ a: 1 }, ['a', 'b'])).toBe(false);
  });

  it('returns false when all keys are missing', () => {
    expect(hasProperties({}, ['a', 'b'])).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(hasProperties(null, ['a'])).toBe(false);
    expect(hasProperties('str', ['length'])).toBe(false);
    expect(hasProperties(42, ['toString'])).toBe(false);
  });
});

// ===========================================================================
// isUUID
// ===========================================================================

describe('isUUID', () => {
  it('returns true for valid v4 UUID (lowercase)', () => {
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('returns true for valid UUID (uppercase)', () => {
    expect(isUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('returns true for valid UUID (mixed case)', () => {
    expect(isUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
  });

  it('returns true for all-zeros UUID', () => {
    expect(isUUID('00000000-0000-0000-0000-000000000000')).toBe(true);
  });

  it('returns false for string without hyphens', () => {
    expect(isUUID('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('returns false for too-short string', () => {
    expect(isUUID('550e8400-e29b-41d4-a716')).toBe(false);
  });

  it('returns false for non-hex characters', () => {
    expect(isUUID('550e8400-e29b-41d4-a716-44665544zzzz')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isUUID('')).toBe(false);
  });

  it('returns false for non-string types', () => {
    expect(isUUID(null)).toBe(false);
    expect(isUUID(undefined)).toBe(false);
    expect(isUUID(12345)).toBe(false);
  });

  it('returns false for UUID with extra characters', () => {
    expect(isUUID('{550e8400-e29b-41d4-a716-446655440000}')).toBe(false);
  });
});

// ===========================================================================
// isEmail
// ===========================================================================

describe('isEmail', () => {
  it('returns true for standard email', () => {
    expect(isEmail('user@example.com')).toBe(true);
  });

  it('returns true for email with dots in local part', () => {
    expect(isEmail('first.last@example.com')).toBe(true);
  });

  it('returns true for email with subdomain', () => {
    expect(isEmail('user@mail.example.co.uk')).toBe(true);
  });

  it('returns true for email with plus addressing', () => {
    expect(isEmail('user+tag@example.com')).toBe(true);
  });

  it('returns false for "not-email"', () => {
    expect(isEmail('not-email')).toBe(false);
  });

  it('returns false for "@.com" (no local part)', () => {
    expect(isEmail('@.com')).toBe(false);
  });

  it('returns false for "user@" (no domain)', () => {
    expect(isEmail('user@')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isEmail('')).toBe(false);
  });

  it('returns false for email with spaces', () => {
    expect(isEmail('user @example.com')).toBe(false);
    expect(isEmail('user@ example.com')).toBe(false);
  });

  it('returns false for non-string types', () => {
    expect(isEmail(null)).toBe(false);
    expect(isEmail(undefined)).toBe(false);
    expect(isEmail(12345)).toBe(false);
  });
});

// ===========================================================================
// isURL
// ===========================================================================

describe('isURL', () => {
  it('returns true for https URL', () => {
    expect(isURL('https://example.com')).toBe(true);
  });

  it('returns true for http URL', () => {
    expect(isURL('http://example.com')).toBe(true);
  });

  it('returns true for http://localhost', () => {
    expect(isURL('http://localhost')).toBe(true);
  });

  it('returns true for URL with port', () => {
    expect(isURL('http://localhost:3000')).toBe(true);
  });

  it('returns true for URL with path', () => {
    expect(isURL('https://example.com/path/to/resource')).toBe(true);
  });

  it('returns true for URL with query parameters', () => {
    expect(isURL('https://example.com?q=test&page=1')).toBe(true);
  });

  it('returns true for ftp URL', () => {
    expect(isURL('ftp://files.example.com')).toBe(true);
  });

  it('returns false for "not-url"', () => {
    expect(isURL('not-url')).toBe(false);
  });

  it('returns false for plain domain without protocol', () => {
    expect(isURL('example.com')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isURL('')).toBe(false);
  });

  it('returns false for non-string types', () => {
    expect(isURL(null)).toBe(false);
    expect(isURL(undefined)).toBe(false);
    expect(isURL(12345)).toBe(false);
  });
});

// ===========================================================================
// isSemver
// ===========================================================================

describe('isSemver', () => {
  it('returns true for basic semver "1.0.0"', () => {
    expect(isSemver('1.0.0')).toBe(true);
  });

  it('returns true for "0.1.0"', () => {
    expect(isSemver('0.1.0')).toBe(true);
  });

  it('returns true for "0.0.1"', () => {
    expect(isSemver('0.0.1')).toBe(true);
  });

  it('returns true for large version numbers', () => {
    expect(isSemver('100.200.300')).toBe(true);
  });

  it('returns true for semver with prerelease tag', () => {
    expect(isSemver('1.0.0-alpha')).toBe(true);
    expect(isSemver('1.0.0-beta.1')).toBe(true);
    expect(isSemver('0.1.0-alpha')).toBe(true);
    expect(isSemver('1.0.0-rc.1')).toBe(true);
  });

  it('returns true for semver with build metadata', () => {
    expect(isSemver('1.0.0+build.123')).toBe(true);
    expect(isSemver('1.0.0+20250101')).toBe(true);
  });

  it('returns true for semver with prerelease and build metadata', () => {
    expect(isSemver('1.0.0-alpha+build.1')).toBe(true);
  });

  it('returns false for "1.0" (only two parts)', () => {
    expect(isSemver('1.0')).toBe(false);
  });

  it('returns false for "v1.0.0" (leading v)', () => {
    expect(isSemver('v1.0.0')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSemver('')).toBe(false);
  });

  it('returns false for random string', () => {
    expect(isSemver('not-semver')).toBe(false);
  });

  it('returns false for non-string types', () => {
    expect(isSemver(null)).toBe(false);
    expect(isSemver(undefined)).toBe(false);
    expect(isSemver(100)).toBe(false);
  });
});

// ===========================================================================
// assert
// ===========================================================================

describe('assert', () => {
  it('does not throw for truthy condition', () => {
    expect(() => assert(true)).not.toThrow();
    expect(() => assert(1)).not.toThrow();
    expect(() => assert('non-empty')).not.toThrow();
    expect(() => assert({})).not.toThrow();
    expect(() => assert([])).not.toThrow();
  });

  it('throws for false', () => {
    expect(() => assert(false)).toThrow();
  });

  it('throws for 0', () => {
    expect(() => assert(0)).toThrow();
  });

  it('throws for empty string', () => {
    expect(() => assert('')).toThrow();
  });

  it('throws for null', () => {
    expect(() => assert(null)).toThrow();
  });

  it('throws for undefined', () => {
    expect(() => assert(undefined)).toThrow();
  });

  it('throws with custom message when provided', () => {
    expect(() => assert(false, 'Custom error')).toThrow('Custom error');
  });

  it('throws with default message when no message provided', () => {
    expect(() => assert(false)).toThrow('Assertion failed');
  });

  it('throws an Error instance', () => {
    expect(() => assert(false)).toThrow(Error);
  });
});

// ===========================================================================
// assertDefined
// ===========================================================================

describe('assertDefined', () => {
  it('does not throw for defined values', () => {
    expect(() => assertDefined(0)).not.toThrow();
    expect(() => assertDefined('')).not.toThrow();
    expect(() => assertDefined(false)).not.toThrow();
    expect(() => assertDefined({})).not.toThrow();
    expect(() => assertDefined([])).not.toThrow();
    expect(() => assertDefined('hello')).not.toThrow();
    expect(() => assertDefined(42)).not.toThrow();
  });

  it('throws for null', () => {
    expect(() => assertDefined(null)).toThrow();
  });

  it('throws for undefined', () => {
    expect(() => assertDefined(undefined)).toThrow();
  });

  it('throws with custom message when provided', () => {
    expect(() => assertDefined(null, 'Value required')).toThrow('Value required');
  });

  it('throws with default message when no message provided', () => {
    expect(() => assertDefined(null)).toThrow('Value is null or undefined');
    expect(() => assertDefined(undefined)).toThrow('Value is null or undefined');
  });

  it('throws an Error instance', () => {
    expect(() => assertDefined(null)).toThrow(Error);
  });

  it('does not throw for NaN (it is defined, just not a valid number)', () => {
    expect(() => assertDefined(NaN)).not.toThrow();
  });
});
