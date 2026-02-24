/**
 * File operation tool executors
 *
 * Executors: create_folder, write_file, read_file, list_files, delete_file, move_file
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolExecutor } from '../types.js';
import { getErrorMessage } from '../../services/error-utils.js';
import { resolveWorkspacePath } from './helpers.js';

export const FILE_EXECUTORS: Record<string, ToolExecutor> = {
  create_folder: async (args) => {
    const folderPath = args.path as string;
    if (!folderPath) {
      return { content: 'Error: Path is required', isError: true };
    }

    const resolvedPath = resolveWorkspacePath(folderPath);
    if (!resolvedPath) {
      return { content: 'Error: Invalid path (must be within workspace)', isError: true };
    }

    try {
      await fsp.mkdir(resolvedPath, { recursive: true });
      return { content: `Folder created: ${folderPath}` };
    } catch (error) {
      return {
        content: `Error creating folder: ${getErrorMessage(error)}`,
        isError: true,
      };
    }
  },

  write_file: async (args) => {
    const filePath = args.path as string;
    const content = args.content as string;

    if (!filePath) {
      return { content: 'Error: Path is required', isError: true };
    }
    if (content === undefined || content === null) {
      return { content: 'Error: Content is required', isError: true };
    }

    const resolvedPath = resolveWorkspacePath(filePath);
    if (!resolvedPath) {
      return { content: 'Error: Invalid path (must be within workspace)', isError: true };
    }

    try {
      // Create parent directories if they don't exist
      const parentDir = path.dirname(resolvedPath);
      if (!fs.existsSync(parentDir)) {
        await fsp.mkdir(parentDir, { recursive: true });
      }

      await fsp.writeFile(resolvedPath, content, 'utf-8');
      const stats = await fsp.stat(resolvedPath);
      return { content: `File written: ${filePath} (${stats.size} bytes)` };
    } catch (error) {
      return {
        content: `Error writing file: ${getErrorMessage(error)}`,
        isError: true,
      };
    }
  },

  read_file: async (args) => {
    const filePath = args.path as string;
    if (!filePath) {
      return { content: 'Error: Path is required', isError: true };
    }

    const resolvedPath = resolveWorkspacePath(filePath);
    if (!resolvedPath) {
      return { content: 'Error: Invalid path (must be within workspace)', isError: true };
    }

    try {
      if (!fs.existsSync(resolvedPath)) {
        return { content: `Error: File not found: ${filePath}`, isError: true };
      }

      const stats = await fsp.stat(resolvedPath);
      if (stats.isDirectory()) {
        return { content: `Error: Path is a directory, not a file: ${filePath}`, isError: true };
      }

      const content = await fsp.readFile(resolvedPath, 'utf-8');
      return { content };
    } catch (error) {
      return {
        content: `Error reading file: ${getErrorMessage(error)}`,
        isError: true,
      };
    }
  },

  list_files: async (args) => {
    const dirPath = (args.path as string) || '';
    const recursive = args.recursive as boolean;

    const resolvedPath = resolveWorkspacePath(dirPath);
    if (!resolvedPath) {
      return { content: 'Error: Invalid path (must be within workspace)', isError: true };
    }

    try {
      if (!fs.existsSync(resolvedPath)) {
        return { content: `Error: Directory not found: ${dirPath || '/'}`, isError: true };
      }

      const stats = await fsp.stat(resolvedPath);
      if (!stats.isDirectory()) {
        return { content: `Error: Path is not a directory: ${dirPath}`, isError: true };
      }

      const listDir = async (dir: string, prefix = ''): Promise<string[]> => {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        const results: string[] = [];

        for (const entry of entries) {
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            results.push(`\u{1F4C1} ${relativePath}/`);
            if (recursive) {
              results.push(...(await listDir(path.join(dir, entry.name), relativePath)));
            }
          } else {
            const filePath = path.join(dir, entry.name);
            const fileStats = await fsp.stat(filePath);
            const size =
              fileStats.size < 1024
                ? `${fileStats.size} B`
                : fileStats.size < 1024 * 1024
                  ? `${(fileStats.size / 1024).toFixed(1)} KB`
                  : `${(fileStats.size / (1024 * 1024)).toFixed(1)} MB`;
            results.push(`\u{1F4C4} ${relativePath} (${size})`);
          }
        }

        return results;
      };

      const items = await listDir(resolvedPath);
      if (items.length === 0) {
        return { content: `Directory is empty: ${dirPath || '/'}` };
      }

      return { content: `Contents of ${dirPath || '/'}:\n${items.join('\n')}` };
    } catch (error) {
      return {
        content: `Error listing directory: ${getErrorMessage(error)}`,
        isError: true,
      };
    }
  },

  delete_file: async (args) => {
    const filePath = args.path as string;
    if (!filePath) {
      return { content: 'Error: Path is required', isError: true };
    }

    const resolvedPath = resolveWorkspacePath(filePath);
    if (!resolvedPath) {
      return { content: 'Error: Invalid path (must be within workspace)', isError: true };
    }

    try {
      if (!fs.existsSync(resolvedPath)) {
        return { content: `Error: File or folder not found: ${filePath}`, isError: true };
      }

      const stats = await fsp.stat(resolvedPath);
      if (stats.isDirectory()) {
        // Only delete empty directories for safety
        const contents = await fsp.readdir(resolvedPath);
        if (contents.length > 0) {
          return {
            content: `Error: Directory is not empty: ${filePath}. Delete contents first.`,
            isError: true,
          };
        }
        await fsp.rmdir(resolvedPath);
        return { content: `Folder deleted: ${filePath}` };
      } else {
        await fsp.unlink(resolvedPath);
        return { content: `File deleted: ${filePath}` };
      }
    } catch (error) {
      return {
        content: `Error deleting: ${getErrorMessage(error)}`,
        isError: true,
      };
    }
  },

  move_file: async (args) => {
    const source = args.source as string;
    const destination = args.destination as string;

    if (!source) {
      return { content: 'Error: Source path is required', isError: true };
    }
    if (!destination) {
      return { content: 'Error: Destination path is required', isError: true };
    }

    const sourcePath = resolveWorkspacePath(source);
    const destPath = resolveWorkspacePath(destination);

    if (!sourcePath) {
      return { content: 'Error: Invalid source path (must be within workspace)', isError: true };
    }
    if (!destPath) {
      return {
        content: 'Error: Invalid destination path (must be within workspace)',
        isError: true,
      };
    }

    try {
      if (!fs.existsSync(sourcePath)) {
        return { content: `Error: Source not found: ${source}`, isError: true };
      }

      // Create parent directory of destination if it doesn't exist
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        await fsp.mkdir(destDir, { recursive: true });
      }

      await fsp.rename(sourcePath, destPath);
      return { content: `Moved: ${source} \u2192 ${destination}` };
    } catch (error) {
      return {
        content: `Error moving: ${getErrorMessage(error)}`,
        isError: true,
      };
    }
  },
};
