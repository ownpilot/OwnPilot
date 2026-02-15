/**
 * Safe math expression evaluator
 *
 * Replaces `new Function()` usage with a recursive-descent parser
 * that only allows arithmetic, basic math functions, and constants.
 * No code execution surface — no eval, no Function constructor.
 */

type Token = { type: 'number'; value: number }
  | { type: 'op'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma'; value: ',' }
  | { type: 'ident'; value: string };

const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const MATH_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
  Infinity: Infinity,
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i]!;

    // Skip whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Numbers (including decimals)
    if (/[\d.]/.test(ch)) {
      let num = '';
      while (i < expr.length && /[\d.eE]/.test(expr[i]!)) {
        // Handle scientific notation: 1e5, 1E-3
        if ((expr[i] === 'e' || expr[i] === 'E') && i + 1 < expr.length && /[\d+\-]/.test(expr[i + 1]!)) {
          num += expr[i]!;
          i++;
          if (expr[i] === '+' || expr[i] === '-') {
            num += expr[i]!;
            i++;
          }
        } else if (expr[i] === 'e' || expr[i] === 'E') {
          break; // standalone 'e' is Euler's number, not scientific notation
        } else {
          num += expr[i]!;
          i++;
        }
      }
      const parsed = parseFloat(num);
      if (isNaN(parsed)) return []; // invalid token stream signals error
      tokens.push({ type: 'number', value: parsed });
      continue;
    }

    // Identifiers (function names, constants)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i]!)) {
        ident += expr[i]!;
        i++;
      }
      tokens.push({ type: 'ident', value: ident });
      continue;
    }

    // Operators
    if ('+-*/%^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch === '^' ? '**' : ch });
      i++;
      continue;
    }

    // Double-star (**)
    if (ch === '*' && i + 1 < expr.length && expr[i + 1] === '*') {
      tokens.push({ type: 'op', value: '**' });
      i += 2;
      continue;
    }

    // Parentheses
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
      continue;
    }

    // Comma (for multi-arg functions like min, max, pow)
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',' });
      i++;
      continue;
    }

    // Unknown character
    return [];
  }

  return tokens;
}

/**
 * Recursive-descent parser for math expressions.
 *
 * Grammar:
 *   expr     = term (('+' | '-') term)*
 *   term     = unary (('*' | '/' | '%') unary)*
 *   unary    = ('-' | '+')? power
 *   power    = primary ('**' power)?   (right-associative)
 *   primary  = NUMBER | IDENT '(' args ')' | IDENT | '(' expr ')'
 *   args     = expr (',' expr)*
 */
class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  parse(): number {
    const result = this.expr();
    if (this.pos < this.tokens.length) {
      throw new Error('Unexpected token after expression');
    }
    return result;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eat(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new Error('Unexpected end of expression');
    this.pos++;
    return t;
  }

  private expr(): number {
    let left = this.term();
    while (this.peek()?.type === 'op' && (this.peek()!.value === '+' || this.peek()!.value === '-')) {
      const op = this.eat().value;
      const right = this.term();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private term(): number {
    let left = this.unary();
    while (this.peek()?.type === 'op' && (this.peek()!.value === '*' || this.peek()!.value === '/' || this.peek()!.value === '%')) {
      const op = this.eat().value;
      const right = this.unary();
      if (op === '*') left = left * right;
      else if (op === '/') left = left / right;
      else left = left % right;
    }
    return left;
  }

  private unary(): number {
    if (this.peek()?.type === 'op' && this.peek()!.value === '-') {
      this.eat();
      return -this.power();
    }
    if (this.peek()?.type === 'op' && this.peek()!.value === '+') {
      this.eat();
      return this.power();
    }
    return this.power();
  }

  private power(): number {
    const base = this.primary();
    if (this.peek()?.type === 'op' && this.peek()!.value === '**') {
      this.eat();
      const exp = this.unary(); // right-associative: 2^3^2 = 2^(3^2)
      return Math.pow(base, exp);
    }
    return base;
  }

  private primary(): number {
    const token = this.peek();
    if (!token) throw new Error('Unexpected end of expression');

    // Number literal
    if (token.type === 'number') {
      this.eat();
      return token.value;
    }

    // Identifier: constant or function call
    if (token.type === 'ident') {
      this.eat();
      const name = token.value;

      // Function call: name(args)
      if (this.peek()?.type === 'paren' && this.peek()!.value === '(') {
        this.eat(); // consume '('
        const fn = MATH_FUNCTIONS[name];
        if (!fn) throw new Error(`Unknown function: ${name}`);

        const args: number[] = [];
        if (this.peek()?.type !== 'paren' || this.peek()!.value !== ')') {
          args.push(this.expr());
          while (this.peek()?.type === 'comma') {
            this.eat(); // consume ','
            args.push(this.expr());
          }
        }

        if (this.peek()?.type !== 'paren' || this.peek()!.value !== ')') {
          throw new Error(`Expected closing parenthesis for ${name}()`);
        }
        this.eat(); // consume ')'

        return fn(...args);
      }

      // Constant
      const constVal = MATH_CONSTANTS[name];
      if (constVal !== undefined) return constVal;

      throw new Error(`Unknown identifier: ${name}`);
    }

    // Parenthesized expression
    if (token.type === 'paren' && token.value === '(') {
      this.eat(); // consume '('
      const result = this.expr();
      if (this.peek()?.type !== 'paren' || this.peek()!.value !== ')') {
        throw new Error('Expected closing parenthesis');
      }
      this.eat(); // consume ')'
      return result;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
  }
}

/**
 * Safely evaluate a math expression.
 * Returns the numeric result or an Error.
 *
 * Supports: +, -, *, /, %, ^ (power), parentheses, unary minus,
 * functions (sqrt, sin, cos, tan, asin, acos, atan, abs, ceil, floor,
 * round, log, log10, log2, exp, min, max, pow), constants (pi, e).
 *
 * Does NOT use eval, new Function, or any code execution.
 */
export function evaluateMathExpression(expression: string): number | Error {
  if (!expression || expression.length > 1000) {
    return new Error('Expression is empty or too long (max 1000 chars)');
  }

  try {
    const tokens = tokenize(expression);
    if (tokens.length === 0) {
      return new Error('Invalid characters in expression');
    }
    const parser = new Parser(tokens);
    const result = parser.parse();

    if (typeof result !== 'number' || !Number.isFinite(result)) {
      if (result === Infinity || result === -Infinity) {
        return result; // allow Infinity as a valid result
      }
      return new Error('Expression must evaluate to a finite number');
    }

    return result;
  } catch (err) {
    return err instanceof Error ? err : new Error('Invalid expression');
  }
}
