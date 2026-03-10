import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  getBridgeConfig,
  toolPing,
  toolSpawnCc,
  toolTriggerGsd,
  toolSpawnOpenCode,
  toolGetProjects,
  toolGetSessions,
  toolSessionTerminate,
  toolWorktreeCreate,
  toolWorktreeList,
  toolWorktreeDelete,
  toolGetEvents,
  toolGetHealth,
  toolGetMetrics,
  toolGetOrchestrationHistory,
  toolGetOrchestrationDetail,
  toolGetGsdProgress,
  toolRespondCc,
  toolStartInteractive,
  toolSendInteractive,
  toolCloseInteractive,
} from './tools.ts';

const server = new McpServer({ name: 'bridge-local', version: '1.0.0' });
const config = getBridgeConfig();

// ─── Core ───────────────────────────────────────────────────────────────────

server.registerTool(
  'ping',
  {
    description:
      'Check if the OpenClaw Bridge is reachable. Returns pong + timestamp. ' +
      '| Returns: {pong:true, timestamp}',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify(await toolPing(config)) }],
  }),
);

server.registerTool(
  'spawn_cc',
  {
    description:
      'Spawn a Claude Code session via the bridge. Handles both short and long-running tasks automatically. ' +
      'Short tasks (< 4 min): returns result transparently. ' +
      'Long tasks: returns {status:"running", conversation_id, hint} — call spawn_cc AGAIN with the ' +
      'SAME conversation_id and any content to resume polling until done. ' +
      'No manual async management needed — just retry on running state. ' +
      'INTERACTIVE LOOP PATTERN (when CC asks a question): ' +
      '1. spawn_cc → gets running state → save conversation_id. ' +
      '2. get_events(since_id=0) → watch for session.blocking event → note event.sessionId + event.text. ' +
      '3. respond_cc(session_id, "your answer") → unblocks CC. ' +
      '4. get_events again → session.done signals completion. ' +
      '5. spawn_cc(same conversation_id, "continue") → get final result. ' +
      '| Returns: {content, conversation_id, session_id, model} OR {status:"running", conversation_id, hint}',
    inputSchema: {
      project_dir: z.string().min(1).describe('Absolute path to the project directory'),
      content: z.string().min(1).describe('User message to send to Claude Code'),
      conversation_id: z
        .string()
        .optional()
        .describe('Conversation ID for session reuse (X-Conversation-Id)'),
      orchestrator_id: z
        .string()
        .optional()
        .describe(
          'Orchestrator ID for session isolation. Generate once per session: orch-{timestamp}-{pid}. ' +
          'Reuse same ID across all related spawns.',
        ),
      model: z.string().optional().describe('Model override (default: bridge-model)'),
      timeout_ms: z
        .number()
        .min(1000)
        .max(1800000)
        .optional()
        .describe('Request timeout in milliseconds (default: 1800000 = 30 min)'),
    },
  },
  async ({ project_dir, content, conversation_id, orchestrator_id, model, timeout_ms }) => {
    const result = await toolSpawnCc(
      { project_dir, content, conversation_id, orchestrator_id, model, timeout_ms },
      config,
    );
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  'spawn_opencode',
  {
    description:
      'Spawn an OpenCode session via the bridge. Similar to spawn_cc but uses OpenCode CLI instead of Claude Code. ' +
      'Default model: minimax/MiniMax-M2.5. OpenCode takes ~38s on first call (MCP init) — normal. ' +
      '| Returns: {content, conversation_id, session_id, model}',
    inputSchema: {
      project_dir: z.string().min(1).describe('Absolute path to the project directory'),
      content: z.string().min(1).describe('User message to send to OpenCode'),
      conversation_id: z.string().optional().describe('Conversation ID for session reuse'),
      model: z.string().optional().describe('Model in provider/model format (default: minimax/MiniMax-M2.5)'),
      timeout_ms: z.number().min(1000).max(1800000).optional().describe('Timeout in ms (default: 1800000)'),
    },
  },
  async ({ project_dir, content, conversation_id, model, timeout_ms }) => {
    const result = await toolSpawnOpenCode(
      { project_dir, content, conversation_id, model, timeout_ms },
      config,
    );
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

// ─── Project & Session ───────────────────────────────────────────────────────

server.registerTool(
  'get_projects',
  {
    description:
      'List all active bridge projects with session counts. ' +
      '| Returns: [{projectDir, activeSessions, pausedSessions, totalSessions}]',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify(await toolGetProjects(config)) }],
  }),
);

server.registerTool(
  'get_sessions',
  {
    description:
      'List CC sessions for a specific project. ' +
      '| Returns: [{conversationId, projectDir, processAlive, tokensUsed, budgetUsed}]',
    inputSchema: {
      project_dir: z.string().describe('Absolute path to the project directory'),
    },
  },
  async ({ project_dir }) => ({
    content: [{ type: 'text', text: JSON.stringify(await toolGetSessions(project_dir, config)) }],
  }),
);

server.registerTool(
  'session_terminate',
  {
    description:
      'Terminate a Claude Code session by conversation ID. Kills the CC process. ' +
      '| Returns: {terminated:true, conversationId}',
    inputSchema: {
      conversation_id: z.string().describe('Conversation ID of the session to terminate'),
    },
  },
  async ({ conversation_id }) => {
    const result = await toolSessionTerminate(conversation_id, config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

// ─── Worktree ────────────────────────────────────────────────────────────────

server.registerTool(
  'worktree_create',
  {
    description:
      'Create an isolated git worktree for parallel execution. ' +
      '| Returns: {worktreePath, branch, name}',
    inputSchema: {
      project_dir: z.string().describe('Absolute path to the project directory'),
      name: z.string().optional().describe('Worktree name (auto-generated if omitted)'),
    },
  },
  async ({ project_dir, name }) => ({
    content: [{ type: 'text', text: JSON.stringify(await toolWorktreeCreate(project_dir, name, config)) }],
  }),
);

server.registerTool(
  'worktree_list',
  {
    description:
      'List active worktrees for a project. ' +
      '| Returns: [{name, path, branch, createdAt}]',
    inputSchema: {
      project_dir: z.string().describe('Absolute path to the project directory'),
    },
  },
  async ({ project_dir }) => ({
    content: [{ type: 'text', text: JSON.stringify(await toolWorktreeList(project_dir, config)) }],
  }),
);

server.registerTool(
  'worktree_delete',
  {
    description:
      'Delete a worktree and prune its branch. ' +
      '| Returns: {deleted:true, name}',
    inputSchema: {
      project_dir: z.string().describe('Absolute path to the project directory'),
      name: z.string().describe('Worktree name to delete'),
    },
  },
  async ({ project_dir, name }) => ({
    content: [{ type: 'text', text: JSON.stringify(await toolWorktreeDelete(project_dir, name, config)) }],
  }),
);

// ─── Events & Monitoring ─────────────────────────────────────────────────────

server.registerTool(
  'get_events',
  {
    description:
      'Poll buffered bridge events since a given event ID. Replaces SSE curl pattern for MCP clients. ' +
      'Key event types: session.blocking (CC is asking a question — use respond_cc to reply), ' +
      'session.done (CC finished), gsd_phase_started/completed/error. ' +
      'For interactive CC loop: poll with since_id from last call, watch for session.blocking, ' +
      'extract event.sessionId → pass to respond_cc. ' +
      '| Returns: [{id, type, data, projectDir, timestamp}] max 1000 events, 5min TTL',
    inputSchema: {
      since_id: z
        .number()
        .min(0)
        .optional()
        .describe('Return events with ID > since_id (default: 0 = all buffered)'),
      limit: z
        .number()
        .min(1)
        .max(200)
        .optional()
        .describe('Max events to return (default: 50, max: 200)'),
      project_dir: z.string().optional().describe('Filter events by project directory'),
    },
  },
  async ({ since_id, limit, project_dir }) => {
    const result = await toolGetEvents(since_id, limit, project_dir, config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  'get_health',
  {
    description:
      'Get bridge service health: circuit breaker state, active/paused/total sessions, process-alive status per session. ' +
      '| Returns: {circuitBreaker:{state,failures}, activeSessions, pausedSessions, totalSessions}',
    inputSchema: {},
  },
  async () => {
    const result = await toolGetHealth(config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  'get_metrics',
  {
    description:
      'Get in-memory bridge metrics: request counters, response times, session gauges, circuit breaker stats. ' +
      '| Returns: {spawnCount, spawnErrors, avgFirstChunkMs, uptimeSeconds, ...}',
    inputSchema: {},
  },
  async () => {
    const result = await toolGetMetrics(config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  'trigger_gsd',
  {
    description:
      'Trigger a GSD workflow for a project via the bridge GSD endpoint. ' +
      'Unlike spawn_cc, this injects full GSD context — CC will run /gsd:* commands. ' +
      'Returns 202 immediately. Use get_gsd_progress to poll for completion. ' +
      '| Returns: {gsdSessionId, status, message}',
    inputSchema: {
      project_dir: z.string().min(1).describe('Absolute path to the project directory'),
      message: z
        .string()
        .min(1)
        .describe('GSD command or message (e.g. "/gsd:progress", "/gsd:execute-phase 10")'),
    },
  },
  async ({ project_dir, message }) => {
    const result = await toolTriggerGsd(project_dir, message, config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

// ─── Orchestration ───────────────────────────────────────────────────────────

server.registerTool(
  'get_orchestration_history',
  {
    description:
      'List orchestration pipeline runs for a project. ' +
      'Returns research→DA→plan_generation→execute→verify pipeline history. ' +
      'Filter by status: pending, running, completed, failed. ' +
      '| Returns: [{id, orchestrationId, currentStage, createdAt, completedAt}]',
    inputSchema: {
      project_dir: z.string().describe('Absolute path to the project directory'),
      status: z
        .enum(['pending', 'running', 'completed', 'failed'])
        .optional()
        .describe('Filter by status (omit to return all)'),
    },
  },
  async ({ project_dir, status }) => {
    const result = await toolGetOrchestrationHistory(project_dir, status, config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  'get_orchestration_detail',
  {
    description:
      'Get full state of a specific orchestration run (research→DA→plan_generation→execute→verify pipeline). ' +
      'Returns current stage, status, error, and stage progress. ' +
      '| Returns: {orchestrationId, currentStage, stages, errors:[]}',
    inputSchema: {
      project_dir: z.string().describe('Absolute path to the project directory'),
      orchestration_id: z.string().describe('Orchestration ID (e.g. orch-abc123)'),
    },
  },
  async ({ project_dir, orchestration_id }) => {
    const result = await toolGetOrchestrationDetail(project_dir, orchestration_id, config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  'get_gsd_progress',
  {
    description:
      'Get live GSD workflow progress for a project. Returns array of active GSD session progress states. ' +
      '| Returns: [{sessionId, phase, step, progress, active}]',
    inputSchema: {
      project_dir: z.string().describe('Absolute path to the project directory'),
    },
  },
  async ({ project_dir }) => {
    const result = await toolGetGsdProgress(project_dir, config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

// ─── Interactive Mode ─────────────────────────────────────────────────────────

server.registerTool(
  'start_interactive',
  {
    description:
      'Start a long-lived interactive CC session. Unlike spawn_cc (one process per message), ' +
      'this keeps a single CC process alive with stdin open. ' +
      'Send messages via send_interactive, detect questions via get_events (session.blocking), ' +
      'respond via respond_cc, close via close_interactive. ' +
      'INTERACTIVE LOOP: start_interactive → send_interactive → get_events → respond_cc → close_interactive. ' +
      'Max 3 concurrent interactive sessions. ' +
      '| Returns: {status:"interactive", conversationId, sessionId, pid}',
    inputSchema: {
      project_dir: z.string().min(1).describe('Absolute path to the project directory'),
      system_prompt: z.string().optional().describe('System prompt for the CC session'),
      max_turns: z.number().min(1).optional().describe('Max agentic turns per message (default: 1, use higher for complex tasks)'),
      conversation_id: z.string().optional().describe('Custom conversation ID (auto-generated if omitted)'),
    },
  },
  async ({ project_dir, system_prompt, max_turns, conversation_id }) => {
    const result = await toolStartInteractive(project_dir, system_prompt, max_turns, conversation_id, config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  'send_interactive',
  {
    description:
      'Send a message to an active interactive CC session. ' +
      'The message is written to CC\'s stdin — output arrives async via get_events (session.output, session.done). ' +
      'If CC calls AskUserQuestion, get_events will emit session.blocking — use respond_cc to answer. ' +
      '| Returns: {status:"sent", conversationId, sessionId}',
    inputSchema: {
      session_id: z.string().min(1).describe('Session ID or conversation ID from start_interactive'),
      message: z.string().min(1).describe('Message to send to the interactive CC session'),
    },
  },
  async ({ session_id, message }) => {
    const result = await toolSendInteractive(session_id, message, config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  'close_interactive',
  {
    description:
      'Close an interactive CC session. Sends EOF to stdin, waits 3s for graceful exit, then force-kills. ' +
      '| Returns: {status:"closed", conversationId}',
    inputSchema: {
      session_id: z.string().min(1).describe('Session ID or conversation ID to close'),
    },
  },
  async ({ session_id }) => {
    const result = await toolCloseInteractive(session_id, config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  'respond_cc',
  {
    description:
      'Send a reply to a blocking Claude Code session. ' +
      'Use after get_events returns a session.blocking event: ' +
      'event.sessionId → session_id, event.text shows what CC asked. ' +
      'INTERACTIVE LOOP: spawn_cc → get_events(session.blocking) → respond_cc → get_events(session.done). ' +
      '| Returns: {ok: true}',
    inputSchema: {
      session_id: z
        .string()
        .min(1)
        .describe('Session ID from session.blocking event (event.sessionId)'),
      content: z
        .string()
        .min(1)
        .describe('Your reply to CC\'s question'),
    },
  },
  async ({ session_id, content }) => {
    const result = await toolRespondCc(session_id, content, config);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
);

// Start server on stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
