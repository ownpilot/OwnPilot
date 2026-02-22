/**
 * Config Tools Tests
 *
 * Tests the executeConfigTool function and CONFIG_TOOLS definitions,
 * including list, get (with secret masking), and set operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockConfigServicesRepo = {
  list: vi.fn(() => []),
  getByName: vi.fn(),
  getEntries: vi.fn(() => []),
  getDefaultEntry: vi.fn(),
  getEntryByLabel: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
};

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    list: (...args: unknown[]) => mockConfigServicesRepo.list(...args),
    getByName: (...args: unknown[]) => mockConfigServicesRepo.getByName(...args),
    getEntries: (...args: unknown[]) => mockConfigServicesRepo.getEntries(...args),
    getDefaultEntry: (...args: unknown[]) => mockConfigServicesRepo.getDefaultEntry(...args),
    getEntryByLabel: (...args: unknown[]) => mockConfigServicesRepo.getEntryByLabel(...args),
    createEntry: (...args: unknown[]) => mockConfigServicesRepo.createEntry(...args),
    updateEntry: (...args: unknown[]) => mockConfigServicesRepo.updateEntry(...args),
  },
}));

import { CONFIG_TOOLS, executeConfigTool } from './config-tools.js';

// Type helpers for accessing dynamic result shapes in tests
interface ServiceListResult { services: Array<Record<string, unknown>>; configured: number; unconfigured: number }
interface ServiceDetailResult { service: Record<string, unknown>; schema: unknown[]; configured: boolean; entries: Array<{ data: Record<string, unknown> }> }
interface SetEntryResult { action: string }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Config Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // CONFIG_TOOLS definitions
  // ========================================================================

  describe('CONFIG_TOOLS', () => {
    it('exports 3 tool definitions', () => {
      expect(CONFIG_TOOLS).toHaveLength(3);
    });

    it('all tools have required fields', () => {
      for (const tool of CONFIG_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
      }
    });

    it('contains expected tool names', () => {
      const names = CONFIG_TOOLS.map((t) => t.name);
      expect(names).toContain('config_list_services');
      expect(names).toContain('config_get_service');
      expect(names).toContain('config_set_entry');
    });
  });

  // ========================================================================
  // config_list_services
  // ========================================================================

  describe('config_list_services', () => {
    it('returns services with configuration status', async () => {
      mockConfigServicesRepo.list.mockReturnValue([
        { name: 'deepl', displayName: 'DeepL', category: 'translation', multiEntry: false, requiredBy: [] },
        { name: 'smtp', displayName: 'SMTP', category: 'email', multiEntry: true, requiredBy: [{ type: 'tool', name: 'send_email' }] },
      ]);
      // deepl: has configured entry
      mockConfigServicesRepo.getEntries
        .mockReturnValueOnce([{ data: { api_key: 'abc123' } }])
        // smtp: no entries
        .mockReturnValueOnce([]);

      const result = await executeConfigTool('config_list_services', {});

      expect(result.success).toBe(true);
      const { services, configured, unconfigured } = result.result as ServiceListResult;
      expect(services).toHaveLength(2);
      expect(services[0].name).toBe('deepl');
      expect(services[0].configured).toBe(true);
      expect(services[1].name).toBe('smtp');
      expect(services[1].configured).toBe(false);
      expect(configured).toBe(1);
      expect(unconfigured).toBe(1);
    });

    it('filters by category', async () => {
      mockConfigServicesRepo.list.mockReturnValue([]);

      await executeConfigTool('config_list_services', { category: 'ai' });

      expect(mockConfigServicesRepo.list).toHaveBeenCalledWith('ai');
    });

    it('treats empty/null data values as not configured', async () => {
      mockConfigServicesRepo.list.mockReturnValue([
        { name: 'svc', displayName: 'Svc', category: 'test', multiEntry: false, requiredBy: [] },
      ]);
      mockConfigServicesRepo.getEntries.mockReturnValue([
        { data: { api_key: '', base_url: null } },
      ]);

      const result = await executeConfigTool('config_list_services', {});

      const { services } = result.result as ServiceListResult;
      expect(services[0].configured).toBe(false);
    });

    it('formats requiredBy correctly', async () => {
      mockConfigServicesRepo.list.mockReturnValue([
        { name: 'svc', displayName: 'Svc', category: 'test', multiEntry: false, requiredBy: [{ type: 'tool', name: 'my_tool' }] },
      ]);
      mockConfigServicesRepo.getEntries.mockReturnValue([]);

      const result = await executeConfigTool('config_list_services', {});

      const { services } = result.result as ServiceListResult;
      expect(services[0].requiredBy).toEqual(['tool:my_tool']);
    });
  });

  // ========================================================================
  // config_get_service
  // ========================================================================

  describe('config_get_service', () => {
    it('returns service details with schema and entries', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue({
        name: 'deepl',
        displayName: 'DeepL',
        category: 'translation',
        description: 'DeepL translation',
        docsUrl: 'https://deepl.com',
        multiEntry: false,
        configSchema: [
          { name: 'api_key', label: 'API Key', type: 'secret', required: true },
          { name: 'base_url', label: 'Base URL', type: 'text', required: false, defaultValue: 'https://api.deepl.com' },
        ],
      });
      mockConfigServicesRepo.getEntries.mockReturnValue([
        { id: 'e1', label: 'Default', isDefault: true, isActive: true, data: { api_key: 'sk-123456789abcdef', base_url: 'https://api.deepl.com' } },
      ]);

      const result = await executeConfigTool('config_get_service', { service: 'deepl' });

      expect(result.success).toBe(true);
      const content = result.result as ServiceDetailResult;
      expect(content.service.name).toBe('deepl');
      expect(content.schema).toHaveLength(2);
      expect(content.configured).toBe(true);

      // Secret field should be masked
      const entry = content.entries[0];
      expect(entry.data.api_key).toBe('sk-1...cdef');
      // Non-secret field should be plain
      expect(entry.data.base_url).toBe('https://api.deepl.com');
    });

    it('returns error for unknown service', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(null);

      const result = await executeConfigTool('config_get_service', { service: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Service not found');
    });

    it('does not mask empty secret fields', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue({
        name: 'svc',
        displayName: 'Svc',
        category: 'test',
        configSchema: [
          { name: 'api_key', label: 'API Key', type: 'secret', required: true },
        ],
      });
      mockConfigServicesRepo.getEntries.mockReturnValue([
        { id: 'e1', label: 'Default', isDefault: true, isActive: true, data: { api_key: '' } },
      ]);

      const result = await executeConfigTool('config_get_service', { service: 'svc' });

      const entry = (result.result as ServiceDetailResult).entries[0];
      expect(entry.data.api_key).toBe('');
    });
  });

  // ========================================================================
  // config_set_entry
  // ========================================================================

  describe('config_set_entry', () => {
    it('creates new entry when none exists', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue({
        name: 'deepl',
        configSchema: [{ name: 'api_key', label: 'API Key', type: 'secret', required: true }],
      });
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);
      mockConfigServicesRepo.createEntry.mockResolvedValue({
        id: 'new-entry',
        label: 'Default',
      });

      const result = await executeConfigTool('config_set_entry', {
        service: 'deepl',
        data: { api_key: 'sk-new-key' },
      });

      expect(result.success).toBe(true);
      expect((result.result as SetEntryResult).action).toBe('created');
      expect(mockConfigServicesRepo.createEntry).toHaveBeenCalledWith('deepl', {
        data: { api_key: 'sk-new-key' },
        label: 'Default',
        isDefault: true,
      });
    });

    it('updates existing default entry', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue({
        name: 'deepl',
        configSchema: [
          { name: 'api_key', label: 'API Key', type: 'secret', required: true },
          { name: 'base_url', label: 'Base URL', type: 'text', required: false },
        ],
      });
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue({
        id: 'existing-entry',
        label: 'Default',
        data: { api_key: 'old-key', base_url: 'https://old.api.com' },
      });

      const result = await executeConfigTool('config_set_entry', {
        service: 'deepl',
        data: { api_key: 'new-key' },
      });

      expect(result.success).toBe(true);
      expect((result.result as SetEntryResult).action).toBe('updated');
      expect(mockConfigServicesRepo.updateEntry).toHaveBeenCalledWith(
        'existing-entry',
        expect.objectContaining({
          data: { api_key: 'new-key', base_url: 'https://old.api.com' },
        }),
      );
    });

    it('uses label to find entry for multi-entry services', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue({
        name: 'smtp',
        configSchema: [{ name: 'host', label: 'Host', type: 'text', required: true }],
      });
      mockConfigServicesRepo.getEntryByLabel.mockReturnValue({
        id: 'labeled-entry',
        label: 'Work',
        data: { host: 'smtp.work.com' },
      });

      const result = await executeConfigTool('config_set_entry', {
        service: 'smtp',
        data: { host: 'smtp.new-work.com' },
        label: 'Work',
      });

      expect(result.success).toBe(true);
      expect(mockConfigServicesRepo.getEntryByLabel).toHaveBeenCalledWith('smtp', 'Work');
      expect(mockConfigServicesRepo.updateEntry).toHaveBeenCalled();
    });

    it('strips masked secret values from update', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue({
        name: 'deepl',
        configSchema: [
          { name: 'api_key', label: 'API Key', type: 'secret', required: true },
          { name: 'base_url', label: 'Base URL', type: 'text', required: false },
        ],
      });
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue({
        id: 'e1',
        label: 'Default',
        data: { api_key: 'real-secret-key', base_url: 'https://api.deepl.com' },
      });

      const result = await executeConfigTool('config_set_entry', {
        service: 'deepl',
        data: { api_key: '****', base_url: 'https://new.api.com' },
      });

      expect(result.success).toBe(true);
      // masked value "****" should be dropped, original preserved
      expect(mockConfigServicesRepo.updateEntry).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({
          data: { api_key: 'real-secret-key', base_url: 'https://new.api.com' },
        }),
      );
    });

    it('returns error for invalid data param', async () => {
      const result = await executeConfigTool('config_set_entry', {
        service: 'deepl',
        data: 'not-an-object',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be an object');
    });

    it('returns error for unknown service', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue(null);

      const result = await executeConfigTool('config_set_entry', {
        service: 'nonexistent',
        data: { key: 'value' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Service not found');
    });

    it('handles save error gracefully', async () => {
      mockConfigServicesRepo.getByName.mockReturnValue({
        name: 'deepl',
        configSchema: [],
      });
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);
      mockConfigServicesRepo.createEntry.mockRejectedValue(new Error('DB write failed'));

      const result = await executeConfigTool('config_set_entry', {
        service: 'deepl',
        data: { key: 'value' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB write failed');
    });
  });

  // ========================================================================
  // Unknown tool
  // ========================================================================

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeConfigTool('nonexistent_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown config tool');
    });
  });
});

describe('workflowUsable flag', () => {
  it('all config tools are marked workflowUsable: false', () => {
    for (const def of CONFIG_TOOLS) {
      expect(def.workflowUsable, `${def.name} should have workflowUsable: false`).toBe(false);
    }
  });
});
