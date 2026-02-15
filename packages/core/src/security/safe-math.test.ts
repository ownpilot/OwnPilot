import { describe, it, expect } from 'vitest';
import { evaluateMathExpression } from './safe-math.js';

/** Helper: assert numeric result with optional tolerance for floating point */
function expectNumber(result: number | Error, expected: number, tolerance = 0) {
  expect(result).not.toBeInstanceOf(Error);
  if (tolerance > 0) {
    expect(result as number).toBeCloseTo(expected, 5);
  } else {
    expect(result).toBe(expected);
  }
}

/** Helper: assert result is an Error */
function expectError(result: number | Error) {
  expect(result).toBeInstanceOf(Error);
}

describe('evaluateMathExpression', () => {
  describe('basic arithmetic', () => {
    it('adds two numbers', () => {
      expectNumber(evaluateMathExpression('2 + 3'), 5);
    });

    it('subtracts two numbers', () => {
      expectNumber(evaluateMathExpression('10 - 4'), 6);
    });

    it('multiplies two numbers', () => {
      expectNumber(evaluateMathExpression('6 * 7'), 42);
    });

    it('divides two numbers', () => {
      expectNumber(evaluateMathExpression('20 / 4'), 5);
    });

    it('computes modulo', () => {
      expectNumber(evaluateMathExpression('17 % 5'), 2);
    });

    it('handles decimal arithmetic', () => {
      expectNumber(evaluateMathExpression('1.5 + 2.5'), 4);
    });

    it('handles negative result from subtraction', () => {
      expectNumber(evaluateMathExpression('3 - 10'), -7);
    });

    it('handles chained addition and subtraction', () => {
      expectNumber(evaluateMathExpression('1 + 2 + 3 - 4'), 2);
    });

    it('handles chained multiplication and division', () => {
      expectNumber(evaluateMathExpression('2 * 3 * 4 / 6'), 4);
    });

    it('respects operator precedence (mul before add)', () => {
      expectNumber(evaluateMathExpression('2 + 3 * 4'), 14);
    });

    it('respects operator precedence (div before sub)', () => {
      expectNumber(evaluateMathExpression('10 - 6 / 3'), 8);
    });
  });

  describe('power operators', () => {
    it('computes power with ^ operator', () => {
      expectNumber(evaluateMathExpression('2 ^ 10'), 1024);
    });

    it('** literal in input is not supported (tokenizer consumes * individually)', () => {
      // The tokenizer checks single-char operators (including *) before **,
      // so '3 ** 3' tokenizes as 3, *, *, 3 which is invalid. Use ^ instead.
      const result = evaluateMathExpression('3 ** 3');
      expectError(result);
    });

    it('^ is the canonical power operator', () => {
      expectNumber(evaluateMathExpression('5 ^ 3'), 125);
    });

    it('power has higher precedence than multiplication', () => {
      // 2 * 3^2 = 2 * 9 = 18
      expectNumber(evaluateMathExpression('2 * 3 ^ 2'), 18);
    });

    it('power has higher precedence than addition', () => {
      // 1 + 2^3 = 1 + 8 = 9
      expectNumber(evaluateMathExpression('1 + 2 ^ 3'), 9);
    });

    it('computes fractional exponents', () => {
      // 4^0.5 = 2
      expectNumber(evaluateMathExpression('4 ^ 0.5'), 2);
    });

    it('computes 0^0 = 1 (Math.pow convention)', () => {
      expectNumber(evaluateMathExpression('0 ^ 0'), 1);
    });
  });

  describe('right-associative power', () => {
    it('2^3^2 = 2^(3^2) = 2^9 = 512', () => {
      expectNumber(evaluateMathExpression('2^3^2'), 512);
    });

    it('** literal in input fails (use ^ instead)', () => {
      // Same tokenizer limitation: ** is not recognized as a single token
      expectError(evaluateMathExpression('2**3**2'));
    });

    it('3^2^1 = 3^(2^1) = 3^2 = 9', () => {
      expectNumber(evaluateMathExpression('3^2^1'), 9);
    });
  });

  describe('unary operators', () => {
    it('unary minus negates a number', () => {
      expectNumber(evaluateMathExpression('-5'), -5);
    });

    it('unary plus is a no-op', () => {
      expectNumber(evaluateMathExpression('+5'), 5);
    });

    it('double unary minus is not supported (grammar allows one unary)', () => {
      // The grammar only allows a single unary before power: unary = ('-'|'+')? power
      // So '--5' fails. Use -(-5) instead for double negation.
      expectError(evaluateMathExpression('--5'));
    });

    it('double negation via parentheses works', () => {
      expectNumber(evaluateMathExpression('-(-5)'), 5);
    });

    it('unary minus with expression', () => {
      expectNumber(evaluateMathExpression('-3 + 7'), 4);
    });

    it('unary minus applied to parenthesized expression', () => {
      expectNumber(evaluateMathExpression('-(3 + 2)'), -5);
    });

    it('unary minus interacts correctly with power', () => {
      // -2^2: unary applies to power, so -(2^2) = -4
      expectNumber(evaluateMathExpression('-2^2'), -4);
    });

    it('multiplication by unary negative', () => {
      expectNumber(evaluateMathExpression('3 * -2'), -6);
    });
  });

  describe('parentheses and nesting', () => {
    it('overrides precedence with parentheses', () => {
      expectNumber(evaluateMathExpression('(2 + 3) * 4'), 20);
    });

    it('handles nested parentheses', () => {
      expectNumber(evaluateMathExpression('((2 + 3) * (4 - 1))'), 15);
    });

    it('handles deeply nested parentheses', () => {
      expectNumber(evaluateMathExpression('(((1 + 2)))'), 3);
    });

    it('complex nested expression', () => {
      // (2 + 3) * (10 / (4 + 1)) = 5 * 2 = 10
      expectNumber(evaluateMathExpression('(2 + 3) * (10 / (4 + 1))'), 10);
    });
  });

  describe('math functions', () => {
    it('sqrt(9) = 3', () => {
      expectNumber(evaluateMathExpression('sqrt(9)'), 3);
    });

    it('sqrt(2) returns irrational number', () => {
      const result = evaluateMathExpression('sqrt(2)');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(Math.SQRT2, 10);
    });

    it('abs(-5) = 5', () => {
      expectNumber(evaluateMathExpression('abs(-5)'), 5);
    });

    it('abs(5) = 5', () => {
      expectNumber(evaluateMathExpression('abs(5)'), 5);
    });

    it('min(1, 5, 3) = 1', () => {
      expectNumber(evaluateMathExpression('min(1, 5, 3)'), 1);
    });

    it('max(1, 5, 3) = 5', () => {
      expectNumber(evaluateMathExpression('max(1, 5, 3)'), 5);
    });

    it('min with two arguments', () => {
      expectNumber(evaluateMathExpression('min(10, 2)'), 2);
    });

    it('max with two arguments', () => {
      expectNumber(evaluateMathExpression('max(10, 2)'), 10);
    });

    it('ceil(2.3) = 3', () => {
      expectNumber(evaluateMathExpression('ceil(2.3)'), 3);
    });

    it('floor(2.9) = 2', () => {
      expectNumber(evaluateMathExpression('floor(2.9)'), 2);
    });

    it('round(2.5) = 3', () => {
      expectNumber(evaluateMathExpression('round(2.5)'), 3);
    });

    it('round(2.4) = 2', () => {
      expectNumber(evaluateMathExpression('round(2.4)'), 2);
    });

    it('log(1) = 0 (natural log)', () => {
      expectNumber(evaluateMathExpression('log(1)'), 0);
    });

    it('log(e) = 1', () => {
      const result = evaluateMathExpression('log(e)');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(1, 10);
    });

    it('log10(100) = 2', () => {
      expectNumber(evaluateMathExpression('log10(100)'), 2);
    });

    it('log2(8) = 3', () => {
      expectNumber(evaluateMathExpression('log2(8)'), 3);
    });

    it('exp(0) = 1', () => {
      expectNumber(evaluateMathExpression('exp(0)'), 1);
    });

    it('exp(1) = e', () => {
      const result = evaluateMathExpression('exp(1)');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(Math.E, 10);
    });

    it('pow(2, 10) = 1024', () => {
      expectNumber(evaluateMathExpression('pow(2, 10)'), 1024);
    });

    it('functions can be nested: sqrt(abs(-16)) = 4', () => {
      expectNumber(evaluateMathExpression('sqrt(abs(-16))'), 4);
    });

    it('functions with arithmetic arguments: sqrt(3 + 6) = 3', () => {
      expectNumber(evaluateMathExpression('sqrt(3 + 6)'), 3);
    });

    it('function result used in arithmetic: sqrt(9) + 1 = 4', () => {
      expectNumber(evaluateMathExpression('sqrt(9) + 1'), 4);
    });

    it('multiple function calls: min(3, 5) + max(1, 2) = 5', () => {
      expectNumber(evaluateMathExpression('min(3, 5) + max(1, 2)'), 5);
    });
  });

  describe('trigonometric functions', () => {
    it('sin(0) = 0', () => {
      expectNumber(evaluateMathExpression('sin(0)'), 0);
    });

    it('cos(0) = 1', () => {
      expectNumber(evaluateMathExpression('cos(0)'), 1);
    });

    it('tan(0) = 0', () => {
      expectNumber(evaluateMathExpression('tan(0)'), 0);
    });

    it('sin(pi/2) is approximately 1', () => {
      const result = evaluateMathExpression('sin(pi / 2)');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(1, 10);
    });

    it('cos(pi) is approximately -1', () => {
      const result = evaluateMathExpression('cos(pi)');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(-1, 10);
    });

    it('asin(0) = 0', () => {
      expectNumber(evaluateMathExpression('asin(0)'), 0);
    });

    it('acos(1) = 0', () => {
      expectNumber(evaluateMathExpression('acos(1)'), 0);
    });

    it('atan(0) = 0', () => {
      expectNumber(evaluateMathExpression('atan(0)'), 0);
    });
  });

  describe('constants', () => {
    it('pi is approximately 3.14159', () => {
      const result = evaluateMathExpression('pi');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(Math.PI, 5);
    });

    it('PI is the same as pi', () => {
      const r1 = evaluateMathExpression('pi');
      const r2 = evaluateMathExpression('PI');
      expect(r1).toBe(r2);
    });

    it('e is approximately 2.71828', () => {
      const result = evaluateMathExpression('e');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(Math.E, 5);
    });

    it('E is the same as e', () => {
      const r1 = evaluateMathExpression('e');
      const r2 = evaluateMathExpression('E');
      expect(r1).toBe(r2);
    });

    it('Infinity constant is recognized', () => {
      const result = evaluateMathExpression('Infinity');
      expect(result).toBe(Infinity);
    });

    it('constants in expressions: 2 * pi', () => {
      const result = evaluateMathExpression('2 * pi');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(2 * Math.PI, 10);
    });

    it('e^1 = e', () => {
      const result = evaluateMathExpression('e ^ 1');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(Math.E, 10);
    });
  });

  describe('scientific notation', () => {
    it('1e3 = 1000', () => {
      expectNumber(evaluateMathExpression('1e3'), 1000);
    });

    it('1.5e-2 = 0.015', () => {
      expectNumber(evaluateMathExpression('1.5e-2'), 0.015);
    });

    it('2.5e+4 = 25000', () => {
      expectNumber(evaluateMathExpression('2.5e+4'), 25000);
    });

    it('1E3 = 1000 (uppercase E)', () => {
      expectNumber(evaluateMathExpression('1E3'), 1000);
    });

    it('scientific notation in arithmetic: 1e3 + 500 = 1500', () => {
      expectNumber(evaluateMathExpression('1e3 + 500'), 1500);
    });

    it('5e0 = 5', () => {
      expectNumber(evaluateMathExpression('5e0'), 5);
    });
  });

  describe('error: empty or too-long expression', () => {
    it('returns Error for empty string', () => {
      expectError(evaluateMathExpression(''));
    });

    it('returns Error for expression over 1000 characters', () => {
      const longExpr = '1+'.repeat(501) + '1'; // > 1000 chars
      expectError(evaluateMathExpression(longExpr));
    });

    it('accepts expression exactly at 1000 characters', () => {
      // Build a valid expression that is exactly 1000 chars
      // '1+' repeated 499 times = 998 chars, + '10' = 1000
      const expr = '1+'.repeat(499) + '10';
      expect(expr.length).toBe(1000);
      const result = evaluateMathExpression(expr);
      expect(result).not.toBeInstanceOf(Error);
    });
  });

  describe('error: invalid characters', () => {
    it('returns Error for letters that are not identifiers', () => {
      // The tokenizer handles identifiers, but unknown identifiers cause parser error
      expectError(evaluateMathExpression('xyz'));
    });

    it('returns Error for special characters like @', () => {
      expectError(evaluateMathExpression('2 @ 3'));
    });

    it('returns Error for semicolons', () => {
      expectError(evaluateMathExpression('1; 2'));
    });

    it('returns Error for brackets', () => {
      expectError(evaluateMathExpression('[1, 2]'));
    });

    it('returns Error for curly braces', () => {
      expectError(evaluateMathExpression('{1}'));
    });

    it('returns Error for assignment operators', () => {
      expectError(evaluateMathExpression('x = 5'));
    });

    it('returns Error for string literals', () => {
      expectError(evaluateMathExpression('"hello"'));
    });
  });

  describe('error: unknown function', () => {
    it('returns Error for unknown function name', () => {
      expectError(evaluateMathExpression('foo(42)'));
    });

    it('returns Error for eval (no code execution)', () => {
      expectError(evaluateMathExpression('eval("1+1")'));
    });

    it('returns Error for parseInt', () => {
      expectError(evaluateMathExpression('parseInt("42")'));
    });
  });

  describe('error: mismatched parentheses', () => {
    it('returns Error for missing closing paren', () => {
      expectError(evaluateMathExpression('(1 + 2'));
    });

    it('returns Error for missing opening paren', () => {
      expectError(evaluateMathExpression('1 + 2)'));
    });

    it('returns Error for extra closing paren', () => {
      expectError(evaluateMathExpression('(1 + 2))'));
    });

    it('returns Error for missing closing paren on function', () => {
      expectError(evaluateMathExpression('sqrt(9'));
    });
  });

  describe('division by zero and NaN', () => {
    it('1/0 returns Infinity', () => {
      const result = evaluateMathExpression('1 / 0');
      expect(result).toBe(Infinity);
    });

    it('-1/0 returns -Infinity', () => {
      const result = evaluateMathExpression('-1 / 0');
      expect(result).toBe(-Infinity);
    });

    it('0/0 returns Error (NaN is not finite)', () => {
      expectError(evaluateMathExpression('0 / 0'));
    });

    it('sqrt(-1) returns Error (NaN)', () => {
      expectError(evaluateMathExpression('sqrt(-1)'));
    });

    it('log(-1) returns Error (NaN)', () => {
      expectError(evaluateMathExpression('log(-1)'));
    });

    it('asin(2) returns Error (NaN, domain error)', () => {
      expectError(evaluateMathExpression('asin(2)'));
    });
  });

  describe('whitespace handling', () => {
    it('ignores leading whitespace', () => {
      expectNumber(evaluateMathExpression('   2 + 3'), 5);
    });

    it('ignores trailing whitespace', () => {
      expectNumber(evaluateMathExpression('2 + 3   '), 5);
    });

    it('ignores extra whitespace between tokens', () => {
      expectNumber(evaluateMathExpression('2   +   3'), 5);
    });

    it('handles tabs', () => {
      expectNumber(evaluateMathExpression('2\t+\t3'), 5);
    });

    it('handles no whitespace', () => {
      expectNumber(evaluateMathExpression('2+3*4'), 14);
    });

    it('handles whitespace inside function args', () => {
      expectNumber(evaluateMathExpression('min( 1 , 5 , 3 )'), 1);
    });
  });

  describe('complex expressions', () => {
    it('quadratic formula component: sqrt(b^2 - 4*a*c)', () => {
      // b=5, a=1, c=6: sqrt(25-24) = 1
      expectNumber(evaluateMathExpression('sqrt(5^2 - 4*1*6)'), 1);
    });

    it('Pythagorean theorem: sqrt(3^2 + 4^2) = 5', () => {
      expectNumber(evaluateMathExpression('sqrt(3^2 + 4^2)'), 5);
    });

    it('compound interest factor: (1 + 0.05)^10', () => {
      const result = evaluateMathExpression('(1 + 0.05)^10');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(Math.pow(1.05, 10), 10);
    });

    it('circle area: pi * 5^2', () => {
      const result = evaluateMathExpression('pi * 5^2');
      expect(result).not.toBeInstanceOf(Error);
      expect(result as number).toBeCloseTo(Math.PI * 25, 10);
    });

    it('nested functions: max(sqrt(16), min(10, 3))', () => {
      // sqrt(16)=4, min(10,3)=3 => max(4,3)=4
      expectNumber(evaluateMathExpression('max(sqrt(16), min(10, 3))'), 4);
    });

    it('abs of complex expression: abs(-3 * 4 + 2)', () => {
      // -3*4+2 = -10
      expectNumber(evaluateMathExpression('abs(-3 * 4 + 2)'), 10);
    });
  });
});
