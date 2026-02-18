/**
 * Extension Service
 *
 * Business logic for installing, enabling/disabling, and managing user extensions.
 * Handles trigger synchronization and Config Center registration.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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
  extensionsRepo,
  type ExtensionRecord,
} from '../db/repositories/extensions.js';
import {
  validateManifest,
  type ExtensionManifest,
  type ExtensionToolDefinition,
} from './extension-types.js';
import { parseExtensionMarkdown } from './extension-markdown.js';
import { parseAgentSkillsMd } from './agentskills-parser.js';
import { registerToolConfigRequirements, unregisterDependencies } from './api-service-registrar.js';
import { getDataDirectoryInfo } from '../paths/index.js';
import { getLog } from './log.js';

const log = getLog('ExtService');

// =============================================================================
// Types
// =============================================================================

export type ExtensionErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'ALREADY_EXISTS' | 'IO_ERROR';

export class ExtensionError extends Error {
  constructor(
    message: string,
    public readonly code: ExtensionErrorCode,
  ) {
    super(message);
    this.name = 'ExtensionError';
  }
}

export interface ToolDefinitionForRegistry {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category?: string;
  /** Extension ID that owns this tool */
  extensionId: string;
  /** Original extension tool definition (for code execution) */
  extensionTool: ExtensionToolDefinition;
}

// =============================================================================
// Service
// =============================================================================

export class ExtensionService {
  // --------------------------------------------------------------------------
  // Install
  // --------------------------------------------------------------------------

  async install(manifestPath: string, userId = 'default'): Promise<ExtensionRecord> {
    let rawContent: string;
    try {
      rawContent = readFileSync(manifestPath, 'utf-8');
    } catch {
      throw new ExtensionError(`Cannot read manifest: ${manifestPath}`, 'IO_ERROR');
    }

    let manifest: ExtensionManifest;
    const fileName = manifestPath.split(/[/\\]/).pop() ?? '';

    if (fileName === 'SKILL.md') {
      // AgentSkills.io open standard format
      try {
        const skillDir = manifestPath.replace(/[/\\]SKILL\.md$/, '');
        manifest = parseAgentSkillsMd(rawContent, skillDir);
      } catch (e) {
        throw new ExtensionError(
          `Invalid AgentSkills.io SKILL.md: ${manifestPath} — ${e instanceof Error ? e.message : String(e)}`,
          'VALIDATION_ERROR',
        );
      }
      // AgentSkills.io format skips tool validation (no tools required)
      return this.installFromManifest(manifest, userId, manifestPath);
    }

    if (manifestPath.endsWith('.md')) {
      // OwnPilot extension markdown format
      try {
        manifest = parseExtensionMarkdown(rawContent);
      } catch (e) {
        throw new ExtensionError(
          `Invalid markdown manifest: ${manifestPath} — ${e instanceof Error ? e.message : String(e)}`,
          'VALIDATION_ERROR',
        );
      }
    } else {
      // OwnPilot extension JSON format
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        throw new ExtensionError(`Invalid JSON in manifest: ${manifestPath}`, 'VALIDATION_ERROR');
      }
      manifest = parsed as ExtensionManifest;
    }

    return this.installFromManifest(manifest, userId, manifestPath);
  }

  async installFromManifest(
    manifest: ExtensionManifest,
    userId = 'default',
    sourcePath?: string,
  ): Promise<ExtensionRecord> {
    // AgentSkills.io format doesn't require tools — skip tool validation
    if (manifest.format !== 'agentskills') {
      const validation = validateManifest(manifest);
      if (!validation.valid) {
        throw new ExtensionError(
          `Invalid manifest: ${validation.errors.join('; ')}`,
          'VALIDATION_ERROR',
        );
      }
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
    const record = await extensionsRepo.upsert({
      id: manifest.id,
      userId,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      category: manifest.category ?? 'other',
      format: manifest.format ?? 'ownpilot',
      icon: manifest.icon,
      authorName: manifest.author?.name,
      manifest,
      sourcePath,
      toolCount: manifest.tools.length,
      triggerCount: manifest.triggers?.length ?? 0,
    });

    // Create triggers for enabled extensions
    if (record.status === 'enabled') {
      await this.activateExtensionTriggers(manifest, userId);
    }

    getEventBus().emit(createEvent<ResourceCreatedData>(
      EventTypes.RESOURCE_CREATED, 'resource', 'extension-service',
      { resourceType: 'extension', id: manifest.id },
    ));

    log.info(`Installed extension "${manifest.name}" v${manifest.version}`, {
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
    const record = extensionsRepo.getById(id);
    if (!record) return false;

    // Deactivate triggers
    await this.deactivateExtensionTriggers(id, userId);

    // Remove config dependencies
    try {
      await unregisterDependencies(id);
    } catch (e) {
      log.warn('Failed to unregister dependencies', { id, error: String(e) });
    }

    const deleted = await extensionsRepo.delete(id);

    if (deleted) {
      getEventBus().emit(createEvent<ResourceDeletedData>(
        EventTypes.RESOURCE_DELETED, 'resource', 'extension-service',
        { resourceType: 'extension', id },
      ));
      log.info(`Uninstalled extension "${record.name}"`, { id });
    }

    return deleted;
  }

  // --------------------------------------------------------------------------
  // Enable / Disable
  // --------------------------------------------------------------------------

  async enable(id: string, userId = 'default'): Promise<ExtensionRecord | null> {
    const record = extensionsRepo.getById(id);
    if (!record) return null;

    if (record.status === 'enabled') return record;

    await this.activateExtensionTriggers(record.manifest, userId);
    const updated = await extensionsRepo.updateStatus(id, 'enabled');

    if (updated) {
      getEventBus().emit(createEvent<ResourceUpdatedData>(
        EventTypes.RESOURCE_UPDATED, 'resource', 'extension-service',
        { resourceType: 'extension', id, changes: { status: 'enabled' } },
      ));
    }

    return updated;
  }

  async disable(id: string, userId = 'default'): Promise<ExtensionRecord | null> {
    const record = extensionsRepo.getById(id);
    if (!record) return null;

    if (record.status === 'disabled') return record;

    await this.deactivateExtensionTriggers(id, userId);
    const updated = await extensionsRepo.updateStatus(id, 'disabled');

    if (updated) {
      getEventBus().emit(createEvent<ResourceUpdatedData>(
        EventTypes.RESOURCE_UPDATED, 'resource', 'extension-service',
        { resourceType: 'extension', id, changes: { status: 'disabled' } },
      ));
    }

    return updated;
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  getById(id: string): ExtensionRecord | null {
    return extensionsRepo.getById(id);
  }

  getAll(): ExtensionRecord[] {
    return extensionsRepo.getAll();
  }

  getEnabled(): ExtensionRecord[] {
    return extensionsRepo.getEnabled();
  }

  // --------------------------------------------------------------------------
  // Tool definitions (aggregated from all enabled extensions)
  // --------------------------------------------------------------------------

  getToolDefinitions(): ToolDefinitionForRegistry[] {
    const enabled = extensionsRepo.getEnabled();
    const defs: ToolDefinitionForRegistry[] = [];

    for (const pkg of enabled) {
      // OwnPilot extensions: register their inline JS tools
      for (const tool of pkg.manifest.tools) {
        defs.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          category: pkg.manifest.category ?? 'other',
          extensionId: pkg.id,
          extensionTool: tool,
        });
      }

      // AgentSkills.io: bridge scripts/ to executable tools
      if (pkg.manifest.format === 'agentskills' && pkg.manifest.script_paths?.length && pkg.sourcePath) {
        const skillDir = pkg.sourcePath.replace(/[/\\]SKILL\.md$/, '');
        for (const scriptPath of pkg.manifest.script_paths) {
          const scriptName = scriptPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? scriptPath;
          const ext = scriptPath.split('.').pop()?.toLowerCase();
          const toolName = `${pkg.id}_${scriptName}`.replace(/[^a-z0-9_]/g, '_');

          // Determine execution tool based on file extension
          let execTool: string;
          if (ext === 'py') execTool = 'execute_python';
          else if (ext === 'sh' || ext === 'bash') execTool = 'execute_shell';
          else if (ext === 'js' || ext === 'mjs') execTool = 'execute_javascript';
          else continue; // Skip unsupported script types

          const fullPath = join(skillDir, scriptPath).replace(/\\/g, '/');
          const code = `
            const fs = require('fs');
            const script = fs.readFileSync('${fullPath}', 'utf-8');
            const argsJson = JSON.stringify(args);
            return { content: { script_path: '${fullPath}', exec_tool: '${execTool}', args: argsJson, note: 'Use ${execTool} to run this script with the provided arguments.' } };
          `.trim();

          defs.push({
            name: toolName,
            description: `Run script: ${scriptPath} (from skill "${pkg.manifest.name}"). Use ${execTool} to execute.`,
            parameters: { type: 'object', properties: { args: { type: 'string', description: 'Arguments to pass to the script' } } },
            category: pkg.manifest.category ?? 'other',
            extensionId: pkg.id,
            extensionTool: {
              name: toolName,
              description: `Run ${scriptPath}`,
              parameters: { type: 'object', properties: { args: { type: 'string' } } },
              code,
              permissions: ['filesystem'],
            },
          });
        }
      }
    }

    return defs;
  }

  // --------------------------------------------------------------------------
  // System prompt sections
  // --------------------------------------------------------------------------

  getSystemPromptSections(): string[] {
    const enabled = extensionsRepo.getEnabled();
    const sections: string[] = [];

    for (const pkg of enabled) {
      if (pkg.manifest.format === 'agentskills') {
        // AgentSkills.io: inject full instructions as system prompt (progressive disclosure)
        const instructions = pkg.manifest.instructions?.trim();
        if (instructions) {
          sections.push(`## Skill: ${pkg.manifest.name}\n${instructions}`);
        }
      } else if (pkg.manifest.system_prompt?.trim()) {
        // OwnPilot extension: inject system_prompt field
        sections.push(`## Extension: ${pkg.manifest.name}\n${pkg.manifest.system_prompt.trim()}`);
      }
    }

    return sections;
  }

  /**
   * Get lightweight skill metadata for initial context injection.
   * Used by AgentSkills.io progressive disclosure: only name + description
   * are injected at startup (~100 tokens each). Full instructions are
   * loaded when the agent decides to activate a skill.
   */
  getAvailableSkillsMetadata(): Array<{ name: string; description: string; id: string }> {
    const enabled = extensionsRepo.getEnabled();
    return enabled
      .filter(pkg => pkg.manifest.format === 'agentskills')
      .map(pkg => ({
        name: pkg.manifest.name,
        description: pkg.manifest.description,
        id: pkg.id,
      }));
  }

  // --------------------------------------------------------------------------
  // Reload from disk
  // --------------------------------------------------------------------------

  async reload(id: string, userId = 'default'): Promise<ExtensionRecord | null> {
    const record = extensionsRepo.getById(id);
    if (!record) return null;
    if (!record.sourcePath) {
      throw new ExtensionError('No source path to reload from', 'IO_ERROR');
    }

    // Deactivate old triggers
    await this.deactivateExtensionTriggers(id, userId);

    // Re-install from source
    const updated = await this.install(record.sourcePath, userId);
    return updated;
  }

  // --------------------------------------------------------------------------
  // Scan directory for new extensions
  // --------------------------------------------------------------------------

  async scanDirectory(directory?: string, userId = 'default'): Promise<{
    installed: number;
    errors: Array<{ path: string; error: string }>;
  }> {
    // If no explicit directory, scan all known directories
    if (!directory) {
      const dirs = [
        this.getDefaultExtensionsDirectory(),
        this.getDefaultSkillsDirectory(),
        this.getWorkspaceSkillsDirectory(),
        this.getBundledExampleSkillsDirectory(),
      ].filter((d): d is string => d !== null);

      let totalInstalled = 0;
      const allErrors: Array<{ path: string; error: string }> = [];
      for (const dir of dirs) {
        const r = await this.scanSingleDirectory(dir, userId);
        totalInstalled += r.installed;
        allErrors.push(...r.errors);
      }
      return { installed: totalInstalled, errors: allErrors };
    }
    return this.scanSingleDirectory(directory, userId);
  }

  private async scanSingleDirectory(scanDir: string, userId: string): Promise<{
    installed: number;
    errors: Array<{ path: string; error: string }>;
  }> {
    const errors: Array<{ path: string; error: string }> = [];
    let installed = 0;

    if (!existsSync(scanDir)) {
      log.debug(`Directory does not exist: ${scanDir}`);
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
      if (existsSync(agentSkillsMdPath)) {
        manifestPath = agentSkillsMdPath;
      } else if (existsSync(jsonPath)) {
        manifestPath = jsonPath;
      } else if (existsSync(mdPath)) {
        manifestPath = mdPath;
      } else if (existsSync(legacyJsonPath)) {
        manifestPath = legacyJsonPath;
      } else if (existsSync(legacyMdPath)) {
        manifestPath = legacyMdPath;
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
      log.info(`Scanned ${scanDir}: installed ${installed} extensions`, { errors: errors.length });
    }

    return { installed, errors };
  }

  // --------------------------------------------------------------------------
  // Trigger management (private)
  // --------------------------------------------------------------------------

  private async activateExtensionTriggers(manifest: ExtensionManifest, userId: string): Promise<void> {
    if (!manifest.triggers?.length) return;

    const triggerService = getServiceRegistry().get(Services.Trigger);

    for (const trigger of manifest.triggers) {
      try {
        await triggerService.createTrigger(userId, {
          name: `[Ext:${manifest.id}] ${trigger.name}`,
          description: trigger.description ?? `Auto-managed by extension: ${manifest.name}`,
          type: trigger.type,
          config: trigger.config,
          action: trigger.action,
          enabled: trigger.enabled !== false,
        });
      } catch (e) {
        log.warn(`Failed to create trigger for extension ${manifest.id}`, {
          trigger: trigger.name,
          error: String(e),
        });
      }
    }
  }

  private async deactivateExtensionTriggers(extensionId: string, userId: string): Promise<void> {
    const triggerService = getServiceRegistry().get(Services.Trigger);
    const prefix = `[Ext:${extensionId}]`;

    try {
      const triggers = await triggerService.listTriggers(userId);
      for (const trigger of triggers) {
        if (trigger.name.startsWith(prefix)) {
          await triggerService.deleteTrigger(userId, trigger.id);
        }
      }
    } catch (e) {
      log.warn(`Failed to deactivate triggers for extension ${extensionId}`, { error: String(e) });
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private getDefaultExtensionsDirectory(): string {
    const dataInfo = getDataDirectoryInfo();
    return join(dataInfo.root, 'extensions');
  }

  private getDefaultSkillsDirectory(): string {
    const dataInfo = getDataDirectoryInfo();
    return join(dataInfo.root, 'skills');
  }

  /**
   * Get all directories to scan (data dir + workspace).
   * The workspace data/skills/ dir allows bundling skills with the project.
   */
  private getWorkspaceSkillsDirectory(): string | null {
    const workspaceDir = process.env.WORKSPACE_DIR ?? process.cwd();
    const candidate = join(workspaceDir, 'data', 'skills');
    return existsSync(candidate) ? candidate : null;
  }

  /**
   * Bundled example skills shipped with the gateway package.
   */
  private getBundledExampleSkillsDirectory(): string | null {
    try {
      const thisDir = dirname(fileURLToPath(import.meta.url));
      // thisDir = packages/gateway/src/services/ → go up 2 levels to packages/gateway/
      const candidate = join(thisDir, '..', '..', 'data', 'example-skills');
      return existsSync(candidate) ? candidate : null;
    } catch {
      return null;
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ExtensionService | null = null;

export function getExtensionService(): ExtensionService {
  if (!instance) {
    instance = new ExtensionService();
  }
  return instance;
}
