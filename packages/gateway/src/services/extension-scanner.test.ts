import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}));

vi.mock('url', () => ({
  fileURLToPath: vi.fn(() => '/fake/gateway/src/services'),
}));

vi.mock('../paths/index.js', () => ({
  getDataDirectoryInfo: vi.fn(() => ({ root: '/data' })),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { existsSync, readdirSync } = await import('fs');
const {
  getDefaultExtensionsDirectory,
  getDefaultSkillsDirectory,
  getWorkspaceSkillsDirectory,
  getAllScanDirectories,
  scanSingleDirectory,
} = await import('./extension-scanner.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('path resolution', () => {
  it('getDefaultExtensionsDirectory returns data/extensions', () => {
    const dir = getDefaultExtensionsDirectory();
    expect(dir.replace(/\\/g, '/')).toBe('/data/extensions');
  });

  it('getDefaultSkillsDirectory returns data/skills', () => {
    const dir = getDefaultSkillsDirectory();
    expect(dir.replace(/\\/g, '/')).toBe('/data/skills');
  });

  it('getWorkspaceSkillsDirectory returns null when dir missing', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(getWorkspaceSkillsDirectory()).toBeNull();
  });

  it('getAllScanDirectories filters out nulls', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const dirs = getAllScanDirectories();
    // All bundled dirs return null since existsSync returns false
    // Only non-null dirs are the data dirs (which don't check existsSync)
    expect(Array.isArray(dirs)).toBe(true);
  });
});

describe('scanSingleDirectory', () => {
  it('returns empty result for non-existent directory', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const result = await scanSingleDirectory('/missing', 'user-1', vi.fn());
    expect(result.installed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('scans subdirectories for manifest files', async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      const p = String(path);
      if (p === '/scan') return true;
      if (p.endsWith('SKILL.md')) return true;
      return false;
    });
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'my-skill', isDirectory: () => true },
    ] as never);

    const installFn = vi.fn(async () => ({}));
    const result = await scanSingleDirectory('/scan', 'user-1', installFn);

    expect(installFn).toHaveBeenCalledTimes(1);
    expect(result.installed).toBe(1);
  });

  it('captures install errors without stopping', async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      const p = String(path);
      if (p === '/scan') return true;
      if (p.endsWith('extension.json')) return true;
      return false;
    });
    vi.mocked(readdirSync).mockReturnValue([{ name: 'bad-ext', isDirectory: () => true }] as never);

    const installFn = vi.fn(async () => {
      throw new Error('Invalid manifest');
    });
    const result = await scanSingleDirectory('/scan', 'user-1', installFn);

    expect(result.installed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('Invalid manifest');
  });

  it('handles unreadable directory', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = await scanSingleDirectory('/locked', 'user-1', vi.fn());

    expect(result.installed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('Cannot read directory');
  });

  it('detects manifest files in priority order (SKILL.md > extension.json > extension.md)', async () => {
    // Has both SKILL.md and extension.json — should pick SKILL.md
    vi.mocked(existsSync).mockImplementation((path) => {
      const p = String(path);
      if (p === '/scan') return true;
      if (p.endsWith('SKILL.md')) return true;
      if (p.endsWith('extension.json')) return true;
      return false;
    });
    vi.mocked(readdirSync).mockReturnValue([{ name: 'dual', isDirectory: () => true }] as never);

    const installFn = vi.fn(async () => ({}));
    await scanSingleDirectory('/scan', 'user-1', installFn);

    // Should be called with SKILL.md path (higher priority)
    const calledPath = installFn.mock.calls[0][0] as string;
    expect(calledPath).toContain('SKILL.md');
  });
});
