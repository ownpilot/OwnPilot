/**
 * Workflow Service — DAG Execution Engine
 *
 * Executes visual workflows as Directed Acyclic Graphs.
 * Uses topological sort for execution order, parallel execution within levels,
 * and template resolution for data passing between nodes.
 */

import {
  createWorkflowsRepository,
  type WorkflowNode,
  type WorkflowEdge,
  type ToolNodeData,
  type LlmNodeData,
  type ConditionNodeData,
  type CodeNodeData,
  type TransformerNodeData,
  type ForEachNodeData,
  type NodeResult,
  type NodeExecutionStatus,
  type WorkflowLog,
  type WorkflowLogStatus,
} from '../db/repositories/workflows.js';
import { createProvider, type ProviderConfig } from '@ownpilot/core';
import { executeTool, type ToolExecutionResult } from './tool-executor.js';
import { getErrorMessage } from '../routes/helpers.js';
import { getLog } from './log.js';
import vm from 'node:vm';

const _log = getLog('WorkflowService');

// ============================================================================
// Progress event types
// ============================================================================

export interface WorkflowProgressEvent {
  type: 'node_start' | 'node_complete' | 'node_error' | 'done' | 'error'
    | 'foreach_iteration_start' | 'foreach_iteration_complete';
  nodeId?: string;
  toolName?: string;
  status?: NodeExecutionStatus;
  output?: unknown;
  resolvedArgs?: Record<string, unknown>;
  branchTaken?: 'true' | 'false';
  error?: string;
  durationMs?: number;
  logId?: string;
  logStatus?: WorkflowLogStatus;
  /** ForEach: current iteration index (0-based) */
  iterationIndex?: number;
  /** ForEach: total items being iterated */
  iterationTotal?: number;
}

// ============================================================================
// DAG utilities
// ============================================================================

/**
 * Topological sort using Kahn's algorithm.
 * Returns an array of "levels" — each level contains node IDs that can run in parallel.
 * Throws if a cycle is detected.
 */
export function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[][] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const levels: string[][] = [];
  let queue = [...nodeIds].filter(id => inDegree.get(id) === 0);
  let processed = 0;

  while (queue.length > 0) {
    levels.push([...queue]);
    processed += queue.length;

    const nextQueue: string[] = [];
    for (const nodeId of queue) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          nextQueue.push(neighbor);
        }
      }
    }
    queue = nextQueue;
  }

  if (processed < nodeIds.size) {
    throw new Error('Workflow contains a cycle — cannot execute');
  }

  return levels;
}

/**
 * Get all downstream node IDs reachable from a given node.
 */
function getDownstreamNodes(nodeId: string, edges: WorkflowEdge[]): Set<string> {
  const downstream = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const edge of edges) {
      if (edge.source === current && !downstream.has(edge.target)) {
        downstream.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return downstream;
}

/**
 * Get all downstream node IDs reachable from a specific output handle of a node.
 * Used for conditional branching — to skip nodes on the not-taken branch.
 */
function getDownstreamNodesByHandle(
  nodeId: string,
  handle: string,
  edges: WorkflowEdge[],
): Set<string> {
  const downstream = new Set<string>();
  const queue = edges
    .filter(e => e.source === nodeId && e.sourceHandle === handle)
    .map(e => e.target);

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (downstream.has(current)) continue;
    downstream.add(current);
    for (const edge of edges) {
      if (edge.source === current && !downstream.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }
  return downstream;
}

/**
 * Get body-only and done-only nodes for a ForEach node.
 * Body = nodes reachable from "each" handle but NOT from "done" handle.
 * Done = nodes reachable from "done" handle.
 */
function getForEachBodyNodes(
  nodeId: string,
  edges: WorkflowEdge[],
): { bodyNodes: Set<string>; doneNodes: Set<string> } {
  const eachDownstream = getDownstreamNodesByHandle(nodeId, 'each', edges);
  const doneDownstream = getDownstreamNodesByHandle(nodeId, 'done', edges);

  const bodyNodes = new Set<string>();
  for (const id of eachDownstream) {
    if (!doneDownstream.has(id)) bodyNodes.add(id);
  }

  return { bodyNodes, doneNodes: doneDownstream };
}

/**
 * Resolve template expressions in tool arguments.
 * Replaces {{nodeId.output}} with full output and {{nodeId.output.field.sub}} with nested access.
 * Also supports {{variables.key}} for workflow-level variables.
 */
export function resolveTemplates(
  args: Record<string, unknown>,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  return deepResolve(args, nodeOutputs, variables) as Record<string, unknown>;
}

function deepResolve(
  value: unknown,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    return resolveStringTemplates(value, nodeOutputs, variables);
  }
  if (Array.isArray(value)) {
    return value.map(item => deepResolve(item, nodeOutputs, variables));
  }
  if (value !== null && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = deepResolve(v, nodeOutputs, variables);
    }
    return resolved;
  }
  return value;
}

function resolveStringTemplates(
  str: string,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
): unknown {
  // If the entire string is a single template, return the raw value (preserves types)
  const fullMatch = /^\{\{(.+?)\}\}$/.exec(str);
  if (fullMatch?.[1]) {
    return resolveTemplatePathWithFallback(fullMatch[1].trim(), nodeOutputs, variables);
  }

  // Otherwise, replace all templates inline (always returns string)
  return str.replace(/\{\{(.+?)\}\}/g, (_match, path: string) => {
    const val = resolveTemplatePathWithFallback(path.trim(), nodeOutputs, variables);
    return val === undefined ? '' : typeof val === 'string' ? val : JSON.stringify(val);
  });
}

function resolveTemplatePath(
  path: string,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
): unknown {
  const parts = path.split('.');

  // {{variables.key.subkey}}
  if (parts[0] === 'variables') {
    return getNestedValue(variables, parts.slice(1));
  }

  // {{nodeId.output}} or {{nodeId.output.field.sub}}
  const nodeId = parts[0]!;
  const nodeResult = nodeOutputs[nodeId];
  if (!nodeResult) return undefined;

  if (parts.length === 1) return nodeResult.output;
  if (parts[1] === 'output') {
    if (parts.length === 2) return nodeResult.output;
    return getNestedValue(nodeResult.output, parts.slice(2));
  }

  // Allow direct access: {{nodeId.field}} as shorthand for {{nodeId.output.field}}
  return getNestedValue(nodeResult.output, parts.slice(1));
}

// Fallback: check variables (enables {{itemVariable}} alias in ForEach body)
function resolveTemplatePathWithFallback(
  path: string,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
): unknown {
  const result = resolveTemplatePath(path, nodeOutputs, variables);
  if (result !== undefined) return result;

  // Try variables directly ({{issue}} → variables.issue)
  const parts = path.split('.');
  if (parts[0] && parts[0] in variables) {
    if (parts.length === 1) return variables[parts[0]];
    return getNestedValue(variables[parts[0]], parts.slice(1));
  }

  return undefined;
}

function getNestedValue(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    // Auto-parse JSON strings so {{node.output.field}} works when output is a JSON string
    if (typeof current === 'string') {
      const trimmed = current.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try { current = JSON.parse(trimmed); } catch { return undefined; }
      } else {
        return undefined;
      }
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  // Also auto-parse the final value if it's a JSON string (for whole-object references)
  if (typeof current === 'string') {
    const trimmed = current.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.parse(trimmed); } catch { /* return as-is */ }
    }
  }
  return current;
}

// ============================================================================
// Workflow Service
// ============================================================================

export class WorkflowService {
  private activeExecutions = new Map<string, AbortController>();

  /**
   * Execute a workflow by ID. Calls onProgress for each node start/complete.
   */
  async executeWorkflow(
    workflowId: string,
    userId: string,
    onProgress?: (event: WorkflowProgressEvent) => void,
  ): Promise<WorkflowLog> {
    const repo = createWorkflowsRepository(userId);
    const workflow = await repo.get(workflowId);
    if (!workflow) throw new Error('Workflow not found');
    if (workflow.nodes.length === 0) throw new Error('Workflow has no nodes');

    // Check for active execution
    if (this.activeExecutions.has(workflowId)) {
      throw new Error('Workflow is already running');
    }

    const abortController = new AbortController();
    this.activeExecutions.set(workflowId, abortController);

    const wfLog = await repo.createLog(workflowId, workflow.name);
    const startTime = Date.now();

    try {
      // Filter out trigger nodes (they define when the workflow starts, not what it does)
      const executableNodes = workflow.nodes.filter(n => n.type !== 'triggerNode');

      // Topological sort
      const levels = topologicalSort(executableNodes, workflow.edges);
      const nodeMap = new Map(executableNodes.map(n => [n.id, n]));
      const nodeOutputs: Record<string, NodeResult> = {};

      // Pre-compute ForEach body nodes — these are handled internally by executeForEachNode
      const forEachBodyNodes = new Set<string>();
      for (const node of executableNodes) {
        if (node.type === 'forEachNode') {
          const { bodyNodes } = getForEachBodyNodes(node.id, workflow.edges);
          for (const id of bodyNodes) forEachBodyNodes.add(id);
        }
      }

      // Execute level by level
      for (const level of levels) {
        if (abortController.signal.aborted) {
          throw new Error('Workflow execution cancelled');
        }

        const results = await Promise.allSettled(
          level.map(async (nodeId) => {
            const node = nodeMap.get(nodeId);
            if (!node) throw new Error(`Node ${nodeId} not found`);

            // Skip if already marked (e.g., downstream of a failed node)
            if (nodeOutputs[nodeId]?.status === 'skipped') {
              return nodeOutputs[nodeId];
            }

            // Skip ForEach body nodes — they're executed inside executeForEachNode
            if (forEachBodyNodes.has(nodeId) && !nodeOutputs[nodeId]) {
              const skipped: NodeResult = { nodeId, status: 'skipped', completedAt: new Date().toISOString() };
              nodeOutputs[nodeId] = skipped;
              return skipped;
            }

            if (node.type === 'forEachNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'forEach' });
              return await this.executeForEachNode(
                node, nodeOutputs, workflow.variables, workflow.edges,
                nodeMap, userId, abortController.signal, onProgress, repo, wfLog.id,
              );
            }

            if (node.type === 'llmNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: `llm:${(node.data as LlmNodeData).provider}` });
              return await this.executeLlmNode(node, nodeOutputs, workflow.variables);
            }

            if (node.type === 'conditionNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'condition' });
              return this.executeConditionNode(node, nodeOutputs, workflow.variables);
            }

            if (node.type === 'codeNode') {
              const cd = node.data as CodeNodeData;
              onProgress?.({ type: 'node_start', nodeId, toolName: `code:${cd.language}` });
              return await this.executeCodeNode(node, nodeOutputs, workflow.variables, userId);
            }

            if (node.type === 'transformerNode') {
              onProgress?.({ type: 'node_start', nodeId, toolName: 'transformer' });
              return this.executeTransformerNode(node, nodeOutputs, workflow.variables);
            }

            const toolData = node.data as ToolNodeData;
            onProgress?.({ type: 'node_start', nodeId, toolName: toolData.toolName });

            const result = await this.executeNode(
              node, nodeOutputs, workflow.variables, userId
            );
            return result;
          })
        );

        // Process results
        for (let i = 0; i < level.length; i++) {
          const nodeId = level[i]!;
          const settled = results[i]!;

          if (settled.status === 'fulfilled') {
            nodeOutputs[nodeId] = settled.value;
          } else {
            nodeOutputs[nodeId] = {
              nodeId,
              status: 'error',
              error: getErrorMessage(settled.reason, 'Unexpected error'),
              completedAt: new Date().toISOString(),
            };
          }

          const nodeResult = nodeOutputs[nodeId]!;

          // Emit progress
          if (nodeResult.status === 'error') {
            onProgress?.({
              type: 'node_error',
              nodeId,
              error: nodeResult.error,
            });

            // Skip all downstream nodes
            const downstream = getDownstreamNodes(nodeId, workflow.edges);
            for (const downId of downstream) {
              if (!nodeOutputs[downId]) {
                nodeOutputs[downId] = {
                  nodeId: downId,
                  status: 'skipped',
                  completedAt: new Date().toISOString(),
                };
              }
            }
          } else {
            onProgress?.({
              type: 'node_complete',
              nodeId,
              status: nodeResult.status,
              output: nodeResult.output,
              resolvedArgs: nodeResult.resolvedArgs,
              branchTaken: nodeResult.branchTaken,
              durationMs: nodeResult.durationMs,
            });

            // Condition branching: skip nodes on the not-taken branch
            const node = nodeMap.get(nodeId);
            if (node?.type === 'conditionNode' && nodeResult.branchTaken) {
              const skippedHandle = nodeResult.branchTaken === 'true' ? 'false' : 'true';
              const skippedNodes = getDownstreamNodesByHandle(nodeId, skippedHandle, workflow.edges);
              for (const skipId of skippedNodes) {
                if (!nodeOutputs[skipId]) {
                  nodeOutputs[skipId] = {
                    nodeId: skipId,
                    status: 'skipped',
                    completedAt: new Date().toISOString(),
                  };
                  onProgress?.({ type: 'node_complete', nodeId: skipId, status: 'skipped' });
                }
              }
            }
          }

          // Update log incrementally
          await repo.updateLog(wfLog.id, { nodeResults: nodeOutputs });
        }
      }

      // Finalize
      const hasErrors = Object.values(nodeOutputs).some(r => r.status === 'error');
      const finalStatus: WorkflowLogStatus = hasErrors ? 'failed' : 'completed';
      const totalDuration = Date.now() - startTime;

      await repo.updateLog(wfLog.id, {
        status: finalStatus,
        nodeResults: nodeOutputs,
        completedAt: new Date().toISOString(),
        durationMs: totalDuration,
      });
      await repo.markRun(workflowId);

      onProgress?.({
        type: 'done',
        logId: wfLog.id,
        logStatus: finalStatus,
        durationMs: totalDuration,
      });

      const finalLog = await repo.getLog(wfLog.id);
      return finalLog ?? wfLog;
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const errorMsg = getErrorMessage(error, 'Workflow execution failed');

      await repo.updateLog(wfLog.id, {
        status: 'failed',
        error: errorMsg,
        completedAt: new Date().toISOString(),
        durationMs: totalDuration,
      });

      onProgress?.({ type: 'error', error: errorMsg });

      const finalLog = await repo.getLog(wfLog.id);
      return finalLog ?? wfLog;
    } finally {
      this.activeExecutions.delete(workflowId);
    }
  }

  /**
   * Cancel a running workflow execution.
   */
  cancelExecution(workflowId: string): boolean {
    const controller = this.activeExecutions.get(workflowId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * Check if a workflow is currently executing.
   */
  isRunning(workflowId: string): boolean {
    return this.activeExecutions.has(workflowId);
  }

  /**
   * Execute a single tool node: resolve templates, call tool, return result.
   */
  private async executeNode(
    node: WorkflowNode,
    nodeOutputs: Record<string, NodeResult>,
    variables: Record<string, unknown>,
    userId: string,
  ): Promise<NodeResult> {
    const startTime = Date.now();

    try {
      const data = node.data as ToolNodeData;
      const resolvedArgs = resolveTemplates(data.toolArgs, nodeOutputs, variables);

      const result: ToolExecutionResult = await executeTool(
        data.toolName,
        resolvedArgs,
        userId,
      );

      return {
        nodeId: node.id,
        status: result.success ? 'success' : 'error',
        output: result.result,
        resolvedArgs,
        error: result.error,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        status: 'error',
        error: getErrorMessage(error, 'Node execution failed'),
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Execute an LLM node: resolve template expressions in userMessage,
   * call the AI provider, return the response text as output.
   */
  private async executeLlmNode(
    node: WorkflowNode,
    nodeOutputs: Record<string, NodeResult>,
    variables: Record<string, unknown>,
  ): Promise<NodeResult> {
    const startTime = Date.now();

    try {
      const data = node.data as LlmNodeData;

      // Resolve templates in user message (e.g., {{node_1.output}})
      const resolvedMessage = resolveTemplates(
        { _msg: data.userMessage },
        nodeOutputs,
        variables,
      )._msg as string;

      // Resolve templates in system prompt too (if present)
      const resolvedSystemPrompt = data.systemPrompt
        ? resolveTemplates({ _sp: data.systemPrompt }, nodeOutputs, variables)._sp as string
        : undefined;

      // Lazy import to avoid circular deps (agent-cache is in routes/)
      const { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } = await import('../routes/agent-cache.js');

      // Resolve API key: use node-level override or stored key
      const apiKey = data.apiKey || await getProviderApiKey(data.provider);

      // Resolve base URL: use node-level override or provider config
      let baseUrl = data.baseUrl;
      if (!baseUrl) {
        const config = loadProviderConfig(data.provider);
        if (config?.baseUrl) baseUrl = config.baseUrl;
      }

      // Map non-native providers to openai-compatible
      const providerType = NATIVE_PROVIDERS.has(data.provider) ? data.provider : 'openai';

      const provider = createProvider({
        provider: providerType as ProviderConfig['provider'],
        apiKey,
        baseUrl,
      });

      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      if (resolvedSystemPrompt) {
        messages.push({ role: 'system', content: resolvedSystemPrompt });
      }
      messages.push({ role: 'user', content: resolvedMessage });

      const result = await provider.complete({
        messages,
        model: {
          model: data.model,
          maxTokens: data.maxTokens ?? 4096,
          temperature: data.temperature ?? 0.7,
        },
      });

      if (!result.ok) {
        return {
          nodeId: node.id,
          status: 'error',
          error: result.error.message,
          durationMs: Date.now() - startTime,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
        };
      }

      return {
        nodeId: node.id,
        status: 'success',
        output: result.value.content,
        resolvedArgs: { provider: data.provider, model: data.model, userMessage: resolvedMessage },
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        status: 'error',
        error: getErrorMessage(error, 'LLM node execution failed'),
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Execute a condition node: evaluate a JS expression, return which branch to take.
   */
  private executeConditionNode(
    node: WorkflowNode,
    nodeOutputs: Record<string, NodeResult>,
    variables: Record<string, unknown>,
  ): NodeResult {
    const startTime = Date.now();
    try {
      const data = node.data as ConditionNodeData;

      // Resolve templates in the expression
      const resolvedExpr = resolveTemplates(
        { _expr: data.expression }, nodeOutputs, variables
      )._expr as string;

      // Build evaluation context: upstream outputs accessible by node ID + variables
      const evalContext: Record<string, unknown> = { ...variables };
      for (const [nid, result] of Object.entries(nodeOutputs)) {
        evalContext[nid] = result.output;
      }

      const result = vm.runInNewContext(resolvedExpr, evalContext, { timeout: 5000 });
      const branch = Boolean(result);

      return {
        nodeId: node.id,
        status: 'success',
        output: branch,
        branchTaken: branch ? 'true' : 'false',
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        status: 'error',
        error: getErrorMessage(error, 'Condition evaluation failed'),
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Execute a code node: run JS/Python/Shell code via existing execution tools.
   */
  private async executeCodeNode(
    node: WorkflowNode,
    nodeOutputs: Record<string, NodeResult>,
    variables: Record<string, unknown>,
    userId: string,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const data = node.data as CodeNodeData;

      // Resolve templates in the code string
      const resolvedCode = resolveTemplates(
        { _code: data.code }, nodeOutputs, variables
      )._code as string;

      // Map language to execution tool name
      const toolMap: Record<string, string> = {
        javascript: 'execute_javascript',
        python: 'execute_python',
        shell: 'execute_shell',
      };
      const toolName = toolMap[data.language] ?? 'execute_javascript';

      const result: ToolExecutionResult = await executeTool(
        toolName,
        { code: resolvedCode },
        userId,
      );

      return {
        nodeId: node.id,
        status: result.success ? 'success' : 'error',
        output: result.result,
        resolvedArgs: { language: data.language, code: resolvedCode },
        error: result.error,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        status: 'error',
        error: getErrorMessage(error, 'Code execution failed'),
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Execute a transformer node: evaluate a JS expression to transform data.
   */
  private executeTransformerNode(
    node: WorkflowNode,
    nodeOutputs: Record<string, NodeResult>,
    variables: Record<string, unknown>,
  ): NodeResult {
    const startTime = Date.now();
    try {
      const data = node.data as TransformerNodeData;

      // Resolve templates in the expression
      const resolvedExpr = resolveTemplates(
        { _expr: data.expression }, nodeOutputs, variables
      )._expr as string;

      // Build evaluation context: upstream outputs + variables + convenience `data` alias
      const evalContext: Record<string, unknown> = { ...variables };
      let lastOutput: unknown = undefined;
      for (const [nid, result] of Object.entries(nodeOutputs)) {
        evalContext[nid] = result.output;
        lastOutput = result.output;
      }
      evalContext.data = lastOutput; // convenience alias for the most recent upstream output

      const result = vm.runInNewContext(resolvedExpr, evalContext, { timeout: 5000 });

      return {
        nodeId: node.id,
        status: 'success',
        output: result,
        resolvedArgs: { expression: resolvedExpr },
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        status: 'error',
        error: getErrorMessage(error, 'Transformer evaluation failed'),
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Execute a ForEach node: iterate over an array, executing body subgraph per item.
   */
  private async executeForEachNode(
    node: WorkflowNode,
    nodeOutputs: Record<string, NodeResult>,
    variables: Record<string, unknown>,
    edges: WorkflowEdge[],
    nodeMap: Map<string, WorkflowNode>,
    userId: string,
    abortSignal: AbortSignal,
    onProgress?: (event: WorkflowProgressEvent) => void,
    repo?: ReturnType<typeof createWorkflowsRepository>,
    logId?: string,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const data = node.data as ForEachNodeData;
    const maxIterations = data.maxIterations ?? 100;
    const onError = data.onError ?? 'stop';

    try {
      // 1. Resolve the array expression
      const resolvedArray = resolveTemplates(
        { _arr: data.arrayExpression }, nodeOutputs, variables
      )._arr;

      if (!Array.isArray(resolvedArray)) {
        return {
          nodeId: node.id,
          status: 'error',
          error: `ForEach: expression must return an array (got ${typeof resolvedArray})`,
          durationMs: Date.now() - startTime,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
        };
      }

      // 2. Detect body subgraph
      const { bodyNodes } = getForEachBodyNodes(node.id, edges);

      // Safety cap
      const items = resolvedArray.slice(0, maxIterations);
      if (resolvedArray.length > maxIterations) {
        _log.warn(`ForEach ${node.id}: truncated ${resolvedArray.length} items to ${maxIterations}`);
      }

      // 3. Handle empty array — skip body
      if (items.length === 0) {
        for (const bodyId of bodyNodes) {
          nodeOutputs[bodyId] = { nodeId: bodyId, status: 'skipped', completedAt: new Date().toISOString() };
          onProgress?.({ type: 'node_complete', nodeId: bodyId, status: 'skipped' });
        }
        return {
          nodeId: node.id,
          status: 'success',
          output: { results: [], count: 0, items: [] },
          iterationCount: 0,
          totalItems: 0,
          durationMs: Date.now() - startTime,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
        };
      }

      // 4. Topological sort body subgraph
      const bodyNodeList = [...bodyNodes].map(id => nodeMap.get(id)).filter(Boolean) as WorkflowNode[];
      const bodyEdges = edges.filter(e => bodyNodes.has(e.source) && bodyNodes.has(e.target));
      const bodyLevels = topologicalSort(bodyNodeList, bodyEdges);

      // 5. Iterate
      const collectedResults: unknown[] = [];
      const errors: Array<{ index: number; error: string }> = [];

      for (let i = 0; i < items.length; i++) {
        if (abortSignal.aborted) throw new Error('Workflow execution cancelled');

        const item = items[i];

        onProgress?.({
          type: 'foreach_iteration_start',
          nodeId: node.id,
          iterationIndex: i,
          iterationTotal: items.length,
        });

        // Set ForEach output for this iteration
        nodeOutputs[node.id] = {
          nodeId: node.id,
          status: 'success',
          output: { item, index: i, items, count: items.length },
          iterationCount: i + 1,
          totalItems: items.length,
          startedAt: new Date(startTime).toISOString(),
        };

        // Build iteration variables (supports {{itemVariable}} alias)
        const iterationVars = { ...variables };
        if (data.itemVariable) {
          iterationVars[data.itemVariable] = item;
          iterationVars[`${data.itemVariable}_index`] = i;
        }

        // Execute body subgraph level by level
        let iterationError: string | undefined;

        for (const bodyLevel of bodyLevels) {
          if (abortSignal.aborted) throw new Error('Workflow execution cancelled');

          const results = await Promise.allSettled(
            bodyLevel.map(async (bodyNodeId) => {
              // Skip if already skipped (e.g., condition branch)
              if (nodeOutputs[bodyNodeId]?.status === 'skipped') return nodeOutputs[bodyNodeId]!;

              const bodyNode = nodeMap.get(bodyNodeId)!;
              onProgress?.({ type: 'node_start', nodeId: bodyNodeId });

              if (bodyNode.type === 'llmNode') return this.executeLlmNode(bodyNode, nodeOutputs, iterationVars);
              if (bodyNode.type === 'conditionNode') return this.executeConditionNode(bodyNode, nodeOutputs, iterationVars);
              if (bodyNode.type === 'codeNode') return this.executeCodeNode(bodyNode, nodeOutputs, iterationVars, userId);
              if (bodyNode.type === 'transformerNode') return this.executeTransformerNode(bodyNode, nodeOutputs, iterationVars);
              if (bodyNode.type === 'forEachNode') {
                return this.executeForEachNode(bodyNode, nodeOutputs, iterationVars, edges, nodeMap, userId, abortSignal, onProgress, repo, logId);
              }
              return this.executeNode(bodyNode, nodeOutputs, iterationVars, userId);
            })
          );

          // Process body results
          for (let j = 0; j < bodyLevel.length; j++) {
            const bodyNodeId = bodyLevel[j]!;
            const settled = results[j]!;

            if (settled.status === 'fulfilled') {
              nodeOutputs[bodyNodeId] = settled.value;
            } else {
              nodeOutputs[bodyNodeId] = {
                nodeId: bodyNodeId,
                status: 'error',
                error: getErrorMessage(settled.reason, 'Unexpected error'),
                completedAt: new Date().toISOString(),
              };
            }

            const bodyResult = nodeOutputs[bodyNodeId]!;

            if (bodyResult.status === 'error') {
              onProgress?.({ type: 'node_error', nodeId: bodyNodeId, error: bodyResult.error });
              iterationError = bodyResult.error;
            } else {
              onProgress?.({
                type: 'node_complete',
                nodeId: bodyNodeId,
                status: bodyResult.status,
                output: bodyResult.output,
                durationMs: bodyResult.durationMs,
                branchTaken: bodyResult.branchTaken,
              });
            }

            // Handle condition branching within body
            const bodyNode = nodeMap.get(bodyNodeId);
            if (bodyNode?.type === 'conditionNode' && bodyResult.branchTaken) {
              const skippedHandle = bodyResult.branchTaken === 'true' ? 'false' : 'true';
              const skippedInBody = getDownstreamNodesByHandle(bodyNodeId, skippedHandle, bodyEdges);
              for (const skipId of skippedInBody) {
                if (!nodeOutputs[skipId] || nodeOutputs[skipId].status !== 'skipped') {
                  nodeOutputs[skipId] = { nodeId: skipId, status: 'skipped', completedAt: new Date().toISOString() };
                  onProgress?.({ type: 'node_complete', nodeId: skipId, status: 'skipped' });
                }
              }
            }
          }

          if (iterationError && onError === 'stop') break;
        }

        // Collect last body node's output as this iteration's result
        const lastLevel = bodyLevels[bodyLevels.length - 1] ?? [];
        const lastNodeId = lastLevel[lastLevel.length - 1];
        collectedResults.push(lastNodeId ? nodeOutputs[lastNodeId]?.output : item);

        if (iterationError) {
          errors.push({ index: i, error: iterationError });
          if (onError === 'stop') break;
        }

        onProgress?.({
          type: 'foreach_iteration_complete',
          nodeId: node.id,
          iterationIndex: i,
          iterationTotal: items.length,
        });

        // Persist intermediate progress
        if (repo && logId) {
          await repo.updateLog(logId, { nodeResults: nodeOutputs });
        }

        // Reset skipped status for body nodes before next iteration (condition branches may differ)
        for (const bodyId of bodyNodes) {
          if (nodeOutputs[bodyId]?.status === 'skipped') {
            delete nodeOutputs[bodyId];
          }
        }
      }

      // 6. Build ForEach final output
      const forEachOutput = {
        results: collectedResults,
        count: items.length,
        items,
        errors: errors.length > 0 ? errors : undefined,
        completedIterations: collectedResults.length,
      };

      return {
        nodeId: node.id,
        status: errors.length > 0 && onError === 'stop' ? 'error' : 'success',
        output: forEachOutput,
        iterationCount: collectedResults.length,
        totalItems: items.length,
        error: errors.length > 0 ? `${errors.length} iteration(s) failed` : undefined,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        status: 'error',
        error: getErrorMessage(error, 'ForEach execution failed'),
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _workflowService: WorkflowService | null = null;

export function getWorkflowService(): WorkflowService {
  if (!_workflowService) {
    _workflowService = new WorkflowService();
  }
  return _workflowService;
}
