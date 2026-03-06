/**
 * Tests for NpmSkillInstaller
 *
 * Mocks node:https, node:fs, node:child_process, and node:util to avoid
 * real network calls and filesystem side-effects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// =============================================================================
// Hoisted mock variables — must be declared before any vi.mock() calls
// =============================================================================

const {
  mockHttpsGet,
  mockMkdtempSync,
  mockRmSync,
  mockExistsSync,
  mockReaddirSync,
  mockCreateWriteStream,
  mockExecAsync,
} = vi.hoisted(() => ({
  mockHttpsGet: vi.fn(),
  mockMkdtempSync: vi.fn(() => '/tmp/ownpilot-skill-test'),
  mockRmSync: vi.fn(),
  mockExistsSync: vi.fn(() => false),
  mockReaddirSync: vi.fn(() => []),
  mockCreateWriteStream: vi.fn(),
  mockExecAsync: vi.fn(),
}));

// =============================================================================
// Module mocks
// =============================================================================

vi.mock('node:https', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    get: (...args: unknown[]) => mockHttpsGet(...args),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    mkdtempSync: (...args: unknown[]) => mockMkdtempSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
    createWriteStream: (...args: unknown[]) => mockCreateWriteStream(...args),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    exec: vi.fn(),
  };
});

// Mock promisify to return mockExecAsync — used for module-level execAsync = promisify(exec)
vi.mock('node:util', () => ({
  promisify: vi.fn(() => mockExecAsync),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  };
});

// =============================================================================
// Import under test (AFTER all mocks are registered)
// =============================================================================

import { NpmSkillInstaller, getNpmInstaller } from './skill-npm-installer.js';

// =============================================================================
// Response factory helpers
// =============================================================================

/**
 * Create a minimal chainable mock request object.
 * The source code does: httpsGet(...).on('error', reject)
 * We need .on() to return the request itself AND register the handler.
 */
function createMockRequest() {
  // Use a simple plain-object approach to avoid EventEmitter inheritance issues.
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const req = {
    on(event: string, handler: (...args: unknown[]) => void) {
      listeners[event] = listeners[event] ?? [];
      listeners[event]!.push(handler);
      return req; // chainable
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of listeners[event] ?? []) {
        handler(...args);
      }
    },
  };
  return req;
}

/**
 * Set up mockHttpsGet to deliver a JSON response for fetchJson calls.
 *
 * Strategy:
 *  1. Call the https callback synchronously → inside callback, res.on('data'), res.on('end')
 *     listeners get registered.
 *  2. Then emit 'data' and 'end' asynchronously via queueMicrotask.
 *
 * Handles both 2-arg (url, callback) and 3-arg (url, options, callback) httpsGet signatures.
 */
function setupFetchJsonResponse(
  statusCode: number,
  data: unknown,
  headers: Record<string, string> = {}
) {
  mockHttpsGet.mockImplementationOnce(
    (_url: string, optsOrCallback: unknown, maybeCallback?: unknown) => {
      const callback =
        typeof optsOrCallback === 'function'
          ? (optsOrCallback as (res: unknown) => void)
          : (maybeCallback as (res: unknown) => void);

      const res = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
      };
      res.statusCode = statusCode;
      res.headers = headers;

      // Step 1: call callback synchronously so res.on() listeners are registered
      callback(res);

      // Step 2: emit data/end AFTER listeners are registered
      queueMicrotask(() => {
        res.emit('data', Buffer.from(JSON.stringify(data)));
        res.emit('end');
      });

      return createMockRequest();
    }
  );
}

/**
 * Set up mockHttpsGet to emit a network-level error on the request.
 * The error is fired on the request object via .on('error', reject).
 * We emit it synchronously after the call returns, so .on('error', reject) has been registered.
 */
function setupFetchJsonNetworkError(error: Error) {
  mockHttpsGet.mockImplementationOnce(
    (_url: string, _optsOrCallback: unknown, _maybeCallback?: unknown) => {
      const req = createMockRequest();
      // Emit after the caller registers .on('error', reject) via chaining
      queueMicrotask(() => req.emit('error', error));
      return req;
    }
  );
}

/**
 * Create a mock binary download response for downloadFile.
 * When the source does res.pipe(file), we immediately emit 'finish' on the writable.
 */
function createBinaryResponse(statusCode: number, headers: Record<string, string> = {}) {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    headers: Record<string, string>;
    pipe: ReturnType<typeof vi.fn>;
  };
  res.statusCode = statusCode;
  res.headers = headers;
  res.pipe = vi.fn((writable: EventEmitter) => {
    queueMicrotask(() => writable.emit('finish'));
    return writable;
  });
  return res;
}

/**
 * Set up mockHttpsGet to deliver a binary download response.
 * The callback is called synchronously so file.on('finish', ...) and file.on('error', ...)
 * are registered before pipe() fires its deferred event.
 */
function setupDownloadResponse(statusCode: number, headers: Record<string, string> = {}) {
  mockHttpsGet.mockImplementationOnce(
    (_url: string, optsOrCallback: unknown, maybeCallback?: unknown) => {
      const callback =
        typeof optsOrCallback === 'function'
          ? (optsOrCallback as (res: unknown) => void)
          : (maybeCallback as (res: unknown) => void);

      const res = createBinaryResponse(statusCode, headers);
      // Call synchronously so createWriteStream + file event listeners are set up first
      callback(res);

      return createMockRequest();
    }
  );
}

/**
 * Create a mock fs.WriteStream (EventEmitter with a close() stub).
 */
function createMockWriteStream() {
  const ws = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> };
  ws.close = vi.fn();
  return ws;
}

// =============================================================================
// Test suite
// =============================================================================

describe('NpmSkillInstaller', () => {
  let installer: NpmSkillInstaller;

  beforeEach(() => {
    vi.resetAllMocks(); // resets implementations + queues, not just call history
    installer = new NpmSkillInstaller();

    // Re-establish default return values after resetAllMocks
    mockMkdtempSync.mockReturnValue('/tmp/ownpilot-skill-test');
    mockRmSync.mockReturnValue(undefined);
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    // Default: mockHttpsGet returns a mock request (so .on('error',...) doesn't throw)
    mockHttpsGet.mockReturnValue(createMockRequest());
  });

  // ===========================================================================
  // search()
  // ===========================================================================

  describe('search()', () => {
    it('returns packages from npm registry with default limit', async () => {
      const npmResponse = {
        objects: [
          {
            package: {
              name: 'my-skill',
              version: '1.2.3',
              description: 'A useful skill',
              author: 'Jane Doe',
              keywords: ['ownpilot-skill', 'productivity'],
              date: '2024-01-01T00:00:00.000Z',
              links: { npm: 'https://npmjs.com/package/my-skill' },
            },
          },
        ],
        total: 1,
      };
      setupFetchJsonResponse(200, npmResponse);

      const result = await installer.search('productivity');

      expect(result.total).toBe(1);
      expect(result.packages).toHaveLength(1);
      const pkg = result.packages[0]!;
      expect(pkg.name).toBe('my-skill');
      expect(pkg.version).toBe('1.2.3');
      expect(pkg.description).toBe('A useful skill');
      expect(pkg.author).toBe('Jane Doe');
      expect(pkg.keywords).toEqual(['ownpilot-skill', 'productivity']);
      expect(pkg.date).toBe('2024-01-01T00:00:00.000Z');
      expect(pkg.links).toEqual({ npm: 'https://npmjs.com/package/my-skill' });
    });

    it('includes ownpilot-skill keyword in the search URL', async () => {
      setupFetchJsonResponse(200, { objects: [], total: 0 });

      await installer.search('my query');

      const calledUrl = mockHttpsGet.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('ownpilot-skill');
      expect(calledUrl).toContain(encodeURIComponent('my query'));
    });

    it('uses provided limit in the search URL', async () => {
      setupFetchJsonResponse(200, { objects: [], total: 0 });

      await installer.search('test', 50);

      const calledUrl = mockHttpsGet.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('size=50');
    });

    it('handles empty results', async () => {
      setupFetchJsonResponse(200, { objects: [], total: 0 });

      const result = await installer.search('nothinghere');

      expect(result.total).toBe(0);
      expect(result.packages).toHaveLength(0);
    });

    it('maps author as object form (extracts .name field)', async () => {
      setupFetchJsonResponse(200, {
        objects: [
          {
            package: {
              name: 'obj-author-skill',
              version: '0.1.0',
              description: '',
              author: { name: 'Bob Smith', email: 'bob@example.com' },
              keywords: [],
              date: '',
            },
          },
        ],
        total: 1,
      });

      const result = await installer.search('obj-author');

      expect(result.packages[0]!.author).toBe('Bob Smith');
    });

    it('maps author as string form', async () => {
      setupFetchJsonResponse(200, {
        objects: [
          {
            package: {
              name: 'str-author-skill',
              version: '0.1.0',
              description: '',
              author: 'Alice',
              keywords: [],
              date: '',
            },
          },
        ],
        total: 1,
      });

      const result = await installer.search('str-author');

      expect(result.packages[0]!.author).toBe('Alice');
    });

    it('sets author to undefined when not present', async () => {
      setupFetchJsonResponse(200, {
        objects: [
          {
            package: {
              name: 'no-author-skill',
              version: '0.1.0',
              description: '',
              keywords: [],
              date: '',
            },
          },
        ],
        total: 1,
      });

      const result = await installer.search('no-author');

      expect(result.packages[0]!.author).toBeUndefined();
    });

    it('falls back to packages.length for total when total field missing', async () => {
      setupFetchJsonResponse(200, {
        objects: [
          { package: { name: 'a', version: '1.0.0', description: '', keywords: [], date: '' } },
          { package: { name: 'b', version: '1.0.0', description: '', keywords: [], date: '' } },
        ],
        // no 'total' field
      });

      const result = await installer.search('ab');

      expect(result.total).toBe(2);
    });

    it('rejects on network error', async () => {
      setupFetchJsonNetworkError(new Error('ECONNREFUSED'));

      await expect(installer.search('fail')).rejects.toThrow('ECONNREFUSED');
    });
  });

  // ===========================================================================
  // getPackageInfo()
  // ===========================================================================

  describe('getPackageInfo()', () => {
    function makeRegistryResponse(overrides: Record<string, unknown> = {}) {
      return {
        name: 'test-skill',
        description: 'A test skill package',
        'dist-tags': { latest: '2.0.0' },
        versions: {
          '2.0.0': {
            version: '2.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/test-skill/-/test-skill-2.0.0.tgz',
              shasum: 'abc123',
            },
          },
        },
        author: 'Test Author',
        license: 'MIT',
        homepage: 'https://example.com',
        repository: { url: 'https://github.com/example/test-skill' },
        keywords: ['ownpilot-skill'],
        ...overrides,
      };
    }

    it('returns package info with dist tags', async () => {
      setupFetchJsonResponse(200, makeRegistryResponse());

      const info = await installer.getPackageInfo('test-skill');

      expect(info.name).toBe('test-skill');
      expect(info.version).toBe('2.0.0');
      expect(info.description).toBe('A test skill package');
      expect(info.author).toBe('Test Author');
      expect(info.license).toBe('MIT');
      expect(info.homepage).toBe('https://example.com');
      expect(info.repository).toBe('https://github.com/example/test-skill');
      expect(info.keywords).toEqual(['ownpilot-skill']);
      expect(info.dist?.tarball).toBe(
        'https://registry.npmjs.org/test-skill/-/test-skill-2.0.0.tgz'
      );
    });

    it('handles author as object form', async () => {
      setupFetchJsonResponse(
        200,
        makeRegistryResponse({ author: { name: 'Object Author', email: 'oa@example.com' } })
      );

      const info = await installer.getPackageInfo('test-skill');

      expect(info.author).toBe('Object Author');
    });

    it('handles author as string form', async () => {
      setupFetchJsonResponse(200, makeRegistryResponse({ author: 'String Author' }));

      const info = await installer.getPackageInfo('test-skill');

      expect(info.author).toBe('String Author');
    });

    it('returns undefined author when not present', async () => {
      const resp = makeRegistryResponse();
      delete (resp as Record<string, unknown>).author;
      setupFetchJsonResponse(200, resp);

      const info = await installer.getPackageInfo('test-skill');

      expect(info.author).toBeUndefined();
    });

    it('handles missing dist-tags (falls back to empty version)', async () => {
      setupFetchJsonResponse(200, {
        name: 'no-dist-tags',
        description: 'No dist-tags',
        versions: {},
        // no dist-tags field
      });

      const info = await installer.getPackageInfo('no-dist-tags');

      expect(info.name).toBe('no-dist-tags');
      expect(info.version).toBe('');
    });

    it('handles repository as string form', async () => {
      setupFetchJsonResponse(
        200,
        makeRegistryResponse({ repository: 'https://github.com/example/repo' })
      );

      const info = await installer.getPackageInfo('test-skill');

      expect(info.repository).toBe('https://github.com/example/repo');
    });

    it('rejects on HTTP non-200 response', async () => {
      setupFetchJsonResponse(404, { error: 'Not found' });

      await expect(installer.getPackageInfo('nonexistent-pkg')).rejects.toThrow('HTTP 404');
    });

    it('rejects on network error', async () => {
      setupFetchJsonNetworkError(new Error('ETIMEDOUT'));

      await expect(installer.getPackageInfo('some-pkg')).rejects.toThrow('ETIMEDOUT');
    });

    it('follows HTTP 301 redirect in fetchJson (lines 266-269)', async () => {
      // First fetchJson call: 301 redirect
      setupFetchJsonResponse(
        301,
        {},
        {
          location: 'https://redirected-registry.example.com/test-skill',
        }
      );
      // Second fetchJson call (redirect target): 200 with actual data
      setupFetchJsonResponse(200, makeRegistryResponse());

      const info = await installer.getPackageInfo('test-skill');

      expect(info.name).toBe('test-skill');
    });

    it('follows HTTP 302 redirect in fetchJson', async () => {
      setupFetchJsonResponse(
        302,
        {},
        {
          location: 'https://redirected-registry.example.com/test-skill',
        }
      );
      setupFetchJsonResponse(200, makeRegistryResponse());

      const info = await installer.getPackageInfo('test-skill');

      expect(info.name).toBe('test-skill');
    });

    it('rejects with "Invalid JSON" when response body is not valid JSON (line 284)', async () => {
      // Custom mock: 200 response but emit non-JSON body
      mockHttpsGet.mockImplementationOnce(
        (_url: string, optsOrCallback: unknown, maybeCallback?: unknown) => {
          const callback =
            typeof optsOrCallback === 'function'
              ? (optsOrCallback as (res: unknown) => void)
              : (maybeCallback as (res: unknown) => void);

          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string>;
          };
          res.statusCode = 200;
          res.headers = {};
          callback(res);

          queueMicrotask(() => {
            res.emit('data', Buffer.from('not valid json {{{{'));
            res.emit('end');
          });

          return createMockRequest();
        }
      );

      await expect(installer.getPackageInfo('bad-json-pkg')).rejects.toThrow('Invalid JSON from');
    });
  });

  // ===========================================================================
  // install()
  // ===========================================================================

  describe('install()', () => {
    function makeExtensionService(overrides: { install?: ReturnType<typeof vi.fn> } = {}) {
      return {
        install: vi.fn(async (_path: string, _userId: string) => ({ id: 'ext-abc123' })),
        ...overrides,
      };
    }

    function makeTarballRegistryResponse(
      tarball: string | undefined = 'https://registry.npmjs.org/my-skill/-/my-skill-1.0.0.tgz'
    ) {
      return {
        name: 'my-skill',
        description: 'My skill',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            version: '1.0.0',
            dist: tarball ? { tarball, shasum: 'deadbeef' } : undefined,
          },
        },
      };
    }

    /**
     * Full happy-path setup:
     *  1. fetchJson → registry response (for getPackageInfo)
     *  2. downloadFile → binary 200 response
     *  3. execAsync (tar) → resolves
     *  4. existsSync calls in order:
     *     a. existsSync(packageDir) in ternary   → true  (use packageDir)
     *     b. existsSync(packageDir) in findManifest → true  (dir exists, don't return null)
     *     c. existsSync(SKILL.md path)            → true  (manifest found)
     */
    function setupHappyPath() {
      setupFetchJsonResponse(200, makeTarballRegistryResponse());

      const ws = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(ws);
      setupDownloadResponse(200);

      mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      // Three existsSync calls: ternary-packageDir, findManifest-dir, SKILL.md
      mockExistsSync
        .mockReturnValueOnce(true) // existsSync(packageDir) in ternary
        .mockReturnValueOnce(true) // existsSync(packageDir) at start of findManifest
        .mockReturnValueOnce(true); // existsSync(SKILL.md)
    }

    it('returns success with extension id when SKILL.md found in package/', async () => {
      setupHappyPath();
      const extSvc = makeExtensionService();

      const result = await installer.install('my-skill', 'user-1', extSvc);

      expect(result.success).toBe(true);
      expect(result.extensionId).toBe('ext-abc123');
      expect(result.packageName).toBe('my-skill');
      expect(result.packageVersion).toBe('1.0.0');
    });

    it('cleans up temp dir after successful install', async () => {
      setupHappyPath();
      const extSvc = makeExtensionService();

      await installer.install('my-skill', 'user-1', extSvc);

      expect(mockRmSync).toHaveBeenCalledWith('/tmp/ownpilot-skill-test', {
        recursive: true,
        force: true,
      });
    });

    it('returns error when getPackageInfo throws (network error)', async () => {
      // getPackageInfo calls fetchJson which emits error on request
      // For install(), errors propagate to the outer catch which wraps them
      setupFetchJsonNetworkError(new Error('connection refused'));

      const extSvc = makeExtensionService();
      const result = await installer.install('bad-pkg', 'user-1', extSvc);

      expect(result.success).toBe(false);
      expect(result.error).toContain('npm install failed');
      expect(result.error).toContain('connection refused');
    });

    it('returns error when no tarball URL found', async () => {
      // Response without any dist info at all
      setupFetchJsonResponse(200, {
        name: 'no-tarball',
        description: 'No tarball',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': { version: '1.0.0' }, // no dist field
        },
      });

      const extSvc = makeExtensionService();
      const result = await installer.install('no-tarball', 'user-1', extSvc);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No tarball URL found');
    });

    it('cleans up temp dir even when getPackageInfo fails', async () => {
      setupFetchJsonNetworkError(new Error('timeout'));
      const extSvc = makeExtensionService();

      await installer.install('fail-pkg', 'user-1', extSvc);

      expect(mockRmSync).toHaveBeenCalledWith('/tmp/ownpilot-skill-test', {
        recursive: true,
        force: true,
      });
    });

    it('returns error when downloadFile fails (HTTP 403)', async () => {
      setupFetchJsonResponse(200, makeTarballRegistryResponse());

      // downloadFile call → 403 error response (no pipe, rejects immediately)
      mockHttpsGet.mockImplementationOnce(
        (_url: string, optsOrCallback: unknown, maybeCallback?: unknown) => {
          const callback =
            typeof optsOrCallback === 'function'
              ? (optsOrCallback as (res: unknown) => void)
              : (maybeCallback as (res: unknown) => void);
          const res = createBinaryResponse(403);
          callback(res);
          return createMockRequest();
        }
      );

      const extSvc = makeExtensionService();
      const result = await installer.install('private-pkg', 'user-1', extSvc);

      expect(result.success).toBe(false);
      expect(result.error).toContain('npm install failed');
      expect(result.error).toContain('403');
    });

    it('cleans up temp dir after download failure', async () => {
      setupFetchJsonResponse(200, makeTarballRegistryResponse());

      mockHttpsGet.mockImplementationOnce(
        (_url: string, optsOrCallback: unknown, maybeCallback?: unknown) => {
          const callback =
            typeof optsOrCallback === 'function'
              ? (optsOrCallback as (res: unknown) => void)
              : (maybeCallback as (res: unknown) => void);
          const res = createBinaryResponse(404);
          callback(res);
          return createMockRequest();
        }
      );

      const extSvc = makeExtensionService();
      await installer.install('not-found-pkg', 'user-1', extSvc);

      expect(mockRmSync).toHaveBeenCalledWith('/tmp/ownpilot-skill-test', {
        recursive: true,
        force: true,
      });
    });

    it('returns error when tar extraction fails', async () => {
      setupFetchJsonResponse(200, makeTarballRegistryResponse());

      const ws = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(ws);
      setupDownloadResponse(200);

      mockExecAsync.mockRejectedValueOnce(new Error('tar: command not found'));

      const extSvc = makeExtensionService();
      const result = await installer.install('bad-tar', 'user-1', extSvc);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to extract tarball');
    });

    it('cleans up temp dir after extraction failure', async () => {
      setupFetchJsonResponse(200, makeTarballRegistryResponse());

      const ws = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(ws);
      setupDownloadResponse(200);

      mockExecAsync.mockRejectedValueOnce(new Error('tar: not found'));

      const extSvc = makeExtensionService();
      await installer.install('tar-fail-pkg', 'user-1', extSvc);

      expect(mockRmSync).toHaveBeenCalledWith('/tmp/ownpilot-skill-test', {
        recursive: true,
        force: true,
      });
    });

    it('returns error when no manifest file found after extraction', async () => {
      setupFetchJsonResponse(200, makeTarballRegistryResponse());

      const ws = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(ws);
      setupDownloadResponse(200);

      mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      // existsSync calls:
      //  #1: existsSync(packageDir) in ternary → true (use packageDir)
      //  #2: existsSync(packageDir) at start of findManifest → true (dir exists)
      //  #3: existsSync(SKILL.md)      → false
      //  #4: existsSync(extension.json) → false
      //  #5: existsSync(extension.md)   → false
      mockExistsSync
        .mockReturnValueOnce(true) // ternary: packageDir
        .mockReturnValueOnce(true) // findManifest: dir exists check
        .mockReturnValueOnce(false) // SKILL.md
        .mockReturnValueOnce(false) // extension.json
        .mockReturnValueOnce(false); // extension.md

      mockReaddirSync.mockReturnValue([]);

      const extSvc = makeExtensionService();
      const result = await installer.install('no-manifest', 'user-1', extSvc);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No SKILL.md');
    });

    it('installs from extension.json manifest when SKILL.md absent', async () => {
      setupFetchJsonResponse(200, makeTarballRegistryResponse());

      const ws = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(ws);
      setupDownloadResponse(200);

      mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      // existsSync calls:
      //  #1: existsSync(packageDir) in ternary → true
      //  #2: existsSync(packageDir) at start of findManifest → true
      //  #3: existsSync(SKILL.md)       → false
      //  #4: existsSync(extension.json) → true  ← found!
      mockExistsSync
        .mockReturnValueOnce(true) // ternary: packageDir
        .mockReturnValueOnce(true) // findManifest: dir exists check
        .mockReturnValueOnce(false) // SKILL.md absent
        .mockReturnValueOnce(true); // extension.json present

      const extSvc = makeExtensionService();
      const result = await installer.install('ext-json-pkg', 'user-1', extSvc);

      expect(result.success).toBe(true);
      expect(result.extensionId).toBe('ext-abc123');
    });

    it('calls extensionService.install with the manifest path and userId', async () => {
      setupHappyPath();
      const extSvc = makeExtensionService();

      await installer.install('my-skill', 'user-99', extSvc);

      expect(extSvc.install).toHaveBeenCalledOnce();
      const [manifestPath, userId] = extSvc.install.mock.calls[0]!;
      expect(manifestPath).toContain('SKILL.md');
      expect(userId).toBe('user-99');
    });

    it('findManifest returns null when fallback dir does not exist (line 236)', async () => {
      // Both packageDir and extractDir absent → use tempDir; tempDir itself also absent
      setupFetchJsonResponse(200, makeTarballRegistryResponse());

      const ws = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(ws);
      setupDownloadResponse(200);

      mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      mockExistsSync
        .mockReturnValueOnce(false) // ternary: packageDir absent
        .mockReturnValueOnce(false) // ternary: extractDir absent
        .mockReturnValueOnce(false); // findManifest(tempDir): dir doesn't exist → null

      const extSvc = makeExtensionService();
      const result = await installer.install('no-dir-pkg', 'user-1', extSvc);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No SKILL.md');
    });

    it('findManifest finds manifest in subdirectory via readdirSync (lines 248-251)', async () => {
      setupFetchJsonResponse(200, makeTarballRegistryResponse());

      const ws = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(ws);
      setupDownloadResponse(200);

      mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      mockExistsSync
        .mockReturnValueOnce(true) // ternary: packageDir exists → use packageDir
        .mockReturnValueOnce(true) // findManifest: dir exists
        .mockReturnValueOnce(false) // SKILL.md not at top level
        .mockReturnValueOnce(false) // extension.json not at top level
        .mockReturnValueOnce(false) // extension.md not at top level
        .mockReturnValueOnce(true); // SKILL.md found inside subdir entry

      // readdirSync returns one directory entry
      mockReaddirSync.mockReturnValue([{ name: 'subpkg', isDirectory: () => true }]);

      const extSvc = makeExtensionService();
      const result = await installer.install('subdir-pkg', 'user-1', extSvc);

      expect(result.success).toBe(true);
      expect(result.extensionId).toBe('ext-abc123');
    });

    it('follows HTTP 301 redirect in downloadFile (lines 296-299)', async () => {
      setupFetchJsonResponse(200, makeTarballRegistryResponse());

      const ws = createMockWriteStream();
      mockCreateWriteStream.mockReturnValue(ws);

      // First downloadFile: 301 redirect to CDN
      setupDownloadResponse(301, { location: 'https://cdn.example.com/my-skill-1.0.0.tgz' });
      // Second downloadFile (redirect target): 200 success
      setupDownloadResponse(200);

      mockExecAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      mockExistsSync
        .mockReturnValueOnce(true) // ternary: packageDir
        .mockReturnValueOnce(true) // findManifest: dir exists
        .mockReturnValueOnce(true); // SKILL.md found

      const extSvc = makeExtensionService();
      const result = await installer.install('redirect-pkg', 'user-1', extSvc);

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // checkForUpdate()
  // ===========================================================================

  describe('checkForUpdate()', () => {
    it('returns hasUpdate=true when registry version differs from installed', async () => {
      setupFetchJsonResponse(200, {
        name: 'my-skill',
        description: '',
        'dist-tags': { latest: '2.0.0' },
        versions: {
          '2.0.0': { version: '2.0.0', dist: { tarball: 'https://x', shasum: '' } },
        },
      });

      const result = await installer.checkForUpdate('my-skill', '1.0.0');

      expect(result.hasUpdate).toBe(true);
      expect(result.latestVersion).toBe('2.0.0');
    });

    it('returns hasUpdate=false when installed version matches latest', async () => {
      setupFetchJsonResponse(200, {
        name: 'my-skill',
        description: '',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': { version: '1.0.0', dist: { tarball: 'https://x', shasum: '' } },
        },
      });

      const result = await installer.checkForUpdate('my-skill', '1.0.0');

      expect(result.hasUpdate).toBe(false);
      expect(result.latestVersion).toBe('1.0.0');
    });

    it('returns hasUpdate=false and latestVersion=installedVersion when getPackageInfo throws', async () => {
      setupFetchJsonNetworkError(new Error('Service unavailable'));

      const result = await installer.checkForUpdate('unreachable-skill', '3.1.4');

      expect(result.hasUpdate).toBe(false);
      expect(result.latestVersion).toBe('3.1.4');
    });

    it('returns hasUpdate=false when HTTP 404 for package', async () => {
      setupFetchJsonResponse(404, { error: 'Not found' });

      const result = await installer.checkForUpdate('deleted-skill', '0.9.0');

      expect(result.hasUpdate).toBe(false);
      expect(result.latestVersion).toBe('0.9.0');
    });
  });

  // ===========================================================================
  // getNpmInstaller() singleton
  // ===========================================================================

  describe('getNpmInstaller()', () => {
    it('returns a NpmSkillInstaller instance', () => {
      const inst = getNpmInstaller();
      expect(inst).toBeInstanceOf(NpmSkillInstaller);
    });

    it('returns the same instance on repeated calls', () => {
      const a = getNpmInstaller();
      const b = getNpmInstaller();
      expect(a).toBe(b);
    });
  });
});
