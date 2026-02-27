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
  HttpRequestNodeData,
  DelayNodeData,
  SwitchNodeData,
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

// ============================================================================
// SSRF protection for HTTP Request node
// ============================================================================

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^localhost$/i,
];

function isSsrfTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    return PRIVATE_IP_PATTERNS.some((p) => p.test(parsed.hostname));
  } catch {
    return true; // Malformed URL — block
  }
}

const MAX_RESPONSE_SIZE = 1_048_576; // 1MB default

/**
 * Execute an HTTP Request node: make an API call with configurable method, headers, auth, body.
 */
export async function executeHttpRequestNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): Promise<NodeResult> {
  const startTime = Date.now();
  try {
    const data = node.data as HttpRequestNodeData;

    // Resolve templates in all configurable string fields
    const resolveMap: Record<string, unknown> = { _url: data.url };
    if (data.body) resolveMap._body = data.body;
    if (data.headers) {
      for (const [k, v] of Object.entries(data.headers)) {
        resolveMap[`_h_${k}`] = v;
      }
    }
    if (data.queryParams) {
      for (const [k, v] of Object.entries(data.queryParams)) {
        resolveMap[`_q_${k}`] = v;
      }
    }
    // Resolve auth token/credentials too
    if (data.auth?.token) resolveMap._authToken = data.auth.token;
    if (data.auth?.username) resolveMap._authUser = data.auth.username;
    if (data.auth?.password) resolveMap._authPass = data.auth.password;

    const resolved = resolveTemplates(resolveMap, nodeOutputs, variables);

    const url = resolved._url as string;

    // SSRF protection
    if (isSsrfTarget(url)) {
      _log.warn(`HTTP node ${node.id}: blocked request to private/internal address: ${url}`);
      return {
        nodeId: node.id,
        status: 'error',
        error: 'Requests to private/internal addresses are not allowed',
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    // Build headers
    const headers: Record<string, string> = {};
    if (data.headers) {
      for (const k of Object.keys(data.headers)) {
        headers[k] = resolved[`_h_${k}`] as string;
      }
    }

    // Auth
    if (data.auth && data.auth.type !== 'none') {
      const authToken = (resolved._authToken as string) ?? '';
      switch (data.auth.type) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${authToken}`;
          break;
        case 'basic': {
          const user = (resolved._authUser as string) ?? '';
          const pass = (resolved._authPass as string) ?? '';
          headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
          break;
        }
        case 'apiKey':
          headers[data.auth.headerName ?? 'X-API-Key'] = authToken;
          break;
      }
    }

    // Build URL with query params
    const urlObj = new URL(url);
    if (data.queryParams) {
      for (const k of Object.keys(data.queryParams)) {
        urlObj.searchParams.set(k, resolved[`_q_${k}`] as string);
      }
    }

    // Fetch options
    const fetchOptions: RequestInit = {
      method: data.method,
      headers,
      signal: AbortSignal.timeout(data.timeoutMs || 30_000),
    };

    if (['POST', 'PUT', 'PATCH'].includes(data.method) && data.body) {
      fetchOptions.body = resolved._body as string;
      if (data.bodyType === 'json' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      } else if (data.bodyType === 'form' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }

    const response = await fetch(urlObj.toString(), fetchOptions);

    // Read response with size limit
    const maxSize = data.maxResponseSize ?? MAX_RESPONSE_SIZE;
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > maxSize) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `Response too large: ${contentLength} bytes (max: ${maxSize})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    const responseText = await response.text();

    // Parse response body — auto-detect JSON
    let responseBody: unknown = responseText;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        /* keep as text */
      }
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    const output = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
    };

    return {
      nodeId: node.id,
      status: response.ok ? 'success' : 'error',
      output,
      resolvedArgs: { method: data.method, url: urlObj.toString() },
      error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'HTTP request failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Delay node: wait for a specified duration before continuing.
 */
export async function executeDelayNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
  abortSignal?: AbortSignal
): Promise<NodeResult> {
  const startTime = Date.now();
  try {
    const data = node.data as DelayNodeData;

    // Resolve template in duration (allows dynamic wait times)
    const resolved = resolveTemplates({ _dur: data.duration }, nodeOutputs, variables);
    const durationValue = Number(resolved._dur);

    if (isNaN(durationValue) || durationValue < 0) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `Invalid delay duration: ${String(resolved._dur)}`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    // Convert to milliseconds
    const multiplier = data.unit === 'hours' ? 3_600_000 : data.unit === 'minutes' ? 60_000 : 1000;
    const delayMs = durationValue * multiplier;

    // Safety cap: max 1 hour
    const cappedMs = Math.min(delayMs, 3_600_000);

    // Wait with abort support
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, cappedMs);
      if (abortSignal) {
        if (abortSignal.aborted) {
          clearTimeout(timer);
          reject(new Error('Workflow execution cancelled'));
          return;
        }
        abortSignal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('Workflow execution cancelled'));
          },
          { once: true }
        );
      }
    });

    return {
      nodeId: node.id,
      status: 'success',
      output: { delayMs: cappedMs, unit: data.unit, value: durationValue },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Delay execution failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Switch node: evaluate expression, match against cases, return which branch to take.
 */
/**
 * Execute a Notification node: resolve message template, broadcast via WebSocket.
 */
export function executeNotificationNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as unknown as Record<string, unknown>;
    const severity = (data.severity as string) || 'info';

    // Resolve templates in the message
    const resolvedMsg = resolveTemplates({ _msg: data.message as string }, nodeOutputs, variables)
      ._msg as string;

    // Lazy-import wsGateway to avoid circular deps
    import('../../ws/server.js').then(({ wsGateway }) => {
      wsGateway.broadcast('system:notification', {
        type: severity as 'info' | 'warning' | 'error' | 'success',
        message: resolvedMsg,
        source: 'workflow',
      });
    }).catch(() => {
      _log.warn(`Notification node ${node.id}: failed to broadcast via WebSocket`);
    });

    return {
      nodeId: node.id,
      status: 'success',
      output: { sent: true, channel: 'websocket', message: resolvedMsg, severity },
      resolvedArgs: { message: resolvedMsg, severity },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Notification node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Merge node: collect all incoming node outputs into a single array/object.
 */
export function executeMergeNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  _variables: Record<string, unknown>,
  incomingNodeIds: string[]
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as unknown as Record<string, unknown>;
    const mode = (data.mode as string) || 'waitAll';

    // Collect outputs from all incoming (upstream) nodes
    const collected: Record<string, unknown> = {};
    for (const nid of incomingNodeIds) {
      const result = nodeOutputs[nid];
      if (result) {
        collected[nid] = result.output;
      }
    }

    const output = mode === 'waitAll'
      ? { mode, results: collected, count: Object.keys(collected).length }
      : { mode, results: collected, count: Object.keys(collected).length };

    return {
      nodeId: node.id,
      status: 'success',
      output,
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Merge node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

export function executeSwitchNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as SwitchNodeData;

    // Resolve templates in the expression
    const resolvedExpr = resolveTemplates({ _expr: data.expression }, nodeOutputs, variables)
      ._expr as string;

    // Build evaluation context: upstream outputs + variables
    const evalContext: Record<string, unknown> = { ...variables };
    for (const [nid, result] of Object.entries(nodeOutputs)) {
      evalContext[nid] = result.output;
    }

    const vmTimeout = data.timeoutMs || 5000;
    const result = vm.runInNewContext(resolvedExpr, evalContext, { timeout: vmTimeout });
    const resultStr = String(result);

    // Match against cases
    const matchedCase = data.cases.find((c) => c.value === resultStr);
    const branchTaken = matchedCase ? matchedCase.label : 'default';

    return {
      nodeId: node.id,
      status: 'success',
      output: result,
      branchTaken,
      resolvedArgs: { expression: resolvedExpr, evaluatedValue: resultStr, matchedCase: branchTaken },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Switch evaluation failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}
