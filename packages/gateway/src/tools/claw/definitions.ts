/**
 * Claw Tool Definitions
 *
 * Pure data: the 16 ToolDefinition entries plus the public CLAW_TOOLS array
 * and CLAW_TOOL_NAMES list. No runtime logic.
 *
 * Extracted from `claw-tools.ts` to keep that file focused on dispatch +
 * implementation. If you add or rename a tool here, update the dispatcher
 * in `claw-tools.ts` as well.
 */

import type { ToolDefinition } from '@ownpilot/core';

const clawInstallPackageDef: ToolDefinition = {
  name: 'claw_install_package',
  description: `Install a package into your workspace using npm, pip, or pnpm.
The package will be available for subsequent script executions.
Package names are validated to prevent command injection.`,
  parameters: {
    type: 'object',
    properties: {
      package_name: {
        type: 'string',
        description: 'Package name (e.g., "lodash", "requests", "d3")',
      },
      manager: {
        type: 'string',
        enum: ['npm', 'pip', 'pnpm'],
        description: 'Package manager to use (default: npm)',
      },
    },
    required: ['package_name'],
  },
  category: 'Claw',
  tags: ['claw', 'package', 'install', 'npm', 'pip'],
};

const clawRunScriptDef: ToolDefinition = {
  name: 'claw_run_script',
  description: `Write and execute a script in your workspace.
The script is saved to workspace/scripts/ and executed via Docker sandbox (preferred) or local process.
Returns stdout, stderr, and exit code.
Use this for data processing, web scraping, file generation, or any computational task.`,
  parameters: {
    type: 'object',
    properties: {
      script: {
        type: 'string',
        description: 'The script source code to execute',
      },
      language: {
        type: 'string',
        enum: ['python', 'javascript', 'shell'],
        description: 'Script language (default: javascript)',
      },
      timeout_ms: {
        type: 'number',
        description: 'Execution timeout in milliseconds (default: 30000, max: 120000)',
      },
    },
    required: ['script'],
  },
  category: 'Claw',
  tags: ['claw', 'script', 'execute', 'code', 'run'],
};

const clawCreateToolDef: ToolDefinition = {
  name: 'claw_create_tool',
  description: `Create an ephemeral tool from generated code and immediately execute it.
The tool is compiled and run in the sandbox. The result is returned inline so you can use it right away.
Use this to create single-use tools for specific tasks (e.g., a CSV parser, a data transformer, a calculator).
The tool code must export a default function that receives the args object.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Tool name (lowercase, underscores, e.g., "parse_csv")',
      },
      description: {
        type: 'string',
        description: 'What the tool does — this is shown to the LLM',
      },
      parameters: {
        type: 'object',
        description: 'JSON Schema for the tool parameters',
      },
      code: {
        type: 'string',
        description:
          'JavaScript code that implements the tool. Receives `args` object. Must return a result string or object.',
      },
    },
    required: ['name', 'description', 'code'],
  },
  category: 'Claw',
  tags: ['claw', 'tool', 'create', 'ephemeral', 'forge'],
};

const clawSpawnSubclawDef: ToolDefinition = {
  name: 'claw_spawn_subclaw',
  description: `Spawn a child Claw agent to handle a subtask.
The subclaw inherits your workspace and user context.
For single-shot mode, the result is returned inline after completion.
Maximum nesting depth: 3 levels.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Short name for the subtask (e.g., "Analyze dataset")',
      },
      mission: {
        type: 'string',
        description: 'Detailed mission for the subclaw — what it should accomplish',
      },
      mode: {
        type: 'string',
        enum: ['continuous', 'interval', 'event', 'single-shot'],
        description: 'Execution mode (default: single-shot)',
      },
      provider: {
        type: 'string',
        description:
          'AI provider for the subclaw (e.g., "openai", "anthropic"). Inherits from parent if not specified.',
      },
      model: {
        type: 'string',
        description:
          'AI model for the subclaw (e.g., "gpt-4o"). Inherits from parent if not specified.',
      },
    },
    required: ['name', 'mission'],
  },
  category: 'Claw',
  tags: ['claw', 'spawn', 'subclaw', 'delegate', 'child'],
};

const clawPublishArtifactDef: ToolDefinition = {
  name: 'claw_publish_artifact',
  description: `Publish an output as a persistent artifact visible in the UI.
Use this to share results: HTML reports, SVG charts, markdown documents.
Artifacts are stored in the database and accessible via the artifacts UI.`,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Artifact title (e.g., "Market Research Report")',
      },
      content: {
        type: 'string',
        description: 'Artifact content (HTML, SVG, markdown, etc.)',
      },
      type: {
        type: 'string',
        enum: ['html', 'svg', 'markdown', 'chart', 'form', 'react'],
        description: 'Artifact content type (default: markdown)',
      },
    },
    required: ['title', 'content'],
  },
  category: 'Claw',
  tags: ['claw', 'artifact', 'publish', 'output', 'report'],
};

const clawRequestEscalationDef: ToolDefinition = {
  name: 'claw_request_escalation',
  description: `Request an environment upgrade or permission grant.
This pauses your execution until a human approves or denies the request.
Use sparingly — only when you genuinely need elevated capabilities.

Valid escalation types:
- sandbox_upgrade: Switch from local to Docker, or Docker to host
- network_access: Request network access for sandbox
- budget_increase: Request higher budget
- permission_grant: Request access to blocked tools`,
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['sandbox_upgrade', 'network_access', 'budget_increase', 'permission_grant'],
        description: 'Type of escalation',
      },
      reason: {
        type: 'string',
        description: 'Why you need this escalation — be specific',
      },
      details: {
        type: 'object',
        description: 'Additional details (e.g., which tools, how much budget)',
      },
    },
    required: ['type', 'reason'],
  },
  category: 'Claw',
  tags: ['claw', 'escalation', 'permission', 'upgrade'],
};

const clawSendOutputDef: ToolDefinition = {
  name: 'claw_send_output',
  description: `Send a message/result to the user via all available channels (Telegram, WebSocket notification).
Use this whenever you produce meaningful results the user should see immediately.
Don't wait until the mission is complete — send incremental updates.`,
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message to send (markdown supported for Telegram)',
      },
      urgency: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Urgency level (default: medium)',
      },
    },
    required: ['message'],
  },
  category: 'Claw',
  tags: ['claw', 'output', 'send', 'notify', 'telegram', 'message'],
};

const clawCompleteReportDef: ToolDefinition = {
  name: 'claw_complete_report',
  description: `Send a comprehensive final report when your mission is complete or a major milestone is reached.
This does 3 things:
1. Publishes the report as a persistent artifact (visible in Artifacts UI)
2. Sends a summary notification to the user via Telegram/channels
3. Stores the report in conversation history for future reference

Use this instead of just saying "MISSION_COMPLETE" — give the user a proper deliverable.`,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Report title (e.g., "Market Research: AI Agents Q1 2026")',
      },
      report: {
        type: 'string',
        description: 'Full report content in markdown format',
      },
      summary: {
        type: 'string',
        description: 'Brief 2-3 sentence summary for notification (max 500 chars)',
      },
    },
    required: ['title', 'report', 'summary'],
  },
  category: 'Claw',
  tags: ['claw', 'report', 'complete', 'deliverable', 'final'],
};

const clawSetContextDef: ToolDefinition = {
  name: 'claw_set_context',
  description: `Persist structured data in your Working Memory that will be injected into every future cycle.
Use this to remember important state across cycles — progress counters, configuration, interim results, flags.
Pass key-value pairs to merge into context. Pass null to remove a key.
Complement .claw/MEMORY.md for structured data that needs to be machine-readable.`,
  parameters: {
    type: 'object',
    properties: {
      updates: {
        type: 'object',
        description:
          'Key-value pairs to merge into context. Set a value to null to delete that key.',
      },
    },
    required: ['updates'],
  },
  category: 'Claw',
  tags: ['claw', 'context', 'memory', 'persist', 'working-memory'],
};

const clawGetContextDef: ToolDefinition = {
  name: 'claw_get_context',
  description: `Read your full Working Memory (persistentContext). Returns all keys and values currently stored.
Your Working Memory is also injected into every cycle message, but use this tool to read a fresh snapshot mid-cycle.`,
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'Claw',
  tags: ['claw', 'context', 'memory', 'read', 'working-memory'],
};

const clawEmitEventDef: ToolDefinition = {
  name: 'claw_emit_event',
  description: `Emit a custom event to the OwnPilot EventBus.
This can trigger other claws (in event mode), fire triggers, start workflows, or notify other systems.
Use this to coordinate with other parts of the system.

Examples:
- Emit "research.complete" to trigger a reporting claw
- Emit "data.updated" to trigger a dashboard refresh
- Emit "alert.critical" to trigger notification workflows`,
  parameters: {
    type: 'object',
    properties: {
      event_type: {
        type: 'string',
        description: 'Event type name (e.g., "research.complete", "data.updated")',
      },
      payload: {
        type: 'object',
        description: 'Event payload data (any JSON object)',
      },
    },
    required: ['event_type'],
  },
  category: 'Claw',
  tags: ['claw', 'event', 'emit', 'trigger', 'eventbus'],
};

const clawUpdateConfigDef: ToolDefinition = {
  name: 'claw_update_config',
  description: `Update your own configuration while running. You can change your mission, mode, limits, sandbox, and more.
Use this to adapt your behavior based on what you learn. For example:
- Switch from continuous to interval mode when you realize periodic checks are better
- Increase your budget if you're running out
- Change your stop condition based on progress
- Update your mission statement as you learn more about the task`,
  parameters: {
    type: 'object',
    properties: {
      mission: { type: 'string', description: 'Updated mission statement' },
      mode: {
        type: 'string',
        enum: ['continuous', 'interval', 'event', 'single-shot'],
        description: 'New execution mode',
      },
      sandbox: {
        type: 'string',
        enum: ['docker', 'local', 'auto'],
        description: 'New sandbox mode',
      },
      interval_ms: { type: 'number', description: 'New interval in ms (for interval mode)' },
      stop_condition: { type: 'string', description: 'New stop condition (e.g., max_cycles:200)' },
      auto_start: { type: 'boolean', description: 'Auto-start on server boot' },
    },
  },
  category: 'Claw',
  tags: ['claw', 'config', 'update', 'self', 'adapt', 'modify'],
};

const clawSendAgentMessageDef: ToolDefinition = {
  name: 'claw_send_agent_message',
  description: `Send a direct message to another claw or agent. Use this to coordinate with other claws, share findings, delegate work, or request information.
The message is delivered to the target's inbox and will be read on their next cycle.`,
  parameters: {
    type: 'object',
    properties: {
      target_claw_id: { type: 'string', description: 'ID of the target claw to message' },
      subject: {
        type: 'string',
        description: 'Message subject (e.g., "Research results", "Task delegation")',
      },
      content: { type: 'string', description: 'Message content' },
      message_type: {
        type: 'string',
        enum: ['task', 'result', 'knowledge', 'coordination'],
        description: 'Message type (default: coordination)',
      },
    },
    required: ['target_claw_id', 'subject', 'content'],
  },
  category: 'Claw',
  tags: ['claw', 'message', 'send', 'communicate', 'coordinate', 'agent'],
};

const clawReflectDef: ToolDefinition = {
  name: 'claw_reflect',
  description: `Evaluate your own performance and decide whether to continue, adjust strategy, or complete the mission.
Reads your .claw/LOG.md and .claw/TASKS.md to assess progress.
Returns a structured self-assessment that helps you decide next actions.

Use this periodically (e.g., every 5-10 cycles) to avoid going in circles.`,
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'What to reflect on (e.g., "Am I making progress?", "Should I change strategy?")',
      },
    },
    required: ['question'],
  },
  category: 'Claw',
  tags: ['claw', 'reflect', 'evaluate', 'introspect', 'performance', 'strategy'],
};

const clawListSubclawsDef: ToolDefinition = {
  name: 'claw_list_subclaws',
  description: 'List all sub-claws spawned by this claw with their current status.',
  parameters: { type: 'object', properties: {} },
  category: 'Claw',
  tags: ['claw', 'subclaw', 'list', 'children'],
};

const clawStopSubclawDef: ToolDefinition = {
  name: 'claw_stop_subclaw',
  description: 'Stop a running sub-claw that was spawned by this claw.',
  parameters: {
    type: 'object',
    properties: {
      subclaw_id: { type: 'string', description: 'ID of the sub-claw to stop' },
    },
    required: ['subclaw_id'],
  },
  category: 'Claw',
  tags: ['claw', 'subclaw', 'stop', 'terminate'],
};

export const CLAW_TOOLS: ToolDefinition[] = [
  clawInstallPackageDef,
  clawRunScriptDef,
  clawCreateToolDef,
  clawSpawnSubclawDef,
  clawPublishArtifactDef,
  clawRequestEscalationDef,
  clawSendOutputDef,
  clawCompleteReportDef,
  clawEmitEventDef,
  clawUpdateConfigDef,
  clawSendAgentMessageDef,
  clawReflectDef,
  clawListSubclawsDef,
  clawStopSubclawDef,
  clawSetContextDef,
  clawGetContextDef,
];

export const CLAW_TOOL_NAMES = CLAW_TOOLS.map((t) => t.name);
