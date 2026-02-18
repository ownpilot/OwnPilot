/**
 * ExtensionTools Tests
 *
 * Tests for all 3 extension AI tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeExtensionTool } from './extension-tools.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  getAll: vi.fn(),
  getById: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
};

vi.mock('../services/extension-service.js', () => ({
  getExtensionService: () => mockService,
}));

vi.mock('@ownpilot/core', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const samplePackage = {
  id: 'github-assistant',
  name: 'GitHub Assistant',
  version: '1.0.0',
  description: 'GitHub integration tools',
  category: 'developer',
  icon: 'octocat',
  status: 'enabled',
  toolCount: 2,
  triggerCount: 1,
  authorName: 'Community',
  sourcePath: '/skills/github-assistant',
  installedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  errorMessage: undefined,
  manifest: {
    id: 'github-assistant',
    name: 'GitHub Assistant',
    version: '1.0.0',
    description: 'GitHub integration tools',
    tools: [
      { name: 'github_list_issues', description: 'List issues', parameters: { type: 'object', properties: {} }, code: 'return {}', permissions: ['network'] },
      { name: 'github_create_issue', description: 'Create issue', parameters: { type: 'object', properties: {} }, code: 'return {}' },
    ],
    triggers: [
      { name: 'Daily digest', type: 'schedule', config: { cron: '0 9 * * *' }, action: { type: 'chat', payload: { prompt: 'Check issues' } }, enabled: false },
    ],
    required_services: [
      { name: 'github', display_name: 'GitHub' },
    ],
    system_prompt: 'Use GitHub tools when asked about repos.',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeExtensionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list_extensions', () => {
    it('lists all packages', async () => {
      mockService.getAll.mockReturnValue([samplePackage]);

      const result = await executeExtensionTool('list_extensions', {});

      expect(result.success).toBe(true);
      expect(result.result).toHaveLength(1);
      expect((result.result as Array<{ id: string }>)[0].id).toBe('github-assistant');
    });

    it('filters by status', async () => {
      mockService.getAll.mockReturnValue([
        { ...samplePackage, status: 'enabled' },
        { ...samplePackage, id: 'disabled-pkg', status: 'disabled' },
      ]);

      const result = await executeExtensionTool('list_extensions', { status: 'enabled' });

      expect(result.success).toBe(true);
      expect(result.result).toHaveLength(1);
    });

    it('filters by category', async () => {
      mockService.getAll.mockReturnValue([
        { ...samplePackage, category: 'developer' },
        { ...samplePackage, id: 'other-pkg', category: 'productivity' },
      ]);

      const result = await executeExtensionTool('list_extensions', { category: 'developer' });

      expect(result.success).toBe(true);
      expect(result.result).toHaveLength(1);
    });

    it('returns empty list when no packages match', async () => {
      mockService.getAll.mockReturnValue([]);

      const result = await executeExtensionTool('list_extensions', {});

      expect(result.success).toBe(true);
      expect(result.result).toHaveLength(0);
    });
  });

  describe('toggle_extension', () => {
    it('enables a package', async () => {
      mockService.enable.mockResolvedValue({ ...samplePackage, status: 'enabled' });

      const result = await executeExtensionTool('toggle_extension', {
        id: 'github-assistant',
        enabled: true,
      });

      expect(result.success).toBe(true);
      expect(mockService.enable).toHaveBeenCalledWith('github-assistant', 'default');
      expect((result.result as { status: string }).status).toBe('enabled');
    });

    it('disables a package', async () => {
      mockService.disable.mockResolvedValue({ ...samplePackage, status: 'disabled' });

      const result = await executeExtensionTool('toggle_extension', {
        id: 'github-assistant',
        enabled: false,
      });

      expect(result.success).toBe(true);
      expect(mockService.disable).toHaveBeenCalledWith('github-assistant', 'default');
      expect((result.result as { status: string }).status).toBe('disabled');
    });

    it('returns error when package not found', async () => {
      mockService.enable.mockResolvedValue(null);

      const result = await executeExtensionTool('toggle_extension', {
        id: 'missing',
        enabled: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error on failure', async () => {
      mockService.enable.mockRejectedValue(new Error('DB error'));

      const result = await executeExtensionTool('toggle_extension', {
        id: 'github-assistant',
        enabled: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB error');
    });
  });

  describe('get_extension_info', () => {
    it('returns detailed package info', async () => {
      mockService.getById.mockReturnValue(samplePackage);

      const result = await executeExtensionTool('get_extension_info', {
        id: 'github-assistant',
      });

      expect(result.success).toBe(true);
      const info = result.result as Record<string, unknown>;
      expect(info.id).toBe('github-assistant');
      expect(info.toolCount).toBe(2);
      expect(info.triggerCount).toBe(1);
      expect(info.tools).toHaveLength(2);
      expect(info.triggers).toHaveLength(1);
      expect(info.systemPrompt).toBe('(present)');
      expect(info.requiredServices).toHaveLength(1);
    });

    it('returns error when package not found', async () => {
      mockService.getById.mockReturnValue(null);

      const result = await executeExtensionTool('get_extension_info', {
        id: 'missing',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeExtensionTool('unknown_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown');
    });
  });
});
