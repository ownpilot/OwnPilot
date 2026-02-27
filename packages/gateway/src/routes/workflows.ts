/**
 * Workflow Routes
 *
 * CRUD + execution endpoints for visual DAG tool pipelines.
 * Execution streams progress via SSE for real-time node visualization.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getServiceRegistry, Services } from '@ownpilot/core';
import {
  getUserId,
  apiResponse,
  apiError,
  notFoundError,
  getErrorMessage,
  sanitizeId,
  parseJsonBody,
  safeKeyCompare,
} from './helpers.js';
import { ERROR_CODES } from './error-codes.js';
import { createWorkflowsRepository } from '../db/repositories/workflows.js';
import { createWorkflowApprovalsRepository } from '../db/repositories/workflow-approvals.js';
import { topologicalSort } from '../services/workflow-service.js';
import { wsGateway } from '../ws/server.js';
import { validateBody } from '../middleware/validation.js';
import { createWorkflowSchema, updateWorkflowSchema } from '../middleware/validation.js';
import { workflowCopilotRoute } from './workflow-copilot.js';
import { pagination } from '../middleware/pagination.js';

// ============================================================================
// Semantic Validation (beyond Zod shape checks)
// ============================================================================

interface WfNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}
interface WfEdge {
  source: string;
  target: string;
  sourceHandle?: string;
}

/**
 * Validate workflow-level semantic constraints that Zod can't express.
 * Returns an array of error messages (empty = valid).
 */
function validateWorkflowSemantics(nodes: WfNode[], edges: WfEdge[]): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  // ── Max 1 trigger ──
  const triggers = nodes.filter((n) => n.type === 'triggerNode');
  if (triggers.length > 1) {
    errors.push(`Only one trigger node allowed (found ${triggers.length})`);
  }

  // ── Max 1 error handler ──
  const errorHandlers = nodes.filter((n) => n.type === 'errorHandlerNode');
  if (errorHandlers.length > 1) {
    errors.push(`Only one error handler node allowed (found ${errorHandlers.length})`);
  }

  // ── Per-node required fields ──
  for (const node of nodes) {
    const d = node.data;
    switch (node.type) {
      case 'llmNode':
        if (!d.provider) errors.push(`Node "${node.id}": LLM node requires "provider"`);
        if (!d.model) errors.push(`Node "${node.id}": LLM node requires "model"`);
        if (!d.userMessage) errors.push(`Node "${node.id}": LLM node requires "userMessage"`);
        break;
      case 'conditionNode':
        if (!d.expression) errors.push(`Node "${node.id}": Condition node requires "expression"`);
        break;
      case 'codeNode':
        if (!d.language) errors.push(`Node "${node.id}": Code node requires "language"`);
        if (!d.code) errors.push(`Node "${node.id}": Code node requires "code"`);
        break;
      case 'transformerNode':
        if (!d.expression) errors.push(`Node "${node.id}": Transformer node requires "expression"`);
        break;
      case 'forEachNode':
        if (!d.arrayExpression)
          errors.push(`Node "${node.id}": ForEach node requires "arrayExpression"`);
        break;
      case 'httpRequestNode':
        if (!d.method) errors.push(`Node "${node.id}": HTTP Request node requires "method"`);
        if (!d.url) errors.push(`Node "${node.id}": HTTP Request node requires "url"`);
        break;
      case 'delayNode':
        if (!d.duration) errors.push(`Node "${node.id}": Delay node requires "duration"`);
        if (!d.unit) errors.push(`Node "${node.id}": Delay node requires "unit"`);
        break;
      case 'switchNode':
        if (!d.expression) errors.push(`Node "${node.id}": Switch node requires "expression"`);
        if (!Array.isArray(d.cases) || d.cases.length === 0)
          errors.push(`Node "${node.id}": Switch node requires at least one case`);
        break;
      case 'toolNode':
        if (!d.toolName) errors.push(`Node "${node.id}": Tool node requires "toolName"`);
        break;
      case 'subWorkflowNode':
        if (!d.subWorkflowId)
          errors.push(`Node "${node.id}": Sub-workflow node requires a target workflow`);
        break;
      case 'notificationNode':
        if (!d.message)
          errors.push(`Node "${node.id}": Notification node requires "message"`);
        break;
      case 'parallelNode':
        if (typeof d.branchCount !== 'number' || d.branchCount < 2)
          errors.push(`Node "${node.id}": Parallel node requires "branchCount" >= 2`);
        break;
    }

    // ── Common field range checks ──
    if (d) {
      if (typeof d.retryCount === 'number' && (d.retryCount < 0 || d.retryCount > 5)) {
        errors.push(`Node "${node.id}": retryCount must be between 0 and 5`);
      }
      if (typeof d.timeoutMs === 'number' && (d.timeoutMs < 0 || d.timeoutMs > 300000)) {
        errors.push(`Node "${node.id}": timeoutMs must be between 0 and 300000`);
      }
    }
  }

  // ── Edge reference validation ──
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge source "${edge.source}" references non-existent node`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge target "${edge.target}" references non-existent node`);
    }
  }

  // ── Branching edge sourceHandle validation ──
  const branchingNodes = new Map<string, WfNode>();
  for (const node of nodes) {
    if (['conditionNode', 'forEachNode', 'switchNode', 'parallelNode'].includes(node.type)) {
      branchingNodes.set(node.id, node);
    }
  }

  for (const edge of edges) {
    const branchNode = branchingNodes.get(edge.source);
    if (!branchNode) continue;

    if (!edge.sourceHandle) {
      errors.push(
        `Edge from "${edge.source}" (${branchNode.type}) requires a sourceHandle`
      );
      continue;
    }

    if (branchNode.type === 'conditionNode') {
      if (edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false') {
        errors.push(
          `Edge from condition "${edge.source}" has invalid sourceHandle "${edge.sourceHandle}" (must be "true" or "false")`
        );
      }
    } else if (branchNode.type === 'forEachNode') {
      if (edge.sourceHandle !== 'each' && edge.sourceHandle !== 'done') {
        errors.push(
          `Edge from forEach "${edge.source}" has invalid sourceHandle "${edge.sourceHandle}" (must be "each" or "done")`
        );
      }
    } else if (branchNode.type === 'switchNode') {
      const cases = branchNode.data.cases as Array<{ label: string }> | undefined;
      const validHandles = new Set(cases?.map((c) => c.label) ?? []);
      validHandles.add('default');
      if (!validHandles.has(edge.sourceHandle)) {
        errors.push(
          `Edge from switch "${edge.source}" has invalid sourceHandle "${edge.sourceHandle}" (must be a case label or "default")`
        );
      }
    } else if (branchNode.type === 'parallelNode') {
      const branchCount = (branchNode.data.branchCount as number) || 2;
      const validHandles = new Set(Array.from({ length: branchCount }, (_, i) => `branch-${i}`));
      if (!validHandles.has(edge.sourceHandle)) {
        errors.push(
          `Edge from parallel "${edge.source}" has invalid sourceHandle "${edge.sourceHandle}" (must be "branch-0" to "branch-${branchCount - 1}")`
        );
      }
    }
  }

  // ── Output alias validation ──
  const RESERVED_ALIASES = new Set(['variables', 'workflow', 'trigger', 'webhook']);
  const aliasMap = new Map<string, string>(); // alias -> nodeId
  for (const node of nodes) {
    const alias = (node.data as Record<string, unknown>).outputAlias;
    if (typeof alias !== 'string' || !alias.trim()) continue;
    const a = alias.trim();

    if (RESERVED_ALIASES.has(a)) {
      errors.push(`Node "${node.id}": Output alias "${a}" is a reserved word`);
      continue;
    }
    if (!/^[a-zA-Z_]\w*$/.test(a)) {
      errors.push(
        `Node "${node.id}": Output alias "${a}" must be a valid identifier (letters, digits, underscores)`
      );
      continue;
    }
    const existing = aliasMap.get(a);
    if (existing) {
      errors.push(
        `Duplicate output alias "${a}" on nodes "${existing}" and "${node.id}"`
      );
    } else {
      aliasMap.set(a, node.id);
    }
  }

  return errors;
}

export const workflowRoutes = new Hono();

// Mount copilot sub-route
workflowRoutes.route('/copilot', workflowCopilotRoute);

// ============================================================================
// List Workflows
// ============================================================================

workflowRoutes.get('/', pagination(), async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = c.get('pagination')!;

  const repo = createWorkflowsRepository(userId);
  const [total, workflows] = await Promise.all([repo.count(), repo.getPage(limit, offset)]);

  return apiResponse(c, {
    workflows,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});

// ============================================================================
// Create Workflow
// ============================================================================

workflowRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const rawBody = await parseJsonBody(c);
  if (!rawBody)
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Invalid JSON body' }, 400);

  let body;
  try {
    body = validateBody(createWorkflowSchema, rawBody);
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: getErrorMessage(error) },
      400
    );
  }

  // Semantic validation (node completeness, edge references, branching handles)
  const semanticErrors = validateWorkflowSemantics(
    body.nodes as WfNode[],
    body.edges as WfEdge[]
  );
  if (semanticErrors.length > 0) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: semanticErrors.join('; ') },
      400
    );
  }

  // Validate DAG (no cycles) if nodes and edges are provided
  if (body.nodes.length > 0 && body.edges.length > 0) {
    try {
      topologicalSort(body.nodes, body.edges);
    } catch {
      return apiError(
        c,
        { code: ERROR_CODES.WORKFLOW_CYCLE_DETECTED, message: 'Workflow graph contains a cycle' },
        400
      );
    }
  }

  const repo = createWorkflowsRepository(userId);
  let workflow;
  try {
    workflow = await repo.create(body);
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CREATE_FAILED,
        message: getErrorMessage(error, 'Failed to create workflow'),
      },
      500
    );
  }

  wsGateway.broadcast('data:changed', { entity: 'workflow', action: 'created', id: workflow.id });
  return apiResponse(c, workflow, 201);
});

// ============================================================================
// Recent Logs (must be before /:id to avoid route conflict)
// ============================================================================

workflowRoutes.get('/logs/recent', pagination(), async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = c.get('pagination')!;

  const repo = createWorkflowsRepository(userId);
  const [total, logs] = await Promise.all([repo.countLogs(), repo.getRecentLogs(limit, offset)]);

  return apiResponse(c, {
    logs,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});

// ============================================================================
// Log Detail
// ============================================================================

workflowRoutes.get('/logs/:logId', async (c) => {
  const userId = getUserId(c);
  const logId = sanitizeId(c.req.param('logId'));

  const repo = createWorkflowsRepository(userId);
  const wfLog = await repo.getLog(logId);
  if (!wfLog) return notFoundError(c, 'WorkflowLog', logId);

  return apiResponse(c, wfLog);
});

// ============================================================================
// Active Tool Names (for workflow-usable toggle warnings)
// ============================================================================

workflowRoutes.get('/active-tool-names', async (c) => {
  const userId = getUserId(c);
  const repo = createWorkflowsRepository(userId);
  const workflows = await repo.getPage(1000, 0);

  const activeToolNames = new Set<string>();
  for (const wf of workflows) {
    if (wf.status !== 'active') continue;
    for (const node of wf.nodes) {
      if (node.type === 'tool' && (node.data as { toolName?: string }).toolName) {
        activeToolNames.add((node.data as { toolName: string }).toolName);
      }
    }
  }

  return apiResponse(c, [...activeToolNames]);
});

// ============================================================================
// Clone Workflow
// ============================================================================

workflowRoutes.post('/:id/clone', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  const repo = createWorkflowsRepository(userId);
  const original = await repo.get(id);
  if (!original) return notFoundError(c, 'Workflow', id);

  // Build a clone: new node IDs, updated edge references, reset status/runCount
  const idMap = new Map<string, string>();
  let counter = 0;
  for (const node of original.nodes) {
    counter++;
    idMap.set(node.id, `node_${counter}`);
  }

  const clonedNodes = original.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id) ?? node.id,
    data: {
      ...node.data,
      // Strip trigger link — user must reconfigure triggers
      triggerId: undefined,
    },
  }));

  const clonedEdges = original.edges.map((edge) => ({
    ...edge,
    id: `e_${idMap.get(edge.source) ?? edge.source}-${idMap.get(edge.target) ?? edge.target}`,
    source: idMap.get(edge.source) ?? edge.source,
    target: idMap.get(edge.target) ?? edge.target,
  }));

  let workflow;
  try {
    workflow = await repo.create({
      name: `Copy of ${original.name}`,
      description: original.description ?? undefined,
      nodes: clonedNodes,
      edges: clonedEdges,
      variables: original.variables ?? {},
      inputSchema: original.inputSchema ?? [],
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CREATE_FAILED,
        message: getErrorMessage(error, 'Failed to clone workflow'),
      },
      500
    );
  }

  wsGateway.broadcast('data:changed', { entity: 'workflow', action: 'created', id: workflow.id });
  return apiResponse(c, workflow, 201);
});

// ============================================================================
// Get Workflow
// ============================================================================

workflowRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  const repo = createWorkflowsRepository(userId);
  const workflow = await repo.get(id);
  if (!workflow) return notFoundError(c, 'Workflow', id);

  return apiResponse(c, workflow);
});

// ============================================================================
// Update Workflow
// ============================================================================

workflowRoutes.patch('/:id', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));
  const rawBody = await parseJsonBody(c);
  if (!rawBody)
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Invalid JSON body' }, 400);

  let body;
  try {
    body = validateBody(updateWorkflowSchema, rawBody);
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: getErrorMessage(error) },
      400
    );
  }

  // Re-validate DAG and semantics if nodes or edges changed
  if (body.nodes || body.edges) {
    const repo = createWorkflowsRepository(userId);
    const existing = await repo.get(id);
    if (!existing) return notFoundError(c, 'Workflow', id);

    const nodes = body.nodes ?? existing.nodes;
    const edges = body.edges ?? existing.edges;

    // Semantic validation
    const semanticErrors = validateWorkflowSemantics(
      nodes as unknown as WfNode[],
      edges as unknown as WfEdge[]
    );
    if (semanticErrors.length > 0) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: semanticErrors.join('; ') },
        400
      );
    }

    if (nodes.length > 0 && edges.length > 0) {
      try {
        topologicalSort(nodes, edges);
      } catch {
        return apiError(
          c,
          { code: ERROR_CODES.WORKFLOW_CYCLE_DETECTED, message: 'Workflow graph contains a cycle' },
          400
        );
      }
    }
  }

  const repo = createWorkflowsRepository(userId);

  // Auto-snapshot version before updating nodes/edges
  if (body.nodes || body.edges) {
    try {
      await repo.createVersion(id);
    } catch {
      // Ignore version errors (e.g. workflow not found — will be caught below)
    }
  }

  const updated = await repo.update(id, body);
  if (!updated) return notFoundError(c, 'Workflow', id);

  wsGateway.broadcast('data:changed', { entity: 'workflow', action: 'updated', id });
  return apiResponse(c, updated);
});

// ============================================================================
// Delete Workflow
// ============================================================================

workflowRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  const repo = createWorkflowsRepository(userId);
  const deleted = await repo.delete(id);
  if (!deleted) return notFoundError(c, 'Workflow', id);

  wsGateway.broadcast('data:changed', { entity: 'workflow', action: 'deleted', id });
  return apiResponse(c, { message: 'Workflow deleted' });
});

// ============================================================================
// Execute Workflow (SSE stream)
// ============================================================================

workflowRoutes.post('/:id/execute', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));
  const dryRun = c.req.query('dryRun') === 'true';

  // Accept optional input parameters in the body
  let inputs: Record<string, unknown> | undefined;
  try {
    const body = await c.req.json().catch(() => ({}));
    if (body && typeof body === 'object' && 'inputs' in body) {
      inputs = body.inputs as Record<string, unknown>;
    }
  } catch { /* no body is fine */ }

  const repo = createWorkflowsRepository(userId);
  const workflow = await repo.get(id);
  if (!workflow) return notFoundError(c, 'Workflow', id);

  const service = getServiceRegistry().get(Services.Workflow);
  if (service.isRunning(id)) {
    return apiError(
      c,
      { code: ERROR_CODES.WORKFLOW_ALREADY_RUNNING, message: 'Workflow is already running' },
      409
    );
  }

  return streamSSE(c, async (stream) => {
    try {
      await service.executeWorkflow(id, userId, async (event) => {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });
      }, { dryRun, inputs });
    } catch (error) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', error: getErrorMessage(error) }),
        event: 'error',
      });
    }
  });
});

// ============================================================================
// Cancel Workflow Execution
// ============================================================================

workflowRoutes.post('/:id/cancel', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  // Verify workflow ownership before allowing cancel
  const repo = createWorkflowsRepository(userId);
  const workflow = await repo.get(id);
  if (!workflow) return notFoundError(c, 'Workflow', id);

  const service = getServiceRegistry().get(Services.Workflow);
  const cancelled = service.cancelExecution(id);

  if (!cancelled) {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: 'No active execution found for this workflow' },
      404
    );
  }

  return apiResponse(c, { message: 'Execution cancelled' });
});

// ============================================================================
// Workflow Versions
// ============================================================================

workflowRoutes.get('/:id/versions', pagination(), async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));
  const { limit, offset } = c.get('pagination')!;

  const repo = createWorkflowsRepository(userId);
  const workflow = await repo.get(id);
  if (!workflow) return notFoundError(c, 'Workflow', id);

  const [total, versions] = await Promise.all([
    repo.countVersions(id),
    repo.getVersions(id, limit, offset),
  ]);

  return apiResponse(c, {
    versions,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});

workflowRoutes.post('/:id/versions/:version/restore', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));
  const version = parseInt(c.req.param('version'), 10);
  if (isNaN(version) || version < 1) {
    return apiError(c, { code: ERROR_CODES.BAD_REQUEST, message: 'Invalid version number' }, 400);
  }

  const repo = createWorkflowsRepository(userId);
  const restored = await repo.restoreVersion(id, version);
  if (!restored) {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: `Version ${version} not found for workflow` },
      404
    );
  }

  wsGateway.broadcast('data:changed', { entity: 'workflow', action: 'updated', id });
  return apiResponse(c, restored);
});

// ============================================================================
// Workflow Execution Logs
// ============================================================================

workflowRoutes.get('/:id/logs', pagination(), async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));
  const { limit, offset } = c.get('pagination')!;

  const repo = createWorkflowsRepository(userId);
  const workflow = await repo.get(id);
  if (!workflow) return notFoundError(c, 'Workflow', id);

  const [total, logs] = await Promise.all([
    repo.countLogsForWorkflow(id),
    repo.getLogsForWorkflow(id, limit, offset),
  ]);

  return apiResponse(c, {
    logs,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});

// ============================================================================
// Workflow Approvals
// ============================================================================

workflowRoutes.get('/approvals/pending', pagination(), async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = c.get('pagination')!;

  const repo = createWorkflowApprovalsRepository(userId);
  const [total, approvals] = await Promise.all([
    repo.countPending(),
    repo.getPending(limit, offset),
  ]);

  return apiResponse(c, {
    approvals,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});

workflowRoutes.get('/approvals/all', pagination(), async (c) => {
  const userId = getUserId(c);
  const { limit, offset } = c.get('pagination')!;

  const repo = createWorkflowApprovalsRepository(userId);
  const [total, approvals] = await Promise.all([
    repo.countAll(),
    repo.getAll(limit, offset),
  ]);

  return apiResponse(c, {
    approvals,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  });
});

workflowRoutes.post('/approvals/:id/approve', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  const repo = createWorkflowApprovalsRepository(userId);
  const approval = await repo.decide(id, 'approved');
  if (!approval || approval.status !== 'approved') {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: 'Approval not found or already decided' },
      404
    );
  }

  wsGateway.broadcast('approval:decided', { approvalId: id, status: 'approved' });
  return apiResponse(c, approval);
});

workflowRoutes.post('/approvals/:id/reject', async (c) => {
  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  const repo = createWorkflowApprovalsRepository(userId);
  const approval = await repo.decide(id, 'rejected');
  if (!approval || approval.status !== 'rejected') {
    return apiError(
      c,
      { code: ERROR_CODES.NOT_FOUND, message: 'Approval not found or already decided' },
      404
    );
  }

  // Mark the workflow log as failed
  const wfRepo = createWorkflowsRepository(userId);
  const log = await wfRepo.getLog(approval.workflowLogId);
  if (log && log.status === 'awaiting_approval') {
    await wfRepo.updateLog(approval.workflowLogId, {
      status: 'failed',
      error: 'Approval rejected',
      completedAt: new Date().toISOString(),
    });
  }

  wsGateway.broadcast('approval:decided', { approvalId: id, status: 'rejected' });
  return apiResponse(c, approval);
});

// ============================================================================
// Public API: Run Workflow (requires X-API-Key header)
// ============================================================================

workflowRoutes.post('/:id/run', async (c) => {
  // Authenticate via API key (same as ADMIN_KEY)
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return apiError(
      c,
      { code: ERROR_CODES.UNAUTHORIZED, message: 'ADMIN_KEY environment variable must be set to use the workflow API.' },
      403
    );
  }
  const providedKey = c.req.header('X-API-Key') ?? c.req.header('X-Admin-Key');
  if (!safeKeyCompare(providedKey, adminKey)) {
    return apiError(
      c,
      { code: ERROR_CODES.UNAUTHORIZED, message: 'Valid API key required. Set X-API-Key header.' },
      403
    );
  }

  const userId = getUserId(c);
  const id = sanitizeId(c.req.param('id'));

  let inputs: Record<string, unknown> | undefined;
  try {
    const body = await c.req.json().catch(() => ({}));
    if (body && typeof body === 'object' && 'inputs' in body) {
      inputs = body.inputs as Record<string, unknown>;
    }
  } catch { /* no body is fine */ }

  const repo = createWorkflowsRepository(userId);
  const workflow = await repo.get(id);
  if (!workflow) return notFoundError(c, 'Workflow', id);

  // Validate inputs against schema if defined
  if (workflow.inputSchema && workflow.inputSchema.length > 0 && inputs) {
    const missing = workflow.inputSchema
      .filter((p) => p.required && !(p.name in inputs!))
      .map((p) => p.name);
    if (missing.length > 0) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: `Missing required inputs: ${missing.join(', ')}` },
        400
      );
    }
  }

  const service = getServiceRegistry().get(Services.Workflow);
  if (service.isRunning(id)) {
    return apiError(
      c,
      { code: ERROR_CODES.WORKFLOW_ALREADY_RUNNING, message: 'Workflow is already running' },
      409
    );
  }

  // Execute asynchronously and return the log ID immediately
  let logId: string | null = null;

  // Start execution in background — capture log ID from first 'started' event
  const executionPromise = service.executeWorkflow(id, userId, async (event) => {
    if (event.type === 'started' && event.logId) {
      logId = event.logId;
    }
  }, { inputs });

  // Wait briefly for the started event so we can return the logId
  await new Promise<void>((resolve) => {
    const check = () => {
      if (logId) return resolve();
      setTimeout(check, 50);
    };
    check();
    // Timeout after 5 seconds — return what we have
    setTimeout(resolve, 5000);
  });

  // Don't await the full execution — it runs in the background
  executionPromise.catch(() => { /* execution errors are logged in the workflow log */ });

  return apiResponse(c, {
    logId,
    workflowId: id,
    status: 'running',
    pollUrl: `/workflows/logs/${logId}`,
  });
});

// ============================================================================
// Public API: Poll Workflow Run Status
// ============================================================================

workflowRoutes.get('/:id/run/:logId', async (c) => {
  // Authenticate via API key
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return apiError(
      c,
      { code: ERROR_CODES.UNAUTHORIZED, message: 'ADMIN_KEY environment variable must be set.' },
      403
    );
  }
  const providedKey = c.req.header('X-API-Key') ?? c.req.header('X-Admin-Key');
  if (!safeKeyCompare(providedKey, adminKey)) {
    return apiError(
      c,
      { code: ERROR_CODES.UNAUTHORIZED, message: 'Valid API key required. Set X-API-Key header.' },
      403
    );
  }

  const userId = getUserId(c);
  const logId = sanitizeId(c.req.param('logId'));

  const repo = createWorkflowsRepository(userId);
  const log = await repo.getLog(logId);
  if (!log) return notFoundError(c, 'Workflow log', logId);

  return apiResponse(c, log);
});

// ============================================================================
// Replay Execution — re-run a workflow from a completed log
// ============================================================================

workflowRoutes.post('/logs/:logId/replay', async (c) => {
  const userId = getUserId(c);
  const logId = sanitizeId(c.req.param('logId'));

  const repo = createWorkflowsRepository(userId);
  const log = await repo.getLog(logId);
  if (!log) return notFoundError(c, 'Workflow log', logId);
  if (!log.workflowId) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'Log has no associated workflow (it may have been deleted)' }, 400);
  }

  const workflow = await repo.get(log.workflowId);
  if (!workflow) return notFoundError(c, 'Workflow', log.workflowId);

  const service = getServiceRegistry().get(Services.Workflow);
  if (service.isRunning(workflow.id)) {
    return apiError(c, { code: ERROR_CODES.WORKFLOW_ALREADY_RUNNING, message: 'Workflow is already running' }, 409);
  }

  return streamSSE(c, async (stream) => {
    try {
      await service.executeWorkflow(workflow.id, userId, async (event) => {
        await stream.writeSSE({ data: JSON.stringify(event), event: event.type });
      });
    } catch (error) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', error: getErrorMessage(error) }),
        event: 'error',
      });
    }
  });
});
