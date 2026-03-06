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
  revokeOwnership,
  printPairingBanner,
  autoClaimOwnership,
} from './pairing-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.get.mockResolvedValue(null);
  mockRepo.set.mockResolvedValue(undefined);
  mockRepo.delete.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// getPairingKey()
// ---------------------------------------------------------------------------

describe('getPairingKey()', () => {
  it('returns the stored key if one exists', async () => {
    mockRepo.get.mockResolvedValue('ABCD-1234');
    const key = await getPairingKey('channel.telegram');
    expect(key).toBe('ABCD-1234');
    expect(mockRepo.get).toHaveBeenCalledWith('pairing_key_channel.telegram');
    expect(mockRepo.set).not.toHaveBeenCalled();
  });

  it('generates, stores, and returns a new key when none is stored', async () => {
    mockRepo.get.mockResolvedValue(null);
    const key = await getPairingKey('channel.telegram');
    expect(key).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(mockRepo.set).toHaveBeenCalledWith('pairing_key_channel.telegram', key);
  });

  it('uses separate keys per pluginId', async () => {
    mockRepo.get.mockImplementation(async (k) => {
      if (k === 'pairing_key_channel.telegram') return 'AAAA-1111';
      if (k === 'pairing_key_channel.whatsapp') return 'BBBB-2222';
      return null;
    });
    expect(await getPairingKey('channel.telegram')).toBe('AAAA-1111');
    expect(await getPairingKey('channel.whatsapp')).toBe('BBBB-2222');
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
    mockRepo.get.mockImplementation(async (key) => (key === 'owner_telegram' ? 'user-123' : null));
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
    mockRepo.get.mockImplementation(async (key) =>
      key === 'owner_telegram' ? 'existing-owner' : null
    );
    const result = await claimOwnership(
      'channel.telegram',
      'telegram',
      'new-user',
      'chat-1',
      'ABCD-1234'
    );
    expect(result.success).toBe(false);
    expect(result.alreadyClaimed).toBe(true);
    expect(mockRepo.set).not.toHaveBeenCalled();
  });

  it('rejects when pairing key is not stored for the channel', async () => {
    mockRepo.get.mockResolvedValue(null); // no owner, no pairing key
    const result = await claimOwnership(
      'channel.telegram',
      'telegram',
      'user-1',
      'chat-1',
      'ABCD-1234'
    );
    expect(result.success).toBe(false);
    expect(result.alreadyClaimed).toBe(false);
  });

  it('rejects when submitted key does not match stored key', async () => {
    mockRepo.get.mockImplementation(async (key) =>
      key === 'pairing_key_channel.telegram' ? 'ABCD-1234' : null
    );
    const result = await claimOwnership(
      'channel.telegram',
      'telegram',
      'user-1',
      'chat-1',
      'XXXX-9999'
    );
    expect(result.success).toBe(false);
    expect(result.alreadyClaimed).toBe(false);
    expect(mockRepo.set).not.toHaveBeenCalled();
  });

  it('claims ownership, persists owner info, and rotates key on success', async () => {
    mockRepo.get.mockImplementation(async (key) =>
      key === 'pairing_key_channel.telegram' ? 'ABCD-1234' : null
    );
    const result = await claimOwnership(
      'channel.telegram',
      'telegram',
      'user-42',
      'chat-42',
      'ABCD-1234'
    );
    expect(result.success).toBe(true);
    expect(result.alreadyClaimed).toBe(false);
    expect(mockRepo.set).toHaveBeenCalledWith('owner_telegram', 'user-42');
    expect(mockRepo.set).toHaveBeenCalledWith('owner_chat_telegram', 'chat-42');
    // Key must be rotated — new key set for the channel
    const rotateCall = mockRepo.set.mock.calls.find(([k]) => k === 'pairing_key_channel.telegram');
    expect(rotateCall).toBeDefined();
    expect(rotateCall![1]).not.toBe('ABCD-1234'); // new key is different
  });

  it('key comparison is case-insensitive', async () => {
    mockRepo.get.mockImplementation(async (key) =>
      key === 'pairing_key_channel.telegram' ? 'abcd-1234' : null
    );
    const result = await claimOwnership(
      'channel.telegram',
      'telegram',
      'user-42',
      'chat-42',
      'ABCD-1234'
    );
    expect(result.success).toBe(true);
  });

  it('uses the per-channel key (not another channel key)', async () => {
    mockRepo.get.mockImplementation(async (key) => {
      if (key === 'pairing_key_channel.whatsapp') return 'WXYZ-9999';
      return null; // channel.telegram has no key
    });
    const result = await claimOwnership(
      'channel.telegram',
      'telegram',
      'user-1',
      'chat-1',
      'WXYZ-9999'
    );
    // Should fail — the submitted key matches whatsapp's key, not telegram's
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// revokeOwnership()
// ---------------------------------------------------------------------------

describe('revokeOwnership()', () => {
  it('deletes owner entries and rotates the key', async () => {
    await revokeOwnership('channel.telegram', 'telegram');
    expect(mockRepo.delete).toHaveBeenCalledWith('owner_telegram');
    expect(mockRepo.delete).toHaveBeenCalledWith('owner_chat_telegram');
    // New key must be set
    const setCall = mockRepo.set.mock.calls.find(([k]) => k === 'pairing_key_channel.telegram');
    expect(setCall).toBeDefined();
    expect(setCall![1]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('works independently per channel', async () => {
    await revokeOwnership('channel.whatsapp', 'whatsapp');
    expect(mockRepo.delete).toHaveBeenCalledWith('owner_whatsapp');
    expect(mockRepo.delete).toHaveBeenCalledWith('owner_chat_whatsapp');
    expect(mockRepo.delete).not.toHaveBeenCalledWith('owner_telegram');
  });
});

// ---------------------------------------------------------------------------
// printPairingBanner()
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// autoClaimOwnership()
// ---------------------------------------------------------------------------

describe('autoClaimOwnership()', () => {
  it('does nothing when platform already has an owner (line 172)', async () => {
    mockRepo.get.mockResolvedValue('existing-user-id');

    await autoClaimOwnership('channel.telegram', 'telegram', 'new-user', 'chat-123');

    // Should return early — no set calls
    expect(mockRepo.set).not.toHaveBeenCalled();
  });

  it('claims ownership when no existing owner (lines 174-178)', async () => {
    mockRepo.get.mockResolvedValue(null); // no existing owner

    await autoClaimOwnership('channel.telegram', 'telegram', 'user-1', 'chat-abc');

    // Should set owner and owner_chat keys
    expect(mockRepo.set).toHaveBeenCalledWith('owner_telegram', 'user-1');
    expect(mockRepo.set).toHaveBeenCalledWith('owner_chat_telegram', 'chat-abc');
    // Should also rotate the pairing key (set a new key)
    const keyCall = mockRepo.set.mock.calls.find(([k]) => k === 'pairing_key_channel.telegram');
    expect(keyCall).toBeDefined();
  });
});

describe('printPairingBanner()', () => {
  it('prints the channel name and key to stdout without throwing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(() => printPairingBanner('Telegram Bot', 'ABCD-1234')).not.toThrow();
    expect(spy).toHaveBeenCalled();
    const allOutput = spy.mock.calls.map((c) => c[0]).join('\n');
    expect(allOutput).toContain('ABCD-1234');
    expect(allOutput).toContain('Telegram Bot');
    spy.mockRestore();
  });
});
