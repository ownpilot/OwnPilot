/**
 * API Service Registrar Tests
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
  registerToolApiDependencies,
  registerPluginApiDependencies,
  unregisterDependencies,
} from './api-service-registrar.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API Service Registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // registerToolApiDependencies
  // ========================================================================

  describe('registerToolApiDependencies', () => {
    it('upserts service and adds tool as required_by', async () => {
      await registerToolApiDependencies('tool-1', 'my_tool', [
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
      await registerToolApiDependencies('tool-1', 'translate_tool', [
        { name: 'deepl', category: 'translation' },
        { name: 'google_translate', category: 'translation' },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledTimes(2);
      expect(mockConfigServicesRepo.addRequiredBy).toHaveBeenCalledTimes(2);
    });

    it('defaults displayName to name', async () => {
      await registerToolApiDependencies('tool-1', 'my_tool', [
        { name: 'custom_api' },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'custom_api', displayName: 'custom_api' }),
      );
    });

    it('defaults category to "general"', async () => {
      await registerToolApiDependencies('tool-1', 'my_tool', [
        { name: 'some_api' },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'general' }),
      );
    });

    it('passes through multiEntry and configSchema from RequiredConfigInput', async () => {
      const schema = [
        { name: 'api_key', label: 'API Key', type: 'secret' as const, required: true },
      ];

      await registerToolApiDependencies('tool-1', 'my_tool', [
        { name: 'my_service', multiEntry: true, configSchema: schema },
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          multiEntry: true,
          configSchema: schema,
        }),
      );
    });

    it('sets multiEntry/configSchema to undefined for legacy RequiredKeyInput', async () => {
      await registerToolApiDependencies('tool-1', 'my_tool', [
        { name: 'legacy_api', envVarName: 'LEGACY_API_KEY' } as any,
      ]);

      expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          multiEntry: undefined,
          configSchema: undefined,
        }),
      );
    });
  });

  // ========================================================================
  // registerPluginApiDependencies
  // ========================================================================

  describe('registerPluginApiDependencies', () => {
    it('upserts service and adds plugin as required_by', async () => {
      await registerPluginApiDependencies('plugin-1', 'weather_plugin', [
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
      await registerPluginApiDependencies('plugin-1', 'smart_plugin', [
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
