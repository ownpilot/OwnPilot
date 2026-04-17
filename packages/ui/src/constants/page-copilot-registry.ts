/**
 * Page Copilot Registry — maps route section IDs to copilot context configs.
 *
 * Each entry defines:
 *   - pageType: logical page identifier
 *   - resolveContext: async fn that fetches entity-specific data (path, definition, metadata)
 *   - suggestions: canned prompt suggestions shown in the copilot panel
 *   - preferBridge: true for path-based pages where bridge copilot has file-system access
 *   - systemPromptHint: optional extra context injected into the system prompt
 *
 * Adding a new section:
 * 1. Add entry here keyed by the route segment (e.g. 'my-page' for /my-page)
 * 2. For settings sub-pages use the sub-segment (e.g. 'mcp-servers' for /settings/mcp-servers)
 */

import {
  fileWorkspacesApi,
  workflowsApi,
  agentsApi,
  clawsApi,
  codingAgentsApi,
  customToolsApi,
  extensionsApi,
} from '../api';
import type { PageCopilotConfig } from '../types/page-copilot';

export const PAGE_COPILOT_REGISTRY: Record<string, PageCopilotConfig> = {
  // ─── PATH-BASED pages (preferBridge: true) ───────────────────────────────

  workspaces: {
    pageType: 'workspace',
    preferBridge: true,
    suggestions: [
      'What files are in this workspace?',
      'Show me recent changes in this workspace',
      'Help me set up a development environment here',
      'List all running processes in this workspace',
    ],
    resolveContext: async ({ id }) => {
      if (!id) return {};
      try {
        const res = await fileWorkspacesApi.list();
        const ws = (res.workspaces ?? []).find((w) => w.id === id);
        if (!ws) return {};
        return {
          path: ws.path,
          metadata: { id: ws.id, name: ws.name },
        };
      } catch {
        return {};
      }
    },
  },

  'coding-agents': {
    pageType: 'coding-agent',
    preferBridge: true,
    suggestions: [
      'What is the current task for this coding agent?',
      'Show me the recent git commits in this session',
      'Help me debug the latest error from this agent',
    ],
    resolveContext: async ({ id }) => {
      if (!id) return {};
      try {
        const session = await codingAgentsApi.getSession(id);
        return {
          path: session.cwd,
          metadata: {
            id: session.id,
            displayName: session.displayName,
            provider: session.provider,
          },
        };
      } catch {
        return {};
      }
    },
  },

  claws: {
    pageType: 'claw',
    preferBridge: true,
    suggestions: [
      'What is this claw currently working on?',
      'Show me the recent history for this claw',
      'Help me configure stop conditions for this claw',
      'What tools does this claw have access to?',
    ],
    resolveContext: async ({ id }) => {
      if (!id) return {};
      try {
        const claw = await clawsApi.get(id);
        return {
          path: claw.workspaceId,
          metadata: {
            id: claw.id,
            name: claw.name,
            mode: claw.mode,
            state: claw.session?.state,
            mission: claw.mission,
          },
        };
      } catch {
        return {};
      }
    },
  },

  // ─── NO-PATH pages ────────────────────────────────────────────────────────

  workflows: {
    pageType: 'workflow',
    preferBridge: false,
    systemPromptHint:
      'You are helping edit and understand an automation workflow. The workflow is defined as a directed acyclic graph of nodes. Use the workflow definition in context to answer questions about its structure and logic.',
    suggestions: [
      'Explain what this workflow does',
      'How can I add error handling to this workflow?',
      'Suggest optimizations for this workflow',
      'Help me add a new node to this workflow',
    ],
    resolveContext: async ({ id }) => {
      if (!id) return {};
      try {
        const workflow = await workflowsApi.get(id);
        return {
          definition: workflow,
          metadata: { id: workflow.id, name: workflow.name, status: workflow.status },
        };
      } catch {
        return {};
      }
    },
  },

  agents: {
    pageType: 'agent',
    suggestions: [
      'What tools does this agent have access to?',
      'How can I improve this agent\'s system prompt?',
      'What tasks is this agent best suited for?',
      'Help me configure this agent for a new use case',
    ],
    resolveContext: async ({ id }) => {
      if (!id) return {};
      try {
        const agent = await agentsApi.get(id);
        return {
          metadata: { config: agent },
        };
      } catch {
        return {};
      }
    },
  },

  tools: {
    pageType: 'tool',
    suggestions: [
      'What tools are available and what do they do?',
      'Which tools are best for web scraping?',
      'Help me understand how to use the file system tools',
    ],
  },

  'custom-tools': {
    pageType: 'custom-tool',
    suggestions: [
      'Explain what this custom tool does',
      'Help me improve the code for this tool',
      'How can I add error handling to this tool?',
      'Suggest test cases for this custom tool',
    ],
    resolveContext: async ({ id }) => {
      if (!id) return {};
      try {
        const res = await customToolsApi.list();
        const tool = (res.tools ?? []).find((t) => t.id === id);
        if (!tool) return {};
        return {
          metadata: { code: tool.code, type: tool.createdBy, category: tool.category },
        };
      } catch {
        return {};
      }
    },
  },

  skills: {
    pageType: 'skill',
    suggestions: [
      'What does this skill do?',
      'How do I use this skill in a conversation?',
      'Show me the system prompt for this skill',
      'Help me extend this skill with new capabilities',
    ],
    resolveContext: async ({ id }) => {
      if (!id) return {};
      try {
        const ext = await extensionsApi.getById(id);
        return {
          metadata: { name: ext.name, format: ext.manifest?.format },
        };
      } catch {
        return {};
      }
    },
  },

  'mcp-servers': {
    pageType: 'mcp-server',
    suggestions: [
      'What MCP servers are currently connected?',
      'Help me configure a new MCP server',
      'How do I troubleshoot a failing MCP connection?',
      'What tools does this MCP server expose?',
    ],
  },

  'edge-devices': {
    pageType: 'edge-device',
    systemPromptHint:
      'You are helping manage IoT/edge devices connected via MQTT broker (Mosquitto). Focus on device status, telemetry data, command sending, and connection diagnostics.',
    suggestions: [
      'What edge devices are currently online?',
      'Help me send a command to a device',
      'Show me the recent telemetry from this device',
    ],
  },

  tasks: {
    pageType: 'task',
    systemPromptHint:
      'You are helping manage personal tasks. Focus on task creation, prioritization, due dates, status tracking, and productivity insights.',
    suggestions: [
      'Help me prioritize my tasks for today',
      'Create a new task from this description',
      'What tasks are overdue?',
    ],
  },

  notes: {
    pageType: 'note',
    systemPromptHint:
      'You are helping manage personal notes. Focus on note organization, search, summarization, and topic-based grouping.',
    suggestions: [
      'Summarize my recent notes',
      'Help me organize my notes by topic',
      'Find notes related to a specific project',
    ],
  },

  goals: {
    pageType: 'goal',
    systemPromptHint:
      'You are helping manage personal goals. Focus on goal setting, progress tracking, milestone breakdown, and risk assessment for at-risk goals.',
    suggestions: [
      'What progress have I made on my goals?',
      'Help me break down this goal into steps',
      'Which goals are at risk of not being completed?',
    ],
  },

  habits: {
    pageType: 'habit',
    systemPromptHint:
      'You are helping manage habit tracking. Focus on streak analysis, consistency metrics, habit routine building, and motivation. OwnPilot has 8 AI habit tools for logging, analysis, and recommendations.',
    suggestions: [
      'Show my habit streak summary',
      'Which habits have I been most consistent with?',
      'Help me build a new habit routine',
    ],
  },

  memories: {
    pageType: 'memory',
    systemPromptHint:
      'You are helping manage AI memories — facts and context the AI remembers about the user. Focus on memory review, cleanup, topic search, and accuracy verification.',
    suggestions: [
      'What do you remember about me?',
      'Find memories related to a specific topic',
      'Help me review and clean up outdated memories',
    ],
  },

  bookmarks: {
    pageType: 'bookmark',
    systemPromptHint:
      'You are helping manage saved bookmarks. Focus on bookmark organization, categorization, search, and curation.',
    suggestions: [
      'Show my most recently saved bookmarks',
      'Help me organize bookmarks into categories',
      'Find bookmarks related to a specific topic',
    ],
  },

  contacts: {
    pageType: 'contact',
    systemPromptHint:
      'You are helping manage personal contacts. Focus on contact search, organization, communication history, and relationship management.',
    suggestions: [
      'Find contacts I haven\'t spoken to recently',
      'Help me draft a message to a contact',
      'Show contacts in a specific organization',
    ],
  },

  channels: {
    pageType: 'channel',
    systemPromptHint:
      'You are helping manage communication channels (WhatsApp, Telegram, etc.). Focus on channel status, message monitoring, configuration, and connection troubleshooting.',
    suggestions: [
      'What channels are currently active?',
      'Help me configure a new notification channel',
      'Show recent messages from this channel',
    ],
  },

  fleet: {
    pageType: 'fleet',
    systemPromptHint:
      'You are helping manage Fleet Command — parallel task execution across multiple worker types (ai-chat, coding-cli, api-call, mcp-bridge, claw). Focus on task status, worker health, dependency cascades, and failure diagnosis.',
    suggestions: [
      'What is the current status of my fleet?',
      'Show failed tasks across all fleet workers',
      'Help me create a new fleet configuration',
    ],
  },

  triggers: {
    pageType: 'trigger',
    systemPromptHint:
      'You are helping manage automation triggers — rules that fire agents or workflows in response to events (schedule, webhook, condition, email). Focus on trigger creation, execution history, and debugging.',
    suggestions: [
      'What triggers are currently active?',
      'Help me create a new automation trigger',
      'Show recent trigger execution history',
    ],
  },

  artifacts: {
    pageType: 'artifact',
    systemPromptHint:
      'You are helping manage AI-generated artifacts — code snippets, documents, images, and other outputs created during conversations. Focus on artifact content, usage in workflows, and organization.',
    suggestions: [
      'What artifacts have been created recently?',
      'Help me understand this artifact\'s content',
      'How can I use this artifact in a workflow?',
    ],
  },

  // ─── MISSING PAGES (added for full coverage) ─────────────────────────────

  autonomous: {
    pageType: 'autonomous',
    systemPromptHint:
      'You are helping the user manage autonomous agents (Souls), crews, and background agent plans. Focus on agent lifecycle, crew collaboration, budget control, and activity monitoring.',
    suggestions: [
      'What autonomous agents are currently running?',
      'Help me create a new agent crew for a task',
      'Show the activity feed and heartbeat status',
      'How do I set budget limits for an autonomous agent?',
    ],
  },

  'cli-tools': {
    pageType: 'cli-tool',
    systemPromptHint:
      'You are helping the user manage CLI tool discovery, installation, and security policies. Focus on tool categories, risk levels, and execution policies (allowed/prompt/blocked).',
    suggestions: [
      'What CLI tools are available and installed?',
      'Help me set security policies for high-risk tools',
      'How do I register a custom CLI tool?',
      'Show tools by category (linters, formatters, build)',
    ],
  },

  'tool-groups': {
    pageType: 'tool-group',
    systemPromptHint:
      'You are helping the user organize tools into logical groups for agent assignment. Focus on enabling/disabling groups, understanding tool counts, and managing access control.',
    suggestions: [
      'Which tool groups are currently enabled?',
      'Help me understand what each tool group contains',
      'How do I create a minimal tool set for a specific agent?',
      'What tools are in the "always enabled" system groups?',
    ],
  },

  'workflow-tools': {
    pageType: 'workflow-tool',
    systemPromptHint:
      'You are helping the user control which custom tools and MCP server tools are available inside workflows. Focus on the workflowUsable toggle, active workflow dependencies, and MCP tool discovery.',
    suggestions: [
      'Which tools are enabled for use in workflows?',
      'Help me understand which workflows depend on this tool',
      'How do I enable an MCP server tool for workflow use?',
      'Show tools that are used in active workflows',
    ],
  },
};
