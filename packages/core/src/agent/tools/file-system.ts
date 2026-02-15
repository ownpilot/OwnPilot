/**
 * File System Tools
 *
 * Comprehensive file operations: read, write, list, download, search
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';
import { isBlockedUrl } from './web-fetch.js';

/** Maximum file size for read/write operations (10 MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum recursion depth for directory search */
const MAX_SEARCH_DEPTH = 20;

/**
 * Safely convert a glob pattern to a RegExp.
 * Escapes all regex metacharacters first, then converts glob wildcards.
 * Anchored to match the full string to prevent partial matches.
 */
function safeGlobToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`, 'i');
}

/**
 * Get allowed base directories for file operations (security)
 * For self-hosted single-user setups, workspace and temp dirs are allowed
 * @param workspaceDir Optional workspace directory override from context
 */
function getAllowedPaths(workspaceDir?: string): string[] {
  const paths = [
    workspaceDir ?? process.env.WORKSPACE_DIR ?? process.cwd(),
    '/tmp',
    'C:\\Temp',
  ];

  // Only add home dir if explicitly enabled (security consideration)
  if (process.env.ALLOW_HOME_DIR_ACCESS === 'true') {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home) paths.push(home);
  }

  return paths.filter(Boolean);
}

/**
 * Get the primary workspace directory
 * @param workspaceDir Optional workspace directory override from context
 */
function getWorkspaceDir(workspaceDir?: string): string {
  return workspaceDir ?? process.env.WORKSPACE_DIR ?? process.cwd();
}

/**
 * Check if path is within allowed directories (secure implementation)
 * - Resolves symlinks to prevent escape attacks
 * - Uses proper path comparison with separator check
 * @param filePath Path to check
 * @param workspaceDir Optional workspace directory override from context
 */
async function isPathAllowedAsync(filePath: string, workspaceDir?: string): Promise<boolean> {
  try {
    // Resolve relative paths against workspace directory
    const targetPath = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(getWorkspaceDir(workspaceDir), filePath);

    // Try to resolve symlinks (if file exists)
    let resolvedPath: string;
    try {
      resolvedPath = await fs.realpath(targetPath);
    } catch {
      // File doesn't exist yet, use the normalized path
      // But still check parent directory to prevent traversal
      resolvedPath = path.normalize(targetPath);
    }

    const allowedPaths = getAllowedPaths(workspaceDir);

    for (const allowed of allowedPaths) {
      const resolvedAllowed = path.resolve(allowed);

      // Check exact match or proper subdirectory (with path separator)
      if (
        resolvedPath === resolvedAllowed ||
        resolvedPath.startsWith(resolvedAllowed + path.sep)
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Synchronous path check for backward compatibility (less secure, use async when possible)
 */
function _isPathAllowed(filePath: string, workspaceDir?: string): boolean {
  const targetPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(getWorkspaceDir(workspaceDir), filePath);

  // Normalize to resolve .. and . segments
  const normalizedPath = path.normalize(targetPath);
  const allowedPaths = getAllowedPaths(workspaceDir);

  return allowedPaths.some((allowed) => {
    const resolvedAllowed = path.resolve(allowed);
    return (
      normalizedPath === resolvedAllowed ||
      normalizedPath.startsWith(resolvedAllowed + path.sep)
    );
  });
}

/**
 * Resolve a file path, making relative paths relative to workspace
 * @param filePath Path to resolve
 * @param workspaceDir Optional workspace directory override from context
 */
function resolveFilePath(filePath: string, workspaceDir?: string): string {
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  return path.resolve(getWorkspaceDir(workspaceDir), filePath);
}

/**
 * File read tool
 */
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  brief: 'Read file contents as text',
  description: 'Read the contents of a file. Returns the file content as text.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to read',
      },
      encoding: {
        type: 'string',
        description: 'File encoding (default: utf-8)',
        enum: ['utf-8', 'ascii', 'base64', 'binary'],
      },
      startLine: {
        type: 'number',
        description: 'Start reading from this line (1-indexed)',
      },
      endLine: {
        type: 'number',
        description: 'Stop reading at this line (inclusive)',
      },
    },
    required: ['path'],
  },
};

export const readFileExecutor: ToolExecutor = async (args, context): Promise<ToolExecutionResult> => {
  const rawPath = args.path as string;
  const encoding = (args.encoding as BufferEncoding) ?? 'utf-8';
  const startLine = args.startLine as number | undefined;
  const endLine = args.endLine as number | undefined;

  // Resolve relative paths to workspace directory
  const filePath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(filePath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${filePath}`, isError: true };
  }

  try {
    // Check file size before reading to prevent memory exhaustion
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      return {
        content: `Error: File too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        isError: true,
      };
    }

    const content = await fs.readFile(filePath, { encoding });

    // Handle line range
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split('\n');
      const start = (startLine ?? 1) - 1;
      const end = endLine ?? lines.length;
      const selectedLines = lines.slice(start, end);
      return {
        content: JSON.stringify({
          path: filePath,
          lines: { start: start + 1, end: Math.min(end, lines.length), total: lines.length },
          content: selectedLines.join('\n'),
        }),
      };
    }

    return {
      content: JSON.stringify({
        path: filePath,
        size: content.length,
        content,
      }),
    };
  } catch (error) {
    return {
      content: `Error reading file: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

/**
 * File write tool
 */
export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  brief: 'Write or create a file with given content',
  description: 'Write content to a file. Creates the file if it does not exist.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file path to write to',
      },
      content: {
        type: 'string',
        description: 'The content to write',
      },
      append: {
        type: 'boolean',
        description: 'Append to existing file instead of overwriting',
      },
      createDirs: {
        type: 'boolean',
        description: 'Create parent directories if they do not exist',
      },
    },
    required: ['path', 'content'],
  },
};

export const writeFileExecutor: ToolExecutor = async (args, context): Promise<ToolExecutionResult> => {
  const rawPath = args.path as string;
  const content = args.content as string;
  const append = args.append as boolean | undefined;
  const _createDirs = args.createDirs as boolean | undefined;

  // Resolve relative paths to workspace directory
  const filePath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(filePath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${filePath}`, isError: true };
  }

  // Check content size before writing
  const contentSize = Buffer.byteLength(content, 'utf-8');
  if (contentSize > MAX_FILE_SIZE) {
    return {
      content: `Error: Content too large (${(contentSize / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      isError: true,
    };
  }

  try {
    // Always create directories for workspace paths
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (append) {
      await fs.appendFile(filePath, content);
    } else {
      await fs.writeFile(filePath, content);
    }

    const stats = await fs.stat(filePath);
    return {
      content: JSON.stringify({
        success: true,
        path: filePath,
        size: stats.size,
        action: append ? 'appended' : 'written',
      }),
    };
  } catch (error) {
    return {
      content: `Error writing file: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

/**
 * List directory tool
 */
export const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  brief: 'List files and subdirectories in a path',
  description: 'List files and directories in a path. Returns file names, sizes, and types.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list',
      },
      recursive: {
        type: 'boolean',
        description: 'List recursively (default: false)',
      },
      pattern: {
        type: 'string',
        description: 'Filter files by glob pattern (e.g., "*.ts")',
      },
      includeHidden: {
        type: 'boolean',
        description: 'Include hidden files (default: false)',
      },
    },
    required: ['path'],
  },
};

export const listDirectoryExecutor: ToolExecutor = async (args, context): Promise<ToolExecutionResult> => {
  const rawPath = args.path as string;
  const recursive = args.recursive as boolean | undefined;
  const pattern = args.pattern as string | undefined;
  const includeHidden = args.includeHidden as boolean | undefined;

  // Resolve relative paths to workspace directory
  const dirPath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(dirPath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${dirPath}`, isError: true };
  }

  try {
    const entries: Array<{
      name: string;
      path: string;
      type: 'file' | 'directory' | 'symlink';
      size?: number;
      modified?: string;
    }> = [];

    async function listDir(dir: string, depth = 0): Promise<void> {
      const items = await fs.readdir(dir, { withFileTypes: true });

      for (const item of items) {
        // Skip hidden files unless requested
        if (!includeHidden && item.name.startsWith('.')) continue;

        // Apply pattern filter
        if (pattern) {
          if (!safeGlobToRegex(pattern).test(item.name)) continue;
        }

        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(dirPath, fullPath);

        if (item.isDirectory()) {
          entries.push({
            name: item.name,
            path: relativePath,
            type: 'directory',
          });

          if (recursive && depth < 5) {
            await listDir(fullPath, depth + 1);
          }
        } else if (item.isFile()) {
          const stats = await fs.stat(fullPath);
          entries.push({
            name: item.name,
            path: relativePath,
            type: 'file',
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        } else if (item.isSymbolicLink()) {
          entries.push({
            name: item.name,
            path: relativePath,
            type: 'symlink',
          });
        }
      }
    }

    await listDir(dirPath);

    return {
      content: JSON.stringify({
        path: dirPath,
        count: entries.length,
        entries,
      }),
    };
  } catch (error) {
    return {
      content: `Error listing directory: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

/**
 * File search tool
 */
export const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  brief: 'Search for text content across files',
  description: 'Search for text content in files. Returns matching files and lines.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory to search in',
      },
      query: {
        type: 'string',
        description: 'The text or regex pattern to search for',
      },
      filePattern: {
        type: 'string',
        description: 'File pattern to filter (e.g., "*.ts")',
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Case sensitive search (default: false)',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
      },
    },
    required: ['path', 'query'],
  },
};

export const searchFilesExecutor: ToolExecutor = async (args, context): Promise<ToolExecutionResult> => {
  const rawPath = args.path as string;
  const query = args.query as string;
  const filePattern = args.filePattern as string | undefined;
  const caseSensitive = args.caseSensitive as boolean | undefined;
  const maxResults = (args.maxResults as number) ?? 50;

  // Resolve relative paths to workspace directory
  const dirPath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(dirPath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${dirPath}`, isError: true };
  }

  try {
    const flags = caseSensitive ? 'g' : 'gi';
    let regex: RegExp;
    try {
      regex = new RegExp(query, flags);
    } catch {
      return {
        content: JSON.stringify({ error: `Invalid search pattern: ${query}` }),
        isError: true,
      };
    }

    const results: Array<{
      file: string;
      line: number;
      content: string;
    }> = [];

    const visited = new Set<string>();

    async function searchDir(dir: string, depth = 0): Promise<void> {
      if (results.length >= maxResults || depth > MAX_SEARCH_DEPTH) return;

      // Prevent symlink loops
      let realDir: string;
      try {
        realDir = await fs.realpath(dir);
      } catch {
        return;
      }
      if (visited.has(realDir)) return;
      visited.add(realDir);

      const items = await fs.readdir(dir, { withFileTypes: true });

      for (const item of items) {
        if (results.length >= maxResults) break;
        if (item.name.startsWith('.')) continue;

        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
          await searchDir(fullPath, depth + 1);
        } else if (item.isFile()) {
          // Apply file pattern filter
          if (filePattern) {
            if (!safeGlobToRegex(filePattern).test(item.name)) continue;
          }

          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) break;
              const line = lines[i];
              if (line && regex.test(line)) {
                results.push({
                  file: path.relative(dirPath, fullPath),
                  line: i + 1,
                  content: line.trim().slice(0, 200),
                });
              }
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    }

    await searchDir(dirPath);

    return {
      content: JSON.stringify({
        query,
        path: dirPath,
        count: results.length,
        results,
      }),
    };
  } catch (error) {
    return {
      content: `Error searching files: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

/**
 * File download tool
 */
export const downloadFileTool: ToolDefinition = {
  name: 'download_file',
  brief: 'Download a file from a URL to local disk',
  description: 'Download a file from a URL and save it locally.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to download from',
      },
      path: {
        type: 'string',
        description: 'The local path to save the file',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite if file exists (default: false)',
      },
    },
    required: ['url', 'path'],
  },
};

export const downloadFileExecutor: ToolExecutor = async (args, context): Promise<ToolExecutionResult> => {
  const url = args.url as string;
  const rawPath = args.path as string;
  const overwrite = args.overwrite as boolean | undefined;

  // Resolve relative paths to workspace directory
  const filePath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(filePath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${filePath}`, isError: true };
  }

  try {
    // Check if file exists
    try {
      await fs.access(filePath);
      if (!overwrite) {
        return { content: `Error: File already exists: ${filePath}`, isError: true };
      }
    } catch {
      // File doesn't exist, continue
    }

    // Create directory
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // SSRF protection: block internal/private URLs
    if (isBlockedUrl(url)) {
      return {
        content: 'Error: URL is blocked. Cannot download from internal or private addresses.',
        isError: true,
      };
    }

    // Download file
    const response = await fetch(url);
    if (!response.ok) {
      return {
        content: `Error: Failed to download: ${response.status} ${response.statusText}`,
        isError: true,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(filePath, buffer);

    return {
      content: JSON.stringify({
        success: true,
        url,
        path: filePath,
        size: buffer.length,
        contentType: response.headers.get('content-type'),
      }),
    };
  } catch (error) {
    return {
      content: `Error downloading file: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

/**
 * File info tool
 */
export const fileInfoTool: ToolDefinition = {
  name: 'get_file_info',
  brief: 'Get file size, type, and modification date',
  description: 'Get detailed information about a file or directory.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file or directory path',
      },
    },
    required: ['path'],
  },
};

export const fileInfoExecutor: ToolExecutor = async (args, context): Promise<ToolExecutionResult> => {
  const rawPath = args.path as string;

  // Resolve relative paths to workspace directory
  const filePath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(filePath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${filePath}`, isError: true };
  }

  try {
    const stats = await fs.stat(filePath);

    return {
      content: JSON.stringify({
        path: filePath,
        type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
        size: stats.size,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        accessed: stats.atime.toISOString(),
        permissions: stats.mode.toString(8),
      }),
    };
  } catch (error) {
    return {
      content: `Error getting file info: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

/**
 * Delete file/directory tool
 */
export const deleteFileTool: ToolDefinition = {
  name: 'delete_file',
  brief: 'Delete a file or directory',
  description: 'Delete a file or directory.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file or directory path to delete',
      },
      recursive: {
        type: 'boolean',
        description: 'Delete directories recursively (required for non-empty directories)',
      },
    },
    required: ['path'],
  },
};

export const deleteFileExecutor: ToolExecutor = async (args, context): Promise<ToolExecutionResult> => {
  const rawPath = args.path as string;
  const recursive = args.recursive as boolean | undefined;

  // Resolve relative paths to workspace directory
  const filePath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(filePath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${filePath}`, isError: true };
  }

  try {
    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      await fs.rm(filePath, { recursive: recursive ?? false });
    } else {
      await fs.unlink(filePath);
    }

    return {
      content: JSON.stringify({
        success: true,
        path: filePath,
        deleted: true,
      }),
    };
  } catch (error) {
    return {
      content: `Error deleting: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

/**
 * Copy/Move file tool
 */
export const copyFileTool: ToolDefinition = {
  name: 'copy_file',
  brief: 'Copy or move a file or directory',
  description: 'Copy or move a file or directory.',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Source path',
      },
      destination: {
        type: 'string',
        description: 'Destination path',
      },
      move: {
        type: 'boolean',
        description: 'Move instead of copy (default: false)',
      },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite destination if exists (default: false)',
      },
    },
    required: ['source', 'destination'],
  },
};

export const copyFileExecutor: ToolExecutor = async (args, context): Promise<ToolExecutionResult> => {
  const rawSource = args.source as string;
  const rawDestination = args.destination as string;
  const move = args.move as boolean | undefined;
  const overwrite = args.overwrite as boolean | undefined;

  // Resolve relative paths to workspace directory
  const source = resolveFilePath(rawSource, context.workspaceDir);
  const destination = resolveFilePath(rawDestination, context.workspaceDir);

  const [sourceAllowed, destAllowed] = await Promise.all([
    isPathAllowedAsync(source, context.workspaceDir),
    isPathAllowedAsync(destination, context.workspaceDir),
  ]);

  if (!sourceAllowed || !destAllowed) {
    return { content: `Error: Access denied to path`, isError: true };
  }

  try {
    // Check if destination exists
    try {
      await fs.access(destination);
      if (!overwrite) {
        return { content: `Error: Destination exists: ${destination}`, isError: true };
      }
    } catch {
      // Destination doesn't exist, continue
    }

    // Create destination directory
    await fs.mkdir(path.dirname(destination), { recursive: true });

    if (move) {
      await fs.rename(source, destination);
    } else {
      await fs.copyFile(source, destination);
    }

    return {
      content: JSON.stringify({
        success: true,
        source,
        destination,
        action: move ? 'moved' : 'copied',
      }),
    };
  } catch (error) {
    return {
      content: `Error: ${getErrorMessage(error)}`,
      isError: true,
    };
  }
};

/**
 * All file system tools
 */
export const FILE_SYSTEM_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: readFileTool, executor: readFileExecutor },
  { definition: writeFileTool, executor: writeFileExecutor },
  { definition: listDirectoryTool, executor: listDirectoryExecutor },
  { definition: searchFilesTool, executor: searchFilesExecutor },
  { definition: downloadFileTool, executor: downloadFileExecutor },
  { definition: fileInfoTool, executor: fileInfoExecutor },
  { definition: deleteFileTool, executor: deleteFileExecutor },
  { definition: copyFileTool, executor: copyFileExecutor },
];
