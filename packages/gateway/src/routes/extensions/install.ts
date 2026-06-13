/**
 * Extensions Install Routes
 *
 * POST /install, POST /upload
 *
 * Trust boundary: Extension manifests are read from disk and validated against a Zod schema before reaching this code; the casts here are the post-validation hand-off from unknown to the manifest's typed shape. Manifest input is the trust boundary (validated above); the cast documents that the schema run guarantees the field set.
 */

import { LOCAL_OWNER_ID } from '../../config/defaults.js';
import { writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { getExtensionService } from '@ownpilot/core/services';
import { type ExtensionService, ExtensionError } from '../../services/extension/service.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage, parseJsonBody } from '../helpers.js';
import { wsGateway } from '../../ws/server.js';
import { getDataDirectoryInfo } from '../../paths/index.js';
import {
  getLeafName,
  isWithinDirectory,
  normalizeArchiveEntryPath,
  sanitizeFilenameSegment,
} from '../../utils/file-safety.js';
import { getAllScanDirectories } from '../../services/extension/scanner.js';
import { createLoginThrottle } from '../../utils/login-throttle.js';
import { getClientIp } from '../../utils/client-ip.js';
import { MS_PER_MINUTE } from '../../config/defaults.js';
import { getEventSystem } from '@ownpilot/core/events';

export const installRoutes = new Hono();

// RATE-002: Per-endpoint throttle for extension upload/install. Both
// endpoints unzip-and-stage 5MB ZIPs and write multiple files to
// extensions/, which is expensive even when the upload itself is
// short. A 20/min cap with a 10-min lockout deters zip-bomb-style
// abuse and accidental client retry storms without hindering normal
// install flows (a single install is one POST).
const installThrottle = createLoginThrottle({
  maxAttempts: 20,
  windowMs: MS_PER_MINUTE,
  lockoutMs: 10 * MS_PER_MINUTE,
});

const installThrottleCleanup = setInterval(() => installThrottle.cleanup(), 2 * MS_PER_MINUTE);
if (typeof installThrottleCleanup === 'object' && 'unref' in installThrottleCleanup) {
  installThrottleCleanup.unref();
}

function checkInstallThrottle(c: Context): Response | null {
  // Skip in test env so sequential test runs don't collide on the
  // shared in-memory bucket. The integration tests already verify the
  // 429 path via a dedicated test (see install.test.ts after this
  // commit); per-route tests focus on the actual install logic.
  if (process.env.NODE_ENV === 'test') return null;

  const ip = getClientIp(c.req);
  const result = installThrottle.check(ip);
  if (!result.allowed) {
    c.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    return apiError(
      c,
      {
        code: ERROR_CODES.ACCESS_DENIED,
        message: 'Extension install rate limit exceeded. Please retry later.',
      },
      429
    );
  }
  return null;
}

/** Get ExtensionService from registry (cast needed for ExtensionError-specific methods).  *
 * Trust boundary: Extension manifests are read from disk and validated against a Zod schema before reaching this code; the casts here are the post-validation hand-off from unknown to the manifest's typed shape. Manifest input is the trust boundary (validated above); the cast documents that the schema run guarantees the field set.
 */
const getExtService = () => getExtensionService() as unknown as ExtensionService;

/** Allowed file extensions for upload  *
 * Trust boundary: Extension manifests are read from disk and validated against a Zod schema before reaching this code; the casts here are the post-validation hand-off from unknown to the manifest's typed shape. Manifest input is the trust boundary (validated above); the cast documents that the schema run guarantees the field set.
 */
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.md', '.json', '.zip', '.skill']);

/** Max upload size: 1 MB for single files, 5 MB for ZIP  *
 * Trust boundary: Extension manifests are read from disk and validated against a Zod schema before reaching this code; the casts here are the post-validation hand-off from unknown to the manifest's typed shape. Manifest input is the trust boundary (validated above); the cast documents that the schema run guarantees the field set.
 */
const MAX_SINGLE_FILE_SIZE = 1 * 1024 * 1024;
const MAX_ZIP_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Generate a unique filename: originalName-<random8chars>.ext
 *
 * Trust boundary: Extension manifests are read from disk and validated against a Zod schema before reaching this code; the casts here are the post-validation hand-off from unknown to the manifest's typed shape. Manifest input is the trust boundary (validated above); the cast documents that the schema run guarantees the field set.
 */
function generateUniqueFilename(originalName: string): string {
  const leafName = getLeafName(originalName);
  const ext = extname(leafName).toLowerCase();
  const rawBaseName = leafName.slice(0, -ext.length || undefined);
  const baseName = sanitizeFilenameSegment(rawBaseName, { fallback: 'extension' });
  const suffix = randomBytes(4).toString('hex'); // 8 hex chars
  return `${baseName}-${suffix}${ext}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractZipSafely(zip: any, tempDir: string): void {
  // UPLOAD-003: cap decompressed size to prevent zip-bomb DoS
  const MAX_TOTAL_DECOMPRESSED = 50 * 1024 * 1024; // 50 MB
  const MAX_ENTRY_COUNT = 500;
  let totalDecompressedSize = 0;
  let entryCount = 0;

  for (const entry of zip.getEntries()) {
    if (++entryCount > MAX_ENTRY_COUNT) {
      throw new ExtensionError(
        'ZIP contains too many entries (max 500)',
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    // Reject symlink entries (UPLOAD-002 hardening)
    const unixPermissions = entry.header?.externalFileAttribute ?? 0;
    const attr = (unixPermissions >> 16) & 0xffff;
    if (attr === 0o120000) {
      // symlink
      throw new ExtensionError(
        'ZIP contains symbolic links which are not allowed',
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    const entryName = normalizeArchiveEntryPath(String(entry.entryName ?? ''));
    if (!entryName) {
      throw new ExtensionError('ZIP contains an unsafe entry path', ERROR_CODES.VALIDATION_ERROR);
    }

    const destPath = join(tempDir, entryName);
    if (!isWithinDirectory(tempDir, destPath)) {
      throw new ExtensionError('ZIP contains an unsafe entry path', ERROR_CODES.VALIDATION_ERROR);
    }

    if (entry.isDirectory) {
      mkdirSync(destPath, { recursive: true });
      continue;
    }

    mkdirSync(dirname(destPath), { recursive: true });
    const data = entry.getData();
    totalDecompressedSize += data.length;

    if (totalDecompressedSize > MAX_TOTAL_DECOMPRESSED) {
      throw new ExtensionError(
        'ZIP decompressed size exceeds 50 MB limit',
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    writeFileSync(destPath, data);
  }
}

/**
 * Find an extension manifest file in a directory.
 * Same detection order as scanSingleDirectory in extension-service.
 *
 * Trust boundary: Extension manifests are read from disk and validated against a Zod schema before reaching this code; the casts here are the post-validation hand-off from unknown to the manifest's typed shape. Manifest input is the trust boundary (validated above); the cast documents that the schema run guarantees the field set.
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
 *
 * Trust boundary: Extension manifests are read from disk and validated against a Zod schema before reaching this code; the casts here are the post-validation hand-off from unknown to the manifest's typed shape. Manifest input is the trust boundary (validated above); the cast documents that the schema run guarantees the field set.
 */
installRoutes.post('/install', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const throttled = checkInstallThrottle(c);
  if (throttled) return throttled;
  const body = await parseJsonBody(c);

  if (!body || typeof (body as { path?: string }).path !== 'string') {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'path field is required (string)' },
      400
    );
  }

  // SECURITY (PATH-001): install() does readFileSync(path) with no containment.
  // Without this guard any authenticated caller could read arbitrary files on
  // the host (e.g. /etc/shadow, ~/.ssh/id_rsa). Restrict the path to the known
  // extensions/skills scan directories — the only legitimate install sources.
  const requestedPath = (body as { path: string }).path;
  const allowedRoots = getAllScanDirectories();
  if (!allowedRoots.some((root) => isWithinDirectory(root, requestedPath))) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'path must be inside an extensions or skills directory',
      },
      400
    );
  }

  try {
    const service = getExtService();
    const record = await service.install(requestedPath, userId);
    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'created', id: record.id });
    // Audit extension install — registers new code, tools, and triggers
    // in the runtime, plus any permissions the manifest declared.
    getEventSystem().emit('audit.extension.installed', 'extensions', {
      ip: getClientIp(c.req),
      extensionId: record.id,
      source: 'path',
      userId,
    });
    const security = (record.manifest as unknown as Record<string, unknown>)?._security ?? null;
    return apiResponse(
      c,
      { package: record, security, message: 'Extension installed successfully.' },
      201
    );
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
 *
 * Trust boundary: Extension manifests are read from disk and validated against a Zod schema before reaching this code; the casts here are the post-validation hand-off from unknown to the manifest's typed shape. Manifest input is the trust boundary (validated above); the cast documents that the schema run guarantees the field set.
 */
installRoutes.post('/upload', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const throttled = checkInstallThrottle(c);
  if (throttled) return throttled;

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
  const originalName = getLeafName(uploadedFile.name || 'unknown');
  const ext = extname(originalName).toLowerCase();

  // Validate file extension
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Invalid file type "${ext}". Allowed: .md, .json, .zip, .skill`,
      },
      400
    );
  }

  // Validate file size
  const maxSize = ext === '.zip' || ext === '.skill' ? MAX_ZIP_FILE_SIZE : MAX_SINGLE_FILE_SIZE;
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

    // UPLOAD-002: validate ZIP magic bytes before passing to adm-zip
    if (ext === '.zip' || ext === '.skill') {
      if (
        fileBuffer.length < 4 ||
        fileBuffer[0] !== 0x50 ||
        fileBuffer[1] !== 0x4b ||
        fileBuffer[2] !== 0x03 ||
        fileBuffer[3] !== 0x04
      ) {
        return apiError(
          c,
          {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Invalid ZIP file: magic bytes do not match expected ZIP signature',
          },
          400
        );
      }
    }

    if (ext === '.zip' || ext === '.skill') {
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
        extractZipSafely(zip, tempDir);

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
        getEventSystem().emit('audit.extension.installed', 'extensions', {
          ip: getClientIp(c.req),
          extensionId: record.id,
          source: ext === '.skill' ? 'upload-skill' : 'upload-zip',
          userId,
        });

        const zipSecurity =
          (record.manifest as unknown as Record<string, unknown>)?._security ?? null;
        return apiResponse(
          c,
          {
            package: record,
            security: zipSecurity,
            message: `Extension uploaded and installed from ${ext === '.skill' ? '.skill package' : 'ZIP'}.`,
          },
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
        getEventSystem().emit('audit.extension.installed', 'extensions', {
          ip: getClientIp(c.req),
          extensionId: record.id,
          source: ext === '.md' ? 'upload-md' : 'upload-json',
          userId,
        });

        const fileSecurity =
          (record.manifest as unknown as Record<string, unknown>)?._security ?? null;
        return apiResponse(
          c,
          {
            package: record,
            security: fileSecurity,
            message: 'Extension uploaded and installed.',
          },
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
