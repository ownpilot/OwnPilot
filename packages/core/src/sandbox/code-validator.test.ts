import { describe, it, expect } from 'vitest';
import {
  DANGEROUS_CODE_PATTERNS,
  MAX_TOOL_CODE_SIZE,
  validateToolCode,
  findFirstDangerousPattern,
  analyzeToolCode,
  calculateSecurityScore,
} from './code-validator.js';

// =============================================================================
// DANGEROUS_CODE_PATTERNS
// =============================================================================

describe('DANGEROUS_CODE_PATTERNS', () => {
  it('is a readonly array with the expected pattern count', () => {
    expect(Array.isArray(DANGEROUS_CODE_PATTERNS)).toBe(true);
    // Updated count: original 26 - 2 removed (standalone constructor, broad global)
    //   + 1 refined (global.x), + 6 new (Symbol.unscopables, XMLHttpRequest,
    //     WebSocket, Object.defineProperty, WebAssembly)
    // = 26 - 1 (removed standalone constructor) + 5 new = 30
    expect(DANGEROUS_CODE_PATTERNS.length).toBeGreaterThanOrEqual(28);
  });

  it('each entry has a RegExp pattern and a string message', () => {
    for (const entry of DANGEROUS_CODE_PATTERNS) {
      expect(entry.pattern).toBeInstanceOf(RegExp);
      expect(typeof entry.message).toBe('string');
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });

  it('all messages end with "is not allowed" or contain "not allowed"', () => {
    for (const entry of DANGEROUS_CODE_PATTERNS) {
      expect(entry.message).toMatch(/is not allowed/);
    }
  });

  it('covers module system patterns (require, import)', () => {
    const messages = DANGEROUS_CODE_PATTERNS.map((p) => p.message);
    expect(messages).toContain('require() is not allowed');
    expect(messages).toContain('Dynamic import() is not allowed');
  });

  it('covers dynamic code execution patterns (eval, Function)', () => {
    const messages = DANGEROUS_CODE_PATTERNS.map((p) => p.message);
    expect(messages).toContain('eval() is not allowed');
    expect(messages).toContain('Function() constructor is not allowed');
    expect(messages).toContain('new Function() is not allowed');
  });

  it('covers process/system access patterns', () => {
    const messages = DANGEROUS_CODE_PATTERNS.map((p) => p.message);
    expect(messages).toContain('process object access is not allowed');
    expect(messages).toContain('child_process module is not allowed');
    expect(messages).toContain('exec() is not allowed');
    expect(messages).toContain('spawn() is not allowed');
    expect(messages).toContain('execSync is not allowed');
    expect(messages).toContain('spawnSync is not allowed');
  });

  it('covers global/scope escape patterns', () => {
    const messages = DANGEROUS_CODE_PATTERNS.map((p) => p.message);
    expect(messages).toContain('globalThis access is not allowed');
    expect(messages).toContain('global object access is not allowed');
    expect(messages).toContain('__dirname is not allowed');
    expect(messages).toContain('__filename is not allowed');
  });

  it('covers prototype manipulation patterns', () => {
    const messages = DANGEROUS_CODE_PATTERNS.map((p) => p.message);
    expect(messages).toContain('__proto__ access is not allowed');
    expect(messages).toContain('constructor property access is not allowed');
    expect(messages).toContain('getPrototypeOf is not allowed');
    expect(messages).toContain('setPrototypeOf is not allowed');
    expect(messages).toContain('Reflect.construct is not allowed');
    expect(messages).toContain('Reflect.apply is not allowed');
  });

  it('covers scope/control manipulation patterns', () => {
    const messages = DANGEROUS_CODE_PATTERNS.map((p) => p.message);
    expect(messages).toContain('with statement is not allowed');
    expect(messages).toContain('arguments.callee is not allowed');
  });

  it('covers Node.js API patterns (vm module)', () => {
    const messages = DANGEROUS_CODE_PATTERNS.map((p) => p.message);
    expect(messages).toContain('vm module access is not allowed');
  });

  it('covers execution control patterns (debugger)', () => {
    const messages = DANGEROUS_CODE_PATTERNS.map((p) => p.message);
    expect(messages).toContain('debugger statement is not allowed');
  });

  it('covers new security patterns (Symbol.unscopables, XMLHttpRequest, WebSocket, defineProperty, WebAssembly)', () => {
    const messages = DANGEROUS_CODE_PATTERNS.map((p) => p.message);
    expect(messages).toContain('Symbol.unscopables access is not allowed (scope escape vector)');
    expect(messages).toContain('XMLHttpRequest is not allowed (use fetch)');
    expect(messages).toContain('WebSocket is not allowed');
    expect(messages).toContain('Object.defineProperty is not allowed (prototype pollution risk)');
    expect(messages).toContain('WebAssembly is not allowed');
  });
});

// =============================================================================
// MAX_TOOL_CODE_SIZE
// =============================================================================

describe('MAX_TOOL_CODE_SIZE', () => {
  it('is 50000', () => {
    expect(MAX_TOOL_CODE_SIZE).toBe(50_000);
  });

  it('is a number', () => {
    expect(typeof MAX_TOOL_CODE_SIZE).toBe('number');
  });
});

// =============================================================================
// validateToolCode
// =============================================================================

describe('validateToolCode', () => {
  describe('valid code', () => {
    it('passes simple arithmetic', () => {
      const result = validateToolCode('const x = 1 + 2; return x;');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes string manipulation', () => {
      const result = validateToolCode('const s = "hello".toUpperCase(); return s;');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes array and object usage', () => {
      const code = `
        const items = [1, 2, 3];
        const obj = { a: items.map(x => x * 2) };
        return obj;
      `;
      const result = validateToolCode(code);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes async/await code', () => {
      const code = `
        const data = await fetch("https://api.example.com/data");
        return data;
      `;
      const result = validateToolCode(code);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes code with try/catch', () => {
      const code = `
        try {
          const data = await fetch("https://api.example.com/data");
          return data;
        } catch (err) {
          return { error: err.message };
        }
      `;
      const result = validateToolCode(code);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes code using utils.callTool', () => {
      const code = `
        try {
          const result = await utils.callTool("search", { query: "test" });
          return result;
        } catch (err) {
          return null;
        }
      `;
      const result = validateToolCode(code);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes code at exactly MAX_TOOL_CODE_SIZE', () => {
      const code = 'x'.repeat(MAX_TOOL_CODE_SIZE);
      const result = validateToolCode(code);
      expect(result.errors).not.toContain(
        `Code exceeds maximum size of ${MAX_TOOL_CODE_SIZE} characters`
      );
    });
  });

  describe('false positive avoidance', () => {
    it('allows variable names like globalCount', () => {
      const result = validateToolCode('const globalCount = 42; return globalCount;');
      expect(result.valid).toBe(true);
    });

    it('allows variable names like globalVar', () => {
      const result = validateToolCode('let globalVar = "hello"; return globalVar;');
      expect(result.valid).toBe(true);
    });

    it('allows class constructors', () => {
      // The standalone \bconstructor\b pattern was removed
      // Only .constructor property access is blocked
      const code = 'class Foo { myMethod() { return 42; } } return new Foo().myMethod();';
      const result = validateToolCode(code);
      expect(result.valid).toBe(true);
    });
  });

  describe('code size limit', () => {
    it('rejects code exceeding MAX_TOOL_CODE_SIZE', () => {
      const code = 'x'.repeat(MAX_TOOL_CODE_SIZE + 1);
      const result = validateToolCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        `Code exceeds maximum size of ${MAX_TOOL_CODE_SIZE} characters`
      );
    });

    it('rejects code far exceeding the limit', () => {
      const code = 'a'.repeat(MAX_TOOL_CODE_SIZE * 2);
      const result = validateToolCode(code);
      expect(result.valid).toBe(false);
    });
  });

  describe('module system access', () => {
    it('rejects require()', () => {
      const result = validateToolCode('require("fs")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('require() is not allowed');
    });

    it('rejects require with spaces before paren', () => {
      const result = validateToolCode('require  ("fs")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('require() is not allowed');
    });

    it('rejects dynamic import()', () => {
      const result = validateToolCode('import("path")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Dynamic import() is not allowed');
    });

    it('rejects import() with a module name', () => {
      const result = validateToolCode('const m = await import("os")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Dynamic import() is not allowed');
    });
  });

  describe('dynamic code execution', () => {
    it('rejects eval()', () => {
      const result = validateToolCode('eval("1+1")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('eval() is not allowed');
    });

    it('rejects eval with spaces', () => {
      const result = validateToolCode('eval ("malicious code")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('eval() is not allowed');
    });

    it('rejects Function() constructor', () => {
      const result = validateToolCode('Function("return 1")()');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Function() constructor is not allowed');
    });

    it('rejects new Function()', () => {
      const result = validateToolCode('new Function("return 1")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('new Function() is not allowed');
    });

    it('rejects new Function with extra whitespace', () => {
      const result = validateToolCode('new   Function("return 1")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('new Function() is not allowed');
    });
  });

  describe('process/system access', () => {
    it('rejects process', () => {
      const result = validateToolCode('process.exit()');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('process object access is not allowed');
    });

    it('rejects process.env access', () => {
      const result = validateToolCode('const secret = process.env.API_KEY');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('process object access is not allowed');
    });

    it('rejects child_process', () => {
      const result = validateToolCode('child_process.exec("ls")');
      expect(result.valid).toBe(false);
    });

    it('rejects exec()', () => {
      const result = validateToolCode('exec("rm -rf /")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('exec() is not allowed');
    });

    it('rejects spawn()', () => {
      const result = validateToolCode('spawn("node", ["malicious.js"])');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('spawn() is not allowed');
    });

    it('rejects execSync', () => {
      const result = validateToolCode('execSync("whoami")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('execSync is not allowed');
    });

    it('rejects spawnSync', () => {
      const result = validateToolCode('spawnSync("node", ["-e", "code"])');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('spawnSync is not allowed');
    });
  });

  describe('global/scope escape', () => {
    it('rejects globalThis', () => {
      const result = validateToolCode('globalThis.fetch');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('globalThis access is not allowed');
    });

    it('rejects global.something (property access)', () => {
      const result = validateToolCode('global.setTimeout');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('global object access is not allowed');
    });

    it('rejects global["something"] (bracket access)', () => {
      const result = validateToolCode('global["setTimeout"]');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('global object access is not allowed');
    });

    it('rejects __dirname', () => {
      const result = validateToolCode('console.log(__dirname)');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('__dirname is not allowed');
    });

    it('rejects __filename', () => {
      const result = validateToolCode('console.log(__filename)');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('__filename is not allowed');
    });
  });

  describe('prototype manipulation', () => {
    it('rejects __proto__ access', () => {
      const result = validateToolCode('obj.__proto__');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('__proto__ access is not allowed');
    });

    it('rejects __proto__ assignment', () => {
      const result = validateToolCode('obj.__proto__ = {}');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('__proto__ access is not allowed');
    });

    it('rejects .constructor property access', () => {
      const result = validateToolCode('obj.constructor');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('constructor property access is not allowed');
    });

    it('rejects getPrototypeOf', () => {
      const result = validateToolCode('Object.getPrototypeOf(obj)');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('getPrototypeOf is not allowed');
    });

    it('rejects setPrototypeOf', () => {
      const result = validateToolCode('Object.setPrototypeOf(obj, {})');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('setPrototypeOf is not allowed');
    });

    it('rejects Reflect.construct', () => {
      const result = validateToolCode('Reflect.construct(Array, [1, 2])');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Reflect.construct is not allowed');
    });

    it('rejects Reflect.apply', () => {
      const result = validateToolCode('Reflect.apply(fn, null, [])');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Reflect.apply is not allowed');
    });
  });

  describe('new security patterns', () => {
    it('rejects Symbol.unscopables', () => {
      const result = validateToolCode('Symbol.unscopables');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Symbol.unscopables access is not allowed (scope escape vector)'
      );
    });

    it('rejects XMLHttpRequest', () => {
      const result = validateToolCode('new XMLHttpRequest()');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('XMLHttpRequest is not allowed (use fetch)');
    });

    it('rejects WebSocket', () => {
      const result = validateToolCode('new WebSocket("ws://evil.com")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('WebSocket is not allowed');
    });

    it('rejects Object.defineProperty', () => {
      const result = validateToolCode('Object.defineProperty(target, "key", {})');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Object.defineProperty is not allowed (prototype pollution risk)'
      );
    });

    it('rejects WebAssembly', () => {
      const result = validateToolCode('WebAssembly.compile(buffer)');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('WebAssembly is not allowed');
    });
  });

  describe('scope/control manipulation', () => {
    it('rejects with statement', () => {
      const result = validateToolCode('with (obj) { x = 1; }');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('with statement is not allowed');
    });

    it('rejects arguments.callee', () => {
      const result = validateToolCode('arguments.callee');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('arguments.callee is not allowed');
    });
  });

  describe('Node.js API patterns', () => {
    it('rejects vm.createContext', () => {
      const result = validateToolCode('vm.createContext({})');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('vm module access is not allowed');
    });

    it('rejects vm.runInNewContext', () => {
      const result = validateToolCode('vm.runInNewContext("code", {})');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('vm module access is not allowed');
    });

    it('rejects vm.compileFunction', () => {
      const result = validateToolCode('vm.compileFunction("code")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('vm module access is not allowed');
    });
  });

  describe('execution control', () => {
    it('rejects debugger statement', () => {
      const result = validateToolCode('debugger;');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('debugger statement is not allowed');
    });

    it('rejects debugger embedded in code', () => {
      const code = `
        const x = 1;
        debugger
        return x;
      `;
      const result = validateToolCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('debugger statement is not allowed');
    });
  });

  describe('multiple errors', () => {
    it('collects all matching errors', () => {
      const result = validateToolCode('eval("x"); require("fs")');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors).toContain('eval() is not allowed');
      expect(result.errors).toContain('require() is not allowed');
    });

    it('includes size error alongside pattern errors', () => {
      const oversized = 'eval("code")' + 'x'.repeat(MAX_TOOL_CODE_SIZE);
      const result = validateToolCode(oversized);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        `Code exceeds maximum size of ${MAX_TOOL_CODE_SIZE} characters`
      );
      expect(result.errors).toContain('eval() is not allowed');
    });

    it('collects errors from multiple categories', () => {
      const code = 'require("fs"); eval("x"); process.exit(); globalThis.foo; debugger;';
      const result = validateToolCode(code);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('require() is not allowed');
      expect(result.errors).toContain('eval() is not allowed');
      expect(result.errors).toContain('process object access is not allowed');
      expect(result.errors).toContain('globalThis access is not allowed');
      expect(result.errors).toContain('debugger statement is not allowed');
    });
  });

  describe('return value shape', () => {
    it('always returns an object with valid (boolean) and errors (array)', () => {
      const safe = validateToolCode('return 1;');
      expect(typeof safe.valid).toBe('boolean');
      expect(Array.isArray(safe.errors)).toBe(true);

      const unsafe = validateToolCode('eval("x")');
      expect(typeof unsafe.valid).toBe('boolean');
      expect(Array.isArray(unsafe.errors)).toBe(true);
    });

    it('returns empty errors array for valid code', () => {
      const result = validateToolCode('return 42;');
      expect(result.errors).toEqual([]);
    });
  });
});

// =============================================================================
// findFirstDangerousPattern
// =============================================================================

describe('findFirstDangerousPattern', () => {
  it('returns null for safe code', () => {
    expect(findFirstDangerousPattern('const x = 1 + 2; return x;')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(findFirstDangerousPattern('')).toBeNull();
  });

  it('returns a string message for dangerous code', () => {
    const result = findFirstDangerousPattern('eval("code")');
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });

  it('returns the first matching pattern message', () => {
    const result = findFirstDangerousPattern('require("fs"); eval("x")');
    expect(result).toBe('require() is not allowed');
  });

  it('detects oversized code before checking patterns', () => {
    const oversized = 'eval("x")' + 'a'.repeat(MAX_TOOL_CODE_SIZE);
    const result = findFirstDangerousPattern(oversized);
    expect(result).toBe(`Code exceeds maximum size of ${MAX_TOOL_CODE_SIZE} characters`);
  });

  it('detects require()', () => {
    expect(findFirstDangerousPattern('require("path")')).toBe('require() is not allowed');
  });

  it('detects eval()', () => {
    expect(findFirstDangerousPattern('eval("1+1")')).toBe('eval() is not allowed');
  });

  it('detects process access', () => {
    expect(findFirstDangerousPattern('process.cwd()')).toBe('process object access is not allowed');
  });

  it('detects __proto__', () => {
    expect(findFirstDangerousPattern('obj.__proto__')).toBe('__proto__ access is not allowed');
  });

  it('detects debugger', () => {
    expect(findFirstDangerousPattern('debugger;')).toBe('debugger statement is not allowed');
  });

  it('detects globalThis', () => {
    expect(findFirstDangerousPattern('globalThis.x')).toBe('globalThis access is not allowed');
  });
});

// =============================================================================
// calculateSecurityScore
// =============================================================================

describe('calculateSecurityScore', () => {
  it('returns a high score for simple safe code', () => {
    const score = calculateSecurityScore('return 42;');
    expect(score.score).toBeGreaterThanOrEqual(80);
    expect(score.category).toBe('safe');
  });

  it('returns a lower score for code with network permissions', () => {
    // 'return 42;' no perms: 100 + 5 (return) = clamped 100
    // 'return 42;' with network: 100 - 5 (perm) + 5 (return) = 100
    // Use code without return bonus to see the difference
    const withPerm = calculateSecurityScore('42;', ['network']);
    const withoutPerm = calculateSecurityScore('42;');
    expect(withPerm.score).toBeLessThan(withoutPerm.score);
  });

  it('penalizes shell permission heavily', () => {
    const score = calculateSecurityScore('return 1;', ['shell']);
    expect(score.factors['shellPermission']).toBe(-15);
  });

  it('penalizes fetch usage', () => {
    const code = 'const r = await fetch("https://example.com"); return r;';
    const score = calculateSecurityScore(code, ['network']);
    expect(score.factors['networkUsage']).toBe(-10);
  });

  it('penalizes callTool usage', () => {
    const code = 'const r = await utils.callTool("search", {}); return r;';
    const score = calculateSecurityScore(code);
    expect(score.factors['callToolUsage']).toBe(-10);
  });

  it('gives bonus for error handling', () => {
    const code = 'try { return 1; } catch (e) { return null; }';
    const score = calculateSecurityScore(code);
    expect(score.factors['errorHandling']).toBe(10);
  });

  it('gives bonus for return statement', () => {
    const score = calculateSecurityScore('return 42;');
    expect(score.factors['returnsValue']).toBe(5);
  });

  it('gives bonus for input validation', () => {
    const code = 'if (typeof args.x === undefined) return null; return args.x;';
    const score = calculateSecurityScore(code);
    expect(score.factors['inputValidation']).toBe(5);
  });

  it('classifies dangerous code correctly', () => {
    const score = calculateSecurityScore(
      'const x = await fetch("https://evil.com"); const y = await utils.callTool("a", {});',
      ['network', 'filesystem', 'shell', 'email']
    );
    expect(score.category).toBe('dangerous');
    expect(score.score).toBeLessThan(50);
  });

  it('classifies review code correctly', () => {
    // Need enough penalties to get into 50-79 range for 'review'
    // fetch(-10) + 3 permissions(-15) + callTool(-10) = -35, + return(+5) = 70 -> review
    const score = calculateSecurityScore(
      'const r = await fetch("https://api.com"); const t = await utils.callTool("x", {}); return r;',
      ['network', 'filesystem', 'email']
    );
    expect(score.category).toBe('review');
  });

  it('clamps score between 0 and 100', () => {
    // Extremely dangerous: many permissions, no error handling, no return
    const score = calculateSecurityScore(
      'const x = await fetch("https://evil.com"); const y = await utils.callTool("a", {}); ' +
        'x'
          .repeat(300)
          .split('')
          .map((_, i) => `const v${i} = ${i};`)
          .join('\n'),
      ['network', 'filesystem', 'shell', 'email']
    );
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
  });

  it('returns factors breakdown', () => {
    const score = calculateSecurityScore('return 1;');
    expect(score.factors).toHaveProperty('codeLength');
    expect(score.factors).toHaveProperty('permissions');
    expect(score.factors).toHaveProperty('networkUsage');
    expect(score.factors).toHaveProperty('callToolUsage');
    expect(score.factors).toHaveProperty('errorHandling');
    expect(score.factors).toHaveProperty('returnsValue');
  });
});

// =============================================================================
// analyzeToolCode (enhanced)
// =============================================================================

describe('analyzeToolCode', () => {
  describe('validation pass-through', () => {
    it('marks valid code as valid', () => {
      const result = analyzeToolCode('return 1 + 2;');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('marks dangerous code as invalid with errors', () => {
      const result = analyzeToolCode('eval("x")');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('eval() is not allowed');
    });
  });

  describe('stats detection', () => {
    it('detects async code (await keyword)', () => {
      const result = analyzeToolCode('const data = await fetchData(); return data;');
      expect(result.stats.hasAsyncCode).toBe(true);
    });

    it('reports no async code when await is absent', () => {
      const result = analyzeToolCode('const x = 1; return x;');
      expect(result.stats.hasAsyncCode).toBe(false);
    });

    it('detects fetch usage', () => {
      const code = `
        try {
          const response = await fetch("https://api.example.com");
          return response;
        } catch (e) {
          return null;
        }
      `;
      const result = analyzeToolCode(code);
      expect(result.stats.usesFetch).toBe(true);
    });

    it('detects callTool usage via utils.callTool', () => {
      const code = `
        try {
          const r = await utils.callTool("search", { q: "test" });
          return r;
        } catch (e) {
          return null;
        }
      `;
      const result = analyzeToolCode(code);
      expect(result.stats.usesCallTool).toBe(true);
    });

    it('detects return value presence', () => {
      const result = analyzeToolCode('return { status: "ok" };');
      expect(result.stats.returnsValue).toBe(true);
    });

    it('reports no return value when absent', () => {
      const result = analyzeToolCode('const x = 1;');
      expect(result.stats.returnsValue).toBe(false);
    });

    it('counts lines correctly', () => {
      const code = 'line1\nline2\nline3';
      const result = analyzeToolCode(code);
      expect(result.stats.lineCount).toBe(3);
    });
  });

  describe('security score', () => {
    it('includes securityScore in analysis', () => {
      const result = analyzeToolCode('return 42;');
      expect(result.securityScore).toBeDefined();
      expect(result.securityScore.score).toBeGreaterThanOrEqual(0);
      expect(result.securityScore.score).toBeLessThanOrEqual(100);
      expect(result.securityScore.category).toBeDefined();
    });

    it('passes permissions to security score', () => {
      const result = analyzeToolCode('return 42;', ['network', 'shell']);
      expect(result.securityScore.score).toBeLessThan(
        analyzeToolCode('return 42;').securityScore.score
      );
    });
  });

  describe('data flow risks', () => {
    it('includes dataFlowRisks in analysis', () => {
      const result = analyzeToolCode('return 42;');
      expect(result.dataFlowRisks).toBeDefined();
      expect(Array.isArray(result.dataFlowRisks)).toBe(true);
    });

    it('detects fetch result piped to callTool', () => {
      const code = `
        try {
          const data = await fetch("https://api.com");
          const r = await utils.callTool("process", data);
          return r;
        } catch (e) { return null; }
      `;
      const result = analyzeToolCode(code);
      expect(result.dataFlowRisks.length).toBeGreaterThan(0);
      expect(result.dataFlowRisks[0]).toContain('Network data flows into callTool');
    });

    it('detects user input in fetch URL', () => {
      const code = 'const r = await fetch(args.url); return r;';
      const result = analyzeToolCode(code);
      expect(
        result.dataFlowRisks.some((r) => r.includes('User input used directly in fetch URL'))
      ).toBe(true);
    });
  });

  describe('best practices', () => {
    it('includes bestPractices in analysis', () => {
      const result = analyzeToolCode('return 42;');
      expect(result.bestPractices).toBeDefined();
      expect(result.bestPractices.followed).toBeDefined();
      expect(result.bestPractices.violated).toBeDefined();
    });

    it('detects error handling as best practice', () => {
      const code = 'try { return 1; } catch (e) { return null; }';
      const result = analyzeToolCode(code);
      expect(result.bestPractices.followed).toContain('Uses try/catch error handling');
    });

    it('detects missing error handling', () => {
      const code = 'const r = await fetch("https://api.com"); return r;';
      const result = analyzeToolCode(code);
      expect(result.bestPractices.violated.some((v) => v.includes('try/catch'))).toBe(true);
    });
  });

  describe('suggested permissions', () => {
    it('includes suggestedPermissions in analysis', () => {
      const result = analyzeToolCode('return 42;');
      expect(result.suggestedPermissions).toBeDefined();
      expect(Array.isArray(result.suggestedPermissions)).toBe(true);
    });

    it('suggests network permission when fetch is used', () => {
      const code = 'const r = await fetch("https://api.com"); return r;';
      const result = analyzeToolCode(code);
      expect(result.suggestedPermissions).toContain('network');
    });

    it('suggests no permissions for simple code', () => {
      const result = analyzeToolCode('return 42;');
      expect(result.suggestedPermissions).toHaveLength(0);
    });
  });

  describe('warnings', () => {
    it('warns when code has no return statement', () => {
      const result = analyzeToolCode('const x = 1;');
      expect(result.warnings).toContain(
        'Code does not contain a return statement — tool will return undefined'
      );
    });

    it('does not warn about return when a return exists', () => {
      const result = analyzeToolCode('return 1;');
      expect(result.warnings).not.toContain(
        'Code does not contain a return statement — tool will return undefined'
      );
    });

    it('warns when fetch is used without try/catch', () => {
      const code = 'const data = await fetch("https://api.example.com"); return data;';
      const result = analyzeToolCode(code);
      expect(result.warnings).toContain(
        'fetch() calls should be wrapped in try/catch for error handling'
      );
    });

    it('warns about while(true) infinite loop', () => {
      const code = 'while (true) { break; }\nreturn 1;';
      const result = analyzeToolCode(code);
      expect(result.warnings).toContain(
        'Infinite loop detected — ensure loop has a break condition'
      );
    });
  });

  describe('return shape', () => {
    it('returns all expected fields', () => {
      const result = analyzeToolCode('return 1;');
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('securityScore');
      expect(result).toHaveProperty('dataFlowRisks');
      expect(result).toHaveProperty('bestPractices');
      expect(result).toHaveProperty('suggestedPermissions');
      expect(result).toHaveProperty('stats');
    });

    it('stats contains all expected fields', () => {
      const result = analyzeToolCode('return 1;');
      expect(result.stats).toHaveProperty('lineCount');
      expect(result.stats).toHaveProperty('hasAsyncCode');
      expect(result.stats).toHaveProperty('usesFetch');
      expect(result.stats).toHaveProperty('usesCallTool');
      expect(result.stats).toHaveProperty('usesUtils');
      expect(result.stats).toHaveProperty('returnsValue');
    });
  });
});

// =============================================================================
// SSRF URL validation (imported from dynamic-tools)
// =============================================================================

describe('SSRF protection: isPrivateUrl', async () => {
  // Import isPrivateUrl from dynamic-tools
  const { isPrivateUrl } = await import('../agent/tools/dynamic-tools.js');

  it('blocks localhost', () => {
    expect(isPrivateUrl('http://localhost/api')).toBe(true);
    expect(isPrivateUrl('http://localhost:3000/api')).toBe(true);
  });

  it('blocks 127.0.0.1', () => {
    expect(isPrivateUrl('http://127.0.0.1/api')).toBe(true);
    expect(isPrivateUrl('http://127.0.0.1:8080/api')).toBe(true);
  });

  it('blocks IPv6 loopback', () => {
    expect(isPrivateUrl('http://[::1]/api')).toBe(true);
  });

  it('blocks 0.0.0.0', () => {
    expect(isPrivateUrl('http://0.0.0.0/api')).toBe(true);
  });

  it('blocks 10.x.x.x private range', () => {
    expect(isPrivateUrl('http://10.0.0.1/api')).toBe(true);
    expect(isPrivateUrl('http://10.255.255.255/api')).toBe(true);
  });

  it('blocks 172.16-31.x.x private range', () => {
    expect(isPrivateUrl('http://172.16.0.1/api')).toBe(true);
    expect(isPrivateUrl('http://172.31.255.255/api')).toBe(true);
  });

  it('does not block 172.32.x.x (outside private range)', () => {
    expect(isPrivateUrl('http://172.32.0.1/api')).toBe(false);
  });

  it('blocks 192.168.x.x private range', () => {
    expect(isPrivateUrl('http://192.168.1.1/api')).toBe(true);
    expect(isPrivateUrl('http://192.168.0.1/api')).toBe(true);
  });

  it('blocks 169.254.x.x link-local', () => {
    expect(isPrivateUrl('http://169.254.169.254/latest/meta-data/')).toBe(true);
  });

  it('blocks Alibaba cloud metadata (100.100.100.200)', () => {
    expect(isPrivateUrl('http://100.100.100.200/')).toBe(true);
  });

  it('blocks file:// protocol', () => {
    expect(isPrivateUrl('file:///etc/passwd')).toBe(true);
  });

  it('blocks ftp:// protocol', () => {
    expect(isPrivateUrl('ftp://internal.server/data')).toBe(true);
  });

  it('blocks metadata.google.internal', () => {
    expect(isPrivateUrl('http://metadata.google.internal/computeMetadata/')).toBe(true);
  });

  it('allows public URLs', () => {
    expect(isPrivateUrl('https://api.example.com/data')).toBe(false);
    expect(isPrivateUrl('https://api.github.com/repos')).toBe(false);
    expect(isPrivateUrl('https://httpbin.org/get')).toBe(false);
  });

  it('blocks invalid URLs', () => {
    expect(isPrivateUrl('not-a-url')).toBe(true);
    expect(isPrivateUrl('')).toBe(true);
  });
});
