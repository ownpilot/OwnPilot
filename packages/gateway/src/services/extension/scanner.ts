/**
 * Extension Directory Scanner
 *
 * Scans known directories for extension manifests (JSON, MD, SKILL.md)
 * and installs them. Handles path resolution for bundled defaults,
 * user data directory, and workspace skills.
 *
 * Extracted from extension-service.ts to separate filesystem operations
 * from extension lifecycle management.
 */

import { existsSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getDataDirectoryInfo } from '../../paths/index.js';
import { getLog } from '../log.js';

const log = getLog('ExtScanner');

// ============================================================================
// Path Resolution
// ============================================================================

export function getDefaultExtensionsDirectory(): string {
  const dataInfo = getDataDirectoryInfo();
  return join(dataInfo.root, 'extensions');
}

export function getDefaultSkillsDirectory(): string {
  const dataInfo = getDataDirectoryInfo();
  return join(dataInfo.root, 'skills');
}

export function getWorkspaceSkillsDirectory(): string | null {
  const workspaceDir = process.env.WORKSPACE_DIR ?? process.cwd();
  const candidate = join(workspaceDir, 'data', 'skills');
  return existsSync(candidate) ? candidate : null;
}

function getBundledDefaultExtensionsDirectory(): string | null {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const candidate = join(thisDir, '..', '..', 'data', 'default-extensions');
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function getBundledExampleSkillsDirectory(): string | null {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const candidate = join(thisDir, '..', '..', 'data', 'example-skills');
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Precedence Tiers
// ============================================================================

/**
 * Skill source tiers, in ascending precedence. When the same extension id is
 * found in multiple tiers, the higher tier wins (it is installed last, and the
 * scan uses last-wins upsert). Mirrors OpenClaw's precedence chain:
 *   bundled < managed < personal < workspace
 * (`project` reserved for a future repo-local tier).
 */
export type SkillTier = 'bundled' | 'managed' | 'personal' | 'project' | 'workspace';

/** Higher number = higher precedence (wins on duplicate id). */
export const SKILL_TIER_RANK: Record<SkillTier, number> = {
  bundled: 0,
  managed: 1,
  personal: 2,
  project: 3,
  workspace: 4,
};

export interface ScanDirectory {
  dir: string;
  tier: SkillTier;
}

/**
 * Order tier-tagged candidates from lowest to highest precedence and drop
 * unresolved (null) directories. Pure — exported for testing.
 */
export function orderScanCandidates(
  candidates: Array<{ dir: string | null; tier: SkillTier }>
): ScanDirectory[] {
  return candidates
    .filter((c): c is ScanDirectory => c.dir !== null)
    .sort((a, b) => SKILL_TIER_RANK[a.tier] - SKILL_TIER_RANK[b.tier]);
}

/**
 * Get all scan directories tagged with their precedence tier, ordered low →
 * high so that scanning in order makes the highest-precedence source win on
 * duplicate ids.
 */
export function getScanDirectories(): ScanDirectory[] {
  return orderScanCandidates([
    { dir: getBundledDefaultExtensionsDirectory(), tier: 'bundled' },
    { dir: getBundledExampleSkillsDirectory(), tier: 'bundled' },
    { dir: getDefaultExtensionsDirectory(), tier: 'managed' },
    { dir: getDefaultSkillsDirectory(), tier: 'personal' },
    { dir: getWorkspaceSkillsDirectory(), tier: 'workspace' },
  ]);
}

/**
 * Get all directories to scan, ordered from lowest to highest precedence.
 * Scanning in this order means a workspace skill overrides a personal one,
 * which overrides a managed one, which overrides a bundled one.
 */
export function getAllScanDirectories(): string[] {
  return getScanDirectories().map((d) => d.dir);
}

/**
 * Given a skill's manifest source path, return the on-disk skill directory that
 * a hard uninstall is allowed to delete — or `null` if nothing should be
 * removed from disk.
 *
 * A skill's files are deletable only when the manifest lives **directly inside a
 * writable (non-bundled) scan root** (managed / personal / workspace). This
 * deliberately refuses to delete:
 *   - bundled, read-only skills shipped with the app (the `bundled` tier),
 *   - DB-only skills with no source path (e.g. claw-learned skills),
 *   - npm/temp installs whose source path no longer resolves under a scan root,
 *   - any path that is not an immediate child of a known writable root.
 *
 * The "immediate child" guard ensures a hard delete can never escape the managed
 * skill trees or remove a scan root itself. Pure — exported for testing.
 */
export function resolveManagedSkillDir(sourcePath: string | undefined | null): string | null {
  if (!sourcePath) return null;

  const skillDir = dirname(resolve(sourcePath));
  const parent = dirname(skillDir);
  // At the filesystem root (parent === skillDir) there is nothing safe to delete.
  if (parent === skillDir) return null;

  const writableRoots = getScanDirectories()
    .filter((d) => d.tier !== 'bundled')
    .map((d) => resolve(d.dir));

  return writableRoots.includes(parent) ? skillDir : null;
}

// ============================================================================
// Directory Scanning
// ============================================================================

export interface ScanResult {
  installed: number;
  errors: Array<{ path: string; error: string }>;
}

/**
 * Scan a single directory for extension manifests and install each one.
 * @param installFn Callback to install a single manifest by path
 */
export async function scanSingleDirectory(
  scanDir: string,
  userId: string,
  installFn: (manifestPath: string, userId: string) => Promise<unknown>,
  shouldSkip?: (manifestPath: string, userId: string) => boolean | Promise<boolean>
): Promise<ScanResult> {
  const errors: Array<{ path: string; error: string }> = [];
  let installed = 0;

  if (!existsSync(scanDir)) {
    log.debug(`Directory does not exist: ${scanDir}`);
    return { installed: 0, errors: [] };
  }

  let entries: string[];
  try {
    entries = readdirSync(scanDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return { installed: 0, errors: [{ path: scanDir, error: 'Cannot read directory' }] };
  }

  for (const dirName of entries) {
    // Detection order:
    // 1. SKILL.md (AgentSkills.io open standard — uppercase)
    // 2. extension.json (OwnPilot native JSON)
    // 3. extension.md (OwnPilot native markdown)
    // 4. skill.json / skill.md (legacy backward compat)
    const agentSkillsMdPath = join(scanDir, dirName, 'SKILL.md');
    const jsonPath = join(scanDir, dirName, 'extension.json');
    const mdPath = join(scanDir, dirName, 'extension.md');
    const legacyJsonPath = join(scanDir, dirName, 'skill.json');
    const legacyMdPath = join(scanDir, dirName, 'skill.md');

    let manifestPath: string | null = null;
    if (existsSync(agentSkillsMdPath)) manifestPath = agentSkillsMdPath;
    else if (existsSync(jsonPath)) manifestPath = jsonPath;
    else if (existsSync(mdPath)) manifestPath = mdPath;
    else if (existsSync(legacyJsonPath)) manifestPath = legacyJsonPath;
    else if (existsSync(legacyMdPath)) manifestPath = legacyMdPath;

    if (!manifestPath) continue;

    try {
      if (shouldSkip && (await shouldSkip(manifestPath, userId))) {
        continue;
      }
      await installFn(manifestPath, userId);
      installed++;
    } catch (e) {
      errors.push({
        path: manifestPath,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (installed > 0) {
    log.info(`Scanned ${scanDir}: installed ${installed} extensions`, { errors: errors.length });
  }

  return { installed, errors };
}
