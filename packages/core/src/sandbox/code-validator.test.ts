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
  it('contains 34 patterns', () => {
    expect(DANGEROUS_CODE_PATTERNS).toHaveLength(34);
  });
});

// ---------------------------------------------------------------------------
// validateToolCode (~8 tests)
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
});

// ---------------------------------------------------------------------------
// calculateSecurityScore (~4 tests)
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
});

// ---------------------------------------------------------------------------
// analyzeToolCode (~3 tests)
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
});
