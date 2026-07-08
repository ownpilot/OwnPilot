import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('../security/index.js', () => ({
  isCommandBlocked: vi.fn(() => false),
}));

import { isCommandBlocked } from '../security/index.js';
import { executeJavaScriptLocal, executePythonLocal, executeShellLocal } from './local-executor.js';

const isCommandBlockedMock = isCommandBlocked as unknown as Mock;

// These are real integration tests that spawn child processes — use real timers
vi.useRealTimers();

describe('local-executor', () => {
  beforeEach(() => {
    isCommandBlockedMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // executeJavaScriptLocal
  // ===========================================================================

  describe('executeJavaScriptLocal', () => {
    it('executes simple JS code and returns stdout', async () => {
      const result = await executeJavaScriptLocal("console.log('hello')");

      expect(result.stdout.trim()).toBe('hello');
    }, 10000);

    it('returns success=true and exitCode=0 for valid code', async () => {
      const result = await executeJavaScriptLocal("console.log('ok')");

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    }, 10000);

    it('returns success=false for code with errors', async () => {
      const result = await executeJavaScriptLocal("throw new Error('fail')");

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    }, 10000);

    it('returns stderr for error output', async () => {
      const result = await executeJavaScriptLocal("throw new Error('fail')");

      expect(result.stderr).toContain('fail');
    }, 10000);

    it('returns executionTimeMs > 0', async () => {
      const result = await executeJavaScriptLocal("console.log('timing')");

      expect(result.executionTimeMs).toBeDefined();
      expect(result.executionTimeMs).toBeGreaterThan(0);
    }, 10000);
  });

  // ===========================================================================
  // executePythonLocal
  // ===========================================================================

  describe('executePythonLocal', () => {
    it('executes simple Python code', async () => {
      const result = await executePythonLocal("print('hello')");

      // If Python is not installed, skip gracefully
      if (result.error?.includes('not found')) {
        return;
      }
      expect(result.stdout.trim()).toBe('hello');
    }, 10000);

    it('returns success=true for valid code', async () => {
      const result = await executePythonLocal("print('ok')");

      if (result.error?.includes('not found')) {
        return;
      }
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    }, 10000);

    it('returns success=false for invalid Python code', async () => {
      const result = await executePythonLocal('def broken(');

      if (result.error?.includes('not found')) {
        return;
      }
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    }, 10000);
  });

  // ===========================================================================
  // executeShellLocal
  // ===========================================================================

  describe('executeShellLocal', () => {
    it('executes simple shell command', async () => {
      const result = await executeShellLocal('echo hello');

      expect(result.stdout.trim()).toBe('hello');
    }, 10000);

    it('returns success=true and exitCode=0', async () => {
      const result = await executeShellLocal('echo ok');

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    }, 10000);

    it('blocks dangerous commands when isCommandBlocked returns true', async () => {
      isCommandBlockedMock.mockReturnValue(true);

      const result = await executeShellLocal('rm -rf /');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBeNull();
      expect(result.executionTimeMs).toBe(0);
    }, 10000);

    it('returns the blocked error message', async () => {
      isCommandBlockedMock.mockReturnValue(true);

      const result = await executeShellLocal('rm -rf /');

      expect(result.error).toBe('This command is blocked for security reasons.');
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    }, 10000);
  });

  // ===========================================================================
  // Environment sanitization
  // ===========================================================================

  describe('environment sanitization', () => {
    const ORIGINAL_ENV: Record<string, string | undefined> = {};

    beforeEach(() => {
      // Save and set sensitive env vars
      ORIGINAL_ENV.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      ORIGINAL_ENV.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      ORIGINAL_ENV.DATABASE_URL = process.env.DATABASE_URL;

      process.env.OPENAI_API_KEY = 'sk-test-openai-key-12345';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-67890';
      process.env.DATABASE_URL = 'postgres://secret:pass@localhost/db';
    });

    afterEach(() => {
      // Restore original values
      if (ORIGINAL_ENV.OPENAI_API_KEY === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = ORIGINAL_ENV.OPENAI_API_KEY;
      }
      if (ORIGINAL_ENV.ANTHROPIC_API_KEY === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV.ANTHROPIC_API_KEY;
      }
      if (ORIGINAL_ENV.DATABASE_URL === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = ORIGINAL_ENV.DATABASE_URL;
      }
    });

    it('does NOT pass OPENAI_API_KEY to child process', async () => {
      const code = "console.log(JSON.stringify(process.env.OPENAI_API_KEY ?? '__UNDEFINED__'))";
      const result = await executeJavaScriptLocal(code);

      expect(result.stdout.trim()).not.toContain('sk-test-openai-key-12345');
      expect(result.stdout.trim()).toBe('"__UNDEFINED__"');
    }, 10000);

    it('does NOT pass ANTHROPIC_API_KEY to child process', async () => {
      const code = "console.log(JSON.stringify(process.env.ANTHROPIC_API_KEY ?? '__UNDEFINED__'))";
      const result = await executeJavaScriptLocal(code);

      expect(result.stdout.trim()).not.toContain('sk-ant-test-key-67890');
      expect(result.stdout.trim()).toBe('"__UNDEFINED__"');
    }, 10000);

    it('does NOT pass DATABASE_URL to child process', async () => {
      const code = "console.log(JSON.stringify(process.env.DATABASE_URL ?? '__UNDEFINED__'))";
      const result = await executeJavaScriptLocal(code);

      expect(result.stdout.trim()).not.toContain('postgres://secret:pass@localhost/db');
      expect(result.stdout.trim()).toBe('"__UNDEFINED__"');
    }, 10000);

    it('preserves PATH in child environment', async () => {
      const code = "console.log(process.env.PATH ? 'PATH_EXISTS' : 'NO_PATH')";
      const result = await executeJavaScriptLocal(code);

      expect(result.stdout.trim()).toBe('PATH_EXISTS');
    }, 10000);
  });

  // ===========================================================================
  // Output truncation
  // ===========================================================================

  describe('output truncation', () => {
    it('truncates stdout when it exceeds maxOutputSize', async () => {
      // Generate output larger than our small maxOutputSize
      const code = "console.log('x'.repeat(200))";
      const maxOutputSize = 50;

      const result = await executeJavaScriptLocal(code, { maxOutputSize });

      // The output should be truncated and contain the truncation notice
      expect(result.stdout.length).toBeLessThan(200);
      expect(result.stdout).toContain(`... [Output truncated at ${maxOutputSize} bytes]`);
    }, 10000);

    it('terminates a runaway writer instead of accumulating output unbounded', async () => {
      // setInterval keeps the process alive while flooding stdout. Without a
      // streaming cap the buffer grows until the timeout fires; with it, the
      // child is killed as soon as output crosses the cap. We assert the latter
      // by the dedicated error message and a fast termination, not the timeout.
      const code = "setInterval(() => process.stdout.write('x'.repeat(1000)), 0)";
      const result = await executeJavaScriptLocal(code, { maxOutputSize: 500, timeout: 5000 });

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(false);
      expect(result.error).toMatch(/Output exceeded 500 bytes/);
      expect(result.executionTimeMs).toBeLessThan(4000);
    }, 10000);
  });

  // ===========================================================================
  // Options
  // ===========================================================================

  describe('options', () => {
    it('respects workspaceDir option', async () => {
      const os = await import('os');
      const tmpDir = os.tmpdir();

      const code = 'console.log(process.cwd())';
      const result = await executeJavaScriptLocal(code, { workspaceDir: tmpDir });

      expect(result.success).toBe(true);
      // Normalize paths for comparison (Windows can have different casing/separators)
      const actualCwd = result.stdout.trim().toLowerCase().replace(/\\/g, '/');
      const expectedDir = tmpDir.toLowerCase().replace(/\\/g, '/');
      expect(actualCwd).toBe(expectedDir);
    }, 10000);

    it('respects custom env variables', async () => {
      const code = 'console.log(process.env.MY_CUSTOM_VAR)';
      const result = await executeJavaScriptLocal(code, {
        env: { MY_CUSTOM_VAR: 'custom_value_42' },
      });

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('custom_value_42');
    }, 10000);
  });

  // ===========================================================================
  // Timeout handling
  // ===========================================================================

  describe('timeout', () => {
    it('returns timedOut=true for JavaScript infinite loop', async () => {
      const result = await executeJavaScriptLocal('while(true) {}', { timeout: 500 });
      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    }, 15000);

    it('returns timedOut=true for Python hang', async () => {
      const result = await executePythonLocal('import time; time.sleep(10)', { timeout: 200 });
      // Python may not be installed, skip gracefully
      if (result.error?.includes('not found')) return;
      expect(result.timedOut).toBe(true);
    }, 10000);
  });

  // ===========================================================================
  // Additional env sanitization prefixes
  // ===========================================================================

  describe('env sanitization — additional prefixes', () => {
    const ORIGINAL_ENV: Record<string, string | undefined> = {};

    beforeEach(() => {
      ORIGINAL_ENV.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
      ORIGINAL_ENV.SMTP_HOST = process.env.SMTP_HOST;
      ORIGINAL_ENV.AUTH_TOKEN = process.env.AUTH_TOKEN;
      ORIGINAL_ENV.JWT_SECRET = process.env.JWT_SECRET;
      ORIGINAL_ENV.MYAPP_CREDENTIAL = process.env.MYAPP_CREDENTIAL;

      process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST_KEY';
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.AUTH_TOKEN = 'super-secret-token';
      process.env.JWT_SECRET = 'jwt-secret-value';
      process.env.MYAPP_CREDENTIAL = 'credential-value';
    });

    afterEach(() => {
      const restore = (key: string, original: string | undefined) => {
        if (original === undefined) delete process.env[key];
        else process.env[key] = original;
      };
      restore('AWS_ACCESS_KEY_ID', ORIGINAL_ENV.AWS_ACCESS_KEY_ID);
      restore('SMTP_HOST', ORIGINAL_ENV.SMTP_HOST);
      restore('AUTH_TOKEN', ORIGINAL_ENV.AUTH_TOKEN);
      restore('JWT_SECRET', ORIGINAL_ENV.JWT_SECRET);
      restore('MYAPP_CREDENTIAL', ORIGINAL_ENV.MYAPP_CREDENTIAL);
    });

    it('strips AWS_ prefixed vars', async () => {
      const code = "console.log(JSON.stringify(process.env.AWS_ACCESS_KEY_ID ?? '__UNDEFINED__'))";
      const result = await executeJavaScriptLocal(code);
      expect(result.stdout.trim()).toBe('"__UNDEFINED__"');
    }, 10000);

    it('strips SMTP_ prefixed vars', async () => {
      const code = "console.log(JSON.stringify(process.env.SMTP_HOST ?? '__UNDEFINED__'))";
      const result = await executeJavaScriptLocal(code);
      expect(result.stdout.trim()).toBe('"__UNDEFINED__"');
    }, 10000);

    it('strips vars containing AUTH', async () => {
      const code = "console.log(JSON.stringify(process.env.AUTH_TOKEN ?? '__UNDEFINED__'))";
      const result = await executeJavaScriptLocal(code);
      expect(result.stdout.trim()).toBe('"__UNDEFINED__"');
    }, 10000);

    it('strips vars containing JWT', async () => {
      const code = "console.log(JSON.stringify(process.env.JWT_SECRET ?? '__UNDEFINED__'))";
      const result = await executeJavaScriptLocal(code);
      expect(result.stdout.trim()).toBe('"__UNDEFINED__"');
    }, 10000);

    it('strips vars containing CREDENTIAL', async () => {
      const code = "console.log(JSON.stringify(process.env.MYAPP_CREDENTIAL ?? '__UNDEFINED__'))";
      const result = await executeJavaScriptLocal(code);
      expect(result.stdout.trim()).toBe('"__UNDEFINED__"');
    }, 10000);
  });
});
