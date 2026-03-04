import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockRepo = vi.hoisted(() => ({
  get: vi.fn<(key: string) => Promise<string | null>>(),
  set: vi.fn<(key: string, value: string) => Promise<void>>().mockResolvedValue(undefined),
  delete: vi.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('../db/repositories/system-settings.js', () => ({
  getSystemSettingsRepository: () => mockRepo,
}));

// ---------------------------------------------------------------------------
// Module under test (static import — mocks in place)
// ---------------------------------------------------------------------------

import {
  getPairingKey,
  hasAnyOwner,
  getOwnerUserId,
  getOwnerChatId,
  isOwner,
  claimOwnership,
  printPairingBanner,
} from './pairing-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.get.mockResolvedValue(null);
  mockRepo.set.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// getPairingKey()
// ---------------------------------------------------------------------------

describe('getPairingKey()', () => {
  it('returns the stored key if one exists', async () => {
    mockRepo.get.mockResolvedValue('ABCD-1234');
    const key = await getPairingKey();
    expect(key).toBe('ABCD-1234');
    expect(mockRepo.set).not.toHaveBeenCalled();
  });

  it('generates, stores, and returns a new key when none is stored', async () => {
    mockRepo.get.mockResolvedValue(null);
    const key = await getPairingKey();
    expect(key).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(mockRepo.set).toHaveBeenCalledWith('pairing_key', key);
  });
});

// ---------------------------------------------------------------------------
// hasAnyOwner()
// ---------------------------------------------------------------------------

describe('hasAnyOwner()', () => {
  it('returns false when no platform owners are set', async () => {
    mockRepo.get.mockResolvedValue(null);
    expect(await hasAnyOwner()).toBe(false);
  });

  it('returns true when telegram owner is set', async () => {
    mockRepo.get.mockImplementation(async (key) =>
      key === 'owner_telegram' ? 'user-123' : null
    );
    expect(await hasAnyOwner()).toBe(true);
  });

  it('returns true when whatsapp owner is set', async () => {
    mockRepo.get.mockImplementation(async (key) =>
      key === 'owner_whatsapp' ? '905551234567' : null
    );
    expect(await hasAnyOwner()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getOwnerUserId() / getOwnerChatId()
// ---------------------------------------------------------------------------

describe('getOwnerUserId()', () => {
  it('returns the stored owner userId for a platform', async () => {
    mockRepo.get.mockResolvedValue('tg-999');
    expect(await getOwnerUserId('telegram')).toBe('tg-999');
    expect(mockRepo.get).toHaveBeenCalledWith('owner_telegram');
  });

  it('returns null when no owner is set', async () => {
    mockRepo.get.mockResolvedValue(null);
    expect(await getOwnerUserId('telegram')).toBeNull();
  });
});

describe('getOwnerChatId()', () => {
  it('returns the stored chatId for a platform', async () => {
    mockRepo.get.mockResolvedValue('chat-42');
    expect(await getOwnerChatId('telegram')).toBe('chat-42');
    expect(mockRepo.get).toHaveBeenCalledWith('owner_chat_telegram');
  });
});

// ---------------------------------------------------------------------------
// isOwner()
// ---------------------------------------------------------------------------

describe('isOwner()', () => {
  it('returns true when platformUserId matches the stored owner', async () => {
    mockRepo.get.mockResolvedValue('user-123');
    expect(await isOwner('telegram', 'user-123')).toBe(true);
  });

  it('returns false when platformUserId does not match', async () => {
    mockRepo.get.mockResolvedValue('user-123');
    expect(await isOwner('telegram', 'user-999')).toBe(false);
  });

  it('returns false when no owner is stored', async () => {
    mockRepo.get.mockResolvedValue(null);
    expect(await isOwner('telegram', 'user-123')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// claimOwnership()
// ---------------------------------------------------------------------------

describe('claimOwnership()', () => {
  it('returns alreadyClaimed=true when platform already has an owner', async () => {
    // get('owner_telegram') returns an existing owner
    mockRepo.get.mockImplementation(async (key) =>
      key === 'owner_telegram' ? 'existing-owner' : null
    );
    const result = await claimOwnership('telegram', 'new-user', 'chat-1', 'ABCD-1234');
    expect(result.success).toBe(false);
    expect(result.alreadyClaimed).toBe(true);
    expect(mockRepo.set).not.toHaveBeenCalled();
  });

  it('rejects when pairing key is not stored', async () => {
    mockRepo.get.mockResolvedValue(null); // no owner, no pairing key
    const result = await claimOwnership('telegram', 'user-1', 'chat-1', 'ABCD-1234');
    expect(result.success).toBe(false);
    expect(result.alreadyClaimed).toBe(false);
  });

  it('rejects when submitted key does not match stored key', async () => {
    mockRepo.get.mockImplementation(async (key) =>
      key === 'pairing_key' ? 'ABCD-1234' : null
    );
    const result = await claimOwnership('telegram', 'user-1', 'chat-1', 'XXXX-9999');
    expect(result.success).toBe(false);
    expect(result.alreadyClaimed).toBe(false);
    expect(mockRepo.set).not.toHaveBeenCalled();
  });

  it('claims ownership and persists owner info when key matches', async () => {
    mockRepo.get.mockImplementation(async (key) =>
      key === 'pairing_key' ? 'ABCD-1234' : null
    );
    const result = await claimOwnership('telegram', 'user-42', 'chat-42', 'ABCD-1234');
    expect(result.success).toBe(true);
    expect(result.alreadyClaimed).toBe(false);
    expect(mockRepo.set).toHaveBeenCalledWith('owner_telegram', 'user-42');
    expect(mockRepo.set).toHaveBeenCalledWith('owner_chat_telegram', 'chat-42');
  });

  it('key comparison is case-insensitive', async () => {
    mockRepo.get.mockImplementation(async (key) =>
      key === 'pairing_key' ? 'abcd-1234' : null
    );
    const result = await claimOwnership('telegram', 'user-42', 'chat-42', 'ABCD-1234');
    expect(result.success).toBe(true);
  });

  it('same key can claim ownership on a different platform', async () => {
    mockRepo.get.mockImplementation(async (key) => {
      if (key === 'owner_telegram') return 'user-42'; // already claimed on telegram
      if (key === 'pairing_key') return 'ABCD-1234';
      return null;
    });
    // Claiming on whatsapp should succeed
    const result = await claimOwnership('whatsapp', 'wa-user', 'wa-chat', 'ABCD-1234');
    expect(result.success).toBe(true);
    expect(mockRepo.set).toHaveBeenCalledWith('owner_whatsapp', 'wa-user');
  });
});

// ---------------------------------------------------------------------------
// printPairingBanner()
// ---------------------------------------------------------------------------

describe('printPairingBanner()', () => {
  it('prints the key to stdout without throwing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(() => printPairingBanner('ABCD-1234')).not.toThrow();
    expect(spy).toHaveBeenCalled();
    const allOutput = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toContain('ABCD-1234');
    spy.mockRestore();
  });
});
