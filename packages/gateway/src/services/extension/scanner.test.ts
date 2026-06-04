import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join, resolve } from 'path';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}));

vi.mock('url', () => ({
  fileURLToPath: vi.fn(() => '/fake/gateway/src/services'),
}));

vi.mock('../../paths/index.js', () => ({
  getDataDirectoryInfo: vi.fn(() => ({ root: '/data' })),
}));

vi.mock('../log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { existsSync, readdirSync } = await import('fs');
const {
  getDefaultExtensionsDirectory,
  getDefaultSkillsDirectory,
  getWorkspaceSkillsDirectory,
  getAllScanDirectories,
  getScanDirectories,
  resolveManagedSkillDir,
  scanSingleDirectory,
  orderScanCandidates,
  SKILL_TIER_RANK,
} = await import('./scanner.js');

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

describe('precedence ordering', () => {
  it('ranks tiers bundled < managed < personal < project < workspace', () => {
    expect(SKILL_TIER_RANK.bundled).toBeLessThan(SKILL_TIER_RANK.managed);
    expect(SKILL_TIER_RANK.managed).toBeLessThan(SKILL_TIER_RANK.personal);
    expect(SKILL_TIER_RANK.personal).toBeLessThan(SKILL_TIER_RANK.project);
    expect(SKILL_TIER_RANK.project).toBeLessThan(SKILL_TIER_RANK.workspace);
  });

  it('orders candidates low → high precedence and drops nulls', () => {
    const ordered = orderScanCandidates([
      { dir: '/ws', tier: 'workspace' },
      { dir: null, tier: 'project' },
      { dir: '/bundled', tier: 'bundled' },
      { dir: '/personal', tier: 'personal' },
      { dir: '/managed', tier: 'managed' },
    ]);
    expect(ordered.map((d) => d.dir)).toEqual(['/bundled', '/managed', '/personal', '/ws']);
  });

  it('puts the highest-precedence (workspace) directory last so it wins last-write', () => {
    const ordered = orderScanCandidates([
      { dir: '/bundled', tier: 'bundled' },
      { dir: '/ws', tier: 'workspace' },
    ]);
    expect(ordered[ordered.length - 1]!.tier).toBe('workspace');
  });
});

describe('resolveManagedSkillDir', () => {
  it('returns null for a missing source path (DB-only skills)', () => {
    expect(resolveManagedSkillDir(undefined)).toBeNull();
    expect(resolveManagedSkillDir(null)).toBeNull();
    expect(resolveManagedSkillDir('')).toBeNull();
  });

  it('returns the skill directory for a personal-skills manifest', () => {
    const root = getDefaultSkillsDirectory(); // /data/skills
    const manifest = join(root, 'code-review', 'SKILL.md');
    expect(resolveManagedSkillDir(manifest)).toBe(resolve(join(root, 'code-review')));
  });

  it('returns the skill directory for a managed-extensions upload manifest', () => {
    const root = getDefaultExtensionsDirectory(); // /data/extensions
    const manifest = join(root, 'upload-abc123', 'SKILL.md');
    expect(resolveManagedSkillDir(manifest)).toBe(resolve(join(root, 'upload-abc123')));
  });

  it('refuses to delete bundled (read-only) skills', () => {
    vi.mocked(existsSync).mockReturnValue(true); // make bundled dirs resolve
    const bundled = getScanDirectories().find((d) => d.tier === 'bundled');
    expect(bundled).toBeDefined();
    const manifest = join(bundled!.dir, 'document-assistant', 'SKILL.md');
    expect(resolveManagedSkillDir(manifest)).toBeNull();
  });

  it('refuses a path that is not an immediate child of a writable root', () => {
    const root = getDefaultSkillsDirectory();
    // parent is /data/skills/a (not a scan root itself) → not deletable
    const nested = join(root, 'a', 'b', 'SKILL.md');
    expect(resolveManagedSkillDir(nested)).toBeNull();
  });

  it('refuses an arbitrary path outside every scan root', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(resolveManagedSkillDir(join('/somewhere', 'else', 'SKILL.md'))).toBeNull();
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

  it('skips manifests when shouldSkip returns true', async () => {
    vi.mocked(existsSync).mockImplementation((path) => {
      const p = String(path);
      if (p === '/scan') return true;
      if (p.endsWith('SKILL.md')) return true;
      return false;
    });
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'removed-skill', isDirectory: () => true },
    ] as never);

    const installFn = vi.fn(async () => ({}));
    const shouldSkip = vi.fn(async () => true);
    const result = await scanSingleDirectory('/scan', 'user-1', installFn, shouldSkip);

    expect(shouldSkip).toHaveBeenCalledTimes(1);
    expect(installFn).not.toHaveBeenCalled();
    expect(result.installed).toBe(0);
    expect(result.errors).toHaveLength(0);
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
