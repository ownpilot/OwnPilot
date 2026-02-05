/**
 * Centralized Code Validator
 *
 * Single source of truth for dangerous code pattern detection.
 * Used by sandbox executor, dynamic tool registry, and custom tools routes.
 *
 * Defense-in-depth: These patterns complement V8's codeGeneration:{strings:false}
 * which blocks eval/Function at the engine level. Static regex analysis catches
 * patterns before code reaches the VM.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface CodeValidationPattern {
  /** Regex to match against code */
  pattern: RegExp;
  /** Human-readable reason for blocking */
  message: string;
}

export interface CodeValidationResult {
  /** Whether code passed all checks */
  valid: boolean;
  /** List of issues found (empty if valid) */
  errors: string[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum code size in characters */
export const MAX_TOOL_CODE_SIZE = 50_000;

/**
 * Dangerous code patterns that BLOCK execution.
 *
 * Categories:
 * 1. Module system access — prevent loading Node.js modules
 * 2. Dynamic code execution — prevent eval/Function (defense-in-depth)
 * 3. Process/system access — prevent OS-level operations
 * 4. Global/scope escape — prevent breaking out of sandbox
 * 5. Prototype manipulation — prevent prototype chain attacks
 * 6. Scope/control manipulation — prevent scope bypasses
 * 7. Dangerous Node.js APIs — prevent direct module usage
 * 8. Execution control — prevent debugger hangs
 */
export const DANGEROUS_CODE_PATTERNS: ReadonlyArray<CodeValidationPattern> = [
  // ── Module system access ──────────────────────────────────────
  { pattern: /\brequire\s*\(/i, message: 'require() is not allowed' },
  { pattern: /\bimport\s*\(/, message: 'Dynamic import() is not allowed' },

  // ── Dynamic code execution (defense-in-depth) ─────────────────
  { pattern: /\beval\s*\(/i, message: 'eval() is not allowed' },
  { pattern: /\bFunction\s*\(/i, message: 'Function() constructor is not allowed' },
  { pattern: /\bnew\s+Function\b/i, message: 'new Function() is not allowed' },

  // ── Process/system access ─────────────────────────────────────
  { pattern: /\bprocess\b/, message: 'process object access is not allowed' },
  { pattern: /\bchild_process\b/, message: 'child_process module is not allowed' },
  { pattern: /\bexec\s*\(/, message: 'exec() is not allowed' },
  { pattern: /\bspawn\s*\(/, message: 'spawn() is not allowed' },
  { pattern: /\bexecSync\b/, message: 'execSync is not allowed' },
  { pattern: /\bspawnSync\b/, message: 'spawnSync is not allowed' },

  // ── Global/scope escape ───────────────────────────────────────
  { pattern: /\bglobalThis\b/, message: 'globalThis access is not allowed' },
  { pattern: /\bglobal\b/, message: 'global access is not allowed' },
  { pattern: /__dirname\b/, message: '__dirname is not allowed' },
  { pattern: /__filename\b/, message: '__filename is not allowed' },

  // ── Prototype manipulation (sandbox escape vectors) ───────────
  { pattern: /__proto__/, message: '__proto__ access is not allowed' },
  { pattern: /\.constructor\b/, message: 'constructor property access is not allowed' },
  { pattern: /\bconstructor\b/, message: 'constructor access is not allowed' },
  { pattern: /\bgetPrototypeOf\b/, message: 'getPrototypeOf is not allowed' },
  { pattern: /\bsetPrototypeOf\b/, message: 'setPrototypeOf is not allowed' },
  { pattern: /\bReflect\.construct\b/, message: 'Reflect.construct is not allowed' },
  { pattern: /\bReflect\.apply\b/, message: 'Reflect.apply is not allowed' },

  // ── Scope/control manipulation ────────────────────────────────
  { pattern: /\bwith\s*\(/, message: 'with statement is not allowed' },
  { pattern: /\barguments\.callee\b/, message: 'arguments.callee is not allowed' },

  // ── Dangerous Node.js module patterns ─────────────────────────
  { pattern: /\bvm\b\s*\.\s*(?:createContext|runIn|compileFunction)/, message: 'vm module access is not allowed' },

  // ── Execution control ─────────────────────────────────────────
  { pattern: /\bdebugger\b/, message: 'debugger statement is not allowed' },
];

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate code against all dangerous patterns.
 * Returns a result with all errors found (not just the first one).
 */
export function validateToolCode(code: string): CodeValidationResult {
  const errors: string[] = [];

  // Size check
  if (code.length > MAX_TOOL_CODE_SIZE) {
    errors.push(`Code exceeds maximum size of ${MAX_TOOL_CODE_SIZE} characters`);
  }

  // Pattern checks
  for (const { pattern, message } of DANGEROUS_CODE_PATTERNS) {
    if (pattern.test(code)) {
      errors.push(message);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Quick check: does code contain any dangerous pattern?
 * Returns the first matching pattern's message, or null if clean.
 * Faster than validateToolCode when you only need pass/fail.
 */
export function findFirstDangerousPattern(code: string): string | null {
  if (code.length > MAX_TOOL_CODE_SIZE) {
    return `Code exceeds maximum size of ${MAX_TOOL_CODE_SIZE} characters`;
  }
  for (const { pattern, message } of DANGEROUS_CODE_PATTERNS) {
    if (pattern.test(code)) {
      return message;
    }
  }
  return null;
}

/**
 * Deep code analysis for tool review.
 * Returns structured analysis with security score and recommendations.
 */
export function analyzeToolCode(code: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    lineCount: number;
    hasAsyncCode: boolean;
    usesFetch: boolean;
    usesCallTool: boolean;
    usesUtils: boolean;
    returnsValue: boolean;
  };
} {
  const validation = validateToolCode(code);
  const warnings: string[] = [];

  // Analyze code structure
  const lines = code.split('\n');
  const hasAsyncCode = /\bawait\b/.test(code);
  const usesFetch = /\bfetch\s*\(/.test(code);
  const usesCallTool = /utils\s*\.\s*callTool\b/.test(code);
  const usesUtils = /\butils\s*\./.test(code);
  const returnsValue = /\breturn\b/.test(code);

  // Warnings (non-blocking)
  if (!returnsValue) {
    warnings.push('Code does not contain a return statement — tool will return undefined');
  }
  if (usesFetch && !code.includes('try')) {
    warnings.push('fetch() calls should be wrapped in try/catch for error handling');
  }
  if (usesCallTool && !code.includes('try')) {
    warnings.push('callTool() calls should be wrapped in try/catch for error handling');
  }
  if (lines.length > 200) {
    warnings.push('Code is very long (200+ lines) — consider breaking into smaller tools');
  }
  if (/while\s*\(\s*true\s*\)/.test(code) || /for\s*\(\s*;\s*;\s*\)/.test(code)) {
    warnings.push('Infinite loop detected — ensure loop has a break condition');
  }

  return {
    valid: validation.valid,
    errors: validation.errors,
    warnings,
    stats: {
      lineCount: lines.length,
      hasAsyncCode,
      usesFetch,
      usesCallTool,
      usesUtils,
      returnsValue,
    },
  };
}
