/**
 * Config Services Seed Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockConfigServicesRepo } = vi.hoisted(() => ({
  mockConfigServicesRepo: {
    upsert: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../repositories/config-services.js', () => ({
  configServicesRepo: mockConfigServicesRepo,
}));

vi.mock('../../services/log.js', () => ({
  getLog: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { KNOWN_CONFIG_SERVICES, seedConfigServices } from './config-services-seed.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KNOWN_CONFIG_SERVICES', () => {
  it('contains weather services', () => {
    const names = KNOWN_CONFIG_SERVICES.map((s) => s.name);
    expect(names).toContain('openweathermap');
    expect(names).toContain('weatherapi');
  });

  it('contains email services', () => {
    const names = KNOWN_CONFIG_SERVICES.map((s) => s.name);
    expect(names).toContain('smtp');
    expect(names).toContain('imap');
  });

  it('contains media services', () => {
    const names = KNOWN_CONFIG_SERVICES.map((s) => s.name);
    expect(names).toContain('elevenlabs');
  });

  it('openweathermap has api_key and base_url fields', () => {
    const svc = KNOWN_CONFIG_SERVICES.find((s) => s.name === 'openweathermap');
    expect(svc).toBeDefined();
    const fieldNames = svc!.configSchema.map((f) => f.name);
    expect(fieldNames).toContain('api_key');
    expect(fieldNames).toContain('base_url');
  });

  it('weatherapi has api_key and base_url fields', () => {
    const svc = KNOWN_CONFIG_SERVICES.find((s) => s.name === 'weatherapi');
    const fieldNames = svc!.configSchema.map((f) => f.name);
    expect(fieldNames).toContain('api_key');
    expect(fieldNames).toContain('base_url');
  });

  it('openweathermap api_key field has envVar', () => {
    const svc = KNOWN_CONFIG_SERVICES.find((s) => s.name === 'openweathermap');
    const apiKeyField = svc!.configSchema.find((f) => f.name === 'api_key');
    expect(apiKeyField?.envVar).toBe('OPENWEATHERMAP_API_KEY');
  });

  it('smtp has multiEntry flag', () => {
    const svc = KNOWN_CONFIG_SERVICES.find((s) => s.name === 'smtp');
    expect(svc?.multiEntry).toBe(true);
  });

  it('smtp has required host, port, user, password fields', () => {
    const svc = KNOWN_CONFIG_SERVICES.find((s) => s.name === 'smtp');
    const fieldNames = svc!.configSchema.map((f) => f.name);
    expect(fieldNames).toContain('host');
    expect(fieldNames).toContain('port');
    expect(fieldNames).toContain('user');
    expect(fieldNames).toContain('password');
  });

  it('elevenlabs has model_id field with select type', () => {
    const svc = KNOWN_CONFIG_SERVICES.find((s) => s.name === 'elevenlabs');
    const modelField = svc!.configSchema.find((f) => f.name === 'model_id');
    expect(modelField?.type).toBe('select');
    expect(modelField?.options).toBeDefined();
  });
});

describe('seedConfigServices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigServicesRepo.upsert.mockResolvedValue(undefined);
    mockConfigServicesRepo.list.mockReturnValue([]);
  });

  it('calls upsert for each known service', async () => {
    await seedConfigServices();
    expect(mockConfigServicesRepo.upsert).toHaveBeenCalledTimes(KNOWN_CONFIG_SERVICES.length);
  });

  it('calls upsert with correct service data', async () => {
    await seedConfigServices();
    expect(mockConfigServicesRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'openweathermap' })
    );
  });

  it('returns count of seeded services', async () => {
    const result = await seedConfigServices();
    expect(result).toBe(KNOWN_CONFIG_SERVICES.length);
  });

  it('continues after individual upsert failure', async () => {
    mockConfigServicesRepo.upsert
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValue(undefined);

    const result = await seedConfigServices();
    // One failed, count is total - 1
    expect(result).toBe(KNOWN_CONFIG_SERVICES.length - 1);
  });

  it('removes stale services not in known list', async () => {
    mockConfigServicesRepo.list.mockReturnValue([{ name: 'stale-service', requiredBy: [] }]);
    mockConfigServicesRepo.delete.mockResolvedValue(undefined);

    await seedConfigServices();
    expect(mockConfigServicesRepo.delete).toHaveBeenCalledWith('stale-service');
  });

  it('does not remove stale service that has requiredBy dependents', async () => {
    mockConfigServicesRepo.list.mockReturnValue([
      { name: 'stale-service', requiredBy: ['some-extension'] },
    ]);

    await seedConfigServices();
    expect(mockConfigServicesRepo.delete).not.toHaveBeenCalled();
  });

  it('does not remove known services', async () => {
    mockConfigServicesRepo.list.mockReturnValue([{ name: 'openweathermap', requiredBy: [] }]);

    await seedConfigServices();
    expect(mockConfigServicesRepo.delete).not.toHaveBeenCalled();
  });

  it('continues after stale service delete failure', async () => {
    mockConfigServicesRepo.list.mockReturnValue([
      { name: 'stale1', requiredBy: [] },
      { name: 'stale2', requiredBy: [] },
    ]);
    mockConfigServicesRepo.delete
      .mockRejectedValueOnce(new Error('Cannot delete'))
      .mockResolvedValueOnce(undefined);

    // Should not throw
    await expect(seedConfigServices()).resolves.toBe(KNOWN_CONFIG_SERVICES.length);
  });
});
