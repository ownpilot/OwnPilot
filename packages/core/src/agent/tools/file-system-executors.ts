/**
 * File System Tool Executors
 *
 * All executor functions and shared helpers extracted from file-system.ts.
 * The tool definitions (JSON schemas) stay in file-system.ts so the
 * definition/executor pairing remains clean.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolExecutor, ToolExecutionResult, ToolContext } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';
import { isBlockedUrl, safeFetch } from './web-fetch.js';
import { isPrivateUrlAsync } from './dynamic-tool-permissions.js';
import { isPathAllowedAsync, resolveFilePath } from './file-security.js';

// Re-export shared constants so callers can reference them
export { isPathAllowedAsync, resolveFilePath } from './file-security.js';

/** Maximum file size for read/write operations (10 MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum recursion depth for directory search */
const MAX_SEARCH_DEPTH = 20;

/** Maximum recursion depth for directory listing */
const MAX_LIST_DEPTH = 5;

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

// ========================================================================
// readFile
// ========================================================================

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

    const content = await fs.readFile(filePath, { encoding });

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

// ========================================================================
// writeFile
// ========================================================================

export const writeFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const rawPath = args.path as string;
  const content = args.content as string;
  const append = args.append as boolean | undefined;

  const filePath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(filePath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${filePath}`, isError: true };
  }

  const contentSize = Buffer.byteLength(content, 'utf-8');
  if (contentSize > MAX_FILE_SIZE) {
    return {
      content: `Error: Content too large (${(contentSize / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      isError: true,
    };
  }

  try {
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

// ========================================================================
// listDirectory
// ========================================================================

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
      if (parent === cur) break;
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

    const patternRegex = pattern ? safeGlobToRegex(pattern) : null;

    async function listDir(dir: string, depth = 0): Promise<void> {
      const items = await fs.readdir(dir, { withFileTypes: true });

      for (const item of items) {
        if (!includeHidden && item.name.startsWith('.')) continue;
        if (patternRegex) {
          if (!patternRegex.test(item.name)) continue;
        }

        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(dirPath, fullPath);

        if (item.isDirectory()) {
          entries.push({ name: item.name, path: relativePath, type: 'directory' });
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
          entries.push({ name: item.name, path: relativePath, type: 'symlink' });
        }
      }
    }

    await listDir(dirPath);

    return {
      content: JSON.stringify({ path: dirPath, count: entries.length, entries }),
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

// ========================================================================
// searchFiles
// ========================================================================

/**
 * Build a self-correction cue when a file search returns nothing.
 * Exported for unit testing.
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

  const dirPath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(dirPath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${dirPath}`, isError: true };
  }

  try {
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

    const results: Array<{ file: string; line: number; content: string }> = [];
    const visited = new Set<string>();
    let filesScanned = 0;

    async function searchDir(dir: string, depth = 0): Promise<void> {
      if (results.length >= maxResults || depth > MAX_SEARCH_DEPTH) return;
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
          if (filePattern && !safeGlobToRegex(filePattern).test(item.name)) continue;
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
            /* skip unreadable */
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
    return { content: `Error searching files: ${getErrorMessage(error)}`, isError: true };
  }
};

// ========================================================================
// downloadFile
// ========================================================================

export const downloadFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const url = args.url as string;
  const rawPath = args.path as string;
  const overwrite = args.overwrite as boolean | undefined;

  const filePath = resolveFilePath(rawPath, context.workspaceDir);

  if (!(await isPathAllowedAsync(filePath, context.workspaceDir))) {
    return { content: `Error: Access denied to path: ${filePath}`, isError: true };
  }

  try {
    try {
      await fs.access(filePath);
      if (!overwrite) return { content: `Error: File already exists: ${filePath}`, isError: true };
    } catch {
      /* ok */
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (isBlockedUrl(url) || (await isPrivateUrlAsync(url))) {
      return {
        content: 'Error: URL is blocked. Cannot download from internal or private addresses.',
        isError: true,
      };
    }

    const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024;
    const response = await safeFetch(url);
    if (!response.ok) {
      return {
        content: `Error: Failed to download: ${response.status} ${response.statusText}`,
        isError: true,
      };
    }

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
    return { content: `Error downloading file: ${getErrorMessage(error)}`, isError: true };
  }
};

// ========================================================================
// fileInfo
// ========================================================================

export const fileInfoExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const rawPath = args.path as string;
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
    return { content: `Error getting file info: ${getErrorMessage(error)}`, isError: true };
  }
};

// ========================================================================
// deleteFile
// ========================================================================

export const deleteFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  const rawPath = args.path as string;
  const recursive = args.recursive as boolean | undefined;
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
    return { content: JSON.stringify({ success: true, path: filePath, deleted: true }) };
  } catch (error) {
    return { content: `Error deleting: ${getErrorMessage(error)}`, isError: true };
  }
};

// ========================================================================
// copyFile
// ========================================================================

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

  const source = resolveFilePath(rawSource, context.workspaceDir);
  const destination = resolveFilePath(rawDestination, context.workspaceDir);

  const [sourceAllowed, destAllowed] = await Promise.all([
    isPathAllowedAsync(source, context.workspaceDir),
    isPathAllowedAsync(destination, context.workspaceDir),
  ]);

  if (!sourceAllowed || !destAllowed) {
    return { content: 'Error: Access denied to path', isError: true };
  }

  try {
    try {
      await fs.access(destination);
      if (!overwrite)
        return { content: `Error: Destination exists: ${destination}`, isError: true };
    } catch {
      /* ok */
    }

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
    return { content: `Error: ${getErrorMessage(error)}`, isError: true };
  }
};

// ========================================================================
// createDirectory
// ========================================================================

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
    return { content: JSON.stringify({ success: true, path: dirPath, created: true }) };
  } catch (error) {
    return { content: `Error creating directory: ${getErrorMessage(error)}`, isError: true };
  }
};

// ========================================================================
// moveFile (delegates to copyFileExecutor with move:true)
// ========================================================================

export const moveFileExecutor: ToolExecutor = async (
  args,
  context
): Promise<ToolExecutionResult> => {
  const cancelled = cancelledResult(context);
  if (cancelled) return cancelled;

  return copyFileExecutor(
    { source: args.source, destination: args.destination, move: true, overwrite: args.overwrite },
    context
  );
};

// ========================================================================
// editFile
// ========================================================================

/**
 * Build a short, bounded diagnostic when `oldText` is not found verbatim.
 */
export function buildEditMismatchHint(original: string, oldText: string): string {
  const MAX_CTX = 600;
  const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const normOld = normalize(oldText);
  if (normOld.length > 0 && normalize(original).includes(normOld)) {
    return ' A whitespace-insensitive match exists, so the difference is likely indentation, trailing spaces, or CRLF vs LF line endings. Re-read the file and copy oldText exactly.';
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
      return ` The first line of oldText was located near line ${idx + 1}. Actual file content there:\n---\n${ctx}\n---\nCopy oldText verbatim from this region.`;
    }
  }
  return ' No similar text was found — the file content may differ from what you expect. Re-read the file before editing.';
}

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
    from = idx + 1;
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
    const occurrences = original.split(oldText).length - 1;

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
