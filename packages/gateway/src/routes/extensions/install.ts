/**
 * Extensions Install Routes
 *
 * POST /install, POST /upload
 */

import { writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { getServiceRegistry, Services } from '@ownpilot/core';
import { type ExtensionService, ExtensionError } from '../../services/extension-service.js';
import { getUserId, apiResponse, apiError, ERROR_CODES, getErrorMessage, parseJsonBody } from '../helpers.js';
import { wsGateway } from '../../ws/server.js';
import { getDataDirectoryInfo } from '../../paths/index.js';

export const installRoutes = new Hono();

/** Get ExtensionService from registry (cast needed for ExtensionError-specific methods). */
const getExtService = () => getServiceRegistry().get(Services.Extension) as ExtensionService;

/** Allowed file extensions for upload */
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.md', '.json', '.zip']);

/** Max upload size: 1 MB for single files, 5 MB for ZIP */
const MAX_SINGLE_FILE_SIZE = 1 * 1024 * 1024;
const MAX_ZIP_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Generate a unique filename: originalName-<random8chars>.ext
 */
function generateUniqueFilename(originalName: string): string {
  const ext = extname(originalName);
  const baseName = originalName.slice(0, -ext.length || undefined);
  const suffix = randomBytes(4).toString('hex'); // 8 hex chars
  return `${baseName}-${suffix}${ext}`;
}

/**
 * Find an extension manifest file in a directory.
 * Same detection order as scanSingleDirectory in extension-service.
 */
function findManifestInDir(dir: string): string | null {
  const candidates = ['SKILL.md', 'extension.json', 'extension.md', 'skill.json', 'skill.md'];
  for (const name of candidates) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * POST /install - Install from file path
 */
installRoutes.post('/install', async (c) => {
  const userId = getUserId(c);
  const body = await parseJsonBody(c);

  if (!body || typeof (body as { path?: string }).path !== 'string') {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'path field is required (string)' },
      400
    );
  }

  try {
    const service = getExtService();
    const record = await service.install((body as { path: string }).path, userId);
    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'created', id: record.id });
    return apiResponse(c, { package: record, message: 'Extension installed successfully.' }, 201);
  } catch (error) {
    if (error instanceof ExtensionError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.CREATE_FAILED,
        message: getErrorMessage(error, 'Failed to install extension'),
      },
      500
    );
  }
});

/**
 * POST /upload - Upload extension file (single .md/.json or .zip)
 */
installRoutes.post('/upload', async (c) => {
  const userId = getUserId(c);

  // Parse multipart form data
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!file || typeof file === 'string') {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'file field is required (multipart file upload)',
      },
      400
    );
  }

  const uploadedFile = file as File;
  const originalName = uploadedFile.name || 'unknown';
  const ext = extname(originalName).toLowerCase();

  // Validate file extension
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Invalid file type "${ext}". Allowed: .md, .json, .zip`,
      },
      400
    );
  }

  // Validate file size
  const maxSize = ext === '.zip' ? MAX_ZIP_FILE_SIZE : MAX_SINGLE_FILE_SIZE;
  if (uploadedFile.size > maxSize) {
    const maxMB = Math.round(maxSize / 1024 / 1024);
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `File too large (${Math.round(uploadedFile.size / 1024)}KB). Maximum: ${maxMB}MB`,
      },
      400
    );
  }

  // Get extensions directory
  const dataInfo = getDataDirectoryInfo();
  const extensionsDir = join(dataInfo.root, 'extensions');
  if (!existsSync(extensionsDir)) {
    mkdirSync(extensionsDir, { recursive: true });
  }

  try {
    const fileBuffer = Buffer.from(await uploadedFile.arrayBuffer());

    if (ext === '.zip') {
      // ZIP file: extract to temp dir, find manifest, install
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let AdmZipClass: any = null;
      try {
        // Dynamic import with variable name to avoid TS static module resolution
        const admZipPkg = 'adm-zip';
        const mod = await import(admZipPkg);
        AdmZipClass = mod.default ?? mod;
      } catch {
        return apiError(
          c,
          {
            code: ERROR_CODES.EXECUTION_ERROR,
            message:
              'ZIP extraction requires the adm-zip package. Install it: pnpm add adm-zip -w --filter @ownpilot/gateway',
          },
          500
        );
      }

      // Extract ZIP to a temp subdirectory
      const tempDirName = `upload-${randomBytes(4).toString('hex')}`;
      const tempDir = join(extensionsDir, tempDirName);
      mkdirSync(tempDir, { recursive: true });

      try {
        const zip = new AdmZipClass(fileBuffer);
        zip.extractAllTo(tempDir, true);

        // Look for manifest: first check root of extracted files, then subdirectories
        let manifestPath = findManifestInDir(tempDir);

        if (!manifestPath) {
          // Check first-level subdirectories (ZIP may have a wrapper dir)
          const entries = readdirSync(tempDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              manifestPath = findManifestInDir(join(tempDir, entry.name));
              if (manifestPath) break;
            }
          }
        }

        if (!manifestPath) {
          return apiError(
            c,
            {
              code: ERROR_CODES.VALIDATION_ERROR,
              message:
                'No extension manifest found in ZIP. Expected: SKILL.md, extension.json, or extension.md',
            },
            400
          );
        }

        const service = getExtService();
        const record = await service.install(manifestPath, userId);
        wsGateway.broadcast('data:changed', {
          entity: 'extension',
          action: 'created',
          id: record.id,
        });

        return apiResponse(
          c,
          { package: record, message: 'Extension uploaded and installed from ZIP.' },
          201
        );
      } catch (error) {
        // Clean up temp dir on failure
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* ignore cleanup errors */
        }

        if (error instanceof ExtensionError) {
          return apiError(c, { code: error.code, message: error.message }, 400);
        }
        throw error;
      }
    } else {
      // Single file (.md or .json): save with unique name and install
      const uniqueName = generateUniqueFilename(originalName);

      // For single files, create a directory with the filename as the dir name
      const dirName = uniqueName.replace(/\.[^.]+$/, '');
      const destDir = join(extensionsDir, dirName);
      mkdirSync(destDir, { recursive: true });

      // Save as the canonical name (extension.json/extension.md or SKILL.md)
      let destFilename: string;
      if (originalName.toUpperCase() === 'SKILL.MD') {
        destFilename = 'SKILL.md';
      } else if (ext === '.json') {
        destFilename = 'extension.json';
      } else {
        destFilename = 'extension.md';
      }

      const destPath = join(destDir, destFilename);
      writeFileSync(destPath, fileBuffer);

      try {
        const service = getExtService();
        const record = await service.install(destPath, userId);
        wsGateway.broadcast('data:changed', {
          entity: 'extension',
          action: 'created',
          id: record.id,
        });

        return apiResponse(
          c,
          { package: record, message: 'Extension uploaded and installed.' },
          201
        );
      } catch (error) {
        // Clean up saved file on install failure
        try {
          rmSync(destDir, { recursive: true, force: true });
        } catch {
          /* ignore cleanup errors */
        }

        if (error instanceof ExtensionError) {
          return apiError(c, { code: error.code, message: error.message }, 400);
        }
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof ExtensionError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.CREATE_FAILED,
        message: getErrorMessage(error, 'Failed to upload extension'),
      },
      500
    );
  }
});
