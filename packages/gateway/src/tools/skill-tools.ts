/**
 * Skill Tools
 *
 * AI agent tools for discovering, installing, and using skills (AgentSkills.io format).
 * These tools allow agents to extend their own capabilities by finding and using skills.
 */

import type { ToolDefinition } from '@ownpilot/core';
import { getNpmInstaller } from '../services/skill-npm-installer.js';
import { getExtensionService } from '../services/extension-service.js';
import { extensionsRepo } from '../db/repositories/extensions.js';
import { getAdapter } from '../db/adapters/index.js';
import { getErrorMessage } from '@ownpilot/core';
import { parseSkillMdFrontmatter, scanSkillDirectory } from '../services/agentskills-parser.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// =============================================================================
// Tool Definitions
// =============================================================================

const searchSkillsTool: ToolDefinition = {
  name: 'skill_search',
  workflowUsable: true,
  description:
    'Search for available skills in the npm registry. ' +
    'Use this to discover skills that can extend your capabilities. ' +
    'Returns skill name, description, version, and installation info.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (e.g., "weather", "translation", "data analysis")',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default: 10)',
        default: 10,
      },
    },
    required: ['query'],
  },
  category: 'Skills',
};

const installSkillTool: ToolDefinition = {
  name: 'skill_install',
  workflowUsable: false,
  description:
    'Install a skill from npm. ' +
    'Use skill_search first to find the correct package name. ' +
    "After installation, the skill's tools become available for immediate use.",
  parameters: {
    type: 'object',
    properties: {
      packageName: {
        type: 'string',
        description: 'NPM package name (e.g., "@agentskills/weather", "ownpilot-weather")',
      },
    },
    required: ['packageName'],
  },
  category: 'Skills',
};

const listInstalledSkillsTool: ToolDefinition = {
  name: 'skill_list_installed',
  workflowUsable: true,
  description:
    'List all installed skills/extensions with their status, format, tools, and capabilities. ' +
    'format is "agentskills" (SKILL.md instruction-based) or "ownpilot" (native tool bundle). ' +
    'Use this to see what skills are available and which tools they provide.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['enabled', 'disabled', 'all'],
        description: 'Filter by status',
        default: 'enabled',
      },
      format: {
        type: 'string',
        enum: ['agentskills', 'ownpilot', 'all'],
        description: 'Filter by format',
        default: 'all',
      },
    },
  },
  category: 'Skills',
};

const getSkillInfoTool: ToolDefinition = {
  name: 'skill_get_info',
  workflowUsable: true,
  description:
    'Get detailed information about an installed skill including its format, instructions, ' +
    'tools, required configuration, and usage instructions.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'Skill/extension ID or name',
      },
    },
    required: ['skillId'],
  },
  category: 'Skills',
};

const toggleSkillTool: ToolDefinition = {
  name: 'skill_toggle',
  workflowUsable: false,
  description:
    "Enable or disable a skill. Disabling prevents the skill's tools from being used. " +
    'Use this if a skill is causing issues or is no longer needed.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'Skill/extension ID',
      },
      enabled: {
        type: 'boolean',
        description: 'true to enable, false to disable',
      },
    },
    required: ['skillId', 'enabled'],
  },
  category: 'Skills',
};

const checkSkillUpdatesTool: ToolDefinition = {
  name: 'skill_check_updates',
  workflowUsable: true,
  description:
    'Check for available updates to installed skills. ' +
    'Returns a list of skills that have newer versions available.',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'Skills',
};

// =============================================================================
// Skill Introspection Tools (for Agentskills.io format)
// =============================================================================

const parseSkillContentTool: ToolDefinition = {
  name: 'skill_parse_content',
  workflowUsable: true,
  description:
    'Parse the SKILL.md content of an installed Agentskills.io format skill. ' +
    'Returns the YAML frontmatter (metadata, license, compatibility, allowed-tools) ' +
    'and the markdown body (instructions). Use this to learn how a skill works ' +
    'and adapt its techniques for your own use. Works for both npm-installed and locally uploaded skills.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'Skill/extension ID or name',
      },
    },
    required: ['skillId'],
  },
  category: 'Skills',
};

const readSkillReferenceTool: ToolDefinition = {
  name: 'skill_read_reference',
  workflowUsable: true,
  description:
    "Read a reference file from an installed skill's references/ directory. " +
    'References contain documentation, examples, and knowledge that the skill uses. ' +
    "Use this to learn from the skill's knowledge base.",
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'Skill/extension ID or name',
      },
      referencePath: {
        type: 'string',
        description:
          'Path to reference file (e.g., "references/api-docs.md", "references/examples.json")',
      },
    },
    required: ['skillId', 'referencePath'],
  },
  category: 'Skills',
};

const readSkillScriptTool: ToolDefinition = {
  name: 'skill_read_script',
  workflowUsable: true,
  description:
    "Read a script file from an installed skill's scripts/ directory. " +
    "Scripts contain executable code that implements the skill's functionality. " +
    'Use this to study how the skill implements its capabilities.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'Skill/extension ID or name',
      },
      scriptPath: {
        type: 'string',
        description: 'Path to script file (e.g., "scripts/main.js", "scripts/utils.py")',
      },
    },
    required: ['skillId', 'scriptPath'],
  },
  category: 'Skills',
};

const listSkillResourcesTool: ToolDefinition = {
  name: 'skill_list_resources',
  workflowUsable: true,
  description:
    'List all resources (scripts, references, assets) available in an installed skill. ' +
    'Returns file listings for each subdirectory. Use this to discover what ' +
    'resources are available before reading specific files.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'Skill/extension ID or name',
      },
    },
    required: ['skillId'],
  },
  category: 'Skills',
};

// =============================================================================
// Skill Usage & Learning Tracking Tools
// =============================================================================

const recordSkillUsageTool: ToolDefinition = {
  name: 'skill_record_usage',
  workflowUsable: true,
  description:
    'Record that you have used or learned from a skill. ' +
    'Use this to track: (1) "learned" - you studied the skill and understood how it works, ' +
    '(2) "referenced" - you used the skill\'s documentation or code as reference, ' +
    '(3) "adapted" - you modified the skill\'s techniques for your own use. ' +
    'This builds your personal skill learning history.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'Skill/extension ID or name',
      },
      usageType: {
        type: 'string',
        enum: ['learned', 'referenced', 'adapted'],
        description:
          'Type of usage: learned (studied), referenced (used as reference), adapted (modified for own use)',
      },
      notes: {
        type: 'string',
        description: 'Optional notes about what you learned or how you used the skill',
      },
    },
    required: ['skillId', 'usageType'],
  },
  category: 'Skills',
};

const getSkillLearningStatsTool: ToolDefinition = {
  name: 'skill_get_learning_stats',
  workflowUsable: true,
  description:
    'Get statistics about skills you have learned from or used. ' +
    'Returns counts by usage type, most used skills, and recent learning activity. ' +
    'Use this to reflect on your skill development and identify learning patterns.',
  parameters: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'Optional: filter by specific skill ID',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of recent entries to return (default: 20)',
        default: 20,
      },
    },
  },
  category: 'Skills',
};

const compareSkillsTool: ToolDefinition = {
  name: 'skill_compare',
  workflowUsable: true,
  description:
    'Compare two skills to understand their differences in approach, tools, and techniques. ' +
    'Use this to analyze different implementations of similar capabilities ' +
    'and decide which approach works best for your needs.',
  parameters: {
    type: 'object',
    properties: {
      skillId1: {
        type: 'string',
        description: 'First skill ID or name',
      },
      skillId2: {
        type: 'string',
        description: 'Second skill ID or name',
      },
    },
    required: ['skillId1', 'skillId2'],
  },
  category: 'Skills',
};

const suggestSkillsTool: ToolDefinition = {
  name: 'skill_suggest_learning',
  workflowUsable: true,
  description:
    'Get suggestions for skills you should learn based on your mission, goals, and current tool usage. ' +
    'Analyzes your installed skills and identifies gaps or complementary skills ' +
    'that would enhance your capabilities.',
  parameters: {
    type: 'object',
    properties: {
      mission: {
        type: 'string',
        description: 'Your current mission or primary task area',
      },
    },
  },
  category: 'Skills',
};

export const SKILL_TOOLS: ToolDefinition[] = [
  searchSkillsTool,
  installSkillTool,
  listInstalledSkillsTool,
  getSkillInfoTool,
  toggleSkillTool,
  checkSkillUpdatesTool,
  parseSkillContentTool,
  readSkillReferenceTool,
  readSkillScriptTool,
  listSkillResourcesTool,
  recordSkillUsageTool,
  getSkillLearningStatsTool,
  compareSkillsTool,
  suggestSkillsTool,
];

// =============================================================================
// Executor
// =============================================================================

export async function executeSkillTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  switch (toolName) {
    case 'skill_search': {
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

    case 'skill_install': {
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

    case 'skill_list_installed': {
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

    case 'skill_get_info': {
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

    case 'skill_toggle': {
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

    case 'skill_check_updates': {
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

    case 'skill_parse_content': {
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

        // For agentskills format: instructions are already parsed in the manifest
        const fmt = pkg.manifest.format ?? 'ownpilot';
        if (fmt === 'agentskills') {
          const inMemoryInstructions = pkg.manifest.system_prompt || pkg.manifest.instructions;
          if (inMemoryInstructions) {
            return {
              success: true,
              result: {
                id: pkg.id,
                name: pkg.name,
                format: 'agentskills',
                frontmatter: {
                  name: pkg.name,
                  version: pkg.version,
                  description: pkg.description,
                  category: pkg.category,
                },
                instructions: inMemoryInstructions,
                instructionLength: inMemoryInstructions.length,
                source: 'manifest',
              },
            };
          }
        }

        // Fall back to reading the SKILL.md file from disk
        const skillDir = await resolveSkillDirectory(pkg);
        if (!skillDir) {
          return {
            success: false,
            error: `Cannot locate skill directory for "${pkg.name}". The skill may not have file resources accessible on disk.`,
          };
        }

        const skillMdPath = join(skillDir, 'SKILL.md');
        if (!existsSync(skillMdPath)) {
          return { success: false, error: `SKILL.md not found in skill directory: ${skillDir}` };
        }

        const content = readFileSync(skillMdPath, 'utf-8');
        const { frontmatter, body } = parseSkillMdFrontmatter(content);

        return {
          success: true,
          result: {
            id: pkg.id,
            name: pkg.name,
            format: fmt,
            frontmatter,
            instructions: body,
            instructionLength: body.length,
            source: 'file',
            note: 'Use skill_list_resources to discover scripts and references, then skill_read_reference/skill_read_script to learn from them',
          },
        };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    case 'skill_read_reference': {
      try {
        const skillId = String(args.skillId ?? '');
        const referencePath = String(args.referencePath ?? '');

        if (!skillId) return { success: false, error: 'skillId is required' };
        if (!referencePath) return { success: false, error: 'referencePath is required' };

        const service = getExtensionService();
        const pkg = service.getById(skillId) ?? service.getAll().find((p) => p.name === skillId);
        if (!pkg) return { success: false, error: `Skill not found: ${skillId}` };

        const skillDir = await resolveSkillDirectory(pkg);
        if (!skillDir) {
          return { success: false, error: `Cannot locate skill directory for "${pkg.name}"` };
        }

        const filePath = resolve(skillDir, referencePath);
        if (!filePath.startsWith(resolve(skillDir))) {
          return { success: false, error: 'Invalid reference path: path traversal detected' };
        }
        if (!existsSync(filePath)) {
          return { success: false, error: `Reference file not found: ${referencePath}` };
        }

        const content = readFileSync(filePath, 'utf-8');

        return {
          success: true,
          result: {
            skillId: pkg.id,
            skillName: pkg.name,
            referencePath,
            content,
            contentLength: content.length,
          },
        };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    case 'skill_read_script': {
      try {
        const skillId = String(args.skillId ?? '');
        const scriptPath = String(args.scriptPath ?? '');

        if (!skillId) return { success: false, error: 'skillId is required' };
        if (!scriptPath) return { success: false, error: 'scriptPath is required' };

        const service = getExtensionService();
        const pkg = service.getById(skillId) ?? service.getAll().find((p) => p.name === skillId);
        if (!pkg) return { success: false, error: `Skill not found: ${skillId}` };

        const skillDir = await resolveSkillDirectory(pkg);
        if (!skillDir) {
          return { success: false, error: `Cannot locate skill directory for "${pkg.name}"` };
        }

        const filePath = resolve(skillDir, scriptPath);
        if (!filePath.startsWith(resolve(skillDir))) {
          return { success: false, error: 'Invalid script path: path traversal detected' };
        }
        if (!existsSync(filePath)) {
          return { success: false, error: `Script file not found: ${scriptPath}` };
        }

        const content = readFileSync(filePath, 'utf-8');

        return {
          success: true,
          result: {
            skillId: pkg.id,
            skillName: pkg.name,
            scriptPath,
            content,
            contentLength: content.length,
            note: 'Study this code to understand how the skill implements its functionality',
          },
        };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    case 'skill_list_resources': {
      try {
        const skillId = String(args.skillId ?? '');
        if (!skillId) return { success: false, error: 'skillId is required' };

        const service = getExtensionService();
        const pkg = service.getById(skillId) ?? service.getAll().find((p) => p.name === skillId);
        if (!pkg) return { success: false, error: `Skill not found: ${skillId}` };

        const skillDir = await resolveSkillDirectory(pkg);
        if (!skillDir) {
          return { success: false, error: `Cannot locate skill directory for "${pkg.name}"` };
        }

        const resources = scanSkillDirectory(skillDir);

        return {
          success: true,
          result: {
            id: pkg.id,
            name: pkg.name,
            skillDirectory: skillDir,
            scripts: resources.scriptPaths,
            references: resources.referencePaths,
            assets: resources.assetPaths,
            hasSkillMd: existsSync(join(skillDir, 'SKILL.md')),
            summary: {
              scriptCount: resources.scriptPaths.length,
              referenceCount: resources.referencePaths.length,
              assetCount: resources.assetPaths.length,
            },
            note: 'Use skill_parse_content to read SKILL.md, skill_read_script to study code, skill_read_reference to learn from documentation',
          },
        };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    case 'skill_record_usage': {
      try {
        const skillId = String(args.skillId ?? '');
        const usageType = String(args.usageType ?? '') as 'learned' | 'referenced' | 'adapted';
        const notes = String(args.notes ?? '');

        if (!skillId) return { success: false, error: 'skillId is required' };
        if (!['learned', 'referenced', 'adapted'].includes(usageType)) {
          return {
            success: false,
            error: 'usageType must be one of: learned, referenced, adapted',
          };
        }

        const service = getExtensionService();
        const pkg = service.getById(skillId) ?? service.getAll().find((p) => p.name === skillId);
        if (!pkg) return { success: false, error: `Skill not found: ${skillId}` };

        const adapter = await getAdapter();
        await adapter.execute(
          `INSERT INTO skill_usage (agent_id, skill_id, skill_name, usage_type, content, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            pkg.id,
            pkg.name,
            usageType,
            notes || null,
            JSON.stringify({ timestamp: new Date().toISOString() }),
          ]
        );

        return {
          success: true,
          result: {
            message: `Recorded ${usageType} usage of skill "${pkg.name}"`,
            skillId: pkg.id,
            skillName: pkg.name,
            usageType,
            notes: notes || undefined,
          },
        };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    case 'skill_get_learning_stats': {
      try {
        const skillId = args.skillId as string | undefined;
        const limit = Math.min(parseInt(String(args.limit ?? '20'), 10), 100);

        const adapter = await getAdapter();

        const typeCountsRows = skillId
          ? await adapter.query<{ usage_type: string; count: string }>(
              `SELECT usage_type, COUNT(*) as count FROM skill_usage WHERE agent_id = $1 AND skill_id = $2 GROUP BY usage_type`,
              [userId, skillId]
            )
          : await adapter.query<{ usage_type: string; count: string }>(
              `SELECT usage_type, COUNT(*) as count FROM skill_usage WHERE agent_id = $1 GROUP BY usage_type`,
              [userId]
            );

        const topSkillsRows = await adapter.query<{
          skill_id: string;
          skill_name: string;
          total_uses: string;
          learned_count: string;
          referenced_count: string;
          adapted_count: string;
        }>(
          `SELECT skill_id, skill_name, COUNT(*) as total_uses,
                  COUNT(*) FILTER (WHERE usage_type = 'learned') as learned_count,
                  COUNT(*) FILTER (WHERE usage_type = 'referenced') as referenced_count,
                  COUNT(*) FILTER (WHERE usage_type = 'adapted') as adapted_count
           FROM skill_usage
           WHERE agent_id = $1
           GROUP BY skill_id, skill_name
           ORDER BY total_uses DESC
           LIMIT 10`,
          [userId]
        );

        const recentRows = skillId
          ? await adapter.query<Record<string, unknown>>(
              `SELECT * FROM skill_usage WHERE agent_id = $1 AND skill_id = $2 ORDER BY created_at DESC LIMIT $3`,
              [userId, skillId, limit]
            )
          : await adapter.query<Record<string, unknown>>(
              `SELECT * FROM skill_usage WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`,
              [userId, limit]
            );

        return {
          success: true,
          result: {
            summary: {
              totalUsage: typeCountsRows.reduce((sum, r) => sum + parseInt(r.count), 0),
              learned: parseInt(
                typeCountsRows.find((r) => r.usage_type === 'learned')?.count ?? '0'
              ),
              referenced: parseInt(
                typeCountsRows.find((r) => r.usage_type === 'referenced')?.count ?? '0'
              ),
              adapted: parseInt(
                typeCountsRows.find((r) => r.usage_type === 'adapted')?.count ?? '0'
              ),
            },
            topSkills: topSkillsRows.map((s) => ({
              skillId: s.skill_id,
              skillName: s.skill_name,
              totalUses: parseInt(s.total_uses),
              learned: parseInt(s.learned_count),
              referenced: parseInt(s.referenced_count),
              adapted: parseInt(s.adapted_count),
            })),
            recentActivity: recentRows.map((r) => ({
              id: String(r.id),
              skillId: String(r.skill_id),
              skillName: String(r.skill_name),
              usageType: String(r.usage_type),
              notes: r.content ? String(r.content) : undefined,
              createdAt: r.created_at ? String(r.created_at) : undefined,
            })),
          },
        };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    case 'skill_compare': {
      try {
        const skillId1 = String(args.skillId1 ?? '');
        const skillId2 = String(args.skillId2 ?? '');

        if (!skillId1 || !skillId2) {
          return { success: false, error: 'Both skillId1 and skillId2 are required' };
        }

        const service = getExtensionService();
        const pkg1 = service.getById(skillId1) ?? service.getAll().find((p) => p.name === skillId1);
        const pkg2 = service.getById(skillId2) ?? service.getAll().find((p) => p.name === skillId2);

        if (!pkg1) return { success: false, error: `Skill not found: ${skillId1}` };
        if (!pkg2) return { success: false, error: `Skill not found: ${skillId2}` };

        const tools1 = pkg1.manifest.tools.map((t) => t.name).sort();
        const tools2 = pkg2.manifest.tools.map((t) => t.name).sort();
        const commonTools = tools1.filter((t) => tools2.includes(t));
        const uniqueToSkill1 = tools1.filter((t) => !tools2.includes(t));
        const uniqueToSkill2 = tools2.filter((t) => !tools1.includes(t));

        const category1 = pkg1.category ?? 'uncategorized';
        const category2 = pkg2.category ?? 'uncategorized';

        const adapter = await getAdapter();
        const usageRow1 = await adapter.queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM skill_usage WHERE agent_id = $1 AND skill_id = $2`,
          [userId, pkg1.id]
        );
        const usageRow2 = await adapter.queryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM skill_usage WHERE agent_id = $1 AND skill_id = $2`,
          [userId, pkg2.id]
        );

        return {
          success: true,
          result: {
            skill1: {
              id: pkg1.id,
              name: pkg1.name,
              description: pkg1.description,
              format: pkg1.manifest.format ?? 'ownpilot',
              category: category1,
              toolCount: tools1.length,
              version: pkg1.version,
              yourUsageCount: parseInt(usageRow1?.count ?? '0'),
            },
            skill2: {
              id: pkg2.id,
              name: pkg2.name,
              description: pkg2.description,
              format: pkg2.manifest.format ?? 'ownpilot',
              category: category2,
              toolCount: tools2.length,
              version: pkg2.version,
              yourUsageCount: parseInt(usageRow2?.count ?? '0'),
            },
            comparison: {
              sameCategory: category1 === category2,
              category: category1 === category2 ? category1 : `${category1} vs ${category2}`,
              commonTools,
              uniqueToSkill1,
              uniqueToSkill2,
              toolSimilarity:
                tools1.length > 0 || tools2.length > 0
                  ? Math.round((commonTools.length / Math.max(tools1.length, tools2.length)) * 100)
                  : 0,
            },
            recommendation:
              commonTools.length > 0
                ? `These skills share ${commonTools.length} tools. Skill 1 has ${uniqueToSkill1.length} unique tools, Skill 2 has ${uniqueToSkill2.length} unique tools.`
                : 'These skills have different tool sets and may serve different purposes.',
          },
        };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    case 'skill_suggest_learning': {
      try {
        const mission = String(args.mission ?? '');

        const service = getExtensionService();
        const allSkills = service.getAll();

        const adapter = await getAdapter();
        const learnedRows = await adapter.query<{ skill_id: string }>(
          `SELECT DISTINCT skill_id FROM skill_usage WHERE agent_id = $1 AND usage_type = 'learned'`,
          [userId]
        );
        const learnedSkillIds = new Set(learnedRows.map((s) => s.skill_id));

        const missionKeywords = mission.toLowerCase().split(/\s+/).filter(Boolean);
        const keywordCategories: Record<string, string[]> = {
          data: ['data-analysis', 'database', 'csv', 'json', 'api'],
          web: ['web-scraping', 'browser', 'http', 'api'],
          search: ['search', 'web-search', 'google', 'bing'],
          email: ['email', 'gmail', 'smtp', 'imap'],
          file: ['file-system', 'storage', 's3', 'dropbox'],
          code: ['coding', 'developer', 'git', 'github', 'programming'],
          ai: ['ai', 'llm', 'openai', 'anthropic', 'claude'],
          communication: ['slack', 'discord', 'telegram', 'messaging'],
        };

        const scoredSkills = allSkills.map((skill) => {
          let score = 0;
          const skillName = skill.name.toLowerCase();
          const skillDesc = (skill.description ?? '').toLowerCase();
          const category = (skill.category ?? '').toLowerCase();
          const isLearned = learnedSkillIds.has(skill.id);

          if (isLearned) score -= 10;

          for (const [keyword, categories] of Object.entries(keywordCategories)) {
            if (missionKeywords.some((m) => m.includes(keyword))) {
              if (categories.some((c) => category.includes(c) || skillName.includes(c))) score += 5;
              if (categories.some((c) => skillDesc.includes(c))) score += 3;
            }
          }
          for (const keyword of missionKeywords) {
            if (skillName.includes(keyword)) score += 4;
            if (skillDesc.includes(keyword)) score += 2;
          }
          score += (skill.toolCount ?? 0) * 0.5;

          return { skill, score, isLearned };
        });

        const suggestions = scoredSkills
          .filter((s) => s.score > 0 || !s.isLearned)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        return {
          success: true,
          result: {
            mission: mission || undefined,
            totalInstalled: allSkills.length,
            learnedCount: learnedSkillIds.size,
            suggestions: suggestions.map((s) => ({
              skillId: s.skill.id,
              name: s.skill.name,
              description: s.skill.description,
              format: s.skill.manifest.format ?? 'ownpilot',
              category: s.skill.category,
              toolCount: s.skill.toolCount,
              isLearned: s.isLearned,
              relevanceScore: Math.round(s.score),
              reason: s.isLearned
                ? 'Already learned — revisit to deepen knowledge'
                : s.score > 5
                  ? 'Highly relevant to your mission'
                  : s.score > 0
                    ? 'May be useful for your tasks'
                    : 'Available to explore',
            })),
            note:
              suggestions.length === 0
                ? 'No specific matches found. Use skill_list_installed to browse all available skills.'
                : `Found ${suggestions.filter((s) => !s.isLearned).length} new skills to learn. Use skill_parse_content and skill_read_reference to study them.`,
          },
        };
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
    }

    default:
      return { success: false, error: `Unknown skill tool: ${toolName}` };
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resolve the skill's directory on disk.
 *
 * Priority order:
 * 1. sourcePath from the extension record (works for both uploaded and npm skills)
 * 2. npm package location (for npm-installed skills without sourcePath)
 */
async function resolveSkillDirectory(pkg: {
  sourcePath?: string;
  settings: Record<string, unknown>;
}): Promise<string | null> {
  // Strategy 1: sourcePath (covers uploaded SKILL.md and locally installed skills)
  if (pkg.sourcePath) {
    // sourcePath may point to SKILL.md directly or to the directory
    const dir = pkg.sourcePath.replace(/[/\\]SKILL\.md$/i, '');
    if (existsSync(dir)) return dir;
  }

  // Strategy 2: npm package in node_modules
  const npmPackage = pkg.settings?.npmPackage as string | undefined;
  if (npmPackage) {
    return locateNpmPackageDirectory(npmPackage);
  }

  return null;
}

/**
 * Locate an npm-installed skill's directory in node_modules.
 */
async function locateNpmPackageDirectory(npmPackage: string): Promise<string | null> {
  // Strategy A: relative to gateway package (most reliable in monorepo)
  try {
    const currentFileDir = dirname(fileURLToPath(import.meta.url));
    const gatewayNodeModules = resolve(currentFileDir, '..', '..', '..', 'node_modules');
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
