/**
 * CLI Chat Provider
 *
 * IProvider implementation that uses installed CLI tools (Claude Code, Codex, Gemini CLI)
 * as chat providers. Enables users to leverage their existing CLI subscriptions
 * (Claude Max, ChatGPT Pro, Google One AI Premium) for chat without separate API keys.
 *
 * Limitations:
 * - No tool calling support (CLIs don't accept arbitrary tool definitions)
 * - Higher latency than direct API (process spawn overhead)
 * - Conversation history flattened into a single prompt
 *
 * Supported CLIs:
 * - claude (Claude Code CLI) — uses -p with --output-format
 * - codex (OpenAI Codex CLI) — uses exec --json
 * - gemini (Google Gemini CLI) — uses -p with --output-format
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { IProvider, ProviderHealthResult } from '@ownpilot/core';
import type {
  AIProvider,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
} from '@ownpilot/core';
import type { Result } from '@ownpilot/core';
import { ok, err } from '@ownpilot/core';
import { InternalError } from '@ownpilot/core';
import { createSanitizedEnv, isBinaryInstalled, MAX_OUTPUT_SIZE } from './binary-utils.js';
import { getLog } from './log.js';
import {
  type CliChatBinary,
  IS_WIN,
  messagesToPrompt,
  OUTPUT_PARSERS,
  buildClaudeArgs,
  buildCodexArgs,
  buildGeminiArgs,
  inlineSystemPrompt,
} from './cli-chat-parsers.js';

const log = getLog('CliChatProvider');

// =============================================================================
// Types
// =============================================================================

export type { CliChatBinary } from './cli-chat-parsers.js';

export interface CliChatProviderConfig {
  /** CLI binary name */
  binary: CliChatBinary;
  /** Model to use (optional — uses CLI's default when omitted, recommended) */
  model?: string;
  /** API key (optional — CLIs support login-based auth) */
  apiKey?: string;
  /** Request timeout in ms (default: 120s) */
  timeout?: number;
  /** ToolBridge config — enables tool calling through prompt engineering */
  toolBridge?: ToolBridgeAttachment;
  /** When true, inject MCP tool context into chat messages (assumes MCP is configured on the CLI) */
  mcpToolContext?: boolean;
  /** Working directory for CLI process — set to OwnPilot workspace for MCP auto-discovery */
  cwd?: string;
  /** Correlation ID for linking MCP tool calls to the chat SSE stream */
  correlationId?: string;
}

/** Attachment for ToolBridge support on a CLI provider */
export interface ToolBridgeAttachment {
  tools: import('@ownpilot/core').ToolRegistry;
  toolDefinitions: readonly import('@ownpilot/core').ToolDefinition[];
  conversationId: string;
  userId?: string;
  maxRounds?: number;
}

/** CLI provider definition with metadata */
export interface CliChatProviderDefinition {
  id: string;
  binary: CliChatBinary;
  displayName: string;
  description: string;
  /** Provider type for core system mapping */
  coreProvider: AIProvider;
  /** Default models available via CLI */
  models: string[];
  /** Default model */
  defaultModel: string;
  /** Whether the CLI binary is installed */
  installed: boolean;
  /** Whether the CLI is authenticated (has valid session) */
  authenticated: boolean;
}

// =============================================================================
// CLI Definitions
// =============================================================================

const CLI_DEFINITIONS: Record<
  CliChatBinary,
  Omit<CliChatProviderDefinition, 'installed' | 'authenticated'>
> = {
  claude: {
    id: 'cli-claude',
    binary: 'claude',
    displayName: 'Claude (CLI)',
    description:
      'Use Claude via the Claude Code CLI. Requires Claude Max/Pro subscription or API key.',
    coreProvider: 'anthropic',
    models: ['cli-default'],
    defaultModel: '',
  },
  codex: {
    id: 'cli-codex',
    binary: 'codex',
    displayName: 'Codex (CLI)',
    description:
      'Use OpenAI models via the Codex CLI. Requires ChatGPT Pro/Plus subscription or API key.',
    coreProvider: 'openai',
    models: ['cli-default'],
    defaultModel: '',
  },
  gemini: {
    id: 'cli-gemini',
    binary: 'gemini',
    displayName: 'Gemini (CLI)',
    description: 'Use Gemini models via the Gemini CLI. Requires Google account login or API key.',
    coreProvider: 'google',
    models: ['cli-default'],
    defaultModel: '',
  },
};

// =============================================================================
// Message Conversion
// =============================================================================

// =============================================================================
// Provider Implementation
// =============================================================================

export class CliChatProvider implements IProvider {
  readonly type: AIProvider;
  private readonly config: CliChatProviderConfig;
  private readonly definition: (typeof CLI_DEFINITIONS)[CliChatBinary];
  private currentProcess: ChildProcess | null = null;

  /** Correlation ID for real-time MCP tool call tracking */
  readonly correlationId?: string;

  constructor(config: CliChatProviderConfig) {
    this.config = config;
    this.definition = CLI_DEFINITIONS[config.binary];
    this.type = this.definition.coreProvider;
    this.correlationId = config.correlationId;
  }

  isReady(): boolean {
    return isBinaryInstalled(this.config.binary);
  }

  async healthCheck(): Promise<Result<ProviderHealthResult, InternalError>> {
    const start = Date.now();
    const installed = isBinaryInstalled(this.config.binary);

    if (installed) {
      return ok({
        providerId: this.type,
        status: 'ok',
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
      });
    }

    return ok({
      providerId: this.type,
      status: 'unavailable',
      error: `CLI binary '${this.config.binary}' not installed`,
      checkedAt: new Date(),
    });
  }

  recordMetric(input: {
    modelId: string;
    latencyMs: number;
    error: boolean;
    errorType?: string | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    costUsd?: number | null;
    workflowId?: string | null;
    agentId?: string | null;
    userId?: string | null;
  }): Promise<void> {
    // CLI provider does not record telemetry (uses Claude Code binary, not HTTP API)
    void input;
    return Promise.resolve();
  }

  async complete(request: CompletionRequest): Promise<Result<CompletionResponse, InternalError>> {
    const raw = request.model.model || this.config.model || this.definition.defaultModel;
    // Filter out sentinel values — CLI tools resolve their own model from config/login.
    const SENTINEL_MODELS = ['default', 'cli-default', ''];
    const model = SENTINEL_MODELS.includes(raw) ? '' : raw;
    log.debug(`CLI complete: binary=${this.config.binary} raw="${raw}" model="${model}"`);

    // If ToolBridge is configured and tools are available, run the tool-calling loop
    if (this.config.toolBridge && this.config.toolBridge.toolDefinitions.length > 0) {
      return this.completeWithToolBridge(request, model);
    }

    return this.completeSingle(request.messages, model);
  }

  /**
   * Single-shot completion — no tool calling.
   */
  private async completeSingle(
    messages: readonly Message[],
    model: string
  ): Promise<Result<CompletionResponse, InternalError>> {
    // When MCP tool context is enabled, inject tool usage guide into the conversation
    let effectiveMessages = messages;
    if (this.config.mcpToolContext) {
      const { injectToolContext } = await import('../mcp/tool-context.js');
      effectiveMessages = injectToolContext(messages) as readonly Message[];
    }
    const { prompt, systemPrompt } = messagesToPrompt(effectiveMessages);
    const effectivePrompt =
      this.config.binary === 'claude' && IS_WIN ? inlineSystemPrompt(prompt, systemPrompt) : prompt;
    const timeout = this.config.timeout ?? 120_000;

    let args: string[];
    switch (this.config.binary) {
      case 'claude':
        args = buildClaudeArgs(
          effectivePrompt,
          model,
          false,
          IS_WIN ? undefined : systemPrompt || undefined
        );
        break;
      case 'codex':
        args = buildCodexArgs(prompt, model, this.config.cwd);
        break;
      case 'gemini':
        args = buildGeminiArgs(prompt, model, this.config.cwd);
        break;
    }

    const env = createSanitizedEnv(
      this.config.binary === 'gemini'
        ? 'gemini-cli'
        : this.config.binary === 'claude'
          ? 'claude-code'
          : 'codex',
      this.config.apiKey
    );

    try {
      const result = await this.spawnAndCollect(
        this.config.binary,
        args,
        env,
        timeout,
        IS_WIN ? effectivePrompt : undefined
      );

      if (result.exitCode !== 0 && !result.stdout.trim()) {
        return err(
          new InternalError(
            `CLI ${this.config.binary} exited with code ${result.exitCode}: ${result.stderr || 'Unknown error'}`
          )
        );
      }

      const parser = OUTPUT_PARSERS[this.config.binary];
      const content = parser(result.stdout);

      const response: CompletionResponse = {
        id: `cli-${this.config.binary}-${Date.now()}`,
        content,
        finishReason: 'stop',
        model: model || `cli-${this.config.binary}`,
        createdAt: new Date(),
        usage: {
          promptTokens: Math.ceil(effectivePrompt.length / 4),
          completionTokens: Math.ceil(content.length / 4),
          totalTokens: Math.ceil((effectivePrompt.length + content.length) / 4),
        },
      };

      return ok(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`CLI ${this.config.binary} completion failed: ${message}`);
      return err(new InternalError(`CLI completion failed: ${message}`));
    }
  }

  /**
   * Completion with ToolBridge — multi-turn tool-calling loop via prompt engineering.
   */
  private async completeWithToolBridge(
    request: CompletionRequest,
    model: string
  ): Promise<Result<CompletionResponse, InternalError>> {
    const bridge = this.config.toolBridge!;

    // Import ToolBridge dynamically to avoid circular deps
    const { runToolBridgeLoop } = await import('./cli-tool-bridge.js');

    try {
      const bridgeResult = await runToolBridgeLoop(
        request.messages,
        async (msgs) => {
          const result = await this.completeSingle(msgs, model);
          if (!result.ok) throw new Error(result.error.message);
          return result.value.content;
        },
        {
          tools: bridge.tools,
          toolDefinitions: bridge.toolDefinitions,
          conversationId: bridge.conversationId,
          userId: bridge.userId,
          workspaceDir: this.config.cwd,
          maxRounds: bridge.maxRounds,
        }
      );

      // Convert ToolBridge result to CompletionResponse
      const response: CompletionResponse = {
        id: `cli-${this.config.binary}-bridge-${Date.now()}`,
        content: bridgeResult.content,
        toolCalls: bridgeResult.toolCalls.length > 0 ? bridgeResult.toolCalls : undefined,
        finishReason: 'stop',
        model,
        createdAt: new Date(),
        usage: {
          promptTokens: 0, // Approximate across rounds
          completionTokens: Math.ceil(bridgeResult.content.length / 4),
          totalTokens: Math.ceil(bridgeResult.content.length / 4),
        },
      };

      return ok(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`CLI ${this.config.binary} ToolBridge failed: ${message}`);
      return err(new InternalError(`ToolBridge completion failed: ${message}`));
    }
  }

  async *stream(
    request: CompletionRequest
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown> {
    const { prompt, systemPrompt } = messagesToPrompt(request.messages);
    const effectivePrompt =
      this.config.binary === 'claude' && IS_WIN ? inlineSystemPrompt(prompt, systemPrompt) : prompt;
    const rawModel = request.model.model || this.config.model || this.definition.defaultModel;
    const SENTINEL_MODELS = ['default', 'cli-default', ''];
    const model = SENTINEL_MODELS.includes(rawModel) ? '' : rawModel;
    const timeout = this.config.timeout ?? 120_000;
    const id = `cli-${this.config.binary}-${Date.now()}`;

    // Only Claude supports true streaming via stream-json
    if (this.config.binary === 'claude') {
      yield* this.streamClaude(
        effectivePrompt,
        model,
        id,
        timeout,
        IS_WIN ? undefined : systemPrompt || undefined
      );
      return;
    }

    if (this.config.toolBridge && this.config.toolBridge.toolDefinitions.length > 0) {
      yield* this.streamWithToolBridge(request, model, id);
      return;
    }

    // For other CLIs, do a full completion and emit as a single chunk
    const result = await this.complete(request);
    if (!result.ok) {
      yield err(result.error);
      return;
    }

    yield ok({
      id,
      content: result.value.content,
      done: true,
      finishReason: 'stop' as const,
      usage: result.value.usage,
    });
  }

  countTokens(messages: readonly Message[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else {
        for (const part of msg.content) {
          if (part.type === 'text') totalChars += part.text.length;
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }

  async getModels(): Promise<Result<string[], InternalError>> {
    return ok([...this.definition.models]);
  }

  /** Cancel ongoing CLI process */
  cancel(): void {
    if (this.currentProcess && !this.currentProcess.killed) {
      this.currentProcess.kill('SIGTERM');
      setTimeout(() => {
        if (this.currentProcess && !this.currentProcess.killed) {
          this.currentProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async *streamClaude(
    prompt: string,
    model: string,
    id: string,
    timeout: number,
    systemPrompt?: string
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown> {
    const args = buildClaudeArgs(prompt, model, true, systemPrompt);
    const env = createSanitizedEnv('claude-code', this.config.apiKey);

    const proc = spawn(this.config.binary, args, {
      env,
      cwd: this.config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: IS_WIN,
    });
    this.currentProcess = proc;

    // On Windows, write prompt via stdin
    if (IS_WIN) {
      proc.stdin?.write(prompt);
      proc.stdin?.end();
    }

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
    }, timeout);

    let buffer = '';
    let totalContent = '';

    try {
      // Create an async iterator from stdout
      const chunks = this.readStdoutChunks(proc);

      for await (const chunk of chunks) {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;

            // Handle content_block_delta events
            if (parsed.type === 'content_block_delta') {
              const delta = parsed.delta as Record<string, unknown> | undefined;
              if (delta?.type === 'text_delta' && delta.text) {
                const text = String(delta.text);
                totalContent += text;
                yield ok({ id, content: text, done: false });
              }
            }
            // Handle assistant message with text content
            else if (parsed.type === 'assistant' && parsed.message) {
              const message = parsed.message as Record<string, unknown>;
              if (message.content && Array.isArray(message.content)) {
                for (const part of message.content as Record<string, unknown>[]) {
                  if (part.type === 'text' && part.text) {
                    const text = String(part.text);
                    totalContent += text;
                    yield ok({ id, content: text, done: false });
                  }
                }
              }
            }
            // Handle result event (final)
            else if (parsed.type === 'result') {
              const resultText = String(parsed.result ?? '');
              if (resultText && !totalContent) {
                totalContent = resultText;
                yield ok({ id, content: resultText, done: false });
              }
            }
          } catch {
            // Non-JSON line, skip
          }
        }
      }

      // Final chunk
      yield ok({
        id,
        done: true,
        finishReason: 'stop' as const,
        usage: {
          promptTokens: Math.ceil(prompt.length / 4),
          completionTokens: Math.ceil(totalContent.length / 4),
          totalTokens: Math.ceil((prompt.length + totalContent.length) / 4),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield err(new InternalError(`CLI stream failed: ${message}`));
    } finally {
      clearTimeout(timer);
      this.currentProcess = null;
    }
  }

  private async *streamWithToolBridge(
    request: CompletionRequest,
    model: string,
    id: string
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown> {
    const bridge = this.config.toolBridge!;
    const queue: Array<Result<StreamChunk, InternalError> | null> = [];
    let wake: (() => void) | null = null;

    const push = (item: Result<StreamChunk, InternalError> | null) => {
      queue.push(item);
      wake?.();
      wake = null;
    };

    const next = async (): Promise<Result<StreamChunk, InternalError> | null> => {
      while (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      return queue.shift() ?? null;
    };

    void (async () => {
      try {
        const { runToolBridgeLoop } = await import('./cli-tool-bridge.js');
        const bridgeResult = await runToolBridgeLoop(
          request.messages,
          async (msgs) => {
            const result = await this.completeSingle(msgs, model);
            if (!result.ok) throw new Error(result.error.message);
            return result.value.content;
          },
          {
            tools: bridge.tools,
            toolDefinitions: bridge.toolDefinitions,
            conversationId: bridge.conversationId,
            userId: bridge.userId,
            workspaceDir: this.config.cwd,
            maxRounds: bridge.maxRounds,
            onRoundStart: (round) => {
              push(
                ok({
                  id,
                  done: false,
                  metadata: { type: 'tool_bridge_status', phase: 'round_start', round },
                })
              );
            },
            onToolCallsParsed: (calls, round) => {
              push(
                ok({
                  id,
                  done: false,
                  toolCalls: calls.map((call, index) => ({
                    id: `bridge_${round}_${index}_${Date.now()}`,
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  })),
                  metadata: {
                    type: 'tool_bridge_status',
                    phase: 'tool_calls_parsed',
                    round,
                    count: calls.length,
                  },
                })
              );
            },
            onToolStart: (toolCall) => {
              push(
                ok({
                  id,
                  done: false,
                  metadata: {
                    type: 'tool_bridge_progress',
                    phase: 'tool_start',
                    toolCall: {
                      id: toolCall.id,
                      name: toolCall.name,
                      arguments: toolCall.arguments,
                    },
                  },
                })
              );
            },
            onToolEnd: (toolCall, result) => {
              push(
                ok({
                  id,
                  done: false,
                  metadata: {
                    type: 'tool_bridge_progress',
                    phase: 'tool_end',
                    toolCall: {
                      id: toolCall.id,
                      name: toolCall.name,
                      arguments: toolCall.arguments,
                    },
                    result: {
                      success: !(result.isError ?? false),
                      preview: result.content.substring(0, 500),
                    },
                  },
                })
              );
            },
          }
        );

        push(
          ok({
            id,
            content: bridgeResult.content,
            done: true,
            finishReason: 'stop' as const,
            usage: {
              promptTokens: 0,
              completionTokens: Math.ceil(bridgeResult.content.length / 4),
              totalTokens: Math.ceil(bridgeResult.content.length / 4),
            },
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        push(err(new InternalError(`ToolBridge completion failed: ${message}`)));
      } finally {
        push(null);
      }
    })();

    while (true) {
      const item = await next();
      if (item === null) break;
      yield item;
    }
  }

  private async *readStdoutChunks(proc: ChildProcess): AsyncGenerator<string> {
    const stdout = proc.stdout;
    if (!stdout) return;

    const queue: string[] = [];
    let resolve: (() => void) | null = null;
    let done = false;
    let error: Error | null = null;

    stdout.on('data', (chunk: Buffer) => {
      queue.push(chunk.toString());
      resolve?.();
    });

    proc.on('error', (err) => {
      error = err;
      done = true;
      resolve?.();
    });

    proc.on('close', () => {
      done = true;
      resolve?.();
    });

    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (done) {
        if (error) throw error;
        return;
      }
      await new Promise<void>((r) => {
        resolve = r;
      });
      resolve = null;
    }
  }

  private spawnAndCollect(
    command: string,
    args: string[],
    env: Record<string, string>,
    timeout: number,
    stdinData?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolvePromise, reject) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      // On Windows, join command+args into a single shell string to avoid DEP0190 warning
      const proc = IS_WIN
        ? spawn([command, ...args].map((a) => `"${a}"`).join(' '), [], {
            env,
            cwd: this.config.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            shell: true,
          })
        : spawn(command, args, {
            env,
            cwd: this.config.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          });
      this.currentProcess = proc;

      // On Windows, write prompt via stdin to avoid shell escaping issues
      if (stdinData) {
        proc.stdin?.write(stdinData);
        proc.stdin?.end();
      }

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 5000);
      }, timeout);

      proc.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_SIZE) {
          stdout += chunk.toString();
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT_SIZE) {
          stderr += chunk.toString();
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.currentProcess = null;
        reject(err);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.currentProcess = null;
        if (killed) {
          reject(new Error(`Process timed out after ${timeout}ms`));
        } else {
          resolvePromise({ stdout, stderr, exitCode: code ?? 1 });
        }
      });
    });
  }
}

// =============================================================================
// Discovery & Factory
// =============================================================================

/**
 * Detect which CLI chat providers are installed and available.
 */
export function detectCliChatProviders(): CliChatProviderDefinition[] {
  const results: CliChatProviderDefinition[] = [];

  for (const [binary, def] of Object.entries(CLI_DEFINITIONS)) {
    const installed = isBinaryInstalled(binary);
    results.push({
      ...def,
      installed,
      // Auth check is expensive (spawns CLI) — we optimistically assume authenticated
      // if installed. The actual auth check happens on first use.
      authenticated: installed,
    });
  }

  return results;
}

/**
 * Create a CliChatProvider instance for a specific CLI binary.
 */
export function createCliChatProvider(config: CliChatProviderConfig): CliChatProvider {
  return new CliChatProvider(config);
}

/**
 * Check if a provider ID is a CLI chat provider.
 */
export function isCliChatProvider(providerId: string): boolean {
  return providerId.startsWith('cli-');
}

/**
 * Get the CLI binary for a CLI chat provider ID.
 */
export function getCliBinaryFromProviderId(providerId: string): CliChatBinary | null {
  const binaryMap: Record<string, CliChatBinary> = {
    'cli-claude': 'claude',
    'cli-codex': 'codex',
    'cli-gemini': 'gemini',
  };
  return binaryMap[providerId] ?? null;
}

/**
 * Get provider definition by ID.
 */
export function getCliChatProviderDefinition(providerId: string): CliChatProviderDefinition | null {
  const binary = getCliBinaryFromProviderId(providerId);
  if (!binary) return null;
  const def = CLI_DEFINITIONS[binary];
  return {
    ...def,
    installed: isBinaryInstalled(binary),
    authenticated: isBinaryInstalled(binary),
  };
}
