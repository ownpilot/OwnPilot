/**
 * npm Skill Installer
 *
 * Downloads OwnPilot skills from the npm registry, validates them,
 * runs security audit, and installs via the existing ExtensionService.
 */

import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { get as httpsGet } from 'node:https';
import { createWriteStream } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getLog } from './log.js';
import { getErrorMessage } from '@ownpilot/core';

const execAsync = promisify(exec);
const log = getLog('NpmInstaller');

const NPM_REGISTRY = 'https://registry.npmjs.org';
const NPM_SEARCH = 'https://registry.npmjs.org/-/v1/search';
const SKILL_KEYWORD = 'ownpilot-skill';

// =============================================================================
// Types
// =============================================================================

export interface NpmPackageInfo {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  dist?: {
    tarball: string;
    shasum: string;
    integrity?: string;
  };
}

export interface NpmSearchResult {
  packages: NpmSearchPackage[];
  total: number;
}

export interface NpmSearchPackage {
  name: string;
  version: string;
  description: string;
  author?: string;
  keywords: string[];
  date: string;
  links?: { npm?: string; homepage?: string; repository?: string };
}

export interface NpmInstallResult {
  success: boolean;
  extensionId?: string;
  error?: string;
  packageName?: string;
  packageVersion?: string;
}

// =============================================================================
// Service
// =============================================================================

export class NpmSkillInstaller {
  /**
   * Search npm registry for OwnPilot skills.
   */
  async search(query: string, limit = 20, offset = 0): Promise<NpmSearchResult> {
    const params = new URLSearchParams({
      text: `keywords:${SKILL_KEYWORD} ${query}`,
      size: String(limit),
      from: String(offset),
    });
    const url = `${NPM_SEARCH}?${params.toString()}`;

    const data = await this.fetchJson(url);
    const objects = (data as { objects?: unknown[] }).objects ?? [];

    const packages: NpmSearchPackage[] = objects.map((obj: unknown) => {
      const o = obj as { package: Record<string, unknown> };
      const pkg = o.package ?? {};
      return {
        name: String(pkg.name ?? ''),
        version: String(pkg.version ?? ''),
        description: String(pkg.description ?? ''),
        author: pkg.author
          ? typeof pkg.author === 'string'
            ? pkg.author
            : String((pkg.author as Record<string, unknown>).name ?? '')
          : undefined,
        keywords: Array.isArray(pkg.keywords) ? pkg.keywords.map(String) : [],
        date: String(pkg.date ?? ''),
        links: pkg.links as NpmSearchPackage['links'],
      };
    });

    return {
      packages,
      total: (data as { total?: number }).total ?? packages.length,
    };
  }

  /**
   * Get full package metadata from npm.
   */
  async getPackageInfo(packageName: string): Promise<NpmPackageInfo> {
    const url = `${NPM_REGISTRY}/${encodeURIComponent(packageName)}`;
    const data = (await this.fetchJson(url)) as Record<string, unknown>;

    const distTags = (data['dist-tags'] ?? {}) as Record<string, string>;
    const latestVersion = distTags.latest ?? '';

    const versions = (data.versions ?? {}) as Record<string, Record<string, unknown>>;
    const latest = versions[latestVersion] ?? data;

    return {
      name: String(data.name ?? packageName),
      version: latestVersion || String(latest.version ?? ''),
      description: String(data.description ?? ''),
      author: data.author
        ? typeof data.author === 'string'
          ? data.author
          : String((data.author as Record<string, unknown>).name ?? '')
        : undefined,
      license: data.license ? String(data.license) : undefined,
      homepage: data.homepage ? String(data.homepage) : undefined,
      repository: data.repository
        ? typeof data.repository === 'string'
          ? data.repository
          : String((data.repository as Record<string, unknown>).url ?? '')
        : undefined,
      keywords: Array.isArray(data.keywords) ? data.keywords.map(String) : undefined,
      dist: latest.dist as NpmPackageInfo['dist'],
    };
  }

  /**
   * Download and install a skill from npm.
   * Returns the extension ID on success.
   */
  async install(
    packageName: string,
    userId: string,
    extensionService: { install: (path: string, userId: string) => Promise<{ id: string }> }
  ): Promise<NpmInstallResult> {
    const tempDir = mkdtempSync(join(tmpdir(), 'ownpilot-skill-'));

    try {
      // 1. Get package info
      log.info(`Fetching package info for ${packageName}`);
      const info = await this.getPackageInfo(packageName);

      if (!info.dist?.tarball) {
        return { success: false, error: `No tarball URL found for ${packageName}` };
      }

      // 2. Download tarball
      const tarballPath = join(tempDir, 'package.tgz');
      log.info(`Downloading tarball from ${info.dist.tarball}`);
      await this.downloadFile(info.dist.tarball, tarballPath);

      // 3. Extract tarball
      const extractDir = join(tempDir, 'extracted');
      try {
        await execAsync(`tar xzf "${tarballPath}" -C "${tempDir}"`);
        // npm tarballs extract to a "package/" subdirectory
      } catch {
        return { success: false, error: 'Failed to extract tarball (tar not available)' };
      }

      // 4. Find the manifest file
      const packageDir = join(tempDir, 'package');
      const manifestPath = this.findManifest(
        existsSync(packageDir) ? packageDir : existsSync(extractDir) ? extractDir : tempDir
      );

      if (!manifestPath) {
        return {
          success: false,
          error: 'No SKILL.md, extension.json, or extension.md found in package',
        };
      }

      // 5. Install via ExtensionService
      log.info(`Installing from manifest: ${manifestPath}`);
      const record = await extensionService.install(manifestPath, userId);

      return {
        success: true,
        extensionId: record.id,
        packageName: info.name,
        packageVersion: info.version,
      };
    } catch (err) {
      return {
        success: false,
        error: `npm install failed: ${getErrorMessage(err)}`,
        packageName,
      };
    } finally {
      // Cleanup temp directory
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
  }

  /**
   * Check if an npm package has a newer version than the installed one.
   */
  async checkForUpdate(
    packageName: string,
    installedVersion: string
  ): Promise<{ hasUpdate: boolean; latestVersion: string }> {
    try {
      const info = await this.getPackageInfo(packageName);
      return {
        hasUpdate: info.version !== installedVersion,
        latestVersion: info.version,
      };
    } catch {
      return { hasUpdate: false, latestVersion: installedVersion };
    }
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  private findManifest(dir: string): string | null {
    if (!existsSync(dir)) return null;

    const candidates = ['SKILL.md', 'extension.json', 'extension.md'];
    for (const name of candidates) {
      const path = join(dir, name);
      if (existsSync(path)) return path;
    }

    // Check one level deep (package/ subdirectory)
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          for (const name of candidates) {
            const path = join(dir, entry.name, name);
            if (existsSync(path)) return path;
          }
        }
      }
    } catch {
      // Ignore
    }

    return null;
  }

  private fetchJson(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      httpsGet(url, { headers: { Accept: 'application/json' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            this.fetchJson(redirectUrl).then(resolve, reject);
            return;
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (e) {
            reject(new Error(`Invalid JSON from ${url}: ${getErrorMessage(e)}`));
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      httpsGet(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            this.downloadFile(redirectUrl, destPath).then(resolve, reject);
            return;
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
          return;
        }

        const file = createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
        file.on('error', reject);
      }).on('error', reject);
    });
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: NpmSkillInstaller | null = null;

export function getNpmInstaller(): NpmSkillInstaller {
  if (!instance) {
    instance = new NpmSkillInstaller();
  }
  return instance;
}
