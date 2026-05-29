/**
 * ACP Server — exposes OwnPilot as an Agent Client Protocol agent.
 *
 * Mirror of {@link AcpClient}: that file lets OwnPilot DRIVE an external
 * ACP agent (Claude Code, Codex CLI) as a client. This one lets external
 * tools (Zed IDE, custom integrations) DRIVE OwnPilot as if it were
 * any other ACP agent. With both halves OwnPilot is a peer on the
 * protocol — competitively at parity with Hermes Agents / OpenClaw
 * which is the explicit goal of this work.
 *
 * Transport: any duplex {@link Stream} from `@agentclientprotocol/sdk` —
 * typically stdio via {@link ndJsonStream} when fronted by a CLI command.
 *
 * What this MVP wires:
 *   - `initialize` → reports our protocol version + capabilities
 *   - `newSession` → creates a chat agent (provider/model resolved from
 *     gateway defaults) and registers an internal session record
 *   - `prompt` → flattens the ACP content blocks to text, dispatches
 *     through {@link getOrCreateChatAgent}, and streams agent output
 *     back as `agent_message_chunk` / `tool_call` / `tool_call_update`
 *     notifications
 *   - `cancel` → aborts the in-flight prompt for a session
 *   - `authenticate` → no-op (OwnPilot owns its own credentials)
 *
 * Out of scope for this MVP (TODOs):
 *   - `loadSession` / session listing — would require mapping our
 *     conversation DB to ACP session shape
 *   - permission request → user — would need a callback channel the
 *     gateway can route to a UI surface; for now we run with
 *     auto-approve and trust the calling client to enforce policy
 */

import { randomUUID } from 'node:crypto';
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  type Agent,
  type Stream,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type PromptRequest,
  type PromptResponse,
  type CancelNotification,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type ContentBlock,
  type StopReason,
} from '@agentclientprotocol/sdk';
import { getOrCreateChatAgent } from '../services/agent/service.js';
import { resolveDefaultProviderAndModel } from '../services/app-settings.js';
import { getLog } from '../services/log.js';
import type { Agent as OwnPilotAgent, ToolCall, StreamChunk } from '@ownpilot/core';

const log = getLog('AcpServer');

interface ServerSession {
  sessionId: string;
  cwd: string;
  ownpilotAgent: OwnPilotAgent;
  /** Aborts the in-flight prompt when the client cancels. */
  abortController: AbortController | null;
}

/**
 * The actual ACP-side Agent impl. Created per-connection so the
 * `connection` reference (for sessionUpdate notifications) can be held
 * alongside the session map.
 */
export class AcpServerAgent implements Agent {
  private readonly connection: AgentSideConnection;
  private readonly sessions = new Map<string, ServerSession>();

  constructor(connection: AgentSideConnection) {
    this.connection = connection;
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        // We don't yet persist sessions in a form the spec expects.
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: true,
        },
      },
      // Auth methods: none. OwnPilot manages provider credentials itself,
      // so the calling client doesn't need to drive an auth dance with us.
      authMethods: [],
    };
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    return {};
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    // 'default' sentinels mean "use the gateway's configured defaults" —
    // see resolveDefaultProviderAndModel which expands them via the
    // settings store.
    const resolved = await resolveDefaultProviderAndModel('default', 'default');
    if (!resolved.provider || !resolved.model) {
      throw new Error(
        'No default LLM provider configured — visit Settings → AI Models to set one up'
      );
    }

    const ownpilotAgent = await getOrCreateChatAgent(
      resolved.provider,
      resolved.model,
      undefined,
      { path: params.cwd },
      undefined
    );

    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      sessionId,
      cwd: params.cwd,
      ownpilotAgent,
      abortController: null,
    });

    log.info(
      `Created ACP session ${sessionId} cwd=${params.cwd} provider=${resolved.provider} model=${resolved.model}`
    );
    return { sessionId };
  }

  async loadSession(_params: LoadSessionRequest): Promise<LoadSessionResponse> {
    throw new Error('loadSession not implemented — OwnPilot ACP server only supports new sessions');
  }

  async setSessionMode(_params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    // Session modes aren't surfaced yet — accept and ignore so clients
    // that probe this don't error.
    return {};
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown session ${params.sessionId}`);
    }

    // Cancel any prior in-flight prompt on this session — the client may
    // have started a new turn before the previous one completed.
    session.abortController?.abort();
    session.abortController = new AbortController();
    const { signal } = session.abortController;

    const text = flattenContentBlocks(params.prompt);
    if (!text.trim()) {
      return { stopReason: 'end_turn' satisfies StopReason };
    }

    try {
      const result = await session.ownpilotAgent.chat(text, {
        stream: true,
        onChunk: (chunk: StreamChunk) => {
          if (signal.aborted) return;
          if (chunk.content) {
            void this.connection.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: chunk.content },
              },
            });
          }
        },
        onToolStart: (toolCall: ToolCall) => {
          void this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: toolCall.id,
              title: toolCall.name,
              kind: 'other',
              status: 'pending',
              rawInput: parseToolArguments(toolCall.arguments),
            },
          });
        },
        onToolEnd: (
          toolCall: ToolCall,
          execResult: { content: string; isError: boolean; durationMs: number }
        ) => {
          void this.connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: toolCall.id,
              status: execResult.isError ? 'failed' : 'completed',
              content: [
                {
                  type: 'content',
                  content: { type: 'text', text: execResult.content },
                },
              ],
            },
          });
        },
      });

      if (signal.aborted) {
        return { stopReason: 'cancelled' satisfies StopReason };
      }
      if (!result.ok) {
        throw new Error(`Agent error: ${result.error.message}`);
      }
      return { stopReason: 'end_turn' satisfies StopReason };
    } catch (err) {
      if (signal.aborted) return { stopReason: 'cancelled' satisfies StopReason };
      throw err;
    } finally {
      if (session.abortController?.signal === signal) {
        session.abortController = null;
      }
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    session?.abortController?.abort();
  }

  async extMethod(
    _method: string,
    _params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return {};
  }

  async extNotification(_method: string, _params: Record<string, unknown>): Promise<void> {
    return;
  }
}

/**
 * Bind an {@link AcpServerAgent} to a duplex stream. Returns the
 * underlying {@link AgentSideConnection} so callers can pass it to
 * `connection.done()` (or hold it for diagnostic introspection).
 *
 * Typical usage from a CLI command:
 * ```ts
 * const stream = ndJsonStream(
 *   Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
 *   Writable.toWeb(process.stdout)
 * );
 * runAcpServer(stream);
 * ```
 */
export function runAcpServer(stream: Stream): AgentSideConnection {
  return new AgentSideConnection((conn) => new AcpServerAgent(conn), stream);
}

/**
 * Flatten ACP {@link ContentBlock}s into a single plain text string.
 * Image / audio / embedded-context blocks are dropped with a placeholder
 * for now — the MVP only honors text. When we add image support in
 * `initialize.promptCapabilities.image` we'll wire the multimodal path
 * through here.
 */
export function flattenContentBlocks(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'resource_link') {
      parts.push(`[resource: ${block.uri}]`);
    } else if (block.type === 'resource') {
      // Embedded resource — include the URI marker plus the text if present
      const r = block.resource as { uri?: string; text?: string };
      if (r.text) parts.push(r.text);
      else if (r.uri) parts.push(`[embedded: ${r.uri}]`);
    }
    // image / audio intentionally skipped until promptCapabilities flips
  }
  return parts.join('\n\n');
}

/**
 * `ToolCall.arguments` is a JSON string per the core types. The ACP
 * `rawInput` field expects a structured object — parse defensively
 * (some providers return malformed JSON or non-object payloads under
 * tool-calling fallback) and fall back to a single-key wrapper so the
 * downstream ACP client can still display something useful.
 */
export function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}
