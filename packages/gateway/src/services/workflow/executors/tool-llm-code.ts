/**
 * Workflow Executors — Tool, LLM, Code, Transformer
 *
 * Nodes that resolve templates and either:
 *  - call a tool by name (toolNode)
 *  - invoke an AI provider (llmNode)
 *  - execute user code via the execute_* tools (codeNode)
 *  - evaluate a JS expression in a VM sandbox (transformerNode)
 */

import type {
  WorkflowNode,
  ToolNodeData,
  LlmNodeData,
  CodeNodeData,
  TransformerNodeData,
  NodeResult,
} from '../../../db/repositories/workflows.js';
import { createProvider, type ProviderConfig, type IToolService } from '@ownpilot/core';
import { getErrorMessage } from '../../../routes/helpers.js';
import { resolveTemplates } from '../template-resolver.js';
import type { ToolExecutionResult } from '../types.js';
import { log, safeVmEval, toToolExecResult, resolveWorkflowToolName } from './utils.js';

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

    const resolvedMessage = resolveTemplates({ _msg: data.userMessage }, nodeOutputs, variables)
      ._msg as string;

    let resolvedSystemPrompt = data.systemPrompt
      ? (resolveTemplates({ _sp: data.systemPrompt }, nodeOutputs, variables)._sp as string)
      : undefined;

    if (responseFormat === 'json') {
      const jsonInstruction =
        '\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no explanation.';
      resolvedSystemPrompt = resolvedSystemPrompt
        ? resolvedSystemPrompt + jsonInstruction
        : jsonInstruction.trimStart();
    }

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

    const { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } =
      await import('../../../routes/agent-cache.js');
    const { resolveDefaultProviderAndModel } = await import('../../../routes/settings.js');

    let effectiveProvider = data.provider;
    let effectiveModel = data.model;
    if (
      !effectiveProvider ||
      effectiveProvider === 'default' ||
      !effectiveModel ||
      effectiveModel === 'default'
    ) {
      const resolved = await resolveDefaultProviderAndModel(
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

    const apiKey = data.apiKey || (await getProviderApiKey(effectiveProvider));

    let baseUrl = data.baseUrl;
    const providerCfg = loadProviderConfig(effectiveProvider);
    if (!baseUrl) {
      if (providerCfg?.baseUrl) baseUrl = providerCfg.baseUrl;
    }

    const providerType = NATIVE_PROVIDERS.has(effectiveProvider) ? effectiveProvider : 'openai';

    const provider = createProvider({
      provider: providerType as ProviderConfig['provider'],
      apiKey,
      baseUrl,
      headers: providerCfg?.headers,
    });

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (resolvedSystemPrompt) {
      messages.push({ role: 'system', content: resolvedSystemPrompt });
    }
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

    const resolvedCode = resolveTemplates({ _code: data.code }, nodeOutputs, variables)
      ._code as string;

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

    const resolvedExpr = resolveTemplates({ _expr: data.expression }, nodeOutputs, variables)
      ._expr as string;

    const evalContext: Record<string, unknown> = { ...variables };
    let lastOutput: unknown = undefined;
    for (const [nid, result] of Object.entries(nodeOutputs)) {
      evalContext[nid] = result.output;
      lastOutput = result.output;
    }
    evalContext.data = lastOutput;

    const vmTimeout = (node.data as TransformerNodeData).timeoutMs ?? 5000;
    const result = safeVmEval(resolvedExpr, evalContext, vmTimeout);
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
