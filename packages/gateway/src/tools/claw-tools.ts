/**
 * Claw Tools
 *
 * 16 AI-callable tools that give Claw agents enhanced capabilities:
 * 1. claw_install_package — Install npm/pip packages into workspace
 * 2. claw_run_script — Execute scripts in workspace (Docker or local)
 * 3. claw_create_tool — Execute ephemeral tools from generated code
 * 4. claw_spawn_subclaw — Spawn child claw for subtask delegation
 * 5. claw_publish_artifact — Publish outputs as artifacts
 * 6. claw_request_escalation — Request environment upgrade
 * 7. claw_send_output — Send results to user via Telegram + WS notification
 * 8. claw_complete_report — Final report: artifact + notification + conversation message
 * 9. claw_emit_event — Emit custom event to EventBus (trigger other claws, workflows, etc.)
 * 10. claw_update_config — Update claw configuration (mode, limits, etc.)
 * 11. claw_send_agent_message — Send message to another agent's inbox
 * 12. claw_reflect — Self-reflection on mission progress
 * 13. claw_set_context — Set persistent context values (working memory)
 * 14. claw_get_context — Get persistent context values (working memory)
 * 15. get_claw_status — Get detailed claw status
 * 16. get_claw_history — Get claw execution history
 */

import type { ToolDefinition } from '@ownpilot/core';
import { getErrorMessage, generateId, MAX_CLAW_DEPTH } from '@ownpilot/core';
import { getClawContext } from '../services/claw-context.js';

// =============================================================================
// Tool Definitions
// =============================================================================

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

// =============================================================================
// Exports
// =============================================================================

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

// =============================================================================
// Validation Helpers
// =============================================================================

const PACKAGE_NAME_RE = /^[@a-z0-9][\w./-]*$/i;

function validatePackageName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.includes('&&') || name.includes('||') || name.includes(';') || name.includes('`'))
    return false;
  return PACKAGE_NAME_RE.test(name);
}

const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;

function validateToolName(name: string): boolean {
  return TOOL_NAME_RE.test(name) && name.length <= 64;
}

// =============================================================================
// Executor
// =============================================================================

export async function executeClawTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    switch (toolName) {
      case 'claw_install_package':
        return await executeInstallPackage(args, userId);

      case 'claw_run_script':
        return await executeRunScript(args, userId);

      case 'claw_create_tool':
        return await executeCreateTool(args);

      case 'claw_spawn_subclaw':
        return await executeSpawnSubclaw(args, userId);

      case 'claw_publish_artifact':
        return await executePublishArtifact(args, userId);

      case 'claw_request_escalation':
        return await executeRequestEscalation(args);

      case 'claw_send_output':
        return await executeSendOutput(args, userId);

      case 'claw_complete_report':
        return await executeCompleteReport(args, userId);

      case 'claw_emit_event':
        return await executeEmitEvent(args);

      case 'claw_update_config':
        return await executeUpdateConfig(args, userId);

      case 'claw_send_agent_message':
        return await executeSendAgentMessage(args, userId);

      case 'claw_reflect':
        return await executeReflect(args);

      case 'claw_list_subclaws':
        return await executeListSubclaws(userId);

      case 'claw_stop_subclaw':
        return await executeStopSubclaw(args, userId);

      case 'claw_set_context':
        return await executeSetContext(args);

      case 'claw_get_context':
        return await executeGetContext();

      default:
        return { success: false, error: `Unknown claw tool: ${toolName}` };
    }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

// =============================================================================
// Tool Implementations
// =============================================================================

async function executeInstallPackage(
  args: Record<string, unknown>,
  _userId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };
  if (!ctx.workspaceId) return { success: false, error: 'No workspace configured for this Claw' };

  const packageName = args.package_name as string;
  const manager = (args.manager as string) ?? 'npm';

  if (!validatePackageName(packageName)) {
    return { success: false, error: `Invalid package name: ${packageName}` };
  }

  if (!['npm', 'pip', 'pnpm'].includes(manager)) {
    return { success: false, error: `Invalid package manager: ${manager}` };
  }

  const { getSessionWorkspacePath } = await import('../workspace/file-workspace.js');
  const wsPath = getSessionWorkspacePath(ctx.workspaceId);
  if (!wsPath) return { success: false, error: 'Workspace not found' };

  // Use execFile (not exec) to prevent shell injection
  const { execFileSync } = await import('node:child_process');

  const commands: Record<string, { cmd: string; args: string[] }> = {
    npm: { cmd: 'npm', args: ['install', '--prefix', wsPath, packageName] },
    pnpm: { cmd: 'pnpm', args: ['add', '--dir', wsPath, packageName] },
    pip: { cmd: 'pip', args: ['install', '--target', `${wsPath}/pip_packages`, packageName] },
  };

  const entry = commands[manager];
  if (!entry) return { success: false, error: `Unsupported package manager: ${manager}` };

  try {
    const output = execFileSync(entry.cmd, entry.args, {
      timeout: 60_000,
      cwd: wsPath,
      encoding: 'utf-8',
      env: { ...process.env, HOME: wsPath },
    });

    return {
      success: true,
      result: { package: packageName, manager, output: output.slice(0, 2000) },
    };
  } catch (err) {
    return { success: false, error: `Install failed: ${getErrorMessage(err)}` };
  }
}

async function executeRunScript(
  args: Record<string, unknown>,
  _userId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };
  if (!ctx.workspaceId) return { success: false, error: 'No workspace configured for this Claw' };

  const script = args.script as string;
  const language = (args.language as string) ?? 'javascript';
  const timeoutMs = Math.min((args.timeout_ms as number) ?? 30_000, 120_000);

  if (!script || script.length > 100_000) {
    return { success: false, error: 'Script is empty or exceeds 100KB limit' };
  }

  const { getSessionWorkspacePath, writeSessionWorkspaceFile } =
    await import('../workspace/file-workspace.js');
  const wsPath = getSessionWorkspacePath(ctx.workspaceId);
  if (!wsPath) return { success: false, error: 'Workspace not found' };

  // Write script to workspace for Docker sandbox path mapping; will be cleaned up after execution
  const ext: Record<string, string> = { python: 'py', javascript: 'js', shell: 'sh' };
  const scriptName = `script_${Date.now()}.${ext[language] ?? 'js'}`;
  const scriptRelPath = `scripts/${scriptName}`;
  writeSessionWorkspaceFile(ctx.workspaceId, scriptRelPath, Buffer.from(script, 'utf-8'));

  const scriptFullPath = `${wsPath}/scripts/${scriptName}`;

  const { rmSync } = await import('node:fs');
  const cleanup = () => {
    try {
      rmSync(scriptFullPath, { force: true });
    } catch {
      // Best-effort cleanup
    }
  };

  // Local execution using execFile (no shell injection)
  const { execFileSync } = await import('node:child_process');
  const interpreters: Record<string, { cmd: string; args: string[] }> = {
    python: { cmd: 'python3', args: [scriptFullPath] },
    javascript: { cmd: 'node', args: [scriptFullPath] },
    shell: { cmd: 'sh', args: [scriptFullPath] },
  };

  const interp = interpreters[language] ?? interpreters.javascript!;
  const cmd = interp.cmd;
  const cmdArgs = interp.args;

  try {
    const stdout = execFileSync(cmd, cmdArgs, {
      timeout: timeoutMs,
      cwd: wsPath,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });

    cleanup();

    return {
      success: true,
      result: { stdout, stderr: '', exitCode: 0, sandbox: 'local' },
    };
  } catch (err: unknown) {
    cleanup();
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    return {
      success: false,
      result: {
        stdout: execErr.stdout ?? '',
        stderr: execErr.stderr ?? '',
        exitCode: execErr.status ?? 1,
        sandbox: 'local',
      },
      error: getErrorMessage(err),
    };
  }
}

async function executeCreateTool(args: Record<string, unknown>): Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
}> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const name = args.name as string;
  const description = args.description as string;
  const code = args.code as string;
  const toolArgs = (args.parameters as Record<string, unknown>) ?? undefined;
  const invokeArgs = (args.args as Record<string, unknown>) ?? {};

  if (!validateToolName(name)) {
    return {
      success: false,
      error: `Invalid tool name "${name}". Must be lowercase, start with a letter, and contain only letters, numbers, underscores.`,
    };
  }

  if (!code || code.length > 50_000) {
    return { success: false, error: 'Code is empty or exceeds 50KB limit' };
  }

  if (!description?.trim()) {
    return { success: false, error: 'Tool description is required' };
  }

  // Execute the user code in a Node.js vm sandbox.
  // The code should define a function with the tool name (or assign to `exports.default`).
  // We inject 'args' into the sandbox context and call the function.
  try {
    const vm = await import('node:vm');

    const logs: string[] = [];
    const sandbox: Record<string, unknown> = {
      args: invokeArgs,
      module: { exports: {} as Record<string, unknown> },
      exports: {} as Record<string, unknown>,
      __result: undefined,
      console: {
        log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
        error: (...a: unknown[]) => logs.push('[err] ' + a.map(String).join(' ')),
      },
      // Block sandbox escape vectors
      require: undefined,
      process: undefined,
      global: undefined,
      globalThis: undefined,
      Function: undefined,
      eval: undefined,
      import: undefined,
    };

    const wrappedCode = `
${code}
// Auto-detect callable: named function or module.exports
const __fn = typeof ${name} === 'function'
  ? ${name}
  : (module.exports && typeof module.exports.default === 'function' ? module.exports.default
  : (typeof module.exports === 'function' ? module.exports : null));
__result = typeof __fn === 'function' ? __fn(args) : { error: "No function named '${name}' found. Define: function ${name}(args) { ... }" };
`;

    const vmCtx = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
    });
    vm.runInContext(wrappedCode, vmCtx, { timeout: 10_000 });

    // Resolve promises (sync vm can't await, but we can resolve simple thenables)
    let output = vmCtx.__result;
    if (
      output &&
      typeof output === 'object' &&
      typeof (output as Promise<unknown>).then === 'function'
    ) {
      output = await (output as Promise<unknown>);
    }

    return {
      success: true,
      result: {
        registered: true,
        name,
        description,
        schema: toolArgs,
        output,
        executedWith: invokeArgs,
        logs: logs.length > 0 ? logs : undefined,
        note: 'Tool executed successfully. Call claw_create_tool again with different args to reuse.',
      },
    };
  } catch (err) {
    return { success: false, error: `Tool execution failed: ${getErrorMessage(err)}` };
  }
}

async function executeSpawnSubclaw(
  args: Record<string, unknown>,
  userId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const name = args.name as string;
  const mission = args.mission as string;
  const mode = (args.mode as string) ?? 'single-shot';

  if (!name || !mission) {
    return { success: false, error: 'Both name and mission are required' };
  }

  // Depth check
  const newDepth = ctx.depth + 1;
  if (newDepth > MAX_CLAW_DEPTH) {
    return {
      success: false,
      error: `Maximum claw nesting depth (${MAX_CLAW_DEPTH}) exceeded. Current depth: ${ctx.depth}`,
    };
  }

  // Lazy import to avoid circular dependency
  const { getClawManager } = await import('../services/claw-manager.js');
  const manager = getClawManager();

  const { getClawsRepository } = await import('../db/repositories/claws.js');
  const repo = getClawsRepository();
  const parentConfig = await repo.getById(ctx.clawId, userId);
  if (parentConfig?.autonomyPolicy?.allowSubclaws === false) {
    return { success: false, error: 'Sub-claws are disabled by this claw autonomy policy' };
  }

  const subclawId = generateId('claw');
  const config = await repo.create({
    id: subclawId,
    userId,
    name,
    mission,
    mode: mode as 'continuous' | 'interval' | 'event' | 'single-shot',
    allowedTools: [],
    limits: {
      maxTurnsPerCycle: 15,
      maxToolCallsPerCycle: 50,
      maxCyclesPerHour: 10,
      cycleTimeoutMs: 180_000,
    },
    autoStart: false,
    depth: newDepth,
    sandbox: 'auto',
    parentClawId: ctx.clawId,
    createdBy: 'claw',
  });

  if (mode === 'single-shot') {
    // startClaw awaits the cycle for single-shot mode, so session reflects final state
    const session = await manager.startClaw(config.id, userId);
    return {
      success: !session.lastCycleError,
      result: {
        subclawId: config.id,
        mode: 'single-shot',
        state: session.state,
        cyclesCompleted: session.cyclesCompleted,
        totalToolCalls: session.totalToolCalls,
        costUsd: session.totalCostUsd,
        artifacts: session.artifacts,
        output: session.lastCycleError
          ? `Failed: ${session.lastCycleError}`
          : 'Subclaw completed successfully.',
      },
      error: session.lastCycleError ?? undefined,
    };
  }

  // Cyclic mode — start and return ID
  await manager.startClaw(config.id, userId);
  return {
    success: true,
    result: {
      subclawId: config.id,
      mode: 'continuous',
      message: `Subclaw "${name}" started. It will run autonomously.`,
    },
  };
}

async function executePublishArtifact(
  args: Record<string, unknown>,
  userId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const title = args.title as string;
  const content = args.content as string;
  const type = (args.type as string) ?? 'markdown';

  if (!title || !content) {
    return { success: false, error: 'Both title and content are required' };
  }

  if (content.length > 500_000) {
    return { success: false, error: 'Content exceeds 500KB limit' };
  }

  const { getArtifactService } = await import('../services/artifact-service.js');
  const artifactService = getArtifactService();

  const artifact = await artifactService.createArtifact(userId, {
    title,
    content,
    type: type as 'html' | 'svg' | 'markdown' | 'chart' | 'form' | 'react',
    tags: ['claw', `claw:${ctx.clawId}`],
  });

  // Track artifact in session so UI Overview tab can show it
  try {
    const { getClawManager } = await import('../services/claw-manager.js');
    getClawManager().addArtifact(ctx.clawId, artifact.id);
  } catch {
    // Manager may not be available in test environments
  }

  return {
    success: true,
    result: {
      artifactId: artifact.id,
      title: artifact.title,
      type: artifact.type,
    },
  };
}

async function executeRequestEscalation(
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const type = args.type as string;
  const reason = args.reason as string;
  const details = args.details as Record<string, unknown> | undefined;

  if (!type || !reason) {
    return { success: false, error: 'Both type and reason are required' };
  }

  const validTypes = ['sandbox_upgrade', 'network_access', 'budget_increase', 'permission_grant'];
  if (!validTypes.includes(type)) {
    return {
      success: false,
      error: `Invalid escalation type: ${type}. Valid: ${validTypes.join(', ')}`,
    };
  }

  const escalationId = generateId('esc');

  const { getClawManager } = await import('../services/claw-manager.js');
  const manager = getClawManager();

  await manager.requestEscalation(ctx.clawId, {
    id: escalationId,
    type,
    reason,
    details,
    requestedAt: new Date(),
  });

  return {
    success: true,
    result: {
      escalationId,
      type,
      reason,
      message: 'Escalation requested. Execution will pause until approved.',
    },
  };
}

async function executeSendOutput(
  args: Record<string, unknown>,
  userId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const message = args.message as string;
  const urgency = (args.urgency as string) ?? 'medium';

  if (!message?.trim()) {
    return { success: false, error: 'Message is required' };
  }

  const deliveries: string[] = [];

  // 1. Send via Telegram
  try {
    const { sendTelegramMessage } = await import('./notification-tools.js');
    const emoji =
      urgency === 'high' ? '\u26a0\ufe0f' : urgency === 'medium' ? '\ud83e\udd16' : '\ud83d\udce4';
    const telegramText = `${emoji} *Claw Output*\n\n${message}`;
    const sent = await sendTelegramMessage(userId, telegramText);
    if (sent) deliveries.push('telegram');
  } catch {
    // Telegram not available
  }

  // 2. Emit WS event for live UI feed
  try {
    const { getEventSystem } = await import('@ownpilot/core');
    getEventSystem().emit('claw.output' as never, 'claw-tools', {
      clawId: ctx.clawId,
      message,
      urgency,
      timestamp: new Date().toISOString(),
    } as never);
    deliveries.push('websocket');
  } catch {
    // Event system may not be initialized
  }

  // 3. Store in conversation as assistant message (so user sees it in chat history)
  try {
    const { createMessagesRepository } = await import('../db/repositories/messages.js');
    const msgRepo = createMessagesRepository();
    await msgRepo.create({
      id: generateId('msg'),
      conversationId: `claw-${ctx.clawId}`,
      role: 'assistant',
      content: `**[Claw Output]** ${message}`,
    });
    deliveries.push('conversation');
  } catch {
    // Messages repo may fail
  }

  return {
    success: true,
    result: {
      delivered: deliveries,
      message:
        deliveries.length > 0
          ? `Output sent via ${deliveries.join(', ')}`
          : 'No delivery channels available',
    },
  };
}

async function executeCompleteReport(
  args: Record<string, unknown>,
  userId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const title = args.title as string;
  const report = args.report as string;
  const summary = args.summary as string;

  if (!title || !report || !summary) {
    return { success: false, error: 'title, report, and summary are all required' };
  }

  if (report.length > 500_000) {
    return { success: false, error: 'Report exceeds 500KB limit' };
  }

  const results: Record<string, unknown> = {};

  // 1. Publish as artifact
  try {
    const { getArtifactService } = await import('../services/artifact-service.js');
    const artifact = await getArtifactService().createArtifact(userId, {
      title,
      content: report,
      type: 'markdown',
      tags: ['claw', `claw:${ctx.clawId}`, 'report'],
    });
    results.artifactId = artifact.id;

    // Track artifact in session
    try {
      const { getClawManager } = await import('../services/claw-manager.js');
      getClawManager().addArtifact(ctx.clawId, artifact.id);
    } catch {
      // Best-effort
    }
  } catch (err) {
    results.artifactError = getErrorMessage(err);
  }

  // 2. Send summary notification via Telegram
  try {
    const { sendTelegramMessage } = await import('./notification-tools.js');
    const telegramText = `\ud83d\udcca *${title}*\n\n${summary.slice(0, 500)}${results.artifactId ? '\n\n_Full report saved as artifact._' : ''}`;
    const sent = await sendTelegramMessage(userId, telegramText);
    results.telegramSent = sent;
  } catch {
    results.telegramSent = false;
  }

  // 3. Emit WS notification
  try {
    const { getEventSystem } = await import('@ownpilot/core');
    getEventSystem().emit('claw.output' as never, 'claw-tools', {
      clawId: ctx.clawId,
      type: 'report',
      title,
      summary,
      artifactId: results.artifactId,
      timestamp: new Date().toISOString(),
    } as never);
    results.websocketSent = true;
  } catch {
    results.websocketSent = false;
  }

  // 4. Store summary in conversation
  try {
    const { createMessagesRepository } = await import('../db/repositories/messages.js');
    const msgRepo = createMessagesRepository();
    await msgRepo.create({
      id: generateId('msg'),
      conversationId: `claw-${ctx.clawId}`,
      role: 'assistant',
      content: `**[Claw Report: ${title}]**\n\n${summary}\n\n---\n\n${report}`,
    });
    results.conversationStored = true;
  } catch {
    results.conversationStored = false;
  }

  return {
    success: true,
    result: {
      ...results,
      message: 'Report published, notification sent, conversation updated',
    },
  };
}

async function executeEmitEvent(
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const eventType = args.event_type as string;
  const payload = (args.payload as Record<string, unknown>) ?? {};

  if (!eventType?.trim()) {
    return { success: false, error: 'event_type is required' };
  }

  try {
    // getEventSystem is already imported at top via @ownpilot/core
    const { getEventSystem } = await import('@ownpilot/core');
    getEventSystem().emit(eventType as never, `claw:${ctx.clawId}`, {
      ...payload,
      _clawId: ctx.clawId,
      _timestamp: new Date().toISOString(),
    } as never);

    return {
      success: true,
      result: {
        eventType,
        emittedBy: ctx.clawId,
        message: `Event "${eventType}" emitted to EventBus`,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to emit event: ${getErrorMessage(err)}` };
  }
}

async function executeUpdateConfig(
  args: Record<string, unknown>,
  userId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  // Map snake_case LLM args to camelCase repository fields
  const updates: Record<string, unknown> = {};
  if (args.mission !== undefined) updates.mission = args.mission;
  if (args.mode !== undefined) updates.mode = args.mode;
  if (args.sandbox !== undefined) updates.sandbox = args.sandbox;
  if (args.interval_ms !== undefined) updates.intervalMs = args.interval_ms;
  if (args.stop_condition !== undefined) updates.stopCondition = args.stop_condition;
  if (args.auto_start !== undefined) updates.autoStart = args.auto_start;

  if (Object.keys(updates).length === 0) {
    return { success: false, error: 'No config fields provided to update' };
  }

  try {
    const { getClawsRepository } = await import('../db/repositories/claws.js');
    const repo = getClawsRepository();
    const current = await repo.getById(ctx.clawId, userId);
    if (current?.autonomyPolicy?.allowSelfModify === false) {
      return {
        success: false,
        error: 'Self-modification is disabled by this claw autonomy policy',
      };
    }

    const updated = await repo.update(ctx.clawId, userId, updates);

    // Hot-reload in-memory config so changes take effect this cycle
    if (updated) {
      try {
        const { getClawManager } = await import('../services/claw-manager.js');
        getClawManager().updateClawConfig(ctx.clawId, updated);
      } catch {
        // Best-effort — manager may not have this claw loaded
      }
    }

    return {
      success: true,
      result: {
        updated: Object.keys(updates),
        message: `Config updated: ${Object.keys(updates).join(', ')}. Changes are live immediately.`,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to update config: ${getErrorMessage(err)}` };
  }
}

async function executeSendAgentMessage(
  args: Record<string, unknown>,
  _userId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const targetClawId = args.target_claw_id as string;
  const subject = args.subject as string;
  const content = args.content as string;
  const messageType = (args.message_type as string) ?? 'coordination';

  if (!targetClawId || !subject || !content) {
    return { success: false, error: 'target_claw_id, subject, and content are required' };
  }

  try {
    // Try to deliver to running claw's inbox
    const { getClawManager } = await import('../services/claw-manager.js');
    const manager = getClawManager();

    const formattedMsg = `[${messageType.toUpperCase()}] From claw:${ctx.clawId} — ${subject}\n\n${content}`;
    const sent = await manager.sendMessage(targetClawId, formattedMsg);

    if (!sent) {
      // Claw not running — try DB inbox append
      const { getClawsRepository } = await import('../db/repositories/claws.js');
      await getClawsRepository().appendToInbox(targetClawId, formattedMsg);
    }

    return {
      success: true,
      result: {
        delivered: sent ? 'live' : 'inbox',
        targetClawId,
        subject,
        message: sent
          ? `Message delivered to running claw ${targetClawId}`
          : `Message queued in inbox of claw ${targetClawId} (not currently running)`,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to send message: ${getErrorMessage(err)}` };
  }
}

async function executeReflect(
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const question = args.question as string;
  if (!question?.trim()) {
    return { success: false, error: 'question is required' };
  }

  // Read .claw/ files for self-assessment
  const { readSessionWorkspaceFile } = await import('../workspace/file-workspace.js');

  const tasks = ctx.workspaceId
    ? (readSessionWorkspaceFile(ctx.workspaceId, '.claw/TASKS.md')?.toString('utf-8') ?? '')
    : '';
  const log = ctx.workspaceId
    ? (readSessionWorkspaceFile(ctx.workspaceId, '.claw/LOG.md')?.toString('utf-8') ?? '')
    : '';
  const memory = ctx.workspaceId
    ? (readSessionWorkspaceFile(ctx.workspaceId, '.claw/MEMORY.md')?.toString('utf-8') ?? '')
    : '';

  // Count task progress
  const todoCount = (tasks.match(/- \[ \]/g) ?? []).length;
  const doneCount = (tasks.match(/- \[x\]/g) ?? []).length;
  const totalTasks = todoCount + doneCount;
  const progressPct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  // Count log entries
  const logLines = log.split('\n').filter((l) => l.trim().length > 0).length;

  // Count memory entries
  const memoryLines = memory
    .split('\n')
    .filter((l) => l.trim().length > 0 && !l.startsWith('#')).length;

  return {
    success: true,
    result: {
      question,
      assessment: {
        tasksTotal: totalTasks,
        tasksDone: doneCount,
        tasksTodo: todoCount,
        progressPercent: progressPct,
        logEntries: logLines,
        memoryEntries: memoryLines,
        recommendation:
          progressPct >= 80
            ? 'Mission is nearly complete. Consider using claw_complete_report to deliver final results.'
            : progressPct >= 50
              ? 'Good progress. Continue working through remaining tasks.'
              : progressPct > 0
                ? 'Some progress made. Review your strategy — are you on the right track?'
                : 'No tasks completed yet. Make sure to update .claw/TASKS.md as you work.',
      },
      hint: 'Update .claw/TASKS.md, .claw/MEMORY.md, and .claw/LOG.md to improve self-assessment accuracy.',
    },
  };
}

async function executeListSubclaws(
  _userId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  try {
    const { getClawsRepository } = await import('../db/repositories/claws.js');
    const repo = getClawsRepository();
    const children = await repo.getChildClaws(ctx.clawId);

    const { getClawManager } = await import('../services/claw-manager.js');
    const manager = getClawManager();

    const subclaws = children.map((c) => {
      const session = manager.getSession(c.id);
      return {
        id: c.id,
        name: c.name,
        mode: c.mode,
        state: session?.state ?? 'stopped',
        cycles: session?.cyclesCompleted ?? 0,
        depth: c.depth,
      };
    });

    return { success: true, result: { subclaws, total: subclaws.length } };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}

async function executeSetContext(
  args: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const updates = args.updates as Record<string, unknown> | undefined;
  if (!updates || typeof updates !== 'object') {
    return { success: false, error: 'updates must be an object of key-value pairs' };
  }

  try {
    const { getClawManager } = await import('../services/claw-manager.js');
    const manager = getClawManager();
    const session = manager.getSession(ctx.clawId);
    if (!session) return { success: false, error: 'Claw session not found' };

    // Merge updates — null values delete the key
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        delete session.persistentContext[key];
      } else {
        session.persistentContext[key] = value;
      }
    }

    const setKeys = Object.entries(updates)
      .filter(([, v]) => v !== null)
      .map(([k]) => k);
    const deletedKeys = Object.entries(updates)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    return {
      success: true,
      result: {
        set: setKeys,
        deleted: deletedKeys,
        context: session.persistentContext,
        message: `Working Memory updated. ${setKeys.length} key(s) set${deletedKeys.length > 0 ? `, ${deletedKeys.length} key(s) removed` : ''}.`,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to update context: ${getErrorMessage(err)}` };
  }
}

async function executeGetContext(): Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
}> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  try {
    const { getClawManager } = await import('../services/claw-manager.js');
    const session = getClawManager().getSession(ctx.clawId);
    if (!session) return { success: false, error: 'Claw session not found' };

    return {
      success: true,
      result: {
        context: session.persistentContext,
        keys: Object.keys(session.persistentContext),
        size: Object.keys(session.persistentContext).length,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to read context: ${getErrorMessage(err)}` };
  }
}

async function executeStopSubclaw(
  args: Record<string, unknown>,
  userId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const subclawId = args.subclaw_id as string;
  if (!subclawId) return { success: false, error: 'subclaw_id is required' };

  try {
    // Verify it's actually a child of this claw
    const { getClawsRepository } = await import('../db/repositories/claws.js');
    const repo = getClawsRepository();
    const subclaw = await repo.getByIdAnyUser(subclawId);
    if (!subclaw || subclaw.parentClawId !== ctx.clawId) {
      return { success: false, error: 'Subclaw not found or not a child of this claw' };
    }

    const { getClawManager } = await import('../services/claw-manager.js');
    const stopped = await getClawManager().stopClaw(subclawId, userId);
    return {
      success: true,
      result: { stopped, message: stopped ? 'Subclaw stopped' : 'Subclaw was not running' },
    };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}
