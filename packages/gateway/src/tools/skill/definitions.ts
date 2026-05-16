/**
 * Skill Tool Definitions
 *
 * 14 AI-callable tools for discovering, installing, introspecting, and
 * tracking learning from skills (AgentSkills.io format and OwnPilot native).
 * Definitions only — executor implementations live alongside in
 * `lifecycle-executors.ts`, `introspection-executors.ts`,
 * `learning-executors.ts`.
 */

import type { ToolDefinition } from '@ownpilot/core';

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
