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
  DataStoreNodeData,
  SchemaValidatorNodeData,
  FilterNodeData,
  MapNodeData,
  AggregateNodeData,
  WebhookResponseNodeData,
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
import { isBlockedUrl, isPrivateUrlAsync } from '../../utils/ssrf.js';
import { resolveTemplates } from './template-resolver.js';
import type { ToolExecutionResult } from './types.js';
import vm from 'node:vm';

const log = getLog('WorkflowService');

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
      log.info(`Resolved workflow tool name "${name}" -> "${def.name}"`);
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
 *
 * Supports:
 * - `responseFormat: 'json'` — appends JSON instruction and parses response
 * - `conversationMessages` — multi-turn context inserted between system and user
 */
export async function executeLlmNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): Promise<NodeResult> {
  const startTime = Date.now();

  try {
    const data = node.data as LlmNodeData;
    const responseFormat = data.responseFormat ?? 'text';

    // Resolve templates in user message (e.g., {{node_1.output}})
    const resolvedMessage = resolveTemplates({ _msg: data.userMessage }, nodeOutputs, variables)
      ._msg as string;

    // Resolve templates in system prompt too (if present)
    let resolvedSystemPrompt = data.systemPrompt
      ? (resolveTemplates({ _sp: data.systemPrompt }, nodeOutputs, variables)._sp as string)
      : undefined;

    // When responseFormat is 'json', append JSON instruction to system prompt
    if (responseFormat === 'json') {
      const jsonInstruction =
        '\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no explanation.';
      resolvedSystemPrompt = resolvedSystemPrompt
        ? resolvedSystemPrompt + jsonInstruction
        : jsonInstruction.trimStart();
    }

    // Resolve templates in conversation messages (if present)
    const convMessages = data.conversationMessages ?? [];
    let resolvedConversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (convMessages.length > 0) {
      const convResolveMap: Record<string, unknown> = {};
      for (let i = 0; i < convMessages.length; i++) {
        convResolveMap[`_conv_${i}`] = convMessages[i]!.content;
      }
      const resolvedConv = resolveTemplates(convResolveMap, nodeOutputs, variables);
      resolvedConversationMessages = convMessages.map((msg, i) => ({
        role: msg.role,
        content: resolvedConv[`_conv_${i}`] as string,
      }));
    }

    // Lazy import to avoid circular deps (agent-cache is in routes/)
    const { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } =
      await import('../../routes/agent-cache.js');
    const { resolveProviderAndModel } = await import('../../routes/settings.js');

    // Resolve provider/model: empty or 'default' → user's configured defaults
    let effectiveProvider = data.provider;
    let effectiveModel = data.model;
    if (
      !effectiveProvider ||
      effectiveProvider === 'default' ||
      !effectiveModel ||
      effectiveModel === 'default'
    ) {
      const resolved = await resolveProviderAndModel(
        effectiveProvider || 'default',
        effectiveModel || 'default'
      );
      if (!resolved.provider) {
        return {
          nodeId: node.id,
          status: 'error',
          error: 'No AI provider configured. Set up a provider in Settings.',
          durationMs: Date.now() - startTime,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
        };
      }
      effectiveProvider = resolved.provider;
      effectiveModel = resolved.model ?? effectiveModel;
    }

    // Resolve API key: use node-level override or stored key
    const apiKey = data.apiKey || (await getProviderApiKey(effectiveProvider));

    // Resolve base URL and headers from provider config
    let baseUrl = data.baseUrl;
    const providerCfg = loadProviderConfig(effectiveProvider);
    if (!baseUrl) {
      if (providerCfg?.baseUrl) baseUrl = providerCfg.baseUrl;
    }

    // Map non-native providers to openai-compatible
    const providerType = NATIVE_PROVIDERS.has(effectiveProvider) ? effectiveProvider : 'openai';

    const provider = createProvider({
      provider: providerType as ProviderConfig['provider'],
      apiKey,
      baseUrl,
      headers: providerCfg?.headers,
    });

    // Build message array: system → conversation messages → user
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (resolvedSystemPrompt) {
      messages.push({ role: 'system', content: resolvedSystemPrompt });
    }
    // Insert multi-turn conversation messages between system and user
    for (const convMsg of resolvedConversationMessages) {
      messages.push(convMsg);
    }
    messages.push({ role: 'user', content: resolvedMessage });

    const result = await provider.complete({
      messages,
      model: {
        model: effectiveModel,
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

    const durationMs = Date.now() - startTime;

    // Parse JSON response if responseFormat is 'json'
    let output: unknown = result.value.content;
    if (responseFormat === 'json' && typeof output === 'string') {
      try {
        output = JSON.parse(output);
      } catch {
        // Parse failed — return raw string (don't error)
      }
    }

    log.info('LLM completed', {
      nodeId: node.id,
      provider: effectiveProvider,
      model: effectiveModel,
      durationMs,
      responseFormat,
    });

    return {
      nodeId: node.id,
      status: 'success',
      output,
      resolvedArgs: {
        provider: effectiveProvider,
        model: effectiveModel,
        userMessage: resolvedMessage,
        responseFormat,
      },
      durationMs,
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
    let lastOutput: unknown = undefined;
    for (const [nid, result] of Object.entries(nodeOutputs)) {
      evalContext[nid] = result.output;
      lastOutput = result.output;
    }
    evalContext.data = lastOutput; // convenience alias for the most recent upstream output

    const vmTimeout = (node.data as ConditionNodeData).timeoutMs || 5000;
    const result = vm.runInNewContext(resolvedExpr, evalContext, { timeout: vmTimeout });
    const branch = Boolean(result);
    const durationMs = Date.now() - startTime;

    log.info('Condition evaluated', {
      nodeId: node.id,
      result: branch ? 'true' : 'false',
      durationMs,
    });

    return {
      nodeId: node.id,
      status: 'success',
      output: branch,
      branchTaken: branch ? 'true' : 'false',
      durationMs,
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

    // Validate language
    const SUPPORTED_LANGUAGES = ['javascript', 'python', 'shell'] as const;
    if (!SUPPORTED_LANGUAGES.includes(data.language as (typeof SUPPORTED_LANGUAGES)[number])) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `Unsupported language: "${data.language}". Supported: javascript, python, shell`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    // Resolve templates in the code string
    const resolvedCode = resolveTemplates({ _code: data.code }, nodeOutputs, variables)
      ._code as string;

    // Map language to execution tool name
    const toolMap: Record<string, string> = {
      javascript: 'execute_javascript',
      python: 'execute_python',
      shell: 'execute_shell',
    };
    const toolName = toolMap[data.language]!;

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
    const durationMs = Date.now() - startTime;

    log.info('Transformer completed', { nodeId: node.id, durationMs });

    return {
      nodeId: node.id,
      status: 'success',
      output: result,
      resolvedArgs: { expression: resolvedExpr },
      durationMs,
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
// SSRF protection for HTTP Request node (uses shared utility from utils/ssrf.ts)
// ============================================================================

async function isSsrfTarget(url: string): Promise<boolean> {
  // Quick sync check: protocol, credentials, numeric obfuscation, private ranges
  if (isBlockedUrl(url)) return true;
  // Async DNS-rebinding check: resolves hostname and verifies resolved IPs
  return isPrivateUrlAsync(url);
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
    if (await isSsrfTarget(url)) {
      log.warn(`HTTP node ${node.id}: blocked request to private/internal address: ${url}`);
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
    const MAX_DELAY_MS = 3_600_000;
    const actualDelay = Math.min(delayMs, MAX_DELAY_MS);
    const resolvedUnit = data.unit ?? 'seconds';

    if (delayMs > MAX_DELAY_MS) {
      log.warn('Delay capped to maximum 1 hour', {
        nodeId: node.id,
        requestedMs: delayMs,
        cappedMs: MAX_DELAY_MS,
      });
    }

    log.info('Delay applied', { nodeId: node.id, delayMs: actualDelay, unit: resolvedUnit });

    // Wait with abort support
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, actualDelay);
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
      output: { delayMs: actualDelay, unit: data.unit, value: durationValue },
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
export async function executeNotificationNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): Promise<NodeResult> {
  const startTime = Date.now();
  try {
    const data = node.data as unknown as Record<string, unknown>;
    const severity = (data.severity as string) || 'info';

    // Resolve templates in the message
    const resolvedMsg = resolveTemplates({ _msg: data.message as string }, nodeOutputs, variables)
      ._msg as string;

    // Lazy-import wsGateway to avoid circular deps and await broadcast
    let warning: string | undefined;
    try {
      const { wsGateway } = await import('../../ws/server.js');
      await wsGateway.broadcast('system:notification', {
        type: severity as 'info' | 'warning' | 'error' | 'success',
        message: resolvedMsg,
        source: 'workflow',
      });
      log.info('Notification broadcast sent', { nodeId: node.id, severity });
    } catch {
      warning = 'WebSocket broadcast failed — delivery not confirmed';
      log.warn(`Notification node ${node.id}: failed to broadcast via WebSocket`);
    }

    return {
      nodeId: node.id,
      status: 'success',
      output: {
        sent: !warning,
        channel: 'websocket',
        message: resolvedMsg,
        severity,
        ...(warning ? { warning } : {}),
      },
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

    let output: Record<string, unknown>;
    if (mode === 'firstCompleted') {
      // Return only the first non-null/non-undefined upstream result
      let firstNodeId: string | undefined;
      let firstOutput: unknown;
      for (const nid of incomingNodeIds) {
        const val = collected[nid];
        if (val !== null && val !== undefined) {
          firstNodeId = nid;
          firstOutput = val;
          break;
        }
      }
      if (firstNodeId !== undefined) {
        output = {
          mode,
          results: { [firstNodeId]: firstOutput },
          count: 1,
          selectedNode: firstNodeId,
        };
      } else {
        output = { mode, results: {}, count: 0 };
      }
    } else {
      output = { mode, results: collected, count: Object.keys(collected).length };
    }

    log.info('Merge completed', {
      nodeId: node.id,
      mode,
      inputCount: Object.keys(collected).length,
    });

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

// ============================================================================
// In-memory data store for DataStore nodes (namespace → key → value)
// ============================================================================

const MAX_DATASTORE_ENTRIES = 10_000;
const workflowDataStore = new Map<string, Map<string, unknown>>();

/** Evict the oldest namespace when the total entry count exceeds the limit. */
function evictOldest(): void {
  // Map iteration order is insertion order — first key is the oldest namespace
  const firstKey = workflowDataStore.keys().next().value;
  if (firstKey !== undefined) {
    workflowDataStore.delete(firstKey);
    log.info('DataStore evicted oldest namespace due to size limit', { namespace: firstKey });
  }
}

/** Get the total number of entries across all namespaces. */
function getDataStoreSize(): number {
  let total = 0;
  for (const store of workflowDataStore.values()) {
    total += store.size;
  }
  return total;
}

/**
 * Clear the data store. If a namespace is provided, only that namespace is
 * cleared; otherwise the entire store is wiped.
 */
export function clearDataStore(namespace?: string): void {
  if (namespace) {
    workflowDataStore.delete(namespace);
  } else {
    workflowDataStore.clear();
  }
}

/**
 * Execute a DataStore node: get/set/delete/list/has on a namespace-scoped in-memory Map.
 */
export function executeDataStoreNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as DataStoreNodeData;
    const resolved = resolveTemplates(
      { _key: data.key, _value: data.value, _ns: data.namespace ?? 'default' },
      nodeOutputs,
      variables
    );
    const ns = resolved._ns as string;
    const key = resolved._key as string;

    if (!workflowDataStore.has(ns)) {
      workflowDataStore.set(ns, new Map());
    }
    const store = workflowDataStore.get(ns)!;

    let output: unknown;
    switch (data.operation) {
      case 'get':
        output = store.get(key) ?? null;
        break;
      case 'set': {
        const prev = store.get(key) ?? null;
        store.set(key, resolved._value);
        // Evict oldest namespace when total entries exceed the limit
        while (getDataStoreSize() > MAX_DATASTORE_ENTRIES) {
          evictOldest();
        }
        output = { previousValue: prev };
        break;
      }
      case 'delete':
        output = { existed: store.delete(key) };
        break;
      case 'list':
        output = [...store.keys()];
        break;
      case 'has':
        output = store.has(key);
        break;
    }

    log.info('DataStore operation completed', {
      nodeId: node.id,
      operation: data.operation,
      ns,
      key,
    });
    return {
      nodeId: node.id,
      status: 'success',
      output,
      resolvedArgs: { operation: data.operation, namespace: ns, key },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'DataStore node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a SchemaValidator node: validate upstream data against a JSON schema.
 */
export function executeSchemaValidatorNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  _variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as SchemaValidatorNodeData;
    const schema = data.schema;
    const validationErrors: string[] = [];

    // Get upstream data (last output)
    let inputData: unknown = undefined;
    for (const result of Object.values(nodeOutputs)) {
      inputData = result.output;
    }

    // Simple manual validation: check type, required fields, property types
    if (schema.type === 'object' && typeof inputData === 'object' && inputData !== null) {
      const obj = inputData as Record<string, unknown>;
      const required = (schema.required as string[]) ?? [];
      for (const field of required) {
        if (!(field in obj)) validationErrors.push(`Missing required field: "${field}"`);
      }
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in obj && propSchema.type && typeof obj[key] !== propSchema.type) {
          validationErrors.push(
            `Field "${key}" expected type "${propSchema.type}", got "${typeof obj[key]}"`
          );
        }
      }
    } else if (schema.type && typeof inputData !== schema.type) {
      validationErrors.push(`Expected type "${schema.type as string}", got "${typeof inputData}"`);
    }

    const valid = validationErrors.length === 0;
    log.info('Schema validation completed', {
      nodeId: node.id,
      valid,
      errorCount: validationErrors.length,
    });

    if (!valid && data.strict) {
      return {
        nodeId: node.id,
        status: 'error',
        output: { valid, errors: validationErrors },
        error: `Validation failed: ${validationErrors.join('; ')}`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    return {
      nodeId: node.id,
      status: 'success',
      output: { valid, errors: validationErrors },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Schema validation failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Filter node: filter an array by a condition expression.
 */
export function executeFilterNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as FilterNodeData;

    // Resolve array expression via template
    const resolved = resolveTemplates({ _arr: data.arrayExpression }, nodeOutputs, variables);
    const arr = resolved._arr;
    if (!Array.isArray(arr)) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `arrayExpression did not resolve to an array (got ${typeof arr})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    const vmTimeout = data.timeoutMs || 5000;
    const filtered = arr.filter((item, index) => {
      const ctx = { item, index, ...variables };
      return vm.runInNewContext(data.condition, ctx, { timeout: vmTimeout });
    });

    log.info('Filter completed', {
      nodeId: node.id,
      inputCount: arr.length,
      outputCount: filtered.length,
    });
    return {
      nodeId: node.id,
      status: 'success',
      output: filtered,
      resolvedArgs: { condition: data.condition, inputCount: arr.length },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Filter node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a Map node: transform each element of an array via an expression.
 */
export function executeMapNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as MapNodeData;

    const resolved = resolveTemplates({ _arr: data.arrayExpression }, nodeOutputs, variables);
    const arr = resolved._arr;
    if (!Array.isArray(arr)) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `arrayExpression did not resolve to an array (got ${typeof arr})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    const vmTimeout = data.timeoutMs || 5000;
    const mapped = arr.map((item, index) => {
      const ctx = { item, index, ...variables };
      return vm.runInNewContext(data.expression, ctx, { timeout: vmTimeout });
    });

    log.info('Map completed', { nodeId: node.id, count: arr.length });
    return {
      nodeId: node.id,
      status: 'success',
      output: mapped,
      resolvedArgs: { expression: data.expression, inputCount: arr.length },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Map node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute an Aggregate node: perform aggregate operations on an array.
 */
export function executeAggregateNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as AggregateNodeData;

    const resolved = resolveTemplates({ _arr: data.arrayExpression }, nodeOutputs, variables);
    const arr = resolved._arr;
    if (!Array.isArray(arr)) {
      return {
        nodeId: node.id,
        status: 'error',
        error: `arrayExpression did not resolve to an array (got ${typeof arr})`,
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    let output: unknown;
    const getVal = (item: unknown): number => {
      if (data.field && typeof item === 'object' && item !== null) {
        return Number((item as Record<string, unknown>)[data.field]);
      }
      return Number(item);
    };

    switch (data.operation) {
      case 'count':
        output = arr.length;
        break;
      case 'sum':
        output = arr.reduce((acc, item) => acc + getVal(item), 0);
        break;
      case 'avg':
        output = arr.length > 0 ? arr.reduce((acc, item) => acc + getVal(item), 0) / arr.length : 0;
        break;
      case 'min':
        output = arr.length > 0 ? Math.min(...arr.map(getVal)) : null;
        break;
      case 'max':
        output = arr.length > 0 ? Math.max(...arr.map(getVal)) : null;
        break;
      case 'groupBy': {
        const groups: Record<string, unknown[]> = {};
        for (const item of arr) {
          const key =
            data.field && typeof item === 'object' && item !== null
              ? String((item as Record<string, unknown>)[data.field])
              : String(item);
          if (!groups[key]) groups[key] = [];
          groups[key].push(item);
        }
        output = groups;
        break;
      }
      case 'flatten':
        output = arr.flat();
        break;
      case 'unique':
        if (data.field) {
          const seen = new Set<unknown>();
          output = arr.filter((item) => {
            const val =
              typeof item === 'object' && item !== null
                ? (item as Record<string, unknown>)[data.field!]
                : item;
            if (seen.has(val)) return false;
            seen.add(val);
            return true;
          });
        } else {
          output = [...new Set(arr)];
        }
        break;
    }

    log.info('Aggregate completed', {
      nodeId: node.id,
      operation: data.operation,
      inputCount: arr.length,
    });
    return {
      nodeId: node.id,
      status: 'success',
      output,
      resolvedArgs: { operation: data.operation, field: data.field, inputCount: arr.length },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Aggregate node failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Execute a WebhookResponse node: configure the HTTP response for webhook-triggered workflows.
 */
export function executeWebhookResponseNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>
): NodeResult {
  const startTime = Date.now();
  try {
    const data = node.data as WebhookResponseNodeData;

    // Resolve templates in body and header values
    const resolveMap: Record<string, unknown> = {};
    if (data.body) resolveMap._body = data.body;
    if (data.headers) {
      for (const [k, v] of Object.entries(data.headers)) {
        resolveMap[`_h_${k}`] = v;
      }
    }
    const resolved = resolveTemplates(resolveMap, nodeOutputs, variables);

    const headers: Record<string, string> = {};
    if (data.headers) {
      for (const k of Object.keys(data.headers)) {
        headers[k] = resolved[`_h_${k}`] as string;
      }
    }

    const output = {
      statusCode: data.statusCode ?? 200,
      body: resolved._body ?? '',
      headers,
      contentType: data.contentType ?? 'application/json',
    };

    log.info('WebhookResponse configured', { nodeId: node.id, statusCode: output.statusCode });
    return {
      nodeId: node.id,
      status: 'success',
      output,
      resolvedArgs: { statusCode: output.statusCode, contentType: output.contentType },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'WebhookResponse node failed'),
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

    // Build evaluation context: upstream outputs + variables + convenience `data` alias
    const evalContext: Record<string, unknown> = { ...variables };
    let lastOutput: unknown = undefined;
    for (const [nid, result] of Object.entries(nodeOutputs)) {
      evalContext[nid] = result.output;
      lastOutput = result.output;
    }
    evalContext.data = lastOutput; // convenience alias for the most recent upstream output

    const vmTimeout = data.timeoutMs || 5000;
    const result = vm.runInNewContext(resolvedExpr, evalContext, { timeout: vmTimeout });
    const resultStr = String(result);

    // Match against cases
    const matchedCase = data.cases.find((c) => c.value === resultStr);
    const branchTaken = matchedCase ? matchedCase.label : 'default';

    log.info('Switch evaluated', { nodeId: node.id, matchedCase: branchTaken, value: resultStr });

    return {
      nodeId: node.id,
      status: 'success',
      output: result,
      branchTaken,
      resolvedArgs: {
        expression: resolvedExpr,
        evaluatedValue: resultStr,
        matchedCase: branchTaken,
      },
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
