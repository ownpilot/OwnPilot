/**
 * Service Helpers Tests
 *
 * Tests for tryGetService utility that safely accesses the service registry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@ownpilot/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ownpilot/core')>();
  return {
    ...original,
    hasServiceRegistry: vi.fn(() => false),
    getServiceRegistry: vi.fn(),
  };
});

import { hasServiceRegistry, getServiceRegistry, type ServiceToken } from '@ownpilot/core';
import { tryGetService } from './service-helpers.js';

const mockHasServiceRegistry = vi.mocked(hasServiceRegistry);
const mockGetServiceRegistry = vi.mocked(getServiceRegistry);

function createToken<T>(name: string): ServiceToken<T> {
  return { key: Symbol(name), name } as ServiceToken<T>;
}

describe('tryGetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when service registry is not available', () => {
    mockHasServiceRegistry.mockReturnValue(false);

    const token = createToken<string>('test');
    const result = tryGetService(token);

    expect(result).toBeNull();
    expect(mockGetServiceRegistry).not.toHaveBeenCalled();
  });

  it('returns service when registry has it', () => {
    mockHasServiceRegistry.mockReturnValue(true);
    const mockService = { doWork: vi.fn() };
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn(() => mockService),
      register: vi.fn(),
      has: vi.fn(),
    } as never);

    const token = createToken<typeof mockService>('test');
    const result = tryGetService(token);

    expect(result).toBe(mockService);
  });

  it('returns null when registry throws (service not registered)', () => {
    mockHasServiceRegistry.mockReturnValue(true);
    mockGetServiceRegistry.mockReturnValue({
      get: vi.fn(() => {
        throw new Error('Service not registered');
      }),
      register: vi.fn(),
      has: vi.fn(),
    } as never);

    const token = createToken<string>('missing');
    const result = tryGetService(token);

    expect(result).toBeNull();
  });

  it('passes the token to registry.get()', () => {
    mockHasServiceRegistry.mockReturnValue(true);
    const getMock = vi.fn(() => 'value');
    mockGetServiceRegistry.mockReturnValue({
      get: getMock,
      register: vi.fn(),
      has: vi.fn(),
    } as never);

    const token = createToken<string>('specific');
    tryGetService(token);

    expect(getMock).toHaveBeenCalledWith(token);
  });
});
