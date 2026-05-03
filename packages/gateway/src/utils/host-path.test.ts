import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

describe('host-path', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('with env vars configured', () => {
    beforeEach(() => {
      process.env.OWNPILOT_HOST_FS = '/host-home';
      process.env.OWNPILOT_HOST_FS_HOST_PREFIX = '/home/user';
    });

    test('toHostPath: /host-home/projects/x → /home/user/projects/x', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('/host-home/projects/x')).toBe('/home/user/projects/x');
    });

    test('toHostPath: /host-home → /home/user', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('/host-home')).toBe('/home/user');
    });

    test('toHostPath: /app/data/something → null (not under HOST_FS)', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('/app/data/something')).toBeNull();
    });

    test('toHostPath rejects sibling-prefix paths', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('/host-home-evil/projects/x')).toBeNull();
    });

    test('toHostPath: null input → null', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath(null)).toBeNull();
    });

    test('toHostPath: empty string → null', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('')).toBeNull();
    });

    test('toContainerPath: /home/user/projects/x → /host-home/projects/x', async () => {
      const { toContainerPath } = await import('./host-path.js');
      expect(toContainerPath('/home/user/projects/x')).toBe('/host-home/projects/x');
    });

    test('toContainerPath: /root/something → null (not under HOST_PREFIX)', async () => {
      const { toContainerPath } = await import('./host-path.js');
      expect(toContainerPath('/root/something')).toBeNull();
    });

    test('toContainerPath rejects sibling-prefix paths', async () => {
      const { toContainerPath } = await import('./host-path.js');
      expect(toContainerPath('/home/user-evil/projects/x')).toBeNull();
    });

    test('isHostFsConfigured: true when both env vars set', async () => {
      const { isHostFsConfigured } = await import('./host-path.js');
      expect(isHostFsConfigured()).toBe(true);
    });

    test('trailing slash handling: /host-home/ and /host-home both work', async () => {
      process.env.OWNPILOT_HOST_FS = '/host-home/';
      process.env.OWNPILOT_HOST_FS_HOST_PREFIX = '/home/user/';
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('/host-home/projects')).toBe('/home/user/projects');
    });

    test('trailing backslash handling works for configured prefixes', async () => {
      process.env.OWNPILOT_HOST_FS = 'C:\\host-home\\';
      process.env.OWNPILOT_HOST_FS_HOST_PREFIX = 'D:\\Users\\owner\\';
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('C:\\host-home\\projects\\x')).toBe('D:\\Users\\owner\\projects\\x');
    });
  });

  describe('without env vars', () => {
    beforeEach(() => {
      delete process.env.OWNPILOT_HOST_FS;
      delete process.env.OWNPILOT_HOST_FS_HOST_PREFIX;
    });

    test('isHostFsConfigured: false when HOST_FS missing', async () => {
      const { isHostFsConfigured } = await import('./host-path.js');
      expect(isHostFsConfigured()).toBe(false);
    });

    test('toHostPath returns null (graceful degradation)', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('/host-home/anything')).toBeNull();
    });

    test('toContainerPath returns null (graceful degradation)', async () => {
      const { toContainerPath } = await import('./host-path.js');
      expect(toContainerPath('/home/user/anything')).toBeNull();
    });
  });

  describe('partial env vars', () => {
    test('isHostFsConfigured: false when only HOST_FS set', async () => {
      process.env.OWNPILOT_HOST_FS = '/host-home';
      delete process.env.OWNPILOT_HOST_FS_HOST_PREFIX;
      const { isHostFsConfigured } = await import('./host-path.js');
      expect(isHostFsConfigured()).toBe(false);
    });

    test('isHostFsConfigured: false when only HOST_PREFIX set', async () => {
      delete process.env.OWNPILOT_HOST_FS;
      process.env.OWNPILOT_HOST_FS_HOST_PREFIX = '/home/user';
      const { isHostFsConfigured } = await import('./host-path.js');
      expect(isHostFsConfigured()).toBe(false);
    });
  });
});
