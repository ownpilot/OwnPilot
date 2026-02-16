/**
 * Skill Package Service
 *
 * Business logic for installing, enabling/disabling, and managing skill packages.
 * Handles trigger synchronization and Config Center registration.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  getEventBus,
  createEvent,
  EventTypes,
  getServiceRegistry,
  Services,
  type ResourceCreatedData,
  type ResourceUpdatedData,
  type ResourceDeletedData,
} from '@ownpilot/core';
import {
  skillPackagesRepo,
  type SkillPackageRecord,
} from '../db/repositories/skill-packages.js';
import {
  validateManifest,
  type SkillPackageManifest,
  type SkillToolDefinition,
} from './skill-package-types.js';
import { parseSkillMarkdown } from './skill-package-markdown.js';
import { registerToolConfigRequirements, unregisterDependencies } from './api-service-registrar.js';
import { getDataDirectoryInfo } from '../paths/index.js';
import { getLog } from './log.js';

const log = getLog('SkillPkgService');

// =============================================================================
// Types
// =============================================================================

export type SkillPackageErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'IO_ERROR';

export class SkillPackageError extends Error {
  constructor(
    message: string,
    public readonly code: SkillPackageErrorCode,
  ) {
    super(message);
    this.name = 'SkillPackageError';
  }
}

export interface ToolDefinitionForRegistry {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category?: string;
  /** Skill package ID that owns this tool */
  skillPackageId: string;
  /** Original skill tool definition (for code execution) */
  skillTool: SkillToolDefinition;
}

// =============================================================================
// Service
// =============================================================================

export class SkillPackageService {
  // --------------------------------------------------------------------------
  // Install
  // --------------------------------------------------------------------------

  async install(manifestPath: string, userId = 'default'): Promise<SkillPackageRecord> {
    let rawContent: string;
    try {
      rawContent = readFileSync(manifestPath, 'utf-8');
    } catch {
      throw new SkillPackageError(`Cannot read manifest: ${manifestPath}`, 'IO_ERROR');
    }

    let manifest: SkillPackageManifest;
    if (manifestPath.endsWith('.md')) {
      try {
        manifest = parseSkillMarkdown(rawContent);
      } catch (e) {
        throw new SkillPackageError(
          `Invalid markdown manifest: ${manifestPath} — ${e instanceof Error ? e.message : String(e)}`,
          'VALIDATION_ERROR',
        );
      }
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        throw new SkillPackageError(`Invalid JSON in manifest: ${manifestPath}`, 'VALIDATION_ERROR');
      }
      manifest = parsed as SkillPackageManifest;
    }

    return this.installFromManifest(manifest, userId, manifestPath);
  }

  async installFromManifest(
    manifest: SkillPackageManifest,
    userId = 'default',
    sourcePath?: string,
  ): Promise<SkillPackageRecord> {
    // Validate
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      throw new SkillPackageError(
        `Invalid manifest: ${validation.errors.join('; ')}`,
        'VALIDATION_ERROR',
      );
    }

    // Register required services in Config Center
    if (manifest.required_services?.length) {
      try {
        await registerToolConfigRequirements(
          manifest.name,
          manifest.id,
          'custom',
          manifest.required_services.map(s => ({
            name: s.name,
            displayName: s.display_name,
            description: s.description,
            category: s.category,
            docsUrl: s.docs_url,
            configSchema: s.config_schema?.map(f => ({
              name: f.name,
              label: f.label,
              type: f.type as 'string' | 'secret' | 'url' | 'number' | 'boolean',
              required: f.required,
              description: f.description,
            })),
          })),
        );
      } catch (e) {
        log.warn('Failed to register config requirements', { id: manifest.id, error: String(e) });
      }
    }

    // Upsert DB record
    const record = await skillPackagesRepo.upsert({
      id: manifest.id,
      userId,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      category: manifest.category ?? 'other',
      icon: manifest.icon,
      authorName: manifest.author?.name,
      manifest,
      sourcePath,
      toolCount: manifest.tools.length,
      triggerCount: manifest.triggers?.length ?? 0,
    });

    // Create triggers for enabled packages
    if (record.status === 'enabled') {
      await this.activatePackageTriggers(manifest, userId);
    }

    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'skill-package-service',
      { resourceType: 'skill_package', id: manifest.id },
    ));

    log.info(`Installed skill package "${manifest.name}" v${manifest.version}`, {
      id: manifest.id,
      tools: manifest.tools.length,
      triggers: manifest.triggers?.length ?? 0,
    });

    return record;
  }

  // --------------------------------------------------------------------------
  // Uninstall
  // --------------------------------------------------------------------------

  async uninstall(id: string, userId = 'default'): Promise<boolean> {
    const record = skillPackagesRepo.getById(id);
    if (!record) return false;

    // Deactivate triggers
    await this.deactivatePackageTriggers(id, userId);

    // Remove config dependencies
    try {
      await unregisterDependencies(id);
    } catch (e) {
      log.warn('Failed to unregister dependencies', { id, error: String(e) });
    }

    const deleted = await skillPackagesRepo.delete(id);

    if (deleted) {
      getEventBus().emit(createEvent<ResourceDeletedData>(
        EventTypes.RESOURCE_DELETED, 'resource', 'skill-package-service',
        { resourceType: 'skill_package', id },
      ));
      log.info(`Uninstalled skill package "${record.name}"`, { id });
    }

    return deleted;
  }

  // --------------------------------------------------------------------------
  // Enable / Disable
  // --------------------------------------------------------------------------

  async enable(id: string, userId = 'default'): Promise<SkillPackageRecord | null> {
    const record = skillPackagesRepo.getById(id);
    if (!record) return null;

    if (record.status === 'enabled') return record;

    await this.activatePackageTriggers(record.manifest, userId);
    const updated = await skillPackagesRepo.updateStatus(id, 'enabled');

    if (updated) {
      getEventBus().emit(createEvent<ResourceUpdatedData>(
        EventTypes.RESOURCE_UPDATED, 'resource', 'skill-package-service',
        { resourceType: 'skill_package', id, changes: { status: 'enabled' } },
      ));
    }

    return updated;
  }

  async disable(id: string, userId = 'default'): Promise<SkillPackageRecord | null> {
    const record = skillPackagesRepo.getById(id);
    if (!record) return null;

    if (record.status === 'disabled') return record;

    await this.deactivatePackageTriggers(id, userId);
    const updated = await skillPackagesRepo.updateStatus(id, 'disabled');

    if (updated) {
      getEventBus().emit(createEvent<ResourceUpdatedData>(
        EventTypes.RESOURCE_UPDATED, 'resource', 'skill-package-service',
        { resourceType: 'skill_package', id, changes: { status: 'disabled' } },
      ));
    }

    return updated;
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  getById(id: string): SkillPackageRecord | null {
    return skillPackagesRepo.getById(id);
  }

  getAll(): SkillPackageRecord[] {
    return skillPackagesRepo.getAll();
  }

  getEnabled(): SkillPackageRecord[] {
    return skillPackagesRepo.getEnabled();
  }

  // --------------------------------------------------------------------------
  // Tool definitions (aggregated from all enabled packages)
  // --------------------------------------------------------------------------

  getToolDefinitions(): ToolDefinitionForRegistry[] {
    const enabled = skillPackagesRepo.getEnabled();
    const defs: ToolDefinitionForRegistry[] = [];

    for (const pkg of enabled) {
      for (const tool of pkg.manifest.tools) {
        defs.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          category: pkg.manifest.category ?? 'other',
          skillPackageId: pkg.id,
          skillTool: tool,
        });
      }
    }

    return defs;
  }

  // --------------------------------------------------------------------------
  // System prompt sections
  // --------------------------------------------------------------------------

  getSystemPromptSections(): string[] {
    const enabled = skillPackagesRepo.getEnabled();
    const sections: string[] = [];

    for (const pkg of enabled) {
      if (pkg.manifest.system_prompt?.trim()) {
        sections.push(`## Skill: ${pkg.manifest.name}\n${pkg.manifest.system_prompt.trim()}`);
      }
    }

    return sections;
  }

  // --------------------------------------------------------------------------
  // Reload from disk
  // --------------------------------------------------------------------------

  async reload(id: string, userId = 'default'): Promise<SkillPackageRecord | null> {
    const record = skillPackagesRepo.getById(id);
    if (!record) return null;
    if (!record.sourcePath) {
      throw new SkillPackageError('No source path to reload from', 'IO_ERROR');
    }

    // Deactivate old triggers
    await this.deactivatePackageTriggers(id, userId);

    // Re-install from source
    const updated = await this.install(record.sourcePath, userId);
    return updated;
  }

  // --------------------------------------------------------------------------
  // Scan directory for new packages
  // --------------------------------------------------------------------------

  async scanDirectory(directory?: string, userId = 'default'): Promise<{
    installed: number;
    errors: Array<{ path: string; error: string }>;
  }> {
    const scanDir = directory ?? this.getDefaultSkillsDirectory();
    const errors: Array<{ path: string; error: string }> = [];
    let installed = 0;

    if (!existsSync(scanDir)) {
      log.debug(`Skills directory does not exist: ${scanDir}`);
      return { installed: 0, errors: [] };
    }

    let entries: string[];
    try {
      entries = readdirSync(scanDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch {
      return { installed: 0, errors: [{ path: scanDir, error: 'Cannot read directory' }] };
    }

    for (const dirName of entries) {
      // Prefer skill.json, fall back to skill.md
      const jsonPath = join(scanDir, dirName, 'skill.json');
      const mdPath = join(scanDir, dirName, 'skill.md');
      let manifestPath: string | null = null;
      if (existsSync(jsonPath)) {
        manifestPath = jsonPath;
      } else if (existsSync(mdPath)) {
        manifestPath = mdPath;
      }
      if (!manifestPath) continue;

      try {
        await this.install(manifestPath, userId);
        installed++;
      } catch (e) {
        errors.push({
          path: manifestPath,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (installed > 0) {
      log.info(`Scanned ${scanDir}: installed ${installed} skill packages`, { errors: errors.length });
    }

    return { installed, errors };
  }

  // --------------------------------------------------------------------------
  // Trigger management (private)
  // --------------------------------------------------------------------------

  private async activatePackageTriggers(manifest: SkillPackageManifest, userId: string): Promise<void> {
    if (!manifest.triggers?.length) return;

    const triggerService = getServiceRegistry().get(Services.Trigger);

    for (const trigger of manifest.triggers) {
      try {
        await triggerService.createTrigger(userId, {
          name: `[Skill:${manifest.id}] ${trigger.name}`,
          description: trigger.description ?? `Auto-managed by skill: ${manifest.name}`,
          type: trigger.type,
          config: trigger.config,
          action: trigger.action,
          enabled: trigger.enabled !== false,
        });
      } catch (e) {
        log.warn(`Failed to create trigger for skill ${manifest.id}`, {
          trigger: trigger.name,
          error: String(e),
        });
      }
    }
  }

  private async deactivatePackageTriggers(skillId: string, userId: string): Promise<void> {
    const triggerService = getServiceRegistry().get(Services.Trigger);
    const prefix = `[Skill:${skillId}]`;

    try {
      const triggers = await triggerService.listTriggers(userId);
      for (const trigger of triggers) {
        if (trigger.name.startsWith(prefix)) {
          await triggerService.deleteTrigger(userId, trigger.id);
        }
      }
    } catch (e) {
      log.warn(`Failed to deactivate triggers for skill ${skillId}`, { error: String(e) });
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private getDefaultSkillsDirectory(): string {
    const dataInfo = getDataDirectoryInfo();
    return join(dataInfo.root, 'skill-packages');
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: SkillPackageService | null = null;

export function getSkillPackageService(): SkillPackageService {
  if (!instance) {
    instance = new SkillPackageService();
  }
  return instance;
}
