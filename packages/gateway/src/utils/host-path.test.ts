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
      process.env.OWNPILOT_HOST_FS_HOST_PREFIX = '/home/ayaz';
    });

    test('toHostPath: /host-home/projects/x → /home/ayaz/projects/x', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('/host-home/projects/x')).toBe('/home/ayaz/projects/x');
    });

    test('toHostPath: /host-home → /home/ayaz', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('/host-home')).toBe('/home/ayaz');
    });

    test('toHostPath: /app/data/something → null (not under HOST_FS)', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('/app/data/something')).toBeNull();
    });

    test('toHostPath: null input → null', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath(null)).toBeNull();
    });

    test('toHostPath: empty string → null', async () => {
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('')).toBeNull();
    });

    test('toContainerPath: /home/ayaz/projects/x → /host-home/projects/x', async () => {
      const { toContainerPath } = await import('./host-path.js');
      expect(toContainerPath('/home/ayaz/projects/x')).toBe('/host-home/projects/x');
    });

    test('toContainerPath: /root/something → null (not under HOST_PREFIX)', async () => {
      const { toContainerPath } = await import('./host-path.js');
      expect(toContainerPath('/root/something')).toBeNull();
    });

    test('isHostFsConfigured: true when both env vars set', async () => {
      const { isHostFsConfigured } = await import('./host-path.js');
      expect(isHostFsConfigured()).toBe(true);
    });

    test('trailing slash handling: /host-home/ and /host-home both work', async () => {
      process.env.OWNPILOT_HOST_FS = '/host-home/';
      process.env.OWNPILOT_HOST_FS_HOST_PREFIX = '/home/ayaz/';
      const { toHostPath } = await import('./host-path.js');
      expect(toHostPath('/host-home/projects')).toBe('/home/ayaz/projects');
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
      expect(toContainerPath('/home/ayaz/anything')).toBeNull();
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
      process.env.OWNPILOT_HOST_FS_HOST_PREFIX = '/home/ayaz';
      const { isHostFsConfigured } = await import('./host-path.js');
      expect(isHostFsConfigured()).toBe(false);
    });
  });
});
