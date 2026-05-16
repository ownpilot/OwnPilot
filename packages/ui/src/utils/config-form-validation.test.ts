import { describe, expect, it } from 'vitest';
import { normalizeConfigFormData } from './config-form-validation';
import type { ConfigServiceView } from '../api';

function makeService(configSchema: ConfigServiceView['configSchema']): ConfigServiceView {
  return {
    id: 'svc-1',
    name: 'audio_service',
    displayName: 'Audio Service',
    category: 'ai',
    description: null,
    docsUrl: null,
    configSchema,
    multiEntry: false,
    requiredBy: [],
    isActive: true,
    isConfigured: false,
    entryCount: 0,
    entries: [],
  };
}

describe('normalizeConfigFormData', () => {
  it('validates required fields against existing values for partial updates', () => {
    const service = makeService([
      { name: 'api_key', label: 'API Key', type: 'secret', required: true },
    ]);

    const result = normalizeConfigFormData({}, service, { api_key: '****' });

    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({});
  });

  it('normalizes number strings and JSON strings', () => {
    const service = makeService([
      { name: 'timeout', label: 'Timeout', type: 'number' },
      { name: 'metadata', label: 'Metadata', type: 'json' },
    ]);

    const result = normalizeConfigFormData({ timeout: '30', metadata: '{"region":"tr"}' }, service);

    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({ timeout: 30, metadata: { region: 'tr' } });
  });

  it('reports invalid URL, number, boolean, select, and JSON fields', () => {
    const service = makeService([
      { name: 'endpoint', label: 'Endpoint', type: 'url' },
      { name: 'timeout', label: 'Timeout', type: 'number' },
      { name: 'enabled', label: 'Enabled', type: 'boolean' },
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        options: [{ value: 'local', label: 'Local' }],
      },
      { name: 'metadata', label: 'Metadata', type: 'json' },
    ]);

    const result = normalizeConfigFormData(
      {
        endpoint: 'nope',
        timeout: 'slow',
        enabled: 'yes',
        mode: 'cloud',
        metadata: '{bad',
      },
      service
    );

    expect(result.errors).toEqual([
      'Endpoint must be a valid URL',
      'Timeout must be a number',
      'Enabled must be true or false',
      'Mode must be one of: local',
      'Metadata must be valid JSON',
    ]);
  });
});
