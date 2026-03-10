/**
 * ACP (Agent Client Protocol) Types
 *
 * Types for OwnPilot's ACP client integration. These map ACP protocol
 * concepts to OwnPilot's internal event system.
 */

import type {
  ToolCallStatus,
  PlanEntryStatus,
  PlanEntryPriority,
  StopReason,
  ContentBlock,
  SessionMode,
  SessionConfigOption,
} from '@agentclientprotocol/sdk';

// =============================================================================
// ACP SESSION
// =============================================================================

/** ACP connection state */
export type AcpConnectionState =
  | 'connecting'
  | 'initializing'
  | 'ready'
  | 'prompting'
  | 'closed'
  | 'error';

/** Tracked ACP session — wraps the protocol session with OwnPilot metadata */
export interface AcpSession {
  /** ACP session ID (from agent) */
  acpSessionId: string;
  /** OwnPilot coding agent session ID */
  ownerSessionId: string;
  /** Current connection state */
  connectionState: AcpConnectionState;
  /** Available modes reported by the agent */
  availableModes?: SessionMode[];
  /** Current mode */
  currentMode?: string;
  /** Config options */
  configOptions?: SessionConfigOption[];
  /** Agent info from initialization */
  agentInfo?: { name: string; version: string; title?: string };
  /** Protocol version negotiated */
  protocolVersion?: number;
}

// =============================================================================
// ACP TOOL CALL TRACKING
// =============================================================================

/** A single tool call reported by the ACP agent */
export interface AcpToolCall {
  /** Tool call ID (from agent) */
  toolCallId: string;
  /** Human-readable title */
  title: string;
  /** Tool kind: read, edit, delete, move, search, execute, think, fetch, other */
  kind: string;
  /** Current status */
  status: ToolCallStatus;
  /** Raw input parameters */
  rawInput?: Record<string, unknown>;
  /** Raw output */
  rawOutput?: Record<string, unknown>;
  /** Display content (diffs, terminal output, text) */
  content?: AcpToolCallContent[];
  /** Affected file locations */
  locations?: AcpToolCallLocation[];
  /** Timestamp */
  startedAt: string;
  completedAt?: string;
}

/** Displayable content from a tool call */
export interface AcpToolCallContent {
  type: 'text' | 'diff' | 'terminal' | 'content';
  /** For text: the text content */
  text?: string;
  /** For diff: the file path */
  path?: string;
  /** For diff: old content */
  oldText?: string;
  /** For diff: new content */
  newText?: string;
  /** For terminal: terminal ID */
  terminalId?: string;
  /** For content: standard content block */
  content?: ContentBlock;
}

/** File location affected by a tool call */
export interface AcpToolCallLocation {
  path: string;
  startLine?: number;
  endLine?: number;
}

// =============================================================================
// ACP PLAN
// =============================================================================

/** An execution plan reported by the ACP agent */
export interface AcpPlan {
  entries: AcpPlanEntry[];
  updatedAt: string;
}

/** A single entry in an execution plan */
export interface AcpPlanEntry {
  content: string;
  status: PlanEntryStatus;
  priority: PlanEntryPriority;
}

// =============================================================================
// ACP EVENTS (OwnPilot WebSocket events)
// =============================================================================

/** All ACP event types emitted to WS subscribers */
export type AcpEventType =
  | 'coding-agent:acp:tool-call'
  | 'coding-agent:acp:tool-update'
  | 'coding-agent:acp:plan'
  | 'coding-agent:acp:message'
  | 'coding-agent:acp:thought'
  | 'coding-agent:acp:mode-change'
  | 'coding-agent:acp:config-update'
  | 'coding-agent:acp:complete'
  | 'coding-agent:acp:permission-request'
  | 'coding-agent:acp:session-info';

/** Base payload for all ACP events */
export interface AcpEventBase {
  sessionId: string;
  timestamp: string;
}

/** Tool call created */
export interface AcpToolCallEvent extends AcpEventBase {
  toolCall: AcpToolCall;
}

/** Tool call updated (status, content, locations changed) */
export interface AcpToolUpdateEvent extends AcpEventBase {
  toolCallId: string;
  status?: ToolCallStatus;
  content?: AcpToolCallContent[];
  locations?: AcpToolCallLocation[];
  title?: string;
}

/** Plan update */
export interface AcpPlanEvent extends AcpEventBase {
  plan: AcpPlan;
}

/** Agent message chunk (streamed text) */
export interface AcpMessageEvent extends AcpEventBase {
  content: ContentBlock;
  role: 'assistant' | 'user';
}

/** Agent thought chunk (reasoning/thinking) */
export interface AcpThoughtEvent extends AcpEventBase {
  content: ContentBlock;
}

/** Prompt turn completed */
export interface AcpCompleteEvent extends AcpEventBase {
  stopReason: StopReason;
}

/** Permission request from agent */
export interface AcpPermissionRequestEvent extends AcpEventBase {
  toolCallId: string;
  title: string;
  options: Array<{
    optionId: string;
    name: string;
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  }>;
}

// =============================================================================
// ACP CLIENT OPTIONS
// =============================================================================

/** Options for creating an ACP client connection */
export interface AcpClientOptions {
  /** CLI binary to spawn (e.g., 'claude', 'gemini', 'codex') */
  binary: string;
  /** CLI arguments for ACP mode */
  args: string[];
  /** Working directory */
  cwd: string;
  /** Environment variables */
  env: Record<string, string>;
  /** OwnPilot session ID (for event routing) */
  ownerSessionId: string;
  /** Client name reported during initialize */
  clientName?: string;
  /** Client version reported during initialize */
  clientVersion?: string;
  /** MCP servers to pass to the agent */
  mcpServers?: AcpMcpServerConfig[];
  /** Callback for session/update events (mapped to OwnPilot event payloads) */
  onUpdate?: (eventType: string, payload: Record<string, unknown>) => void;
  /** Callback for permission requests (auto-approve if not provided) */
  onPermissionRequest?: (request: AcpPermissionRequestEvent) => Promise<AcpPermissionResponse>;
  /** Callback for connection state changes */
  onStateChange?: (state: AcpConnectionState) => void;
  /** Callback for errors */
  onError?: (error: Error) => void;
}

/** MCP server config to pass to ACP agent during session creation */
export interface AcpMcpServerConfig {
  /** Server name */
  name: string;
  /** Transport type */
  transport: 'stdio' | 'http' | 'sse';
  /** For stdio: command + args */
  command?: string;
  args?: string[];
  /** For http/sse: URL */
  url?: string;
  /** Optional headers */
  headers?: Record<string, string>;
}

/** Response to a permission request */
export interface AcpPermissionResponse {
  outcome: 'selected' | 'cancelled';
  optionId?: string;
}
