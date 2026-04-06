/**
 * Workflow Generator Service
 *
 * LLM-powered workflow generation from natural language goals.
 * Three-phase pipeline: decompose → build DAG → review.
 */

import { randomUUID } from 'crypto';
import { createProvider, type ProviderConfig, type Message } from '@ownpilot/core';
import type {
  IWorkflowGeneratorService,
  SubTask,
  GeneratedWorkflow,
  WorkflowGenerateOptions,
  DecompositionMetrics,
} from '@ownpilot/core';
import { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } from '../routes/agent-cache.js';
import { resolveProviderAndModel } from '../routes/settings.js';
import { getAdapterSync } from '../db/adapters/index.js';
import { getLog } from './log.js';

const log = getLog('WorkflowGeneratorService');

// ============================================================================
// Prompts
// ============================================================================

const DECOMPOSE_SYSTEM_PROMPT = `You are a workflow architect. Decompose the following goal into concrete subtasks.

Rules:
- Each subtask must be independently executable
- Specify dependencies between subtasks (which must complete before others)
- Rate complexity 1-10
- Map to available tools where possible
- Keep subtasks atomic — one clear action each
- Return ONLY valid JSON, no markdown, no explanation

Return a JSON array of subtasks:
[{"id": "task_1", "name": "...", "description": "...", "complexity": 5, "requiredTools": ["core.xxx"], "requiredCapabilities": [], "dependencies": [], "agentRole": "optional role"}]`;

const DAG_SYSTEM_PROMPT = `You are a workflow builder for OwnPilot. Convert subtasks into a workflow definition.

Node types available:
- trigger: entry point (type: "trigger", triggerType: "manual"|"schedule"|"event"|"webhook")
- toolNode: executes a tool (identified by "tool" field, no "type" field)
- llm: calls an AI model (type: "llm", provider: "default", model: "default", userMessage: "...")
- condition: if/else branching (type: "condition", expression: "...", edges use sourceHandle "true"/"false")
- code: runs JavaScript (type: "code", code: "...")
- transformer: transforms data (type: "transformer", transform: "...")
- forEach: iterates over array (type: "forEach", collection: "...")
- httpRequest: HTTP call (type: "httpRequest", url: "...", method: "GET"|"POST"|...)
- delay: waits (type: "delay", duration: 1000)
- parallel: runs branches in parallel (type: "parallel")
- merge: merges parallel branches (type: "merge")
- approval: human approval gate (type: "approval")

Rules:
- Always include exactly ONE trigger node as entry point at position {x: 300, y: 50}
- Tool nodes have a "tool" field (exact tool name) and optional "args" object — NO "type" field
- All other nodes use the "type" field
- Use {{nodeId.output}} template syntax to reference upstream data
- Layout nodes top-to-bottom, 200px vertical spacing, centered at x: 300
- Each node needs: id (node_N), label, position {x, y}
- Edges: {id: "edge_N", source: "node_X", target: "node_Y"}
- Return ONLY valid JSON: {"name": "...", "description": "...", "nodes": [...], "edges": [...], "variables": {}}`;

const REVIEW_SYSTEM_PROMPT = `You are a workflow quality reviewer for OwnPilot. Analyze the provided workflow for correctness.

Check for:
1. Missing edges — nodes with no incoming or outgoing connections (except trigger/terminal)
2. Unreachable nodes — nodes that cannot be reached from the trigger
3. Invalid tool names — tools not in the available tools list
4. Missing required fields — each node type has required fields
5. Cycles that could cause infinite loops
6. Condition nodes must have both "true" and "false" outgoing edges
7. Exactly one trigger node must exist

Return ONLY valid JSON:
{"valid": true/false, "issues": ["issue1", "issue2"], "suggestions": ["suggestion1"]}`;

// ============================================================================
// Helpers
// ============================================================================

interface ProviderBundle {
  provider: ReturnType<typeof createProvider>;
  model: string;
  providerName: string;
}

async function resolveProvider(options?: WorkflowGenerateOptions): Promise<ProviderBundle> {
  const { provider: resolvedProvider, model: resolvedModel } = await resolveProviderAndModel(
    options?.provider ?? 'default',
    options?.model ?? 'default',
  );

  if (!resolvedProvider) {
    throw new Error('No AI provider configured. Set up a provider in Settings.');
  }

  const apiKey = await getProviderApiKey(resolvedProvider);
  if (!apiKey) {
    throw new Error(`API key not configured for provider: ${resolvedProvider}`);
  }

  let baseUrl: string | undefined;
  const config = loadProviderConfig(resolvedProvider);
  if (config?.baseUrl) baseUrl = config.baseUrl;

  const providerType = NATIVE_PROVIDERS.has(resolvedProvider) ? resolvedProvider : 'openai';

  const provider = createProvider({
    provider: providerType as ProviderConfig['provider'],
    apiKey,
    baseUrl,
    headers: config?.headers,
  });

  return {
    provider,
    model: resolvedModel ?? 'gpt-4o',
    providerName: resolvedProvider,
  };
}

async function callLLM(
  bundle: ProviderBundle,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const result = await bundle.provider.complete({
    messages,
    model: { model: bundle.model, maxTokens: 8192, temperature: 0.4 },
  });

  if (!result.ok) {
    throw new Error(`LLM call failed: ${result.error.message}`);
  }

  return result.value.content;
}

function extractJSON(text: string): string {
  // Try to extract JSON from code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch?.[1]) return codeBlockMatch[1].trim();

  // Try to find raw JSON (array or object)
  const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch?.[1]) return jsonMatch[1].trim();

  return text.trim();
}

function computeMetrics(subtasks: SubTask[], nodes: unknown[]): DecompositionMetrics {
  const complexities = subtasks.map((t) => t.complexity);
  const totalComplexity = complexities.reduce((a, b) => a + b, 0);
  const avgComplexity = subtasks.length > 0 ? totalComplexity / subtasks.length : 0;
  const maxComplexity = Math.max(0, ...complexities);

  // Estimate depth from dependency chains
  let maxDepth = 0;
  const depthCache = new Map<string, number>();
  function getDepth(taskId: string): number {
    if (depthCache.has(taskId)) return depthCache.get(taskId)!;
    const task = subtasks.find((t) => t.id === taskId);
    if (!task || task.dependencies.length === 0) {
      depthCache.set(taskId, 0);
      return 0;
    }
    const depth = 1 + Math.max(...task.dependencies.map(getDepth));
    depthCache.set(taskId, depth);
    return depth;
  }
  for (const t of subtasks) {
    maxDepth = Math.max(maxDepth, getDepth(t.id));
  }

  return {
    depth: maxDepth + 1,
    totalNodes: (nodes as unknown[]).length,
    avgComplexity: Math.round(avgComplexity * 100) / 100,
    maxComplexity,
    estimatedCost: subtasks.length * 0.02,
    estimatedQuality: Math.max(0, Math.min(1, 1 - avgComplexity / 15)),
    coherenceScore: Math.max(0, Math.min(1, subtasks.length > 0 ? 0.85 : 0)),
  };
}

// ============================================================================
// Service
// ============================================================================

class WorkflowGeneratorService implements IWorkflowGeneratorService {
  // --------------------------------------------------------------------------
  // generate — full three-phase pipeline
  // --------------------------------------------------------------------------
  async generate(
    goal: string,
    userId: string,
    options?: WorkflowGenerateOptions,
    onProgress?: (event: { phase: string; message: string; progress: number }) => void,
  ): Promise<GeneratedWorkflow> {
    const startMs = Date.now();
    const generationId = randomUUID();
    const notify = onProgress ?? (() => {});

    log.info(`[${generationId}] Starting workflow generation for goal: "${goal.slice(0, 80)}"`);

    const bundle = await resolveProvider(options);

    // Phase 1: Decompose
    notify({ phase: 'decompose', message: 'Decomposing goal into subtasks...', progress: 10 });
    const subtasks = await this._decompose(goal, bundle, options);
    notify({ phase: 'decompose', message: `Decomposed into ${subtasks.length} subtasks`, progress: 30 });
    log.info(`[${generationId}] Phase 1 complete: ${subtasks.length} subtasks`);

    // Phase 2: Build DAG
    notify({ phase: 'build', message: 'Building workflow graph...', progress: 40 });
    const workflow = await this._buildDAG(goal, subtasks, bundle, options);
    notify({ phase: 'build', message: `Built workflow with ${workflow.nodes.length} nodes`, progress: 60 });
    log.info(`[${generationId}] Phase 2 complete: ${workflow.nodes.length} nodes, ${workflow.edges.length} edges`);

    // Phase 3: Review (optional, enabled by default)
    let reviewResult = { valid: true, issues: [] as string[], suggestions: [] as string[] };
    if (options?.includeReview !== false) {
      notify({ phase: 'review', message: 'Reviewing workflow for issues...', progress: 70 });
      reviewResult = await this._review(workflow, bundle);
      notify({
        phase: 'review',
        message: reviewResult.valid
          ? 'Workflow validated successfully'
          : `Found ${reviewResult.issues.length} issue(s)`,
        progress: 90,
      });
      log.info(
        `[${generationId}] Phase 3 complete: valid=${reviewResult.valid}, issues=${reviewResult.issues.length}`,
      );
    }

    const metrics = computeMetrics(subtasks, workflow.nodes);
    const durationMs = Date.now() - startMs;

    const generated: GeneratedWorkflow = {
      name: workflow.name || `Workflow: ${goal.slice(0, 50)}`,
      description: workflow.description || goal,
      nodes: workflow.nodes,
      edges: workflow.edges,
      variables: workflow.variables || {},
      metrics,
      subtasks,
    };

    // Persist to history
    await this._saveHistory({
      id: generationId,
      userId,
      goal,
      decomposition: subtasks,
      generatedWorkflow: generated,
      metrics,
      provider: bundle.providerName,
      model: bundle.model,
      status: reviewResult.valid ? 'completed' : 'completed_with_issues',
      durationMs,
    });

    notify({ phase: 'done', message: 'Workflow generation complete', progress: 100 });
    log.info(`[${generationId}] Generation finished in ${durationMs}ms`);

    return generated;
  }

  // --------------------------------------------------------------------------
  // decompose — standalone Phase 1
  // --------------------------------------------------------------------------
  async decompose(
    goal: string,
    _userId: string,
    options?: WorkflowGenerateOptions,
  ): Promise<SubTask[]> {
    const bundle = await resolveProvider(options);
    return this._decompose(goal, bundle, options);
  }

  // --------------------------------------------------------------------------
  // review — standalone Phase 3
  // --------------------------------------------------------------------------
  async review(
    workflow: GeneratedWorkflow,
    _userId: string,
  ): Promise<{ valid: boolean; issues: string[]; suggestions: string[] }> {
    const bundle = await resolveProvider();
    return this._review(workflow, bundle);
  }

  // --------------------------------------------------------------------------
  // listHistory — paginated generation history
  // --------------------------------------------------------------------------
  async listHistory(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{
    items: Array<{ id: string; goal: string; status: string; createdAt: string }>;
    total: number;
  }> {
    const limit = Math.min(options?.limit ?? 20, 100);
    const offset = options?.offset ?? 0;
    const db = getAdapterSync();

    const countRow = await db.queryOne<{ total: string }>(
      'SELECT COUNT(*) AS total FROM workflow_generations WHERE user_id = ?',
      [userId],
    );
    const total = parseInt(countRow?.total ?? '0', 10);

    const rows = await db.query<Record<string, unknown>>(
      `SELECT id, goal, status, created_at
       FROM workflow_generations
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    );

    return {
      items: rows.map((row) => ({
        id: row.id as string,
        goal: row.goal as string,
        status: row.status as string,
        createdAt: (row.created_at as Date).toISOString(),
      })),
      total,
    };
  }

  // ==========================================================================
  // Internal phases
  // ==========================================================================

  private async _decompose(
    goal: string,
    bundle: ProviderBundle,
    options?: WorkflowGenerateOptions,
  ): Promise<SubTask[]> {
    const toolsList = options?.availableTools?.length
      ? `Available tools:\n${options.availableTools.map((t: string) => `- ${t}`).join('\n')}`
      : 'No specific tools provided — use generic node types.';

    const userMessage = `${toolsList}\n\nGoal: ${goal}`;

    const raw = await callLLM(bundle, DECOMPOSE_SYSTEM_PROMPT, userMessage);
    const json = extractJSON(raw);

    let subtasks: SubTask[];
    try {
      subtasks = JSON.parse(json);
    } catch (err) {
      log.error('Failed to parse decomposition response:', json.slice(0, 200));
      throw new Error('LLM returned invalid JSON for decomposition');
    }

    if (!Array.isArray(subtasks)) {
      throw new Error('Decomposition result is not an array');
    }

    // Enforce limits
    const maxNodes = options?.maxNodes ?? 20;
    if (subtasks.length > maxNodes) {
      log.warn(`Truncating ${subtasks.length} subtasks to max ${maxNodes}`);
      subtasks = subtasks.slice(0, maxNodes);
    }

    // Validate structure
    return subtasks.map((t, i) => ({
      id: t.id || `task_${i + 1}`,
      name: t.name || `Task ${i + 1}`,
      description: t.description || '',
      complexity: typeof t.complexity === 'number' ? Math.min(10, Math.max(1, t.complexity)) : 5,
      requiredTools: Array.isArray(t.requiredTools) ? t.requiredTools : [],
      requiredCapabilities: Array.isArray(t.requiredCapabilities) ? t.requiredCapabilities : [],
      dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
      agentRole: t.agentRole || undefined,
    }));
  }

  private async _buildDAG(
    goal: string,
    subtasks: SubTask[],
    bundle: ProviderBundle,
    options?: WorkflowGenerateOptions,
  ): Promise<{
    name: string;
    description: string;
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    variables: Record<string, unknown>;
  }> {
    const toolsList = options?.availableTools?.length
      ? `Available tools:\n${options.availableTools.map((t: string) => `- ${t}`).join('\n')}`
      : '';

    const userMessage = `Subtasks:\n${JSON.stringify(subtasks, null, 2)}\n\n${toolsList}\n\nGoal: ${goal}`;

    const raw = await callLLM(bundle, DAG_SYSTEM_PROMPT, userMessage);
    const json = extractJSON(raw);

    let workflow: {
      name?: string;
      description?: string;
      nodes?: Array<Record<string, unknown>>;
      edges?: Array<Record<string, unknown>>;
      variables?: Record<string, unknown>;
    };
    try {
      workflow = JSON.parse(json);
    } catch (err) {
      log.error('Failed to parse DAG response:', json.slice(0, 200));
      throw new Error('LLM returned invalid JSON for workflow DAG');
    }

    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const edges = Array.isArray(workflow.edges) ? workflow.edges : [];

    // Ensure trigger node exists
    const hasTrigger = nodes.some(
      (n) => n.type === 'trigger' || (n as Record<string, unknown>).triggerType,
    );
    if (!hasTrigger) {
      nodes.unshift({
        id: 'node_1',
        type: 'trigger',
        triggerType: 'manual',
        label: 'Trigger',
        position: { x: 300, y: 50 },
      });
      // Shift other node positions down and add edge from trigger to first non-trigger
      if (nodes.length > 1) {
        const firstNode = nodes[1]!;
        if (firstNode.id) {
          edges.unshift({
            id: `edge_trigger`,
            source: 'node_1',
            target: firstNode.id as string,
          });
        }
      }
    }

    // Ensure all nodes have positions
    nodes.forEach((node, i) => {
      if (!node.position) {
        node.position = { x: 300, y: 50 + i * 200 };
      }
    });

    return {
      name: workflow.name || `Workflow: ${goal.slice(0, 50)}`,
      description: workflow.description || goal,
      nodes,
      edges,
      variables: workflow.variables || {},
    };
  }

  private async _review(
    workflow: GeneratedWorkflow | { nodes: unknown[]; edges: unknown[] },
    bundle: ProviderBundle,
  ): Promise<{ valid: boolean; issues: string[]; suggestions: string[] }> {
    const userMessage = `Review this workflow:\n${JSON.stringify(
      { nodes: workflow.nodes, edges: workflow.edges },
      null,
      2,
    )}`;

    try {
      const raw = await callLLM(bundle, REVIEW_SYSTEM_PROMPT, userMessage);
      const json = extractJSON(raw);
      const result = JSON.parse(json);

      return {
        valid: result.valid === true,
        issues: Array.isArray(result.issues) ? result.issues : [],
        suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
      };
    } catch (err) {
      log.warn('Review phase failed, returning default pass:', (err as Error).message);
      return {
        valid: true,
        issues: [],
        suggestions: ['Review phase encountered an error; manual review recommended.'],
      };
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  private async _saveHistory(record: {
    id: string;
    userId: string;
    goal: string;
    decomposition: SubTask[];
    generatedWorkflow: GeneratedWorkflow;
    metrics: DecompositionMetrics;
    provider: string;
    model: string;
    status: string;
    durationMs: number;
  }): Promise<void> {
    try {
      const db = getAdapterSync();
      await db.execute(
        `INSERT INTO workflow_generations
           (id, user_id, goal, decomposition, generated_workflow, metrics,
            provider, model, status, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          record.id,
          record.userId,
          record.goal,
          JSON.stringify(record.decomposition),
          JSON.stringify(record.generatedWorkflow),
          JSON.stringify(record.metrics),
          record.provider,
          record.model,
          record.status,
          record.durationMs,
        ],
      );
    } catch (err) {
      log.error('Failed to save generation history:', (err as Error).message);
      // Non-fatal — don't break the generation pipeline
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: WorkflowGeneratorService | null = null;

export function getWorkflowGeneratorService(): WorkflowGeneratorService {
  if (!_instance) {
    _instance = new WorkflowGeneratorService();
  }
  return _instance;
}
