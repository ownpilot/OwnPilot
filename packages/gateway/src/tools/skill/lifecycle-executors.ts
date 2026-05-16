/**
 * Skill Lifecycle Executors
 *
 * Discovery, installation, listing, and on/off toggling — everything that
 * mutates or surfaces the set of installed skills:
 *  - skill_search          — npm registry search
 *  - skill_install         — npm install + register as extension
 *  - skill_list_installed  — installed skills with status/format filters
 *  - skill_get_info        — full manifest for one skill
 *  - skill_toggle          — enable/disable
 *  - skill_check_updates   — diff installed vs latest npm
 */

import { getErrorMessage } from '@ownpilot/core';
import { getNpmInstaller } from '../../services/skill-npm-installer.js';
import { getExtensionService } from '../../services/extension-service.js';
import { extensionsRepo } from '../../db/repositories/extensions.js';

type ExecResult = { success: boolean; result?: unknown; error?: string };

export async function executeSearch(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const query = String(args.query ?? '');
    const limit = Math.min(parseInt(String(args.limit ?? '10'), 10), 50);

    const installer = getNpmInstaller();
    const searchResult = await installer.search(query, limit);
    const packages = searchResult.packages;

    return {
      success: true,
      result: {
        query,
        count: packages.length,
        total: searchResult.total,
        skills: packages.map((r) => ({
          name: r.name,
          description: r.description,
          version: r.version,
          author: r.author,
          keywords: r.keywords,
        })),
      },
    };
  } catch (error) {
    return { success: false, error: `Search failed: ${getErrorMessage(error)}` };
  }
}

export async function executeInstall(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  try {
    const packageName = String(args.packageName ?? '');
    if (!packageName) {
      return { success: false, error: 'packageName is required' };
    }

    const installer = getNpmInstaller();
    const service = getExtensionService();

    const result = await installer.install(packageName, userId, service);

    if (!result.success) {
      return { success: false, error: result.error ?? 'Installation failed' };
    }

    return {
      success: true,
      result: {
        message: `Skill "${packageName}" installed successfully`,
        packageName,
        extensionId: result.extensionId,
        note: "The skill's tools are now available for use",
      },
    };
  } catch (error) {
    return { success: false, error: `Installation failed: ${getErrorMessage(error)}` };
  }
}

export async function executeListInstalled(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const service = getExtensionService();
    const statusFilter = args.status as string | undefined;
    const formatFilter = args.format as string | undefined;

    let packages = service.getAll();

    if (statusFilter && statusFilter !== 'all') {
      packages = packages.filter((p) => p.status === statusFilter);
    }
    if (formatFilter && formatFilter !== 'all') {
      packages = packages.filter((p) => (p.manifest.format ?? 'ownpilot') === formatFilter);
    }

    return {
      success: true,
      result: {
        count: packages.length,
        skills: packages.map((p) => {
          const fmt = p.manifest.format ?? 'ownpilot';
          const instructions =
            fmt === 'agentskills'
              ? (p.manifest.system_prompt || p.manifest.instructions || '').slice(0, 200)
              : undefined;
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            version: p.version,
            status: p.status,
            format: fmt,
            category: p.category,
            toolCount: p.toolCount,
            triggerCount: p.triggerCount,
            installedAt: p.installedAt,
            ...(instructions
              ? { instructionsPreview: instructions + (instructions.length >= 200 ? '…' : '') }
              : {}),
          };
        }),
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function executeGetInfo(args: Record<string, unknown>): Promise<ExecResult> {
  try {
    const skillId = String(args.skillId ?? '');
    if (!skillId) {
      return { success: false, error: 'skillId is required' };
    }

    const service = getExtensionService();
    const pkg = service.getById(skillId) ?? service.getAll().find((p) => p.name === skillId);

    if (!pkg) {
      return { success: false, error: `Skill not found: ${skillId}` };
    }

    const fmt = pkg.manifest.format ?? 'ownpilot';
    const instructions = pkg.manifest.system_prompt || pkg.manifest.instructions || undefined;

    return {
      success: true,
      result: {
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        status: pkg.status,
        format: fmt,
        category: pkg.category,
        author: pkg.authorName,
        installedAt: pkg.installedAt,
        // For agentskills format: full instruction text
        ...(fmt === 'agentskills' && instructions ? { instructions } : {}),
        tools: pkg.manifest.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          requiresApproval: t.requires_approval,
        })),
        triggers: pkg.manifest.triggers?.map((t) => ({
          name: t.name,
          description: t.description,
          type: t.type,
          enabled: t.enabled !== false,
        })),
        requiredServices: pkg.manifest.required_services?.map((s) => ({
          name: s.name,
          displayName: s.display_name,
          description: s.description,
        })),
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function executeToggle(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  try {
    const skillId = String(args.skillId ?? '');
    const enabled = Boolean(args.enabled);

    if (!skillId) {
      return { success: false, error: 'skillId is required' };
    }

    const service = getExtensionService();
    const updated = enabled
      ? await service.enable(skillId, userId)
      : await service.disable(skillId, userId);

    if (!updated) {
      return { success: false, error: `Skill not found: ${skillId}` };
    }

    return {
      success: true,
      result: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        enabled,
        message: `Skill "${updated.name}" ${enabled ? 'enabled' : 'disabled'}`,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function executeCheckUpdates(userId: string): Promise<ExecResult> {
  try {
    const allExtensions = extensionsRepo.getAll().filter((e) => e.userId === userId);
    const installer = getNpmInstaller();

    const updates: { id: string; name: string; current: string; latest: string }[] = [];

    for (const ext of allExtensions) {
      const npmPkg =
        ext.manifest.npm_package ?? (ext.settings as Record<string, unknown>).npmPackage;
      const npmVersion =
        ext.manifest.npm_version ?? (ext.settings as Record<string, unknown>).npmVersion;
      if (typeof npmPkg === 'string' && typeof npmVersion === 'string') {
        const check = await installer.checkForUpdate(npmPkg, npmVersion);
        if (check.hasUpdate) {
          updates.push({
            id: ext.id,
            name: ext.name,
            current: npmVersion,
            latest: check.latestVersion,
          });
        }
      }
    }

    return {
      success: true,
      result: {
        hasUpdates: updates.length > 0,
        count: updates.length,
        updates,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
