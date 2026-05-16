/**
 * Skill Tools — Filesystem Helpers
 *
 * Locate a skill's directory on disk so introspection tools can read
 * SKILL.md, scripts/, references/, etc. Skills land in two shapes:
 *   - Locally uploaded — `sourcePath` points at SKILL.md or its directory.
 *   - npm-installed   — `settings.npmPackage` names a package in node_modules.
 *
 * `locateNpmPackageDirectory` tries three strategies (gateway-relative,
 * cwd-relative, walk-up) because the gateway can run from the monorepo
 * root, from `packages/gateway/`, or from a standalone install.
 */

import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export async function resolveSkillDirectory(pkg: {
  sourcePath?: string;
  settings: Record<string, unknown>;
}): Promise<string | null> {
  if (pkg.sourcePath) {
    // sourcePath may point to SKILL.md directly or to the directory
    const dir = pkg.sourcePath.replace(/[/\\]SKILL\.md$/i, '');
    if (existsSync(dir)) return dir;
  }

  const npmPackage = pkg.settings?.npmPackage as string | undefined;
  if (npmPackage) {
    return locateNpmPackageDirectory(npmPackage);
  }

  return null;
}

export async function locateNpmPackageDirectory(npmPackage: string): Promise<string | null> {
  // Strategy A: relative to gateway package (most reliable in monorepo)
  try {
    const currentFileDir = dirname(fileURLToPath(import.meta.url));
    const gatewayNodeModules = resolve(currentFileDir, '..', '..', '..', '..', 'node_modules');
    const directPath = join(gatewayNodeModules, npmPackage);
    if (existsSync(directPath)) return directPath;
  } catch {
    /* continue */
  }

  // Strategy B: cwd node_modules (dev server, standalone)
  try {
    const cwdPath = join(process.cwd(), 'node_modules', npmPackage);
    if (existsSync(cwdPath)) return cwdPath;
  } catch {
    /* continue */
  }

  // Strategy C: walk up from cwd looking for node_modules
  try {
    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
      const candidate = join(dir, 'node_modules', npmPackage);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* continue */
  }

  return null;
}
