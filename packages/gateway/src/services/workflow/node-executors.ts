/**
 * Node executors — Functions for executing individual workflow node types.
 *
 * Each executor takes a node, its upstream outputs, workflow variables,
 * and returns a NodeResult.
 */

import type {
  WorkflowNode,
  ToolNodeData,
  LlmNodeData,
  ConditionNodeData,
  CodeNodeData,
  TransformerNodeData,
  NodeResult,
} from '../../db/repositories/workflows.js';
import {
  createProvider,
  type ProviderConfig,
  type IToolService,
  type ToolServiceResult,
} from '@ownpilot/core';
import { getErrorMessage } from '../../routes/helpers.js';
import { getLog } from '../log.js';
import { resolveTemplates } from './template-resolver.js';
import type { ToolExecutionResult } from './types.js';
import vm from 'node:vm';

const _log = getLog('WorkflowService');

/** Convert ToolServiceResult to ToolExecutionResult. */
export function toToolExecResult(r: ToolServiceResult): ToolExecutionResult {
  if (r.isError) {
    return { success: false, error: r.content };
  }
  // Try to parse JSON content for structured results
  try {
    return { success: true, result: JSON.parse(r.content) };
  } catch {
    return { success: true, result: r.content };
  }
}

/**
 * Resolve a tool name that may have dots stripped by the AI copilot.
 * e.g. "mcpgithublist_repositories" -> "mcp.github.list_repositories"
 *
 * Resolution order:
 * 1. Exact match in registry -> use as-is
 * 2. Normalized match: remove dots from all registered names, find match
 */
export function resolveWorkflowToolName(name: string, toolService: IToolService): string {
  // 1. Exact or base-name match
  if (toolService.has(name)) return name;

  // 2. Try normalized match — remove dots from all registered names and compare
  const normalized = name.replace(/\./g, '').toLowerCase();
  for (const def of toolService.getDefinitions()) {
    const defNormalized = def.name.replace(/\./g, '').toLowerCase();
    if (defNormalized === normalized) {
      _log.info(`Resolved workflow tool name "${name}" -> "${def.name}"`);
      return def.name;
    }
  }

  // No match found — return original (will produce a "not found" error)
  return name;
}

/**
 * Execute a single tool node: resolve templates, call tool, return result.
 */
export async function executeNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
  userId: string,
  toolService: IToolService
): Promise<NodeResult> {
  const startTime = Date.now();

  try {
    const data = node.data as ToolNodeData;
    const resolvedArgs = resolveTemplates(data.toolArgs, nodeOutputs, variables);

    // Resolve tool name — handles cases where dots were stripped (e.g. copilot AI)
    const toolName = resolveWorkflowToolName(data.toolName, toolService);

    const toolResult = await toolService.execute(toolName, resolvedArgs, {
      userId,
      execSource: 'workflow',
    });
    const result: ToolExecutionResult = toToolExecResult(toolResult);

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
export async function executeLlmNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): Promise<NodeResult> {
  const startTime = Date.now();

  try {
    const data = node.data as LlmNodeData;

    // Resolve templates in user message (e.g., {{node_1.output}})
    const resolvedMessage = resolveTemplates({ _msg: data.userMessage }, nodeOutputs, variables)
      ._msg as string;

    // Resolve templates in system prompt too (if present)
    const resolvedSystemPrompt = data.systemPrompt
      ? (resolveTemplates({ _sp: data.systemPrompt }, nodeOutputs, variables)._sp as string)
      : undefined;

    // Lazy import to avoid circular deps (agent-cache is in routes/)
    const { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } =
      await import('../../routes/agent-cache.js');

    // Resolve API key: use node-level override or stored key
    const apiKey = data.apiKey || (await getProviderApiKey(data.provider));

    // Resolve base URL and headers from provider config
    let baseUrl = data.baseUrl;
    const providerCfg = loadProviderConfig(data.provider);
    if (!baseUrl) {
      if (providerCfg?.baseUrl) baseUrl = providerCfg.baseUrl;
    }

    // Map non-native providers to openai-compatible
    const providerType = NATIVE_PROVIDERS.has(data.provider) ? data.provider : 'openai';

    const provider = createProvider({
      provider: providerType as ProviderConfig['provider'],
      apiKey,
      baseUrl,
      headers: providerCfg?.headers,
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
export function executeConditionNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as ConditionNodeData;

    // Resolve templates in the expression
    const resolvedExpr = resolveTemplates({ _expr: data.expression }, nodeOutputs, variables)
      ._expr as string;

    // Build evaluation context: upstream outputs accessible by node ID + variables
    const evalContext: Record<string, unknown> = { ...variables };
    for (const [nid, result] of Object.entries(nodeOutputs)) {
      evalContext[nid] = result.output;
    }

    const vmTimeout = (node.data as ConditionNodeData).timeoutMs || 5000;
    const result = vm.runInNewContext(resolvedExpr, evalContext, { timeout: vmTimeout });
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
export async function executeCodeNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
  userId: string,
  toolService: IToolService
): Promise<NodeResult> {
  const startTime = Date.now();
  try {
    const data = node.data as CodeNodeData;

    // Resolve templates in the code string
    const resolvedCode = resolveTemplates({ _code: data.code }, nodeOutputs, variables)
      ._code as string;

    // Map language to execution tool name
    const toolMap: Record<string, string> = {
      javascript: 'execute_javascript',
      python: 'execute_python',
      shell: 'execute_shell',
    };
    const toolName = toolMap[data.language] ?? 'execute_javascript';

    const toolResult = await toolService.execute(
      toolName,
      { code: resolvedCode },
      {
        userId,
        execSource: 'workflow',
      }
    );
    const result: ToolExecutionResult = toToolExecResult(toolResult);

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
export function executeTransformerNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as TransformerNodeData;

    // Resolve templates in the expression
    const resolvedExpr = resolveTemplates({ _expr: data.expression }, nodeOutputs, variables)
      ._expr as string;

    // Build evaluation context: upstream outputs + variables + convenience `data` alias
    const evalContext: Record<string, unknown> = { ...variables };
    let lastOutput: unknown = undefined;
    for (const [nid, result] of Object.entries(nodeOutputs)) {
      evalContext[nid] = result.output;
      lastOutput = result.output;
    }
    evalContext.data = lastOutput; // convenience alias for the most recent upstream output

    const vmTimeout = (node.data as TransformerNodeData).timeoutMs || 5000;
    const result = vm.runInNewContext(resolvedExpr, evalContext, { timeout: vmTimeout });

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
