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
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDataDirectoryInfo } from '../paths/index.js';
import { getLog } from './log.js';

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

export function getBundledDefaultExtensionsDirectory(): string | null {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const candidate = join(thisDir, '..', '..', 'data', 'default-extensions');
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function getBundledExampleSkillsDirectory(): string | null {
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const candidate = join(thisDir, '..', '..', 'data', 'example-skills');
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/** Get all directories to scan (bundled + data + workspace). */
export function getAllScanDirectories(): string[] {
  return [
    getBundledDefaultExtensionsDirectory(),
    getDefaultExtensionsDirectory(),
    getDefaultSkillsDirectory(),
    getWorkspaceSkillsDirectory(),
    getBundledExampleSkillsDirectory(),
  ].filter((d): d is string => d !== null);
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
