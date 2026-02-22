/**
 * Data Paths Module
 *
 * Manages application data directories with proper separation from code.
 * Uses platform-specific conventions for data storage.
 *
 * Windows: %LOCALAPPDATA%\OwnPilot
 * Linux/Mac: ~/.ownpilot
 *
 * Directory structure:
 * - config/       User preferences and settings (JSON)
 * - data/         SQLite databases
 * - credentials/  Encrypted sensitive data
 * - personal/     User's personal data (notes, contacts, etc.)
 * - workspace/    AI workspace (scripts, output, temp)
 * - logs/         Audit and application logs
 * - cache/        Temporary cache data
 */

import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { getLog } from '../services/log.js';

const log = getLog('Paths');

// Application name for directory naming
const APP_NAME = 'OwnPilot';
const APP_NAME_UNIX = '.ownpilot';

/**
 * All data directory types
 */
export type DataDirType =
  | 'root'
  | 'config'
  | 'data'
  | 'credentials'
  | 'personal'
  | 'workspace'
  | 'logs'
  | 'cache';

/**
 * Workspace subdirectory types
 */
export type WorkspaceSubdir = 'scripts' | 'output' | 'temp' | 'downloads';

/**
 * Data paths configuration
 */
export interface DataPaths {
  root: string;
  config: string;
  data: string;
  credentials: string;
  personal: string;
  workspace: string;
  logs: string;
  cache: string;
  // Workspace subdirs
  scripts: string;
  output: string;
  temp: string;
  downloads: string;
  // Database
  database: string;
}

// Cached paths
let cachedPaths: DataPaths | null = null;

/**
 * Get platform-specific application data directory
 *
 * IMPORTANT: User data is ALWAYS stored outside the codebase,
 * regardless of development or production mode.
 * Only explicit OWNPILOT_DATA_DIR override can change this.
 */
function getAppDataDir(): string {
  // Allow override via environment variable (for testing or custom setups)
  if (process.env.OWNPILOT_DATA_DIR) {
    return resolve(process.env.OWNPILOT_DATA_DIR);
  }

  // Always use platform-specific directories - never store in codebase
  const os = platform();

  switch (os) {
    case 'win32': {
      // Windows: use LocalAppData
      const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
      return join(localAppData, APP_NAME);
    }
    case 'darwin': {
      // macOS: use Application Support
      return join(homedir(), 'Library', 'Application Support', APP_NAME);
    }
    default: {
      // Linux and others: use XDG or home directory
      const xdgData = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
      // Check if XDG is available
      if (existsSync(join(homedir(), '.local'))) {
        return join(xdgData, 'ownpilot');
      }
      // Fallback to dotfile in home
      return join(homedir(), APP_NAME_UNIX);
    }
  }
}

/**
 * Initialize and get all data paths
 */
export function getDataPaths(): DataPaths {
  if (cachedPaths) {
    return cachedPaths;
  }

  const root = getAppDataDir();

  cachedPaths = {
    root,
    config: join(root, 'config'),
    data: join(root, 'data'),
    credentials: join(root, 'credentials'),
    personal: join(root, 'personal'),
    workspace: join(root, 'workspace'),
    logs: join(root, 'logs'),
    cache: join(root, 'cache'),
    // Workspace subdirs
    scripts: join(root, 'workspace', 'scripts'),
    output: join(root, 'workspace', 'output'),
    temp: join(root, 'workspace', 'temp'),
    downloads: join(root, 'workspace', 'downloads'),
    // Database path
    database: join(root, 'data', 'gateway.db'),
  };

  return cachedPaths;
}

/**
 * Get a specific data directory path
 */
export function getDataPath(type: DataDirType): string {
  const paths = getDataPaths();
  return paths[type];
}

/**
 * Get workspace subdirectory path
 */
export function getWorkspacePath(subdir: WorkspaceSubdir): string {
  const paths = getDataPaths();
  return paths[subdir];
}

/**
 * Get database file path
 */
export function getDatabasePath(): string {
  const paths = getDataPaths();
  return paths.database;
}

/**
 * Initialize all data directories with proper permissions
 */
export function initializeDataDirectories(): DataPaths {
  const paths = getDataPaths();

  // Create all directories
  const dirsToCreate: Array<{ path: string; secure?: boolean }> = [
    { path: paths.root },
    { path: paths.config },
    { path: paths.data },
    { path: paths.credentials, secure: true }, // Restricted permissions
    { path: paths.personal },
    { path: paths.workspace },
    { path: paths.logs },
    { path: paths.cache },
    { path: paths.scripts },
    { path: paths.output },
    { path: paths.temp },
    { path: paths.downloads },
  ];

  for (const { path, secure } of dirsToCreate) {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
      log.info(`[DataPaths] Created directory: ${path}`);

      // Set restricted permissions for sensitive directories (Unix only)
      if (secure && platform() !== 'win32') {
        try {
          chmodSync(path, 0o700); // Owner only: rwx
          log.info(`[DataPaths] Set restricted permissions on: ${path}`);
        } catch {
          // Ignore permission errors
        }
      }
    }
  }

  log.info(`[DataPaths] Data root: ${paths.root}`);
  return paths;
}

/**
 * Check if data directories are properly initialized
 */
export function areDataDirectoriesInitialized(): boolean {
  const paths = getDataPaths();

  const requiredDirs = [paths.root, paths.config, paths.data, paths.workspace];

  return requiredDirs.every((dir) => existsSync(dir));
}

/**
 * Get the legacy data directory path (for migration)
 */
export function getLegacyDataPath(): string {
  return resolve(process.cwd(), 'data');
}

/**
 * Check if legacy data exists (needs migration)
 */
export function hasLegacyData(): boolean {
  const legacyPath = getLegacyDataPath();
  const legacyDb = join(legacyPath, 'gateway.db');
  return existsSync(legacyDb);
}

/**
 * Get data directory info for display
 */
export function getDataDirectoryInfo(): {
  root: string;
  database: string;
  workspace: string;
  credentials: string;
  isDefaultLocation: boolean;
  platform: string;
} {
  const paths = getDataPaths();
  const isDefaultLocation = !process.env.OWNPILOT_DATA_DIR;

  return {
    root: paths.root,
    database: paths.database,
    workspace: paths.workspace,
    credentials: paths.credentials,
    isDefaultLocation,
    platform: platform(),
  };
}

/**
 * Environment variables for data paths
 */
export function setDataPathEnvironment(): void {
  const paths = getDataPaths();

  // Set environment variables for other modules
  process.env.DATA_DIR = paths.root;
  process.env.WORKSPACE_DIR = paths.workspace;
  process.env.DATABASE_PATH = paths.database;

  log.info(`[DataPaths] Environment configured:`);
  log.info(`  DATA_DIR=${paths.root}`);
  log.info(`  WORKSPACE_DIR=${paths.workspace}`);
  log.info(`  DATABASE_PATH=${paths.database}`);
}
