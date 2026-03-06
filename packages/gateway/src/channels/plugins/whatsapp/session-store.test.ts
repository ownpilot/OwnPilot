/**
 * WhatsApp Session Store Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockMkdir, mockRm, mockExistsSync, mockUseMultiFileAuthState, mockGetDataPath } =
  vi.hoisted(() => ({
    mockMkdir: vi.fn(),
    mockRm: vi.fn(),
    mockExistsSync: vi.fn(),
    mockUseMultiFileAuthState: vi.fn(),
    mockGetDataPath: vi.fn(() => '/app-data'),
  }));

vi.mock('node:fs/promises', () => ({
  mkdir: mockMkdir,
  rm: mockRm,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
}));

vi.mock('@whiskeysockets/baileys', () => ({
  useMultiFileAuthState: mockUseMultiFileAuthState,
}));

vi.mock('../../../paths/index.js', () => ({
  getDataPath: mockGetDataPath,
}));

vi.mock('../../../services/log.js', () => ({
  getLog: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { getSessionDir, loadAuthState, hasSession, clearSession } from './session-store.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getSessionDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDataPath.mockReturnValue('/app-data');
  });

  it('returns path under app-data/whatsapp-sessions', () => {
    const dir = getSessionDir('my-plugin');
    expect(dir).toContain('whatsapp-sessions');
    expect(dir).toContain('my-plugin');
  });

  it('sanitizes pluginId (replaces unsafe chars with _)', () => {
    const dir = getSessionDir('plugin/id:with?special*chars');
    // The sanitized pluginId segment should not contain unsafe chars
    const lastSegment = dir.split(/[/\\]/).pop()!;
    expect(lastSegment).not.toContain('?');
    expect(lastSegment).not.toContain('*');
    expect(lastSegment).not.toContain('/');
    expect(lastSegment).not.toContain(':');
    expect(lastSegment).toBe('plugin_id_with_special_chars');
  });

  it('allows alphanumeric and safe chars unchanged', () => {
    const dir = getSessionDir('plugin-1.2_3');
    expect(dir).toContain('plugin-1.2_3');
  });
});

describe('loadAuthState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDataPath.mockReturnValue('/app-data');
    mockMkdir.mockResolvedValue(undefined);
    mockUseMultiFileAuthState.mockResolvedValue({
      state: { creds: {}, keys: {} },
      saveCreds: vi.fn(),
    });
  });

  it('creates the session directory', async () => {
    await loadAuthState('test-plugin');
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('test-plugin'), {
      recursive: true,
    });
  });

  it('calls useMultiFileAuthState with session dir', async () => {
    await loadAuthState('test-plugin');
    expect(mockUseMultiFileAuthState).toHaveBeenCalledWith(expect.stringContaining('test-plugin'));
  });

  it('returns state, saveCreds, and sessionDir', async () => {
    const mockSaveCreds = vi.fn();
    mockUseMultiFileAuthState.mockResolvedValue({
      state: { creds: { me: { id: '123' } }, keys: {} },
      saveCreds: mockSaveCreds,
    });

    const result = await loadAuthState('test-plugin');

    expect(result.state).toBeDefined();
    expect(result.saveCreds).toBe(mockSaveCreds);
    expect(result.sessionDir).toContain('test-plugin');
  });
});

describe('hasSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDataPath.mockReturnValue('/app-data');
  });

  it('returns true when creds.json exists', () => {
    mockExistsSync.mockReturnValue(true);
    expect(hasSession('my-plugin')).toBe(true);
    expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining('creds.json'));
  });

  it('returns false when creds.json does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(hasSession('my-plugin')).toBe(false);
  });
});

describe('clearSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDataPath.mockReturnValue('/app-data');
    mockRm.mockResolvedValue(undefined);
  });

  it('removes session directory when it exists', async () => {
    mockExistsSync.mockReturnValue(true);
    await clearSession('my-plugin');
    expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('my-plugin'), {
      recursive: true,
      force: true,
    });
  });

  it('does nothing when session directory does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    await clearSession('my-plugin');
    expect(mockRm).not.toHaveBeenCalled();
  });
});
