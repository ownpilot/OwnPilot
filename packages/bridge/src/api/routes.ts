/**
 * HTTP Route Definitions
 *
 * Implements:
 *   GET  /ping                                  — Reachability check
 *   GET  /status                                — Authenticated summary (sessions, CB, perf)
 *   POST /v1/chat/completions                   — OpenAI-compatible chat endpoint (SSE or JSON)
 *   GET  /health                                — Service health + active sessions
 *   GET  /v1/models                             — Model listing (OpenAI compat)
 *   GET  /v1/projects                           — MON-01: Per-project session stats
 *   GET  /v1/projects/:projectDir/sessions      — MON-02: Session list for a project
 *   GET  /v1/metrics/projects                   — MON-03: Per-project resource metrics
 *   POST /v1/projects/:projectDir/gsd           — ORCH-01: Trigger GSD workflow
 *   GET  /v1/projects/:projectDir/gsd/status    — ORCH-02: GSD session status (list + active count)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeMessage } from '../router.ts';
import { claudeManager } from '../claude-manager.ts';
import { config } from '../config.ts';
import { logger } from '../utils/logger.ts';
import type { ChatCompletionRequest, GsdProgressState } from '../types.ts';
import { getMetrics } from '../metrics.ts';
import { matchPatterns, isBlocking } from '../pattern-matcher.ts';
import { webhookStore } from '../webhook-store.ts';
import { eventBus, type BridgeEvent, type BufferedEvent } from '../event-bus.ts';
import { replayBuffer } from '../event-replay-buffer.ts';
import { worktreeManager } from '../worktree-manager.ts';
import type { MergeResult } from '../worktree-manager.ts';
import { gsdOrchestration } from '../gsd-orchestration.ts';
import { orchestrationService } from '../orchestration-service.ts';
import { multiProjectOrchestrator } from '../multi-project-orchestrator.ts';
import type { GsdTriggerRequest, OrchestrationRequest, MultiProjectItem } from '../types.ts';
import { openCodeManager } from '../opencode-manager.ts';

// ---------------------------------------------------------------------------
// Graceful draining state (R1 CRITICAL audit fix)
// ---------------------------------------------------------------------------

let shuttingDown = false;

/** Signal that the server is shutting down — new requests get 503. */
export function setShuttingDown(): void {
  shuttingDown = true;
}

/** Reset shutdown state — exposed for testing. */
export function resetShuttingDown(): void {
  shuttingDown = false;
}

/** Check if server is shutting down. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

// ---------------------------------------------------------------------------
// OpenCode concurrent spawn limiter (recursive loop protection)
// ---------------------------------------------------------------------------

/** Max concurrent OpenCode spawns. Prevents recursive spawn loops. */
export const MAX_CONCURRENT_OPENCODE_SPAWNS = 5;
let activeOpenCodeSpawns = 0;

/** Current active OpenCode spawn count — for monitoring and tests. */
export function getActiveOpenCodeSpawns(): number { return activeOpenCodeSpawns; }

/** Reset counter — exposed for testing only. */
export function resetActiveOpenCodeSpawns(): void { activeOpenCodeSpawns = 0; }

// ---------------------------------------------------------------------------
// Auth middleware helper
// ---------------------------------------------------------------------------

/** HTTP status for a successful respond/resume action (P1-6). */
export const RESPOND_SUCCESS_STATUS = 202;

/**
 * Determine whether an SSE idle timeout should be reset for a given event
 * based on the connection's project/orchestrator filter (P1-4).
 * Exported for unit testing.
 */
export function shouldResetIdle(
  event: BridgeEvent,
  filterProjectDir: string | null,
  filterOrchestratorId: string | null,
): boolean {
  // If a project filter is active, only reset for events that match it
  if (filterProjectDir && 'projectDir' in event && event.projectDir !== filterProjectDir) {
    return false;
  }
  // If an orchestrator filter is active, only reset for matching events
  if (
    filterOrchestratorId &&
    'orchestratorId' in event &&
    (event as { orchestratorId?: string }).orchestratorId !== undefined &&
    (event as { orchestratorId?: string }).orchestratorId !== filterOrchestratorId
  ) {
    return false;
  }
  return true;
}

function verifyBearerToken(request: FastifyRequest, reply: FastifyReply): boolean {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: { message: 'Missing Bearer token', type: 'auth_error' } });
    return false;
  }
  const token = authHeader.slice(7).trim();
  // Timing-safe comparison to prevent timing attacks (P1-9)
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(config.bridgeApiKey);
  const isValid = tokenBuf.length === expectedBuf.length && timingSafeEqual(tokenBuf, expectedBuf);
  if (!isValid) {
    reply.code(401).send({ error: { message: 'Invalid API key', type: 'auth_error' } });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ------------------------------------------------------------------
  // Graceful draining hook — reject new requests during shutdown
  // /ping is exempted so health probes still work
  // ------------------------------------------------------------------
  app.addHook('onRequest', async (request, reply) => {
    if (shuttingDown && request.url !== '/ping') {
      reply
        .code(503)
        .header('Retry-After', '30')
        .send({
          error: {
            message: 'Server is shutting down — please retry after drain completes',
            type: 'service_unavailable',
            code: 'SHUTTING_DOWN',
          },
        });
    }
  });

  // ------------------------------------------------------------------
  // GET /version
  // ------------------------------------------------------------------
  app.get('/version', async (request, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
    return reply.code(200).send({
      version: '1.0.0',
      uptime: Math.round(process.uptime()),
      model: config.claudeModel,
      startedAt,
    });
  });

  // ------------------------------------------------------------------
  // GET /ping
  // ------------------------------------------------------------------
  app.get('/ping', async (_request, reply) => {
    return reply.code(200).send({ pong: true, timestamp: new Date().toISOString() });
  });

  // ------------------------------------------------------------------
  // GET /health
  // ------------------------------------------------------------------
  app.get('/health', async (request, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    const sessions = claudeManager.getSessions();
    const cbState = claudeManager.getCircuitBreakerState();
    return reply.code(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      circuitBreaker: {
        state: cbState.state,
        failures: cbState.failures,
        openedAt: cbState.openedAt?.toISOString() ?? null,
      },
      sessions: sessions.map((s) => {
        const pauseStatus = claudeManager.isPaused(s.conversationId);
        return {
          conversationId: s.conversationId,
          sessionId: s.sessionId,
          processAlive: s.processAlive,
          lastActivity: s.lastActivity.toISOString(),
          projectDir: s.projectDir,
          tokensUsed: s.tokensUsed,
          paused: pauseStatus.paused,
          ...(pauseStatus.paused ? { pausedAt: pauseStatus.pausedAt, pauseReason: pauseStatus.reason } : {}),
        };
      }),
      activeSessions: sessions.filter((s) => s.processAlive).length,
      pausedSessions: sessions.filter((s) => claudeManager.isPaused(s.conversationId).paused).length,
      totalSessions: sessions.length,
    });
  });

  // ------------------------------------------------------------------
  // GET /v1/models
  // ------------------------------------------------------------------
  app.get('/v1/models', async (request, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    return reply.code(200).send({
      object: 'list',
      data: [
        { id: config.claudeModel, object: 'model', created: 1_700_000_000, owned_by: 'anthropic' },
        { id: 'claude-opus-4-6', object: 'model', created: 1_700_000_000, owned_by: 'anthropic' },
      ],
    });
  });

  // ------------------------------------------------------------------
  // GET /metrics — in-memory counters and gauges
  // ------------------------------------------------------------------
  app.get('/metrics', async (request, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    const sessions = claudeManager.getSessions();
    const activeSessions = sessions.filter((s) => s.processAlive).length;
    const pausedSessions = sessions.filter((s) => claudeManager.isPaused(s.conversationId).paused).length;
    return reply.code(200).send(getMetrics(activeSessions, pausedSessions));
  });

  // ------------------------------------------------------------------
  // GET /v1/projects — MON-01: per-project session stats
  // ------------------------------------------------------------------
  app.get('/v1/projects', async (request, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    const stats = claudeManager.getProjectStats();
    return reply.code(200).send(
      stats.map(s => ({
        projectDir: s.projectDir,
        sessions: { total: s.total, active: s.active, paused: s.paused },
      }))
    );
  });

  // ------------------------------------------------------------------
  // GET /v1/projects/:projectDir/sessions — MON-02: session list for a project
  // ------------------------------------------------------------------
  app.get('/v1/projects/:projectDir/sessions', async (request: FastifyRequest<{ Params: { projectDir: string } }>, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    const decodedDir = decodeURIComponent(request.params.projectDir);
    const resolvedDir = resolve(decodedDir);
    const resolvedNorm = resolvedDir.endsWith('/') ? resolvedDir : resolvedDir + '/';
    const isUnderHome = resolvedNorm.startsWith('/home/ayaz/');
    const firstSegment = resolvedNorm.slice('/home/ayaz/'.length).split('/')[0];
    const isHomeDotDir = isUnderHome && firstSegment.startsWith('.');
    const ALLOWED_PROJECT_PREFIXES = ['/home/ayaz/', '/tmp/'];
    const isAllowedDir =
      !isHomeDotDir &&
      ALLOWED_PROJECT_PREFIXES.some((prefix) => resolvedNorm.startsWith(prefix));
    if (!isAllowedDir) {
      return reply.code(400).send({
        error: { message: 'Invalid project directory', type: 'invalid_request', code: 'PATH_TRAVERSAL_BLOCKED' },
      });
    }
    const sessions = claudeManager.getProjectSessionDetails(resolvedDir);
    return reply.code(200).send(sessions);
  });

  // ------------------------------------------------------------------
  // GET /v1/metrics/projects — MON-03: per-project resource metrics
  // ------------------------------------------------------------------
  app.get('/v1/metrics/projects', async (request, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    return reply.code(200).send(claudeManager.getProjectResourceMetrics());
  });

  // ------------------------------------------------------------------
  // POST /v1/projects/:projectDir/gsd — ORCH-01: Trigger GSD workflow
  // ------------------------------------------------------------------
  app.post(
    '/v1/projects/:projectDir/gsd',
    async (
      request: FastifyRequest<{
        Params: { projectDir: string };
        Body: GsdTriggerRequest;
      }>,
      reply,
    ) => {
      if (!verifyBearerToken(request, reply)) return;
      const decodedDir = decodeURIComponent(request.params.projectDir);
      const body = request.body as GsdTriggerRequest | null | undefined;

      // Validate: command is required and must be a non-empty string
      if (!body?.command || typeof body.command !== 'string' || body.command.trim() === '') {
        return reply.code(400).send({ error: { message: 'command is required', type: 'invalid_request' } });
      }

      try {
        const state = await gsdOrchestration.trigger(decodedDir, body);
        return reply.code(202).send(state);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === 'PROJECT_CONCURRENT_LIMIT') {
          return reply.code(429).send({ error: { message: 'Project concurrent limit exceeded', type: 'quota_exceeded' } });
        }
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: { message: msg, type: 'internal_error' } });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/projects/:projectDir/gsd/status — ORCH-02: GSD session status
  // ------------------------------------------------------------------
  app.get(
    '/v1/projects/:projectDir/gsd/status',
    async (request: FastifyRequest<{ Params: { projectDir: string } }>, reply) => {
      if (!verifyBearerToken(request, reply)) return;
      const decodedDir = decodeURIComponent(request.params.projectDir);
      const sessions = gsdOrchestration.listActive(decodedDir);
      return reply.code(200).send({ sessions, active: sessions.length });
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/projects/:projectDir/gsd/progress — PROG-02: Live GSD progress
  // ------------------------------------------------------------------
  app.get(
    '/v1/projects/:projectDir/gsd/progress',
    async (request: FastifyRequest<{ Params: { projectDir: string } }>, reply) => {
      if (!verifyBearerToken(request, reply)) return;
      const decodedDir = decodeURIComponent(request.params.projectDir);
      // Get all active sessions for this project, then look up their progress state
      const sessions = gsdOrchestration.listActive(decodedDir);
      const progressStates = sessions
        .map((s) => gsdOrchestration.getProgress(s.gsdSessionId))
        .filter((p): p is GsdProgressState => p !== undefined);
      return reply.code(200).send(progressStates);
    },
  );

  // ------------------------------------------------------------------
  // POST /v1/projects/:projectDir/orchestrate — ORCH-V4-01: Trigger orchestration pipeline
  // ------------------------------------------------------------------
  app.post(
    '/v1/projects/:projectDir/orchestrate',
    {
      config: {
        rateLimit: {
          max: Number(process.env.ORCH_RATE_LIMIT_MAX) || 5,
          timeWindow: process.env.ORCH_RATE_LIMIT_WINDOW ?? '1 minute',
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { projectDir: string };
        Body: OrchestrationRequest;
      }>,
      reply,
    ) => {
      if (!verifyBearerToken(request, reply)) return;
      const decodedDir = decodeURIComponent(request.params.projectDir);
      const body = request.body as OrchestrationRequest | null | undefined;

      if (!body?.message || typeof body.message !== 'string' || body.message.trim() === '') {
        return reply.code(400).send({ error: { message: 'message is required', type: 'invalid_request' } });
      }
      if (!body?.scope_in || typeof body.scope_in !== 'string') {
        return reply.code(400).send({ error: { message: 'scope_in is required', type: 'invalid_request' } });
      }
      if (!body?.scope_out || typeof body.scope_out !== 'string') {
        return reply.code(400).send({ error: { message: 'scope_out is required', type: 'invalid_request' } });
      }

      try {
        const state = await orchestrationService.trigger(decodedDir, body);
        return reply.code(202).send(state);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === 'PROJECT_CONCURRENT_LIMIT') {
          return reply.code(429).send({ error: { message: 'Orchestration concurrent limit exceeded', type: 'quota_exceeded' } });
        }
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: { message: msg, type: 'internal_error' } });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/projects/:projectDir/orchestrate/:orchestrationId/status — ORCH-V4-02: Get status
  // ------------------------------------------------------------------
  app.get(
    '/v1/projects/:projectDir/orchestrate/:orchestrationId/status',
    async (
      request: FastifyRequest<{ Params: { projectDir: string; orchestrationId: string } }>,
      reply,
    ) => {
      if (!verifyBearerToken(request, reply)) return;
      const orchestrationId = request.params.orchestrationId;
      const state = orchestrationService.getById(orchestrationId);
      if (!state) {
        return reply.code(404).send({ error: { message: `Orchestration ${orchestrationId} not found`, type: 'not_found' } });
      }
      return reply.code(200).send(state);
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/projects/:projectDir/orchestrate — ORCH-V4-03: List active orchestrations
  // ------------------------------------------------------------------
  app.get(
    '/v1/projects/:projectDir/orchestrate',
    async (request: FastifyRequest<{ Params: { projectDir: string } }>, reply) => {
      if (!verifyBearerToken(request, reply)) return;
      const decodedDir = decodeURIComponent(request.params.projectDir);
      const sessions = orchestrationService.listActive(decodedDir);
      return reply.code(200).send({ sessions, active: sessions.length });
    },
  );

  // ------------------------------------------------------------------
  // POST /orchestrate/multi — MULTI-01: Trigger multi-project orchestration
  // ------------------------------------------------------------------
  app.post(
    '/orchestrate/multi',
    {
      config: {
        rateLimit: {
          max: Number(process.env.MULTI_ORCH_RATE_LIMIT_MAX) || 5,
          timeWindow: process.env.MULTI_ORCH_RATE_LIMIT_WINDOW ?? '1 minute',
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: { projects?: unknown } }>,
      reply,
    ) => {
      if (!verifyBearerToken(request, reply)) return;

      const body = request.body as { projects?: unknown } | null | undefined;
      if (!Array.isArray(body?.projects) || body.projects.length === 0) {
        return reply.code(400).send({
          error: { message: 'projects array is required and must be non-empty', type: 'invalid_request' },
        });
      }

      // Basic per-item validation
      for (const item of body.projects as MultiProjectItem[]) {
        if (!item.dir || typeof item.dir !== 'string') {
          return reply.code(400).send({
            error: { message: 'Each project item must have a "dir" string field', type: 'invalid_request' },
          });
        }
        if (!item.command || typeof item.command !== 'string') {
          return reply.code(400).send({
            error: { message: 'Each project item must have a "command" string field', type: 'invalid_request' },
          });
        }
      }

      try {
        const state = await multiProjectOrchestrator.trigger(body.projects as MultiProjectItem[]);
        return reply.code(202).send(state);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        const msg = err instanceof Error ? err.message : String(err);
        if (code === 'INVALID_DEPENDENCY_GRAPH') {
          return reply.code(400).send({ error: { message: msg, type: 'invalid_request' } });
        }
        if (/cycle/i.test(msg)) {
          return reply.code(400).send({ error: { message: msg, type: 'invalid_request' } });
        }
        return reply.code(500).send({ error: { message: msg, type: 'internal_error' } });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /orchestrate/multi/:multiOrchId — MULTI-02: Get status
  // ------------------------------------------------------------------
  app.get(
    '/orchestrate/multi/:multiOrchId',
    async (
      request: FastifyRequest<{ Params: { multiOrchId: string } }>,
      reply,
    ) => {
      if (!verifyBearerToken(request, reply)) return;
      const { multiOrchId } = request.params;
      const state = multiProjectOrchestrator.getById(multiOrchId);
      if (!state) {
        return reply.code(404).send({
          error: { message: `Multi-project orchestration ${multiOrchId} not found`, type: 'not_found' },
        });
      }
      return reply.code(200).send(state);
    },
  );

  // ------------------------------------------------------------------
  // GET /orchestrate/multi — MULTI-03: List all sessions
  // ------------------------------------------------------------------
  app.get(
    '/orchestrate/multi',
    async (request, reply) => {
      if (!verifyBearerToken(request, reply)) return;
      const sessions = multiProjectOrchestrator.listAll();
      return reply.code(200).send({ sessions, total: sessions.length });
    },
  );

  // ------------------------------------------------------------------
  // POST /v1/projects/:projectDir/worktrees — WORK-01: create worktree
  // ------------------------------------------------------------------
  app.post(
    '/v1/projects/:projectDir/worktrees',
    async (
      request: FastifyRequest<{
        Params: { projectDir: string };
        Body: { name?: string; baseBranch?: string; conversationId?: string };
      }>,
      reply,
    ) => {
      if (!verifyBearerToken(request, reply)) return;
      const projectDir = decodeURIComponent(request.params.projectDir);
      const body = (request.body ?? {}) as { name?: string; baseBranch?: string; conversationId?: string };
      try {
        const wt = await worktreeManager.create(projectDir, {
          name: body.name,
          baseBranch: body.baseBranch,
          conversationId: body.conversationId,
        });
        eventBus.emit('worktree.created', {
          type: 'worktree.created',
          projectDir: wt.projectDir,
          name: wt.name,
          branch: wt.branch,
          path: wt.path,
          timestamp: new Date().toISOString(),
        });
        return reply.code(201).send(wt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not a git repository/i.test(msg))
          return reply.code(400).send({ error: { message: msg, type: 'invalid_request', code: 'NOT_A_GIT_REPO' } });
        if (/max.*worktrees/i.test(msg))
          return reply.code(429).send({ error: { message: msg, type: 'rate_limit_error', code: 'WORKTREE_LIMIT' } });
        if (/already exists/i.test(msg))
          return reply.code(409).send({ error: { message: msg, type: 'conflict', code: 'WORKTREE_EXISTS' } });
        if (/too long/i.test(msg))
          return reply.code(400).send({ error: { message: msg, type: 'invalid_request', code: 'WORKTREE_NAME_TOO_LONG' } });
        return reply.code(500).send({ error: { message: msg, type: 'internal_error' } });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/projects/:projectDir/worktrees — WORK-03: list worktrees
  // ------------------------------------------------------------------
  app.get(
    '/v1/projects/:projectDir/worktrees',
    async (request: FastifyRequest<{ Params: { projectDir: string } }>, reply) => {
      if (!verifyBearerToken(request, reply)) return;
      const projectDir = decodeURIComponent(request.params.projectDir);
      const worktrees = await worktreeManager.list(projectDir);
      return reply.code(200).send(worktrees);
    },
  );

  // ------------------------------------------------------------------
  // DELETE /v1/projects/:projectDir/worktrees/:name — WORK-02: remove + merge
  // ------------------------------------------------------------------
  app.delete(
    '/v1/projects/:projectDir/worktrees/:name',
    async (
      request: FastifyRequest<{
        Params: { projectDir: string; name: string };
        Querystring: { merge?: string; strategy?: string };
      }>,
      reply,
    ) => {
      if (!verifyBearerToken(request, reply)) return;
      const projectDir = decodeURIComponent(request.params.projectDir);
      const { name } = request.params;
      const shouldMerge = (request.query as { merge?: string }).merge !== 'false';
      const strategy = ((request.query as { strategy?: string }).strategy ?? 'auto') as 'auto' | 'fast-forward-only';

      const wt = await worktreeManager.get(projectDir, name);
      if (!wt)
        return reply.code(404).send({ error: { message: `Worktree '${name}' not found`, type: 'not_found' } });

      let mergeResult: MergeResult | null = null;
      if (shouldMerge) {
        mergeResult = await worktreeManager.mergeBack(projectDir, name, { strategy, deleteAfter: false });
        if (mergeResult.success) {
          eventBus.emit('worktree.merged', {
            type: 'worktree.merged',
            projectDir,
            name,
            branch: wt.branch,
            strategy: mergeResult.strategy as 'fast-forward' | 'merge-commit',
            commitHash: mergeResult.commitHash,
            timestamp: new Date().toISOString(),
          });
        } else {
          eventBus.emit('worktree.conflict', {
            type: 'worktree.conflict',
            projectDir,
            name,
            branch: wt.branch,
            conflictFiles: mergeResult.conflictFiles ?? [],
            timestamp: new Date().toISOString(),
          });
          // Return 200 with conflict info — worktree stays alive for manual resolution
          return reply.code(200).send({ merged: false, conflict: true, conflictFiles: mergeResult.conflictFiles });
        }
      }

      await worktreeManager.remove(projectDir, name);
      eventBus.emit('worktree.removed', {
        type: 'worktree.removed',
        projectDir,
        name,
        timestamp: new Date().toISOString(),
      });
      return reply.code(200).send({ merged: !!mergeResult?.success, removed: true, mergeResult });
    },
  );

  // ------------------------------------------------------------------
  // GET /status — authenticated summary (distinct from /health)
  // ------------------------------------------------------------------
  app.get('/status', async (request, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    const sessions = claudeManager.getSessions();
    const activeSessions = sessions.filter((s) => s.processAlive).length;
    const pausedSessions = sessions.filter((s) => claudeManager.isPaused(s.conversationId).paused).length;
    const cbState = claudeManager.getCircuitBreakerState();
    const m = getMetrics(activeSessions, pausedSessions);
    return reply.code(200).send({
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      sessions: { active: activeSessions, paused: pausedSessions, total: sessions.length },
      circuitBreaker: { state: cbState.state, failures: cbState.failures, openedAt: cbState.openedAt?.toISOString() ?? null },
      performance: { spawnCount: m.spawnCount, avgSpanMs: m.avgTotalMs, avgFirstChunkMs: m.avgFirstChunkMs, note: 'lifetime averages since last bridge restart' },
    });
  });

  // ------------------------------------------------------------------
  // POST /v1/chat/completions
  // ------------------------------------------------------------------
  app.post(
    '/v1/chat/completions',
    {
      config: {
        rateLimit: {
          max: Number(process.env.SPAWN_RATE_LIMIT_MAX) || 10,
          timeWindow: process.env.SPAWN_RATE_LIMIT_WINDOW ?? '1 minute',
        },
      },
    },
    async (request: FastifyRequest<{ Body: ChatCompletionRequest }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;

      const body = request.body;
      const log = logger.child({ route: 'chat/completions' });

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return reply.code(400).send({
          error: { message: 'messages array is required and must not be empty', type: 'invalid_request' },
        });
      }

      const msgContent = body.messages[0]?.content;
      if (!msgContent || (typeof msgContent === 'string' && !msgContent.trim())) {
        return reply.code(400).send({
          error: { message: 'Message content cannot be empty', type: 'invalid_request' },
        });
      }

      // FIX 2 (audit): Sanitize conversationId to prevent path injection
      // (e.g. ../../etc/evil used in sessionStorageDir path)
      const rawConversationId =
        (request.headers['x-conversation-id'] as string | undefined) ??
        body.metadata?.conversation_id ??
        randomUUID();
      const conversationId = rawConversationId.replace(/[^a-zA-Z0-9_-]/g, '');

      const rawProjectDir =
        (request.headers['x-project-dir'] as string | undefined) ??
        body.metadata?.project_dir ??
        config.defaultProjectDir;

      // Path traversal prevention: validate projectDir against allowed prefixes.
      // Hidden directories directly under home (e.g. /home/ayaz/.ssh) are blocked
      // even though they technically start with /home/ayaz/.
      const ALLOWED_PROJECT_PREFIXES = ['/home/ayaz/', '/tmp/'];
      const resolvedProjectDir = resolve(rawProjectDir);
      // Use (resolved + '/') trick to handle exact-match case (e.g. /home/ayaz without trailing slash)
      const resolvedNorm = resolvedProjectDir.endsWith('/') ? resolvedProjectDir : resolvedProjectDir + '/';
      const isUnderHome = resolvedNorm.startsWith('/home/ayaz/');
      // Block hidden directories directly under home (e.g. /home/ayaz/.ssh)
      const firstSegment = resolvedNorm.slice('/home/ayaz/'.length).split('/')[0];
      const isHomeDotDir = isUnderHome && firstSegment.startsWith('.');
      const isAllowedDir =
        !isHomeDotDir &&
        ALLOWED_PROJECT_PREFIXES.some((prefix) => resolvedNorm.startsWith(prefix));
      if (!isAllowedDir) {
        log.warn({ rawProjectDir, resolvedProjectDir }, 'Path traversal attempt blocked');
        return reply.code(400).send({
          error: {
            message: 'X-Project-Dir must be within allowed directories (/home/ayaz/ or /tmp/)',
            type: 'invalid_request',
            code: 'PATH_TRAVERSAL_BLOCKED',
          },
        });
      }
      const projectDir = resolvedProjectDir;

      // Validate directory exists before spawning CC (avoids confusing 500 ENOENT)
      if (!existsSync(projectDir)) {
        log.warn({ projectDir }, 'Project directory does not exist');
        return reply.code(400).send({
          error: {
            message: `Project directory does not exist: ${projectDir}`,
            type: 'invalid_request',
            code: 'PROJECT_DIR_NOT_FOUND',
          },
        });
      }

      // Bug #13: Unique session storage per conversation to prevent MEMORY.md cross-contamination.
      // CC stores ~/.claude/projects/{encoded-cwd}/memory/MEMORY.md using cwd as project key.
      // By using a unique dir per conversationId, each conversation gets isolated memory.
      // --dangerously-skip-permissions ensures CC can still access original project files.
      const sessionStorageDir = `/tmp/bridge-sessions/${conversationId}`;
      mkdirSync(sessionStorageDir, { recursive: true });

      const sessionId =
        (request.headers['x-session-id'] as string | undefined) ??
        body.metadata?.session_id ??
        undefined;

      // WORK-04: Read X-Worktree header to opt into worktree isolation
      const worktreeIsolation = (request.headers['x-worktree'] as string | undefined) === 'true';
      const worktreeName = (request.headers['x-branch'] as string | undefined);
      // ORC-ISO-01: Read X-Orchestrator-Id header for orchestrator session isolation
      const orchestratorId = (request.headers['x-orchestrator-id'] as string | undefined);

      const isStream = body.stream === true;

      log.info({ conversationId, model: body.model, stream: isStream, projectDir, sessionStorageDir, worktree: worktreeIsolation }, 'Chat completion request');

      let result: Awaited<ReturnType<typeof routeMessage>>;
      try {
        result = await routeMessage(body, { conversationId, projectDir, sessionId, worktree: worktreeIsolation, worktreeName, orchestratorId });
      } catch (err) {
        log.error({ err }, 'Failed to route message');
        return reply.code(500).send({ error: { message: `Failed to route message: ${String(err)}`, type: 'internal_error' } });
      }

      const completionId = `chatcmpl-${randomUUID().replace(/-/g, '')}`;

      // ---- Streaming response ----
      if (isStream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Conversation-Id', result.conversationId);
        reply.raw.setHeader('X-Session-Id', result.sessionId);
        reply.raw.flushHeaders?.();

        const sendSSE = (data: string) => {
          if (!reply.raw.writableEnded) reply.raw.write(`data: ${data}\n\n`);
        };

        const killOnDisconnect = () => {
          log.info({ conversationId }, 'Client disconnected — killing active CC process');
          claudeManager.killActiveProcess(conversationId);
        };
        reply.raw.on('close', killOnDisconnect);

        const sseCollected: string[] = [];
        try {
          for await (const chunk of result.stream) {
            if (chunk.type === 'text') {
              sseCollected.push(chunk.text);
              sendSSE(JSON.stringify({ id: completionId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model ?? config.claudeModel, choices: [{ index: 0, delta: { role: 'assistant', content: chunk.text }, finish_reason: null }] }));
            } else if (chunk.type === 'error') {
              sendSSE(JSON.stringify({ id: completionId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model ?? config.claudeModel, choices: [{ index: 0, delta: { role: 'assistant', content: `[ERROR: ${chunk.error}]` }, finish_reason: 'stop' }] }));
            } else if (chunk.type === 'done') {
              sendSSE(JSON.stringify({ id: completionId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model ?? config.claudeModel, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: chunk.usage ?? null }));
            }
          }
          // Emit bridge metadata for pattern-aware clients (before [DONE])
          const sseFullText = sseCollected.join('');
          const ssePatterns = matchPatterns(sseFullText);
          if (ssePatterns.length > 0) {
            sendSSE(JSON.stringify({ type: 'bridge_meta', patterns: ssePatterns.map((p) => p.key), blocking: isBlocking(sseFullText) }));
          }
        } catch (err: unknown) {
          log.error({ err }, 'Stream error during chat completion');
          const errLabel = (err as { code?: string }).code === 'CONCURRENT_LIMIT'
            ? `[RATE_LIMIT] ${String(err)}`
            : `[STREAM ERROR: ${String(err)}]`;
          sendSSE(JSON.stringify({ id: completionId, object: 'chat.completion.chunk', choices: [{ delta: { content: errLabel }, finish_reason: 'stop' }] }));
        } finally {
          reply.raw.removeListener('close', killOnDisconnect);
          if (!reply.raw.writableEnded) {
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
          }
        }
        return;
      }

      // ---- Non-streaming response ----
      const textChunks: string[] = [];
      let usage: { input_tokens: number; output_tokens: number } | undefined;
      let hasError = false;

      try {
        for await (const chunk of result.stream) {
          if (chunk.type === 'text') textChunks.push(chunk.text);
          else if (chunk.type === 'error') { textChunks.push(`[ERROR: ${chunk.error}]`); hasError = true; }
          else if (chunk.type === 'done') usage = chunk.usage;
        }
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'CONCURRENT_LIMIT') {
          return reply.code(429).send({ error: { message: String(err), type: 'rate_limit_error', code: 'CONCURRENT_LIMIT' } });
        }
        log.error({ err }, 'Error collecting stream for non-streaming response');
        return reply.code(500).send({ error: { message: `Stream error: ${String(err)}`, type: 'internal_error' } });
      }

      const fullText = textChunks.join('');
      const detectedPatterns = matchPatterns(fullText);
      const replyBase = reply
        .code(hasError ? 500 : 200)
        .header('X-Conversation-Id', result.conversationId)
        .header('X-Session-Id', result.sessionId);
      if (detectedPatterns.length > 0) {
        replyBase.header('X-Bridge-Pattern', detectedPatterns.map((p) => p.key).join(','));
        if (isBlocking(fullText)) replyBase.header('X-Bridge-Blocking', 'true');
      }
      return replyBase.send({
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? config.claudeModel,
        choices: [{ index: 0, message: { role: 'assistant', content: fullText }, finish_reason: 'stop' }],
        usage: usage ? { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: usage.input_tokens + usage.output_tokens } : undefined,
      });
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/sessions/disk — list all CC sessions on disk
  // ------------------------------------------------------------------
  app.get(
    '/v1/sessions/disk',
    async (request: FastifyRequest<{ Querystring: { project_dir?: string; limit?: string } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const projectDir = (request.query as { project_dir?: string }).project_dir ?? config.defaultProjectDir;
      const limit = parseInt((request.query as { limit?: string }).limit ?? '50', 10);
      const sessions = await claudeManager.listDiskSessions(projectDir);
      return reply.code(200).send({ project_dir: projectDir, total: sessions.length, sessions: sessions.slice(0, limit) });
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/sessions/pending — sessions waiting for human input
  // ------------------------------------------------------------------
  app.get('/v1/sessions/pending', async (request, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    const pendingSessions = claudeManager.getPendingSessions();
    return reply.code(200).send({
      pending: pendingSessions.map((s) => ({
        conversationId: s.conversationId,
        sessionId: s.sessionId,
        pattern: s.pendingApproval.pattern,
        text: s.pendingApproval.text,
        detectedAt: s.pendingApproval.detectedAt,
        waitingFor: `${Math.round((Date.now() - s.pendingApproval.detectedAt) / 1000)}s`,
      })),
    });
  });

  // ------------------------------------------------------------------
  // POST /v1/sessions/:id/respond — inject user response into pending session
  // ------------------------------------------------------------------
  app.post(
    '/v1/sessions/:id/respond',
    async (request: FastifyRequest<{ Params: { id: string }; Body: { message?: string } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const { id } = request.params;
      const body = request.body as { message?: string } | null;
      const message = body?.message;

      // Validate message
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return reply.code(400).send({ error: { message: 'message is required and must be a non-empty string', type: 'invalid_request' } });
      }

      // Find session by conversationId or sessionId
      let conversationId = id;
      if (!claudeManager.getSession(id)) {
        const found = claudeManager.findBySessionId(id);
        if (found) conversationId = found;
        else return reply.code(404).send({ error: { message: `Session not found: ${id}`, type: 'not_found' } });
      }

      // Check if session is pending
      const sessionInfo = claudeManager.getSession(conversationId);
      if (!sessionInfo?.pendingApproval) {
        return reply.code(409).send({ error: { message: 'Session is not pending approval', type: 'conflict' } });
      }

      // Clear pending and inject message
      claudeManager.clearPendingApproval(conversationId);

      const projectDir = sessionInfo.projectDir;
      const sessionId = sessionInfo.sessionId;

      // Interactive mode: write directly to stdin (no new process spawn)
      if (claudeManager.isInteractive(conversationId)) {
        const ok = claudeManager.writeToSession(conversationId, message.trim());
        if (!ok) {
          return reply.code(500).send({ error: { message: 'Failed to write to interactive session', type: 'internal_error' } });
        }
      } else {
        // Spawn-per-message: fire-and-forget via send()
        setImmediate(async () => {
          try {
            for await (const _chunk of claudeManager.send(conversationId, message.trim(), projectDir)) {
              // Drain stream
            }
          } catch (err) {
            logger.warn({ conversationId, err: String(err) }, 'Failed to inject respond message');
            eventBus.emit('session.error', {
              type: 'session.error',
              conversationId,
              sessionId,
              projectDir,
              error: `respond injection failed: ${String(err)}`,
              timestamp: new Date().toISOString(),
            });
          }
        });
      }

      return reply.code(RESPOND_SUCCESS_STATUS).send({
        status: 'resumed',
        conversationId,
        sessionId: sessionInfo.sessionId,
      });
    },
  );

  // ------------------------------------------------------------------
  // POST /v1/webhooks — register a new webhook
  // ------------------------------------------------------------------
  app.post(
    '/v1/webhooks',
    async (request: FastifyRequest<{ Body: { url?: string; secret?: string; events?: string[] } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const body = request.body as { url?: string; secret?: string; events?: string[] } | null;
      const url = body?.url;

      if (!url || typeof url !== 'string' || url.trim().length === 0) {
        return reply.code(400).send({ error: { message: 'url is required', type: 'invalid_request' } });
      }

      try {
        const webhook = webhookStore.register({
          url: url.trim(),
          secret: body?.secret,
          events: body?.events,
        });
        return reply.code(201).send(webhook);
      } catch (err) {
        return reply.code(400).send({ error: { message: String(err instanceof Error ? err.message : err), type: 'invalid_request' } });
      }
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/webhooks — list all registered webhooks
  // ------------------------------------------------------------------
  app.get('/v1/webhooks', async (request, reply) => {
    if (!verifyBearerToken(request, reply)) return;
    const webhooks = webhookStore.list();
    return reply.code(200).send({
      webhooks: webhooks.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        createdAt: w.createdAt,
        // Never expose secret in list response
        hasSecret: w.secret !== null,
      })),
      total: webhooks.length,
    });
  });

  // ------------------------------------------------------------------
  // DELETE /v1/webhooks/:id — remove a webhook
  // ------------------------------------------------------------------
  app.delete(
    '/v1/webhooks/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const { id } = request.params;
      const deleted = webhookStore.delete(id);
      if (!deleted) {
        return reply.code(404).send({ error: { message: `Webhook not found: ${id}`, type: 'not_found' } });
      }
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/events — event polling (wraps EventReplayBuffer for MCP/non-SSE clients)
  // ------------------------------------------------------------------
  app.get(
    '/v1/events',
    async (
      request: FastifyRequest<{ Querystring: { since_id?: string; limit?: string; project_dir?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!verifyBearerToken(request, reply)) return;
      const sinceId = parseInt(request.query.since_id ?? '0', 10);
      const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 200);
      const projectDir = request.query.project_dir;

      const all = replayBuffer.since(sinceId);
      const filtered = projectDir
        ? all.filter((e) => !('projectDir' in e) || (e as { projectDir?: string }).projectDir === projectDir)
        : all;
      const events = filtered.slice(0, limit);

      return reply.code(200).send({ events, count: events.length, since_id: sinceId });
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/notifications/stream — SSE real-time notification stream
  // ------------------------------------------------------------------
  const MAX_SSE_CLIENTS = 10;
  const SSE_HEARTBEAT_MS = 15_000;
  let sseClientCount = 0;

  app.get('/v1/notifications/stream', async (request, reply) => {
    // Support query param auth for SSE (EventSource cannot set custom headers)
    const queryToken = (request.query as Record<string, string>)?.token;
    if (queryToken) {
      request.headers.authorization = `Bearer ${queryToken}`;
    }
    if (!verifyBearerToken(request, reply)) return;

    if (sseClientCount >= MAX_SSE_CLIENTS) {
      return reply.code(429).send({
        error: { message: `Too many SSE clients (${sseClientCount}/${MAX_SSE_CLIENTS})`, type: 'rate_limit_error' },
      });
    }

    sseClientCount++;
    const clientId = `sse-${Date.now()}`;
    const log = logger.child({ clientId, route: 'notifications/stream' });
    log.info({ sseClientCount }, 'SSE client connected');

    // Set SSE headers
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    reply.raw.flushHeaders?.();

    const writeSse = (eventType: string, data: unknown, eventId?: number) => {
      if (!reply.raw.writableEnded) {
        let frame = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n`;
        if (eventId !== undefined) {
          frame += `id: ${eventId}\n`;
        }
        frame += '\n';
        reply.raw.write(frame);
      }
    };

    // Parse project_dir query param for project-level filtering
    const filterProjectDir = (request.query as { project_dir?: string; orchestrator_id?: string }).project_dir ?? null;
    // Parse orchestrator_id query param for orchestrator-level isolation (ORC-ISO-03)
    const filterOrchestratorId = (request.query as { project_dir?: string; orchestrator_id?: string }).orchestrator_id ?? null;

    // Parse Last-Event-ID header for missed-event replay on reconnect
    const lastEventIdRaw = request.headers['last-event-id'];
    const lastEventId = typeof lastEventIdRaw === 'string' ? parseInt(lastEventIdRaw, 10) : NaN;

    // Replay missed events before subscribing to live events
    let replayedCount = 0;
    if (!isNaN(lastEventId)) {
      const missed = replayBuffer.since(lastEventId);
      for (const event of missed) {
        if (filterProjectDir && 'projectDir' in event && event.projectDir !== filterProjectDir) continue;
        if (
          filterOrchestratorId &&
          'orchestratorId' in event &&
          event.orchestratorId !== undefined &&
          event.orchestratorId !== filterOrchestratorId
        ) continue;
        writeSse(event.type, event, event.id);
        replayedCount++;
      }
    }

    // Send initial connected event
    writeSse('connected', {
      clientId,
      projectFilter: filterProjectDir,
      orchestratorFilter: filterOrchestratorId,
      replayedCount,
      timestamp: new Date().toISOString(),
    });

    // Emit retry: hint — tells client how long to wait before reconnecting (SSE spec)
    const retryMs = Number(process.env.SSE_RETRY_MS) || 3000;
    reply.raw.write(`retry: ${retryMs}\n\n`);

    // Heartbeat timer
    const heartbeat = setInterval(() => {
      writeSse('heartbeat', { timestamp: new Date().toISOString() });
    }, SSE_HEARTBEAT_MS);

    // Subscribe to all bridge events
    const eventListener = (event: BridgeEvent) => {
      // If project filter set, only forward matching events
      if (filterProjectDir && 'projectDir' in event && event.projectDir !== filterProjectDir) {
        return; // Skip — different project
      }
      // Orchestrator isolation filter (ORC-ISO-03/04):
      // Skip only if: filter active AND event IS tagged AND tags differ.
      // Events without orchestratorId are always delivered (untagged = global broadcast).
      if (
        filterOrchestratorId &&
        'orchestratorId' in event &&
        event.orchestratorId !== undefined &&
        event.orchestratorId !== filterOrchestratorId
      ) {
        return; // Skip — different orchestrator session
      }
      writeSse(event.type, event, (event as BufferedEvent).id);
    };
    eventBus.onAny(eventListener);

    // FIX 3 (audit): Cleanup guard — prevent double-decrement when both
    // idle timeout and 'close' event trigger cleanup()
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      eventBus.offAny(eventListener);
      sseClientCount--;
      log.info({ sseClientCount }, 'SSE client disconnected');
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    };

    reply.raw.on('close', cleanup);

    // Idle timeout: close connection after 5 min of no bridge events
    let idleTimeout = setTimeout(cleanup, 5 * 60 * 1000);
    const resetIdle = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(cleanup, 5 * 60 * 1000);
    };

    // Reset idle only when event matches this connection's filter (P1-4)
    const idleResetListener = (event: BridgeEvent) => {
      if (shouldResetIdle(event, filterProjectDir, filterOrchestratorId)) {
        resetIdle();
      }
    };
    eventBus.onAny(idleResetListener);

    // Also clean up the idle reset listener on close
    reply.raw.on('close', () => {
      clearTimeout(idleTimeout);
      eventBus.offAny(idleResetListener);
    });

    // Don't send a response — keep connection open (SSE)
    // Fastify needs to know we're handling this ourselves
    return reply;
  });

  // ------------------------------------------------------------------
  // POST /v1/sessions/:id/pause
  // ------------------------------------------------------------------
  app.post(
    '/v1/sessions/:id/pause',
    async (request: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const { id } = request.params;
      const reason = (request.body as { reason?: string })?.reason;
      let conversationId = id;
      if (!claudeManager.getSession(id)) {
        const found = claudeManager.findBySessionId(id);
        if (found) conversationId = found;
        else return reply.code(404).send({ error: `Session not found: ${id}` });
      }
      const result = claudeManager.pause(conversationId, reason);
      if (!result) return reply.code(404).send({ error: `Session not found: ${conversationId}` });
      return reply.code(200).send({ message: 'Session paused — bridge will not send new messages', conversationId, sessionId: result.sessionId, resumeCommand: result.resumeCommand, tip: 'Run the resumeCommand in your terminal to take over. POST /v1/sessions/:id/handback when done.' });
    },
  );

  // ------------------------------------------------------------------
  // POST /v1/sessions/:id/handback
  // ------------------------------------------------------------------
  app.post(
    '/v1/sessions/:id/handback',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const { id } = request.params;
      let conversationId = id;
      if (!claudeManager.getSession(id)) {
        const found = claudeManager.findBySessionId(id);
        if (found) conversationId = found;
        else return reply.code(404).send({ error: `Session not found: ${id}` });
      }
      const ok = await claudeManager.handback(conversationId);
      if (!ok) return reply.code(404).send({ error: `Session not found: ${conversationId}` });
      return reply.code(200).send({ message: 'Session handed back to bridge — normal operation resumed', conversationId });
    },
  );

  // ------------------------------------------------------------------
  // PUT /v1/sessions/:id/config — set session config overrides
  // ------------------------------------------------------------------
  app.put(
    '/v1/sessions/:id/config',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { model?: string; effort?: string; additionalDirs?: string[]; permissionMode?: string; fast?: boolean };
      }>,
      reply: FastifyReply,
    ) => {
      if (!verifyBearerToken(request, reply)) return;
      const { id } = request.params;

      // Resolve conversationId
      let conversationId = id;
      if (!claudeManager.getSession(id)) {
        const found = claudeManager.findBySessionId(id);
        if (found) conversationId = found;
        else return reply.code(404).send({ error: { message: `Session not found: ${id}`, type: 'not_found' } });
      }

      // Validate project_dir match if X-Project-Dir header is provided
      const requestProjectDir = (request.headers['x-project-dir'] as string | undefined) ?? null;
      const session = claudeManager.getSession(conversationId);
      if (requestProjectDir && session && session.projectDir !== requestProjectDir) {
        return reply.code(404).send({
          error: {
            message: `Session ${id} belongs to project ${session.projectDir}, not ${requestProjectDir}`,
            type: 'not_found',
          },
        });
      }

      const body = (request.body ?? {}) as Record<string, unknown>;

      // Type validation — prevents bugs, not restrictions
      if (body.model !== undefined && typeof body.model !== 'string') {
        return reply.code(400).send({ error: { message: 'model must be a string', type: 'invalid_request' } });
      }
      if (body.effort !== undefined && typeof body.effort !== 'string') {
        return reply.code(400).send({ error: { message: 'effort must be a string', type: 'invalid_request' } });
      }
      if (body.additionalDirs !== undefined && (!Array.isArray(body.additionalDirs) || !body.additionalDirs.every((d: unknown) => typeof d === 'string'))) {
        return reply.code(400).send({ error: { message: 'additionalDirs must be a string array', type: 'invalid_request' } });
      }
      if (body.permissionMode !== undefined && typeof body.permissionMode !== 'string') {
        return reply.code(400).send({ error: { message: 'permissionMode must be a string', type: 'invalid_request' } });
      }
      if (body.fast !== undefined && typeof body.fast !== 'boolean') {
        return reply.code(400).send({ error: { message: 'fast must be a boolean', type: 'invalid_request' } });
      }

      const overrides: Record<string, unknown> = {};
      if (body.model !== undefined) overrides.model = body.model;
      if (body.effort !== undefined) overrides.effort = body.effort;
      if (body.additionalDirs !== undefined) overrides.additionalDirs = body.additionalDirs;
      if (body.permissionMode !== undefined) overrides.permissionMode = body.permissionMode;
      if (body.fast !== undefined) overrides.fast = body.fast;

      claudeManager.setConfigOverrides(conversationId, overrides);
      const merged = claudeManager.getConfigOverrides(conversationId);
      return reply.code(200).send({ ok: true, conversationId, projectDir: session?.projectDir, overrides: merged });
    },
  );

  // ------------------------------------------------------------------
  // GET /v1/sessions/:id/usage — session stats
  // ------------------------------------------------------------------
  app.get(
    '/v1/sessions/:id/usage',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const { id } = request.params;

      // Resolve conversationId
      let conversationId = id;
      if (!claudeManager.getSession(id)) {
        const found = claudeManager.findBySessionId(id);
        if (found) conversationId = found;
        else return reply.code(404).send({ error: { message: `Session not found: ${id}`, type: 'not_found' } });
      }

      const session = claudeManager.getSession(conversationId)!;
      const overrides = claudeManager.getConfigOverrides(conversationId);
      const displayName = claudeManager.getDisplayName(conversationId);
      const pauseStatus = claudeManager.isPaused(conversationId);

      return reply.code(200).send({
        conversationId,
        sessionId: session.sessionId,
        displayName,
        processAlive: session.processAlive,
        tokensUsed: session.tokensUsed,
        budgetUsed: session.budgetUsed,
        lastActivity: session.lastActivity.toISOString(),
        projectDir: session.projectDir,
        configOverrides: overrides,
        paused: pauseStatus.paused,
        pendingApproval: session.pendingApproval,
      });
    },
  );

  // ------------------------------------------------------------------
  // DELETE /v1/sessions/:conversationId
  // ------------------------------------------------------------------
  app.delete(
    '/v1/sessions/:conversationId',
    async (request: FastifyRequest<{ Params: { conversationId: string } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const { conversationId } = request.params;
      const session = claudeManager.getSession(conversationId);
      if (!session) return reply.code(404).send({ error: `Session not found: ${conversationId}` });
      claudeManager.terminate(conversationId);
      return reply.code(200).send({ message: 'Session terminated', conversationId });
    },
  );

  // ------------------------------------------------------------------
  // POST /v1/sessions/start-interactive — Phase 4b
  // ------------------------------------------------------------------
  app.post(
    '/v1/sessions/start-interactive',
    async (
      request: FastifyRequest<{
        Body: { project_dir?: string; system_prompt?: string; max_turns?: number };
      }>,
      reply: FastifyReply,
    ) => {
      if (!verifyBearerToken(request, reply)) return;

      const body = request.body as { project_dir?: string; system_prompt?: string; max_turns?: number } | null;
      // FIX 2 (audit): Sanitize conversationId for start-interactive too
      const rawConversationId =
        (request.headers['x-conversation-id'] as string | undefined) ?? `interactive-${Date.now()}`;
      const conversationId = rawConversationId.replace(/[^a-zA-Z0-9_-]/g, '');

      const rawProjectDir = body?.project_dir ?? config.defaultProjectDir;
      const resolvedProjectDir = resolve(rawProjectDir);
      const resolvedNorm = resolvedProjectDir.endsWith('/') ? resolvedProjectDir : resolvedProjectDir + '/';
      const isUnderHome = resolvedNorm.startsWith('/home/ayaz/');
      const firstSegment = resolvedNorm.slice('/home/ayaz/'.length).split('/')[0];
      const isHomeDotDir = isUnderHome && firstSegment.startsWith('.');
      const ALLOWED_PROJECT_PREFIXES = ['/home/ayaz/', '/tmp/'];
      const isAllowedDir =
        !isHomeDotDir &&
        ALLOWED_PROJECT_PREFIXES.some((prefix) => resolvedNorm.startsWith(prefix));
      if (!isAllowedDir) {
        return reply.code(400).send({ error: { message: 'project_dir must be within allowed directories', type: 'invalid_request' } });
      }

      // Bug #13 isolation: unique storage dir per conversation
      const sessionStorageDir = `/tmp/bridge-sessions/${conversationId}`;
      mkdirSync(sessionStorageDir, { recursive: true });

      try {
        const result = await claudeManager.startInteractive(conversationId, {
          projectDir: sessionStorageDir,
          systemPrompt: body?.system_prompt,
          maxTurns: body?.max_turns,
        });
        return reply.code(200).send({
          status: 'interactive',
          conversationId: result.conversationId,
          sessionId: result.sessionId,
          pid: result.pid,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = msg.includes('Too many') ? 429 : 409;
        return reply.code(code).send({ error: { message: msg, type: code === 429 ? 'rate_limit_error' : 'conflict' } });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /v1/sessions/:id/input — write to interactive stdin (Phase 4b)
  // ------------------------------------------------------------------
  app.post(
    '/v1/sessions/:id/input',
    async (request: FastifyRequest<{ Params: { id: string }; Body: { message?: string } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const { id } = request.params;
      const body = request.body as { message?: string } | null;
      const message = body?.message;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return reply.code(400).send({ error: { message: 'message is required and must be a non-empty string', type: 'invalid_request' } });
      }

      // Resolve conversation ID
      let conversationId = id;
      if (!claudeManager.getSession(id)) {
        const found = claudeManager.findBySessionId(id);
        if (found) conversationId = found;
        else return reply.code(404).send({ error: { message: `Session not found: ${id}`, type: 'not_found' } });
      }

      if (!claudeManager.isInteractive(conversationId)) {
        return reply.code(409).send({ error: { message: 'Session is not in interactive mode. Use POST /v1/sessions/start-interactive first.', type: 'conflict' } });
      }

      const ok = claudeManager.writeToSession(conversationId, message.trim());
      if (!ok) {
        return reply.code(500).send({ error: { message: 'Failed to write to interactive session', type: 'internal_error' } });
      }

      const sessionInfo = claudeManager.getSession(conversationId);
      return reply.code(200).send({
        status: 'sent',
        conversationId,
        sessionId: sessionInfo?.sessionId ?? '',
      });
    },
  );

  // ------------------------------------------------------------------
  // POST /v1/sessions/:id/close-interactive — Phase 4b
  // ------------------------------------------------------------------
  app.post(
    '/v1/sessions/:id/close-interactive',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;
      const { id } = request.params;

      let conversationId = id;
      if (!claudeManager.getSession(id)) {
        const found = claudeManager.findBySessionId(id);
        if (found) conversationId = found;
        else return reply.code(404).send({ error: { message: `Session not found: ${id}`, type: 'not_found' } });
      }

      if (!claudeManager.isInteractive(conversationId)) {
        return reply.code(409).send({ error: { message: 'Session is not in interactive mode', type: 'conflict' } });
      }

      const closed = await claudeManager.closeInteractive(conversationId);
      if (!closed) {
        return reply.code(500).send({ error: { message: 'Failed to close interactive session', type: 'internal_error' } });
      }

      return reply.code(200).send({
        status: 'closed',
        conversationId,
      });
    },
  );

  // ------------------------------------------------------------------
  // POST /v1/opencode/chat/completions — OpenCode spawn (non-streaming)
  // Mirrors /v1/chat/completions but uses OpenCode instead of Claude Code.
  // ------------------------------------------------------------------
  app.post(
    '/v1/opencode/chat/completions',
    async (request: FastifyRequest<{ Body: ChatCompletionRequest }>, reply: FastifyReply) => {
      if (!verifyBearerToken(request, reply)) return;

      const body = request.body;
      const log = logger.child({ route: 'opencode/chat/completions' });

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return reply.code(400).send({
          error: { message: 'messages array is required and must not be empty', type: 'invalid_request' },
        });
      }

      const msgContent = body.messages[0]?.content;
      if (!msgContent || (typeof msgContent === 'string' && !msgContent.trim())) {
        return reply.code(400).send({
          error: { message: 'Message content cannot be empty', type: 'invalid_request' },
        });
      }

      const rawConversationId =
        (request.headers['x-conversation-id'] as string | undefined) ??
        body.metadata?.conversation_id ??
        randomUUID();
      const conversationId = rawConversationId.replace(/[^a-zA-Z0-9_-]/g, '');

      const rawProjectDir =
        (request.headers['x-project-dir'] as string | undefined) ??
        body.metadata?.project_dir ??
        config.defaultProjectDir;

      const ALLOWED_PROJECT_PREFIXES = ['/home/ayaz/', '/tmp/'];
      const resolvedProjectDir = resolve(rawProjectDir);
      const resolvedNorm = resolvedProjectDir.endsWith('/') ? resolvedProjectDir : resolvedProjectDir + '/';
      const isUnderHome = resolvedNorm.startsWith('/home/ayaz/');
      const firstSegment = resolvedNorm.slice('/home/ayaz/'.length).split('/')[0];
      const isHomeDotDir = isUnderHome && firstSegment?.startsWith('.');
      const isAllowedDir =
        !isHomeDotDir &&
        ALLOWED_PROJECT_PREFIXES.some((prefix) => resolvedNorm.startsWith(prefix));
      if (!isAllowedDir) {
        log.warn({ rawProjectDir, resolvedProjectDir }, 'Path traversal attempt blocked (opencode)');
        return reply.code(400).send({
          error: {
            message: 'X-Project-Dir must be within allowed directories (/home/ayaz/ or /tmp/)',
            type: 'invalid_request',
            code: 'PATH_TRAVERSAL_BLOCKED',
          },
        });
      }

      if (!existsSync(resolvedProjectDir)) {
        return reply.code(400).send({
          error: {
            message: `Project directory does not exist: ${resolvedProjectDir}`,
            type: 'invalid_request',
            code: 'PROJECT_DIR_NOT_FOUND',
          },
        });
      }

      const model = (body.model && body.model !== 'bridge-model') ? body.model : config.opencodeModel;
      const completionId = `ocode-${randomUUID().replace(/-/g, '')}`;

      // Recursive loop protection: limit concurrent OpenCode spawns
      if (activeOpenCodeSpawns >= MAX_CONCURRENT_OPENCODE_SPAWNS) {
        log.warn({ activeOpenCodeSpawns, MAX_CONCURRENT_OPENCODE_SPAWNS }, 'OpenCode spawn limit reached');
        return reply.code(429).send({
          error: {
            message: `Too many concurrent OpenCode spawns (max ${MAX_CONCURRENT_OPENCODE_SPAWNS}). Prevents recursive spawn loops. Active: ${activeOpenCodeSpawns}`,
            type: 'rate_limit_error',
            code: 'OPENCODE_SPAWN_LIMIT',
          },
        });
      }

      log.info({ conversationId, model, projectDir: resolvedProjectDir, activeOpenCodeSpawns }, 'OpenCode chat completion request');

      const textChunks: string[] = [];
      let hasError = false;

      activeOpenCodeSpawns++;
      try {
        for await (const chunk of openCodeManager.send(conversationId, msgContent, resolvedProjectDir, model)) {
          if (chunk.type === 'text') textChunks.push(chunk.text);
          else if (chunk.type === 'error') { textChunks.push(`[ERROR: ${chunk.error}]`); hasError = true; }
        }
      } catch (err: unknown) {
        log.error({ err }, 'Error collecting OpenCode stream');
        return reply.code(500).send({ error: { message: `OpenCode stream error: ${String(err)}`, type: 'internal_error' } });
      } finally {
        activeOpenCodeSpawns--;
      }

      const fullText = textChunks.join('');
      const sessionInfo = openCodeManager.getSession(conversationId);

      return reply
        .code(hasError ? 500 : 200)
        .header('X-Conversation-Id', conversationId)
        .header('X-Session-Id', sessionInfo?.openCodeSessionId ?? '')
        .send({
          id: completionId,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: `opencode/${model}`,
          choices: [{ index: 0, message: { role: 'assistant', content: fullText }, finish_reason: 'stop' }],
        });
    },
  );
}
