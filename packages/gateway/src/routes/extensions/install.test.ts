/**
 * Extensions Install Routes Tests
 *
 * Focused on the upload endpoint validations:
 *   - Extension whitelist (.md, .json, .zip, .skill)
 *   - Size limits (1 MB for single files, 5 MB for ZIP/.skill)
 *   - Successful .skill install message
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';
import { ExtensionError } from '../../services/extension-service.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

vi.mock('../../paths/index.js', () => ({
  getDataDirectoryInfo: vi.fn(() => ({ root: '/tmp/ownpilot-test' })),
}));

const mockExistsSync = vi.fn(() => true);
const mockMkdirSync = vi.fn();
const mockReaddirSync = vi.fn(() => [] as unknown[]);

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from([0xde, 0xad, 0xbe, 0xef])),
  };
});

const mockExtService = {
  installFromManifest: vi.fn(),
  install: vi.fn(),
};

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn(() => mockExtService),
    })),
  };
});

// Mock adm-zip — used for ZIP/.skill extraction
const mockEntries = vi.fn(() => []);
const mockExtractAllTo = vi.fn();
const MockAdmZip = vi.fn().mockImplementation(function () {
  return {
    getEntries: mockEntries,
    extractAllTo: mockExtractAllTo,
  };
});

vi.mock('adm-zip', () => ({ default: MockAdmZip }));

// Dynamic import AFTER mocks are in place
const { installRoutes } = await import('./install.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';

function createApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', USER_ID);
    await next();
  });
  app.route('/ext', installRoutes);
  app.onError(errorHandler);
  return app;
}

/** Build a multipart FormData request with a fake file */
function makeUploadRequest(
  fileName: string,
  content: string | Buffer,
  extraSizeBytes = 0
): Request {
  const blob =
    typeof content === 'string'
      ? new Blob([content, 'x'.repeat(extraSizeBytes)])
      : new Blob([content, Buffer.alloc(extraSizeBytes)]);
  const form = new FormData();
  form.append('file', new File([blob], fileName));
  return new Request('http://localhost/ext/upload', { method: 'POST', body: form });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

describe('POST /ext/upload — extension validation', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtService.installFromManifest.mockResolvedValue({
      id: 'ext-new',
      name: 'my-skill',
    });
    // Make adm-zip extraction succeed by default
    mockEntries.mockReturnValue([]);
    app = createApp();
  });

  // =========================================================================
  // Missing file
  // =========================================================================

  it('returns 400 when no file is uploaded', async () => {
    const form = new FormData();
    // no 'file' field
    const res = await app.request('/ext/upload', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  // =========================================================================
  // Extension whitelist
  // =========================================================================

  it('returns 400 for disallowed extension (.txt)', async () => {
    const res = await app.request(makeUploadRequest('skill.txt', 'hello'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('Invalid file type');
  });

  it('returns 400 for disallowed extension (.exe)', async () => {
    const res = await app.request(makeUploadRequest('evil.exe', 'binary'));
    expect(res.status).toBe(400);
  });

  it('allows .md extension (no size problem)', async () => {
    // Small .md file — will proceed to install; stub installFromManifest to avoid FS reads
    // The route writes to FS then calls installFromManifest. Mock FS writes are already no-ops.
    // The service call will be reached; mock it to reject so we can distinguish from validation 400.
    mockExtService.installFromManifest.mockRejectedValue(new Error('no manifest'));
    const res = await app.request(makeUploadRequest('SKILL.md', '# Hello'));
    // Any status other than 400 from validation means the extension was accepted
    expect(res.status).not.toBe(400);
  });

  it('allows .skill extension', async () => {
    // .skill is treated as ZIP — adm-zip mock returns empty entries (no manifest found)
    // We expect the route to proceed past validation and fail at "manifest not found" (500),
    // NOT at extension validation (400).
    const res = await app.request(makeUploadRequest('my-skill.skill', 'PK...fake-zip'));
    expect(res.status).not.toBe(400);
  });

  // =========================================================================
  // Size limits
  // =========================================================================

  it('returns 400 for .md file over 1 MB', async () => {
    const res = await app.request(makeUploadRequest('big.md', '', MB + 1));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('File too large');
  });

  it('returns 400 for .skill file over 5 MB', async () => {
    const res = await app.request(makeUploadRequest('huge.skill', '', 5 * MB + 1));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('File too large');
  });

  it('does NOT reject .skill file at 2 MB (uses ZIP limit of 5 MB)', async () => {
    // 2 MB is above the 1 MB single-file limit but below the 5 MB ZIP limit
    const res = await app.request(makeUploadRequest('medium.skill', '', 2 * MB));
    // Should fail due to ZIP logic, not size validation
    expect(res.status).not.toBe(400); // size validation passes
  });

  it('does NOT reject .zip file at 2 MB (uses ZIP limit)', async () => {
    const res = await app.request(makeUploadRequest('ext.zip', '', 2 * MB));
    expect(res.status).not.toBe(400);
  });

  it('rejects .json file at 1.5 MB (single-file limit is 1 MB)', async () => {
    const res = await app.request(makeUploadRequest('ext.json', '', Math.round(1.5 * MB)));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('File too large');
  });

  // =========================================================================
  // ZIP/skill upload — success path
  // =========================================================================

  it('installs successfully from ZIP when manifest found in root', async () => {
    // existsSync returns true for all paths (extensionsDir exists, manifest candidate exists)
    mockExistsSync.mockReturnValue(true);
    mockExtService.install.mockResolvedValue({
      id: 'ext-zip-1',
      manifest: {},
    });

    const res = await app.request(makeUploadRequest('my-ext.zip', 'PK...fake'));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.data.package.id).toBe('ext-zip-1');
  });

  it('creates extensions directory when it does not exist', async () => {
    // First existsSync call (extensionsDir) returns false, rest return true
    mockExistsSync
      .mockReturnValueOnce(false) // extensionsDir does not exist → mkdirSync called
      .mockReturnValue(true); // all manifest candidates exist
    mockExtService.install.mockResolvedValue({ id: 'ext-1', manifest: {} });

    const res = await app.request(makeUploadRequest('ext.zip', 'PK'));
    expect(res.status).toBe(201);
    expect(mockMkdirSync).toHaveBeenCalled();
  });

  it('scans subdirectories when no manifest found in ZIP root', async () => {
    // All existsSync calls return false (no manifest in root or subdirs initially)
    // Then for the subdirectory scan: existsSync for 'subdir/SKILL.md' returns true
    let callCount = 0;
    mockExistsSync.mockImplementation((...args: unknown[]) => {
      callCount++;
      // extensionsDir: true (first call)
      if (callCount === 1) return true;
      // Manifest in root tempDir: all false (5 candidates)
      if (callCount <= 6) return false;
      // Manifest in subdirectory: true on first candidate
      return true;
    });

    // readdirSync returns one directory entry
    mockReaddirSync.mockReturnValue([{ name: 'my-ext-subdir', isDirectory: () => true }]);

    mockExtService.install.mockResolvedValue({ id: 'ext-subdir', manifest: {} });

    const res = await app.request(makeUploadRequest('nested.zip', 'PK'));
    expect(res.status).toBe(201);
    expect(mockReaddirSync).toHaveBeenCalled();
  });

  it('returns 400 when no manifest found in ZIP anywhere', async () => {
    // existsSync: true for extensionsDir, false for ALL manifest candidates
    mockExistsSync.mockImplementation((_path: unknown) => {
      // Only first call (extensionsDir check) returns true
      if (mockExistsSync.mock.calls.length === 1) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue([]);

    const res = await app.request(makeUploadRequest('empty.zip', 'PK'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('No extension manifest found');
  });

  it('returns 400 from ZIP inner catch when ExtensionError thrown', async () => {
    // existsSync: true everywhere (manifest found)
    mockExistsSync.mockReturnValue(true);
    mockExtService.install.mockRejectedValue(
      new ExtensionError('Skill already installed', 'ALREADY_EXISTS')
    );

    const res = await app.request(makeUploadRequest('dup.zip', 'PK'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('Skill already installed');
  });

  // =========================================================================
  // Single file upload success
  // =========================================================================

  it('installs .md file successfully', async () => {
    mockExtService.install.mockResolvedValue({ id: 'ext-md', manifest: {} });

    const res = await app.request(makeUploadRequest('SKILL.md', '# My Skill\nDoes things'));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.message).toContain('installed');
  });

  it('returns 400 when single-file install throws ExtensionError (outer catch)', async () => {
    mockExtService.install.mockRejectedValue(
      new ExtensionError('Parse failed', 'VALIDATION_ERROR')
    );

    const res = await app.request(makeUploadRequest('bad.md', '# broken'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('Parse failed');
  });
});

// =========================================================================
// POST /install — from file path
// =========================================================================

describe('POST /ext/install — from file path', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('returns 400 when path is missing', async () => {
    const res = await app.request('/ext/install', {
      method: 'POST',
      body: JSON.stringify({ notPath: 'x' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('installs from path successfully', async () => {
    mockExtService.install.mockResolvedValue({ id: 'ext-path', manifest: { _security: null } });

    const res = await app.request('/ext/install', {
      method: 'POST',
      body: JSON.stringify({ path: '/home/user/my-skill/SKILL.md' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.package.id).toBe('ext-path');
  });

  it('returns 400 when install throws ExtensionError', async () => {
    mockExtService.install.mockRejectedValue(new ExtensionError('Not found', 'NOT_FOUND'));

    const res = await app.request('/ext/install', {
      method: 'POST',
      body: JSON.stringify({ path: '/missing/SKILL.md' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('Not found');
  });

  it('returns 500 when install throws generic error', async () => {
    mockExtService.install.mockRejectedValue(new Error('FS read error'));

    const res = await app.request('/ext/install', {
      method: 'POST',
      body: JSON.stringify({ path: '/some/path' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(500);
  });
});
