/**
 * Skill Package Management Tools
 *
 * AI agent tools for listing, toggling, and inspecting installed skill packages.
 */

import { type ToolDefinition, getErrorMessage } from '@ownpilot/core';
import { getSkillPackageService } from '../services/skill-package-service.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const listSkillPackagesDef: ToolDefinition = {
  name: 'list_skill_packages',
  description: 'List installed skill packages with their status, tools, and triggers.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['enabled', 'disabled', 'error'],
        description: 'Filter by package status',
      },
      category: {
        type: 'string',
        description: 'Filter by category (e.g., "developer", "productivity")',
      },
    },
  },
  category: 'System',
};

const toggleSkillPackageDef: ToolDefinition = {
  name: 'toggle_skill_package',
  description: 'Enable or disable a skill package. Enabling activates its tools and triggers; disabling deactivates them.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Skill package ID',
      },
      enabled: {
        type: 'boolean',
        description: 'Set to true to enable, false to disable',
      },
    },
    required: ['id', 'enabled'],
  },
  category: 'System',
};

const getSkillPackageInfoDef: ToolDefinition = {
  name: 'get_skill_package_info',
  description: 'Get detailed information about a skill package including its tools, triggers, and configuration.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Skill package ID',
      },
    },
    required: ['id'],
  },
  category: 'System',
};

export const SKILL_PACKAGE_TOOLS: ToolDefinition[] = [
  listSkillPackagesDef,
  toggleSkillPackageDef,
  getSkillPackageInfoDef,
];

// =============================================================================
// Executor
// =============================================================================

export async function executeSkillPackageTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default',
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const service = getSkillPackageService();

  switch (toolName) {
    case 'list_skill_packages': {
      let packages = service.getAll();

      if (args.status) {
        packages = packages.filter(p => p.status === args.status);
      }
      if (args.category) {
        packages = packages.filter(p => p.category === args.category);
      }

      return {
        success: true,
        result: packages.map(p => ({
          id: p.id,
          name: p.name,
          version: p.version,
          description: p.description,
          category: p.category,
          icon: p.icon,
          status: p.status,
          toolCount: p.toolCount,
          triggerCount: p.triggerCount,
          author: p.authorName,
        })),
      };
    }

    case 'toggle_skill_package': {
      const id = args.id as string;
      const enabled = args.enabled as boolean;

      try {
        const updated = enabled
          ? await service.enable(id, userId)
          : await service.disable(id, userId);

        if (!updated) {
          return { success: false, error: `Skill package not found: ${id}` };
        }

        return {
          success: true,
          result: {
            id: updated.id,
            name: updated.name,
            status: updated.status,
            message: `Skill package "${updated.name}" ${enabled ? 'enabled' : 'disabled'}.`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'get_skill_package_info': {
      const id = args.id as string;
      const pkg = service.getById(id);

      if (!pkg) {
        return { success: false, error: `Skill package not found: ${id}` };
      }

      return {
        success: true,
        result: {
          id: pkg.id,
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          category: pkg.category,
          icon: pkg.icon,
          author: pkg.authorName,
          status: pkg.status,
          sourcePath: pkg.sourcePath,
          toolCount: pkg.toolCount,
          triggerCount: pkg.triggerCount,
          installedAt: pkg.installedAt,
          updatedAt: pkg.updatedAt,
          errorMessage: pkg.errorMessage,
          tools: pkg.manifest.tools.map(t => ({
            name: t.name,
            description: t.description,
            permissions: t.permissions,
            requires_approval: t.requires_approval,
          })),
          triggers: pkg.manifest.triggers?.map(t => ({
            name: t.name,
            type: t.type,
            enabled: t.enabled !== false,
          })),
          requiredServices: pkg.manifest.required_services?.map(s => ({
            name: s.name,
            displayName: s.display_name,
          })),
          systemPrompt: pkg.manifest.system_prompt ? '(present)' : null,
        },
      };
    }

    default:
      return { success: false, error: `Unknown skill package tool: ${toolName}` };
  }
}
