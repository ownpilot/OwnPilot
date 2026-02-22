import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IsolatedStorage, StorageSecurityError, initializeStorage } from './storage.js';

// Mock node:fs
vi.mock('node:fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('file content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({
      size: 100,
      isDirectory: () => false,
      mtime: new Date(),
      birthtime: new Date(),
    }),
    readdir: vi.fn().mockResolvedValue([]),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock node:crypto
vi.mock('node:crypto', () => ({
  createHash: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue({
      digest: vi.fn().mockReturnValue('abcdef1234567890'),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// StorageSecurityError
// ---------------------------------------------------------------------------
describe('StorageSecurityError', () => {
  it('has correct name and message', () => {
    const e = new StorageSecurityError('access denied');
    expect(e.name).toBe('StorageSecurityError');
    expect(e.message).toBe('access denied');
    expect(e).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// IsolatedStorage
// ---------------------------------------------------------------------------
describe('IsolatedStorage', () => {
  let storage: IsolatedStorage;
  let fsMock: typeof import('node:fs');

  beforeEach(async () => {
    vi.clearAllMocks();
    storage = new IsolatedStorage('/data/workspaces', 2);
    fsMock = await import('node:fs');
  });

  // -------------------------------------------------------------------------
  // Path Validation
  // -------------------------------------------------------------------------
  describe('path validation', () => {
    it('allows valid paths within workspace', async () => {
      await expect(storage.readFile('user1', 'docs/file.txt')).resolves.toBeDefined();
    });

    it('blocks path traversal attempts', async () => {
      await expect(storage.readFile('user1', '../../etc/passwd')).rejects.toThrow(
        StorageSecurityError
      );
      await expect(storage.readFile('user1', '../other-user/file.txt')).rejects.toThrow(
        StorageSecurityError
      );
    });
  });

  // -------------------------------------------------------------------------
  // User workspace paths
  // -------------------------------------------------------------------------
  describe('getUserWorkspacePath', () => {
    it('returns correct path', () => {
      const p = storage.getUserWorkspacePath('user1');
      expect(p).toContain('user1');
      expect(p).toContain('workspace');
    });
  });

  describe('getUserDataPath', () => {
    it('returns correct path', () => {
      const p = storage.getUserDataPath('user1');
      expect(p).toContain('user1');
      expect(p).toContain('data');
    });
  });

  // -------------------------------------------------------------------------
  // createUserStorage
  // -------------------------------------------------------------------------
  describe('createUserStorage', () => {
    it('creates directory structure', async () => {
      await storage.createUserStorage('user1');
      // mkdir called multiple times for workspace, data, projects, uploads, temp
      expect(fsMock.promises.mkdir).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // userStorageExists
  // -------------------------------------------------------------------------
  describe('userStorageExists', () => {
    it('returns true when workspace exists', async () => {
      vi.mocked(fsMock.promises.access).mockResolvedValue(undefined);
      expect(await storage.userStorageExists('user1')).toBe(true);
    });

    it('returns false when workspace does not exist', async () => {
      vi.mocked(fsMock.promises.access).mockRejectedValue(new Error('ENOENT'));
      expect(await storage.userStorageExists('user1')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // File operations
  // -------------------------------------------------------------------------
  describe('readFile', () => {
    it('reads file content', async () => {
      const content = await storage.readFile('user1', 'test.txt');
      expect(content).toBe('file content');
    });
  });

  describe('readBinaryFile', () => {
    it('reads binary content', async () => {
      const buf = Buffer.from('binary');
      vi.mocked(fsMock.promises.readFile).mockResolvedValue(buf);
      const content = await storage.readBinaryFile('user1', 'test.bin');
      expect(content).toEqual(buf);
    });
  });

  describe('writeFile', () => {
    it('writes file content', async () => {
      vi.mocked(fsMock.promises.readdir).mockResolvedValue([]);
      await storage.writeFile('user1', 'test.txt', 'hello');
      expect(fsMock.promises.writeFile).toHaveBeenCalled();
    });

    it('throws on quota exceeded', async () => {
      // Set up to report high usage
      vi.mocked(fsMock.promises.readdir).mockResolvedValue([
        { name: 'big.bin', isDirectory: () => false } as never,
      ]);
      vi.mocked(fsMock.promises.stat).mockResolvedValue({
        size: 3 * 1024 * 1024 * 1024, // 3 GB
        isDirectory: () => false,
        mtime: new Date(),
        birthtime: new Date(),
      } as never);

      await expect(storage.writeFile('user1', 'test.txt', 'hello')).rejects.toThrow(
        StorageSecurityError
      );
    });
  });

  describe('appendFile', () => {
    it('appends content to file', async () => {
      vi.mocked(fsMock.promises.readdir).mockResolvedValue([]);
      await storage.appendFile('user1', 'log.txt', 'new line');
      expect(fsMock.promises.appendFile).toHaveBeenCalled();
    });
  });

  describe('deleteFile', () => {
    it('deletes a file', async () => {
      vi.mocked(fsMock.promises.stat).mockResolvedValue({
        size: 100,
        isDirectory: () => false,
        mtime: new Date(),
        birthtime: new Date(),
      } as never);
      await storage.deleteFile('user1', 'test.txt');
      expect(fsMock.promises.unlink).toHaveBeenCalled();
    });

    it('deletes a directory recursively', async () => {
      vi.mocked(fsMock.promises.stat).mockResolvedValue({
        size: 0,
        isDirectory: () => true,
        mtime: new Date(),
        birthtime: new Date(),
      } as never);
      await storage.deleteFile('user1', 'somedir');
      expect(fsMock.promises.rm).toHaveBeenCalled();
    });
  });

  describe('copyFile', () => {
    it('copies file within workspace', async () => {
      vi.mocked(fsMock.promises.readdir).mockResolvedValue([]);
      vi.mocked(fsMock.promises.stat).mockResolvedValue({
        size: 100,
        isDirectory: () => false,
        mtime: new Date(),
        birthtime: new Date(),
      } as never);
      await storage.copyFile('user1', 'a.txt', 'b.txt');
      expect(fsMock.promises.copyFile).toHaveBeenCalled();
    });
  });

  describe('moveFile', () => {
    it('moves file within workspace', async () => {
      await storage.moveFile('user1', 'a.txt', 'b.txt');
      expect(fsMock.promises.rename).toHaveBeenCalled();
    });
  });

  describe('createDirectory', () => {
    it('creates directory', async () => {
      await storage.createDirectory('user1', 'new-dir');
      expect(fsMock.promises.mkdir).toHaveBeenCalled();
    });
  });

  describe('fileExists', () => {
    it('returns true when file exists', async () => {
      vi.mocked(fsMock.promises.access).mockResolvedValue(undefined);
      expect(await storage.fileExists('user1', 'test.txt')).toBe(true);
    });

    it('returns false when file does not exist', async () => {
      vi.mocked(fsMock.promises.access).mockRejectedValue(new Error('ENOENT'));
      expect(await storage.fileExists('user1', 'missing.txt')).toBe(false);
    });
  });

  describe('getFileInfo', () => {
    it('returns file metadata', async () => {
      vi.mocked(fsMock.promises.stat).mockResolvedValue({
        size: 256,
        isDirectory: () => false,
        mtime: new Date('2024-01-01'),
        birthtime: new Date('2024-01-01'),
      } as never);

      const info = await storage.getFileInfo('user1', 'test.txt');
      expect(info.name).toBe('test.txt');
      expect(info.size).toBe(256);
      expect(info.isDirectory).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Storage usage
  // -------------------------------------------------------------------------
  describe('getStorageUsage', () => {
    it('returns usage stats', async () => {
      vi.mocked(fsMock.promises.readdir).mockResolvedValue([]);
      const usage = await storage.getStorageUsage('user1');
      expect(usage.usedBytes).toBe(0);
      expect(usage.quotaBytes).toBe(2 * 1024 * 1024 * 1024);
      expect(usage.fileCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // cleanupTempFiles
  // -------------------------------------------------------------------------
  describe('cleanupTempFiles', () => {
    it('removes old temp files', async () => {
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      vi.mocked(fsMock.promises.readdir).mockResolvedValue([
        { name: 'old.tmp', isDirectory: () => false } as never,
      ]);
      vi.mocked(fsMock.promises.stat).mockResolvedValue({
        size: 10,
        isDirectory: () => false,
        mtime: oldDate,
        birthtime: oldDate,
      } as never);

      const cleaned = await storage.cleanupTempFiles('user1', 24 * 60 * 60 * 1000);
      expect(cleaned).toBe(1);
    });

    it('handles missing temp directory gracefully', async () => {
      vi.mocked(fsMock.promises.readdir).mockRejectedValue(new Error('ENOENT'));
      const cleaned = await storage.cleanupTempFiles('user1');
      expect(cleaned).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getFileHash
  // -------------------------------------------------------------------------
  describe('getFileHash', () => {
    it('returns hash of file content', async () => {
      const buf = Buffer.from('test content');
      vi.mocked(fsMock.promises.readFile).mockResolvedValue(buf);
      const hash = await storage.getFileHash('user1', 'test.txt');
      expect(hash).toBe('abcdef1234567890');
    });
  });
});

// ---------------------------------------------------------------------------
// Singleton functions
// ---------------------------------------------------------------------------
describe('getStorage', () => {
  it('returns an IsolatedStorage instance', () => {
    const s = initializeStorage('/tmp/test-storage', 1);
    expect(s).toBeInstanceOf(IsolatedStorage);
  });
});
