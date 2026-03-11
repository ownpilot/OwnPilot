// mcp/tools.ts
// Pure handler functions — no MCP SDK dependency, easily testable.

export interface BridgeConfig {
  url: string;    // default: 'http://localhost:9090'
  apiKey: string; // BRIDGE_API_KEY env var
}

export function getBridgeConfig(): BridgeConfig {
  return {
    url: process.env.BRIDGE_URL ?? 'http://localhost:9090',
    apiKey: process.env.BRIDGE_API_KEY ?? 'YOUR_BRIDGE_API_KEY_HERE',
  };
}

export interface OrchestrationDetailResult {
  id: string;
  projectDir: string;
  orchestrationId: string;
  currentStage: string;
  stages: Record<string, unknown>;
  errors: string[];
}

export interface HealthResult {
  status: string;
  circuitBreaker: {
    state: string;
    failures: number;
    openedAt: string | null;
  };
  activeSessions: number;
  pausedSessions: number;
  totalSessions: number;
}

export interface GsdProgressItem {
  sessionId: string;
  phase: string;
  step: string;
  progress: number;
  active: boolean;
}

export interface MetricsResult {
  spawnCount: number;
  spawnErrors: number;
  spawnSuccess: number;
  avgFirstChunkMs: number;
  avgTotalMs: number;
  activeSessions: number;
  pausedSessions: number;
  bridgeStartedAt: string;
  uptimeSeconds: number;
}

// ─── Async spawn job store ────────────────────────────────────────────────────
// Persists across tool calls in the long-running MCP process.

type JobStatus = 'running' | 'done' | 'error';

interface SpawnJob {
  jobId: string;
  conversationId: string;
  status: JobStatus;
  result?: SpawnCcResult;
  error?: string;
}

const _jobStore = new Map<string, SpawnJob>();

/** Reset job store for test isolation. Never call in production code. */
export function _clearJobStore(): void {
  _jobStore.clear();
}

/** Poll interval between job status checks. Override via _setPollIntervalMs for tests. */
let _pollIntervalMs = 3_000;
/** Max time to poll per spawn_cc call before returning running state. Override via _setPollWindowMs for tests. */
let _pollWindowMs = 4 * 60_000;

/** Set poll interval for test isolation. Never call in production code. */
export function _setPollIntervalMs(ms: number): void { _pollIntervalMs = ms; }
/** Set poll window for test isolation. Never call in production code. */
export function _setPollWindowMs(ms: number): void { _pollWindowMs = ms; }

/** State returned when a CC task exceeds the safe MCP poll window. */
export interface SpawnCcRunningState {
  status: 'running';
  conversation_id: string;
  hint: string;
}

export type SpawnCcResponse = SpawnCcResult | SpawnCcRunningState;

export interface SpawnCcAsyncResult {
  job_id: string;
  conversation_id: string;
  status: 'running';
}

/**
 * Spawn a Claude Code session asynchronously — returns immediately without
 * waiting for CC to finish. Use poll_cc / get_cc_result to retrieve the result.
 */
export async function toolSpawnCcAsync(
  input: SpawnCcInput,
  config: BridgeConfig,
): Promise<SpawnCcAsyncResult> {
  const jobId =
    input.conversation_id ??
    `async-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const job: SpawnJob = { jobId, conversationId: jobId, status: 'running' };
  _jobStore.set(jobId, job);

  // Fire-and-forget: result stored in job when CC completes
  _spawnCcHttp({ ...input, conversation_id: jobId }, config)
    .then((result) => {
      job.status = 'done';
      job.result = result;
    })
    .catch((err: unknown) => {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
    });

  return { job_id: jobId, conversation_id: jobId, status: 'running' };
}

export interface PollCcResult {
  status: JobStatus;
  result?: SpawnCcResult;
  error?: string;
}

/** Check the status of an async CC spawn. No network call — reads in-memory store. */
export function toolPollCc(jobId: string): PollCcResult {
  const job = _jobStore.get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId} — call spawn_cc_async first`);
  return { status: job.status, result: job.result, error: job.error };
}

/**
 * Get the result of a completed CC spawn.
 * Throws if the job is still running or failed.
 */
export function toolGetCcResult(jobId: string): SpawnCcResult {
  const job = _jobStore.get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.status === 'running')
    throw new Error(`Job ${jobId} still running — call poll_cc first`);
  if (job.status === 'error')
    throw new Error(`Job ${jobId} failed: ${job.error}`);
  return job.result!;
}

// ping — GET /ping
export async function toolPing(config: BridgeConfig): Promise<{ pong: boolean; timestamp: string }> {
  const res = await fetch(`${config.url}/ping`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge ping error (HTTP ${res.status}): ` +
      `Check: (1) bridge running on ${config.url}? (2) API key valid?`,
    );
  }
  return res.json() as Promise<{ pong: boolean; timestamp: string }>;
}

// spawn_cc — POST /v1/chat/completions (non-streaming)
export interface SpawnCcInput {
  project_dir: string;
  content: string;
  conversation_id?: string;
  orchestrator_id?: string;
  model?: string;
  timeout_ms?: number; // default 1800000 (30min)
}

export interface SpawnCcResult {
  content: string;         // assistant response text
  conversation_id: string;
  session_id: string;
  model: string;
}

/** Internal HTTP fetch — used by toolSpawnCc and toolSpawnCcAsync. */
async function _spawnCcHttp(input: SpawnCcInput, config: BridgeConfig): Promise<SpawnCcResult> {
  const { project_dir, content, conversation_id, orchestrator_id, model, timeout_ms = 1800000 } = input;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'X-Project-Dir': project_dir,
  };
  if (conversation_id) headers['X-Conversation-Id'] = conversation_id;
  if (orchestrator_id) headers['X-Orchestrator-Id'] = orchestrator_id;

  const body = JSON.stringify({
    model: model ?? 'bridge-model',
    stream: false,
    messages: [{ role: 'user', content }],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);

  let res: Response;
  try {
    res = await fetch(`${config.url}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(
      `Bridge spawn_cc error (HTTP ${res.status}): ` +
      `Hints: invalid project_dir, timeout exceeded, or bridge overloaded — call get_health() first`,
    );
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    id?: string;
    model?: string;
  };

  const assistantContent = data.choices?.[0]?.message?.content ?? '';
  return {
    content: assistantContent,
    conversation_id: conversation_id ?? data.id ?? '',
    session_id: data.id ?? '',
    model: data.model ?? model ?? 'bridge-model',
  };
}

/** Poll in-memory job store for up to _pollWindowMs, returning result or running state. */
async function _pollJobWindow(jobId: string): Promise<SpawnCcResponse> {
  const job = _jobStore.get(jobId)!;
  const deadline = Date.now() + _pollWindowMs;
  while (Date.now() < deadline) {
    if (job.status === 'done') return job.result!;
    if (job.status === 'error') throw new Error(`CC task failed: ${job.error}`);
    await new Promise<void>(resolve => setTimeout(resolve, _pollIntervalMs));
  }
  return {
    status: 'running',
    conversation_id: jobId,
    hint:
      `CC task is still in progress. Call spawn_cc again with conversation_id="${jobId}" ` +
      `and any content to resume polling.`,
  };
}

/**
 * Spawn a Claude Code session. Automatically handles long-running tasks:
 * - Short tasks (< 4 min): returns result transparently, same as before.
 * - Long tasks: returns {status:'running', conversation_id, hint}.
 *   Call spawn_cc again with the SAME conversation_id to resume polling.
 * No need to use spawn_cc_async / poll_cc / get_cc_result manually.
 */
export async function toolSpawnCc(input: SpawnCcInput, config: BridgeConfig): Promise<SpawnCcResponse> {
  const jobId =
    input.conversation_id ??
    `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Resume: existing job in store (called again after 'running' response)
  const existing = _jobStore.get(jobId);
  if (existing) {
    if (existing.status === 'done') return existing.result!;
    if (existing.status === 'error') throw new Error(`CC task failed: ${existing.error}`);
    return _pollJobWindow(jobId);
  }

  // New job: fire HTTP request in background, poll until done or window expires
  const job: SpawnJob = { jobId, conversationId: jobId, status: 'running' };
  _jobStore.set(jobId, job);

  _spawnCcHttp({ ...input, conversation_id: jobId }, config)
    .then(result => { job.status = 'done'; job.result = result; })
    .catch((err: unknown) => {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
    });

  return _pollJobWindow(jobId);
}

// spawn_opencode — POST /v1/opencode/chat/completions
export interface SpawnOpenCodeInput {
  project_dir: string;
  content: string;
  conversation_id?: string;
  model?: string;       // "minimax/MiniMax-M2.5" format
  timeout_ms?: number;  // default 1800000
}

export interface SpawnOpenCodeResult {
  content: string;
  conversation_id: string;
  session_id: string;   // "ocode-xxx" — OpenCode session ID
  model: string;
}

export async function toolSpawnOpenCode(
  input: SpawnOpenCodeInput,
  config: BridgeConfig,
): Promise<SpawnOpenCodeResult> {
  const { project_dir, content, conversation_id, model, timeout_ms = 1800000 } = input;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'X-Project-Dir': project_dir,
  };
  if (conversation_id) headers['X-Conversation-Id'] = conversation_id;

  const body = JSON.stringify({
    model: model ?? 'minimax/MiniMax-M2.5',
    stream: false,
    messages: [{ role: 'user', content }],
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);

  let res: Response;
  try {
    res = await fetch(`${config.url}/v1/opencode/chat/completions`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(
      `Bridge spawn_opencode error (HTTP ${res.status}): ` +
      `Hints: invalid project_dir, timeout exceeded, or OpenCode not configured`,
    );
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    id?: string;
    model?: string;
  };

  const assistantContent = data.choices?.[0]?.message?.content ?? '';
  return {
    content: assistantContent,
    conversation_id: conversation_id ?? data.id ?? '',
    session_id: data.id ?? '',
    model: data.model ?? model ?? 'minimax/MiniMax-M2.5',
  };
}

// get_projects — GET /v1/projects
export interface ProjectStats {
  projectDir: string;
  active: number;
  paused: number;
  total: number;
}

export async function toolGetProjects(config: BridgeConfig): Promise<ProjectStats[]> {
  const res = await fetch(`${config.url}/v1/projects`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge get_projects error (HTTP ${res.status}): ` +
      `Bridge in-memory data may be stale — retry once after bridge restart`,
    );
  }
  const data = await res.json() as Array<{ projectDir: string; sessions: { total: number; active: number; paused: number } }>;
  return data.map((p) => ({
    projectDir: p.projectDir,
    active: p.sessions.active,
    paused: p.sessions.paused,
    total: p.sessions.total,
  }));
}

// get_sessions — GET /v1/projects/:projectDir/sessions
export interface McpSessionInfo {
  sessionId: string;
  conversationId: string;
  status: string;
  projectDir: string;
}

export async function toolGetSessions(projectDir: string, config: BridgeConfig): Promise<McpSessionInfo[]> {
  const encoded = encodeURIComponent(projectDir);
  const res = await fetch(`${config.url}/v1/projects/${encoded}/sessions`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge get_sessions error (HTTP ${res.status}): ` +
      `Ensure project_dir matches an active project — call get_projects() to list all`,
    );
  }
  const data = await res.json() as Array<{ sessionId: string; conversationId: string; status: string; projectDir: string }>;
  return data.map((s) => ({
    sessionId: s.sessionId,
    conversationId: s.conversationId,
    status: s.status,
    projectDir: s.projectDir,
  }));
}

// worktree_create — POST /v1/projects/:projectDir/worktrees
export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
}

export async function toolWorktreeCreate(
  projectDir: string,
  name: string | undefined,
  config: BridgeConfig,
): Promise<WorktreeInfo> {
  const encoded = encodeURIComponent(projectDir);
  const body = name ? JSON.stringify({ name }) : '{}';
  const res = await fetch(`${config.url}/v1/projects/${encoded}/worktrees`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Bridge worktree_create error (HTTP ${res.status}): ` +
      `If HTTP 409: worktree name already exists — call worktree_list() to see active worktrees`,
    );
  }
  const data = await res.json() as { name: string; path: string; branch: string };
  return { name: data.name, path: data.path, branch: data.branch };
}

// worktree_list — GET /v1/projects/:projectDir/worktrees
export async function toolWorktreeList(projectDir: string, config: BridgeConfig): Promise<WorktreeInfo[]> {
  const encoded = encodeURIComponent(projectDir);
  const res = await fetch(`${config.url}/v1/projects/${encoded}/worktrees`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge worktree_list error (HTTP ${res.status}): ` +
      `Ensure project_dir is a valid git repo with active worktrees`,
    );
  }
  const data = await res.json() as Array<{ name: string; path: string; branch: string }>;
  return data.map((wt) => ({ name: wt.name, path: wt.path, branch: wt.branch }));
}

// get_events — GET /v1/events
export interface BridgeEvent {
  id: number;
  type: string;
  projectDir?: string;
  [key: string]: unknown;
}

export interface GetEventsResult {
  events: BridgeEvent[];
  count: number;
  since_id: number;
}

export async function toolGetEvents(
  sinceId: number | undefined,
  limit: number | undefined,
  projectDir: string | undefined,
  config: BridgeConfig,
): Promise<GetEventsResult> {
  const params = new URLSearchParams();
  if (sinceId !== undefined) params.set('since_id', String(sinceId));
  if (limit !== undefined) params.set('limit', String(limit));
  if (projectDir) params.set('project_dir', projectDir);
  const url = `${config.url}/v1/events?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${config.apiKey}` } });
  if (!res.ok) {
    throw new Error(
      `Bridge get_events error (HTTP ${res.status}): ` +
      `Try calling with since_id=0 to reset event pointer`,
    );
  }
  return res.json() as Promise<GetEventsResult>;
}

// get_orchestration_history — GET /v1/projects/:projectDir/orchestrate

export interface OrchestrationSummary {
  orchestrationId: string;
  projectDir: string;
  message: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentStage: string | null;
  startedAt: string;
  completedAt?: string;
  error?: string;
  stageCount: number;
}

export async function toolGetOrchestrationHistory(
  projectDir: string,
  status: string | undefined,
  config: BridgeConfig,
): Promise<OrchestrationSummary[]> {
  const encoded = encodeURIComponent(projectDir);
  const res = await fetch(`${config.url}/v1/projects/${encoded}/orchestrate`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge get_orchestration_history error (HTTP ${res.status}): ` +
      `No orchestrations found — run an orchestrate workflow first`,
    );
  }

  const data = await res.json() as Array<{
    orchestrationId: string;
    projectDir: string;
    message: string;
    status: string;
    currentStage: string | null;
    startedAt: string;
    completedAt?: string;
    error?: string;
    stageProgress?: Record<string, unknown>;
  }>;

  const items = data.map(item => ({
    orchestrationId: item.orchestrationId,
    projectDir: item.projectDir,
    message: item.message,
    status: item.status as OrchestrationSummary['status'],
    currentStage: item.currentStage,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    error: item.error,
    stageCount: Object.keys(item.stageProgress ?? {}).length,
  }));

  if (status) {
    return items.filter(item => item.status === status);
  }

  return items;
}

// get_orchestration_detail — GET /v1/projects/:projectDir/orchestrate/:orchestrationId/status

export async function toolGetOrchestrationDetail(
  projectDir: string,
  orchestrationId: string,
  config: BridgeConfig,
): Promise<OrchestrationDetailResult> {
  const encoded = encodeURIComponent(projectDir);
  const res = await fetch(
    `${config.url}/v1/projects/${encoded}/orchestrate/${orchestrationId}/status`,
    { headers: { Authorization: `Bearer ${config.apiKey}` } },
  );
  if (!res.ok) {
    throw new Error(
      `Bridge get_orchestration_detail error (HTTP ${res.status}): ` +
      `orchestration_id not found — call get_orchestration_history() to list valid IDs`,
    );
  }
  return res.json() as Promise<OrchestrationDetailResult>;
}

// session_terminate — DELETE /v1/sessions/:conversationId
export async function toolSessionTerminate(
  conversationId: string,
  config: BridgeConfig,
): Promise<{ message: string; conversationId: string }> {
  const res = await fetch(`${config.url}/v1/sessions/${conversationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge session_terminate error (HTTP ${res.status}): ` +
      `Session may already be terminated — call get_sessions() to verify first`,
    );
  }
  return res.json() as Promise<{ message: string; conversationId: string }>;
}

// get_health — GET /health

export async function toolGetHealth(config: BridgeConfig): Promise<HealthResult> {
  const res = await fetch(`${config.url}/health`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge get_health error (HTTP ${res.status}): ` +
      `Bridge may be starting up — wait 2s and retry`,
    );
  }
  return res.json() as Promise<HealthResult>;
}

// get_gsd_progress — GET /v1/projects/:projectDir/gsd/progress

export async function toolGetGsdProgress(
  projectDir: string,
  config: BridgeConfig,
): Promise<GsdProgressItem[]> {
  const encoded = encodeURIComponent(projectDir);
  const res = await fetch(`${config.url}/v1/projects/${encoded}/gsd/progress`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge get_gsd_progress error (HTTP ${res.status}): ` +
      `No active GSD sessions — trigger a GSD workflow first`,
    );
  }
  return res.json() as Promise<GsdProgressItem[]>;
}

// trigger_gsd — POST /v1/projects/:projectDir/gsd
export interface GsdTriggerState {
  gsdSessionId: string;
  status: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Trigger a GSD workflow via the bridge GSD endpoint.
 * Unlike spawn_cc, this injects full GSD context into the CC session.
 * Returns 202 Accepted immediately — use get_gsd_progress to poll status.
 */
export async function toolTriggerGsd(
  projectDir: string,
  message: string,
  config: BridgeConfig,
): Promise<GsdTriggerState> {
  const encoded = encodeURIComponent(projectDir);
  const res = await fetch(`${config.url}/v1/projects/${encoded}/gsd`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(
      `Bridge trigger_gsd error (HTTP ${res.status}): ` +
      `Ensure project_dir is a valid git repo and GSD is initialised (/gsd:progress)`,
    );
  }
  return res.json() as Promise<GsdTriggerState>;
}

// get_metrics — GET /metrics

export async function toolGetMetrics(config: BridgeConfig): Promise<MetricsResult> {
  const res = await fetch(`${config.url}/metrics`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge get_metrics error (HTTP ${res.status}): ` +
      `Unexpected bridge error — check bridge logs`,
    );
  }
  return res.json() as Promise<MetricsResult>;
}

// respond_cc — POST /v1/sessions/:sessionId/respond
export interface RespondCcResult {
  ok: boolean;
}

/**
 * Send a reply to a blocking Claude Code session.
 * Use after get_events returns a session.blocking event:
 *   event.sessionId → session_id param
 *   event.text      → CC's question text (for context)
 */
export async function toolRespondCc(
  sessionId: string,
  content: string,
  config: BridgeConfig,
): Promise<RespondCcResult> {
  const res = await fetch(`${config.url}/v1/sessions/${sessionId}/respond`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: content }),
  });
  if (!res.ok) {
    throw new Error(
      `Bridge respond_cc error (HTTP ${res.status}): ` +
      `Session may be gone — call get_sessions() to verify session_id is still active`,
    );
  }
  return res.json() as Promise<RespondCcResult>;
}

// start_interactive — POST /v1/sessions/start-interactive
export interface StartInteractiveResult {
  status: string;
  conversationId: string;
  sessionId: string;
  pid: number;
}

export async function toolStartInteractive(
  projectDir: string,
  systemPrompt: string | undefined,
  maxTurns: number | undefined,
  conversationId: string | undefined,
  config: BridgeConfig,
): Promise<StartInteractiveResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (conversationId) headers['X-Conversation-Id'] = conversationId;

  const body: Record<string, unknown> = { project_dir: projectDir };
  if (systemPrompt) body.system_prompt = systemPrompt;
  if (maxTurns !== undefined) body.max_turns = maxTurns;

  const res = await fetch(`${config.url}/v1/sessions/start-interactive`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Bridge start_interactive error (HTTP ${res.status}): ` +
      `If 429: too many interactive sessions (max 3). If 409: session already interactive.`,
    );
  }
  return res.json() as Promise<StartInteractiveResult>;
}

// send_interactive — POST /v1/sessions/:id/input
export interface SendInteractiveResult {
  status: string;
  conversationId: string;
  sessionId: string;
}

export async function toolSendInteractive(
  sessionId: string,
  message: string,
  config: BridgeConfig,
): Promise<SendInteractiveResult> {
  const res = await fetch(`${config.url}/v1/sessions/${sessionId}/input`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(
      `Bridge send_interactive error (HTTP ${res.status}): ` +
      `If 404: session not found. If 409: not in interactive mode — call start_interactive first.`,
    );
  }
  return res.json() as Promise<SendInteractiveResult>;
}

// close_interactive — POST /v1/sessions/:id/close-interactive
export interface CloseInteractiveResult {
  status: string;
  conversationId: string;
}

export async function toolCloseInteractive(
  sessionId: string,
  config: BridgeConfig,
): Promise<CloseInteractiveResult> {
  const res = await fetch(`${config.url}/v1/sessions/${sessionId}/close-interactive`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge close_interactive error (HTTP ${res.status}): ` +
      `If 404: session not found. If 409: not in interactive mode.`,
    );
  }
  return res.json() as Promise<CloseInteractiveResult>;
}

// worktree_delete — DELETE /v1/projects/:projectDir/worktrees/:name
export async function toolWorktreeDelete(
  projectDir: string,
  name: string,
  config: BridgeConfig,
): Promise<{ deleted: boolean; name: string }> {
  const encodedDir = encodeURIComponent(projectDir);
  const encodedName = encodeURIComponent(name);
  const res = await fetch(`${config.url}/v1/projects/${encodedDir}/worktrees/${encodedName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Bridge worktree_delete error (HTTP ${res.status}): ` +
      `Worktree may not exist — call worktree_list() to verify before deleting`,
    );
  }
  return { deleted: true, name };
}
