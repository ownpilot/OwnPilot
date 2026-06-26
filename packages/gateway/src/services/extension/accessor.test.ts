import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCoreExtensionService = vi.hoisted(() => ({
  listExtensions: vi.fn(),
}));

const mockGetExtensionService = vi.hoisted(() => vi.fn(() => mockCoreExtensionService));

vi.mock('@ownpilot/core/services', () => ({
  getExtensionService: mockGetExtensionService,
}));

import { getExtensionManifestSecurity, getGatewayExtensionService } from './accessor.js';

describe('extension accessor', () => {
  beforeEach(() => {
    mockGetExtensionService.mockClear();
  });

  it('delegates gateway extension service access to the core capability accessor', () => {
    expect(getGatewayExtensionService()).toBe(mockCoreExtensionService);
    expect(mockGetExtensionService).toHaveBeenCalledTimes(1);
  });

  it('reads extension manifest security metadata safely', () => {
    const security = { permissions: ['network'], sandbox: true };

    expect(getExtensionManifestSecurity({ _security: security })).toBe(security);
    expect(getExtensionManifestSecurity({ name: 'demo-extension' })).toBeNull();
    expect(getExtensionManifestSecurity(null)).toBeNull();
    expect(getExtensionManifestSecurity('not-a-manifest')).toBeNull();
  });
});
