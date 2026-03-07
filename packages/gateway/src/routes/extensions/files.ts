/**
 * Extensions File Editor Routes
 *
 * GET  /:id/files          — List all files in a skill directory
 * GET  /:id/files/*path    — Read a single file's content
 * PUT  /:id/files/*path    — Write/create a file
 * DELETE /:id/files/*path  — Delete a file
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { getServiceRegistry, Services } from '@ownpilot/core';
import type { ExtensionService } from '../../services/extension-service.js';
import { getUserId, apiResponse, apiError, ERROR_CODES, notFoundError } from '../helpers.js';

export const fileRoutes = new Hono();

const getExtService = () => getServiceRegistry().get(Services.Extension) as ExtensionService;

/** Resolve the skill directory from a package's sourcePath */
function getSkillDir(sourcePath: string | undefined): string | null {
  if (!sourcePath || !existsSync(sourcePath)) return null;
  return dirname(sourcePath);
}

/** Validate a relative path has no traversal attacks */
function isPathSafe(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('..') || normalized.startsWith('/') || normalized.includes('\0')) {
    return false;
  }
  return true;
}

/** Verify the resolved path stays within the skill directory */
function isWithinDir(resolvedPath: string, baseDir: string): boolean {
  const normalizedBase = resolve(baseDir) + sep;
  const normalizedPath = resolve(resolvedPath);
  return normalizedPath.startsWith(normalizedBase) || normalizedPath === resolve(baseDir);
}

interface FileEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileEntry[];
}

/** Recursively scan a directory into a file tree (max 2 levels deep) */
function scanDir(dir: string, basePath: string, depth = 0): FileEntry[] {
  if (!existsSync(dir) || depth > 2) return [];
  const entries: FileEntry[] = [];

  try {
    const items = readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.')) continue;
      const relPath = basePath ? `${basePath}/${item.name}` : item.name;
      const fullPath = join(dir, item.name);

      if (item.isDirectory()) {
        entries.push({
          path: relPath,
          name: item.name,
          type: 'directory',
          children: scanDir(fullPath, relPath, depth + 1),
        });
      } else if (item.isFile()) {
        const stat = { size: 0 };
        try {
          const fs = require('node:fs');
          const s = fs.statSync(fullPath);
          stat.size = s.size;
        } catch {
          /* ignore */
        }
        entries.push({
          path: relPath,
          name: item.name,
          type: 'file',
          size: stat.size,
        });
      }
    }
  } catch {
    /* permission errors etc */
  }

  return entries;
}

/**
 * GET /:id/files — List all files in the skill directory as a tree
 */
fileRoutes.get('/:id/files', (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getExtService();
  const pkg = service.getById(id);
  if (!pkg || pkg.userId !== userId) {
    return notFoundError(c, 'Extension', id);
  }

  const skillDir = getSkillDir(pkg.sourcePath);
  if (!skillDir) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Skill has no source directory on disk. Re-install from a file to enable editing.',
      },
      422
    );
  }

  const tree = scanDir(skillDir, '');
  const manifestFile = basename(pkg.sourcePath!);

  return apiResponse(c, {
    skillDir,
    manifestFile,
    tree,
  });
});

/**
 * GET /:id/files/* — Read a single file
 */
fileRoutes.get('/:id/files/:path{.+}', (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const filePath = c.req.param('path');

  const service = getExtService();
  const pkg = service.getById(id);
  if (!pkg || pkg.userId !== userId) {
    return notFoundError(c, 'Extension', id);
  }

  if (!filePath || !isPathSafe(filePath)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid file path' },
      400
    );
  }

  const skillDir = getSkillDir(pkg.sourcePath);
  if (!skillDir) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'No source directory on disk' },
      422
    );
  }

  const fullPath = join(skillDir, filePath);
  if (!isWithinDir(fullPath, skillDir)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'Path traversal not allowed' },
      400
    );
  }

  if (!existsSync(fullPath)) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `File not found: ${filePath}` }, 404);
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const ext = filePath.split('.').pop() ?? '';
    const languageMap: Record<string, string> = {
      md: 'markdown',
      js: 'javascript',
      ts: 'typescript',
      py: 'python',
      sh: 'shell',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      html: 'html',
      css: 'css',
    };

    return apiResponse(c, {
      path: filePath,
      content,
      language: languageMap[ext] ?? 'plaintext',
      size: Buffer.byteLength(content, 'utf-8'),
    });
  } catch {
    return apiError(
      c,
      { code: ERROR_CODES.INTERNAL_ERROR, message: `Failed to read file: ${filePath}` },
      500
    );
  }
});

/**
 * PUT /:id/files/* — Write/create a file
 */
fileRoutes.put('/:id/files/:path{.+}', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const filePath = c.req.param('path');

  const service = getExtService();
  const pkg = service.getById(id);
  if (!pkg || pkg.userId !== userId) {
    return notFoundError(c, 'Extension', id);
  }

  if (!filePath || !isPathSafe(filePath)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid file path' },
      400
    );
  }

  const skillDir = getSkillDir(pkg.sourcePath);
  if (!skillDir) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'No source directory on disk' },
      422
    );
  }

  const fullPath = join(skillDir, filePath);
  if (!isWithinDir(fullPath, skillDir)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'Path traversal not allowed' },
      400
    );
  }

  let content: string;
  try {
    const body = await c.req.json();
    content = body.content;
    if (typeof content !== 'string') {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: '"content" string is required' },
        400
      );
    }
  } catch {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid JSON body' },
      400
    );
  }

  try {
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content, 'utf-8');

    return apiResponse(c, {
      path: filePath,
      size: Buffer.byteLength(content, 'utf-8'),
      saved: true,
    });
  } catch {
    return apiError(
      c,
      { code: ERROR_CODES.INTERNAL_ERROR, message: `Failed to write file: ${filePath}` },
      500
    );
  }
});

/**
 * DELETE /:id/files/* — Delete a file
 */
fileRoutes.delete('/:id/files/:path{.+}', (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');
  const filePath = c.req.param('path');

  const service = getExtService();
  const pkg = service.getById(id);
  if (!pkg || pkg.userId !== userId) {
    return notFoundError(c, 'Extension', id);
  }

  if (!filePath || !isPathSafe(filePath)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'Invalid file path' },
      400
    );
  }

  // Don't allow deleting the manifest file
  const manifestFile = basename(pkg.sourcePath ?? '');
  if (filePath === manifestFile) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'Cannot delete the manifest file' },
      400
    );
  }

  const skillDir = getSkillDir(pkg.sourcePath);
  if (!skillDir) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'No source directory on disk' },
      422
    );
  }

  const fullPath = join(skillDir, filePath);
  if (!isWithinDir(fullPath, skillDir)) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'Path traversal not allowed' },
      400
    );
  }

  if (!existsSync(fullPath)) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: `File not found: ${filePath}` }, 404);
  }

  try {
    unlinkSync(fullPath);
    return apiResponse(c, { path: filePath, deleted: true });
  } catch {
    return apiError(
      c,
      { code: ERROR_CODES.INTERNAL_ERROR, message: `Failed to delete file: ${filePath}` },
      500
    );
  }
});
