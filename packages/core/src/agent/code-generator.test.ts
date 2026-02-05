/**
 * Tests for CodeGenerator, createCodeGenerator, executeCodeSnippet,
 * and related types/exports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks - vi.hoisted ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const { mockCreateSandbox, mockValidateCode, mockCreatePluginId, mockSandboxExecutor } =
  vi.hoisted(() => {
    const mockSandboxExecutor = {
      execute: vi.fn(),
    };

    const mockCreateSandbox = vi.fn(() => mockSandboxExecutor);

    const mockValidateCode = vi.fn(() => ({ valid: true, errors: [] }));

    const mockCreatePluginId = vi.fn((id: string) => id);

    return { mockCreateSandbox, mockValidateCode, mockCreatePluginId, mockSandboxExecutor };
  });

vi.mock('../sandbox/executor.js', () => ({
  createSandbox: mockCreateSandbox,
}));

vi.mock('../sandbox/context.js', () => ({
  validateCode: mockValidateCode,
}));

vi.mock('../types/branded.js', () => ({
  createPluginId: mockCreatePluginId,
}));

// Import after mocks are declared
import {
  CodeGenerator,
  createCodeGenerator,
  executeCodeSnippet,
} from './code-generator.js';
import type {
  CodeLanguage,
  CodeGenerationRequest,
  CodeGenerationResponse,
  CodeExecutionResult,
  CodeSnippet,
  CodeLLMProvider,
  CodeGeneratorConfig,
} from './code-generator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLLMProvider(overrides: Partial<CodeLLMProvider> = {}): CodeLLMProvider {
  return {
    generateCode: vi.fn().mockResolvedValue({
      code: 'console.log("hello")',
      explanation: 'Prints hello',
      tokensUsed: { prompt: 10, completion: 20 },
      model: 'test-model',
    }),
    improveCode: vi.fn().mockResolvedValue({
      code: 'improved code',
      changes: ['change1'],
      tokensUsed: { prompt: 5, completion: 10 },
    }),
    explainCode: vi.fn().mockResolvedValue({
      explanation: 'This code does X',
      complexity: 'simple' as const,
    }),
    ...overrides,
  };
}

// =============================================================================
// CodeGenerator - constructor
// =============================================================================

describe('CodeGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations
    mockValidateCode.mockReturnValue({ valid: true, errors: [] });
    mockSandboxExecutor.execute.mockResolvedValue({
      ok: true,
      value: { value: 42, memoryUsed: 1024 },
    });
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const generator = new CodeGenerator();
      expect(generator).toBeInstanceOf(CodeGenerator);
    });

    it('should create instance with partial config overrides', () => {
      const generator = new CodeGenerator({
        defaultLanguage: 'python',
        maxCodeLength: 10000,
      });
      expect(generator).toBeInstanceOf(CodeGenerator);
    });

    it('should accept an LLM provider via config', () => {
      const provider = makeLLMProvider();
      const generator = new CodeGenerator({ llmProvider: provider });
      expect(generator).toBeInstanceOf(CodeGenerator);
    });

    it('should accept full config with all properties', () => {
      const generator = new CodeGenerator({
        defaultLanguage: 'typescript',
        maxCodeLength: 5000,
        executionTimeout: 10000,
        sandboxPermissions: { network: true },
        resourceLimits: { maxMemory: 32 * 1024 * 1024 },
        autoExecute: true,
      });
      expect(generator).toBeInstanceOf(CodeGenerator);
    });

    it('should default to no LLM provider when not supplied', async () => {
      const generator = new CodeGenerator();
      // Without LLM provider, generate should fall back to template-based
      const result = await generator.generate({ prompt: 'fibonacci' });
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // setLLMProvider
  // =============================================================================

  describe('setLLMProvider', () => {
    it('should set the LLM provider', async () => {
      const generator = new CodeGenerator();
      const provider = makeLLMProvider();
      generator.setLLMProvider(provider);

      await generator.generate({ prompt: 'hello world' });
      expect(provider.generateCode).toHaveBeenCalled();
    });

    it('should replace an existing LLM provider', async () => {
      const provider1 = makeLLMProvider();
      const provider2 = makeLLMProvider();
      const generator = new CodeGenerator({ llmProvider: provider1 });

      generator.setLLMProvider(provider2);
      await generator.generate({ prompt: 'hello world' });
      expect(provider1.generateCode).not.toHaveBeenCalled();
      expect(provider2.generateCode).toHaveBeenCalled();
    });

    it('should allow generating code with the new provider', async () => {
      const generator = new CodeGenerator();
      const provider = makeLLMProvider({
        generateCode: vi.fn().mockResolvedValue({
          code: 'return 42;',
          explanation: 'returns 42',
          tokensUsed: { prompt: 5, completion: 10 },
          model: 'custom-model',
        }),
      });

      generator.setLLMProvider(provider);
      const result = await generator.generate({ prompt: 'return 42' });
      expect(result.success).toBe(true);
      expect(result.code).toBe('return 42;');
      expect(result.metadata.modelUsed).toBe('custom-model');
    });
  });

  // =============================================================================
  // generate
  // =============================================================================

  describe('generate', () => {
    it('should generate code with LLM provider when available', async () => {
      const provider = makeLLMProvider();
      const generator = new CodeGenerator({ llmProvider: provider });

      const result = await generator.generate({
        prompt: 'create a function',
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.code).toBe('console.log("hello")');
      expect(result.language).toBe('javascript');
      expect(result.explanation).toBe('Prints hello');
      expect(result.metadata.validationPassed).toBe(true);
      expect(result.metadata.promptTokens).toBe(10);
      expect(result.metadata.completionTokens).toBe(20);
      expect(result.metadata.modelUsed).toBe('test-model');
    });

    it('should use default language when not specified in request', async () => {
      const provider = makeLLMProvider();
      const generator = new CodeGenerator({
        llmProvider: provider,
        defaultLanguage: 'typescript',
      });

      const result = await generator.generate({ prompt: 'create a function' });
      expect(result.language).toBe('typescript');
      expect(provider.generateCode).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'typescript' })
      );
    });

    it('should pass context and examples to LLM provider', async () => {
      const provider = makeLLMProvider();
      const generator = new CodeGenerator({ llmProvider: provider });

      const examples = [{ input: 'a', output: 'b' }];
      await generator.generate({
        prompt: 'extend code',
        context: 'existing code',
        examples,
      });

      expect(provider.generateCode).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'existing code',
          examples,
        })
      );
    });

    it('should return failure when LLM-generated code fails validation', async () => {
      mockValidateCode.mockReturnValue({
        valid: false,
        errors: ['eval() is not allowed'],
      });

      const provider = makeLLMProvider();
      const generator = new CodeGenerator({ llmProvider: provider });

      const result = await generator.generate({ prompt: 'some code' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('validation failed');
      expect(result.metadata.validationPassed).toBe(false);
    });

    it('should execute code when request.execute is true and language is executable', async () => {
      const provider = makeLLMProvider();
      const generator = new CodeGenerator({ llmProvider: provider });

      const result = await generator.generate({
        prompt: 'compute something',
        language: 'javascript',
        execute: true,
        timeout: 5000,
        inputData: { x: 1 },
      });

      expect(result.success).toBe(true);
      expect(result.execution).toBeDefined();
      expect(result.execution!.success).toBe(true);
    });

    it('should not execute code when language is not executable', async () => {
      const provider = makeLLMProvider();
      const generator = new CodeGenerator({ llmProvider: provider });

      const result = await generator.generate({
        prompt: 'generate python code',
        language: 'python',
        execute: true,
      });

      expect(result.success).toBe(true);
      expect(result.execution).toBeUndefined();
    });

    it('should not execute code when request.execute is false', async () => {
      const provider = makeLLMProvider();
      const generator = new CodeGenerator({ llmProvider: provider });

      const result = await generator.generate({
        prompt: 'compute something',
        language: 'javascript',
        execute: false,
      });

      expect(result.success).toBe(true);
      expect(result.execution).toBeUndefined();
    });

    it('should handle LLM provider throwing an error', async () => {
      const provider = makeLLMProvider({
        generateCode: vi.fn().mockRejectedValue(new Error('LLM API error')),
      });
      const generator = new CodeGenerator({ llmProvider: provider });

      const result = await generator.generate({ prompt: 'something' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('LLM API error');
      expect(result.metadata.validationPassed).toBe(false);
    });

    it('should handle non-Error thrown values', async () => {
      const provider = makeLLMProvider({
        generateCode: vi.fn().mockRejectedValue('string error'),
      });
      const generator = new CodeGenerator({ llmProvider: provider });

      const result = await generator.generate({ prompt: 'something' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('should use template-based generation when no LLM provider', async () => {
      const generator = new CodeGenerator();

      const result = await generator.generate({
        prompt: 'generate fibonacci sequence',
        language: 'javascript',
      });

      expect(result.success).toBe(true);
      expect(result.code).toContain('fibonacci');
      expect(result.explanation).toBeDefined();
    });

    it('should return failure for unknown template when no LLM provider', async () => {
      const generator = new CodeGenerator();

      const result = await generator.generate({
        prompt: 'create a blockchain',
        language: 'javascript',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not generate code from prompt');
    });

    it('should return failure for language without templates and no LLM', async () => {
      const generator = new CodeGenerator();

      const result = await generator.generate({
        prompt: 'do something',
        language: 'sql',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No templates available');
    });

    it('should set generatedAt in metadata', async () => {
      const generator = new CodeGenerator();
      const result = await generator.generate({
        prompt: 'fibonacci',
        language: 'javascript',
      });

      expect(result.metadata.generatedAt).toBeDefined();
      // Should be a valid ISO date
      expect(() => new Date(result.metadata.generatedAt)).not.toThrow();
    });
  });

  // =============================================================================
  // generate - template-based (without LLM)
  // =============================================================================

  describe('generate - template matching', () => {
    it('should match fibonacci template', async () => {
      const generator = new CodeGenerator();
      const result = await generator.generate({
        prompt: 'fibonacci',
        language: 'javascript',
      });
      expect(result.success).toBe(true);
      expect(result.code).toContain('fibonacci');
    });

    it('should match fib template', async () => {
      const generator = new CodeGenerator();
      const result = await generator.generate({
        prompt: 'calculate fib number',
        language: 'javascript',
      });
      expect(result.success).toBe(true);
      expect(result.code).toContain('fibonacci');
    });

    it('should match factorial template', async () => {
      const generator = new CodeGenerator();
      const result = await generator.generate({
        prompt: 'factorial function',
        language: 'javascript',
      });
      expect(result.success).toBe(true);
      expect(result.code).toContain('factorial');
    });

    it('should match prime template', async () => {
      const generator = new CodeGenerator();
      const result = await generator.generate({
        prompt: 'check prime number',
        language: 'javascript',
      });
      expect(result.success).toBe(true);
      expect(result.code).toContain('isPrime');
    });

    it('should match sort/quicksort template', async () => {
      const generator = new CodeGenerator();
      const result = await generator.generate({
        prompt: 'quicksort algorithm',
        language: 'javascript',
      });
      expect(result.success).toBe(true);
      expect(result.code).toContain('quickSort');
    });

    it('should match date format template', async () => {
      const generator = new CodeGenerator();
      const result = await generator.generate({
        prompt: 'format a date',
        language: 'javascript',
      });
      expect(result.success).toBe(true);
      expect(result.code).toContain('formatDate');
    });

    it('should match array/sum/average template', async () => {
      const generator = new CodeGenerator();
      const result = await generator.generate({
        prompt: 'calculate array sum',
        language: 'javascript',
      });
      expect(result.success).toBe(true);
      expect(result.code).toContain('arrayUtils');
    });

    it('should match python fibonacci template', async () => {
      const generator = new CodeGenerator();
      const result = await generator.generate({
        prompt: 'fibonacci function',
        language: 'python',
      });
      expect(result.success).toBe(true);
      expect(result.code).toContain('fibonacci');
      expect(result.code).toContain('def');
    });

    it('should be case-insensitive for pattern matching', async () => {
      const generator = new CodeGenerator();
      const result = await generator.generate({
        prompt: 'Generate Fibonacci Sequence',
        language: 'javascript',
      });
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // execute
  // =============================================================================

  describe('execute', () => {
    it('should execute JavaScript code in sandbox', async () => {
      const generator = new CodeGenerator();
      const result = await generator.execute('1 + 1', 'javascript');

      expect(result.success).toBe(true);
      expect(result.output).toBe(42);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(mockCreateSandbox).toHaveBeenCalled();
      expect(mockCreatePluginId).toHaveBeenCalledWith('code-generator');
    });

    it('should execute TypeScript code in sandbox', async () => {
      const generator = new CodeGenerator();
      const result = await generator.execute('const x: number = 1;', 'typescript');

      expect(result.success).toBe(true);
    });

    it('should return failure for non-executable languages', async () => {
      const generator = new CodeGenerator();
      const languages: CodeLanguage[] = ['python', 'shell', 'sql', 'html', 'css', 'json', 'markdown'];

      for (const lang of languages) {
        const result = await generator.execute('some code', lang);
        expect(result.success).toBe(false);
        expect(result.error).toContain('cannot be executed in sandbox');
        expect(result.duration).toBe(0);
      }
    });

    it('should return failure when code validation fails', async () => {
      mockValidateCode.mockReturnValue({
        valid: false,
        errors: ['eval() is not allowed', 'require() is not allowed'],
      });

      const generator = new CodeGenerator();
      const result = await generator.execute('eval("bad")', 'javascript');

      expect(result.success).toBe(false);
      expect(result.error).toContain('validation failed');
      expect(result.error).toContain('eval() is not allowed');
      expect(result.duration).toBe(0);
    });

    it('should pass input data to sandbox', async () => {
      const generator = new CodeGenerator();
      await generator.execute('return __input__', 'javascript', {
        inputData: { x: 10 },
      });

      expect(mockCreateSandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          globals: expect.objectContaining({
            __input__: { x: 10 },
          }),
        })
      );
    });

    it('should use custom timeout when provided', async () => {
      const generator = new CodeGenerator();
      await generator.execute('1 + 1', 'javascript', { timeout: 5000 });

      expect(mockCreateSandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          limits: expect.objectContaining({
            maxExecutionTime: 5000,
          }),
        })
      );
    });

    it('should use default execution timeout when not specified', async () => {
      const generator = new CodeGenerator({ executionTimeout: 15000 });
      await generator.execute('1 + 1', 'javascript');

      expect(mockCreateSandbox).toHaveBeenCalledWith(
        expect.objectContaining({
          limits: expect.objectContaining({
            maxExecutionTime: 15000,
          }),
        })
      );
    });

    it('should handle sandbox execution failure (result not ok)', async () => {
      mockSandboxExecutor.execute.mockResolvedValue({
        ok: false,
        error: { message: 'Execution timed out' },
      });

      const generator = new CodeGenerator();
      const result = await generator.execute('while(true){}', 'javascript');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Execution timed out');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle sandbox throwing an unexpected error', async () => {
      mockSandboxExecutor.execute.mockRejectedValue(new Error('Sandbox crashed'));

      const generator = new CodeGenerator();
      const result = await generator.execute('broken code', 'javascript');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sandbox crashed');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle sandbox throwing a non-Error value', async () => {
      mockSandboxExecutor.execute.mockRejectedValue('string crash');

      const generator = new CodeGenerator();
      const result = await generator.execute('broken code', 'javascript');

      expect(result.success).toBe(false);
      expect(result.error).toBe('string crash');
    });

    it('should track execution history when userId is provided', async () => {
      const generator = new CodeGenerator();
      await generator.execute('1 + 1', 'javascript', { userId: 'user-1' });

      const stats = generator.getStats('user-1');
      expect(stats.totalExecutions).toBe(1);
      expect(stats.successRate).toBe(1);
    });

    it('should not track execution history when userId is not provided', async () => {
      const generator = new CodeGenerator();
      await generator.execute('1 + 1', 'javascript');

      const stats = generator.getStats();
      expect(stats.totalExecutions).toBe(0);
    });

    it('should return memoryUsed from sandbox result', async () => {
      mockSandboxExecutor.execute.mockResolvedValue({
        ok: true,
        value: { value: 'result', memoryUsed: 2048 },
      });

      const generator = new CodeGenerator();
      const result = await generator.execute('some code', 'javascript');

      expect(result.success).toBe(true);
      expect(result.memoryUsed).toBe(2048);
    });
  });

  // =============================================================================
  // validateCode
  // =============================================================================

  describe('validateCode', () => {
    it('should return valid for clean JavaScript code', () => {
      mockValidateCode.mockReturnValue({ valid: true, errors: [] });
      const generator = new CodeGenerator();
      const result = generator.validateCode('const x = 1;', 'javascript');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return valid for clean TypeScript code', () => {
      mockValidateCode.mockReturnValue({ valid: true, errors: [] });
      const generator = new CodeGenerator();
      const result = generator.validateCode('const x: number = 1;', 'typescript');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject code exceeding maxCodeLength', () => {
      const generator = new CodeGenerator({ maxCodeLength: 10 });
      const result = generator.validateCode('a'.repeat(11), 'javascript');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('exceeds maximum length'))).toBe(true);
    });

    it('should call sandbox validateCode for JS/TS languages', () => {
      mockValidateCode.mockReturnValue({ valid: true, errors: [] });
      const generator = new CodeGenerator();

      generator.validateCode('const x = 1;', 'javascript');
      expect(mockValidateCode).toHaveBeenCalledWith('const x = 1;');

      mockValidateCode.mockClear();
      generator.validateCode('const y: string = "";', 'typescript');
      expect(mockValidateCode).toHaveBeenCalledWith('const y: string = "";');
    });

    it('should not call sandbox validateCode for non-JS/TS languages', () => {
      const generator = new CodeGenerator();
      generator.validateCode('SELECT * FROM table', 'sql');
      expect(mockValidateCode).not.toHaveBeenCalled();
    });

    it('should detect process.exit pattern', () => {
      const generator = new CodeGenerator();
      const result = generator.validateCode('process.exit(1)', 'python');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('process.exit'))).toBe(true);
    });

    it('should detect require("child_process") pattern', () => {
      const generator = new CodeGenerator();
      const result = generator.validateCode('require("child_process")', 'python');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('child_process'))).toBe(true);
    });

    it('should detect require("fs") pattern', () => {
      const generator = new CodeGenerator();
      const result = generator.validateCode("require('fs')", 'python');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('fs module'))).toBe(true);
    });

    it('should detect eval() pattern', () => {
      const generator = new CodeGenerator();
      const result = generator.validateCode('eval("code")', 'python');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('eval'))).toBe(true);
    });

    it('should detect Function constructor pattern', () => {
      const generator = new CodeGenerator();
      const result = generator.validateCode('Function("return 1")', 'python');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Function constructor'))).toBe(true);
    });

    it('should detect dynamic import pattern', () => {
      const generator = new CodeGenerator();
      const result = generator.validateCode('import("os")', 'python');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('dynamic import'))).toBe(true);
    });

    it('should collect multiple errors', () => {
      const generator = new CodeGenerator({ maxCodeLength: 5 });
      // This code has length > 5 AND contains eval
      const result = generator.validateCode('eval("test code")', 'python');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('should return valid for non-JS code without dangerous patterns', () => {
      const generator = new CodeGenerator();
      const result = generator.validateCode('SELECT id FROM users', 'sql');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should propagate errors from sandbox validateCode', () => {
      mockValidateCode.mockReturnValue({
        valid: false,
        errors: ['constructor access is not allowed'],
      });

      const generator = new CodeGenerator();
      const result = generator.validateCode('arr.constructor', 'javascript');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('constructor access is not allowed');
    });
  });

  // =============================================================================
  // isExecutable
  // =============================================================================

  describe('isExecutable', () => {
    it('should return true for javascript', () => {
      const generator = new CodeGenerator();
      expect(generator.isExecutable('javascript')).toBe(true);
    });

    it('should return true for typescript', () => {
      const generator = new CodeGenerator();
      expect(generator.isExecutable('typescript')).toBe(true);
    });

    it('should return false for python', () => {
      const generator = new CodeGenerator();
      expect(generator.isExecutable('python')).toBe(false);
    });

    it('should return false for all non-JS/TS languages', () => {
      const generator = new CodeGenerator();
      const nonExecutable: CodeLanguage[] = [
        'python',
        'shell',
        'sql',
        'html',
        'css',
        'json',
        'markdown',
      ];
      for (const lang of nonExecutable) {
        expect(generator.isExecutable(lang)).toBe(false);
      }
    });
  });

  // =============================================================================
  // saveSnippet
  // =============================================================================

  describe('saveSnippet', () => {
    it('should save a snippet and return it with generated fields', () => {
      const generator = new CodeGenerator();
      const snippet = generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'const x = 1;',
        description: 'Variable declaration',
        tags: ['basics'],
      });

      expect(snippet.id).toMatch(/^snippet_/);
      expect(snippet.userId).toBe('user-1');
      expect(snippet.language).toBe('javascript');
      expect(snippet.code).toBe('const x = 1;');
      expect(snippet.description).toBe('Variable declaration');
      expect(snippet.tags).toEqual(['basics']);
      expect(snippet.createdAt).toBeDefined();
      expect(snippet.updatedAt).toBeDefined();
      expect(snippet.executionCount).toBe(0);
    });

    it('should save multiple snippets for the same user', () => {
      const generator = new CodeGenerator();
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code1',
        description: 'desc1',
        tags: [],
      });
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'python',
        code: 'code2',
        description: 'desc2',
        tags: [],
      });

      const snippets = generator.getSnippets('user-1');
      expect(snippets).toHaveLength(2);
    });

    it('should save snippets for different users independently', () => {
      const generator = new CodeGenerator();
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code1',
        description: 'desc1',
        tags: [],
      });
      generator.saveSnippet('user-2', {
        userId: 'user-2',
        language: 'python',
        code: 'code2',
        description: 'desc2',
        tags: [],
      });

      expect(generator.getSnippets('user-1')).toHaveLength(1);
      expect(generator.getSnippets('user-2')).toHaveLength(1);
    });

    it('should generate unique IDs for each snippet', () => {
      const generator = new CodeGenerator();
      const snippet1 = generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code1',
        description: 'desc1',
        tags: [],
      });
      const snippet2 = generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code2',
        description: 'desc2',
        tags: [],
      });

      expect(snippet1.id).not.toBe(snippet2.id);
    });

    it('should set createdAt and updatedAt to the same value on creation', () => {
      const generator = new CodeGenerator();
      const snippet = generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code',
        description: 'desc',
        tags: [],
      });

      expect(snippet.createdAt).toBe(snippet.updatedAt);
    });
  });

  // =============================================================================
  // getSnippets
  // =============================================================================

  describe('getSnippets', () => {
    it('should return empty array for user with no snippets', () => {
      const generator = new CodeGenerator();
      expect(generator.getSnippets('unknown-user')).toEqual([]);
    });

    it('should return all snippets for a user when no filter', () => {
      const generator = new CodeGenerator();
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code1',
        description: 'desc1',
        tags: ['a'],
      });
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'python',
        code: 'code2',
        description: 'desc2',
        tags: ['b'],
      });

      expect(generator.getSnippets('user-1')).toHaveLength(2);
    });

    it('should filter by language', () => {
      const generator = new CodeGenerator();
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code1',
        description: 'desc1',
        tags: [],
      });
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'python',
        code: 'code2',
        description: 'desc2',
        tags: [],
      });

      const filtered = generator.getSnippets('user-1', { language: 'javascript' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.language).toBe('javascript');
    });

    it('should filter by tags (all tags must match)', () => {
      const generator = new CodeGenerator();
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code1',
        description: 'desc1',
        tags: ['util', 'math'],
      });
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code2',
        description: 'desc2',
        tags: ['util'],
      });

      // Only the first snippet has both tags
      const filtered = generator.getSnippets('user-1', { tags: ['util', 'math'] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.code).toBe('code1');
    });

    it('should filter by both language and tags', () => {
      const generator = new CodeGenerator();
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code1',
        description: 'desc1',
        tags: ['util'],
      });
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'python',
        code: 'code2',
        description: 'desc2',
        tags: ['util'],
      });

      const filtered = generator.getSnippets('user-1', {
        language: 'javascript',
        tags: ['util'],
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.language).toBe('javascript');
    });

    it('should return empty array when no snippets match filter', () => {
      const generator = new CodeGenerator();
      generator.saveSnippet('user-1', {
        userId: 'user-1',
        language: 'javascript',
        code: 'code1',
        description: 'desc1',
        tags: ['a'],
      });

      const filtered = generator.getSnippets('user-1', { language: 'python' });
      expect(filtered).toHaveLength(0);
    });
  });

  // =============================================================================
  // getStats
  // =============================================================================

  describe('getStats', () => {
    it('should return zero stats when no executions', () => {
      const generator = new CodeGenerator();
      const stats = generator.getStats();

      expect(stats.totalExecutions).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.averageDuration).toBe(0);
      expect(stats.byLanguage).toEqual({});
    });

    it('should return stats for a specific user', async () => {
      const generator = new CodeGenerator();

      await generator.execute('1 + 1', 'javascript', { userId: 'user-1' });
      await generator.execute('2 + 2', 'javascript', { userId: 'user-2' });

      const stats = generator.getStats('user-1');
      expect(stats.totalExecutions).toBe(1);
    });

    it('should return aggregated stats when no user specified', async () => {
      const generator = new CodeGenerator();

      await generator.execute('1 + 1', 'javascript', { userId: 'user-1' });
      await generator.execute('2 + 2', 'javascript', { userId: 'user-2' });

      const stats = generator.getStats();
      expect(stats.totalExecutions).toBe(2);
    });

    it('should calculate success rate correctly', async () => {
      const generator = new CodeGenerator();

      // First execution succeeds
      mockSandboxExecutor.execute.mockResolvedValueOnce({
        ok: true,
        value: { value: 1 },
      });
      await generator.execute('1 + 1', 'javascript', { userId: 'user-1' });

      // Second execution fails
      mockSandboxExecutor.execute.mockResolvedValueOnce({
        ok: false,
        error: { message: 'failed' },
      });
      await generator.execute('bad', 'javascript', { userId: 'user-1' });

      const stats = generator.getStats('user-1');
      expect(stats.totalExecutions).toBe(2);
      expect(stats.successRate).toBe(0.5);
    });

    it('should track stats by language', async () => {
      const generator = new CodeGenerator();

      await generator.execute('1+1', 'javascript', { userId: 'user-1' });
      await generator.execute('2+2', 'typescript', { userId: 'user-1' });

      const stats = generator.getStats('user-1');
      expect(stats.byLanguage['javascript']).toBeDefined();
      expect(stats.byLanguage['javascript']!.count).toBe(1);
      expect(stats.byLanguage['typescript']).toBeDefined();
      expect(stats.byLanguage['typescript']!.count).toBe(1);
    });

    it('should calculate per-language success rates', async () => {
      const generator = new CodeGenerator();

      // JS success
      mockSandboxExecutor.execute.mockResolvedValueOnce({
        ok: true,
        value: { value: 1 },
      });
      await generator.execute('1', 'javascript', { userId: 'user-1' });

      // JS failure
      mockSandboxExecutor.execute.mockResolvedValueOnce({
        ok: false,
        error: { message: 'err' },
      });
      await generator.execute('bad', 'javascript', { userId: 'user-1' });

      // TS success
      mockSandboxExecutor.execute.mockResolvedValueOnce({
        ok: true,
        value: { value: 1 },
      });
      await generator.execute('1', 'typescript', { userId: 'user-1' });

      const stats = generator.getStats('user-1');
      expect(stats.byLanguage['javascript']!.successRate).toBe(0.5);
      expect(stats.byLanguage['typescript']!.successRate).toBe(1);
    });

    it('should return empty stats for user with no executions', () => {
      const generator = new CodeGenerator();
      const stats = generator.getStats('nonexistent-user');

      expect(stats.totalExecutions).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.averageDuration).toBe(0);
      expect(stats.byLanguage).toEqual({});
    });
  });
});

// =============================================================================
// createCodeGenerator (factory function)
// =============================================================================

describe('createCodeGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateCode.mockReturnValue({ valid: true, errors: [] });
  });

  it('should create a CodeGenerator instance with defaults', () => {
    const generator = createCodeGenerator();
    expect(generator).toBeInstanceOf(CodeGenerator);
  });

  it('should create a CodeGenerator instance with custom config', () => {
    const generator = createCodeGenerator({
      defaultLanguage: 'typescript',
      maxCodeLength: 10000,
    });
    expect(generator).toBeInstanceOf(CodeGenerator);
  });

  it('should create a CodeGenerator that works for template generation', async () => {
    const generator = createCodeGenerator();
    const result = await generator.generate({
      prompt: 'fibonacci',
      language: 'javascript',
    });
    expect(result.success).toBe(true);
  });

  it('should create a CodeGenerator with LLM provider', async () => {
    const provider = makeLLMProvider();
    const generator = createCodeGenerator({ llmProvider: provider });

    await generator.generate({ prompt: 'hello' });
    expect(provider.generateCode).toHaveBeenCalled();
  });

  it('should accept empty config object', () => {
    const generator = createCodeGenerator({});
    expect(generator).toBeInstanceOf(CodeGenerator);
  });
});

// =============================================================================
// executeCodeSnippet (standalone function)
// =============================================================================

describe('executeCodeSnippet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateCode.mockReturnValue({ valid: true, errors: [] });
    mockSandboxExecutor.execute.mockResolvedValue({
      ok: true,
      value: { value: 'result', memoryUsed: 512 },
    });
  });

  it('should execute JavaScript code with default options', async () => {
    const result = await executeCodeSnippet('1 + 1');
    expect(result.success).toBe(true);
    expect(result.output).toBe('result');
  });

  it('should default to javascript language', async () => {
    await executeCodeSnippet('1 + 1');
    expect(mockCreateSandbox).toHaveBeenCalled();
  });

  it('should accept a specific language', async () => {
    const result = await executeCodeSnippet('const x: number = 1;', 'typescript');
    expect(result.success).toBe(true);
  });

  it('should return failure for non-executable languages', async () => {
    const result = await executeCodeSnippet('print("hi")', 'python');
    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot be executed');
  });

  it('should pass timeout option', async () => {
    await executeCodeSnippet('1 + 1', 'javascript', { timeout: 3000 });
    expect(mockCreateSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        limits: expect.objectContaining({
          maxExecutionTime: 3000,
        }),
      })
    );
  });

  it('should pass inputData option', async () => {
    await executeCodeSnippet('return __input__', 'javascript', {
      inputData: [1, 2, 3],
    });
    expect(mockCreateSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        globals: expect.objectContaining({
          __input__: [1, 2, 3],
        }),
      })
    );
  });

  it('should handle sandbox execution failures', async () => {
    mockSandboxExecutor.execute.mockResolvedValue({
      ok: false,
      error: { message: 'runtime error' },
    });

    const result = await executeCodeSnippet('bad code');
    expect(result.success).toBe(false);
    expect(result.error).toBe('runtime error');
  });
});

// =============================================================================
// Type exports (compile-time validation)
// =============================================================================

describe('type exports', () => {
  it('should export CodeLanguage type (compile-time check)', () => {
    const _lang: CodeLanguage = 'javascript';
    expect(_lang).toBe('javascript');
  });

  it('should export CodeGenerationRequest type (compile-time check)', () => {
    const _req: CodeGenerationRequest = {
      prompt: 'test',
      language: 'javascript',
      execute: false,
    };
    expect(_req.prompt).toBe('test');
  });

  it('should export CodeGenerationResponse type (compile-time check)', () => {
    const _resp: CodeGenerationResponse = {
      success: true,
      language: 'javascript',
      metadata: {
        generatedAt: new Date().toISOString(),
        validationPassed: true,
      },
    };
    expect(_resp.success).toBe(true);
  });

  it('should export CodeExecutionResult type (compile-time check)', () => {
    const _result: CodeExecutionResult = {
      success: true,
      duration: 100,
    };
    expect(_result.success).toBe(true);
  });

  it('should export CodeSnippet type (compile-time check)', () => {
    const _snippet: CodeSnippet = {
      id: 'test',
      userId: 'user-1',
      language: 'javascript',
      code: 'code',
      description: 'desc',
      tags: [],
      createdAt: '',
      updatedAt: '',
      executionCount: 0,
    };
    expect(_snippet.id).toBe('test');
  });

  it('should export CodeLLMProvider type (compile-time check)', () => {
    const _provider: CodeLLMProvider = {
      generateCode: vi.fn(),
      improveCode: vi.fn(),
      explainCode: vi.fn(),
    };
    expect(_provider.generateCode).toBeDefined();
  });

  it('should export CodeGeneratorConfig type (compile-time check)', () => {
    const _config: Partial<CodeGeneratorConfig> = {
      defaultLanguage: 'python',
      maxCodeLength: 1000,
    };
    expect(_config.defaultLanguage).toBe('python');
  });
});
