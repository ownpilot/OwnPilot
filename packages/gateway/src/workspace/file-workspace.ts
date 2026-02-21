/**
 * File Workspace Management
 *
 * Manages isolated file system directories for AI-generated code execution.
 * Uses the centralized paths module for consistent data location.
 *
 * Structure (under app data directory):
 * workspace/
 * ├── {session-id}/           # Session-specific workspace
 * │   ├── .meta.json          # Workspace metadata
 * │   ├── scripts/            # Python, JS, shell scripts
 * │   ├── output/             # Output files, results
 * │   ├── temp/               # Temporary files
 * │   └── downloads/          # Downloaded files
 * ├── {session-id-2}/
 * │   └── ...
 * └── _shared/                # Shared files across sessions (legacy)
 */

import { existsSync, readdirSync, statSync, unlinkSync, rmSync, mkdirSync, writeFileSync, readFileSync, createWriteStream } from 'node:fs';
import { join, resolve, sep, relative, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getDataPaths,
  getWorkspacePath,
  initializeDataDirectories,
  type WorkspaceSubdir,
} from '../paths/index.js';
import { MS_PER_DAY, MS_PER_HOUR } from '../config/defaults.js';
import { getLog } from '../services/log.js';

const log = getLog('FileWorkspace');

// Workspace subdirectories
const WORKSPACE_SUBDIRS: WorkspaceSubdir[] = ['scripts', 'output', 'temp', 'downloads'];

export interface FileWorkspaceConfig {
  dataDir: string;
  workspaceDir: string;
  scriptsDir: string;
  outputDir: string;
  tempDir: string;
  downloadsDir: string;
}

let fileWorkspaceConfig: FileWorkspaceConfig | null = null;

/**
 * Initialize file workspace directories
 */
export function initializeFileWorkspace(): FileWorkspaceConfig {
  if (fileWorkspaceConfig) {
    return fileWorkspaceConfig;
  }

  // Initialize all data directories (including workspace)
  const paths = initializeDataDirectories();

  fileWorkspaceConfig = {
    dataDir: paths.root,
    workspaceDir: paths.workspace,
    scriptsDir: paths.scripts,
    outputDir: paths.output,
    tempDir: paths.temp,
    downloadsDir: paths.downloads,
  };

  // Set environment variable for code execution tools
  process.env.WORKSPACE_DIR = fileWorkspaceConfig.workspaceDir;

  log.info(`[FileWorkspace] Initialized at: ${fileWorkspaceConfig.workspaceDir}`);

  return fileWorkspaceConfig;
}

/**
 * Get file workspace configuration
 */
export function getFileWorkspaceConfig(): FileWorkspaceConfig {
  if (!fileWorkspaceConfig) {
    return initializeFileWorkspace();
  }
  return fileWorkspaceConfig;
}

/**
 * Get path for a new script file
 */
export function getScriptPath(filename: string): string {
  return join(getWorkspacePath('scripts'), filename);
}

/**
 * Get path for an output file
 */
export function getOutputPath(filename: string): string {
  return join(getWorkspacePath('output'), filename);
}

/**
 * Get path for a temp file
 */
export function getTempPath(filename: string): string {
  return join(getWorkspacePath('temp'), filename);
}

/**
 * Get path for a downloaded file
 */
export function getDownloadPath(filename: string): string {
  return join(getWorkspacePath('downloads'), filename);
}

/**
 * List files in a workspace subdirectory
 */
export function listWorkspaceFiles(subdir: WorkspaceSubdir): {
  name: string;
  path: string;
  size: number;
  modified: Date;
}[] {
  const dir = getWorkspacePath(subdir);

  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir);
  return files.map(name => {
    const filePath = join(dir, name);
    const stats = statSync(filePath);
    return {
      name,
      path: filePath,
      size: stats.size,
      modified: stats.mtime,
    };
  }).filter(f => {
    try {
      const stats = statSync(join(dir, f.name));
      return stats.isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Clean old temp files (older than maxAge in hours)
 */
export function cleanTempFiles(maxAgeHours: number = 24): number {
  const tempDir = getWorkspacePath('temp');

  if (!existsSync(tempDir)) {
    return 0;
  }

  const maxAge = maxAgeHours * MS_PER_HOUR;
  const now = Date.now();
  let cleaned = 0;

  const files = readdirSync(tempDir);
  for (const file of files) {
    const filePath = join(tempDir, file);
    try {
      const stats = statSync(filePath);
      if (now - stats.mtime.getTime() > maxAge) {
        if (stats.isDirectory()) {
          rmSync(filePath, { recursive: true });
        } else {
          unlinkSync(filePath);
        }
        cleaned++;
      }
    } catch (err) {
      log.warn('Failed to clean temp file', { file, error: String(err) });
    }
  }

  return cleaned;
}

/**
 * Get workspace statistics
 */
export function getFileWorkspaceStats(): {
  scriptsCount: number;
  outputCount: number;
  tempCount: number;
  downloadsCount: number;
  totalSizeBytes: number;
} {
  let totalSize = 0;
  const counts: Record<string, number> = {};

  for (const subdir of WORKSPACE_SUBDIRS) {
    const dir = getWorkspacePath(subdir);
    if (!existsSync(dir)) {
      counts[subdir] = 0;
      continue;
    }

    const files = readdirSync(dir);
    counts[subdir] = files.length;

    for (const file of files) {
      try {
        const stats = statSync(join(dir, file));
        if (stats.isFile()) {
          totalSize += stats.size;
        }
      } catch {
        // Ignore
      }
    }
  }

  return {
    scriptsCount: counts['scripts'] ?? 0,
    outputCount: counts['output'] ?? 0,
    tempCount: counts['temp'] ?? 0,
    downloadsCount: counts['downloads'] ?? 0,
    totalSizeBytes: totalSize,
  };
}

/**
 * Check if a path is within the workspace
 */
export function isInFileWorkspace(filePath: string): boolean {
  const workspaceDir = getDataPaths().workspace;
  const resolved = resolve(filePath);
  return resolved.startsWith(workspaceDir + sep) || resolved === workspaceDir;
}

/**
 * Validate that a path is safe for writing
 * Only allows writing to workspace directories
 */
export function validateWritePath(filePath: string): { valid: boolean; error?: string; suggestedPath?: string } {
  const resolved = resolve(filePath);

  // Check if in workspace
  if (isInFileWorkspace(resolved)) {
    return { valid: true };
  }

  // Suggest a safe path based on file extension
  const filename = filePath.split(/[/\\]/).pop() ?? 'file';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  let suggestedDir: string;
  if (['py', 'js', 'ts', 'sh', 'bash'].includes(ext)) {
    suggestedDir = getWorkspacePath('scripts');
  } else if (['txt', 'json', 'csv', 'xml', 'html', 'md'].includes(ext)) {
    suggestedDir = getWorkspacePath('output');
  } else {
    suggestedDir = getWorkspacePath('temp');
  }

  return {
    valid: false,
    error: `Cannot write to path outside workspace: ${filePath}`,
    suggestedPath: join(suggestedDir, filename),
  };
}

// =============================================================================
// Session-Based Workspace Management
// =============================================================================

/**
 * Session workspace metadata
 */
export interface SessionWorkspaceMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  description?: string;
  tags?: string[];
}

/**
 * Session workspace info with stats
 */
export interface SessionWorkspaceInfo extends SessionWorkspaceMeta {
  path: string;
  size: number;
  fileCount: number;
}

/**
 * File info in workspace
 */
export interface WorkspaceFileInfo {
  name: string;
  path: string;
  relativePath: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: string;
  children?: WorkspaceFileInfo[];
}

// Session workspace subdirectories
const SESSION_SUBDIRS: WorkspaceSubdir[] = ['scripts', 'output', 'temp', 'downloads'];

/**
 * Validate workspace ID to prevent path traversal via the ID parameter itself.
 * IDs should be UUIDs or short alphanumeric strings — never contain path separators or dots.
 */
function validateWorkspaceId(id: string): string {
  if (!id || /[/\\]|\.\./.test(id)) {
    throw new Error('Invalid workspace ID');
  }
  return id;
}

/**
 * Create a new session workspace
 */
export function createSessionWorkspace(options: {
  name?: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  description?: string;
  tags?: string[];
} = {}): SessionWorkspaceInfo {
  const workspaceRoot = getDataPaths().workspace;
  const id = options.sessionId || randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  const meta: SessionWorkspaceMeta = {
    id,
    name: options.name || `session-${id}`,
    createdAt: now,
    updatedAt: now,
    userId: options.userId,
    agentId: options.agentId,
    sessionId: options.sessionId || id,
    description: options.description,
    tags: options.tags,
  };

  const workspacePath = join(workspaceRoot, id);

  // Create workspace directories
  mkdirSync(workspacePath, { recursive: true });
  for (const subdir of SESSION_SUBDIRS) {
    mkdirSync(join(workspacePath, subdir), { recursive: true });
  }

  // Write metadata
  writeFileSync(
    join(workspacePath, '.meta.json'),
    JSON.stringify(meta, null, 2)
  );

  log.info(`[FileWorkspace] Created session workspace: ${id}`);

  return {
    ...meta,
    path: workspacePath,
    size: 0,
    fileCount: 0,
  };
}

/**
 * Get session workspace by ID
 */
export function getSessionWorkspace(id: string): SessionWorkspaceInfo | null {
  validateWorkspaceId(id);
  const workspaceRoot = getDataPaths().workspace;
  const workspacePath = join(workspaceRoot, id);

  if (!existsSync(workspacePath)) {
    return null;
  }

  const stat = statSync(workspacePath);
  if (!stat.isDirectory()) {
    return null;
  }

  const metaPath = join(workspacePath, '.meta.json');
  let meta: SessionWorkspaceMeta;

  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    } catch {
      // Invalid meta file, create default
      meta = {
        id,
        name: `session-${id}`,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      };
    }
  } else {
    // Legacy workspace without metadata
    meta = {
      id,
      name: `session-${id}`,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    };
  }

  const { size, fileCount } = calculateDirSize(workspacePath);

  return {
    ...meta,
    path: workspacePath,
    size,
    fileCount,
  };
}

/**
 * Get or create session workspace
 */
export function getOrCreateSessionWorkspace(sessionId: string, agentId?: string, userId?: string): SessionWorkspaceInfo {
  const existing = getSessionWorkspace(sessionId);
  if (existing) {
    return existing;
  }
  return createSessionWorkspace({ sessionId, agentId, userId });
}

/**
 * List all session workspaces
 */
export function listSessionWorkspaces(userId?: string): SessionWorkspaceInfo[] {
  const workspaceRoot = getDataPaths().workspace;

  if (!existsSync(workspaceRoot)) {
    return [];
  }

  const entries = readdirSync(workspaceRoot, { withFileTypes: true });
  const workspaces: SessionWorkspaceInfo[] = [];

  for (const entry of entries) {
    // Skip non-directories and special folders
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.endsWith('.zip')) {
      continue;
    }

    const info = getSessionWorkspace(entry.name);
    if (info) {
      // Filter by userId when provided (skip legacy workspaces without userId)
      if (userId && info.userId && info.userId !== userId) {
        continue;
      }
      workspaces.push(info);
    }
  }

  // Sort by updatedAt descending
  workspaces.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return workspaces;
}

/**
 * Get file tree for a session workspace
 */
export function getSessionWorkspaceFiles(id: string, subPath: string = ''): WorkspaceFileInfo[] {
  validateWorkspaceId(id);
  const workspaceRoot = getDataPaths().workspace;
  const workspacePath = resolve(workspaceRoot, id);
  const targetPath = subPath ? resolve(workspacePath, subPath) : workspacePath;

  // Security: ensure subPath doesn't escape workspace
  if (!targetPath.startsWith(workspacePath + sep) && targetPath !== workspacePath) {
    throw new Error('Path traversal attempt detected');
  }

  if (!existsSync(targetPath)) {
    return [];
  }

  return buildFileTree(targetPath, workspacePath);
}

const MAX_TREE_DEPTH = 20;

function buildFileTree(dirPath: string, rootPath: string, depth = 0): WorkspaceFileInfo[] {
  if (depth >= MAX_TREE_DEPTH) return [];

  const entries = readdirSync(dirPath, { withFileTypes: true });
  const files: WorkspaceFileInfo[] = [];

  for (const entry of entries) {
    if (entry.name === '.meta.json') continue;

    const fullPath = join(dirPath, entry.name);
    const stat = statSync(fullPath);
    const relativePath = relative(rootPath, fullPath);

    const file: WorkspaceFileInfo = {
      name: entry.name,
      path: fullPath,
      relativePath,
      size: stat.size,
      isDirectory: entry.isDirectory(),
      modifiedAt: stat.mtime.toISOString(),
    };

    if (entry.isDirectory()) {
      file.children = buildFileTree(fullPath, rootPath, depth + 1);
      // Calculate directory size from children
      file.size = file.children.reduce((sum, child) => sum + child.size, 0);
    }

    files.push(file);
  }

  // Sort: directories first, then by name
  files.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return files;
}

/**
 * Read a file from session workspace
 */
export function readSessionWorkspaceFile(id: string, filePath: string): Buffer | null {
  validateWorkspaceId(id);
  const workspaceRoot = getDataPaths().workspace;
  const fullPath = resolve(workspaceRoot, id, filePath);
  const allowedPrefix = resolve(workspaceRoot, id) + sep;

  // Security: ensure path is within workspace (trailing sep prevents prefix collision)
  if (!fullPath.startsWith(allowedPrefix)) {
    throw new Error('Path traversal attempt detected');
  }

  if (!existsSync(fullPath)) {
    return null;
  }

  return readFileSync(fullPath);
}

/**
 * Write a file to session workspace
 */
export function writeSessionWorkspaceFile(id: string, filePath: string, content: Buffer | string): void {
  validateWorkspaceId(id);
  const workspaceRoot = getDataPaths().workspace;
  const fullPath = resolve(workspaceRoot, id, filePath);
  const allowedPrefix = resolve(workspaceRoot, id) + sep;

  // Security: ensure path is within workspace (trailing sep prevents prefix collision)
  if (!fullPath.startsWith(allowedPrefix)) {
    throw new Error('Path traversal attempt detected');
  }

  // Ensure directory exists
  const dir = join(fullPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(fullPath, content);
  updateSessionWorkspaceMeta(id);
}

/**
 * Delete a file from session workspace
 */
export function deleteSessionWorkspaceFile(id: string, filePath: string): boolean {
  validateWorkspaceId(id);
  const workspaceRoot = getDataPaths().workspace;
  const fullPath = resolve(workspaceRoot, id, filePath);
  const allowedPrefix = resolve(workspaceRoot, id) + sep;

  // Security: ensure path is within workspace (trailing sep prevents prefix collision)
  if (!fullPath.startsWith(allowedPrefix)) {
    throw new Error('Path traversal attempt detected');
  }

  if (!existsSync(fullPath)) {
    return false;
  }

  rmSync(fullPath, { recursive: true, force: true });
  updateSessionWorkspaceMeta(id);
  return true;
}

/**
 * Delete a session workspace
 */
export function deleteSessionWorkspace(id: string): boolean {
  validateWorkspaceId(id);
  const workspaceRoot = getDataPaths().workspace;
  const workspacePath = join(workspaceRoot, id);

  if (!existsSync(workspacePath)) {
    return false;
  }

  rmSync(workspacePath, { recursive: true, force: true });

  // Also delete zip if exists
  const zipPath = join(workspaceRoot, `${id}.zip`);
  if (existsSync(zipPath)) {
    rmSync(zipPath, { force: true });
  }

  log.info(`[FileWorkspace] Deleted session workspace: ${id}`);
  return true;
}

/**
 * Create a zip archive of session workspace
 * Returns the zip file path
 */
export async function zipSessionWorkspace(id: string): Promise<string> {
  validateWorkspaceId(id);
  const workspaceRoot = getDataPaths().workspace;
  const workspacePath = join(workspaceRoot, id);

  if (!existsSync(workspacePath)) {
    throw new Error(`Workspace ${id} not found`);
  }

  // Dynamic import for archiver (ESM)
  const archiver = await import('archiver').then(m => m.default);

  const zipPath = join(workspaceRoot, `${id}.zip`);

  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    const cleanup = (err: Error) => {
      archive.destroy();
      output.destroy();
      reject(err);
    };

    output.on('close', () => {
      log.info(`[FileWorkspace] Created zip: ${zipPath} (${archive.pointer()} bytes)`);
      resolve(zipPath);
    });

    output.on('error', cleanup);
    archive.on('error', cleanup);
    archive.pipe(output);
    archive.directory(workspacePath, basename(workspacePath));
    archive.finalize();
  });
}

/**
 * Clean up old session workspaces
 */
export function cleanupSessionWorkspaces(maxAgeDays: number = 7): { deleted: string[]; kept: string[] } {
  const workspaces = listSessionWorkspaces();
  const maxAge = maxAgeDays * MS_PER_DAY;
  const now = Date.now();

  const deleted: string[] = [];
  const kept: string[] = [];

  for (const workspace of workspaces) {
    const age = now - new Date(workspace.updatedAt).getTime();

    if (age > maxAge) {
      deleteSessionWorkspace(workspace.id);
      deleted.push(workspace.id);
    } else {
      kept.push(workspace.id);
    }
  }

  if (deleted.length > 0) {
    log.info(`[FileWorkspace] Cleaned up ${deleted.length} old workspaces`);
  }

  return { deleted, kept };
}

/**
 * Smart cleanup of session workspaces
 *
 * Modes:
 * - 'empty': delete workspaces with only .meta.json (fileCount <= 1)
 * - 'old': delete workspaces older than maxAgeDays
 * - 'both': delete workspaces matching either condition
 */
export function smartCleanupSessionWorkspaces(
  mode: 'empty' | 'old' | 'both' = 'both',
  maxAgeDays: number = 30,
  userId?: string,
): { deleted: number; kept: number; deletedEmpty: number; deletedOld: number } {
  const workspaces = listSessionWorkspaces(userId);
  const maxAge = maxAgeDays * MS_PER_DAY;
  const now = Date.now();

  let deleted = 0;
  let kept = 0;
  let deletedEmpty = 0;
  let deletedOld = 0;

  for (const workspace of workspaces) {
    const isEmpty = workspace.fileCount <= 1;
    const age = now - new Date(workspace.updatedAt).getTime();
    const isOld = age > maxAge;

    let shouldDelete = false;
    if (mode === 'empty') shouldDelete = isEmpty;
    else if (mode === 'old') shouldDelete = isOld;
    else shouldDelete = isEmpty || isOld;

    if (shouldDelete) {
      deleteSessionWorkspace(workspace.id);
      deleted++;
      if (isEmpty) deletedEmpty++;
      if (isOld) deletedOld++;
    } else {
      kept++;
    }
  }

  if (deleted > 0) {
    log.info(`[FileWorkspace] Smart cleanup (${mode}): deleted ${deleted}, kept ${kept} (empty: ${deletedEmpty}, old: ${deletedOld})`);
  }

  return { deleted, kept, deletedEmpty, deletedOld };
}

/**
 * Get path for session workspace
 */
export function getSessionWorkspacePath(sessionId: string, subdir?: WorkspaceSubdir): string {
  validateWorkspaceId(sessionId);
  const workspaceRoot = getDataPaths().workspace;
  const basePath = join(workspaceRoot, sessionId);

  if (subdir) {
    return join(basePath, subdir);
  }

  return basePath;
}

/**
 * Calculate directory size and file count
 */
function calculateDirSize(dirPath: string): { size: number; fileCount: number } {
  let size = 0;
  let fileCount = 0;

  const traverse = (path: string, depth = 0) => {
    if (depth >= MAX_TREE_DEPTH) return;
    try {
      const entries = readdirSync(path, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(path, entry.name);

        if (entry.isDirectory()) {
          traverse(fullPath, depth + 1);
        } else {
          try {
            const stat = statSync(fullPath);
            size += stat.size;
            fileCount++;
          } catch {
            // Skip inaccessible files
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  };

  traverse(dirPath);
  return { size, fileCount };
}

/**
 * Update session workspace metadata timestamp
 */
function updateSessionWorkspaceMeta(id: string): void {
  const workspaceRoot = getDataPaths().workspace;
  const metaPath = join(workspaceRoot, id, '.meta.json');

  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      meta.updatedAt = new Date().toISOString();
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    } catch {
      // Ignore meta update errors
    }
  }
}
