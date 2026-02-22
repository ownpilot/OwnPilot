/**
 * Isolated Storage Manager
 *
 * Manages per-user isolated file storage with path validation
 * to prevent directory traversal attacks.
 */

import { promises as fs } from 'node:fs';
import { join, resolve, relative, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { FileInfo, StorageUsage } from './types.js';
import { getLog } from '../services/get-log.js';

const log = getLog('Storage');

/**
 * Security error for access violations
 */
export class StorageSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageSecurityError';
  }
}

/**
 * Isolated Storage Manager
 */
export class IsolatedStorage {
  private basePath: string;
  private maxStorageBytes: number;

  constructor(basePath: string, maxStorageGB: number = 2) {
    this.basePath = resolve(basePath);
    this.maxStorageBytes = maxStorageGB * 1024 * 1024 * 1024;
  }

  /**
   * Validate and resolve a path to ensure it's within the user's workspace
   * Prevents directory traversal attacks
   */
  private validatePath(userId: string, requestedPath: string): string {
    const userBase = join(this.basePath, userId, 'workspace');
    const resolvedPath = resolve(userBase, requestedPath);

    // Ensure the resolved path starts with the user's base path
    if (!resolvedPath.startsWith(userBase)) {
      throw new StorageSecurityError(`Access denied: Path traversal detected for user ${userId}`);
    }

    return resolvedPath;
  }

  /**
   * Get the user's workspace base path
   */
  getUserWorkspacePath(userId: string): string {
    return join(this.basePath, userId, 'workspace');
  }

  /**
   * Get the user's data path (for config, logs)
   */
  getUserDataPath(userId: string): string {
    return join(this.basePath, userId, 'data');
  }

  /**
   * Create user storage directory structure
   */
  async createUserStorage(userId: string): Promise<string> {
    const userPath = join(this.basePath, userId);
    const workspacePath = join(userPath, 'workspace');
    const dataPath = join(userPath, 'data');

    // Create directories
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.mkdir(dataPath, { recursive: true });

    // Create subdirectories
    await fs.mkdir(join(workspacePath, 'projects'), { recursive: true });
    await fs.mkdir(join(workspacePath, 'uploads'), { recursive: true });
    await fs.mkdir(join(workspacePath, 'temp'), { recursive: true });

    // Create initial config file
    const configPath = join(dataPath, 'config.json');
    try {
      await fs.access(configPath);
    } catch {
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            userId,
            createdAt: new Date().toISOString(),
            settings: {},
          },
          null,
          2
        )
      );
    }

    log.info(`Created user storage for: ${userId}`);
    return workspacePath;
  }

  /**
   * Check if user storage exists
   */
  async userStorageExists(userId: string): Promise<boolean> {
    try {
      await fs.access(this.getUserWorkspacePath(userId));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete user storage (careful!)
   */
  async deleteUserStorage(userId: string): Promise<void> {
    const userPath = join(this.basePath, userId);

    // Safety check - ensure it's within base path
    if (!userPath.startsWith(this.basePath)) {
      throw new StorageSecurityError('Invalid user path');
    }

    await fs.rm(userPath, { recursive: true, force: true });
    log.info(`Deleted user storage for: ${userId}`);
  }

  /**
   * Read a file from user's workspace
   */
  async readFile(userId: string, filePath: string): Promise<string> {
    const resolvedPath = this.validatePath(userId, filePath);
    return fs.readFile(resolvedPath, 'utf-8');
  }

  /**
   * Read a binary file from user's workspace
   */
  async readBinaryFile(userId: string, filePath: string): Promise<Buffer> {
    const resolvedPath = this.validatePath(userId, filePath);
    return fs.readFile(resolvedPath);
  }

  /**
   * Write a file to user's workspace
   */
  async writeFile(userId: string, filePath: string, content: string | Buffer): Promise<void> {
    const resolvedPath = this.validatePath(userId, filePath);

    // Check storage quota before writing
    const usage = await this.getStorageUsage(userId);
    const contentSize = typeof content === 'string' ? Buffer.byteLength(content) : content.length;

    if (usage.usedBytes + contentSize > this.maxStorageBytes) {
      throw new StorageSecurityError(`Storage quota exceeded for user ${userId}`);
    }

    // Ensure parent directory exists
    await fs.mkdir(dirname(resolvedPath), { recursive: true });

    await fs.writeFile(resolvedPath, content);
  }

  /**
   * Append to a file
   */
  async appendFile(userId: string, filePath: string, content: string): Promise<void> {
    const resolvedPath = this.validatePath(userId, filePath);

    // Check storage quota
    const usage = await this.getStorageUsage(userId);
    const contentSize = Buffer.byteLength(content);

    if (usage.usedBytes + contentSize > this.maxStorageBytes) {
      throw new StorageSecurityError(`Storage quota exceeded for user ${userId}`);
    }

    await fs.appendFile(resolvedPath, content);
  }

  /**
   * Delete a file or directory
   */
  async deleteFile(userId: string, filePath: string): Promise<void> {
    const resolvedPath = this.validatePath(userId, filePath);

    const stat = await fs.stat(resolvedPath);
    if (stat.isDirectory()) {
      await fs.rm(resolvedPath, { recursive: true });
    } else {
      await fs.unlink(resolvedPath);
    }
  }

  /**
   * Copy a file
   */
  async copyFile(userId: string, sourcePath: string, destPath: string): Promise<void> {
    const resolvedSource = this.validatePath(userId, sourcePath);
    const resolvedDest = this.validatePath(userId, destPath);

    // Check storage quota
    const sourceStats = await fs.stat(resolvedSource);
    const usage = await this.getStorageUsage(userId);

    if (usage.usedBytes + sourceStats.size > this.maxStorageBytes) {
      throw new StorageSecurityError(`Storage quota exceeded for user ${userId}`);
    }

    // Ensure parent directory exists
    await fs.mkdir(dirname(resolvedDest), { recursive: true });

    await fs.copyFile(resolvedSource, resolvedDest);
  }

  /**
   * Move a file
   */
  async moveFile(userId: string, sourcePath: string, destPath: string): Promise<void> {
    const resolvedSource = this.validatePath(userId, sourcePath);
    const resolvedDest = this.validatePath(userId, destPath);

    // Ensure parent directory exists
    await fs.mkdir(dirname(resolvedDest), { recursive: true });

    await fs.rename(resolvedSource, resolvedDest);
  }

  /**
   * Create a directory
   */
  async createDirectory(userId: string, dirPath: string): Promise<void> {
    const resolvedPath = this.validatePath(userId, dirPath);
    await fs.mkdir(resolvedPath, { recursive: true });
  }

  /**
   * List files in a directory
   */
  async listFiles(
    userId: string,
    dirPath: string = '.',
    recursive: boolean = false
  ): Promise<FileInfo[]> {
    const resolvedPath = this.validatePath(userId, dirPath);
    const userBase = this.getUserWorkspacePath(userId);

    const files: FileInfo[] = [];

    const listDir = async (currentPath: string) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = join(currentPath, entry.name);
        const relativePath = relative(userBase, entryPath);

        try {
          const stat = await fs.stat(entryPath);

          files.push({
            name: entry.name,
            path: relativePath,
            size: stat.size,
            isDirectory: entry.isDirectory(),
            modifiedAt: stat.mtime,
            createdAt: stat.birthtime,
          });

          if (recursive && entry.isDirectory()) {
            await listDir(entryPath);
          }
        } catch {
          // Skip files we can't stat
        }
      }
    };

    await listDir(resolvedPath);
    return files;
  }

  /**
   * Check if a file exists
   */
  async fileExists(userId: string, filePath: string): Promise<boolean> {
    try {
      const resolvedPath = this.validatePath(userId, filePath);
      await fs.access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file info
   */
  async getFileInfo(userId: string, filePath: string): Promise<FileInfo> {
    const resolvedPath = this.validatePath(userId, filePath);
    const userBase = this.getUserWorkspacePath(userId);
    const stat = await fs.stat(resolvedPath);

    return {
      name: basename(resolvedPath),
      path: relative(userBase, resolvedPath),
      size: stat.size,
      isDirectory: stat.isDirectory(),
      modifiedAt: stat.mtime,
      createdAt: stat.birthtime,
    };
  }

  /**
   * Get storage usage for a user
   */
  async getStorageUsage(userId: string): Promise<StorageUsage> {
    const userPath = join(this.basePath, userId);

    let totalSize = 0;
    let fileCount = 0;

    const calculateSize = async (dirPath: string) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = join(dirPath, entry.name);

          if (entry.isDirectory()) {
            await calculateSize(entryPath);
          } else {
            try {
              const stat = await fs.stat(entryPath);
              totalSize += stat.size;
              fileCount++;
            } catch {
              // Skip files we can't stat
            }
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    };

    await calculateSize(userPath);

    return {
      usedBytes: totalSize,
      quotaBytes: this.maxStorageBytes,
      fileCount,
    };
  }

  /**
   * Clean up temporary files older than specified age
   */
  async cleanupTempFiles(userId: string, maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const tempPath = this.validatePath(userId, 'temp');
    const now = Date.now();
    let cleaned = 0;

    try {
      const entries = await fs.readdir(tempPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = join(tempPath, entry.name);

        try {
          const stat = await fs.stat(entryPath);
          const age = now - stat.mtime.getTime();

          if (age > maxAgeMs) {
            if (entry.isDirectory()) {
              await fs.rm(entryPath, { recursive: true });
            } else {
              await fs.unlink(entryPath);
            }
            cleaned++;
          }
        } catch {
          // Skip files we can't process
        }
      }
    } catch {
      // Temp directory might not exist
    }

    return cleaned;
  }

  /**
   * Calculate file hash
   */
  async getFileHash(
    userId: string,
    filePath: string,
    algorithm: 'sha256' | 'md5' = 'sha256'
  ): Promise<string> {
    const content = await this.readBinaryFile(userId, filePath);
    return createHash(algorithm).update(content).digest('hex');
  }
}

// Singleton instance
let storageInstance: IsolatedStorage | null = null;

/**
 * Get the global storage instance
 */
export function getStorage(basePath?: string, maxStorageGB?: number): IsolatedStorage {
  if (!storageInstance) {
    // Default to /data/workspaces or environment variable
    const defaultPath =
      process.env.SANDBOX_BASE_PATH ||
      (process.platform === 'win32' ? 'C:\\data\\workspaces' : '/data/workspaces');

    storageInstance = new IsolatedStorage(basePath || defaultPath, maxStorageGB || 2);
  }
  return storageInstance;
}

/**
 * Initialize storage with custom settings
 */
export function initializeStorage(basePath: string, maxStorageGB: number): IsolatedStorage {
  storageInstance = new IsolatedStorage(basePath, maxStorageGB);
  return storageInstance;
}
