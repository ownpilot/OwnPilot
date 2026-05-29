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
  description: `Update your own configuration while running. You can change your mission, mode, limits, sandbox, priority, and more.
Use this to adapt your behavior based on what you learn. For example:
- Switch from continuous to interval mode when you realize periodic checks are better
- Increase your budget if you're running out
- Change your stop condition based on progress
- Update your mission statement as you learn more about the task
- Adjust priority (1=highest, 3=normal, 5=lowest) based on urgency`,
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
      priority: {
        type: 'number',
        enum: [1, 2, 3, 4, 5],
        description:
          'Scheduling priority: 1=highest (fastest), 3=normal, 5=lowest. Higher priority claws get shorter cycle delays.',
      },
    },
  },
  category: 'Claw',
  tags: ['claw', 'config', 'update', 'self', 'adapt', 'modify', 'priority'],
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

const clawPlanDef: ToolDefinition = {
  name: 'claw_plan',
  description: `Set or replace the structured task plan for your mission.
Use this at the start of work and whenever the plan changes substantially —
do NOT call it every cycle just to mark progress (use claw_update_task for that).
The plan is rendered into every cycle prompt so you always see current state.
Each task needs a stable id ("t1", "t2", …) so updates target the right row.

FOCUS DISCIPLINE: at most one task may have status="in_progress" at a time.
Set the rest to "pending" or "blocked"; you can only work on one thing.

Capped at 50 tasks per claw.`,
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'Ordered list of tasks that make up the plan.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable id, e.g. "t1"' },
            title: { type: 'string', description: 'Short imperative description' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'blocked'],
              description: 'Initial status — usually "pending" for new tasks',
            },
            notes: { type: 'string', description: 'Optional context, blockers, sub-steps' },
            successCriteria: {
              type: 'string',
              description:
                'Concrete, falsifiable bar for "done" (e.g. "tests pass", "endpoint returns 200 with field X"). Commit to this BEFORE working.',
            },
          },
          required: ['id', 'title'],
        },
      },
    },
    required: ['tasks'],
  },
  category: 'Claw',
  tags: ['claw', 'plan', 'tasks', 'todo', 'organize', 'roadmap'],
};

const clawUpdateTaskDef: ToolDefinition = {
  name: 'claw_update_task',
  description: `Update a single task's status or notes without rewriting the whole plan.
Use this in the cycle that completes/blocks/starts a task so the prompt-rendered
plan stays current. If the id does not exist, the call returns an error.

FOCUS DISCIPLINE: starting a task (status="in_progress") fails if another task
is already in_progress. Mark the current one completed or blocked first.`,
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Existing task id to update' },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'blocked'],
        description: 'New status (optional)',
      },
      notes: { type: 'string', description: 'New notes — replaces any existing notes' },
      evidence: {
        type: 'string',
        description:
          'Required when marking completed: short record of what changed and how you know the successCriteria was met (e.g. "test suite green: 412/412", "POST /x returns 201 with id field"). Omitting yields a soft warning.',
      },
    },
    required: ['id'],
  },
  category: 'Claw',
  tags: ['claw', 'task', 'update', 'progress', 'mark', 'plan'],
};

const clawListTasksDef: ToolDefinition = {
  name: 'claw_list_tasks',
  description: `Return the current structured task plan. Useful as a confirmation
read after edits or when you need the raw list before deciding the next move.`,
  parameters: { type: 'object', properties: {} },
  category: 'Claw',
  tags: ['claw', 'tasks', 'list', 'plan', 'read'],
};

const clawSplitTaskDef: ToolDefinition = {
  name: 'claw_split_task',
  description: `Atomically split a stalled or too-big task into smaller subtasks.

Use this when a task is too coarse to make progress on — typically after the
runner has shown a STALL warning ("you've been on t3 for 6 cycles"). Instead
of rewriting the whole plan with claw_plan, this:

1. Marks the parent task "blocked" with auto-evidence "Split into: t3.1, t3.2, ..."
2. Inserts the new subtasks as t<parentId>.<N>, immediately after the parent
3. Validates atomically — if any subtask is invalid, the plan is untouched

If the parent was the focus task, you'll need to call claw_update_task with
status="in_progress" on the subtask you want to work on next (focus discipline
still applies — only one task may be in_progress at a time).`,
  parameters: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Existing task id to split (e.g., "t3")',
      },
      subtasks: {
        type: 'array',
        description: 'Ordered list of subtasks (2-10 recommended).',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short imperative description' },
            successCriteria: {
              type: 'string',
              description: 'Concrete bar for "done" (optional but recommended)',
            },
          },
          required: ['title'],
        },
      },
    },
    required: ['task_id', 'subtasks'],
  },
  category: 'Claw',
  tags: ['claw', 'split', 'decompose', 'breakdown', 'subtask', 'plan'],
};

const clawSetNextIntentDef: ToolDefinition = {
  name: 'claw_set_next_intent',
  description: `Record what you will do in the NEXT cycle. Surfaced prominently in
the next cycle's prompt so you don't lose your train of thought between cycles.

Use this at the end of a cycle when:
- You made partial progress and want to continue exactly where you left off
- You started something but ran out of time/cycles and need to resume it cleanly
- You're about to do something risky and want the next cycle to know the plan

This is a one-liner (max 500 chars) — not a place for a full plan. Use claw_plan
for plans, .claw/MEMORY.md for long-term context, and this for "I will do X next".
Auto-clears after the next cycle renders it, so it can't go stale.`,
  parameters: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        description:
          'One concrete sentence: what you will do first in the next cycle. e.g. "Run the failing test in isolation to confirm the race condition is in retry logic, not transport."',
      },
    },
    required: ['intent'],
  },
  category: 'Claw',
  tags: ['claw', 'intent', 'next', 'handoff', 'continuity', 'cycle'],
};

const clawThinkDef: ToolDefinition = {
  name: 'claw_think',
  description: `Record an explicit reasoning step without taking any side-effecting action.
Use this when you need to deliberate before committing to a tool call — especially
when a previous cycle failed, the plan needs revisiting, or you're choosing between
multiple approaches. The thought is appended to .claw/LOG.md so future cycles can
audit your reasoning.

This is NOT a substitute for action. Use it as a brief pause, not as the only thing
you do in a cycle. A cycle whose only tool call is claw_think is wasted unless it
unblocks a clear next action you take immediately.`,
  parameters: {
    type: 'object',
    properties: {
      thought: {
        type: 'string',
        description:
          'Your reasoning — what you observed, what options you considered, what you concluded.',
      },
    },
    required: ['thought'],
  },
  category: 'Claw',
  tags: ['claw', 'think', 'reason', 'reflect', 'deliberate', 'scratchpad'],
};

const clawSaveSkillDef: ToolDefinition = {
  name: 'claw_save_skill',
  description: `Capture a reusable skill from what you just accomplished, so future
claws (including you, on later runs) can follow it instead of reasoning from scratch.
This is the deliberate counterpart to automatic skill distillation: call it when you
discover a procedure worth keeping.

Provide a short title and, optionally, the procedure body. If you omit the procedure,
the skill is distilled automatically from this run's trajectory and report. Saved
skills are stored in the AgentSkills format and become retrievable via
claw_recall_skill and auto-injection on similar missions.`,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'A short title describing the task this skill accomplishes.',
      },
      procedure: {
        type: 'string',
        description:
          'Optional markdown body: the reusable steps, pitfalls, and verification. If omitted, it is distilled automatically.',
      },
    },
    required: ['title'],
  },
  category: 'Claw',
  tags: ['claw', 'skill', 'learn', 'save', 'procedure', 'memory'],
};

const clawRecallSkillDef: ToolDefinition = {
  name: 'claw_recall_skill',
  description: `Search previously learned skills for ones relevant to your current task
and load their procedures. Use this at the start of a task to check whether a reliable
procedure already exists before improvising. Returns the most relevant learned skills
(title + procedure) ranked by relevance to your query.`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What you are trying to do — used to find relevant learned skills.',
      },
      limit: {
        type: 'number',
        description: 'Max skills to return (default 3, max 5).',
      },
    },
    required: ['query'],
  },
  category: 'Claw',
  tags: ['claw', 'skill', 'recall', 'retrieve', 'learn', 'memory'],
};

const clawExecuteDef: ToolDefinition = {
  name: 'claw_execute',
  description: `Run JavaScript that calls multiple tools programmatically in ONE step, instead of
one tool call per cycle. Ideal for collapsing a read/query pipeline (e.g. fetch tasks + goals +
events, then filter and aggregate) into a single inference — faster and cheaper than separate calls.

Export an async function:
  module.exports = async (args, utils) => {
    const tasks = await utils.callTool('list_tasks', { status: 'pending' });
    const goals = await utils.callTool('list_goals', { status: 'active' });
    return { taskCount: tasks.length, goals };
  };

Use utils.callTool(name, args) to invoke tools and utils.listTools() to discover them. Whatever your
function returns becomes the result. SECURITY: dangerous tools (shell, file mutation, email, git, code
execution) are blocked inside this sandbox — use claw_run_script for OS-level work.`,
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript that sets module.exports = async (args, utils) => {...}',
      },
      args: {
        type: 'object',
        description: 'Optional arguments object passed as the first parameter to your function.',
      },
    },
    required: ['code'],
  },
  category: 'Claw',
  tags: ['claw', 'execute', 'code', 'programmatic', 'pipeline', 'batch', 'tools'],
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
  clawPlanDef,
  clawUpdateTaskDef,
  clawListTasksDef,
  clawThinkDef,
  clawSetNextIntentDef,
  clawSplitTaskDef,
  clawSaveSkillDef,
  clawRecallSkillDef,
  clawExecuteDef,
];

export const CLAW_TOOL_NAMES = CLAW_TOOLS.map((t) => t.name);
