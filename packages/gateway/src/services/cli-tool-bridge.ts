/**
 * CLI Tool Bridge
 *
 * Enables tool calling for CLI-backed chat providers by:
 * 1. Injecting tool definitions into the prompt as structured text
 * 2. Instructing the model to output <tool_call> blocks
 * 3. Parsing CLI output for tool call markers
 * 4. Executing tools via OwnPilot's ToolRegistry
 * 5. Re-invoking the CLI with results until the model stops calling tools
 *
 * This makes CLI providers (Claude CLI, Codex CLI, Gemini CLI) support
 * the same tool ecosystem as native API providers, using prompt engineering
 * instead of native function calling.
 */

import type { ToolDefinition, ToolResult, ToolCall, Message } from '@ownpilot/core';
import { ToolRegistry } from '@ownpilot/core';
import { getLog } from './log.js';

const log = getLog('ToolBridge');

// =============================================================================
// Constants
// =============================================================================

/** Maximum tool-calling rounds before forcing stop */
const MAX_TOOL_ROUNDS = 8;

/** Markers for tool call detection in model output */
const TOOL_CALL_OPEN = '<tool_call>';
const TOOL_CALL_CLOSE = '</tool_call>';
const TOOL_RESULT_OPEN = '<tool_result>';
const TOOL_RESULT_CLOSE = '</tool_result>';

// =============================================================================
// Types
// =============================================================================

export interface ToolBridgeConfig {
  /** Tool registry with registered executors */
  tools: ToolRegistry;
  /** Which tool definitions to expose (subset of registry) */
  toolDefinitions: readonly ToolDefinition[];
  /** Conversation ID for tool execution context */
  conversationId: string;
  /** User ID for tool execution context */
  userId?: string;
  /** Shared OwnPilot workspace path used by the CLI */
  workspaceDir?: string;
  /** Maximum tool-calling rounds (default: 8) */
  maxRounds?: number;
  /** Called when a new tool-bridge round starts */
  onRoundStart?: (round: number) => void;
  /** Called after tool calls are parsed from a model response */
  onToolCallsParsed?: (calls: ParsedToolCall[], round: number) => void;
  /** Called when a tool is about to be executed */
  onToolStart?: (toolCall: ToolCall, args: Record<string, unknown>) => void;
  /** Called after a tool finishes */
  onToolEnd?: (toolCall: ToolCall, result: ToolResult) => void;
}

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolBridgeResult {
  /** Final text response (tool calls stripped) */
  content: string;
  /** All tool calls made across all rounds */
  toolCalls: ToolCall[];
  /** All tool results */
  toolResults: ToolResult[];
  /** Number of tool-calling rounds */
  rounds: number;
}

// =============================================================================
// Prompt Construction
// =============================================================================

/**
 * Build tool definitions section for injection into the prompt.
 * Uses a compact format that LLMs understand well.
 */
export function buildToolPromptSection(
  tools: readonly ToolDefinition[],
  workspaceDir?: string
): string {
  if (tools.length === 0) return '';

  const lines: string[] = ['## Available Tools', ''];

  if (workspaceDir) {
    lines.push(
      `You are running inside the shared OwnPilot workspace at: ${workspaceDir}`,
      'Stay in this workspace for chat tasks.',
      'Read and follow the local instruction files here: AGENTS.md, .mcp.json, and provider-specific markdown files.',
      ''
    );
  }

  lines.push(
    'You have access to the following tools. To use a tool, respond with a JSON block wrapped in <tool_call> tags.',
    'You may call multiple tools in a single response. After calling tools, you will receive results in <tool_result> tags, then continue your response.',
    '',
    'Format:',
    '<tool_call>',
    '{"name": "tool_name", "arguments": {"param1": "value1"}}',
    '</tool_call>',
    '',
    'CRITICAL: Never call OwnPilot HTTP endpoints directly (for example /api/v1/tasks or /api/v1/mcp/serve).',
    'CRITICAL: Do not describe tools instead of using them. Emit <tool_call> when tool use is needed.',
    'IMPORTANT: Only call tools when necessary. When you have enough information, respond directly without tool calls.',
    '',
    '### Tool Definitions',
    ''
  );

  for (const tool of tools) {
    lines.push(`**${tool.name}**`);
    lines.push(`  ${tool.description}`);

    // Parameters
    const params = tool.parameters;
    if (params.properties && Object.keys(params.properties).length > 0) {
      lines.push('  Parameters:');
      const required = new Set(params.required ?? []);
      for (const [paramName, paramDef] of Object.entries(params.properties)) {
        const req = required.has(paramName) ? ' (required)' : ' (optional)';
        const desc = paramDef.description ? ` — ${paramDef.description}` : '';
        const enumVals = paramDef.enum ? ` [${paramDef.enum.join(', ')}]` : '';
        lines.push(`    - ${paramName}: ${paramDef.type}${enumVals}${req}${desc}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format tool results for injection into the next CLI prompt.
 */
export function formatToolResults(results: ToolResult[]): string {
  if (results.length === 0) return '';

  const sections = results.map((r) => {
    const status = r.isError ? ' status="error"' : '';
    return `${TOOL_RESULT_OPEN}${status}\n<id>${r.toolCallId}</id>\n${r.content}\n${TOOL_RESULT_CLOSE}`;
  });

  return sections.join('\n\n');
}

// =============================================================================
// Response Parsing
// =============================================================================

/**
 * Parse model output to extract tool calls and clean text.
 * Returns parsed tool calls and the text content with tool_call blocks removed.
 */
export function parseToolCalls(output: string): {
  toolCalls: ParsedToolCall[];
  cleanContent: string;
} {
  const toolCalls: ParsedToolCall[] = [];
  let cleanContent = output;

  // Find all <tool_call>...</tool_call> blocks
  const regex = new RegExp(
    `${escapeRegex(TOOL_CALL_OPEN)}\\s*([\\s\\S]*?)\\s*${escapeRegex(TOOL_CALL_CLOSE)}`,
    'g'
  );

  let match;
  while ((match = regex.exec(output)) !== null) {
    const jsonStr = match[1]!.trim();
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      if (typeof parsed.name === 'string') {
        toolCalls.push({
          name: parsed.name,
          arguments: (parsed.arguments as Record<string, unknown>) ?? {},
        });
      }
    } catch {
      log.warn(`Failed to parse tool call JSON: ${jsonStr.slice(0, 200)}`);
    }

    // Remove the tool_call block from clean content
    cleanContent = cleanContent.replace(match[0], '');
  }

  // Clean up extra whitespace from removed blocks
  cleanContent = cleanContent.replace(/\n{3,}/g, '\n\n').trim();

  return { toolCalls, cleanContent };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// Tool Execution
// =============================================================================

/**
 * Execute parsed tool calls against the ToolRegistry.
 */
async function executeToolCalls(
  calls: ParsedToolCall[],
  config: ToolBridgeConfig
): Promise<{ toolCalls: ToolCall[]; results: ToolResult[] }> {
  const toolCalls: ToolCall[] = [];
  const results: ToolResult[] = [];
  let callIndex = 0;

  for (const call of calls) {
    const callId = `bridge_${Date.now()}_${callIndex++}`;
    const toolCall: ToolCall = {
      id: callId,
      name: call.name,
      arguments: JSON.stringify(call.arguments),
    };
    toolCalls.push(toolCall);

    config.onToolStart?.(toolCall, call.arguments);

    try {
      const result = await config.tools.executeToolCall(
        toolCall,
        config.conversationId,
        config.userId
      );
      results.push(result);
      config.onToolEnd?.(toolCall, result);
    } catch (error) {
      const errorResult: ToolResult = {
        toolCallId: callId,
        content: `Error executing tool ${call.name}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
      results.push(errorResult);
      config.onToolEnd?.(toolCall, errorResult);
    }
  }

  return { toolCalls, results };
}

// =============================================================================
// Tool Bridge Core
// =============================================================================

/**
 * Inject tool definitions into a message array.
 * Prepends a system-level tool instruction section.
 */
export function injectToolsIntoMessages(
  messages: readonly Message[],
  tools: readonly ToolDefinition[],
  workspaceDir?: string
): Message[] {
  if (tools.length === 0) return [...messages];

  const toolSection = buildToolPromptSection(tools, workspaceDir);
  const result: Message[] = [];

  // Find the system message and append tools to it
  let systemFound = false;
  for (const msg of messages) {
    if (msg.role === 'system' && !systemFound) {
      systemFound = true;
      const systemText = typeof msg.content === 'string' ? msg.content : '';
      result.push({
        ...msg,
        content: `${systemText}\n\n${toolSection}`,
      });
    } else {
      result.push(msg);
    }
  }

  // If no system message, prepend one with tools
  if (!systemFound) {
    result.unshift({
      role: 'system',
      content: toolSection,
    });
  }

  return result;
}

/**
 * Append tool results as a follow-up user message for the next CLI round.
 */
export function appendToolResults(
  messages: readonly Message[],
  assistantResponse: string,
  results: ToolResult[],
  workspaceDir?: string
): Message[] {
  const newMessages: Message[] = [...messages];

  // Add the assistant's response (with tool calls)
  newMessages.push({
    role: 'assistant',
    content: assistantResponse,
  });

  // Add tool results as a user message
  const resultsText = formatToolResults(results);
  const workspaceReminder = workspaceDir
    ? `Stay in the shared OwnPilot workspace at ${workspaceDir} and keep following the local instruction files before continuing.\n\n`
    : '';
  newMessages.push({
    role: 'user',
    content: `${workspaceReminder}Here are the results of your tool calls:\n\n${resultsText}\n\nPlease continue your response based on these results. If you need more tools, use <tool_call> again. Otherwise, provide your final answer.`,
  });

  return newMessages;
}

/**
 * Run the full tool-calling loop.
 *
 * Takes a CLI completion function and runs it in a loop:
 * 1. Call CLI with tool-enhanced prompt
 * 2. Parse response for tool calls
 * 3. Execute tools
 * 4. Re-call CLI with results
 * 5. Repeat until no more tool calls or max rounds
 */
export async function runToolBridgeLoop(
  messages: readonly Message[],
  completeFn: (messages: readonly Message[]) => Promise<string>,
  config: ToolBridgeConfig
): Promise<ToolBridgeResult> {
  const maxRounds = config.maxRounds ?? MAX_TOOL_ROUNDS;
  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];
  let currentMessages = injectToolsIntoMessages(
    messages,
    config.toolDefinitions,
    config.workspaceDir
  );
  let rounds = 0;
  let finalContent = '';

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    config.onRoundStart?.(rounds);

    // Call the CLI
    log.info(`ToolBridge round ${rounds}: calling CLI...`);
    const rawOutput = await completeFn(currentMessages);

    // Parse for tool calls
    const { toolCalls: parsedCalls, cleanContent } = parseToolCalls(rawOutput);

    if (parsedCalls.length === 0) {
      // No tool calls — we're done
      finalContent = cleanContent || rawOutput;
      log.info(`ToolBridge completed after ${rounds} round(s), no more tool calls`);
      break;
    }

    log.info(`ToolBridge round ${rounds}: found ${parsedCalls.length} tool call(s)`);
    config.onToolCallsParsed?.(parsedCalls, rounds);

    // Execute the tools
    const { toolCalls, results } = await executeToolCalls(parsedCalls, config);
    allToolCalls.push(...toolCalls);
    allToolResults.push(...results);

    // Build next round's messages with results
    currentMessages = appendToolResults(currentMessages, rawOutput, results, config.workspaceDir);

    // If this is the last allowed round, the clean content is what we have
    if (round === maxRounds - 1) {
      finalContent = cleanContent || `[Tool calling stopped after ${maxRounds} rounds]`;
      log.warn(`ToolBridge hit max rounds (${maxRounds}), stopping`);
    }
  }

  return {
    content: finalContent,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    rounds,
  };
}
