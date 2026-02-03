/**
 * Code Generator with Sandbox Execution
 *
 * AI-assisted code generation with safe execution in isolated sandbox.
 * Supports multiple languages, code validation, and execution tracking.
 */

import { createSandbox } from '../sandbox/executor.js';
import { validateCode } from '../sandbox/context.js';
import type { SandboxPermissions, ResourceLimits } from '../sandbox/types.js';
import { createPluginId } from '../types/branded.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Supported programming languages
 */
export type CodeLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'shell'
  | 'sql'
  | 'html'
  | 'css'
  | 'json'
  | 'markdown';

/**
 * Code generation request
 */
export interface CodeGenerationRequest {
  /** Natural language description of what to generate */
  prompt: string;
  /** Target language */
  language?: CodeLanguage;
  /** Code context (existing code to modify/extend) */
  context?: string;
  /** Whether to execute the generated code */
  execute?: boolean;
  /** Execution timeout in ms */
  timeout?: number;
  /** Input data for execution */
  inputData?: unknown;
  /** Specific requirements */
  requirements?: string[];
  /** Examples to follow */
  examples?: Array<{
    input: string;
    output: string;
  }>;
}

/**
 * Code generation response
 */
export interface CodeGenerationResponse {
  /** Whether generation was successful */
  success: boolean;
  /** Generated code */
  code?: string;
  /** Target language */
  language: CodeLanguage;
  /** Code explanation */
  explanation?: string;
  /** Execution result (if executed) */
  execution?: CodeExecutionResult;
  /** Error message if failed */
  error?: string;
  /** Generation metadata */
  metadata: {
    generatedAt: string;
    promptTokens?: number;
    completionTokens?: number;
    modelUsed?: string;
    validationPassed: boolean;
  };
}

/**
 * Code execution result
 */
export interface CodeExecutionResult {
  /** Whether execution was successful */
  success: boolean;
  /** Execution output */
  output?: unknown;
  /** Console logs */
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
  }>;
  /** Error if execution failed */
  error?: string;
  /** Execution duration in ms */
  duration: number;
  /** Memory used in bytes */
  memoryUsed?: number;
}

/**
 * Code snippet for storage/history
 */
export interface CodeSnippet {
  id: string;
  userId: string;
  language: CodeLanguage;
  code: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  executionCount: number;
  lastExecuted?: string;
}

/**
 * LLM interface for code generation
 */
export interface CodeLLMProvider {
  generateCode(request: {
    prompt: string;
    language: CodeLanguage;
    context?: string;
    examples?: Array<{ input: string; output: string }>;
  }): Promise<{
    code: string;
    explanation: string;
    tokensUsed: { prompt: number; completion: number };
    model: string;
  }>;

  improveCode(request: {
    code: string;
    language: CodeLanguage;
    feedback: string;
  }): Promise<{
    code: string;
    changes: string[];
    tokensUsed: { prompt: number; completion: number };
  }>;

  explainCode(request: {
    code: string;
    language: CodeLanguage;
    detail: 'brief' | 'detailed' | 'line-by-line';
  }): Promise<{
    explanation: string;
    complexity: 'simple' | 'moderate' | 'complex';
  }>;
}

// =============================================================================
// Code Generator
// =============================================================================

/**
 * Code generator configuration
 */
export interface CodeGeneratorConfig {
  /** LLM provider for code generation */
  llmProvider?: CodeLLMProvider;
  /** Default language */
  defaultLanguage: CodeLanguage;
  /** Maximum code length */
  maxCodeLength: number;
  /** Execution timeout */
  executionTimeout: number;
  /** Sandbox permissions */
  sandboxPermissions: Partial<SandboxPermissions>;
  /** Resource limits */
  resourceLimits: Partial<ResourceLimits>;
  /** Whether to auto-execute safe code */
  autoExecute: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: CodeGeneratorConfig = {
  defaultLanguage: 'javascript',
  maxCodeLength: 50000,
  executionTimeout: 30000,
  sandboxPermissions: {
    timers: true,
    crypto: true,
    network: false,
    env: false,
    spawn: false,
    fsRead: false,
    fsWrite: false,
  },
  resourceLimits: {
    maxExecutionTime: 30000,
    maxMemory: 64 * 1024 * 1024, // 64MB
    maxCpuTime: 30000,
  },
  autoExecute: false,
};

/**
 * Code Generator with Sandbox Execution
 */
export class CodeGenerator {
  private config: CodeGeneratorConfig;
  private llmProvider?: CodeLLMProvider;
  private snippetStorage: Map<string, CodeSnippet[]> = new Map();
  private executionHistory: Array<{
    userId: string;
    language: CodeLanguage;
    success: boolean;
    duration: number;
    timestamp: string;
  }> = [];

  constructor(config: Partial<CodeGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.llmProvider = config.llmProvider;
  }

  /**
   * Set LLM provider
   */
  setLLMProvider(provider: CodeLLMProvider): void {
    this.llmProvider = provider;
  }

  /**
   * Generate code from natural language
   */
  async generate(request: CodeGenerationRequest): Promise<CodeGenerationResponse> {
    const language = request.language ?? this.config.defaultLanguage;
    const _startTime = Date.now();

    try {
      // Without LLM provider, use template-based generation
      if (!this.llmProvider) {
        return this.generateWithoutLLM(request, language);
      }

      // Generate with LLM
      const llmResult = await this.llmProvider.generateCode({
        prompt: request.prompt,
        language,
        context: request.context,
        examples: request.examples,
      });

      // Validate generated code
      const validation = this.validateCode(llmResult.code, language);

      if (!validation.valid) {
        return {
          success: false,
          language,
          error: `Generated code validation failed: ${validation.errors.join(', ')}`,
          metadata: {
            generatedAt: new Date().toISOString(),
            promptTokens: llmResult.tokensUsed.prompt,
            completionTokens: llmResult.tokensUsed.completion,
            modelUsed: llmResult.model,
            validationPassed: false,
          },
        };
      }

      // Execute if requested
      let execution: CodeExecutionResult | undefined;
      if (request.execute && this.isExecutable(language)) {
        execution = await this.execute(llmResult.code, language, {
          timeout: request.timeout,
          inputData: request.inputData,
        });
      }

      return {
        success: true,
        code: llmResult.code,
        language,
        explanation: llmResult.explanation,
        execution,
        metadata: {
          generatedAt: new Date().toISOString(),
          promptTokens: llmResult.tokensUsed.prompt,
          completionTokens: llmResult.tokensUsed.completion,
          modelUsed: llmResult.model,
          validationPassed: true,
        },
      };
    } catch (error) {
      return {
        success: false,
        language,
        error: error instanceof Error ? error.message : String(error),
        metadata: {
          generatedAt: new Date().toISOString(),
          validationPassed: false,
        },
      };
    }
  }

  /**
   * Execute code in sandbox
   */
  async execute(
    code: string,
    language: CodeLanguage,
    options: {
      timeout?: number;
      inputData?: unknown;
      userId?: string;
    } = {}
  ): Promise<CodeExecutionResult> {
    const timeout = options.timeout ?? this.config.executionTimeout;
    const startTime = Date.now();

    // Only JavaScript/TypeScript can be executed in sandbox
    if (!this.isExecutable(language)) {
      return {
        success: false,
        error: `Language '${language}' cannot be executed in sandbox. Only JavaScript is supported.`,
        duration: 0,
      };
    }

    // Validate code before execution
    const validation = this.validateCode(code, language);
    if (!validation.valid) {
      return {
        success: false,
        error: `Code validation failed: ${validation.errors.join(', ')}`,
        duration: 0,
      };
    }

    try {
      // Create sandbox
      const pluginId = createPluginId('code-generator');
      const sandbox = createSandbox({
        pluginId,
        permissions: this.config.sandboxPermissions,
        limits: {
          ...this.config.resourceLimits,
          maxExecutionTime: timeout,
        },
        globals: {
          __input__: options.inputData,
        },
      });

      // Wrap code to capture return value
      const wrappedCode = this.wrapCodeForExecution(code, language);

      // Execute
      const result = await sandbox.execute<unknown>(wrappedCode, options.inputData);
      const duration = Date.now() - startTime;

      // Track execution
      if (options.userId) {
        this.executionHistory.push({
          userId: options.userId,
          language,
          success: result.ok,
          duration,
          timestamp: new Date().toISOString(),
        });
      }

      if (result.ok) {
        const execResult = result.value;
        return {
          success: true,
          output: execResult.value,
          duration,
          memoryUsed: execResult.memoryUsed,
        };
      } else {
        return {
          success: false,
          error: result.error.message,
          duration,
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
      };
    }
  }

  /**
   * Validate code
   */
  validateCode(code: string, language: CodeLanguage): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check length
    if (code.length > this.config.maxCodeLength) {
      errors.push(`Code exceeds maximum length of ${this.config.maxCodeLength} characters`);
    }

    // Language-specific validation
    if (language === 'javascript' || language === 'typescript') {
      const jsValidation = validateCode(code);
      if (!jsValidation.valid) {
        errors.push(...jsValidation.errors);
      }
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      { pattern: /process\.exit/i, message: 'process.exit is not allowed' },
      { pattern: /require\s*\(\s*['"]child_process['"]/i, message: 'child_process is not allowed' },
      { pattern: /require\s*\(\s*['"]fs['"]/i, message: 'fs module is not allowed (use provided APIs)' },
      { pattern: /eval\s*\(/i, message: 'eval is not allowed' },
      { pattern: /Function\s*\(/i, message: 'Function constructor is not allowed' },
      { pattern: /import\s*\(/i, message: 'dynamic import is not allowed' },
    ];

    for (const { pattern, message } of dangerousPatterns) {
      if (pattern.test(code)) {
        errors.push(message);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Check if language is executable in sandbox
   */
  isExecutable(language: CodeLanguage): boolean {
    return language === 'javascript' || language === 'typescript';
  }

  /**
   * Wrap code for execution
   */
  private wrapCodeForExecution(code: string, _language: CodeLanguage): string {
    // For TypeScript, would need to transpile first
    // For now, assume JavaScript or already transpiled

    // Check if code already returns/exports something
    if (code.includes('module.exports') || code.includes('export ')) {
      // Module-style code
      return `
        const __module__ = { exports: {} };
        const module = __module__;
        const exports = __module__.exports;
        ${code}
        __module__.exports;
      `;
    }

    // Check if it's an expression or statements
    if (code.trim().startsWith('function ') || code.includes('const ') || code.includes('let ') || code.includes('var ')) {
      // Statement-based code - wrap in IIFE
      return `
        (function() {
          ${code}
        })();
      `;
    }

    // Expression - evaluate directly
    return code;
  }

  /**
   * Generate code without LLM (template-based)
   */
  private generateWithoutLLM(
    request: CodeGenerationRequest,
    language: CodeLanguage
  ): CodeGenerationResponse {
    const templates = CODE_TEMPLATES[language];
    if (!templates) {
      return {
        success: false,
        language,
        error: `No templates available for ${language}. LLM provider required for code generation.`,
        metadata: {
          generatedAt: new Date().toISOString(),
          validationPassed: false,
        },
      };
    }

    // Try to match a template
    const prompt = request.prompt.toLowerCase();
    for (const template of templates) {
      if (template.patterns.some(p => prompt.includes(p))) {
        const code = template.generate(request.prompt, request.context);
        return {
          success: true,
          code,
          language,
          explanation: template.description,
          metadata: {
            generatedAt: new Date().toISOString(),
            validationPassed: true,
          },
        };
      }
    }

    return {
      success: false,
      language,
      error: 'Could not generate code from prompt. Please provide more specific requirements or enable LLM provider.',
      metadata: {
        generatedAt: new Date().toISOString(),
        validationPassed: false,
      },
    };
  }

  /**
   * Save code snippet
   */
  saveSnippet(userId: string, snippet: Omit<CodeSnippet, 'id' | 'createdAt' | 'updatedAt' | 'executionCount'>): CodeSnippet {
    const now = new Date().toISOString();
    const newSnippet: CodeSnippet = {
      ...snippet,
      id: `snippet_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      userId,
      createdAt: now,
      updatedAt: now,
      executionCount: 0,
    };

    const userSnippets = this.snippetStorage.get(userId) ?? [];
    userSnippets.push(newSnippet);
    this.snippetStorage.set(userId, userSnippets);

    return newSnippet;
  }

  /**
   * Get user snippets
   */
  getSnippets(userId: string, filter?: { language?: CodeLanguage; tags?: string[] }): CodeSnippet[] {
    const snippets = this.snippetStorage.get(userId) ?? [];

    if (!filter) return snippets;

    return snippets.filter(s => {
      if (filter.language && s.language !== filter.language) return false;
      if (filter.tags && !filter.tags.every(t => s.tags.includes(t))) return false;
      return true;
    });
  }

  /**
   * Get execution statistics
   */
  getStats(userId?: string): {
    totalExecutions: number;
    successRate: number;
    averageDuration: number;
    byLanguage: Record<string, { count: number; successRate: number }>;
  } {
    const history = userId
      ? this.executionHistory.filter(h => h.userId === userId)
      : this.executionHistory;

    if (history.length === 0) {
      return {
        totalExecutions: 0,
        successRate: 0,
        averageDuration: 0,
        byLanguage: {},
      };
    }

    const successful = history.filter(h => h.success);
    const totalDuration = history.reduce((sum, h) => sum + h.duration, 0);

    const byLanguage: Record<string, { count: number; successRate: number }> = {};
    for (const h of history) {
      if (!byLanguage[h.language]) {
        byLanguage[h.language] = { count: 0, successRate: 0 };
      }
      byLanguage[h.language]!.count++;
    }

    // Calculate success rates per language
    for (const lang of Object.keys(byLanguage)) {
      const langHistory = history.filter(h => h.language === lang);
      const langSuccess = langHistory.filter(h => h.success);
      byLanguage[lang]!.successRate = langSuccess.length / langHistory.length;
    }

    return {
      totalExecutions: history.length,
      successRate: successful.length / history.length,
      averageDuration: totalDuration / history.length,
      byLanguage,
    };
  }
}

// =============================================================================
// Code Templates
// =============================================================================

interface CodeTemplate {
  patterns: string[];
  description: string;
  generate: (prompt: string, context?: string) => string;
}

const CODE_TEMPLATES: Partial<Record<CodeLanguage, CodeTemplate[]>> = {
  javascript: [
    {
      patterns: ['fibonacci', 'fib'],
      description: 'Generates Fibonacci sequence function',
      generate: () => `
/**
 * Calculate Fibonacci number at position n
 * @param {number} n - Position in sequence
 * @returns {number} Fibonacci number
 */
function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

// Example: fibonacci(10) = 55
fibonacci(10);
`.trim(),
    },
    {
      patterns: ['factorial'],
      description: 'Generates factorial function',
      generate: () => `
/**
 * Calculate factorial of n
 * @param {number} n - Input number
 * @returns {number} n!
 */
function factorial(n) {
  if (n < 0) throw new Error('Negative numbers not allowed');
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

// Example: factorial(5) = 120
factorial(5);
`.trim(),
    },
    {
      patterns: ['prime'],
      description: 'Generates prime number checker',
      generate: () => `
/**
 * Check if a number is prime
 * @param {number} n - Number to check
 * @returns {boolean} True if prime
 */
function isPrime(n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i <= Math.sqrt(n); i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

// Example: isPrime(17) = true
isPrime(17);
`.trim(),
    },
    {
      patterns: ['sort', 'quicksort'],
      description: 'Generates quicksort implementation',
      generate: () => `
/**
 * QuickSort implementation
 * @param {number[]} arr - Array to sort
 * @returns {number[]} Sorted array
 */
function quickSort(arr) {
  if (arr.length <= 1) return arr;

  const pivot = arr[Math.floor(arr.length / 2)];
  const left = arr.filter(x => x < pivot);
  const middle = arr.filter(x => x === pivot);
  const right = arr.filter(x => x > pivot);

  return [...quickSort(left), ...middle, ...quickSort(right)];
}

// Example
quickSort([3, 6, 8, 10, 1, 2, 1]);
`.trim(),
    },
    {
      patterns: ['date', 'format'],
      description: 'Generates date formatting function',
      generate: () => `
/**
 * Format a date
 * @param {Date} date - Date to format
 * @param {string} format - Format string (YYYY, MM, DD, HH, mm, ss)
 * @returns {string} Formatted date
 */
function formatDate(date, format = 'YYYY-MM-DD') {
  const pad = (n) => String(n).padStart(2, '0');

  const replacements = {
    'YYYY': date.getFullYear(),
    'MM': pad(date.getMonth() + 1),
    'DD': pad(date.getDate()),
    'HH': pad(date.getHours()),
    'mm': pad(date.getMinutes()),
    'ss': pad(date.getSeconds()),
  };

  let result = format;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(key, String(value));
  }
  return result;
}

// Example
formatDate(new Date(), 'YYYY-MM-DD HH:mm:ss');
`.trim(),
    },
    {
      patterns: ['array', 'sum', 'average'],
      description: 'Generates array utility functions',
      generate: () => `
/**
 * Array utility functions
 */
const arrayUtils = {
  sum: (arr) => arr.reduce((a, b) => a + b, 0),
  average: (arr) => arr.length ? arrayUtils.sum(arr) / arr.length : 0,
  min: (arr) => Math.min(...arr),
  max: (arr) => Math.max(...arr),
  unique: (arr) => [...new Set(arr)],
  chunk: (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  },
};

// Examples
const numbers = [1, 2, 3, 4, 5, 5, 6];
({
  sum: arrayUtils.sum(numbers),
  average: arrayUtils.average(numbers),
  min: arrayUtils.min(numbers),
  max: arrayUtils.max(numbers),
  unique: arrayUtils.unique(numbers),
  chunked: arrayUtils.chunk(numbers, 3),
});
`.trim(),
    },
  ],
  python: [
    {
      patterns: ['fibonacci', 'fib'],
      description: 'Generates Fibonacci sequence function in Python',
      generate: () => `
def fibonacci(n: int) -> int:
    """Calculate Fibonacci number at position n."""
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

# Example: fibonacci(10) = 55
print(fibonacci(10))
`.trim(),
    },
  ],
};

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a code generator
 */
export function createCodeGenerator(config: Partial<CodeGeneratorConfig> = {}): CodeGenerator {
  return new CodeGenerator(config);
}

/**
 * Quick code execution without generator instance
 */
export async function executeCodeSnippet(
  code: string,
  language: CodeLanguage = 'javascript',
  options: {
    timeout?: number;
    inputData?: unknown;
  } = {}
): Promise<CodeExecutionResult> {
  const generator = createCodeGenerator();
  return generator.execute(code, language, options);
}
