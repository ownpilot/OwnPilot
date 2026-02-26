import { describe, it, expect } from 'vitest';
import type { ExecutionPermissions } from '@ownpilot/core';
import { downgradePromptToBlocked, isNonInteractiveContext } from './permission-utils.js';

describe('permission-utils', () => {
  describe('downgradePromptToBlocked', () => {
    const basePerms: ExecutionPermissions = {
      enabled: true,
      mode: 'local',
      execute_javascript: 'allowed',
      execute_python: 'prompt',
      execute_shell: 'blocked',
      compile_code: 'prompt',
      package_manager: 'allowed',
    };

    it('downgrades prompt to blocked', () => {
      const result = downgradePromptToBlocked(basePerms);
      expect(result.execute_python).toBe('blocked');
      expect(result.compile_code).toBe('blocked');
    });

    it('preserves allowed permissions', () => {
      const result = downgradePromptToBlocked(basePerms);
      expect(result.execute_javascript).toBe('allowed');
      expect(result.package_manager).toBe('allowed');
    });

    it('preserves already-blocked permissions', () => {
      const result = downgradePromptToBlocked(basePerms);
      expect(result.execute_shell).toBe('blocked');
    });

    it('preserves enabled and mode fields', () => {
      const result = downgradePromptToBlocked(basePerms);
      expect(result.enabled).toBe(true);
      expect(result.mode).toBe('local');
    });

    it('does not mutate the original object', () => {
      const original = { ...basePerms };
      downgradePromptToBlocked(basePerms);
      expect(basePerms).toEqual(original);
    });

    it('handles all-prompt permissions', () => {
      const allPrompt: ExecutionPermissions = {
        enabled: true,
        mode: 'docker',
        execute_javascript: 'prompt',
        execute_python: 'prompt',
        execute_shell: 'prompt',
        compile_code: 'prompt',
        package_manager: 'prompt',
      };
      const result = downgradePromptToBlocked(allPrompt);
      expect(result.execute_javascript).toBe('blocked');
      expect(result.execute_python).toBe('blocked');
      expect(result.execute_shell).toBe('blocked');
      expect(result.compile_code).toBe('blocked');
      expect(result.package_manager).toBe('blocked');
    });

    it('handles all-allowed permissions (no changes)', () => {
      const allAllowed: ExecutionPermissions = {
        enabled: true,
        mode: 'local',
        execute_javascript: 'allowed',
        execute_python: 'allowed',
        execute_shell: 'allowed',
        compile_code: 'allowed',
        package_manager: 'allowed',
      };
      const result = downgradePromptToBlocked(allAllowed);
      expect(result).toEqual(allAllowed);
    });
  });

  describe('isNonInteractiveContext', () => {
    it('returns true for trigger', () => {
      expect(isNonInteractiveContext('trigger')).toBe(true);
    });

    it('returns true for plan', () => {
      expect(isNonInteractiveContext('plan')).toBe(true);
    });

    it('returns true for workflow', () => {
      expect(isNonInteractiveContext('workflow')).toBe(true);
    });

    it('returns true for system', () => {
      expect(isNonInteractiveContext('system')).toBe(true);
    });

    it('returns false for chat', () => {
      expect(isNonInteractiveContext('chat')).toBe(false);
    });

    it('returns false for skill', () => {
      expect(isNonInteractiveContext('skill')).toBe(false);
    });

    it('returns false for coding-agent', () => {
      expect(isNonInteractiveContext('coding-agent')).toBe(false);
    });
  });
});
