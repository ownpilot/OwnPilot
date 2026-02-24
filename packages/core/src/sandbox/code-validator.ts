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

export type SecurityScoreCategory = 'safe' | 'review' | 'dangerous';

export interface SecurityScore {
  /** Numeric score 0-100 */
  score: number;
  /** Category based on score */
  category: SecurityScoreCategory;
  /** Breakdown of score factors */
  factors: Record<string, number>;
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
 * 9. Network/data exfiltration — prevent unauthorized communications
 * 10. Scope escape vectors — prevent advanced sandbox escapes
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
  // Refined: match `global.x` or `global[x]` but not variables like `globalCount`
  { pattern: /\bglobal\s*[.[]/, message: 'global object access is not allowed' },
  { pattern: /__dirname\b/, message: '__dirname is not allowed' },
  { pattern: /__filename\b/, message: '__filename is not allowed' },

  // ── Prototype manipulation (sandbox escape vectors) ───────────
  { pattern: /__proto__/, message: '__proto__ access is not allowed' },
  // Only block .constructor property access (prototype chain escape),
  // NOT standalone `constructor` keyword (needed for class constructors)
  { pattern: /\.constructor\b/, message: 'constructor property access is not allowed' },
  { pattern: /\bgetPrototypeOf\b/, message: 'getPrototypeOf is not allowed' },
  { pattern: /\bsetPrototypeOf\b/, message: 'setPrototypeOf is not allowed' },
  { pattern: /\bReflect\.construct\b/, message: 'Reflect.construct is not allowed' },
  { pattern: /\bReflect\.apply\b/, message: 'Reflect.apply is not allowed' },

  // ── Scope/control manipulation ────────────────────────────────
  { pattern: /\bwith\s*\(/, message: 'with statement is not allowed' },
  { pattern: /\barguments\.callee\b/, message: 'arguments.callee is not allowed' },

  // ── Dangerous Node.js module patterns ─────────────────────────
  {
    pattern: /\bvm\b\s*\.\s*(?:createContext|runIn|compileFunction)/,
    message: 'vm module access is not allowed',
  },

  // ── Execution control ─────────────────────────────────────────
  { pattern: /\bdebugger\b/, message: 'debugger statement is not allowed' },

  // ── Scope escape vectors ──────────────────────────────────────
  {
    pattern: /Symbol\s*\.\s*unscopables\b/,
    message: 'Symbol.unscopables access is not allowed (scope escape vector)',
  },

  // ── Network/data exfiltration (use fetch through sandbox) ─────
  { pattern: /\bXMLHttpRequest\b/, message: 'XMLHttpRequest is not allowed (use fetch)' },
  { pattern: /\bnew\s+WebSocket\b/, message: 'WebSocket is not allowed' },

  // ── Prototype pollution via defineProperty on shared objects ───
  {
    pattern: /Object\s*\.\s*defineProperty\b/,
    message: 'Object.defineProperty is not allowed (prototype pollution risk)',
  },

  // ── Binary/WASM execution ─────────────────────────────────────
  { pattern: /\bWebAssembly\b/, message: 'WebAssembly is not allowed' },

  // ── Runtime escape vectors ──────────────────────────────────────
  { pattern: /\bDeno\s*\./, message: 'Deno namespace access is not allowed' },
  { pattern: /\bBun\s*\./, message: 'Bun namespace access is not allowed' },

  // ── Timing attack vectors ───────────────────────────────────────
  {
    pattern: /\bSharedArrayBuffer\b/,
    message: 'SharedArrayBuffer is not allowed (timing attack vector)',
  },
  { pattern: /\bAtomics\b/, message: 'Atomics is not allowed (timing attack vector)' },
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
 * Patterns that can be relaxed when 'local' permission is granted.
 * Maps permission combos to the patterns they unlock.
 */
const LOCAL_RELAXED_PATTERNS: ReadonlyArray<{
  /** Required permissions (all must be present alongside 'local') */
  requires: readonly string[];
  /** Pattern messages to allow (matched against CodeValidationPattern.message) */
  allowedMessages: readonly string[];
}> = [
  {
    // local + filesystem: allow require('fs'), require('path')
    requires: ['filesystem'],
    allowedMessages: [
      'require() is not allowed', // needed for fs, path
    ],
  },
  {
    // local + shell: allow exec/spawn (used through scoped exec API)
    requires: ['shell'],
    allowedMessages: [
      'require() is not allowed', // needed for child_process
      'child_process module is not allowed',
      'exec() is not allowed',
      'spawn() is not allowed',
      'execSync is not allowed',
      'spawnSync is not allowed',
    ],
  },
];

/**
 * Validate tool code with permission-aware pattern relaxation.
 * When 'local' permission is active, certain patterns are allowed
 * based on which other permissions are also granted.
 *
 * Always blocks: eval, Function, process.exit, prototype manipulation,
 * globalThis, debugger, WebAssembly, etc.
 */
export function validateToolCodeWithPermissions(
  code: string,
  permissions: string[] = []
): CodeValidationResult {
  // If 'local' not in permissions, use standard validation
  if (!permissions.includes('local')) {
    return validateToolCode(code);
  }

  const errors: string[] = [];

  // Size check
  if (code.length > MAX_TOOL_CODE_SIZE) {
    errors.push(`Code exceeds maximum size of ${MAX_TOOL_CODE_SIZE} characters`);
  }

  // Build the set of messages to allow based on permissions
  const allowedMessages = new Set<string>();
  for (const relaxation of LOCAL_RELAXED_PATTERNS) {
    if (relaxation.requires.every((p) => permissions.includes(p))) {
      for (const msg of relaxation.allowedMessages) {
        allowedMessages.add(msg);
      }
    }
  }

  // Pattern checks with permission-aware filtering
  for (const { pattern, message } of DANGEROUS_CODE_PATTERNS) {
    if (pattern.test(code)) {
      // Skip if this pattern is relaxed by current permissions
      if (allowedMessages.has(message)) continue;
      errors.push(message);
    }
  }

  return { valid: errors.length === 0, errors };
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

// =============================================================================
// SECURITY SCORING
// =============================================================================

/**
 * Calculate a security score (0-100) for tool code.
 * Higher scores indicate safer code.
 *
 * Factors:
 * - Code length (shorter = safer)
 * - Permission count (fewer = safer)
 * - Network usage (penalty)
 * - callTool usage (penalty)
 * - Error handling (bonus)
 * - Return statements (bonus)
 */
export function calculateSecurityScore(code: string, permissions: string[] = []): SecurityScore {
  const factors: Record<string, number> = {};
  let score = 100;

  // Code length penalty (0-15 points)
  const lines = code.split('\n').length;
  if (lines > 200) {
    factors['codeLength'] = -15;
    score -= 15;
  } else if (lines > 100) {
    factors['codeLength'] = -10;
    score -= 10;
  } else if (lines > 50) {
    factors['codeLength'] = -5;
    score -= 5;
  } else {
    factors['codeLength'] = 0;
  }

  // Permission count penalty (0-20 points)
  const permPenalty = Math.min(permissions.length * 5, 20);
  factors['permissions'] = -permPenalty;
  score -= permPenalty;

  // Network usage penalty (-10)
  if (/\bfetch\s*\(/.test(code)) {
    factors['networkUsage'] = -10;
    score -= 10;
  } else {
    factors['networkUsage'] = 0;
  }

  // callTool usage penalty (-10)
  if (/utils\s*\.\s*callTool\b/.test(code)) {
    factors['callToolUsage'] = -10;
    score -= 10;
  } else {
    factors['callToolUsage'] = 0;
  }

  // Error handling bonus (+10)
  if (code.includes('try') && code.includes('catch')) {
    factors['errorHandling'] = 10;
    score += 10;
  } else {
    factors['errorHandling'] = 0;
  }

  // Return statement bonus (+5)
  if (/\breturn\b/.test(code)) {
    factors['returnsValue'] = 5;
    score += 5;
  } else {
    factors['returnsValue'] = 0;
  }

  // Input validation bonus (+5)
  if (code.includes('typeof') || code.includes('!args.') || code.includes('=== undefined')) {
    factors['inputValidation'] = 5;
    score += 5;
  } else {
    factors['inputValidation'] = 0;
  }

  // Dangerous permission penalties
  if (permissions.includes('shell')) {
    factors['shellPermission'] = -15;
    score -= 15;
  }
  if (permissions.includes('filesystem')) {
    factors['filesystemPermission'] = -5;
    score -= 5;
  }

  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  let category: SecurityScoreCategory;
  if (score >= 80) category = 'safe';
  else if (score >= 50) category = 'review';
  else category = 'dangerous';

  return { score, category, factors };
}

// =============================================================================
// DEEP CODE ANALYSIS
// =============================================================================

/**
 * Detect data flow risks in tool code.
 * Identifies patterns where external data flows into sensitive operations.
 */
function detectDataFlowRisks(code: string): string[] {
  const risks: string[] = [];

  // Fetch result piped to callTool (potential data exfiltration)
  if (/\bfetch\b/.test(code) && /utils\s*\.\s*callTool\b/.test(code)) {
    risks.push(
      'Network data flows into callTool — ensure fetched data is validated before passing to other tools'
    );
  }

  // User input directly used in fetch URL
  if (/fetch\s*\(\s*args\./.test(code) || /fetch\s*\(\s*`[^`]*\$\{args\./.test(code)) {
    risks.push('User input used directly in fetch URL — validate/sanitize URL parameters');
  }

  // Unvalidated args in string interpolation
  if (/`[^`]*\$\{args\.[^}]+\}[^`]*`/.test(code) && !code.includes('encodeURIComponent')) {
    risks.push(
      'User arguments used in template strings without encoding — consider encodeURIComponent for URLs'
    );
  }

  return risks;
}

/**
 * Check which best practices are followed.
 */
function checkBestPractices(
  code: string,
  permissions: string[] = []
): { followed: string[]; violated: string[] } {
  const followed: string[] = [];
  const violated: string[] = [];

  // Error handling
  if (code.includes('try') && code.includes('catch')) {
    followed.push('Uses try/catch error handling');
  } else if (/\bfetch\s*\(/.test(code) || /utils\s*\.\s*callTool\b/.test(code)) {
    violated.push('Async operations should be wrapped in try/catch');
  }

  // Return value
  if (/\breturn\b/.test(code)) {
    followed.push('Returns a value');
  } else {
    violated.push('Should return a value for the LLM to use');
  }

  // Input validation
  if (code.includes('typeof') || code.includes('!args.') || code.includes('=== undefined')) {
    followed.push('Validates input arguments');
  } else {
    violated.push('Should validate required input arguments');
  }

  // API key via Config Center
  if (permissions.includes('network') && /utils\s*\.\s*getApiKey\b/.test(code)) {
    followed.push('Uses Config Center for API key management');
  } else if (permissions.includes('network') && /\bfetch\s*\(/.test(code)) {
    violated.push('Network tools should use utils.getApiKey() for API credentials');
  }

  // Response status check
  if (/\bfetch\s*\(/.test(code)) {
    if (/response\.ok\b/.test(code) || /response\.status\b/.test(code)) {
      followed.push('Checks fetch response status');
    } else {
      violated.push('Should check response.ok or response.status after fetch');
    }
  }

  return { followed, violated };
}

/**
 * Auto-detect needed permissions from code patterns.
 */
function detectSuggestedPermissions(code: string): string[] {
  const suggested: string[] = [];

  if (/\bfetch\s*\(/.test(code)) {
    suggested.push('network');
  }
  if (
    /utils\s*\.\s*callTool\s*\(\s*['"](?:read_file|write_file|list_directory|delete_file)/.test(
      code
    )
  ) {
    suggested.push('filesystem');
  }
  if (/utils\s*\.\s*callTool\s*\(\s*['"](?:execute_shell)/.test(code)) {
    suggested.push('shell');
  }
  if (/utils\s*\.\s*callTool\s*\(\s*['"](?:send_email)/.test(code)) {
    suggested.push('email');
  }

  return [...new Set(suggested)];
}

/**
 * Deep code analysis for tool review.
 * Returns structured analysis with security score, data flow risks, and recommendations.
 */
export function analyzeToolCode(
  code: string,
  permissions?: string[]
): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  securityScore: SecurityScore;
  dataFlowRisks: string[];
  bestPractices: { followed: string[]; violated: string[] };
  suggestedPermissions: string[];
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
  const perms = permissions ?? [];

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
    securityScore: calculateSecurityScore(code, perms),
    dataFlowRisks: detectDataFlowRisks(code),
    bestPractices: checkBestPractices(code, perms),
    suggestedPermissions: detectSuggestedPermissions(code),
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
