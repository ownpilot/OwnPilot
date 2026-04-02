/**
 * Extensions Packaging Route
 *
 * GET /:id/package — Download extension as .skill ZIP file
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { Hono } from 'hono';
import { getServiceRegistry, Services } from '@ownpilot/core';
import type { ExtensionService } from '../../services/extension-service.js';
import { getUserId, apiError, ERROR_CODES, notFoundError, getErrorMessage } from '../helpers.js';
import { getLog } from '../../services/log.js';

const log = getLog('ExtensionPackaging');

export const packagingRoutes = new Hono();

const getExtService = () => getServiceRegistry().get(Services.Extension) as ExtensionService;

/**
 * GET /:id/package — Download .skill ZIP
 */
packagingRoutes.get('/:id/package', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getExtService();
  const pkg = service.getById(id);

  if (!pkg || pkg.userId !== userId) {
    return notFoundError(c, 'Extension', id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AdmZipClass: any = null;
  try {
    const admZipPkg = 'adm-zip';
    const mod = await import(admZipPkg);
    AdmZipClass = mod.default ?? mod;
  } catch {
    return apiError(
      c,
      { code: ERROR_CODES.EXECUTION_ERROR, message: 'adm-zip not available' },
      500
    );
  }

  try {
    const zip = new AdmZipClass();
    const skillName = pkg.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const zipFolder = `${skillName}/`;

    // Determine manifest file content
    const manifest = pkg.manifest as unknown as Record<string, unknown>;
    const format = (manifest.format as string | undefined) ?? 'ownpilot';

    // Add the main manifest file
    if (pkg.sourcePath && existsSync(pkg.sourcePath)) {
      const manifestFilename = basename(pkg.sourcePath);
      zip.addLocalFile(pkg.sourcePath, zipFolder, manifestFilename);

      // Add sibling files from the skill directory
      const skillDir = dirname(pkg.sourcePath);
      if (existsSync(skillDir)) {
        const entries = readdirSync(skillDir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = join(skillDir, entry.name);
          if (entry.name === manifestFilename) continue; // already added

          if (entry.isDirectory()) {
            // Add subdirectory contents (scripts/, references/, assets/)
            const subEntries = readdirSync(entryPath, { withFileTypes: true });
            for (const sub of subEntries) {
              if (sub.isFile()) {
                zip.addLocalFile(join(entryPath, sub.name), `${zipFolder}${entry.name}/`, sub.name);
              }
            }
          } else if (entry.isFile() && !entry.name.startsWith('.')) {
            zip.addLocalFile(entryPath, zipFolder, entry.name);
          }
        }
      }
    } else {
      // No source file — create from in-memory manifest
      const manifestFilename = format === 'agentskills' ? 'SKILL.md' : 'extension.json';
      let manifestContent: string;

      if (format === 'agentskills') {
        manifestContent = buildSkillMd(manifest);
      } else {
        const { _security: _s, ...cleanManifest } = manifest as Record<string, unknown> & {
          _security?: unknown;
        };
        manifestContent = JSON.stringify(cleanManifest, null, 2);
      }

      zip.addFile(`${zipFolder}${manifestFilename}`, Buffer.from(manifestContent, 'utf-8'));
    }

    // Always add skill.meta.json
    const meta = {
      format,
      name: pkg.name,
      version: pkg.version,
      description: pkg.description ?? (manifest.description as string | undefined) ?? '',
      author: pkg.authorName ?? (manifest.author as string | undefined) ?? '',
      createdAt: pkg.installedAt,
      ownpilot_version: '1.0',
    };
    zip.addFile(`${zipFolder}skill.meta.json`, Buffer.from(JSON.stringify(meta, null, 2), 'utf-8'));

    const zipBuffer: Buffer = zip.toBuffer();
    const filename = `${skillName}-v${pkg.version}.skill`;

    return new Response(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(zipBuffer.length),
      },
    });
  } catch (err) {
    log.error('packaging failed', err);
    return apiError(
      c,
      { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err, 'Packaging failed') },
      500
    );
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSkillMd(manifest: Record<string, unknown>): string {
  // Build YAML frontmatter
  const fm: string[] = ['---'];
  fm.push(`name: ${manifest.name ?? 'Skill'}`);
  if (manifest.description) {
    fm.push(`description: ${manifest.description}`);
  }
  fm.push(`version: ${manifest.version ?? '1.0.0'}`);
  if (manifest.category) {
    fm.push(`category: ${manifest.category}`);
  }
  if (Array.isArray(manifest.tags) && manifest.tags.length > 0) {
    fm.push(`tags: [${manifest.tags.join(', ')}]`);
  }
  if (manifest.license) {
    fm.push(`license: ${manifest.license}`);
  }

  // Nested metadata block
  const author =
    typeof manifest.author === 'string'
      ? manifest.author
      : (manifest.author as { name?: string } | undefined)?.name;
  if (author) {
    fm.push('metadata:');
    fm.push(`  author: ${author}`);
  }

  // Allowed tools
  if (Array.isArray(manifest.allowed_tools) && manifest.allowed_tools.length > 0) {
    fm.push(`allowed-tools: [${manifest.allowed_tools.join(', ')}]`);
  }

  fm.push('---');
  fm.push('');

  // Markdown body (instructions)
  if (manifest.instructions) {
    fm.push(String(manifest.instructions));
  } else {
    fm.push(`# ${manifest.name ?? 'Skill'}`);
    fm.push('');
    fm.push('*No instructions provided.*');
  }
  return fm.join('\n');
}
