/**
 * Workspace Manager
 *
 * Manages isolated agent sessions
 */

import { randomUUID } from 'node:crypto';
import type {
  Workspace,
  WorkspaceConfig,
  WorkspaceState,
  WorkspaceMessage,
  WorkspaceEvents,
  WorkspaceAgentConfig,
} from './types.js';
import { gatewayEvents } from '../ws/events.js';
import { getChannelService } from '@ownpilot/core';
import type { IncomingMessage } from '../ws/types.js';
import { getLog } from '../services/log.js';

const log = getLog('WorkspaceManager');

type EventHandler<T extends keyof WorkspaceEvents> = WorkspaceEvents[T];

/**
 * Workspace instance implementation
 */
class WorkspaceInstance implements Workspace {
  readonly config: WorkspaceConfig;
  private _state: WorkspaceState = 'idle';
  private _conversationId?: string;
  readonly createdAt: Date;
  private _lastActivityAt: Date;
  private _error?: string;

  private messages: WorkspaceMessage[] = [];
  private eventHandlers = new Map<keyof WorkspaceEvents, Set<EventHandler<keyof WorkspaceEvents>>>();

  constructor(config: WorkspaceConfig) {
    this.config = config;
    this.createdAt = new Date();
    this._lastActivityAt = new Date();
    this._conversationId = randomUUID();
  }

  get state(): WorkspaceState {
    return this._state;
  }

  get conversationId(): string | undefined {
    return this._conversationId;
  }

  get lastActivityAt(): Date {
    return this._lastActivityAt;
  }

  get error(): string | undefined {
    return this._error;
  }

  /**
   * Set workspace state
   */
  setState(state: WorkspaceState, error?: string): void {
    this._state = state;
    this._error = error;
    this._lastActivityAt = new Date();
    this.emit('stateChange', state, error);
  }

  /**
   * Add a message to the workspace
   */
  addMessage(message: WorkspaceMessage): void {
    this.messages.push(message);
    this._lastActivityAt = new Date();
    this.emit('message', message);
  }

  /**
   * Get all messages
   */
  getMessages(): WorkspaceMessage[] {
    return [...this.messages];
  }

  /**
   * Get recent messages for context
   */
  getContextMessages(limit?: number): WorkspaceMessage[] {
    const maxMessages = limit ?? this.config.settings?.maxContextMessages ?? 20;
    return this.messages.slice(-maxMessages);
  }

  /**
   * Clear messages
   */
  clearMessages(): void {
    this.messages = [];
    this._conversationId = randomUUID();
  }

  /**
   * Process incoming message from a channel
   */
  async processIncomingMessage(message: IncomingMessage): Promise<void> {
    // Add to history
    const workspaceMessage: WorkspaceMessage = {
      id: message.id,
      role: 'user',
      content: message.content,
      channelId: message.channelId,
      channelType: message.channelType,
      sender: {
        id: message.senderId,
        name: message.senderName,
      },
      timestamp: message.timestamp,
      attachments: message.attachments?.map((a) => ({
        id: randomUUID(),
        type: a.type,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        url: a.url,
      })),
    };

    this.addMessage(workspaceMessage);

    // Check if auto-reply is enabled
    if (this.config.settings?.autoReply !== false) {
      await this.generateResponse(message.channelId);
    }
  }

  /**
   * Generate AI response
   */
  async generateResponse(channelId: string): Promise<void> {
    this.setState('processing');

    try {
      // Get context messages for the agent
      const contextMessages = this.getContextMessages();
      const lastUserMessage = contextMessages.filter((m) => m.role === 'user').pop();

      if (!lastUserMessage?.content) {
        this.setState('idle');
        return;
      }

      const responseId = randomUUID();
      this.emit('streamStart', responseId);

      // Use the real agent system (dynamic import to avoid circular deps)
      const { getOrCreateChatAgent } = await import('../routes/agents.js');
      const { resolveProviderAndModel } = await import('../routes/settings.js');

      const agentConfig = this.config.agent;
      const resolved = await resolveProviderAndModel(
        agentConfig?.provider ?? 'default',
        agentConfig?.model ?? 'default',
      );

      const agent = await getOrCreateChatAgent(
        resolved.provider ?? 'openai',
        resolved.model ?? 'gpt-4o-mini',
      );

      const result = await agent.chat(lastUserMessage.content);

      let responseContent: string;
      if (result.ok) {
        responseContent = result.value.content;
      } else {
        responseContent = `Error: ${result.error?.message ?? 'Agent execution failed'}`;
        log.warn('Workspace agent response failed', { error: result.error });
      }

      // Add assistant message
      const assistantMessage: WorkspaceMessage = {
        id: responseId,
        role: 'assistant',
        content: responseContent,
        timestamp: new Date(),
      };

      this.addMessage(assistantMessage);

      // Emit stream end
      this.emit('streamEnd', responseId, responseContent);

      // Send to channel
      const channelService = getChannelService();
      if (channelId && channelService.getChannel(channelId)) {
        await channelService.send(channelId, {
          platformChatId: channelId,
          text: responseContent,
        });
      }

      this.setState('idle');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.setState('error', errorMessage);
      throw error;
    }
  }

  /**
   * Register event handler
   */
  on<K extends keyof WorkspaceEvents>(event: K, handler: EventHandler<K>): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as EventHandler<keyof WorkspaceEvents>);
  }

  /**
   * Remove event handler
   */
  off<K extends keyof WorkspaceEvents>(event: K, handler: EventHandler<K>): void {
    this.eventHandlers.get(event)?.delete(handler as EventHandler<keyof WorkspaceEvents>);
  }

  /**
   * Emit event
   */
  private emit<K extends keyof WorkspaceEvents>(
    event: K,
    ...args: Parameters<WorkspaceEvents[K]>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as (...args: unknown[]) => void)(...args);
        } catch (error) {
          log.error(`Error in workspace event handler for ${event}:`, error);
        }
      }
    }
  }
}

/**
 * Workspace Manager
 */
export class WorkspaceManager {
  private workspaces = new Map<string, WorkspaceInstance>();
  private channelToWorkspace = new Map<string, string>();
  private defaultWorkspaceId: string | null = null;
  private unsubscribes: Array<() => void> = [];

  constructor() {
    // Setup channel message forwarding
    this.setupChannelForwarding();
  }

  /**
   * Create a new workspace
   */
  create(config: Partial<WorkspaceConfig> & { name: string }): Workspace {
    const id = config.id ?? randomUUID();

    const fullConfig: WorkspaceConfig = {
      id,
      name: config.name,
      description: config.description,
      userId: config.userId,
      channels: config.channels ?? [],
      agent: config.agent ?? this.getDefaultAgentConfig(),
      settings: {
        autoReply: true,
        replyDelay: 500,
        maxContextMessages: 20,
        enableMemory: true,
        piiDetection: true,
        ...config.settings,
      },
    };

    const workspace = new WorkspaceInstance(fullConfig);
    this.workspaces.set(id, workspace);

    // Associate channels with workspace
    for (const channelId of fullConfig.channels) {
      this.channelToWorkspace.set(channelId, id);
    }

    // Set as default if first workspace
    if (!this.defaultWorkspaceId) {
      this.defaultWorkspaceId = id;
    }

    // Emit creation event
    gatewayEvents.emit('workspace:created', {
      workspace: {
        id: workspace.config.id,
        name: workspace.config.name,
        channels: workspace.config.channels,
        agentId: workspace.config.agent?.provider,
        createdAt: workspace.createdAt,
      },
    });

    log.info(`Workspace created: ${fullConfig.name} (${id})`);
    return workspace;
  }

  /**
   * Get a workspace
   */
  get(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  /**
   * Get workspace by channel ID
   */
  getByChannel(channelId: string): Workspace | undefined {
    const workspaceId = this.channelToWorkspace.get(channelId);
    if (workspaceId) {
      return this.workspaces.get(workspaceId);
    }
    return undefined;
  }

  /**
   * Get default workspace
   */
  getDefault(): Workspace | undefined {
    if (this.defaultWorkspaceId) {
      return this.workspaces.get(this.defaultWorkspaceId);
    }
    return undefined;
  }

  /**
   * Get or create default workspace
   */
  getOrCreateDefault(): Workspace {
    let workspace = this.getDefault();
    if (!workspace) {
      workspace = this.create({ name: 'Default Workspace' });
    }
    return workspace;
  }

  /**
   * Set default workspace
   */
  setDefault(id: string): void {
    if (!this.workspaces.has(id)) {
      throw new Error(`Workspace not found: ${id}`);
    }
    this.defaultWorkspaceId = id;
  }

  /**
   * Delete a workspace
   */
  delete(id: string): boolean {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      return false;
    }

    // Remove channel associations
    for (const channelId of workspace.config.channels) {
      this.channelToWorkspace.delete(channelId);
    }

    this.workspaces.delete(id);

    // Update default if needed
    if (this.defaultWorkspaceId === id) {
      this.defaultWorkspaceId = this.workspaces.keys().next().value ?? null;
    }

    // Emit deletion event
    gatewayEvents.emit('workspace:deleted', { workspaceId: id });

    return true;
  }

  /**
   * Get all workspaces
   */
  getAll(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Associate channel with workspace
   */
  associateChannel(workspaceId: string, channelId: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    this.channelToWorkspace.set(channelId, workspaceId);

    if (!workspace.config.channels.includes(channelId)) {
      workspace.config.channels.push(channelId);
    }
  }

  /**
   * Disassociate channel from workspace
   */
  disassociateChannel(channelId: string): void {
    const workspaceId = this.channelToWorkspace.get(channelId);
    if (workspaceId) {
      const workspace = this.workspaces.get(workspaceId);
      if (workspace) {
        const index = workspace.config.channels.indexOf(channelId);
        if (index !== -1) {
          workspace.config.channels.splice(index, 1);
        }
      }
    }
    this.channelToWorkspace.delete(channelId);
  }

  /**
   * Update workspace agent configuration
   */
  updateAgentConfig(workspaceId: string, agentConfig: Partial<WorkspaceAgentConfig>): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    workspace.config.agent = {
      ...this.getDefaultAgentConfig(),
      ...workspace.config.agent,
      ...agentConfig,
    };
  }

  /**
   * Get default agent configuration
   */
  private getDefaultAgentConfig(): WorkspaceAgentConfig {
    return {
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'You are a helpful AI assistant.',
      temperature: 0.7,
      maxTokens: 4096,
      tools: [],
    };
  }

  /**
   * Setup forwarding of channel messages to workspaces
   */
  private setupChannelForwarding(): void {
    const unsub = gatewayEvents.on('channel:message', async ({ message }) => {
      try {
        // Find workspace for this channel
        const workspace = this.getByChannel(message.channelId) as WorkspaceInstance | undefined;

        if (workspace) {
          await workspace.processIncomingMessage(message);
        } else {
          // If no workspace, use default
          const defaultWorkspace = this.getOrCreateDefault() as WorkspaceInstance;
          await defaultWorkspace.processIncomingMessage(message);
        }
      } catch (error) {
        log.error('[WorkspaceManager] Error processing channel message:', error instanceof Error ? error.message : error);
      }
    });
    this.unsubscribes.push(unsub);
  }

  /**
   * Dispose event listeners. Call during shutdown to prevent leaks.
   */
  dispose(): void {
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    log.info('WorkspaceManager disposed');
  }

  /**
   * Get workspace count
   */
  get count(): number {
    return this.workspaces.size;
  }
}

/**
 * Global workspace manager instance
 */
export const workspaceManager = new WorkspaceManager();
