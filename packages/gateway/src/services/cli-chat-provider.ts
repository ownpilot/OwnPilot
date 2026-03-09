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
import { platform } from 'node:os';
import type { IProvider } from '@ownpilot/core';
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

const log = getLog('CliChatProvider');

// =============================================================================
// Types
// =============================================================================

export type CliChatBinary = 'claude' | 'codex' | 'gemini';

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

const CLI_DEFINITIONS: Record<CliChatBinary, Omit<CliChatProviderDefinition, 'installed' | 'authenticated'>> = {
  claude: {
    id: 'cli-claude',
    binary: 'claude',
    displayName: 'Claude (CLI)',
    description: 'Use Claude via the Claude Code CLI. Requires Claude Max/Pro subscription or API key.',
    coreProvider: 'anthropic',
    models: ['default'],
    defaultModel: 'default',
  },
  codex: {
    id: 'cli-codex',
    binary: 'codex',
    displayName: 'Codex (CLI)',
    description: 'Use OpenAI models via the Codex CLI. Requires ChatGPT Pro/Plus subscription or API key.',
    coreProvider: 'openai',
    models: ['default'],
    defaultModel: 'default',
  },
  gemini: {
    id: 'cli-gemini',
    binary: 'gemini',
    displayName: 'Gemini (CLI)',
    description: 'Use Gemini models via the Gemini CLI. Requires Google account login or API key.',
    coreProvider: 'google',
    models: ['default'],
    defaultModel: 'default',
  },
};

// =============================================================================
// Message Conversion
// =============================================================================

/**
 * Flatten a message array into a single text prompt for CLI input.
 * Returns { prompt, systemPrompt } — systemPrompt is extracted separately
 * so it can be passed via CLI flags (e.g. claude --system-prompt).
 */
function messagesToPrompt(messages: readonly Message[]): { prompt: string; systemPrompt: string } {
  const parts: string[] = [];
  let systemPrompt = '';

  for (const msg of messages) {
    const text = typeof msg.content === 'string'
      ? msg.content
      : msg.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('\n');

    if (msg.role === 'system') {
      systemPrompt = text;
    } else if (msg.role === 'user') {
      parts.push(`User: ${text}`);
    } else if (msg.role === 'assistant') {
      parts.push(`Assistant: ${text}`);
    }
    // Skip tool messages — CLIs don't understand them
  }

  // For single-turn (system + 1 user message), just send the user message directly
  const userMessages = parts.filter((p) => p.startsWith('User: '));
  if (userMessages.length === 1 && parts.length === 1) {
    return { prompt: userMessages[0]!.slice(6), systemPrompt };
  }

  // Multi-turn: include conversation history
  const sections: string[] = [];
  if (parts.length > 1) {
    sections.push(`<conversation_history>\n${parts.slice(0, -1).join('\n\n')}\n</conversation_history>`);
  }
  // Last message is the current request
  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    const currentMessage = lastPart.startsWith('User: ') ? lastPart.slice(6) : lastPart;
    sections.push(currentMessage);
  }

  return { prompt: sections.join('\n\n'), systemPrompt };
}

// =============================================================================
// Output Parsers
// =============================================================================

function parseClaudeOutput(stdout: string): string {
  // Claude --output-format json produces JSON with result field
  // Can also produce stream-json with multiple lines
  const lines = stdout.trim().split('\n');
  let result = '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type === 'result' && parsed.result) {
        result = String(parsed.result);
      } else if (parsed.type === 'assistant' && parsed.message) {
        const message = parsed.message as Record<string, unknown>;
        if (message.content && Array.isArray(message.content)) {
          const textParts = (message.content as Record<string, unknown>[])
            .filter((p) => p.type === 'text')
            .map((p) => String(p.text ?? ''));
          if (textParts.length > 0) {
            result = textParts.join('');
          }
        }
      } else if (parsed.content) {
        result = String(parsed.content);
      }
    } catch {
      // Not JSON — accumulate as plain text
      if (!result) result += line + '\n';
    }
  }

  return result.trim() || stdout.trim();
}

function parseCodexOutput(stdout: string): string {
  const lines = stdout.trim().split('\n');
  let result = '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      // Standard message format
      if (parsed.type === 'message' && parsed.role === 'assistant') {
        result = String(parsed.content ?? '');
      }
      // message.completed with nested message object
      else if (parsed.type === 'message.completed' && parsed.message) {
        const msg = parsed.message as Record<string, unknown>;
        if (Array.isArray(msg.content)) {
          const textParts = (msg.content as Record<string, unknown>[])
            .filter((p) => p.type === 'output_text' || p.type === 'text')
            .map((p) => String(p.text ?? ''));
          if (textParts.length > 0) result = textParts.join('');
        } else if (msg.content) {
          result = String(msg.content);
        }
      }
      // item.completed with text content
      else if (parsed.type === 'item.completed' && parsed.item) {
        const item = parsed.item as Record<string, unknown>;
        if (item.type === 'message' && Array.isArray(item.content)) {
          const textParts = (item.content as Record<string, unknown>[])
            .filter((p) => p.type === 'output_text' || p.type === 'text')
            .map((p) => String(p.text ?? ''));
          if (textParts.length > 0) result = textParts.join('');
        }
      }
      // Fallback: any content field
      else if (parsed.content && typeof parsed.content === 'string') {
        result = parsed.content;
      }
    } catch {
      if (line.trim()) result += line + '\n';
    }
  }

  return result.trim() || stdout.trim();
}

function parseGeminiOutput(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    return String(parsed.response ?? parsed.content ?? parsed.text ?? stdout);
  } catch {
    return stdout.trim();
  }
}

const OUTPUT_PARSERS: Record<CliChatBinary, (stdout: string) => string> = {
  claude: parseClaudeOutput,
  codex: parseCodexOutput,
  gemini: parseGeminiOutput,
};

// =============================================================================
// CLI Command Builders
// =============================================================================

/** Whether we're running on Windows */
const IS_WIN = platform() === 'win32';

/**
 * Build CLI args. Prompt is sent via stdin on Windows to avoid shell escaping issues.
 * On Unix, prompt is passed as an arg (safe since no shell involved).
 */
function buildClaudeArgs(
  prompt: string,
  _model?: string,
  streaming?: boolean,
  systemPrompt?: string
): string[] {
  const args = IS_WIN
    ? ['--output-format', streaming ? 'stream-json' : 'json']
    : ['-p', prompt, '--output-format', streaming ? 'stream-json' : 'json'];
  if (streaming) args.push('--verbose');
  // Pass system prompt via --system-prompt to override Claude Code's default identity
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  // No --model flag: CLI tools use their own default model.
  return args;
}

function buildCodexArgs(prompt: string, _model?: string): string[] {
  const args = ['exec', '--json', '--full-auto'];
  // No --model flag: CLI tools use their own default model.
  if (!IS_WIN) args.push(prompt);
  return args;
}

function buildGeminiArgs(prompt: string, _model?: string): string[] {
  const args = IS_WIN
    ? ['--yolo', '--output-format', 'json']
    : ['-p', prompt, '--yolo', '--output-format', 'json'];
  // No --model flag: CLI tools use their own default model.
  return args;
}

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

  async complete(
    request: CompletionRequest
  ): Promise<Result<CompletionResponse, InternalError>> {
    const model = request.model.model || this.config.model || this.definition.defaultModel;

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
    const timeout = this.config.timeout ?? 120_000;

    let args: string[];
    switch (this.config.binary) {
      case 'claude':
        args = buildClaudeArgs(prompt, model, false, systemPrompt || undefined);
        break;
      case 'codex':
        args = buildCodexArgs(prompt, model);
        break;
      case 'gemini':
        args = buildGeminiArgs(prompt, model);
        break;
    }

    const env = createSanitizedEnv(
      this.config.binary === 'gemini' ? 'gemini-cli' : this.config.binary === 'claude' ? 'claude-code' : 'codex',
      this.config.apiKey
    );

    try {
      const result = await this.spawnAndCollect(this.config.binary, args, env, timeout, IS_WIN ? prompt : undefined);

      if (result.exitCode !== 0 && !result.stdout.trim()) {
        return err(new InternalError(
          `CLI ${this.config.binary} exited with code ${result.exitCode}: ${result.stderr || 'Unknown error'}`
        ));
      }

      const parser = OUTPUT_PARSERS[this.config.binary];
      const content = parser(result.stdout);

      const response: CompletionResponse = {
        id: `cli-${this.config.binary}-${Date.now()}`,
        content,
        finishReason: 'stop',
        model,
        createdAt: new Date(),
        usage: {
          promptTokens: Math.ceil(prompt.length / 4),
          completionTokens: Math.ceil(content.length / 4),
          totalTokens: Math.ceil((prompt.length + content.length) / 4),
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
    const model = request.model.model || this.config.model || this.definition.defaultModel;
    const timeout = this.config.timeout ?? 120_000;
    const id = `cli-${this.config.binary}-${Date.now()}`;

    // Only Claude supports true streaming via stream-json
    if (this.config.binary === 'claude') {
      yield* this.streamClaude(prompt, model, id, timeout, systemPrompt || undefined);
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
        ? spawn([command, ...args].map(a => `"${a}"`).join(' '), [], {
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
