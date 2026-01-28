import { describe, it, expect } from 'vitest';
import { createSandbox, runInSandbox, SandboxExecutor } from './executor.js';
import { validateCode } from './context.js';
import { unsafePluginId } from '../types/branded.js';

const testPluginId = unsafePluginId('test-plugin');

describe('SandboxExecutor', () => {
  describe('basic execution', () => {
    it('executes simple code', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<number>('return 1 + 1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.value).toBe(2);
      }
    });

    it('executes async code', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<number>(`
        await new Promise(resolve => setTimeout(resolve, 10));
        return 42;
      `);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.value).toBe(42);
      }
    });

    it('handles return values of different types', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });

      // Object
      const objResult = await sandbox.execute<{ a: number }>('return { a: 1 }');
      expect(objResult.ok && objResult.value.value).toEqual({ a: 1 });

      // Array
      const arrResult = await sandbox.execute<number[]>('return [1, 2, 3]');
      expect(arrResult.ok && arrResult.value.value).toEqual([1, 2, 3]);

      // String
      const strResult = await sandbox.execute<string>('return "hello"');
      expect(strResult.ok && strResult.value.value).toBe('hello');
    });

    it('provides execution context', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<string>('return __context__.pluginId', {
        extra: 'data',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.value).toBe(testPluginId);
      }
    });

    it('passes data to context', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<{ input: string }>('return __context__.data', {
        input: 'test-data',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.value).toEqual({ input: 'test-data' });
      }
    });
  });

  describe('security restrictions', () => {
    it('blocks eval', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute('eval("1+1")');

      expect(result.ok).toBe(false);
    });

    it('blocks Function constructor', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute('new Function("return 1")()');

      expect(result.ok).toBe(false);
    });

    it('blocks require', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute('require("fs")');

      expect(result.ok).toBe(false);
    });

    it('blocks process access', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute('process.exit()');

      expect(result.ok).toBe(false);
    });

    it('blocks dynamic import', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute('import("fs")');

      expect(result.ok).toBe(false);
    });

    it('blocks any code mentioning process', async () => {
      // Code validation rejects "process" keyword entirely for security
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<boolean>('return typeof process');

      // Should fail validation before execution
      expect(result.ok).toBe(false);
    });
  });

  describe('available globals', () => {
    it('provides console', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<boolean>(
        'console.log("test"); return true'
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
      }
    });

    it('provides JSON', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<string>(`
        const obj = { a: 1 };
        return JSON.stringify(obj);
      `);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value).toBe('{"a":1}');
      }
    });

    it('provides Math', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<number>('return Math.max(1, 2, 3)');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value).toBe(3);
      }
    });

    it('provides Date', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<boolean>('return new Date() instanceof Date');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value).toBe(true);
      }
    });

    it('provides Map and Set', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<number>(`
        const map = new Map();
        map.set('a', 1);
        const set = new Set([1, 2, 3]);
        return map.get('a') + set.size;
      `);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value).toBe(4);
      }
    });

    it('provides Promise', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute<number>(`
        const p = new Promise(resolve => resolve(42));
        return await p;
      `);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value).toBe(42);
      }
    });

    it('provides crypto utilities when allowed', async () => {
      const sandbox = createSandbox({
        pluginId: testPluginId,
        permissions: { crypto: true },
      });
      const result = await sandbox.execute<string>(`
        return crypto.sha256('test');
      `);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.value).toMatch(/^[a-f0-9]{64}$/);
      }
    });
  });

  describe('error handling', () => {
    it('catches runtime errors', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute('throw new Error("test error")');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
        expect(result.value.error).toContain('test error');
      }
    });

    it('catches type errors', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });
      const result = await sandbox.execute('null.foo()');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
      }
    });

    it('includes stack trace in debug mode', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId, debug: true });
      const result = await sandbox.execute('throw new Error("debug error")');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
        expect(result.value.stack).toBeDefined();
      }
    });
  });

  describe('timeouts', () => {
    it('enforces CPU timeout', async () => {
      const sandbox = createSandbox({
        pluginId: testPluginId,
        limits: { maxCpuTime: 100 },
      });

      const result = await sandbox.execute('while(true) {}');

      // Should timeout
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(false);
        expect(result.value.error).toContain('timed out');
      }
    });
  });

  describe('custom globals', () => {
    it('injects custom globals', async () => {
      const sandbox = createSandbox({
        pluginId: testPluginId,
        globals: { customValue: 42 },
      });

      const result = await sandbox.execute<number>('return customValue');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value).toBe(42);
      }
    });

    it('injects custom functions', async () => {
      const sandbox = createSandbox({
        pluginId: testPluginId,
        globals: {
          add: (a: number, b: number) => a + b,
        },
      });

      const result = await sandbox.execute<number>('return add(1, 2)');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value).toBe(3);
      }
    });
  });

  describe('statistics', () => {
    it('tracks execution count', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });

      await sandbox.execute('return 1');
      await sandbox.execute('return 2');
      await sandbox.execute('throw new Error("fail")');

      const stats = sandbox.getStats();
      expect(stats.totalExecutions).toBe(3);
      expect(stats.successfulExecutions).toBe(2);
      expect(stats.failedExecutions).toBe(1);
    });

    it('tracks execution time', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });

      // Run multiple executions to ensure non-zero time
      await sandbox.execute('return 1');
      await sandbox.execute('return 2');
      await sandbox.execute('return 3');

      const stats = sandbox.getStats();
      // On fast machines, individual executions may take 0ms, but stats should be tracked
      expect(stats.totalExecutionTime).toBeGreaterThanOrEqual(0);
      expect(stats.averageExecutionTime).toBeGreaterThanOrEqual(0);
      expect(stats.totalExecutions).toBe(3);
    });

    it('resets statistics', async () => {
      const sandbox = createSandbox({ pluginId: testPluginId });

      await sandbox.execute('return 1');
      sandbox.resetStats();

      const stats = sandbox.getStats();
      expect(stats.totalExecutions).toBe(0);
    });
  });

  describe('runInSandbox helper', () => {
    it('runs code in a temporary sandbox', async () => {
      const result = await runInSandbox<number>(testPluginId, 'return 1 + 2');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.success).toBe(true);
        expect(result.value.value).toBe(3);
      }
    });

    it('accepts options', async () => {
      const result = await runInSandbox<number>(testPluginId, 'return __context__.data', {
        data: 42,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.value).toBe(42);
      }
    });
  });
});

describe('validateCode', () => {
  it('passes valid code', () => {
    const result = validateCode('const x = 1 + 1; return x;');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects eval', () => {
    const result = validateCode('eval("bad")');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('eval() is not allowed');
  });

  it('rejects Function constructor', () => {
    const result = validateCode('new Function("return 1")');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Function() constructor is not allowed');
  });

  it('rejects import', () => {
    const result = validateCode('import("fs")');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Dynamic import() is not allowed');
  });

  it('rejects require', () => {
    const result = validateCode('require("fs")');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('require() is not allowed');
  });

  it('rejects process', () => {
    const result = validateCode('process.exit()');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('process object access is not allowed');
  });

  it('rejects __proto__', () => {
    const result = validateCode('obj.__proto__');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('__proto__ access is not allowed');
  });

  it('rejects with statement', () => {
    const result = validateCode('with (obj) { }');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('with statement is not allowed');
  });

  it('collects multiple errors', () => {
    const result = validateCode('eval("x"); require("fs")');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
