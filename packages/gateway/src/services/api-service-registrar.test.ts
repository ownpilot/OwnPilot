/**
 * Config Service Registrar Tests
 *
 * Tests registration and unregistration of config service dependencies
 * for tools and plugins.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockConfigServicesRepo = {
  upsert: vi.fn(),
  addRequiredBy: vi.fn(),
  removeRequiredById: vi.fn(),
};

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    upsert: (...args: unknown[]) => mockConfigServicesRepo.upsert(...args),
    addRequiredBy: (...args: unknown[]) => mockConfigServicesRepo.addRequiredBy(...args),
    removeRequiredById: (...args: unknown[]) => mockConfigServicesRepo.removeRequiredById(...args),
  },
}));

import {
  registerToolConfigRequirements,
  unregisterDependencies,
} from './api-service-registrar.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Config Service Registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // registerToolConfigRequirements (tool source)
  // ========================================================================

  describe('registerToolConfigRequirements (tool)', () => {
    it('upserts service and adds tool as required_by', async () => {
      await registerToolConfigRequirements('my_tool', 'tool-1', 'custom', [
        { name: 'openai', displayName: 'OpenAI', category: 'ai', description: 'OpenAI API' },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith({
        name: 'openai',
        displayName: 'OpenAI',
        category: 'ai',
        description: 'OpenAI API',
        docsUrl: undefined,
        multiEntry: undefined,
        configSchema: undefined,
      });

      expect(mockConfigServicesRepo.addRequiredBy).toHaveBeenCalledWith('openai', {
        type: 'tool',
        name: 'my_tool',
        id: 'tool-1',
      });
    });

    it('handles multiple dependencies', async () => {
      await registerToolConfigRequirements('translate_tool', 'tool-1', 'custom', [
        { name: 'deepl', category: 'translation' },
        { name: 'google_translate', category: 'translation' },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledTimes(2);
      expect(mockConfigServicesRepo.addRequiredBy).toHaveBeenCalledTimes(2);
    });

    it('defaults displayName to name', async () => {
      await registerToolConfigRequirements('my_tool', 'tool-1', 'custom', [
        { name: 'custom_api' },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'custom_api', displayName: 'custom_api' }),
      );
    });

    it('defaults category to "general"', async () => {
      await registerToolConfigRequirements('my_tool', 'tool-1', 'custom', [
        { name: 'some_api' },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'general' }),
      );
    });

    it('passes through multiEntry and configSchema', async () => {
      const schema = [
        { name: 'api_key', label: 'API Key', type: 'secret' as const, required: true },
      ];

      await registerToolConfigRequirements('my_tool', 'tool-1', 'custom', [
        { name: 'my_service', multiEntry: true, configSchema: schema },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          multiEntry: true,
          configSchema: schema,
        }),
      );
    });
  });

  // ========================================================================
  // registerToolConfigRequirements (plugin source)
  // ========================================================================

  describe('registerToolConfigRequirements (plugin)', () => {
    it('upserts service and adds plugin as required_by', async () => {
      await registerToolConfigRequirements('weather_plugin', 'plugin-1', 'plugin', [
        { name: 'openweathermap', category: 'weather', docsUrl: 'https://openweathermap.org/api' },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'openweathermap',
          category: 'weather',
          docsUrl: 'https://openweathermap.org/api',
        }),
      );

      expect(mockConfigServicesRepo.addRequiredBy).toHaveBeenCalledWith('openweathermap', {
        type: 'plugin',
        name: 'weather_plugin',
        id: 'plugin-1',
      });
    });

    it('handles multiple plugin dependencies', async () => {
      await registerToolConfigRequirements('smart_plugin', 'plugin-1', 'plugin', [
        { name: 'openai' },
        { name: 'tavily' },
        { name: 'deepl' },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledTimes(3);
      expect(mockConfigServicesRepo.addRequiredBy).toHaveBeenCalledTimes(3);
    });
  });

  // ========================================================================
  // unregisterDependencies
  // ========================================================================

  describe('unregisterDependencies', () => {
    it('removes dependent from all services', async () => {
      await unregisterDependencies('tool-1');

      expect(mockConfigServicesRepo.removeRequiredById).toHaveBeenCalledWith('tool-1');
    });
  });
});
