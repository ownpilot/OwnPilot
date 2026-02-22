import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getExecutionMode, getExecutionModeConfig, isLanguageAllowed } from './execution-mode.js';

describe('execution-mode', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'EXECUTION_MODE',
    'LOCAL_EXEC_REQUIRE_APPROVAL',
    'LOCAL_EXEC_LANGUAGES',
    'LOCAL_EXEC_TIMEOUT',
    'LOCAL_EXEC_MAX_OUTPUT',
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe('getExecutionMode', () => {
    it('returns auto by default when EXECUTION_MODE is not set', () => {
      expect(getExecutionMode()).toBe('auto');
    });

    it('returns docker when EXECUTION_MODE is docker', () => {
      process.env.EXECUTION_MODE = 'docker';
      expect(getExecutionMode()).toBe('docker');
    });

    it('returns local when EXECUTION_MODE is local', () => {
      process.env.EXECUTION_MODE = 'local';
      expect(getExecutionMode()).toBe('local');
    });

    it('returns auto when EXECUTION_MODE is auto', () => {
      process.env.EXECUTION_MODE = 'auto';
      expect(getExecutionMode()).toBe('auto');
    });

    it('is case insensitive - DOCKER', () => {
      process.env.EXECUTION_MODE = 'DOCKER';
      expect(getExecutionMode()).toBe('docker');
    });

    it('is case insensitive - Local', () => {
      process.env.EXECUTION_MODE = 'Local';
      expect(getExecutionMode()).toBe('local');
    });

    it('is case insensitive - AUTO', () => {
      process.env.EXECUTION_MODE = 'AUTO';
      expect(getExecutionMode()).toBe('auto');
    });

    it('falls back to auto for unknown values', () => {
      process.env.EXECUTION_MODE = 'kubernetes';
      expect(getExecutionMode()).toBe('auto');
    });

    it('falls back to auto for empty string', () => {
      process.env.EXECUTION_MODE = '';
      expect(getExecutionMode()).toBe('auto');
    });

    it('falls back to auto for random string', () => {
      process.env.EXECUTION_MODE = 'sandbox';
      expect(getExecutionMode()).toBe('auto');
    });
  });

  describe('getExecutionModeConfig', () => {
    it('returns correct defaults when no env vars are set', () => {
      const config = getExecutionModeConfig();
      expect(config.mode).toBe('auto');
      expect(config.requireApproval).toBe(false);
      expect(config.allowedLanguages).toEqual(['javascript', 'python', 'shell']);
      expect(config.localTimeout).toBe(30000);
      expect(config.localMaxOutputSize).toBe(1024 * 1024);
    });

    it('reads mode from EXECUTION_MODE env var', () => {
      process.env.EXECUTION_MODE = 'docker';
      const config = getExecutionModeConfig();
      expect(config.mode).toBe('docker');
    });

    it('sets requireApproval to true when LOCAL_EXEC_REQUIRE_APPROVAL is true', () => {
      process.env.LOCAL_EXEC_REQUIRE_APPROVAL = 'true';
      const config = getExecutionModeConfig();
      expect(config.requireApproval).toBe(true);
    });

    it('sets requireApproval to false when LOCAL_EXEC_REQUIRE_APPROVAL is false', () => {
      process.env.LOCAL_EXEC_REQUIRE_APPROVAL = 'false';
      const config = getExecutionModeConfig();
      expect(config.requireApproval).toBe(false);
    });

    it('sets requireApproval to false for any value other than true', () => {
      process.env.LOCAL_EXEC_REQUIRE_APPROVAL = 'yes';
      const config = getExecutionModeConfig();
      expect(config.requireApproval).toBe(false);
    });

    it('sets requireApproval to false when LOCAL_EXEC_REQUIRE_APPROVAL is empty', () => {
      process.env.LOCAL_EXEC_REQUIRE_APPROVAL = '';
      const config = getExecutionModeConfig();
      expect(config.requireApproval).toBe(false);
    });

    it('parses custom languages from LOCAL_EXEC_LANGUAGES', () => {
      process.env.LOCAL_EXEC_LANGUAGES = 'ruby,go,rust';
      const config = getExecutionModeConfig();
      expect(config.allowedLanguages).toEqual(['ruby', 'go', 'rust']);
    });

    it('trims whitespace from language entries', () => {
      process.env.LOCAL_EXEC_LANGUAGES = ' ruby , go , rust ';
      const config = getExecutionModeConfig();
      expect(config.allowedLanguages).toEqual(['ruby', 'go', 'rust']);
    });

    it('handles single language', () => {
      process.env.LOCAL_EXEC_LANGUAGES = 'python';
      const config = getExecutionModeConfig();
      expect(config.allowedLanguages).toEqual(['python']);
    });

    it('parses custom timeout from LOCAL_EXEC_TIMEOUT', () => {
      process.env.LOCAL_EXEC_TIMEOUT = '60000';
      const config = getExecutionModeConfig();
      expect(config.localTimeout).toBe(60000);
    });

    it('parses custom max output from LOCAL_EXEC_MAX_OUTPUT', () => {
      process.env.LOCAL_EXEC_MAX_OUTPUT = '2097152';
      const config = getExecutionModeConfig();
      expect(config.localMaxOutputSize).toBe(2097152);
    });

    it('handles all custom env vars together', () => {
      process.env.EXECUTION_MODE = 'local';
      process.env.LOCAL_EXEC_REQUIRE_APPROVAL = 'true';
      process.env.LOCAL_EXEC_LANGUAGES = 'typescript,bash';
      process.env.LOCAL_EXEC_TIMEOUT = '10000';
      process.env.LOCAL_EXEC_MAX_OUTPUT = '512';
      const config = getExecutionModeConfig();
      expect(config).toEqual({
        mode: 'local',
        requireApproval: true,
        allowedLanguages: ['typescript', 'bash'],
        localTimeout: 10000,
        localMaxOutputSize: 512,
      });
    });
  });

  describe('isLanguageAllowed', () => {
    it('returns true for javascript (default language)', () => {
      expect(isLanguageAllowed('javascript')).toBe(true);
    });

    it('returns true for python (default language)', () => {
      expect(isLanguageAllowed('python')).toBe(true);
    });

    it('returns true for shell (default language)', () => {
      expect(isLanguageAllowed('shell')).toBe(true);
    });

    it('returns false for unknown language', () => {
      expect(isLanguageAllowed('haskell')).toBe(false);
    });

    it('is case insensitive - uppercase input matches lowercase config', () => {
      expect(isLanguageAllowed('JAVASCRIPT')).toBe(true);
    });

    it('is case insensitive - mixed case input matches lowercase config', () => {
      expect(isLanguageAllowed('Python')).toBe(true);
    });

    it('returns false for empty string', () => {
      expect(isLanguageAllowed('')).toBe(false);
    });

    it('respects custom language list from env', () => {
      process.env.LOCAL_EXEC_LANGUAGES = 'ruby,go';
      expect(isLanguageAllowed('ruby')).toBe(true);
      expect(isLanguageAllowed('go')).toBe(true);
      expect(isLanguageAllowed('javascript')).toBe(false);
    });
  });
});
