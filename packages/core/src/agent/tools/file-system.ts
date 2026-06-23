/**
 * File System Tools
 *
 * Comprehensive file operations: read, write, list, download, search
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition, ToolExecutor, ToolExecutionResult, ToolContext } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';
import { isBlockedUrl, safeFetch } from './web-fetch.js';
import { isPrivateUrlAsync } from './dynamic-tool-permissions.js';
import { isPathAllowedAsync, resolveFilePath } from './file-security.js';

/**
 * Short-circuit a file-system tool call when the caller's AbortSignal has
 * fired. The agent cancel() flow plumbs the per-turn signal into
 * ToolContext.signal; this helper lets each executor bail out before
 * starting work. Returns the tool result to return if cancelled, or null
 * if the caller should proceed.
 */
function cancelledResult(context: ToolContext | undefined): ToolExecutionResult | null {
  if (context?.signal?.aborted) {
    return { content: { error: 'Tool execution cancelled' }, isError: true };
  }
  return null;
}

// Path security (allow-list, symlink resolution, self-protection) lives in
// file-security.ts; re-exported here so existing import paths keep working.
export { isPathAllowedAsync, resolveFilePath } from './file-security.js';

/** Maximum file size for read/write operations (10 MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum recursion depth for directory search */
const MAX_SEARCH_DEPTH = 20;

/** Maximum recursion depth for directory listing */
const MAX_LIST_DEPTH = 5;

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

export const readFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

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

export const writeFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const rawPath = args.path as string;
  const content = args.content as string;
  const append = args.append as boolean | undefined;

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
const listDirectoryTool: ToolDefinition = {
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

/**
 * On a "directory not found" (ENOENT) listing the agent has usually guessed a
 * path that does not exist (e.g. ./downloads). Rather than a bare error that
 * invites another blind guess, walk up to the nearest existing, allowed ancestor
 * and show what is actually there so the agent can pick a real path or list ".".
 * Bounded (≤8 levels, ≤30 names) so it can't flood context. Exported for tests.
 */
export async function buildMissingDirHint(dirPath: string, workspaceDir?: string): Promise<string> {
  let cur = path.dirname(path.resolve(dirPath));
  for (let i = 0; i < 8; i++) {
    if (!(await isPathAllowedAsync(cur, workspaceDir))) break;
    try {
      const items = await fs.readdir(cur, { withFileTypes: true });
      const names = items
        .filter((it) => !it.name.startsWith('.'))
        .slice(0, 30)
        .map((it) => (it.isDirectory() ? `${it.name}/` : it.name));
      const where = workspaceDir ? path.relative(path.resolve(workspaceDir), cur) || '.' : cur;
      return names.length === 0
        ? ` The nearest existing directory ("${where}") is empty.`
        : ` The nearest existing directory ("${where}") contains: ${names.join(', ')}. ` +
            'Use one of these, or list "." for the workspace root.';
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) break; // reached the filesystem root
      cur = parent;
    }
  }
  return ' List "." to see the workspace root before guessing subdirectory names.';
}

export const listDirectoryExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

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

    // Pre-compile glob pattern regex once (not per file entry)
    const patternRegex = pattern ? safeGlobToRegex(pattern) : null;

    async function listDir(dir: string, depth = 0): Promise<void> {
      const items = await fs.readdir(dir, { withFileTypes: true });

      for (const item of items) {
        // Skip hidden files unless requested
        if (!includeHidden && item.name.startsWith('.')) continue;

        // Apply pattern filter
        if (patternRegex) {
          if (!patternRegex.test(item.name)) continue;
        }

        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(dirPath, fullPath);

        if (item.isDirectory()) {
          entries.push({
            name: item.name,
            path: relativePath,
            type: 'directory',
          });

          if (recursive && depth < MAX_LIST_DEPTH) {
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
    const msg = getErrorMessage(error);
    const hint = /ENOENT|no such file/i.test(msg)
      ? await buildMissingDirHint(dirPath, context.workspaceDir)
      : '';
    return {
      content: `Error listing directory: ${msg}.${hint}`,
      isError: true,
    };
  }
};

/**
 * File search tool
 */
const searchFilesTool: ToolDefinition = {
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

/**
 * Build a self-correction cue when a file search returns nothing. A bare
 * `count: 0` leaves the model guessing whether the pattern, the file filter, the
 * path, or case sensitivity is at fault. This distinguishes "scanned files but
 * none matched" (loosen the query) from "scanned nothing" (the filter or path is
 * the problem). Exported for unit testing.
 */
export function buildSearchMissHint(
  filesScanned: number,
  opts: { filePattern?: string; caseSensitive?: boolean }
): string {
  if (filesScanned === 0) {
    return opts.filePattern
      ? `No files matched filePattern "${opts.filePattern}" under this path. Remove or broaden the filePattern, or check the path is correct.`
      : 'No readable files were found under this path. Verify the path exists and is a directory (use list_directory to inspect it).';
  }
  const parts = [
    `Scanned ${filesScanned} file(s) but the pattern matched no lines.`,
    'Try a shorter or less specific query',
  ];
  if (opts.caseSensitive) parts.push('set caseSensitive:false');
  parts.push('confirm the term actually appears (regex is supported — escape special chars)');
  return parts.join('; ') + '.';
}

export const searchFilesExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

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
    // Do NOT use the 'g' flag — regex.test() with 'g' maintains lastIndex state
    // across calls, causing alternating match/no-match on the same pattern for
    // different lines. We only need to know if a line contains the pattern.
    const flags = caseSensitive ? '' : 'i';
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
    let filesScanned = 0;

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
          filesScanned += 1;

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
        ...(results.length === 0
          ? { hint: buildSearchMissHint(filesScanned, { filePattern, caseSensitive }) }
          : {}),
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
const downloadFileTool: ToolDefinition = {
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

export const downloadFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

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

    // SSRF protection: block internal/private URLs (hostname check + DNS resolution check)
    if (isBlockedUrl(url) || (await isPrivateUrlAsync(url))) {
      return {
        content: 'Error: URL is blocked. Cannot download from internal or private addresses.',
        isError: true,
      };
    }

    // Download file with size limit (100 MB). safeFetch re-validates every
    // redirect hop against the SSRF block-list (plain fetch would follow a 3xx
    // to an internal address before any check could run).
    const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024;
    const response = await safeFetch(url);
    if (!response.ok) {
      return {
        content: `Error: Failed to download: ${response.status} ${response.statusText}`,
        isError: true,
      };
    }

    // Pre-check Content-Length before buffering
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_SIZE) {
      return {
        content: `Error: File too large (${Math.round(parseInt(contentLength, 10) / 1024 / 1024)}MB). Maximum download size is 100MB.`,
        isError: true,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_SIZE) {
      return {
        content: `Error: Downloaded content too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB). Maximum download size is 100MB.`,
        isError: true,
      };
    }

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
const fileInfoTool: ToolDefinition = {
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

export const fileInfoExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

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
const deleteFileTool: ToolDefinition = {
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

export const deleteFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

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
const copyFileTool: ToolDefinition = {
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

export const copyFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

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
 * Create directory tool — dedicated mkdir for autonomous agents.
 *
 * `write_file` can implicitly create parent dirs via `createDirs:true`, but
 * that requires writing an unwanted placeholder file just to make a folder.
 * Agents need explicit "make this empty directory" semantics for project
 * scaffolding, workspace setup, etc.
 */
const createDirectoryTool: ToolDefinition = {
  name: 'create_directory',
  brief: 'Create a directory (and any missing parent directories)',
  description:
    'Create an empty directory at the given path. Parent directories are created as ' +
    'needed (recursive). Idempotent — succeeds silently if the directory already exists. ' +
    'Use this for project scaffolding, workspace setup, or whenever you need a folder ' +
    'without writing a file into it.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to create',
      },
    },
    required: ['path'],
  },
};

export const createDirectoryExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const rawPath = args.path as string;
  const dirPath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(dirPath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${dirPath}`, isError: true };
  }

  try {
    await fs.mkdir(dirPath, { recursive: true });
    return {
      content: JSON.stringify({ success: true, path: dirPath, created: true }),
    };
  } catch (error) {
    return { content: `Error creating directory: ${getErrorMessage(error)}`, isError: true };
  }
};

/**
 * Move / rename tool — dedicated discoverable surface for the move op.
 *
 * The same capability exists buried under `copy_file`'s `move:true` flag,
 * but an LLM searching for "rename file" or "move file" by tool name
 * misses it. This tool calls into the same logic with explicit semantics.
 */
const moveFileTool: ToolDefinition = {
  name: 'move_file',
  brief: 'Move or rename a file or directory',
  description:
    'Atomically move (or rename) a file or directory from source to destination. ' +
    'Parent directories of the destination are created as needed. Use this instead ' +
    'of copy_file + delete_file when you want true rename/move semantics.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source path' },
      destination: { type: 'string', description: 'Destination path' },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite destination if it exists (default: false)',
      },
    },
    required: ['source', 'destination'],
  },
};

export const moveFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  // Delegate to copy_file with move:true — keeps the path/scope/overwrite
  // semantics identical to the existing copy/move so behaviour can't diverge.
  return copyFileExecutor(
    {
      source: args.source,
      destination: args.destination,
      move: true,
      overwrite: args.overwrite,
    },
    context
  );
};

/**
 * Edit file tool — in-place find/replace without full-file rewrite.
 *
 * For non-trivial edits (changing one function in a 5000-line file) the
 * `write_file` workaround is expensive: the agent has to read the whole
 * file, modify the string, and write it all back. This tool does the
 * find/replace gateway-side, so the agent only sends the diff intent.
 *
 * Semantics: replaces `oldText` with `newText` in the file. By default
 * `oldText` must occur EXACTLY ONCE — any other count rejects, since
 * silently replacing zero or multiple occurrences is the bug that
 * tools like sed have caused for decades. Override with `replaceAll`.
 */
const editFileTool: ToolDefinition = {
  name: 'edit_file',
  brief: 'In-place find/replace edit of a file (no full-file rewrite)',
  description:
    'Replace `oldText` with `newText` in a file in-place. By default `oldText` ' +
    'must occur exactly once — set `replaceAll:true` to replace every occurrence. ' +
    'Use this for surgical edits to large files where rewriting the whole file ' +
    'with write_file would be expensive. The file must already exist (use ' +
    'write_file to create new files). If an exact match is not found, a ' +
    'whitespace/CRLF-tolerant match is attempted automatically (leading ' +
    'indentation is still significant); the result reports whitespaceTolerant:true ' +
    'when that path is taken.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The file to edit' },
      oldText: {
        type: 'string',
        description: 'Text to find. Must occur exactly once unless replaceAll is true.',
      },
      newText: { type: 'string', description: 'Text to substitute in.' },
      replaceAll: {
        type: 'boolean',
        description: 'Replace every occurrence (default: false → require exactly one).',
      },
    },
    required: ['path', 'oldText', 'newText'],
  },
};

/**
 * Build a short, bounded diagnostic when `oldText` is not found verbatim.
 * The model's most common edit failure is a whitespace / indentation / line-ending
 * mismatch, or expecting content the file no longer has. A blind "not found" makes
 * the model re-guess; surfacing the real nearby content lets it self-correct on the
 * next attempt. Read-only — never mutates and is capped so it can't flood context.
 */
export function buildEditMismatchHint(original: string, oldText: string): string {
  const MAX_CTX = 600;
  const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const normOld = normalize(oldText);
  if (normOld.length > 0 && normalize(original).includes(normOld)) {
    return (
      ' A whitespace-insensitive match exists, so the difference is likely indentation, ' +
      'trailing spaces, or CRLF vs LF line endings. Re-read the file and copy oldText exactly.'
    );
  }

  const firstLine = oldText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) {
    const lines = original.split('\n');
    let idx = lines.findIndex((l) => l.includes(firstLine));
    if (idx === -1) {
      const frag = firstLine.slice(0, 24);
      idx = frag.length >= 4 ? lines.findIndex((l) => l.includes(frag)) : -1;
    }
    if (idx !== -1) {
      const start = Math.max(0, idx - 1);
      const end = Math.min(lines.length, idx + 4);
      let ctx = lines.slice(start, end).join('\n');
      if (ctx.length > MAX_CTX) ctx = ctx.slice(0, MAX_CTX) + '…';
      return (
        ` The first line of oldText was located near line ${idx + 1}. Actual file content there:\n` +
        `---\n${ctx}\n---\nCopy oldText verbatim from this region.`
      );
    }
  }
  return ' No similar text was found — the file content may differ from what you expect. Re-read the file before editing.';
}

/**
 * Build a whitespace/CRLF-normalized projection of `text` plus a map from each
 * kept character back to its original index. "Normalized" means: trailing spaces,
 * tabs, and carriage returns before each line break are dropped. This is the only
 * difference class the flexible matcher tolerates — leading indentation is preserved,
 * so the match stays semantically faithful. Internal helper for `findFlexibleMatch`.
 */
function buildNormalizedWithMap(text: string): { norm: string; map: number[] } {
  const norm: string[] = [];
  const map: number[] = [];
  const lines = text.split('\n');
  let offset = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li] ?? '';
    const trimmed = line.replace(/[ \t\r]+$/, '');
    for (let c = 0; c < trimmed.length; c++) {
      norm.push(trimmed.charAt(c));
      map.push(offset + c);
    }
    const nlPos = offset + line.length;
    if (li < lines.length - 1) {
      norm.push('\n');
      map.push(nlPos);
    }
    offset = nlPos + 1;
  }
  return { norm: norm.join(''), map };
}

/**
 * Find `oldText` inside `original` tolerating only trailing-whitespace and
 * CRLF-vs-LF differences — the single most common reason a model's `edit_file`
 * call misses by a verbatim comparison. Returns the original-string char span to
 * replace and how many such spans exist (so the caller can enforce uniqueness),
 * or null when there is no whitespace-tolerant match at all.
 *
 * Exported for direct unit testing.
 */
export function findFlexibleMatch(
  original: string,
  oldText: string
): { start: number; end: number; count: number } | null {
  const { norm: normOrig, map } = buildNormalizedWithMap(original);
  const { norm: normOld } = buildNormalizedWithMap(oldText);
  if (normOld.length === 0) return null;

  let count = 0;
  let firstIdx = -1;
  let from = 0;
  for (;;) {
    const idx = normOrig.indexOf(normOld, from);
    if (idx === -1) break;
    if (firstIdx === -1) firstIdx = idx;
    count++;
    from = idx + 1; // count overlapping occurrences conservatively
  }
  if (count === 0) return null;

  const lastNorm = firstIdx + normOld.length - 1;
  const start = map[firstIdx];
  const lastOrig = map[lastNorm];
  if (start === undefined || lastOrig === undefined) return null;
  return { start, end: lastOrig + 1, count };
}

export const editFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const rawPath = args.path as string;
  const oldText = args.oldText as string;
  const newText = args.newText as string;
  const replaceAll = (args.replaceAll as boolean | undefined) ?? false;

  if (typeof oldText !== 'string' || oldText.length === 0) {
    return { content: 'Error: oldText must be a non-empty string', isError: true };
  }
  if (typeof newText !== 'string') {
    return { content: 'Error: newText must be a string', isError: true };
  }

  const filePath = resolveFilePath(rawPath, context.workspaceDir);
  if (!(await isPathAllowedAsync(filePath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${filePath}`, isError: true };
  }

  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_FILE_SIZE) {
      return {
        content: `Error: File too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        isError: true,
      };
    }

    const original = await fs.readFile(filePath, 'utf-8');

    // Count occurrences (use split for exact substring match, not regex).
    const occurrences = original.split(oldText).length - 1;

    // Exact match missed — try a whitespace/CRLF-tolerant fallback before
    // giving up. This rescues the most common edit miss (the model copies the
    // text but with different trailing whitespace or line endings) without
    // resorting to fuzzy semantic matching, which could edit the wrong region.
    if (occurrences === 0) {
      const flex = findFlexibleMatch(original, oldText);
      if (!flex) {
        return {
          content: `Error: oldText not found in file. The file was not modified.${buildEditMismatchHint(original, oldText)}`,
          isError: true,
        };
      }
      if (flex.count > 1 && !replaceAll) {
        return {
          content: `Error: oldText occurs ${flex.count} times (whitespace-tolerant match). Set replaceAll:true to replace all, or extend oldText so it matches uniquely.`,
          isError: true,
        };
      }

      let updated: string;
      let replacements: number;
      if (replaceAll) {
        // Re-scan from each match's end so every non-overlapping region is replaced.
        let result = '';
        let cursor = 0;
        replacements = 0;
        for (;;) {
          const m = findFlexibleMatch(original.slice(cursor), oldText);
          if (!m) break;
          result += original.slice(cursor, cursor + m.start) + newText;
          cursor += m.end;
          replacements++;
        }
        result += original.slice(cursor);
        updated = result;
      } else {
        updated = original.slice(0, flex.start) + newText + original.slice(flex.end);
        replacements = 1;
      }

      await fs.writeFile(filePath, updated, 'utf-8');
      return {
        content: JSON.stringify({
          success: true,
          path: filePath,
          replacements,
          sizeBefore: original.length,
          sizeAfter: updated.length,
          whitespaceTolerant: true,
        }),
      };
    }

    if (occurrences > 1 && !replaceAll) {
      return {
        content: `Error: oldText occurs ${occurrences} times. Set replaceAll:true to replace all, or extend oldText so it matches uniquely.`,
        isError: true,
      };
    }

    const updated = replaceAll
      ? original.split(oldText).join(newText)
      : original.replace(oldText, newText);

    await fs.writeFile(filePath, updated, 'utf-8');
    return {
      content: JSON.stringify({
        success: true,
        path: filePath,
        replacements: replaceAll ? occurrences : 1,
        sizeBefore: original.length,
        sizeAfter: updated.length,
      }),
    };
  } catch (error) {
    return { content: `Error editing file: ${getErrorMessage(error)}`, isError: true };
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
  { definition: createDirectoryTool, executor: createDirectoryExecutor },
  { definition: moveFileTool, executor: moveFileExecutor },
  { definition: editFileTool, executor: editFileExecutor },
];
