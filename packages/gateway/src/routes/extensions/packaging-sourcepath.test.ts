/**
 * Extensions Packaging — sourcePath branch Tests
 *
 * Separate file so we can mock adm-zip AND node:fs without
 * breaking the main packaging.test.ts which uses the real adm-zip.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockExistsSync, mockReaddirSync, mockAddLocalFile, mockAddFile, mockToBuffer, MockAdmZip } =
  vi.hoisted(() => {
    const mockAddLocalFile = vi.fn();
    const mockAddFile = vi.fn();
    const mockToBuffer = vi.fn(() => Buffer.from('FAKE-ZIP'));

    const MockAdmZip = vi.fn().mockImplementation(function () {
      return {
        addLocalFile: mockAddLocalFile,
        addFile: mockAddFile,
        toBuffer: mockToBuffer,
      };
    });

    return {
      mockExistsSync: vi.fn(),
      mockReaddirSync: vi.fn(),
      mockAddLocalFile,
      mockAddFile,
      mockToBuffer,
      MockAdmZip,
    };
  });

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
}));

vi.mock('adm-zip', () => ({ default: MockAdmZip }));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn(() => mockExtService),
    })),
  };
});

const mockExtService = { getById: vi.fn() };

const { packagingRoutes } = await import('./packaging.js');

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
  app.route('/ext', packagingRoutes);
  app.onError(errorHandler);
  return app;
}

const makeExt = (overrides: Record<string, unknown> = {}) => ({
  id: 'ext-1',
  userId: USER_ID,
  name: 'My Skill',
  description: 'A useful skill',
  version: '1.0.0',
  sourcePath: '/data/skills/my-skill/SKILL.md',
  authorName: 'Test Author',
  installedAt: '2025-01-01T00:00:00.000Z',
  manifest: { format: 'agentskills', name: 'My Skill' },
  ...overrides,
});

function makeEntry(name: string, opts: { isDir?: boolean; isFile?: boolean } = {}) {
  return {
    name,
    isDirectory: vi.fn(() => opts.isDir ?? false),
    isFile: vi.fn(() => opts.isFile ?? true),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('packaging — sourcePath branch', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    MockAdmZip.mockImplementation(function () {
      return { addLocalFile: mockAddLocalFile, addFile: mockAddFile, toBuffer: mockToBuffer };
    });
    mockToBuffer.mockReturnValue(Buffer.from('FAKE-ZIP'));
    mockExtService.getById.mockReturnValue(makeExt());
    app = createApp();
  });

  it('calls addLocalFile for sourcePath when it exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);

    const res = await app.request('/ext/ext-1/package');
    expect(res.status).toBe(200);
    expect(mockAddLocalFile).toHaveBeenCalledWith(
      '/data/skills/my-skill/SKILL.md',
      'my-skill/',
      'SKILL.md'
    );
  });

  it('adds sibling files (not the manifest) from skill directory', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      makeEntry('SKILL.md'), // same as manifest — skip
      makeEntry('README.md'), // regular file — include
      makeEntry('.gitignore'), // starts with dot — skip
    ]);

    await app.request('/ext/ext-1/package');

    // addLocalFile for SKILL.md (manifest) + README.md
    const calls = mockAddLocalFile.mock.calls;
    const addedNames = calls.map((c) => c[2]);
    expect(addedNames).toContain('SKILL.md'); // manifest
    expect(addedNames).toContain('README.md'); // sibling
    expect(addedNames).not.toContain('.gitignore'); // dot file — skipped
  });

  it('adds files from subdirectories', async () => {
    mockExistsSync.mockReturnValue(true);
    const scriptsEntry = makeEntry('scripts', { isDir: true, isFile: false });
    const fileInScripts = makeEntry('helper.ts', { isFile: true });

    // First readdirSync call: the skill dir
    // Second readdirSync call: the scripts/ subdir
    mockReaddirSync.mockReturnValueOnce([scriptsEntry]).mockReturnValueOnce([fileInScripts]);

    await app.request('/ext/ext-1/package');

    expect(mockAddLocalFile).toHaveBeenCalledWith(
      expect.stringContaining('helper.ts'),
      'my-skill/scripts/',
      'helper.ts'
    );
  });

  it('falls back to in-memory SKILL.md when sourcePath does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await app.request('/ext/ext-1/package');

    // addFile should be called (not addLocalFile) for in-memory content
    expect(mockAddFile).toHaveBeenCalledWith(
      expect.stringContaining('SKILL.md'),
      expect.any(Buffer)
    );
  });

  it('falls back to extension.json when sourcePath does not exist and format is ownpilot', async () => {
    mockExtService.getById.mockReturnValue(
      makeExt({ manifest: { format: 'ownpilot', name: 'My Tool', tools: [] } })
    );
    mockExistsSync.mockReturnValue(false);

    await app.request('/ext/ext-1/package');

    expect(mockAddFile).toHaveBeenCalledWith(
      expect.stringContaining('extension.json'),
      expect.any(Buffer)
    );
  });

  it('returns 500 when adm-zip import fails', async () => {
    // Re-import with broken adm-zip mock requires resetting modules
    // Instead, simulate error by making toBuffer throw
    mockExistsSync.mockReturnValue(false);
    MockAdmZip.mockImplementation(() => {
      throw new Error('adm-zip not found');
    });

    const res = await app.request('/ext/ext-1/package');
    expect(res.status).toBe(500);
  });

  it('still adds skill.meta.json even with sourcePath', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);

    await app.request('/ext/ext-1/package');

    expect(mockAddFile).toHaveBeenCalledWith(
      expect.stringContaining('skill.meta.json'),
      expect.any(Buffer)
    );
  });
});
