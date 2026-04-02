/**
 * Extensions Packaging Route Tests
 *
 * Integration tests for GET /:id/package — download .skill ZIP.
 * Uses the real adm-zip (in-memory only) — no filesystem mocking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import AdmZip from 'adm-zip';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getServiceRegistry: vi.fn(() => ({
      get: vi.fn(() => mockExtService),
    })),
  };
});

const mockExtService = {
  getById: vi.fn(),
};

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
  sourcePath: null, // always null — no filesystem access
  authorName: 'Test Author',
  installedAt: '2025-01-01T00:00:00.000Z',
  manifest: { format: 'agentskills', name: 'My Skill', instructions: '# Instructions\nDo things.' },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the zip returned by the packaging route and list entry paths */
async function extractZipEntries(res: Response): Promise<string[]> {
  const buffer = await res.arrayBuffer();
  const zip = new AdmZip(Buffer.from(buffer));
  return zip.getEntries().map((e) => e.entryName);
}

/** Read a specific entry's text from the zip response */
async function readZipEntry(res: Response, entryName: string): Promise<string | null> {
  const buffer = await res.arrayBuffer();
  const zip = new AdmZip(Buffer.from(buffer));
  const entry = zip.getEntry(entryName);
  if (!entry) return null;
  return zip.readAsText(entry);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Extensions Packaging Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtService.getById.mockReturnValue(makeExt());
    app = createApp();
  });

  // ========================================================================
  // GET /:id/package
  // ========================================================================

  describe('GET /:id/package', () => {
    it('returns a ZIP response with correct Content-Type', async () => {
      const res = await app.request('/ext/ext-1/package');

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/zip');
    });

    it('sets Content-Disposition with skill filename', async () => {
      const res = await app.request('/ext/ext-1/package');

      const disposition = res.headers.get('Content-Disposition');
      expect(disposition).toContain('attachment');
      expect(disposition).toContain('.skill');
      expect(disposition).toContain('my-skill');
    });

    it('includes version in filename', async () => {
      mockExtService.getById.mockReturnValue(makeExt({ version: '2.3.1' }));

      const res = await app.request('/ext/ext-1/package');

      const disposition = res.headers.get('Content-Disposition');
      expect(disposition).toContain('v2.3.1');
    });

    it('returns Content-Length header', async () => {
      const res = await app.request('/ext/ext-1/package');

      const len = res.headers.get('Content-Length');
      expect(len).toBeTruthy();
      expect(Number(len)).toBeGreaterThan(0);
    });

    it('ZIP contains skill.meta.json', async () => {
      const res = await app.request('/ext/ext-1/package');

      const entries = await extractZipEntries(res);
      expect(entries.some((e) => e.endsWith('skill.meta.json'))).toBe(true);
    });

    it('skill.meta.json has correct content', async () => {
      const res1 = await app.request('/ext/ext-1/package');
      const entries = await extractZipEntries(res1);
      const metaEntry = entries.find((e) => e.endsWith('skill.meta.json'))!;

      const res2 = await app.request('/ext/ext-1/package');
      const content = await readZipEntry(res2, metaEntry);
      const meta = JSON.parse(content!);

      expect(meta.format).toBe('agentskills');
      expect(meta.name).toBe('My Skill');
      expect(meta.version).toBe('1.0.0');
      expect(meta.author).toBe('Test Author');
    });

    it('ZIP contains SKILL.md for agentskills format', async () => {
      const res = await app.request('/ext/ext-1/package');

      const entries = await extractZipEntries(res);
      expect(entries.some((e) => e.endsWith('SKILL.md'))).toBe(true);
    });

    it('SKILL.md content has YAML frontmatter with name and includes instructions', async () => {
      const res1 = await app.request('/ext/ext-1/package');
      const entries = await extractZipEntries(res1);
      const skillMdEntry = entries.find((e) => e.endsWith('SKILL.md'))!;

      const res2 = await app.request('/ext/ext-1/package');
      const content = await readZipEntry(res2, skillMdEntry);

      expect(content).toMatch(/^---\n/);
      expect(content).toContain('name: My Skill');
      expect(content).toContain('# Instructions');
    });

    it('ZIP contains extension.json for ownpilot format', async () => {
      mockExtService.getById.mockReturnValue(
        makeExt({ manifest: { format: 'ownpilot', name: 'My Tool', tools: [] } })
      );

      const res = await app.request('/ext/ext-1/package');

      const entries = await extractZipEntries(res);
      expect(entries.some((e) => e.endsWith('extension.json'))).toBe(true);
    });

    it('extension.json does not include _security field', async () => {
      mockExtService.getById.mockReturnValue(
        makeExt({ manifest: { format: 'ownpilot', name: 'Tool', _security: { secret: 'abc' } } })
      );

      const res1 = await app.request('/ext/ext-1/package');
      const entries = await extractZipEntries(res1);
      const extJsonEntry = entries.find((e) => e.endsWith('extension.json'))!;

      const res2 = await app.request('/ext/ext-1/package');
      const content = await readZipEntry(res2, extJsonEntry);
      const parsed = JSON.parse(content!);

      expect(parsed._security).toBeUndefined();
    });

    it('sanitizes special characters in skill name for filename', async () => {
      mockExtService.getById.mockReturnValue(makeExt({ name: 'My Skill! v2 (Beta)' }));

      const res = await app.request('/ext/ext-1/package');

      const disposition = res.headers.get('Content-Disposition');
      expect(disposition).not.toContain('!');
      expect(disposition).not.toContain('(');
    });

    it('ZIP entries are under a folder named after the skill', async () => {
      const res = await app.request('/ext/ext-1/package');

      const entries = await extractZipEntries(res);
      expect(entries.every((e) => e.startsWith('my-skill/'))).toBe(true);
    });

    it('returns 404 when extension not found', async () => {
      mockExtService.getById.mockReturnValue(undefined);

      const res = await app.request('/ext/nonexistent/package');

      expect(res.status).toBe(404);
    });

    it('returns 404 when extension belongs to different user', async () => {
      mockExtService.getById.mockReturnValue(makeExt({ userId: 'other-user' }));

      const res = await app.request('/ext/ext-1/package');

      expect(res.status).toBe(404);
    });

    it('SKILL.md includes description in frontmatter when manifest has description', async () => {
      mockExtService.getById.mockReturnValue(
        makeExt({
          manifest: {
            format: 'agentskills',
            name: 'My Skill',
            description: 'A helpful skill',
            instructions: 'Do things.',
          },
        })
      );

      const res1 = await app.request('/ext/ext-1/package');
      const entries = await extractZipEntries(res1);
      const skillMdEntry = entries.find((e) => e.endsWith('SKILL.md'))!;
      const res2 = await app.request('/ext/ext-1/package');
      const content = await readZipEntry(res2, skillMdEntry);
      expect(content).toContain('description: A helpful skill');
    });

    it('SKILL.md includes version and author in frontmatter when manifest has them', async () => {
      mockExtService.getById.mockReturnValue(
        makeExt({
          manifest: {
            format: 'agentskills',
            name: 'My Skill',
            version: '2.5.0',
            author: 'Jane Doe',
            instructions: 'Do things.',
          },
        })
      );

      const res1 = await app.request('/ext/ext-1/package');
      const entries = await extractZipEntries(res1);
      const skillMdEntry = entries.find((e) => e.endsWith('SKILL.md'))!;
      const res2 = await app.request('/ext/ext-1/package');
      const content = await readZipEntry(res2, skillMdEntry);
      expect(content).toContain('version: 2.5.0');
      expect(content).toContain('author: Jane Doe');
    });

    it('SKILL.md shows fallback text when manifest has no instructions', async () => {
      mockExtService.getById.mockReturnValue(
        makeExt({
          manifest: {
            format: 'agentskills',
            name: 'My Skill',
          },
        })
      );

      const res1 = await app.request('/ext/ext-1/package');
      const entries = await extractZipEntries(res1);
      const skillMdEntry = entries.find((e) => e.endsWith('SKILL.md'))!;
      const res2 = await app.request('/ext/ext-1/package');
      const content = await readZipEntry(res2, skillMdEntry);
      expect(content).toContain('*No instructions provided.*');
    });
  });
});
