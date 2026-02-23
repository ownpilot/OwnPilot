/**
 * Extensions Upload Route Tests
 *
 * Tests for POST /extensions/upload endpoint.
 * Covers single-file upload (.md, .json), validation, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleRecord = {
  id: 'test-ext',
  userId: 'default',
  name: 'Test Extension',
  version: '1.0.0',
  description: 'A test extension',
  category: 'utilities',
  icon: '🔧',
  authorName: 'Test Author',
  manifest: { id: 'test-ext', name: 'Test Extension', version: '1.0.0' },
  status: 'enabled' as const,
  sourcePath: '/tmp/extensions/test/extension.json',
  settings: {},
  toolCount: 1,
  triggerCount: 0,
  installedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  getAll: vi.fn(() => []),
  getById: vi.fn(() => null),
  installFromManifest: vi.fn(async () => sampleRecord),
  install: vi.fn(async () => sampleRecord),
  uninstall: vi.fn(async () => true),
  enable: vi.fn(async () => null),
  disable: vi.fn(async () => null),
  reload: vi.fn(async () => null),
  scanDirectory: vi.fn(async () => ({ installed: 0, errors: [] })),
};

vi.mock('../services/extension-service.js', () => ({
  getExtensionService: () => mockService,
  ExtensionError: class ExtensionError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = 'ExtensionError';
    }
  },
}));

vi.mock('../services/extension-types.js', () => ({
  validateManifest: vi.fn(() => ({ valid: true, errors: [] })),
}));

vi.mock('../services/extension-markdown.js', () => ({
  serializeExtensionMarkdown: vi.fn(() => '# Extension'),
}));

vi.mock('@ownpilot/core', () => ({
  createProvider: vi.fn(() => ({ complete: vi.fn() })),
  getProviderConfig: vi.fn(() => null),
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  getServiceRegistry: () => ({
    get: (token: { key: string }) => {
      if (token.key === 'extension') return mockService;
      throw new Error(`Unexpected token: ${token.key}`);
    },
  }),
  Services: { Extension: { key: 'extension' } },
}));

vi.mock('./settings.js', () => ({
  resolveProviderAndModel: vi.fn(async () => ({ provider: 'openai', model: 'gpt-4' })),
  getApiKey: vi.fn(async () => 'test-key'),
}));

vi.mock('../db/repositories/index.js', () => ({
  localProvidersRepo: {
    getProvider: vi.fn(async () => null),
  },
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: vi.fn() },
}));

// Mock paths to use temp dir
vi.mock('../paths/index.js', () => ({
  getDataDirectoryInfo: vi.fn(() => ({
    root: '/tmp/test-ownpilot',
    database: '/tmp/test-ownpilot/data/gateway.db',
    workspace: '/tmp/test-ownpilot/workspace',
    credentials: '/tmp/test-ownpilot/credentials',
    isDefaultLocation: true,
    platform: 'linux',
  })),
}));

// Mock fs operations
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
});

// Import after mocks
const { extensionsRoutes } = await import('./extensions.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp(userId = 'default') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    return next();
  });
  app.route('/extensions', extensionsRoutes);
  app.onError(errorHandler);
  return app;
}

/**
 * Helper: create a multipart form body with a file.
 */
function createFormData(filename: string, content: string | Buffer): FormData {
  const formData = new FormData();
  const blob = new Blob([content], { type: 'application/octet-stream' });
  formData.append('file', blob, filename);
  return formData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /extensions/upload', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService.install.mockResolvedValue(sampleRecord);
    app = createApp();
  });

  it('uploads a single .json file successfully', async () => {
    const manifest = JSON.stringify({
      id: 'test-ext',
      name: 'Test',
      version: '1.0.0',
      tools: [],
    });
    const form = createFormData('extension.json', manifest);

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.package).toBeDefined();
    expect(body.data.message).toContain('installed');
    expect(mockService.install).toHaveBeenCalled();
  });

  it('uploads a single .md file successfully', async () => {
    const mdContent = '# My Extension\n\nDescription here.';
    const form = createFormData('extension.md', mdContent);

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockService.install).toHaveBeenCalled();
  });

  it('uploads a SKILL.md file with correct filename', async () => {
    const skillContent = '---\nname: Test Skill\n---\n# Test';
    const form = createFormData('SKILL.md', skillContent);

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(201);
    // Verify the install was called with a path containing SKILL.md
    const installPath = mockService.install.mock.calls[0][0] as string;
    expect(installPath).toContain('SKILL.md');
  });

  it('rejects invalid file type', async () => {
    const form = createFormData('script.py', 'print("hi")');

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('Invalid file type');
  });

  it('rejects file exceeding size limit', async () => {
    // Create content larger than 1 MB
    const largeContent = 'x'.repeat(1.1 * 1024 * 1024);
    const form = createFormData('extension.json', largeContent);

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('File too large');
  });

  it('returns 400 when no file field is provided', async () => {
    const form = new FormData();
    form.append('other', 'value');

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('file field is required');
  });

  it('handles ExtensionError from service.install', async () => {
    // Import the mock ExtensionError class
    const { ExtensionError } = await import('../services/extension-service.js');
    mockService.install.mockRejectedValueOnce(
      new ExtensionError('Invalid manifest: missing tools', 'VALIDATION_ERROR')
    );

    const form = createFormData('extension.json', '{}');

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('Invalid manifest');
  });

  it('handles unexpected errors from service.install', async () => {
    mockService.install.mockRejectedValueOnce(new Error('Disk full'));

    const form = createFormData('extension.json', '{}');

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toContain('Disk full');
  });

  it('broadcasts data:changed event on successful upload', async () => {
    const { wsGateway } = await import('../ws/server.js');
    const form = createFormData('extension.json', '{}');

    await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(wsGateway.broadcast).toHaveBeenCalledWith('data:changed', {
      entity: 'extension',
      action: 'created',
      id: 'test-ext',
    });
  });

  it('rejects .exe files', async () => {
    const form = createFormData('malware.exe', 'MZ...');

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('Invalid file type');
  });

  it('rejects .txt files', async () => {
    const form = createFormData('readme.txt', 'Hello');

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('Invalid file type');
  });

  it('uses unique filename to prevent overwrites', async () => {
    const { writeFileSync } = await import('node:fs');
    const form = createFormData('extension.json', '{}');

    await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    // The writeFileSync should have been called with a path containing a random suffix
    expect(writeFileSync).toHaveBeenCalled();
    const writtenPath = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Path should contain a hash suffix in the directory name
    expect(writtenPath).toMatch(/extension-[a-f0-9]{8}/);
  });

  it('handles .zip upload without adm-zip gracefully', async () => {
    const form = createFormData('bundle.zip', 'PK\x03\x04fake-zip');

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    // Should get a 500 error about missing adm-zip (since we don't have it in test)
    const body = await res.json();
    expect(body.success).toBe(false);
    // Either it errors about adm-zip or about the zip content
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('allows 5 MB for .zip files', async () => {
    // A .zip file just under 5 MB should pass size validation
    // (but may fail at extraction — that's OK, we're testing size validation)
    const almostFiveMB = 'x'.repeat(4.9 * 1024 * 1024);
    const form = createFormData('bundle.zip', almostFiveMB);

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    const body = await res.json();
    // Should NOT be a size error
    if (!body.success) {
      expect(body.error.message).not.toContain('File too large');
    }
  });

  it('rejects .zip files exceeding 5 MB', async () => {
    const overFiveMB = 'x'.repeat(5.1 * 1024 * 1024);
    const form = createFormData('bundle.zip', overFiveMB);

    const res = await app.request('/extensions/upload', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('File too large');
  });
});
