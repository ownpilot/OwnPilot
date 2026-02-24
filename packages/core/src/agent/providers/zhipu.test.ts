/**
 * Zhipu Provider Tests
 *
 * Tests for the Zhipu AI (GLM) provider factory.
 * Zhipu is a thin wrapper around OpenAICompatibleProvider.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the OpenAICompatibleProvider and its static methods
const mockFromProviderId = vi.fn();
const mockFromProviderIdWithKey = vi.fn();

vi.mock('./openai-compatible.js', () => ({
  OpenAICompatibleProvider: {
    fromProviderId: (...args: unknown[]) => mockFromProviderId(...args),
    fromProviderIdWithKey: (...args: unknown[]) => mockFromProviderIdWithKey(...args),
  },
}));

import { createZhipuProvider } from './zhipu.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createZhipuProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls fromProviderId with "zhipu" when no config provided', () => {
    const mockProvider = { type: 'zhipu', isReady: () => true };
    mockFromProviderId.mockReturnValue(mockProvider);

    const result = createZhipuProvider();

    expect(mockFromProviderId).toHaveBeenCalledWith('zhipu');
    expect(result).toBe(mockProvider);
  });

  it('calls fromProviderId with "zhipu" when config has no apiKey', () => {
    const mockProvider = { type: 'zhipu', isReady: () => true };
    mockFromProviderId.mockReturnValue(mockProvider);

    const result = createZhipuProvider({ provider: 'zhipu' });

    expect(mockFromProviderId).toHaveBeenCalledWith('zhipu');
    expect(result).toBe(mockProvider);
  });

  it('calls fromProviderIdWithKey when config has apiKey', () => {
    const mockProvider = { type: 'zhipu', isReady: () => true };
    mockFromProviderIdWithKey.mockReturnValue(mockProvider);

    const result = createZhipuProvider({
      provider: 'zhipu',
      apiKey: 'zhipu-test-key',
    });

    expect(mockFromProviderIdWithKey).toHaveBeenCalledWith('zhipu', 'zhipu-test-key');
    expect(result).toBe(mockProvider);
  });

  it('returns null when fromProviderId returns null (no env key)', () => {
    mockFromProviderId.mockReturnValue(null);

    const result = createZhipuProvider();

    expect(result).toBeNull();
  });

  it('returns null when fromProviderIdWithKey returns null', () => {
    mockFromProviderIdWithKey.mockReturnValue(null);

    const result = createZhipuProvider({
      provider: 'zhipu',
      apiKey: 'bad-key',
    });

    expect(result).toBeNull();
  });

  it('does not call fromProviderIdWithKey when config has empty string apiKey', () => {
    const mockProvider = { type: 'zhipu' };
    mockFromProviderId.mockReturnValue(mockProvider);

    // Empty string is falsy, so it should go to the fromProviderId path
    const result = createZhipuProvider({
      provider: 'zhipu',
      apiKey: '',
    });

    expect(mockFromProviderIdWithKey).not.toHaveBeenCalled();
    expect(mockFromProviderId).toHaveBeenCalledWith('zhipu');
    expect(result).toBe(mockProvider);
  });
});
