/**
 * File System Tools — definitions and registry
 *
 * Tool definitions (JSON schemas) live here; all executor functions were
 * extracted to file-system-executors.ts so the definition/executor pairing
 * is clean and the definition file stays focused on the API contract.
 */

import type { ToolDefinition, ToolExecutor } from '../types.js';
import {
  readFileExecutor,
  writeFileExecutor,
  listDirectoryExecutor,
  searchFilesExecutor,
  downloadFileExecutor,
  fileInfoExecutor,
  deleteFileExecutor,
  copyFileExecutor,
  createDirectoryExecutor,
  moveFileExecutor,
  editFileExecutor,
} from './file-system-executors.js';

// Re-export public symbols for existing import paths
export { isPathAllowedAsync, resolveFilePath } from './file-security.js';
export {
  readFileExecutor,
  writeFileExecutor,
  listDirectoryExecutor,
  searchFilesExecutor,
  downloadFileExecutor,
  fileInfoExecutor,
  deleteFileExecutor,
  copyFileExecutor,
  createDirectoryExecutor,
  moveFileExecutor,
  editFileExecutor,
  buildMissingDirHint,
  buildSearchMissHint,
  buildEditMismatchHint,
  findFlexibleMatch,
} from './file-system-executors.js';

// ========================================================================
// readFile
// ========================================================================

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  brief: 'Read file contents as text',
  description: 'Read the contents of a file. Returns the file content as text.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The file path to read' },
      encoding: {
        type: 'string',
        description: 'File encoding (default: utf-8)',
        enum: ['utf-8', 'ascii', 'base64', 'binary'],
      },
      startLine: { type: 'number', description: 'Start reading from this line (1-indexed)' },
      endLine: { type: 'number', description: 'Stop reading at this line (inclusive)' },
    },
    required: ['path'],
  },
};

// ========================================================================
// writeFile
// ========================================================================

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  brief: 'Write or create a file with given content',
  description: 'Write content to a file. Creates the file if it does not exist.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The file path to write to' },
      content: { type: 'string', description: 'The content to write' },
      append: { type: 'boolean', description: 'Append to existing file instead of overwriting' },
      createDirs: {
        type: 'boolean',
        description: 'Create parent directories if they do not exist',
      },
    },
    required: ['path', 'content'],
  },
};

// ========================================================================
// listDirectory
// ========================================================================

const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  brief: 'List files and subdirectories in a path',
  description: 'List files and directories in a path. Returns file names, sizes, and types.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The directory path to list' },
      recursive: { type: 'boolean', description: 'List recursively (default: false)' },
      pattern: { type: 'string', description: 'Filter files by glob pattern (e.g., "*.ts")' },
      includeHidden: { type: 'boolean', description: 'Include hidden files (default: false)' },
    },
    required: ['path'],
  },
};

// ========================================================================
// searchFiles
// ========================================================================

const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  brief: 'Search for text content across files',
  description: 'Search for text content in files. Returns matching files and lines.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The directory to search in' },
      query: { type: 'string', description: 'The text or regex pattern to search for' },
      filePattern: { type: 'string', description: 'File pattern to filter (e.g., "*.ts")' },
      caseSensitive: { type: 'boolean', description: 'Case sensitive search (default: false)' },
      maxResults: { type: 'number', description: 'Maximum number of results (default: 50)' },
    },
    required: ['path', 'query'],
  },
};

// ========================================================================
// downloadFile
// ========================================================================

const downloadFileTool: ToolDefinition = {
  name: 'download_file',
  brief: 'Download a file from a URL to local disk',
  description: 'Download a file from a URL and save it locally.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to download from' },
      path: { type: 'string', description: 'The local path to save the file' },
      overwrite: { type: 'boolean', description: 'Overwrite if file exists (default: false)' },
    },
    required: ['url', 'path'],
  },
};

// ========================================================================
// fileInfo
// ========================================================================

const fileInfoTool: ToolDefinition = {
  name: 'get_file_info',
  brief: 'Get file size, type, and modification date',
  description: 'Get detailed information about a file or directory.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The file or directory path' },
    },
    required: ['path'],
  },
};

// ========================================================================
// deleteFile
// ========================================================================

const deleteFileTool: ToolDefinition = {
  name: 'delete_file',
  brief: 'Delete a file or directory',
  description: 'Delete a file or directory.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The file or directory path to delete' },
      recursive: {
        type: 'boolean',
        description: 'Delete directories recursively (required for non-empty directories)',
      },
    },
    required: ['path'],
  },
};

// ========================================================================
// copyFile
// ========================================================================

const copyFileTool: ToolDefinition = {
  name: 'copy_file',
  brief: 'Copy or move a file or directory',
  description: 'Copy or move a file or directory.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'Source path' },
      destination: { type: 'string', description: 'Destination path' },
      move: { type: 'boolean', description: 'Move instead of copy (default: false)' },
      overwrite: {
        type: 'boolean',
        description: 'Overwrite destination if exists (default: false)',
      },
    },
    required: ['source', 'destination'],
  },
};

// ========================================================================
// createDirectory
// ========================================================================

const createDirectoryTool: ToolDefinition = {
  name: 'create_directory',
  brief: 'Create a directory (and any missing parent directories)',
  description:
    'Create an empty directory at the given path. Parent directories are created as needed (recursive). Idempotent — succeeds silently if the directory already exists.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The directory path to create' },
    },
    required: ['path'],
  },
};

// ========================================================================
// moveFile
// ========================================================================

const moveFileTool: ToolDefinition = {
  name: 'move_file',
  brief: 'Move or rename a file or directory',
  description:
    'Atomically move (or rename) a file or directory from source to destination. Parent directories of the destination are created as needed.',
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

// ========================================================================
// editFile
// ========================================================================

const editFileTool: ToolDefinition = {
  name: 'edit_file',
  brief: 'In-place find/replace edit of a file (no full-file rewrite)',
  description:
    'Replace `oldText` with `newText` in a file in-place. By default `oldText` must occur exactly once — set `replaceAll:true` to replace every occurrence.',
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

// ========================================================================
// Registry
// ========================================================================

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
