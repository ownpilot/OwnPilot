/**
 * Skill CLI Commands Tests
 *
 * Tests skill management commands that call the gateway REST API.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  checkbox: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function apiOk<T>(data: T) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  };
}

function apiErr(message: string, status = 500) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  };
}

// ============================================================================
// Import after mocks
// ============================================================================

import {
  skillList,
  skillSearch,
  skillInstall,
  skillUninstall,
  skillEnable,
  skillDisable,
  skillCheckUpdates,
  skillAudit,
} from './skill.js';

import { select, confirm, checkbox } from '@inquirer/prompts';

describe('Skill CLI Commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  // --------------------------------------------------------------------------
  // skillList
  // --------------------------------------------------------------------------

  describe('skillList', () => {
    it('lists installed skills', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk([
          {
            id: 'smart-search',
            name: 'Smart Search',
            format: 'ownpilot',
            status: 'enabled',
            manifest: {},
            settings: {},
          },
        ])
      );

      await skillList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Installed Skills'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('smart-search'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 skill(s)'));
    });

    it('shows empty message when no skills', async () => {
      mockFetch.mockResolvedValueOnce(apiOk([]));

      await skillList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No skills installed'));
    });

    it('handles API error', async () => {
      mockFetch.mockResolvedValueOnce(apiErr('Connection refused'));

      await skillList();

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // --------------------------------------------------------------------------
  // skillSearch
  // --------------------------------------------------------------------------

  describe('skillSearch', () => {
    it('searches npm and shows results', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          packages: [
            { name: 'ownpilot-skill-search', version: '1.0.0', description: 'Search skill' },
          ],
          total: 1,
        })
      );

      await skillSearch('search');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ownpilot-skill-search'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 result'));
    });

    it('shows no results message', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ packages: [], total: 0 }));

      await skillSearch('nonexistent');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No skills found'));
    });

    it('shows usage when no query', async () => {
      await skillSearch('');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  // --------------------------------------------------------------------------
  // skillInstall
  // --------------------------------------------------------------------------

  describe('skillInstall', () => {
    it('shows usage when no name', async () => {
      await skillInstall('');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    it('installs from npm without permissions', async () => {
      // 1st call: package info
      mockFetch.mockResolvedValueOnce(
        apiOk({ name: 'test-skill', version: '1.0.0', description: 'Test' })
      );
      // 2nd call: permissions list
      mockFetch.mockResolvedValueOnce(apiOk({ permissions: [] }));
      // 3rd call: install
      mockFetch.mockResolvedValueOnce(
        apiOk({ success: true, extensionId: 'test-skill', packageName: 'test-skill', packageVersion: '1.0.0' })
      );

      await skillInstall('test-skill');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Installed test-skill'));
    });

    it('handles install failure', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ name: 'bad-skill', version: '1.0.0', description: 'Bad' })
      );
      mockFetch.mockResolvedValueOnce(apiOk({ permissions: [] }));
      mockFetch.mockResolvedValueOnce(
        apiOk({ success: false, error: 'Invalid manifest' })
      );

      await skillInstall('bad-skill');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Installation failed'));
    });

    it('installs with permission prompt', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ name: 'net-skill', version: '1.0.0', description: 'Needs network' })
      );
      mockFetch.mockResolvedValueOnce(
        apiOk({ permissions: [{ name: 'network', description: 'HTTP access', sensitivity: 'high' }] })
      );

      vi.mocked(checkbox).mockResolvedValueOnce(['network']);
      vi.mocked(confirm).mockResolvedValueOnce(true);

      mockFetch.mockResolvedValueOnce(
        apiOk({ success: true, extensionId: 'net-skill', packageName: 'net-skill', packageVersion: '1.0.0' })
      );
      // Grant permissions call
      mockFetch.mockResolvedValueOnce(apiOk(null));

      await skillInstall('net-skill');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Installed net-skill'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Permissions: network'));
    });

    it('cancels when user declines', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ name: 'skill', version: '1.0.0', description: 'Test' })
      );
      mockFetch.mockResolvedValueOnce(
        apiOk({ permissions: [{ name: 'network', description: 'HTTP', sensitivity: 'high' }] })
      );
      vi.mocked(checkbox).mockResolvedValueOnce([]);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await skillInstall('skill');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
    });
  });

  // --------------------------------------------------------------------------
  // skillUninstall
  // --------------------------------------------------------------------------

  describe('skillUninstall', () => {
    it('uninstalls by ID', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk([{ id: 'ext-1', name: 'Test Extension' }])
      );
      vi.mocked(confirm).mockResolvedValueOnce(true);
      mockFetch.mockResolvedValueOnce(apiOk(null));

      await skillUninstall('ext-1');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Uninstalled'));
    });

    it('shows not found for unknown ID', async () => {
      mockFetch.mockResolvedValueOnce(apiOk([{ id: 'other', name: 'Other' }]));

      await skillUninstall('nonexistent');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('shows empty message when no skills', async () => {
      mockFetch.mockResolvedValueOnce(apiOk([]));

      await skillUninstall();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No skills installed'));
    });
  });

  // --------------------------------------------------------------------------
  // skillEnable / skillDisable
  // --------------------------------------------------------------------------

  describe('skillEnable', () => {
    it('shows message when none disabled', async () => {
      mockFetch.mockResolvedValueOnce(apiOk([{ id: 'ext-1', status: 'enabled' }]));

      await skillEnable();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No disabled skills'));
    });
  });

  describe('skillDisable', () => {
    it('shows message when none enabled', async () => {
      mockFetch.mockResolvedValueOnce(apiOk([{ id: 'ext-1', status: 'disabled' }]));

      await skillDisable();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No enabled skills'));
    });
  });

  // --------------------------------------------------------------------------
  // skillCheckUpdates
  // --------------------------------------------------------------------------

  describe('skillCheckUpdates', () => {
    it('shows updates', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          updates: [{ id: 'ext-1', name: 'Test', current: '1.0.0', latest: '2.0.0' }],
        })
      );

      await skillCheckUpdates();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 update(s)'));
    });

    it('shows up-to-date message', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ updates: [] }));

      await skillCheckUpdates();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('up to date'));
    });
  });

  // --------------------------------------------------------------------------
  // skillAudit
  // --------------------------------------------------------------------------

  describe('skillAudit', () => {
    it('shows audit result', async () => {
      mockFetch.mockResolvedValueOnce(apiOk([{ id: 'ext-1', name: 'Test' }]));
      mockFetch.mockResolvedValueOnce(
        apiOk({ id: 'ext-1', safe: true, risk: 'low', findings: [] })
      );

      await skillAudit('ext-1');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Risk level: low'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No issues'));
    });

    it('shows findings when issues detected', async () => {
      mockFetch.mockResolvedValueOnce(apiOk([{ id: 'ext-1', name: 'Test' }]));
      mockFetch.mockResolvedValueOnce(
        apiOk({
          id: 'ext-1',
          safe: false,
          risk: 'high',
          findings: [{ severity: 'high', message: 'Uses dangerous pattern' }],
        })
      );

      await skillAudit('ext-1');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Uses dangerous pattern'));
    });

    it('shows empty message when no skills', async () => {
      mockFetch.mockResolvedValueOnce(apiOk([]));

      await skillAudit();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No skills installed'));
    });
  });
});
