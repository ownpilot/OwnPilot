/**
 * Data Migration Utility
 *
 * Migrates data from legacy location (project directory) to
 * the proper platform-specific data directory.
 */

import { existsSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDataPaths, getLegacyDataPath, hasLegacyData, initializeDataDirectories } from './index.js';
import { getLog } from '../services/log.js';

const log = getLog('Migration');

export interface MigrationResult {
  success: boolean;
  migratedFiles: string[];
  errors: string[];
  legacyPath: string;
  newPath: string;
}

/**
 * Check if migration is needed
 */
export function needsMigration(): boolean {
  if (!hasLegacyData()) {
    return false;
  }

  // Check if new location already has data
  const paths = getDataPaths();
  const newDbExists = existsSync(paths.database);

  // If new database exists, no migration needed
  if (newDbExists) {
    return false;
  }

  return true;
}

/**
 * Get migration status info
 */
export function getMigrationStatus(): {
  needsMigration: boolean;
  legacyPath: string;
  newPath: string;
  legacyFiles: string[];
} {
  const legacyPath = getLegacyDataPath();
  const paths = getDataPaths();

  const legacyFiles: string[] = [];

  if (existsSync(legacyPath)) {
    try {
      const files = readdirSync(legacyPath);
      for (const file of files) {
        const filePath = join(legacyPath, file);
        const stats = statSync(filePath);
        if (stats.isFile()) {
          legacyFiles.push(file);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return {
    needsMigration: needsMigration(),
    legacyPath,
    newPath: paths.root,
    legacyFiles,
  };
}

/**
 * Migrate data from legacy location to new location
 */
export function migrateData(_options: { backup?: boolean } = {}): MigrationResult {
  const legacyPath = getLegacyDataPath();
  const paths = initializeDataDirectories();

  const result: MigrationResult = {
    success: true,
    migratedFiles: [],
    errors: [],
    legacyPath,
    newPath: paths.root,
  };

  if (!existsSync(legacyPath)) {
    log.info('[Migration] No legacy data found, skipping migration');
    return result;
  }

  log.info(`[Migration] Starting migration from ${legacyPath} to ${paths.root}`);

  // Files to migrate
  const filesToMigrate = [
    { src: 'gateway.db', dest: paths.database },
    { src: 'gateway.db-shm', dest: join(dirname(paths.database), 'gateway.db-shm') },
    { src: 'gateway.db-wal', dest: join(dirname(paths.database), 'gateway.db-wal') },
  ];

  // Directories to migrate
  const dirsToMigrate = [
    { src: 'workspace', dest: paths.workspace },
    { src: 'audit', dest: paths.logs },
    { src: 'user', dest: paths.personal },
    { src: 'user-data', dest: paths.personal },
  ];

  // Migrate files
  for (const { src, dest } of filesToMigrate) {
    const srcPath = join(legacyPath, src);

    if (!existsSync(srcPath)) {
      continue;
    }

    try {
      // Ensure destination directory exists
      const destDir = dirname(dest);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      // Don't overwrite existing files
      if (existsSync(dest)) {
        log.info(`[Migration] Skipping ${src} (already exists at destination)`);
        continue;
      }

      // Copy file
      copyFileSync(srcPath, dest);
      result.migratedFiles.push(src);
      log.info(`[Migration] Migrated: ${src}`);
    } catch (error) {
      const errMsg = `Failed to migrate ${src}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errMsg);
      log.error(`[Migration] ${errMsg}`);
    }
  }

  // Migrate directories
  for (const { src, dest } of dirsToMigrate) {
    const srcPath = join(legacyPath, src);

    if (!existsSync(srcPath)) {
      continue;
    }

    try {
      const stats = statSync(srcPath);
      if (!stats.isDirectory()) {
        continue;
      }

      // Copy directory contents
      copyDirectoryContents(srcPath, dest);
      result.migratedFiles.push(`${src}/`);
      log.info(`[Migration] Migrated directory: ${src}/`);
    } catch (error) {
      const errMsg = `Failed to migrate ${src}/: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errMsg);
      log.error(`[Migration] ${errMsg}`);
    }
  }

  if (result.errors.length > 0) {
    result.success = false;
  }

  log.info(`[Migration] Complete. Migrated ${result.migratedFiles.length} items, ${result.errors.length} errors`);

  if (result.migratedFiles.length > 0) {
    log.info(`[Migration] IMPORTANT: You can now safely delete the legacy data directory:`);
    log.info(`[Migration]   ${legacyPath}`);
    log.info(`[Migration] Your data is now stored at: ${paths.root}`);
  }

  return result;
}

/**
 * Copy directory contents recursively
 */
function copyDirectoryContents(src: string, dest: string): void {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryContents(srcPath, destPath);
    } else if (entry.isFile()) {
      if (!existsSync(destPath)) {
        copyFileSync(srcPath, destPath);
      }
    }
  }
}

/**
 * Auto-migrate if needed (called on startup)
 */
export function autoMigrateIfNeeded(): MigrationResult | null {
  if (!needsMigration()) {
    return null;
  }

  log.info('[Migration] Legacy data detected, starting automatic migration...');
  return migrateData();
}
