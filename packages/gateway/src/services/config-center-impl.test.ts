/**
 * GatewayConfigCenter Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockConfigServicesRepo = vi.hoisted(() => ({
  getApiKey: vi.fn(),
  getByName: vi.fn(),
  upsert: vi.fn(),
  getDefaultEntry: vi.fn(),
  isAvailable: vi.fn(),
  list: vi.fn(),
  getEntryByLabel: vi.fn(),
  getEntries: vi.fn(),
  getFieldValue: vi.fn(),
}));

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: mockConfigServicesRepo,
}));

import { GatewayConfigCenter, gatewayConfigCenter } from './config-center-impl.js';

const mockServiceDefinition = {
  name: 'openai',
  displayName: 'OpenAI',
  category: 'llm',
  description: 'OpenAI API',
  docsUrl: 'https://platform.openai.com/docs',
  configSchema: [
    { name: 'api_key', label: 'API Key', type: 'secret' as const, required: true },
    { name: 'base_url', label: 'Base URL', type: 'url' as const },
  ],
  multiEntry: false,
  isActive: true,
  requiredBy: [],
};

const mockEntry = {
  id: 'entry-1',
  serviceName: 'openai',
  label: 'default',
  data: { api_key: 'sk-test-123', base_url: 'https://api.openai.com', org_id: 'org-abc' },
  isDefault: true,
  isActive: true,
};

const mockSecondEntry = {
  id: 'entry-2',
  serviceName: 'openai',
  label: 'staging',
  data: { api_key: 'sk-staging-456' },
  isDefault: false,
  isActive: true,
};

describe('GatewayConfigCenter', () => {
  let center: GatewayConfigCenter;

  beforeEach(() => {
    vi.clearAllMocks();
    center = new GatewayConfigCenter();
  });

  describe('getApiKey', () => {
    it('returns API key from configServicesRepo', () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue('sk-test-123');
      mockConfigServicesRepo.getByName.mockReturnValue(mockServiceDefinition);

      const result = center.getApiKey('openai');
      expect(result).toBe('sk-test-123');
      expect(mockConfigServicesRepo.getApiKey).toHaveBeenCalledWith('openai');
    });

    it('returns undefined when service has no API key', () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue(undefined);
      mockConfigServicesRepo.getByName.mockReturnValue(mockServiceDefinition);

      expect(center.getApiKey('openai')).toBeUndefined();
    });

    it('auto-registers unknown service via upsert', () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue(undefined);
      mockConfigServicesRepo.getByName.mockReturnValue(null);
      mockConfigServicesRepo.upsert.mockResolvedValue({});

      center.getApiKey('new-service');

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith({
        name: 'new-service',
        displayName: 'new-service',
        category: 'general',
        description: 'Auto-discovered service',
      });
    });

    it('does not throw when upsert fails', () => {
      mockConfigServicesRepo.getApiKey.mockReturnValue(undefined);
      mockConfigServicesRepo.getByName.mockReturnValue(null);
      mockConfigServicesRepo.upsert.mockRejectedValue(new Error('DB error'));

      expect(() => center.getApiKey('failing-service')).not.toThrow();
    });
  });

  describe('getServiceConfig', () => {
    it('returns legacy config shape with default entry data', () => {
      mockConfigServicesRepo.getByName.mockReturnValue(mockServiceDefinition);
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(mockEntry);
      mockConfigServicesRepo.getApiKey.mockReturnValue('sk-test-123');

      const result = center.getServiceConfig('openai');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('openai');
      expect(result!.displayName).toBe('OpenAI');
      expect(result!.category).toBe('llm');
      expect(result!.apiKey).toBe('sk-test-123');
      expect(result!.baseUrl).toBe('https://api.openai.com');
      expect(result!.extraConfig).toEqual({ org_id: 'org-abc' });
      expect(result!.isActive).toBe(true);
    });

    it('returns null for unknown service', () => {
      mockConfigServicesRepo.getByName.mockReturnValue(null);

      expect(center.getServiceConfig('nonexistent')).toBeNull();
    });

    it('handles service with no default entry', () => {
      mockConfigServicesRepo.getByName.mockReturnValue(mockServiceDefinition);
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);
      mockConfigServicesRepo.getApiKey.mockReturnValue(undefined);

      const result = center.getServiceConfig('openai');
      expect(result).not.toBeNull();
      expect(result!.apiKey).toBeUndefined();
      expect(result!.baseUrl).toBeUndefined();
    });
  });

  describe('isServiceAvailable', () => {
    it('delegates to configServicesRepo.isAvailable', () => {
      mockConfigServicesRepo.isAvailable.mockReturnValue(true);

      expect(center.isServiceAvailable('openai')).toBe(true);
      expect(mockConfigServicesRepo.isAvailable).toHaveBeenCalledWith('openai');
    });

    it('returns false when service is not available', () => {
      mockConfigServicesRepo.isAvailable.mockReturnValue(false);

      expect(center.isServiceAvailable('nonexistent')).toBe(false);
    });
  });

  describe('listServices', () => {
    it('returns all services in legacy format', () => {
      mockConfigServicesRepo.list.mockReturnValue([mockServiceDefinition]);
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(mockEntry);
      mockConfigServicesRepo.getApiKey.mockReturnValue('sk-test-123');

      const result = center.listServices();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('openai');
      expect(mockConfigServicesRepo.list).toHaveBeenCalledWith(undefined);
    });

    it('filters by category', () => {
      mockConfigServicesRepo.list.mockReturnValue([]);

      center.listServices('llm');
      expect(mockConfigServicesRepo.list).toHaveBeenCalledWith('llm');
    });
  });

  describe('getConfigEntry', () => {
    it('returns default entry when no label specified', () => {
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(mockEntry);

      const result = center.getConfigEntry('openai');
      expect(result).toEqual(mockEntry);
      expect(mockConfigServicesRepo.getDefaultEntry).toHaveBeenCalledWith('openai');
    });

    it('returns entry by label when specified', () => {
      mockConfigServicesRepo.getEntryByLabel.mockReturnValue(mockSecondEntry);

      const result = center.getConfigEntry('openai', 'staging');
      expect(result).toEqual(mockSecondEntry);
      expect(mockConfigServicesRepo.getEntryByLabel).toHaveBeenCalledWith('openai', 'staging');
    });

    it('returns null when entry not found', () => {
      mockConfigServicesRepo.getDefaultEntry.mockReturnValue(null);

      expect(center.getConfigEntry('nonexistent')).toBeNull();
    });
  });

  describe('getConfigEntries', () => {
    it('returns all entries for a service', () => {
      mockConfigServicesRepo.getEntries.mockReturnValue([mockEntry, mockSecondEntry]);

      const result = center.getConfigEntries('openai');
      expect(result).toHaveLength(2);
      expect(mockConfigServicesRepo.getEntries).toHaveBeenCalledWith('openai');
    });

    it('returns empty array for unknown service', () => {
      mockConfigServicesRepo.getEntries.mockReturnValue([]);

      expect(center.getConfigEntries('nonexistent')).toHaveLength(0);
    });
  });

  describe('getFieldValue', () => {
    it('delegates to configServicesRepo.getFieldValue', () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('sk-test-123');

      const result = center.getFieldValue('openai', 'api_key');
      expect(result).toBe('sk-test-123');
      expect(mockConfigServicesRepo.getFieldValue).toHaveBeenCalledWith(
        'openai',
        'api_key',
        undefined
      );
    });

    it('passes entry label for multi-entry lookup', () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue('sk-staging-456');

      const result = center.getFieldValue('openai', 'api_key', 'staging');
      expect(result).toBe('sk-staging-456');
      expect(mockConfigServicesRepo.getFieldValue).toHaveBeenCalledWith(
        'openai',
        'api_key',
        'staging'
      );
    });

    it('returns undefined for unknown field', () => {
      mockConfigServicesRepo.getFieldValue.mockReturnValue(undefined);

      expect(center.getFieldValue('openai', 'missing_field')).toBeUndefined();
    });
  });

  describe('getServiceDefinition', () => {
    it('returns service definition', () => {
      mockConfigServicesRepo.getByName.mockReturnValue(mockServiceDefinition);

      const result = center.getServiceDefinition('openai');
      expect(result).toEqual(mockServiceDefinition);
      expect(mockConfigServicesRepo.getByName).toHaveBeenCalledWith('openai');
    });

    it('returns null for unknown service', () => {
      mockConfigServicesRepo.getByName.mockReturnValue(null);

      expect(center.getServiceDefinition('nonexistent')).toBeNull();
    });
  });

  describe('singletons', () => {
    it('gatewayConfigCenter is a GatewayConfigCenter instance', () => {
      expect(gatewayConfigCenter).toBeInstanceOf(GatewayConfigCenter);
    });
  });
});
