/**
 * Tests for config/escape-hatches.ts
 */

import { describe, it, expect, vi } from 'vitest';

const warn = vi.fn();

vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { ESCAPE_HATCHES, getActiveEscapeHatches, logActiveEscapeHatches } =
  await import('./escape-hatches.js');

describe('config/escape-hatches', () => {
  describe('getActiveEscapeHatches', () => {
    it('reports nothing for a clean environment', () => {
      expect(getActiveEscapeHatches({})).toEqual([]);
    });

    it('detects an active flag', () => {
      const active = getActiveEscapeHatches({ ALLOW_HOME_DIR_ACCESS: 'true' });
      expect(active).toHaveLength(1);
      expect(active[0]!.env).toBe('ALLOW_HOME_DIR_ACCESS');
    });

    it('ignores a flag set to a non-activating value', () => {
      expect(getActiveEscapeHatches({ ALLOW_HOME_DIR_ACCESS: 'false' })).toEqual([]);
      expect(getActiveEscapeHatches({ ALLOW_HOME_DIR_ACCESS: '1' })).toEqual([]);
    });

    it('honours the "1"-not-"true" convention of OWNPILOT_ALLOW_LOCAL_EXEC', () => {
      // This flag is checked with `=== '1'` in code-execution.ts. Setting it to
      // "true" does NOT enable local execution, and the registry must agree
      // with the code rather than assume a uniform convention.
      expect(getActiveEscapeHatches({ OWNPILOT_ALLOW_LOCAL_EXEC: 'true' })).toEqual([]);
      expect(getActiveEscapeHatches({ OWNPILOT_ALLOW_LOCAL_EXEC: '1' })).toHaveLength(1);
    });

    it('detects several at once', () => {
      const active = getActiveEscapeHatches({
        ALLOW_HOME_DIR_ACCESS: 'true',
        EXPOSE_INTERNAL_ERRORS: 'true',
        OWNPILOT_ALLOW_LOCAL_EXEC: '1',
      });
      expect(active.map((h) => h.env).sort()).toEqual([
        'ALLOW_HOME_DIR_ACCESS',
        'EXPOSE_INTERNAL_ERRORS',
        'OWNPILOT_ALLOW_LOCAL_EXEC',
      ]);
    });
  });

  describe('logActiveEscapeHatches', () => {
    it('stays silent when nothing is active', () => {
      warn.mockClear();
      logActiveEscapeHatches({});
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns once per active hatch plus a summary line', () => {
      warn.mockClear();
      logActiveEscapeHatches({ ALLOW_HOME_DIR_ACCESS: 'true', EXPOSE_INTERNAL_ERRORS: 'true' });
      expect(warn).toHaveBeenCalledTimes(3);
      expect(warn.mock.calls[0]![0]).toContain('2 security escape hatches are active');
      expect(warn.mock.calls.some((c) => String(c[0]).includes('ALLOW_HOME_DIR_ACCESS'))).toBe(
        true
      );
    });

    it('uses singular phrasing for a single hatch', () => {
      warn.mockClear();
      logActiveEscapeHatches({ EXPOSE_INTERNAL_ERRORS: 'true' });
      expect(warn.mock.calls[0]![0]).toContain('1 security escape hatch is active');
    });
  });

  describe('registry integrity', () => {
    it('has unique env names', () => {
      const names = ESCAPE_HATCHES.map((h) => h.env);
      expect(new Set(names).size).toBe(names.length);
    });

    it('documents what every flag disables', () => {
      for (const hatch of ESCAPE_HATCHES) {
        expect(hatch.disables.length).toBeGreaterThan(0);
        expect(hatch.activeValue.length).toBeGreaterThan(0);
      }
    });

    it('lists every flag in .env.example', async () => {
      // Guards the failure mode this module exists to prevent: a flag that
      // disables a protection but is not discoverable by an operator.
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const envExample = readFileSync(
        fileURLToPath(new URL('../../../../.env.example', import.meta.url)),
        'utf-8'
      );
      for (const hatch of ESCAPE_HATCHES) {
        expect(envExample, `${hatch.env} missing from .env.example`).toContain(hatch.env);
      }
    });
  });
});
