/**
 * ACP Client
 *
 * Spawns a CLI coding agent as a subprocess and communicates with it
 * via the Agent Client Protocol (JSON-RPC over stdio).
 *
 * Usage:
 *   const client = new AcpClient(options);
 *   await client.connect();              // spawn + initialize
 *   const sessionId = await client.createSession({ cwd, mcpServers });
 *   const result = await client.prompt(sessionId, 'Fix the tests');
 *   await client.close();
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type StopReason,
  type McpServer,
} from '@agentclientprotocol/sdk';
import { createAcpClientHandler } from './acp-handlers.js';
import type { MappedAcpEvent } from './acp-event-mapper.js';
import type {
  AcpConnectionState,
  AcpSession,
  AcpClientOptions,
  AcpMcpServerConfig,
  AcpToolCall,
  AcpPlan,
} from './types.js';
import { getLog } from '../services/log.js';

const log = getLog('AcpClient');

// =============================================================================
// ACP CLIENT
// =============================================================================

export class AcpClient {
  private process: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private agent: Agent | null = null;
  private clientHandler: ReturnType<typeof createAcpClientHandler> | null = null;
  private state: AcpConnectionState = 'connecting';
  private session: AcpSession | null = null;

  /** Accumulated tool calls for the current/last prompt turn */
  private toolCalls = new Map<string, AcpToolCall>();
  /** Current plan */
  private currentPlan: AcpPlan | null = null;
  /** Accumulated text output */
  private textOutput = '';

  private readonly options: AcpClientOptions;

  constructor(options: AcpClientOptions) {
    this.options = options;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /** Current connection state */
  get connectionState(): AcpConnectionState {
    return this.state;
  }

  /** Current ACP session info */
  get currentSession(): AcpSession | null {
    return this.session;
  }

  /** All tool calls from the current/last prompt turn */
  get currentToolCalls(): AcpToolCall[] {
    return Array.from(this.toolCalls.values());
  }

  /** Current execution plan */
  get plan(): AcpPlan | null {
    return this.currentPlan;
  }

  /** Accumulated text output from agent messages */
  get output(): string {
    return this.textOutput;
  }

  /** Child process PID */
  get pid(): number | undefined {
    return this.process?.pid;
  }

  /**
   * Spawn the CLI agent process and perform ACP initialization handshake.
   */
  async connect(): Promise<void> {
    this.setState('connecting');

    const { binary, args, cwd, env } = this.options;

    log.info(`Spawning ACP agent: ${binary}`, { args, cwd });

    this.process = spawn(binary, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Capture stderr for logging
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (text) {
        log.debug(`ACP agent stderr: ${text.slice(0, 500)}`);
      }
    });

    this.process.on('error', (err) => {
      log.error(`ACP agent process error: ${err.message}`);
      this.setState('error');
      this.options.onError?.(err);
    });

    this.process.on('exit', (code, signal) => {
      log.info(`ACP agent process exited`, { code, signal });
      if (this.state !== 'closed') {
        this.setState('closed');
      }
    });

    // Convert Node streams → Web Streams for ACP SDK
    const stdin = this.process.stdin!;
    const stdout = this.process.stdout!;

    const webWritable = Writable.toWeb(stdin) as WritableStream<Uint8Array>;
    const webReadable = Readable.toWeb(stdout) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(webWritable, webReadable);

    // Create client handler (implements Client interface)
    this.clientHandler = createAcpClientHandler({
      ownerSessionId: this.options.ownerSessionId,
      cwd,
      env: this.options.env,
      onEvent: (event) => this.handleEvent(event),
      onPermissionRequest: this.options.onPermissionRequest,
      onTextOutput: (text) => {
        this.textOutput += text;
      },
    });

    // Create ClientSideConnection — connects our Client handler to the agent
    this.connection = new ClientSideConnection((agent: Agent) => {
      this.agent = agent;
      return this.clientHandler!;
    }, stream);

    // Listen for connection close
    this.connection.closed
      .then(() => {
        if (this.state !== 'closed' && this.state !== 'error') {
          this.setState('closed');
        }
      })
      .catch((err) => {
        this.setState('error');
        log.warn('ACP connection closed with error', { error: String(err) });
      });

    // Perform initialization handshake
    await this.initialize();
  }

  /**
   * Create a new ACP session with the agent.
   * Optionally pass MCP servers (including OwnPilot's own MCP server).
   */
  async createSession(options?: {
    cwd?: string;
    mcpServers?: AcpMcpServerConfig[];
  }): Promise<string> {
    if (!this.agent) throw new Error('Not connected — call connect() first');

    const mcpServers: McpServer[] = (options?.mcpServers ?? this.options.mcpServers ?? []).map(
      (s) => this.toAcpMcpServer(s)
    );

    const response = await this.agent.newSession({
      cwd: options?.cwd ?? this.options.cwd,
      mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
    });

    const sessionId = response.sessionId;
    this.session = {
      acpSessionId: sessionId,
      ownerSessionId: this.options.ownerSessionId,
      connectionState: 'ready',
      availableModes: response.availableModes,
      currentMode: response.currentMode?.id,
      configOptions: response.configOptions,
      agentInfo: this.session?.agentInfo,
      protocolVersion: this.session?.protocolVersion,
    };

    this.setState('ready');

    log.info(`ACP session created`, {
      acpSessionId: sessionId,
      ownerSessionId: this.options.ownerSessionId,
      modes: response.availableModes?.map((m: { id: string }) => m.id),
    });

    return sessionId;
  }

  /**
   * Send a prompt to the agent and wait for the turn to complete.
   * Returns the stop reason.
   */
  async prompt(
    prompt: string,
    context?: { files?: string[] }
  ): Promise<{
    stopReason: StopReason;
    output: string;
    toolCalls: AcpToolCall[];
    plan: AcpPlan | null;
  }> {
    if (!this.agent || !this.session) {
      throw new Error('No active session — call createSession() first');
    }

    this.setState('prompting');
    // Reset state for new turn
    this.toolCalls.clear();
    this.currentPlan = null;
    this.textOutput = '';

    // Build prompt content blocks
    const promptBlocks: import('@agentclientprotocol/sdk').ContentBlock[] = [
      { type: 'text', text: prompt },
    ];

    // Attach file context as resource_link if provided
    if (context?.files) {
      for (const filePath of context.files) {
        promptBlocks.push({
          type: 'resource_link',
          uri: `file://${filePath}`,
          name: filePath.split('/').pop() ?? filePath,
        });
      }
    }

    const response = await this.agent.prompt({
      sessionId: this.session.acpSessionId,
      prompt: promptBlocks,
    });

    const stopReason = response.stopReason;

    this.setState('ready');

    // Emit completion event
    this.handleEvent({
      type: 'coding-agent:acp:complete',
      payload: {
        sessionId: this.options.ownerSessionId,
        timestamp: new Date().toISOString(),
        stopReason,
      },
    });

    log.info(`Prompt turn completed`, {
      stopReason,
      toolCallCount: this.toolCalls.size,
      outputLength: this.textOutput.length,
    });

    return {
      stopReason,
      output: this.textOutput,
      toolCalls: Array.from(this.toolCalls.values()),
      plan: this.currentPlan,
    };
  }

  /**
   * Cancel the current prompt turn.
   */
  async cancel(): Promise<void> {
    if (!this.agent || !this.session) return;

    await this.agent.cancel({
      sessionId: this.session.acpSessionId,
    });
  }

  /**
   * Set the agent's operating mode (e.g., 'ask', 'code', 'architect').
   */
  async setMode(modeId: string): Promise<void> {
    if (!this.agent?.setSessionMode || !this.session) return;

    await this.agent.setSessionMode({
      sessionId: this.session.acpSessionId,
      modeId,
    });
  }

  /**
   * Close the connection and kill the agent process.
   */
  async close(): Promise<void> {
    this.setState('closed');

    this.clientHandler?.dispose();
    this.clientHandler = null;

    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds
      const forceKillTimer = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
      forceKillTimer.unref();

      this.process = null;
    }

    this.connection = null;
    this.agent = null;
    this.session = null;
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async initialize(): Promise<void> {
    if (!this.agent) throw new Error('Agent not ready');

    this.setState('initializing');

    const response = await this.agent.initialize({
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      },
      clientInfo: {
        name: this.options.clientName ?? 'ownpilot',
        version: this.options.clientVersion ?? '1.0.0',
        title: 'OwnPilot ACP Client',
      },
    });

    this.session = {
      acpSessionId: '',
      ownerSessionId: this.options.ownerSessionId,
      connectionState: 'ready',
      agentInfo: response.agentInfo
        ? {
            name: response.agentInfo.name,
            version: response.agentInfo.version,
            title: response.agentInfo.title,
          }
        : undefined,
      protocolVersion: response.protocolVersion,
    };

    log.info(`ACP initialized`, {
      agentName: response.agentInfo?.name,
      agentVersion: response.agentInfo?.version,
      protocolVersion: response.protocolVersion,
      authMethods: response.authMethods?.length,
    });

    // Handle authentication if required
    if (response.authMethods && response.authMethods.length > 0) {
      const method = response.authMethods[0];
      log.info(`Agent requires auth, using method: ${method.id}`);
      await this.agent.authenticate({ methodId: method.id });
    }

    this.setState('ready');
  }

  private handleEvent(event: MappedAcpEvent): void {
    // Track tool calls internally
    if (event.type === 'coding-agent:acp:tool-call') {
      const payload = event.payload as unknown as { toolCall: AcpToolCall };
      this.toolCalls.set(payload.toolCall.toolCallId, payload.toolCall);
    }

    // Update tool calls
    if (event.type === 'coding-agent:acp:tool-update') {
      const payload = event.payload as unknown as {
        toolCallId: string;
        status?: string;
        content?: unknown[];
        locations?: unknown[];
        title?: string;
      };
      const existing = this.toolCalls.get(payload.toolCallId);
      if (existing) {
        if (payload.status) existing.status = payload.status as AcpToolCall['status'];
        if (payload.title) existing.title = payload.title;
        if (payload.content) existing.content = payload.content as AcpToolCall['content'];
        if (payload.locations) existing.locations = payload.locations as AcpToolCall['locations'];
        if (payload.status === 'completed' || payload.status === 'failed') {
          existing.completedAt = new Date().toISOString();
        }
      }
    }

    // Track plans
    if (event.type === 'coding-agent:acp:plan') {
      const payload = event.payload as unknown as { plan: AcpPlan };
      this.currentPlan = payload.plan;
    }

    // Forward to subscriber callback with event type
    this.options.onUpdate?.(event.type, event.payload);
  }

  private setState(state: AcpConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    if (this.session) {
      this.session.connectionState = state;
    }
    this.options.onStateChange?.(state);
  }

  private toAcpMcpServer(config: AcpMcpServerConfig): McpServer {
    const mapHeaders = (h?: Record<string, string>) =>
      h ? Object.entries(h).map(([name, value]) => ({ name, value })) : [];

    switch (config.transport) {
      case 'stdio':
        return {
          name: config.name,
          command: config.command ?? '',
          args: config.args ?? [],
          env: [],
        };
      case 'http':
        return {
          type: 'http',
          name: config.name,
          url: config.url ?? '',
          headers: mapHeaders(config.headers),
        };
      case 'sse':
        return {
          type: 'sse',
          name: config.name,
          url: config.url ?? '',
          headers: mapHeaders(config.headers),
        };
    }
  }
}
