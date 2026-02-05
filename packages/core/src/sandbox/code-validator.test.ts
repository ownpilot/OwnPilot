import { describe, it, expect } from 'vitest';
import {
  DANGEROUS_CODE_PATTERNS,
  MAX_TOOL_CODE_SIZE,
  validateToolCode,
  findFirstDangerousPattern,
  analyzeToolCode,
} from './code-validator.js';

// =============================================================================
// DANGEROUS_CODE_PATTERNS
// =============================================================================

describe('DANGEROUS_CODE_PATTERNS', () => {
  it('contains the expected number of patterns', () => {
    expect(DANGEROUS_CODE_PATTERNS).toHaveLength(26);
  });

  it('is a readonly array', () => {
    // TypeScript enforces ReadonlyArray, but verify it is a proper array at runtime
    expect(Array.isArray(DANGEROUS_CODE_PATTERNS)).toBe(true);
  });

  it('each entry has a RegExp pattern and a string message', () => {
    for (const entry of DANGEROUS_CODE_PATTERNS) {
      expect(entry.pattern).toBeInstanceOf(RegExp);
      expect(typeof entry.message).toBe('string');
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });

  it('all messages end with "is not allowed"', () => {
    for (const entry of DANGEROUS_CODE_PATTERNS) {
      expect(entry.message).toMatch(/is not allowed$/);
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
    expect(messages).toContain('global access is not allowed');
    expect(messages).toContain('__dirname is not allowed');
    expect(messages).toContain('__filename is not allowed');
  });

  it('covers prototype manipulation patterns', () => {
    const messages = DANGEROUS_CODE_PATTERNS.map((p) => p.message);
    expect(messages).toContain('__proto__ access is not allowed');
    expect(messages).toContain('constructor property access is not allowed');
    expect(messages).toContain('constructor access is not allowed');
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
      // Should not fail on size alone (only fails if strictly greater)
      expect(result.errors).not.toContain(
        `Code exceeds maximum size of ${MAX_TOOL_CODE_SIZE} characters`
      );
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
      expect(result.errors).toContain('child_process module is not allowed');
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

    it('rejects global', () => {
      const result = validateToolCode('global.setTimeout');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('global access is not allowed');
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

    it('rejects bare constructor keyword', () => {
      const result = validateToolCode('constructor');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('constructor access is not allowed');
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

    it('rejects vm.runInThisContext', () => {
      const result = validateToolCode('vm.runInThisContext("code")');
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
    // require() appears before eval() in DANGEROUS_CODE_PATTERNS
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
    expect(findFirstDangerousPattern('process.cwd()')).toBe(
      'process object access is not allowed'
    );
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
// analyzeToolCode
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

    it('reports no fetch when fetch is absent', () => {
      const result = analyzeToolCode('return "hello";');
      expect(result.stats.usesFetch).toBe(false);
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

    it('reports no callTool when absent', () => {
      const result = analyzeToolCode('return 42;');
      expect(result.stats.usesCallTool).toBe(false);
    });

    it('detects utils usage (any utils. property)', () => {
      const code = 'const val = utils.someHelper(); return val;';
      const result = analyzeToolCode(code);
      expect(result.stats.usesUtils).toBe(true);
    });

    it('reports no utils when absent', () => {
      const result = analyzeToolCode('return "no utils";');
      expect(result.stats.usesUtils).toBe(false);
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

    it('counts single line', () => {
      const result = analyzeToolCode('return 1;');
      expect(result.stats.lineCount).toBe(1);
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

    it('does not warn about fetch when try/catch is present', () => {
      const code = `
        try {
          const data = await fetch("https://example.com");
          return data;
        } catch (e) {
          return null;
        }
      `;
      const result = analyzeToolCode(code);
      expect(result.warnings).not.toContain(
        'fetch() calls should be wrapped in try/catch for error handling'
      );
    });

    it('warns when callTool is used without try/catch', () => {
      const code = 'const r = await utils.callTool("search", {}); return r;';
      const result = analyzeToolCode(code);
      expect(result.warnings).toContain(
        'callTool() calls should be wrapped in try/catch for error handling'
      );
    });

    it('does not warn about callTool when try/catch is present', () => {
      const code = `
        try {
          const r = await utils.callTool("search", {});
          return r;
        } catch (e) {
          return null;
        }
      `;
      const result = analyzeToolCode(code);
      expect(result.warnings).not.toContain(
        'callTool() calls should be wrapped in try/catch for error handling'
      );
    });

    it('warns about very long code (200+ lines)', () => {
      const lines = Array.from({ length: 201 }, (_, i) => `const x${i} = ${i};`);
      lines.push('return x200;');
      const code = lines.join('\n');
      const result = analyzeToolCode(code);
      expect(result.warnings).toContain(
        'Code is very long (200+ lines) — consider breaking into smaller tools'
      );
    });

    it('does not warn about length for code under 200 lines', () => {
      const lines = Array.from({ length: 50 }, (_, i) => `const x${i} = ${i};`);
      lines.push('return x49;');
      const code = lines.join('\n');
      const result = analyzeToolCode(code);
      expect(result.warnings).not.toContain(
        'Code is very long (200+ lines) — consider breaking into smaller tools'
      );
    });

    it('warns about while(true) infinite loop', () => {
      const code = 'while (true) { break; }\nreturn 1;';
      const result = analyzeToolCode(code);
      expect(result.warnings).toContain(
        'Infinite loop detected — ensure loop has a break condition'
      );
    });

    it('warns about for(;;) infinite loop', () => {
      const code = 'for (;;) { break; }\nreturn 1;';
      const result = analyzeToolCode(code);
      expect(result.warnings).toContain(
        'Infinite loop detected — ensure loop has a break condition'
      );
    });

    it('does not warn about normal loops', () => {
      const code = 'for (let i = 0; i < 10; i++) { }\nreturn 1;';
      const result = analyzeToolCode(code);
      expect(result.warnings).not.toContain(
        'Infinite loop detected — ensure loop has a break condition'
      );
    });

    it('generates no warnings for well-structured code', () => {
      const code = `
        try {
          const data = await fetch("https://api.example.com");
          return data;
        } catch (e) {
          return null;
        }
      `;
      const result = analyzeToolCode(code);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('return shape', () => {
    it('returns an object with valid, errors, warnings, and stats', () => {
      const result = analyzeToolCode('return 1;');
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
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
// Security: comprehensive attack vector coverage
// =============================================================================

describe('security: attack vector coverage', () => {
  /**
   * Helper that asserts the given code snippet is rejected by validateToolCode.
   */
  function expectBlocked(code: string, expectedError?: string) {
    const result = validateToolCode(code);
    expect(result.valid).toBe(false);
    if (expectedError) {
      expect(result.errors).toContain(expectedError);
    }
  }

  describe('filesystem access attempts', () => {
    it('blocks require("fs")', () => {
      expectBlocked('require("fs")', 'require() is not allowed');
    });

    it('blocks require("child_process")', () => {
      expectBlocked('require("child_process")', 'require() is not allowed');
    });

    it('blocks import("fs")', () => {
      expectBlocked('import("fs")', 'Dynamic import() is not allowed');
    });

    it('blocks import("module")', () => {
      expectBlocked('import("module")', 'Dynamic import() is not allowed');
    });
  });

  describe('code execution escape attempts', () => {
    it('blocks eval with string concatenation', () => {
      expectBlocked('eval("mal" + "icious")', 'eval() is not allowed');
    });

    it('blocks eval with variable', () => {
      expectBlocked('const code = "alert(1)"; eval(code)', 'eval() is not allowed');
    });

    it('blocks Function constructor call', () => {
      expectBlocked('Function("return this")()', 'Function() constructor is not allowed');
    });

    it('blocks new Function with body', () => {
      expectBlocked(
        'const fn = new Function("a", "return a"); fn(1)',
        'new Function() is not allowed'
      );
    });
  });

  describe('process/OS escape attempts', () => {
    it('blocks process.exit()', () => {
      expectBlocked('process.exit(1)', 'process object access is not allowed');
    });

    it('blocks process.env access', () => {
      expectBlocked('process.env.SECRET', 'process object access is not allowed');
    });

    it('blocks process.argv', () => {
      expectBlocked('process.argv', 'process object access is not allowed');
    });

    it('blocks exec with shell command', () => {
      expectBlocked('exec("cat /etc/passwd")', 'exec() is not allowed');
    });

    it('blocks spawn with arguments', () => {
      expectBlocked('spawn("sh", ["-c", "whoami"])', 'spawn() is not allowed');
    });

    it('blocks execSync', () => {
      expectBlocked('execSync("id")', 'execSync is not allowed');
    });

    it('blocks spawnSync', () => {
      expectBlocked('spawnSync("ls")', 'spawnSync is not allowed');
    });
  });

  describe('sandbox escape via prototype chain', () => {
    it('blocks __proto__ traversal', () => {
      expectBlocked('({}).__proto__', '__proto__ access is not allowed');
    });

    it('blocks constructor chain escape', () => {
      expectBlocked(
        '"".constructor',
        'constructor property access is not allowed'
      );
    });

    it('blocks Object.getPrototypeOf for prototype walking', () => {
      expectBlocked(
        'Object.getPrototypeOf({})',
        'getPrototypeOf is not allowed'
      );
    });

    it('blocks Object.setPrototypeOf for prototype poisoning', () => {
      expectBlocked(
        'Object.setPrototypeOf({}, null)',
        'setPrototypeOf is not allowed'
      );
    });

    it('blocks Reflect.construct for constructor bypass', () => {
      expectBlocked(
        'Reflect.construct(Array, [], Object)',
        'Reflect.construct is not allowed'
      );
    });

    it('blocks Reflect.apply for function hijacking', () => {
      expectBlocked(
        'Reflect.apply(Array.prototype.push, [], [1])',
        'Reflect.apply is not allowed'
      );
    });
  });

  describe('global scope escape', () => {
    it('blocks globalThis access', () => {
      expectBlocked('globalThis.process', 'globalThis access is not allowed');
    });

    it('blocks global access', () => {
      expectBlocked('global.Buffer', 'global access is not allowed');
    });

    it('blocks __dirname path disclosure', () => {
      expectBlocked('__dirname + "/secrets.txt"', '__dirname is not allowed');
    });

    it('blocks __filename path disclosure', () => {
      expectBlocked('__filename', '__filename is not allowed');
    });
  });

  describe('VM escape attempts', () => {
    it('blocks vm.createContext', () => {
      expectBlocked('vm.createContext({})', 'vm module access is not allowed');
    });

    it('blocks vm.runInNewContext', () => {
      expectBlocked(
        'vm.runInNewContext("process.exit()")',
        'vm module access is not allowed'
      );
    });

    it('blocks vm.compileFunction', () => {
      expectBlocked('vm.compileFunction("return 1")', 'vm module access is not allowed');
    });
  });

  describe('control flow attacks', () => {
    it('blocks debugger to hang execution', () => {
      expectBlocked('debugger', 'debugger statement is not allowed');
    });

    it('blocks with statement for scope injection', () => {
      expectBlocked(
        'with (maliciousObj) { stealSecrets(); }',
        'with statement is not allowed'
      );
    });

    it('blocks arguments.callee for stack walking', () => {
      expectBlocked(
        'function f() { arguments.callee(); }',
        'arguments.callee is not allowed'
      );
    });
  });

  describe('multi-vector attacks', () => {
    it('detects all violations in a compound payload', () => {
      const code = [
        'eval("steal")',
        'require("fs")',
        'process.exit()',
        'globalThis.x',
        '__proto__',
        'debugger',
      ].join('; ');

      const result = validateToolCode(code);
      expect(result.valid).toBe(false);
      // Should catch at least the major categories
      expect(result.errors).toContain('eval() is not allowed');
      expect(result.errors).toContain('require() is not allowed');
      expect(result.errors).toContain('process object access is not allowed');
      expect(result.errors).toContain('globalThis access is not allowed');
      expect(result.errors).toContain('__proto__ access is not allowed');
      expect(result.errors).toContain('debugger statement is not allowed');
    });

    it('findFirstDangerousPattern returns first match from compound payload', () => {
      const code = 'require("fs"); eval("x"); process.exit();';
      const result = findFirstDangerousPattern(code);
      // require() comes first in the patterns array
      expect(result).toBe('require() is not allowed');
    });
  });
});
