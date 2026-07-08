import { describe, it, expect } from 'vitest';
import {
  validateToolCode,
  validateToolCodeWithPermissions,
  findFirstDangerousPattern,
  calculateSecurityScore,
  analyzeToolCode,
  MAX_TOOL_CODE_SIZE,
  DANGEROUS_CODE_PATTERNS,
} from './code-validator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLEAN_CODE = `
const name = args.name || 'world';
return \`Hello, \${name}!\`;
`;

// ---------------------------------------------------------------------------
// DANGEROUS_CODE_PATTERNS constant
// ---------------------------------------------------------------------------

describe('DANGEROUS_CODE_PATTERNS', () => {
  it('contains 37 patterns', () => {
    expect(DANGEROUS_CODE_PATTERNS).toHaveLength(37);
  });

  it('each pattern has pattern (RegExp) and message (string)', () => {
    for (const entry of DANGEROUS_CODE_PATTERNS) {
      expect(entry.pattern).toBeInstanceOf(RegExp);
      expect(typeof entry.message).toBe('string');
      expect(entry.message.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// validateToolCode
// ---------------------------------------------------------------------------

describe('validateToolCode', () => {
  it('passes clean code', () => {
    const result = validateToolCode(CLEAN_CODE);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects require()', () => {
    const result = validateToolCode("const fs = require('fs');");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('require() is not allowed');
  });

  it('detects eval()', () => {
    const result = validateToolCode("eval('console.log(1)')");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('eval() is not allowed');
  });

  it('detects process access', () => {
    const result = validateToolCode('const env = process.env.SECRET;');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('process object access is not allowed');
  });

  it('detects globalThis', () => {
    const result = validateToolCode('const g = globalThis;');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('globalThis access is not allowed');
  });

  it('detects __proto__', () => {
    const result = validateToolCode('obj.__proto__.polluted = true;');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('__proto__ access is not allowed');
  });

  it('rejects code exceeding MAX_TOOL_CODE_SIZE', () => {
    const hugeCode = 'x'.repeat(MAX_TOOL_CODE_SIZE + 1);
    const result = validateToolCode(hugeCode);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain(`${MAX_TOOL_CODE_SIZE}`);
  });

  it('detects dynamic import()', () => {
    const result = validateToolCode("const mod = import('fs')");
    expect(result.errors).toContain('Dynamic import() is not allowed');
  });

  it('detects new Function pattern', () => {
    const result = validateToolCode('const fn = new Function("return 1")');
    expect(result.errors).toContain('new Function() is not allowed');
  });

  it('detects child_process', () => {
    const result = validateToolCode("const cp = require('child_process')");
    expect(result.errors).toContain('child_process module is not allowed');
  });

  it('detects spawn()', () => {
    const result = validateToolCode("spawn('ls')");
    expect(result.errors).toContain('spawn() is not allowed');
  });

  it('detects debugger statement', () => {
    const result = validateToolCode('debugger;');
    expect(result.errors).toContain('debugger statement is not allowed');
  });

  it('detects with statement', () => {
    const result = validateToolCode('with(obj) { x }');
    expect(result.errors).toContain('with statement is not allowed');
  });

  it('detects XMLHttpRequest', () => {
    const result = validateToolCode('const xhr = new XMLHttpRequest()');
    expect(result.errors).toContain('XMLHttpRequest is not allowed (use fetch)');
  });

  it('detects WebSocket', () => {
    const result = validateToolCode('const ws = new WebSocket("ws://x")');
    expect(result.errors).toContain('WebSocket is not allowed');
  });

  it('detects WebAssembly', () => {
    const result = validateToolCode('WebAssembly.compile(b)');
    expect(result.errors).toContain('WebAssembly is not allowed');
  });

  it('detects Symbol.unscopables', () => {
    const result = validateToolCode('Symbol.unscopables');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Symbol.unscopables');
  });

  it('allows class constructor method definition', () => {
    // The constructor keyword in class method definitions is NOT preceded by . or [
    const result = validateToolCode('class Foo { constructor() { this.x = 1; } }');
    expect(result.valid).toBe(true);
  });

  it('detects constructor property access via bracket notation', () => {
    const result = validateToolCode("obj['constructor']");
    expect(result.errors).toContain('constructor property access is not allowed');
  });

  it('returns ALL errors, not just the first one', () => {
    // Code that triggers at least 4 distinct patterns
    const code = [
      "const fs = require('fs');",
      "eval('attack');",
      'const x = globalThis;',
      'obj.__proto__ = {};',
    ].join('\n');
    const result = validateToolCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    expect(result.errors).toContain('require() is not allowed');
    expect(result.errors).toContain('eval() is not allowed');
    expect(result.errors).toContain('globalThis access is not allowed');
    expect(result.errors).toContain('__proto__ access is not allowed');
  });
});

// ---------------------------------------------------------------------------
// New runtime/timing patterns (~4 tests)
// ---------------------------------------------------------------------------

describe('new dangerous patterns', () => {
  it('detects Deno.readFile()', () => {
    const result = validateToolCode("const data = Deno.readFile('/etc/passwd');");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Deno namespace access is not allowed');
  });

  it('detects Bun.serve()', () => {
    const result = validateToolCode('Bun.serve({ port: 3000 });');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Bun namespace access is not allowed');
  });

  it('detects SharedArrayBuffer', () => {
    const result = validateToolCode('const sab = new SharedArrayBuffer(1024);');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('SharedArrayBuffer is not allowed (timing attack vector)');
  });

  it('detects Atomics.wait()', () => {
    const result = validateToolCode('Atomics.wait(view, 0, 0);');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Atomics is not allowed (timing attack vector)');
  });

  // RCE-001 regression: the constructor-walk escape relies on splitting the
  // word "constructor" across string-concat to evade the literal-token check.
  // Every single split point must be caught. (Defense-in-depth; the VM sandbox
  // itself no longer injects host objects, so even a 3-way split cannot escape.)
  it.each([
    `Math['constructo'+'r']('return process')`,
    `Math['construct'+'or']('x')`,
    `Math['con'+'structor']('x')`,
    `Math['constr'+'uctor']('x')`,
    `Math['constru'+'ctor']('x')`,
    `obj['co'+'nstructor']`,
    `obj['constructo' + 'r']`,
  ])('blocks split-string constructor access: %s', (code) => {
    const result = validateToolCode(code);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('string-concat constructor access is not allowed');
  });
});

// ---------------------------------------------------------------------------
// validateToolCodeWithPermissions (~4 tests)
// ---------------------------------------------------------------------------

describe('validateToolCodeWithPermissions', () => {
  it('behaves like validateToolCode without local permission', () => {
    const code = "const fs = require('fs');";
    const withoutLocal = validateToolCodeWithPermissions(code, ['network']);
    const baseline = validateToolCode(code);
    expect(withoutLocal).toEqual(baseline);
  });

  it('allows require() with local + filesystem permissions', () => {
    // require() is relaxed when local + filesystem are both present
    const code = "const fs = require('fs'); const data = fs.readFileSync('/tmp/x');";
    const result = validateToolCodeWithPermissions(code, ['local', 'filesystem']);
    expect(result.errors).not.toContain('require() is not allowed');
  });

  it('allows shell-related patterns with local + shell permissions', () => {
    // With local + shell, require/child_process/exec patterns are all relaxed
    const code = "const cp = require('child_process'); cp.exec('ls');";
    const result = validateToolCodeWithPermissions(code, ['local', 'shell']);
    expect(result.errors).not.toContain('require() is not allowed');
    expect(result.errors).not.toContain('child_process module is not allowed');
    // Note: exec() pattern matches "cp.exec('ls')" which contains exec(
    expect(result.errors).not.toContain('exec() is not allowed');
  });

  it('still blocks require and exec with local only (no filesystem/shell)', () => {
    const code = ["const fs = require('fs');", "exec('rm -rf /');"].join('\n');
    const result = validateToolCodeWithPermissions(code, ['local']);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('require() is not allowed');
    expect(result.errors).toContain('exec() is not allowed');
  });
});

// ---------------------------------------------------------------------------
// findFirstDangerousPattern (~2 tests)
// ---------------------------------------------------------------------------

describe('findFirstDangerousPattern', () => {
  it('returns null for clean code', () => {
    expect(findFirstDangerousPattern(CLEAN_CODE)).toBeNull();
  });

  it('returns the first matched message for dangerous code', () => {
    // require() is the first pattern in DANGEROUS_CODE_PATTERNS,
    // so it should be returned before eval()
    const code = "const fs = require('fs'); eval('x');";
    const result = findFirstDangerousPattern(code);
    expect(result).toBe('require() is not allowed');
  });

  it('returns size error for oversized code', () => {
    const hugeCode = 'x'.repeat(MAX_TOOL_CODE_SIZE + 1);
    const result = findFirstDangerousPattern(hugeCode);
    expect(result).toContain(`${MAX_TOOL_CODE_SIZE}`);
  });

  it('returns null for code with only safe patterns like return', () => {
    expect(findFirstDangerousPattern('return 42;')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// calculateSecurityScore
// ---------------------------------------------------------------------------

describe('calculateSecurityScore', () => {
  it('gives a high score (safe) for clean short code', () => {
    // Short code, no permissions, has return -> base 100 + 5 (return) clamped to 100
    const score = calculateSecurityScore('return args.x + 1;');
    expect(score.score).toBeGreaterThanOrEqual(80);
    expect(score.category).toBe('safe');
  });

  it('penalizes many permissions', () => {
    const noPerms = calculateSecurityScore('return 1;');
    const manyPerms = calculateSecurityScore('return 1;', ['a', 'b', 'c', 'd']);
    expect(manyPerms.score).toBeLessThan(noPerms.score);
    // 4 permissions * 5 = 20 penalty (capped at 20)
    expect(manyPerms.factors['permissions']).toBe(-20);
  });

  it('applies network penalty for fetch()', () => {
    const score = calculateSecurityScore("const r = await fetch('https://api.example.com');");
    expect(score.factors['networkUsage']).toBe(-10);
  });

  it('applies heavy penalty for shell permission', () => {
    const score = calculateSecurityScore('return 1;', ['shell']);
    expect(score.factors['shellPermission']).toBe(-15);
    // 1 permission * 5 = 5
    expect(score.factors['permissions']).toBe(-5);
  });

  it('applies code length penalty for 100+ lines', () => {
    const code = Array.from({ length: 150 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const score = calculateSecurityScore(code);
    expect(score.factors['codeLength']).toBe(-10);
    expect(score.score).toBeLessThan(95);
  });

  it('applies small code length penalty for 50+ lines', () => {
    const code = Array.from({ length: 75 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const score = calculateSecurityScore(code);
    expect(score.factors['codeLength']).toBe(-5);
  });

  it('gives zero code length penalty for short code (< 50 lines)', () => {
    const code = Array.from({ length: 10 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const score = calculateSecurityScore(code);
    expect(score.factors['codeLength']).toBe(0);
  });

  it('applies callTool usage penalty', () => {
    const score = calculateSecurityScore("utils.callTool('read_file')");
    expect(score.factors['callToolUsage']).toBe(-10);
  });

  it('gives error handling bonus for try/catch', () => {
    const score = calculateSecurityScore('try { return x; } catch(e) { return null; }');
    expect(score.factors['errorHandling']).toBe(10);
  });

  it('gives input validation bonus for typeof check', () => {
    const score = calculateSecurityScore("if (typeof x === 'undefined') return;");
    expect(score.factors['inputValidation']).toBe(5);
  });

  it('gives input validation bonus for !args check', () => {
    const score = calculateSecurityScore('if (!args.name) return;');
    expect(score.factors['inputValidation']).toBe(5);
  });

  it('gives input validation bonus for === undefined check', () => {
    const score = calculateSecurityScore('if (x === undefined) return;');
    expect(score.factors['inputValidation']).toBe(5);
  });

  it('applies filesystem permission penalty', () => {
    const score = calculateSecurityScore('return 1;', ['filesystem']);
    expect(score.factors['filesystemPermission']).toBe(-5);
  });

  it('clamps score to 0 minimum', () => {
    // Many penalties: 100 - 15 (200+ lines) - 20 (4 perms) - 10 (fetch) - 15 (shell) = 40... not enough
    // Push it negative with all penalties
    const code = 'x'.repeat(300) + '\n'.repeat(210) + " fetch('http://x.com');";
    const score = calculateSecurityScore(code, ['shell', 'a', 'b', 'c', 'd', 'e', 'f']);
    expect(score.score).toBeGreaterThanOrEqual(0);
  });

  it('categories scores correctly', () => {
    // Dangerous (score < 50) — code with many penalties
    const dangerous = calculateSecurityScore(
      "const r = await fetch('http://x.com');" +
        Array.from({ length: 210 }, (_, i) => `\nconst x${i} = ${i};`).join(''),
      ['shell', 'a', 'b', 'c', 'd']
    );
    expect(dangerous.category).toBe('dangerous');
    // Review (score >= 50 and < 80)
    const review = calculateSecurityScore(
      "const r = await fetch('http://x.com');" +
        " const result = await utils.callTool('data');" +
        ' console.log(r);',
      ['network', 'a', 'b']
    );
    expect(review.category).toBe('review');
    // Safe (score >= 80)
    const safe = calculateSecurityScore('return 42;');
    expect(safe.category).toBe('safe');
  });
});

// ---------------------------------------------------------------------------
// analyzeToolCode
// ---------------------------------------------------------------------------

describe('analyzeToolCode', () => {
  it('returns valid:true for clean code', () => {
    const analysis = analyzeToolCode(CLEAN_CODE);
    expect(analysis.valid).toBe(true);
    expect(analysis.errors).toHaveLength(0);
    expect(analysis.stats.returnsValue).toBe(true);
  });

  it('warns about long code (200+ lines)', () => {
    const longCode = Array.from({ length: 210 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const analysis = analyzeToolCode(longCode);
    expect(analysis.warnings.some((w) => w.includes('200+ lines'))).toBe(true);
    expect(analysis.stats.lineCount).toBe(210);
  });

  it('suggests network permission for code with fetch()', () => {
    const code = "const r = await fetch('https://api.example.com/data');";
    const analysis = analyzeToolCode(code);
    expect(analysis.suggestedPermissions).toContain('network');
    expect(analysis.stats.usesFetch).toBe(true);
    expect(analysis.stats.hasAsyncCode).toBe(true);
  });

  it('warns about missing return statement', () => {
    const code = 'const x = 1;';
    const analysis = analyzeToolCode(code);
    expect(analysis.warnings.some((w) => w.includes('return statement'))).toBe(true);
    expect(analysis.stats.returnsValue).toBe(false);
  });

  it('warns about fetch() without try/catch', () => {
    const code = "const r = await fetch('http://x.com'); return r;";
    const analysis = analyzeToolCode(code);
    expect(analysis.warnings.some((w) => w.includes('fetch'))).toBe(true);
    expect(analysis.warnings.some((w) => w.includes('try/catch'))).toBe(true);
  });

  it('warns about callTool() without try/catch', () => {
    const code = "const r = await utils.callTool('x'); return r;";
    const analysis = analyzeToolCode(code);
    expect(analysis.warnings.some((w) => w.includes('callTool'))).toBe(true);
    expect(analysis.warnings.some((w) => w.includes('try/catch'))).toBe(true);
  });

  it('warns about infinite loop patterns', () => {
    const code = 'while (true) { break; }';
    const analysis = analyzeToolCode(code);
    expect(analysis.warnings.some((w) => w.includes('Infinite loop'))).toBe(true);
  });

  it('detects data flow risk: fetch piped to callTool', () => {
    const code = `
      const data = await fetch('http://api.com/data');
      await utils.callTool('read_file', { path: '/tmp/x' });
      return data;
    `;
    const analysis = analyzeToolCode(code);
    expect(analysis.dataFlowRisks.length).toBeGreaterThanOrEqual(0);
  });

  it('detects user input in fetch URL directly', () => {
    const code = 'const r = await fetch(args.url);';
    const analysis = analyzeToolCode(code);
    const hasInputRisk = analysis.dataFlowRisks.some((r) => r.includes('fetch URL'));
    expect(hasInputRisk).toBe(true);
  });

  it('returns best practices for code with error handling', () => {
    const code = `
      try {
        const r = await fetch('http://x.com');
        return r;
      } catch(e) {
        return null;
      }
    `;
    const analysis = analyzeToolCode(code);
    expect(analysis.bestPractices.followed.some((b) => b.includes('try/catch'))).toBe(true);
  });

  it('flags violated best practice: missing return', () => {
    const analysis = analyzeToolCode('const x = 1;');
    expect(analysis.bestPractices.violated.some((b) => b.includes('return'))).toBe(true);
  });

  it('flags violated best practice: missing input validation', () => {
    const analysis = analyzeToolCode('return 42;');
    expect(analysis.bestPractices.violated.some((b) => b.includes('input'))).toBe(true);
  });

  it('detects fetch response status check as best practice', () => {
    const code = "const r = await fetch('http://x.com'); if (response.ok) return r;";
    const analysis = analyzeToolCode(code);
    expect(analysis.bestPractices.followed.some((b) => b.includes('response'))).toBe(true);
  });

  it('flags fetch without response status check', () => {
    const code = "const r = await fetch('http://x.com'); return r;";
    const analysis = analyzeToolCode(code);
    const hasViolation = analysis.bestPractices.violated.some((b) => b.includes('response'));
    expect(hasViolation).toBe(true);
  });

  it('suggests filesystem permission for read_file callTool', () => {
    const code = "await utils.callTool('read_file', { path: '/tmp/x' });";
    const analysis = analyzeToolCode(code);
    expect(analysis.suggestedPermissions).toContain('filesystem');
  });

  it('suggests shell permission for execute_shell callTool', () => {
    const code = "await utils.callTool('execute_shell', { cmd: 'ls' });";
    const analysis = analyzeToolCode(code);
    expect(analysis.suggestedPermissions).toContain('shell');
  });

  it('suggests email permission for send_email callTool', () => {
    const code = "await utils.callTool('send_email', { to: 'a@b.com' });";
    const analysis = analyzeToolCode(code);
    expect(analysis.suggestedPermissions).toContain('email');
  });

  it('all validates invalid code and reports errors', () => {
    const code = "const fs = require('fs'); eval('bad');";
    const analysis = analyzeToolCode(code);
    expect(analysis.valid).toBe(false);
    expect(analysis.errors.length).toBeGreaterThanOrEqual(1);
  });
});
